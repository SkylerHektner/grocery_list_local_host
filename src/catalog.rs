//! Catalog edits (SPEC §3.7–3.9): categories, items (incl. merge) and recipes, as plain
//! functions on [`Db`] that the API handlers call inside `AppState::mutate`.
//!
//! Each function validates before it changes anything and returns an [`ApiError`] on failure
//! (and `mutate` discards its draft anyway, so a failed call never leaves partial edits).
//! Status rules: an unknown id in the URL (the thing being acted on) is a 404 via the
//! `Db::find_*` helpers; an unknown id inside a body *value* (`category_id`, recipe ingredients,
//! the category order) is a 400 ([`unknown`]); duplicate names are 409s.

use std::collections::HashSet;

use crate::error::ApiError;
use crate::model::{Category, Db, Id, Ingredient, Item, ListEntry, Recipe};
use crate::names;

/// The editable fields of an item, raw from the client (validated by `create_item` /
/// `update_item`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ItemFields {
    pub name: String,
    /// `None` = Uncategorized.
    pub category_id: Option<Id>,
    pub aliases: Vec<String>,
    pub staple: bool,
}

/// 400 for an id in a request body that doesn't resolve: `"category 99 does not exist"`.
pub fn unknown(kind: &str, id: Id) -> ApiError {
    ApiError::bad_request(format!("{kind} {id} does not exist"))
}

impl Db {
    // --- categories ---

    /// Appends a category at the end of the walk order. 400 invalid name, 409 duplicate.
    pub fn create_category(&mut self, name: &str) -> Result<Id, ApiError> {
        let name = names::validate_name(name, "category name")?;
        self.check_category_name(&name, None)?;
        let id = self.alloc_id();
        self.categories.push(Category { id, name });
        Ok(id)
    }

    /// 404 unknown id, 400 invalid name, 409 duplicate (a case-only change of its own name is
    /// fine).
    pub fn rename_category(&mut self, id: Id, name: &str) -> Result<(), ApiError> {
        self.find_category(id)?;
        let name = names::validate_name(name, "category name")?;
        self.check_category_name(&name, Some(id))?;
        self.find_category_mut(id)?.name = name;
        Ok(())
    }

    /// Deletes a category; its items become Uncategorized. 404 unknown id.
    pub fn delete_category(&mut self, id: Id) -> Result<(), ApiError> {
        self.find_category(id)?;
        self.categories.retain(|c| c.id != id);
        for item in &mut self.items {
            if item.category_id == Some(id) {
                item.category_id = None;
            }
        }
        Ok(())
    }

    /// Sets the walk order. `ids` must name every category exactly once (400 otherwise).
    pub fn reorder_categories(&mut self, ids: &[Id]) -> Result<(), ApiError> {
        let mut seen = HashSet::new();
        for &id in ids {
            if self.find_category(id).is_err() {
                return Err(unknown("category", id));
            }
            if !seen.insert(id) {
                return Err(ApiError::bad_request(format!(
                    "category {id} is listed more than once"
                )));
            }
        }
        if let Some(missing) = self.categories.iter().find(|c| !seen.contains(&c.id)) {
            return Err(ApiError::bad_request(format!(
                "the order must list every category; \"{}\" ({}) is missing",
                missing.name, missing.id
            )));
        }
        let mut old = std::mem::take(&mut self.categories);
        self.categories = ids
            .iter()
            .filter_map(|id| {
                let pos = old.iter().position(|c| c.id == *id)?;
                Some(old.swap_remove(pos))
            })
            .collect();
        Ok(())
    }

    // --- items ---

    /// Normalizes and checks item fields: 400 invalid name/alias or unknown category, 409 name
    /// or alias collision. `id` = the item being edited (excluded from uniqueness checks).
    fn validated_item(&self, fields: ItemFields, id: Option<Id>) -> Result<ItemFields, ApiError> {
        let name = names::validate_name(&fields.name, "item name")?;
        let aliases = names::validate_aliases(&fields.aliases, &name)?;
        if let Some(category) = fields.category_id
            && self.find_category(category).is_err()
        {
            return Err(unknown("category", category));
        }
        self.check_item_names(&name, &aliases, id)?;
        Ok(ItemFields {
            name,
            aliases,
            ..fields
        })
    }

    /// Creates an item with zero usage stats.
    pub fn create_item(&mut self, fields: ItemFields) -> Result<Id, ApiError> {
        let fields = self.validated_item(fields, None)?;
        let id = self.alloc_id();
        self.items.push(Item {
            id,
            name: fields.name,
            category_id: fields.category_id,
            aliases: fields.aliases,
            staple: fields.staple,
            use_count: 0,
            last_used: 0,
        });
        Ok(id)
    }

    /// Replaces an item's editable fields (usage stats are kept). 404 unknown id.
    pub fn update_item(&mut self, id: Id, fields: ItemFields) -> Result<(), ApiError> {
        self.find_item(id)?;
        let fields = self.validated_item(fields, Some(id))?;
        let item = self.find_item_mut(id)?;
        item.name = fields.name;
        item.category_id = fields.category_id;
        item.aliases = fields.aliases;
        item.staple = fields.staple;
        Ok(())
    }

    /// Deletes an item and every reference to it: recipe ingredients and its list entry (recipe
    /// chips stay on the list). 404 unknown id. Callers clear the list-undo history.
    pub fn delete_item(&mut self, id: Id) -> Result<(), ApiError> {
        self.find_item(id)?;
        self.items.retain(|i| i.id != id);
        for recipe in &mut self.recipes {
            recipe.ingredients.retain(|i| i.item_id != id);
        }
        self.list.entries.retain(|e| e.item_id != id);
        Ok(())
    }

    /// Merges item `id` (A) into `into_id` (B), then deletes A:
    /// - list: A's entry folds into B's (sources unioned, B's note kept unless B has none,
    ///   B's `added_at` kept); if only A was on the list its entry now names B;
    /// - recipes: A is replaced by B, note and all (where B is already an ingredient A is just
    ///   removed, and B's note kept unless B has none);
    /// - B gains A's name and aliases as aliases, A's category if B has none, the sum of the
    ///   `use_count`s and the later `last_used`; B's name and staple flag are kept.
    ///
    /// 404 unknown `id` or `into_id`, 400 when merging an item into itself. Callers clear the
    /// list-undo history.
    pub fn merge_item(&mut self, id: Id, into_id: Id) -> Result<(), ApiError> {
        let from = self.find_item(id)?.clone();
        if id == into_id {
            return Err(ApiError::bad_request(format!(
                "cannot merge \"{}\" into itself",
                from.name
            )));
        }
        self.find_item(into_id)?;

        if let Some(pos) = self.list.entries.iter().position(|e| e.item_id == id) {
            let a = self.list.entries.remove(pos);
            match self.list_entry_mut(into_id) {
                Some(b) => {
                    for source in a.sources {
                        if !b.sources.contains(&source) {
                            b.sources.push(source);
                        }
                    }
                    if b.note.is_none() {
                        b.note = a.note;
                    }
                }
                None => self.list.entries.insert(
                    pos,
                    ListEntry {
                        item_id: into_id,
                        ..a
                    },
                ),
            }
        }

        for recipe in &mut self.recipes {
            let Some(pos) = recipe.ingredients.iter().position(|i| i.item_id == id) else {
                continue;
            };
            match recipe.ingredients.iter().position(|i| i.item_id == into_id) {
                Some(b) => {
                    let a = recipe.ingredients.remove(pos);
                    let b = &mut recipe.ingredients[if b > pos { b - 1 } else { b }];
                    if b.note.is_none() {
                        b.note = a.note;
                    }
                }
                None => recipe.ingredients[pos].item_id = into_id,
            }
        }

        self.items.retain(|i| i.id != id);
        let into = self.find_item_mut(into_id)?;
        let mut aliases = std::mem::take(&mut into.aliases);
        aliases.push(from.name);
        aliases.extend(from.aliases);
        into.aliases = names::validate_aliases(&aliases, &into.name)?;
        into.category_id = into.category_id.or(from.category_id);
        into.use_count = into.use_count.saturating_add(from.use_count);
        into.last_used = into.last_used.max(from.last_used);
        let (name, aliases) = (into.name.clone(), into.aliases.clone());
        // A's names were unique against everyone but A, so this holds; checked for safety.
        self.check_item_names(&name, &aliases, Some(into_id))
    }

    // --- recipes ---

    /// Validated ingredients for a recipe: each must be a known item (400) with a valid note
    /// (400; normalized like list notes), duplicates dropped (the first occurrence wins).
    fn recipe_ingredients(&self, raw: &[Ingredient]) -> Result<Vec<Ingredient>, ApiError> {
        let mut out: Vec<Ingredient> = Vec::with_capacity(raw.len());
        for ingredient in raw {
            let item_id = ingredient.item_id;
            if self.find_item(item_id).is_err() {
                return Err(unknown("item", item_id));
            }
            let note = names::validate_note(ingredient.note.as_deref())?;
            if !out.iter().any(|i| i.item_id == item_id) {
                out.push(Ingredient { item_id, note });
            }
        }
        Ok(out)
    }

    /// 400 invalid name, unknown item or invalid note, 409 duplicate name.
    pub fn create_recipe(
        &mut self,
        name: &str,
        ingredients: &[Ingredient],
    ) -> Result<Id, ApiError> {
        let name = names::validate_name(name, "recipe name")?;
        let ingredients = self.recipe_ingredients(ingredients)?;
        self.check_recipe_name(&name, None)?;
        let id = self.alloc_id();
        self.recipes.push(Recipe {
            id,
            name,
            ingredients,
        });
        Ok(id)
    }

    /// Replaces name and ingredients (with their notes). The list is left alone: entries keep
    /// this recipe as a source (and any note it gave them) even if the item is no longer an
    /// ingredient. 404 unknown id.
    pub fn update_recipe(
        &mut self,
        id: Id,
        name: &str,
        ingredients: &[Ingredient],
    ) -> Result<(), ApiError> {
        self.find_recipe(id)?;
        let name = names::validate_name(name, "recipe name")?;
        let ingredients = self.recipe_ingredients(ingredients)?;
        self.check_recipe_name(&name, Some(id))?;
        let recipe = self.find_recipe_mut(id)?;
        recipe.name = name;
        recipe.ingredients = ingredients;
        Ok(())
    }

    /// Deletes a recipe and takes it off the list: its chip goes, its sources are stripped from
    /// entries, and entries left without a source stay on the list as manual. 404 unknown id.
    /// Callers clear the list-undo history.
    pub fn delete_recipe(&mut self, id: Id) -> Result<(), ApiError> {
        self.find_recipe(id)?;
        self.recipes.retain(|r| r.id != id);
        self.list
            .strip_recipe(id, crate::list::Orphans::BecomeManual);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Source;

    fn db() -> Db {
        let mut db = Db::with_default_categories();
        crate::demo::seed(&mut db);
        db
    }

    fn id_of(db: &Db, name: &str) -> Id {
        db.item_by_name_ci(name).unwrap().id
    }

    fn ings(ids: &[Id]) -> Vec<Ingredient> {
        ids.iter().map(|&id| Ingredient::new(id)).collect()
    }

    fn fields(name: &str) -> ItemFields {
        ItemFields {
            name: name.into(),
            ..ItemFields::default()
        }
    }

    fn entry(item_id: Id, note: Option<&str>, sources: Vec<Source>) -> ListEntry {
        ListEntry {
            item_id,
            note: note.map(String::from),
            sources,
            added_at: 5,
        }
    }

    fn ok(db: &Db) {
        assert_eq!(db.consistency_problems(), Vec::<String>::new());
    }

    #[test]
    fn categories_create_rename_delete() {
        let mut db = db();
        let id = db.create_category("  garden  center ").unwrap();
        assert_eq!(db.categories.last().unwrap().name, "Garden center");
        assert_eq!(db.create_category("PRODUCE").unwrap_err().status(), 409);
        assert_eq!(db.create_category(" ").unwrap_err().status(), 400);

        db.rename_category(id, "garden Center").unwrap();
        assert_eq!(db.find_category(id).unwrap().name, "Garden Center");
        assert_eq!(db.rename_category(id, "bakery").unwrap_err().status(), 409);
        assert_eq!(db.rename_category(999, "X").unwrap_err().status(), 404);

        let produce = db.category_by_name_ci("Produce").unwrap().id;
        let bananas = id_of(&db, "Bananas");
        db.delete_category(produce).unwrap();
        assert!(db.find_category(produce).is_err());
        assert_eq!(db.find_item(bananas).unwrap().category_id, None);
        assert_eq!(db.delete_category(produce).unwrap_err().status(), 404);
        ok(&db);
    }

    #[test]
    fn reorder_requires_an_exact_permutation() {
        let mut db = db();
        let mut ids: Vec<Id> = db.categories.iter().map(|c| c.id).collect();
        ids.reverse();
        db.reorder_categories(&ids).unwrap();
        assert_eq!(db.categories[0].name, "Personal Care");
        assert_eq!(db.categories.len(), 11);

        let missing = &ids[1..];
        assert!(
            db.reorder_categories(missing)
                .unwrap_err()
                .message()
                .contains("\"Personal Care\" (11) is missing")
        );
        let mut dup = ids.clone();
        dup[1] = dup[0];
        assert_eq!(
            db.reorder_categories(&dup).unwrap_err().message(),
            "category 11 is listed more than once"
        );
        let mut extra = ids.clone();
        extra.push(999);
        assert_eq!(
            db.reorder_categories(&extra).unwrap_err(),
            unknown("category", 999)
        );
        // An item id is not a category id.
        let mut wrong = ids.clone();
        wrong[0] = id_of(&db, "Milk");
        assert_eq!(db.reorder_categories(&wrong).unwrap_err().status(), 400);
        assert_eq!(db.categories[0].name, "Personal Care");
    }

    #[test]
    fn items_create_and_update_validate() {
        let mut db = db();
        let id = db
            .create_item(ItemFields {
                name: " birthday   cake ".into(),
                category_id: Some(2),
                aliases: vec!["cake".into(), "CAKE".into(), "".into()],
                staple: true,
            })
            .unwrap();
        let item = db.find_item(id).unwrap();
        assert_eq!(item.name, "Birthday cake");
        assert_eq!(item.aliases, ["Cake"]);
        assert!(item.staple && item.category_id == Some(2));
        assert_eq!((item.use_count, item.last_used), (0, 0));

        assert_eq!(db.create_item(fields("milk")).unwrap_err().status(), 409);
        assert_eq!(
            db.create_item(fields("parmesan")).unwrap_err().status(),
            409
        );
        let bad_cat = ItemFields {
            category_id: Some(999),
            ..fields("Kale")
        };
        assert_eq!(
            db.create_item(bad_cat).unwrap_err(),
            unknown("category", 999)
        );
        // An item id is not a category.
        let milk = id_of(&db, "Milk");
        let wrong = ItemFields {
            category_id: Some(milk),
            ..fields("Kale")
        };
        assert_eq!(db.create_item(wrong).unwrap_err().status(), 400);

        // Update keeps usage, replaces the rest.
        db.find_item_mut(milk).unwrap().use_count = 3;
        db.update_item(
            milk,
            ItemFields {
                name: "whole milk".into(),
                category_id: None,
                aliases: vec!["Milk".into()],
                staple: true,
            },
        )
        .unwrap();
        let item = db.find_item(milk).unwrap();
        assert_eq!(item.name, "Whole milk");
        assert_eq!(item.aliases, ["Milk"]);
        assert_eq!(item.category_id, None);
        assert_eq!(item.use_count, 3);
        assert_eq!(db.update_item(999, fields("X")).unwrap_err().status(), 404);
        assert_eq!(
            db.update_item(milk, fields("Eggs")).unwrap_err().status(),
            409
        );
        ok(&db);
    }

    #[test]
    fn delete_item_cascades_out_of_recipes_and_list() {
        let mut db = db();
        let eggs = id_of(&db, "Eggs");
        let carbonara = db.recipe_by_name_ci("Spaghetti Carbonara").unwrap().id;
        db.list.entries.push(entry(
            eggs,
            None,
            vec![Source::Recipe {
                recipe_id: carbonara,
            }],
        ));
        db.list.recipe_ids.push(carbonara);

        db.delete_item(eggs).unwrap();

        assert!(db.find_item(eggs).is_err());
        assert!(db.recipes.iter().all(|r| !r.has_item(eggs)));
        assert!(db.list.entries.is_empty());
        assert_eq!(db.list.recipe_ids, [carbonara], "the chip stays");
        assert_eq!(db.delete_item(eggs).unwrap_err().status(), 404);
        ok(&db);
    }

    #[test]
    fn merge_folds_list_recipes_names_and_usage() {
        let mut db = db();
        let parm = id_of(&db, "Parmigiano Reggiano");
        let pecorino = db
            .create_item(ItemFields {
                name: "Pecorino".into(),
                category_id: None,
                aliases: vec!["Romano".into(), "parmesan".into()],
                staple: true,
            })
            .unwrap();
        let carbonara = db.recipe_by_name_ci("Spaghetti Carbonara").unwrap().id;
        let tacos = db.recipe_by_name_ci("Tacos").unwrap().id;
        // Pecorino is in Tacos (no Parmigiano there) and in Carbonara (which has Parmigiano,
        // without a note: it adopts Pecorino's).
        let note = |n: &str| Ingredient {
            item_id: pecorino,
            note: Some(n.into()),
        };
        let tacos_recipe = db.find_recipe_mut(tacos).unwrap();
        tacos_recipe.ingredients.insert(1, note("a wedge"));
        let carbonara_recipe = db.find_recipe_mut(carbonara).unwrap();
        carbonara_recipe.ingredients.push(note("finely grated"));
        db.list.recipe_ids = vec![carbonara, tacos];
        db.list.entries = vec![
            entry(
                pecorino,
                Some("grated"),
                vec![Source::Manual, Source::Recipe { recipe_id: tacos }],
            ),
            entry(
                parm,
                None,
                vec![Source::Recipe {
                    recipe_id: carbonara,
                }],
            ),
        ];
        db.find_item_mut(pecorino).unwrap().use_count = 2;
        db.find_item_mut(pecorino).unwrap().last_used = 900;
        db.find_item_mut(parm).unwrap().use_count = 3;
        db.find_item_mut(parm).unwrap().last_used = 100;

        db.merge_item(pecorino, parm).unwrap();

        assert!(db.find_item(pecorino).is_err());
        let p = db.find_item(parm).unwrap();
        assert_eq!(p.aliases, ["Parmesan", "Pecorino", "Romano"]);
        assert_eq!((p.use_count, p.last_used), (5, 900));
        assert_eq!(p.category_id, Some(3), "B keeps its own category");
        assert!(!p.staple, "B keeps its staple flag");
        let tacos_recipe = db.find_recipe(tacos).unwrap();
        assert_eq!(tacos_recipe.item_ids()[1], parm);
        assert_eq!(tacos_recipe.note_for(parm), Some("a wedge"));
        let carbonara_recipe = db.find_recipe(carbonara).unwrap();
        let carbonara_items = carbonara_recipe.item_ids();
        assert_eq!(carbonara_items.iter().filter(|&&i| i == parm).count(), 1);
        assert!(!carbonara_items.contains(&pecorino));
        assert_eq!(carbonara_recipe.note_for(parm), Some("finely grated"));
        assert_eq!(
            db.list.entries,
            [entry(
                parm,
                Some("grated"),
                vec![
                    Source::Recipe {
                        recipe_id: carbonara
                    },
                    Source::Manual,
                    Source::Recipe { recipe_id: tacos },
                ]
            )]
        );
        ok(&db);
    }

    #[test]
    fn merge_moves_a_lone_entry_and_adopts_category_and_keeps_b_note() {
        let mut db = db();
        let candles = id_of(&db, "Birthday candles"); // uncategorized
        let lemons = id_of(&db, "Lemons");
        let limes = id_of(&db, "Limes");
        db.list.entries = vec![
            entry(lemons, Some("4"), vec![Source::Manual]),
            entry(id_of(&db, "Milk"), None, vec![Source::Manual]),
        ];
        // Only A on the list: the entry is renamed in place.
        db.merge_item(lemons, limes).unwrap();
        assert_eq!(
            db.list.entries[0],
            entry(limes, Some("4"), vec![Source::Manual])
        );

        // B with a note keeps it; B without a category adopts A's.
        let bananas = id_of(&db, "Bananas");
        db.list
            .entries
            .push(entry(candles, Some("blue"), vec![Source::Manual]));
        db.list
            .entries
            .push(entry(bananas, Some("ripe"), vec![Source::Manual]));
        db.merge_item(bananas, candles).unwrap();
        let c = db.find_item(candles).unwrap();
        assert_eq!(c.category_id, Some(1));
        assert_eq!(c.aliases, ["Bananas"]);
        assert_eq!(
            db.list_entry(candles).unwrap().note.as_deref(),
            Some("blue")
        );
        assert_eq!(db.list.entries.len(), 3);
        ok(&db);
    }

    #[test]
    fn merge_errors() {
        let mut db = db();
        let milk = id_of(&db, "Milk");
        assert_eq!(
            db.merge_item(milk, milk).unwrap_err(),
            ApiError::bad_request("cannot merge \"Milk\" into itself")
        );
        assert_eq!(
            db.merge_item(999, milk).unwrap_err(),
            ApiError::not_found("item 999 not found")
        );
        assert_eq!(
            db.merge_item(milk, 999).unwrap_err(),
            ApiError::not_found("item 999 not found")
        );
    }

    #[test]
    fn recipes_create_update_validate_and_dedupe() {
        let mut db = db();
        let (milk, eggs) = (id_of(&db, "Milk"), id_of(&db, "Eggs"));
        let noted = |item_id, note: &str| Ingredient {
            item_id,
            note: Some(note.into()),
        };
        let id = db
            .create_recipe(
                " pancakes ",
                &[
                    noted(milk, "  1   cup "),
                    Ingredient::new(eggs),
                    noted(milk, "x"),
                ],
            )
            .unwrap();
        let r = db.find_recipe(id).unwrap();
        assert_eq!(r.name, "Pancakes");
        assert_eq!(r.item_ids(), [milk, eggs]);
        assert_eq!(
            r.note_for(milk),
            Some("1 cup"),
            "normalized; first duplicate wins"
        );
        assert_eq!(r.note_for(eggs), None);
        assert_eq!(db.create_recipe("tacos", &[]).unwrap_err().status(), 409);
        assert_eq!(
            db.create_recipe("Soup", &ings(&[milk, 999])).unwrap_err(),
            unknown("item", 999)
        );
        // A recipe id is not an item.
        assert_eq!(
            db.create_recipe("Soup", &ings(&[id])).unwrap_err().status(),
            400
        );
        let long = "x".repeat(81);
        assert_eq!(
            db.create_recipe("Soup", &[noted(milk, &long)])
                .unwrap_err()
                .status(),
            400
        );
        // A blank note is no note.
        db.update_recipe(id, "Crêpes", &[noted(eggs, " ")]).unwrap();
        let r = db.find_recipe(id).unwrap();
        assert_eq!(r.name, "Crêpes");
        assert_eq!(r.ingredients, ings(&[eggs]));
        assert_eq!(db.update_recipe(999, "X", &[]).unwrap_err().status(), 404);
        assert_eq!(
            db.update_recipe(id, "Stir fry", &[]).unwrap_err().status(),
            409
        );
        ok(&db);
    }

    #[test]
    fn delete_recipe_strips_sources_and_keeps_orphans_as_manual() {
        let mut db = db();
        let tacos = db.recipe_by_name_ci("Tacos").unwrap().id;
        let stir_fry = db.recipe_by_name_ci("Stir Fry").unwrap().id;
        let (limes, garlic) = (id_of(&db, "Limes"), id_of(&db, "Garlic"));
        db.list.recipe_ids = vec![tacos, stir_fry];
        db.list.entries = vec![
            entry(limes, None, vec![Source::Recipe { recipe_id: tacos }]),
            entry(
                garlic,
                None,
                vec![
                    Source::Recipe { recipe_id: tacos },
                    Source::Recipe {
                        recipe_id: stir_fry,
                    },
                ],
            ),
        ];

        db.delete_recipe(tacos).unwrap();

        assert!(db.find_recipe(tacos).is_err());
        assert_eq!(db.list.recipe_ids, [stir_fry]);
        assert_eq!(
            db.list.entries,
            [
                entry(limes, None, vec![Source::Manual]),
                entry(
                    garlic,
                    None,
                    vec![Source::Recipe {
                        recipe_id: stir_fry
                    }]
                ),
            ]
        );
        assert_eq!(db.delete_recipe(tacos).unwrap_err().status(), 404);
        ok(&db);
    }
}
