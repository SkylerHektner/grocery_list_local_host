//! List edits (SPEC §3.1, §3.4, §3.5) as plain functions on [`Db`]; the API handlers call them
//! inside `AppState::mutate_with(ListUndo::Record, ..)`.
//!
//! Usage stats (`use_count` +1, `last_used` = now) are bumped when an item is *put on* the list:
//! a manual add bumps when it creates the entry or gives an existing (recipe-only) entry its
//! manual source; a recipe add bumps only the items it newly puts on the list. Re-adding
//! something that is already there never counts twice.

use crate::error::ApiError;
use crate::model::{Db, Id, Ingredient, List, ListEntry, Source};
use crate::names;

/// What [`List::strip_recipe`] does with entries left without any source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Orphans {
    /// Removing a recipe chip: entries only that recipe put there leave the list.
    Remove,
    /// Deleting the recipe itself: the items stay on the list as if added manually.
    BecomeManual,
}

impl List {
    /// Takes `recipe_id` off the list: out of `recipe_ids` and out of every entry's sources.
    pub fn strip_recipe(&mut self, recipe_id: Id, orphans: Orphans) {
        let source = Source::Recipe { recipe_id };
        self.recipe_ids.retain(|&r| r != recipe_id);
        for entry in &mut self.entries {
            entry.sources.retain(|s| *s != source);
            if entry.sources.is_empty() && orphans == Orphans::BecomeManual {
                entry.sources.push(Source::Manual);
            }
        }
        self.entries.retain(|e| !e.sources.is_empty());
    }
}

/// Adds `source` unless present; returns whether it was added.
fn add_source(sources: &mut Vec<Source>, source: Source) -> bool {
    if sources.contains(&source) {
        return false;
    }
    sources.push(source);
    true
}

impl Db {
    /// `POST /api/list/items`: puts an item on the list with a manual source. If it is already
    /// there, it gains the manual source and, only when `note` is non-empty, the new note
    /// (re-adding is never an error). 404 unknown item, 400 invalid note.
    pub fn add_item_to_list(
        &mut self,
        item_id: Id,
        note: Option<&str>,
        now: u64,
    ) -> Result<(), ApiError> {
        self.find_item(item_id)?;
        let note = names::validate_note(note)?;
        let put_on_list = match self.list_entry_mut(item_id) {
            Some(entry) => {
                if note.is_some() {
                    entry.note = note;
                }
                add_source(&mut entry.sources, Source::Manual)
            }
            None => {
                self.list.entries.push(ListEntry {
                    item_id,
                    note,
                    sources: vec![Source::Manual],
                    added_at: now,
                });
                true
            }
        };
        if put_on_list {
            self.bump_usage(item_id, now)?;
        }
        Ok(())
    }

    /// `PUT /api/list/items/{item_id}`: sets (or with `None`/blank, clears) an entry's note.
    /// 404 unknown item or not on the list, 400 invalid note.
    pub fn set_list_note(&mut self, item_id: Id, note: Option<&str>) -> Result<(), ApiError> {
        let note = names::validate_note(note)?;
        self.listed_entry_mut(item_id)?.note = note;
        Ok(())
    }

    /// `DELETE /api/list/items/{item_id}`: removes the entry whatever its sources. Recipe chips
    /// stay even if no entry from that recipe is left (the user may have culled them all).
    /// 404 unknown item or not on the list.
    pub fn remove_item_from_list(&mut self, item_id: Id) -> Result<(), ApiError> {
        self.listed_entry_mut(item_id)?;
        self.list.entries.retain(|e| e.item_id != item_id);
        Ok(())
    }

    /// `POST /api/list/recipes`: adds the culled `item_ids` (a subset of the recipe's
    /// ingredients, else 400; duplicates ignored) with this recipe as a source, and the recipe to
    /// `list.recipe_ids` (even when `item_ids` is empty, so the chip shows). Items already on the
    /// list just gain the source. New entries follow the recipe's ingredient order. Each entry
    /// without a note gets the ingredient's note (an existing note is never replaced). 404
    /// unknown recipe.
    pub fn add_recipe_to_list(
        &mut self,
        recipe_id: Id,
        item_ids: &[Id],
        now: u64,
    ) -> Result<(), ApiError> {
        let recipe = self.find_recipe(recipe_id)?;
        if let Some(&bad) = item_ids.iter().find(|&&id| !recipe.has_item(id)) {
            return Err(ApiError::bad_request(format!(
                "item {bad} is not an ingredient of \"{}\"",
                recipe.name
            )));
        }
        let chosen: Vec<Ingredient> = (recipe.ingredients.iter())
            .filter(|i| item_ids.contains(&i.item_id))
            .cloned()
            .collect();
        let source = Source::Recipe { recipe_id };
        for Ingredient { item_id, note } in chosen {
            match self.list_entry_mut(item_id) {
                Some(entry) => {
                    add_source(&mut entry.sources, source);
                    if entry.note.is_none() {
                        entry.note = note;
                    }
                }
                None => {
                    self.list.entries.push(ListEntry {
                        item_id,
                        note,
                        sources: vec![source],
                        added_at: now,
                    });
                    self.bump_usage(item_id, now)?;
                }
            }
        }
        if !self.list.recipe_ids.contains(&recipe_id) {
            self.list.recipe_ids.push(recipe_id);
        }
        Ok(())
    }

    /// `DELETE /api/list/recipes/{recipe_id}`: removes the chip and the recipe source from every
    /// entry; entries left without a source leave the list (items also added manually or by
    /// another recipe stay). A staying entry whose note is still this recipe's note for it
    /// loses that note, or takes the note of the first remaining recipe source that has one.
    /// 404 unknown recipe or recipe not on the list.
    pub fn remove_recipe_from_list(&mut self, recipe_id: Id) -> Result<(), ApiError> {
        let recipe = self.find_recipe(recipe_id)?;
        if !self.list.recipe_ids.contains(&recipe_id) {
            return Err(ApiError::not_found(format!(
                "\"{}\" is not on the list",
                recipe.name
            )));
        }
        let recipe = recipe.clone();
        self.list.strip_recipe(recipe_id, Orphans::Remove);
        for i in 0..self.list.entries.len() {
            let entry = &self.list.entries[i];
            let Some(default) = recipe.note_for(entry.item_id) else {
                continue;
            };
            if entry.note.as_deref() == Some(default) {
                let fallback = self.recipe_note(entry);
                self.list.entries[i].note = fallback;
            }
        }
        Ok(())
    }

    /// The note of the first recipe source of `entry` whose recipe has one for its item.
    fn recipe_note(&self, entry: &ListEntry) -> Option<String> {
        entry.sources.iter().find_map(|source| match source {
            Source::Recipe { recipe_id } => {
                let recipe = self.find_recipe(*recipe_id).ok()?;
                recipe.note_for(entry.item_id).map(String::from)
            }
            Source::Manual => None,
        })
    }

    /// `DELETE /api/list`: empties the list (entries and recipe chips).
    pub fn clear_list(&mut self) {
        self.list = List::default();
    }

    /// The entry of an item that must exist (404) and be on the list (404).
    fn listed_entry_mut(&mut self, item_id: Id) -> Result<&mut ListEntry, ApiError> {
        let name = self.find_item(item_id)?.name.clone();
        self.list_entry_mut(item_id)
            .ok_or_else(|| ApiError::not_found(format!("\"{name}\" is not on the list")))
    }

    fn bump_usage(&mut self, item_id: Id, now: u64) -> Result<(), ApiError> {
        let item = self.find_item_mut(item_id)?;
        item.use_count = item.use_count.saturating_add(1);
        item.last_used = item.last_used.max(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_760_650_000;

    fn db() -> Db {
        let mut db = Db::with_default_categories();
        crate::demo::seed(&mut db);
        db
    }

    fn id(db: &Db, name: &str) -> Id {
        db.item_by_name_ci(name).unwrap().id
    }

    fn recipe(db: &Db, name: &str) -> Id {
        db.recipe_by_name_ci(name).unwrap().id
    }

    fn usage(db: &Db, name: &str) -> (u64, u64) {
        let item = db.item_by_name_ci(name).unwrap();
        (item.use_count, item.last_used)
    }

    fn sources(db: &Db, name: &str) -> Vec<Source> {
        db.list_entry(id(db, name)).unwrap().sources.clone()
    }

    fn ok(db: &Db) {
        assert_eq!(db.consistency_problems(), Vec::<String>::new());
    }

    #[test]
    fn manual_add_creates_entry_and_bumps_usage() {
        let mut db = db();
        let eggs = id(&db, "Eggs");
        db.add_item_to_list(eggs, Some("  2   dozen "), NOW)
            .unwrap();
        assert_eq!(
            db.list.entries,
            [ListEntry {
                item_id: eggs,
                note: Some("2 dozen".into()),
                sources: vec![Source::Manual],
                added_at: NOW,
            }]
        );
        assert_eq!(usage(&db, "Eggs"), (1, NOW));
        ok(&db);
    }

    #[test]
    fn manual_re_add_is_a_no_op_except_for_a_given_note() {
        let mut db = db();
        let eggs = id(&db, "Eggs");
        db.add_item_to_list(eggs, Some("2 dozen"), NOW).unwrap();

        // No note / blank note: nothing changes, usage not counted twice.
        db.add_item_to_list(eggs, None, NOW + 10).unwrap();
        db.add_item_to_list(eggs, Some("   "), NOW + 20).unwrap();
        assert_eq!(
            db.list_entry(eggs).unwrap().note.as_deref(),
            Some("2 dozen")
        );
        assert_eq!(usage(&db, "Eggs"), (1, NOW));
        // A note replaces the old one (still no usage bump).
        db.add_item_to_list(eggs, Some("1 dozen"), NOW + 30)
            .unwrap();
        let entry = db.list_entry(eggs).unwrap();
        assert_eq!(entry.note.as_deref(), Some("1 dozen"));
        assert_eq!(entry.added_at, NOW);
        assert_eq!(db.list.entries.len(), 1);
        assert_eq!(usage(&db, "Eggs"), (1, NOW));
    }

    #[test]
    fn manual_add_to_recipe_entry_gains_manual_source_and_bumps() {
        let mut db = db();
        let carbonara = recipe(&db, "Spaghetti Carbonara");
        let eggs = id(&db, "Eggs");
        db.add_recipe_to_list(carbonara, &[eggs], NOW).unwrap();
        assert_eq!(usage(&db, "Eggs"), (1, NOW));

        db.add_item_to_list(eggs, None, NOW + 5).unwrap();
        assert_eq!(
            sources(&db, "Eggs"),
            [
                Source::Recipe {
                    recipe_id: carbonara
                },
                Source::Manual
            ]
        );
        assert_eq!(usage(&db, "Eggs"), (2, NOW + 5));
        ok(&db);
    }

    #[test]
    fn manual_add_errors() {
        let mut db = db();
        assert_eq!(
            db.add_item_to_list(999, None, NOW).unwrap_err(),
            ApiError::not_found("item 999 not found")
        );
        let eggs = id(&db, "Eggs");
        let long = "x".repeat(81);
        assert_eq!(
            db.add_item_to_list(eggs, Some(&long), NOW)
                .unwrap_err()
                .status(),
            400
        );
    }

    #[test]
    fn notes_set_and_clear() {
        let mut db = db();
        let eggs = id(&db, "Eggs");
        db.add_item_to_list(eggs, None, NOW).unwrap();
        db.set_list_note(eggs, Some(" brown ")).unwrap();
        assert_eq!(db.list_entry(eggs).unwrap().note.as_deref(), Some("brown"));
        db.set_list_note(eggs, Some("")).unwrap();
        assert_eq!(db.list_entry(eggs).unwrap().note, None);
        db.set_list_note(eggs, Some("x")).unwrap();
        db.set_list_note(eggs, None).unwrap();
        assert_eq!(db.list_entry(eggs).unwrap().note, None);

        let milk = id(&db, "Milk");
        assert_eq!(
            db.set_list_note(milk, Some("x")).unwrap_err(),
            ApiError::not_found("\"Milk\" is not on the list")
        );
        assert_eq!(db.set_list_note(999, None).unwrap_err().status(), 404);
    }

    #[test]
    fn remove_item_keeps_recipe_chip() {
        let mut db = db();
        let tacos = recipe(&db, "Tacos");
        let limes = id(&db, "Limes");
        db.add_recipe_to_list(tacos, &[limes], NOW).unwrap();
        db.remove_item_from_list(limes).unwrap();
        assert!(db.list.entries.is_empty());
        assert_eq!(db.list.recipe_ids, [tacos]);
        assert_eq!(db.remove_item_from_list(limes).unwrap_err().status(), 404);
        assert_eq!(db.remove_item_from_list(999).unwrap_err().status(), 404);
        ok(&db);
    }

    #[test]
    fn recipe_add_extends_entries_without_duplicates() {
        let mut db = db();
        let (tacos, carbonara) = (recipe(&db, "Tacos"), recipe(&db, "Spaghetti Carbonara"));
        let (salt, limes, beef) = (id(&db, "Salt"), id(&db, "Limes"), id(&db, "Ground beef"));
        db.add_item_to_list(salt, Some("kosher"), NOW).unwrap();

        // Duplicates in the request are ignored; entries follow the recipe order.
        db.add_recipe_to_list(tacos, &[salt, limes, beef, limes], NOW + 1)
            .unwrap();
        let order: Vec<Id> = db.list.entries.iter().map(|e| e.item_id).collect();
        assert_eq!(order, [salt, beef, limes]);
        assert_eq!(
            sources(&db, "Salt"),
            [Source::Manual, Source::Recipe { recipe_id: tacos }]
        );
        assert_eq!(db.list_entry(salt).unwrap().note.as_deref(), Some("kosher"));
        assert_eq!(usage(&db, "Salt"), (1, NOW), "already on the list");
        assert_eq!(usage(&db, "Limes"), (1, NOW + 1));
        assert_eq!(db.list.recipe_ids, [tacos]);

        // Adding the same recipe again: no duplicate sources, chips or usage.
        db.add_recipe_to_list(tacos, &[limes], NOW + 2).unwrap();
        assert_eq!(sources(&db, "Limes"), [Source::Recipe { recipe_id: tacos }]);
        assert_eq!(usage(&db, "Limes"), (1, NOW + 1));
        assert_eq!(db.list.recipe_ids, [tacos]);

        // A second recipe sharing Salt adds its source.
        db.add_recipe_to_list(carbonara, &[salt], NOW + 3).unwrap();
        assert_eq!(db.list.recipe_ids, [tacos, carbonara]);
        assert_eq!(sources(&db, "Salt").len(), 3);
        ok(&db);
    }

    #[test]
    fn recipe_add_with_nothing_selected_still_adds_the_chip() {
        let mut db = db();
        let tacos = recipe(&db, "Tacos");
        db.add_recipe_to_list(tacos, &[], NOW).unwrap();
        assert!(db.list.entries.is_empty());
        assert_eq!(db.list.recipe_ids, [tacos]);
        ok(&db);
    }

    #[test]
    fn recipe_add_errors() {
        let mut db = db();
        let tacos = recipe(&db, "Tacos");
        let milk = id(&db, "Milk");
        assert_eq!(
            db.add_recipe_to_list(tacos, &[milk], NOW).unwrap_err(),
            ApiError::bad_request(format!("item {milk} is not an ingredient of \"Tacos\""))
        );
        assert_eq!(
            db.add_recipe_to_list(tacos, &[999], NOW)
                .unwrap_err()
                .status(),
            400
        );
        assert_eq!(
            db.add_recipe_to_list(999, &[], NOW).unwrap_err(),
            ApiError::not_found("recipe 999 not found")
        );
    }

    #[test]
    fn recipe_removal_drops_only_entries_it_alone_put_there() {
        let mut db = db();
        let (tacos, carbonara) = (recipe(&db, "Tacos"), recipe(&db, "Spaghetti Carbonara"));
        let (salt, limes, beef) = (id(&db, "Salt"), id(&db, "Limes"), id(&db, "Ground beef"));
        let bacon = id(&db, "Bacon");
        db.add_recipe_to_list(tacos, &[salt, limes, beef], NOW)
            .unwrap();
        db.add_recipe_to_list(carbonara, &[salt, bacon], NOW)
            .unwrap();
        db.add_item_to_list(limes, None, NOW).unwrap();

        db.remove_recipe_from_list(tacos).unwrap();

        let left: Vec<Id> = db.list.entries.iter().map(|e| e.item_id).collect();
        assert_eq!(left, [limes, salt, bacon]);
        assert_eq!(
            sources(&db, "Salt"),
            [Source::Recipe {
                recipe_id: carbonara
            }]
        );
        assert_eq!(sources(&db, "Limes"), [Source::Manual]);
        assert_eq!(db.list.recipe_ids, [carbonara]);
        ok(&db);

        assert_eq!(
            db.remove_recipe_from_list(tacos).unwrap_err(),
            ApiError::not_found("\"Tacos\" is not on the list")
        );
        assert_eq!(db.remove_recipe_from_list(999).unwrap_err().status(), 404);
    }

    fn note(db: &Db, name: &str) -> Option<String> {
        db.list_entry(id(db, name)).unwrap().note.clone()
    }

    fn set_recipe_note(db: &mut Db, recipe_id: Id, item_id: Id, note: &str) {
        let recipe = db.find_recipe_mut(recipe_id).unwrap();
        let ingredient = (recipe.ingredients.iter_mut())
            .find(|i| i.item_id == item_id)
            .unwrap();
        ingredient.note = Some(note.into());
    }

    #[test]
    fn recipe_add_fills_only_empty_notes() {
        let mut db = db();
        let (tacos, carbonara) = (recipe(&db, "Tacos"), recipe(&db, "Spaghetti Carbonara"));
        let (beef, limes, salt) = (id(&db, "Ground beef"), id(&db, "Limes"), id(&db, "Salt"));
        set_recipe_note(&mut db, carbonara, salt, "for the pasta water");
        db.add_item_to_list(limes, Some("4"), NOW).unwrap();
        db.add_item_to_list(salt, None, NOW).unwrap();

        db.add_recipe_to_list(tacos, &[beef, limes, salt], NOW)
            .unwrap();
        assert_eq!(
            note(&db, "Ground beef").as_deref(),
            Some("1 lb"),
            "new entry"
        );
        assert_eq!(note(&db, "Limes").as_deref(), Some("4"), "never replaced");
        assert_eq!(note(&db, "Salt"), None, "Tacos has no note for salt");

        // A second recipe fills the still-empty note.
        db.add_recipe_to_list(carbonara, &[salt], NOW).unwrap();
        assert_eq!(note(&db, "Salt").as_deref(), Some("for the pasta water"));
        ok(&db);
    }

    #[test]
    fn recipe_removal_clears_its_untouched_notes() {
        let mut db = db();
        let (tacos, carbonara) = (recipe(&db, "Tacos"), recipe(&db, "Spaghetti Carbonara"));
        let (beef, limes, salt) = (id(&db, "Ground beef"), id(&db, "Limes"), id(&db, "Salt"));
        set_recipe_note(&mut db, tacos, salt, "flaky");
        set_recipe_note(&mut db, carbonara, salt, "coarse");
        db.add_item_to_list(beef, None, NOW).unwrap();
        db.add_item_to_list(limes, None, NOW).unwrap();
        db.add_recipe_to_list(tacos, &[beef, limes, salt], NOW)
            .unwrap();
        db.add_recipe_to_list(carbonara, &[salt], NOW).unwrap();
        db.set_list_note(limes, Some("3")).unwrap(); // edited by the user: kept
        assert_eq!(note(&db, "Salt").as_deref(), Some("flaky"));

        db.remove_recipe_from_list(tacos).unwrap();

        assert_eq!(note(&db, "Ground beef"), None, "still Tacos' note: cleared");
        assert_eq!(note(&db, "Limes").as_deref(), Some("3"));
        assert_eq!(
            note(&db, "Salt").as_deref(),
            Some("coarse"),
            "the remaining recipe's note takes over"
        );
        ok(&db);
    }

    #[test]
    fn clear_empties_entries_and_chips() {
        let mut db = db();
        let tacos = recipe(&db, "Tacos");
        let limes = id(&db, "Limes");
        db.add_recipe_to_list(tacos, &[limes], NOW).unwrap();
        db.clear_list();
        assert_eq!(db.list, List::default());
        assert_eq!(usage(&db, "Limes"), (1, NOW), "usage is history, kept");
    }

    #[test]
    fn strip_recipe_orphan_modes() {
        let mut list = List {
            entries: vec![ListEntry {
                item_id: 1,
                note: None,
                sources: vec![Source::Recipe { recipe_id: 9 }],
                added_at: 0,
            }],
            recipe_ids: vec![9],
        };
        let mut manual = list.clone();
        manual.strip_recipe(9, Orphans::BecomeManual);
        assert_eq!(manual.entries[0].sources, [Source::Manual]);
        assert!(manual.recipe_ids.is_empty());
        list.strip_recipe(9, Orphans::Remove);
        assert_eq!(list, List::default());
    }
}
