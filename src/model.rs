//! The persisted data model (SPEC §2.2) and small helpers for reading and mutating it.
//!
//! Mutations happen inside `AppState::mutate` closures that receive `&mut Db`; the helpers here
//! return [`ApiError`]s so handlers can use `?` (`db.find_item(id)?`, `db.check_item_names(..)?`).

use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::names;

/// Every category, item and recipe id comes from the one shared `Db::next_id` counter.
pub type Id = u64;

/// The `schema_version` this build reads and writes. Bump it (and add a migration in
/// `store.rs`) whenever the persisted shape changes incompatibly.
pub const SCHEMA_VERSION: u64 = 1;

/// Categories of a fresh DB, in store-walk order (SPEC §2.1).
pub const DEFAULT_CATEGORIES: [&str; 11] = [
    "Produce",
    "Bakery",
    "Deli & Cheese",
    "Meat & Seafood",
    "Dairy & Eggs",
    "Frozen",
    "Pantry",
    "Snacks",
    "Beverages",
    "Household",
    "Personal Care",
];

/// The whole database, as stored in `db.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Db {
    pub schema_version: u64,
    /// Revision counter, +1 on every successful mutation (done by the store, not by closures).
    pub version: u64,
    /// Next id to hand out; use [`Db::alloc_id`].
    pub next_id: Id,
    /// Array order = store walk order.
    pub categories: Vec<Category>,
    pub items: Vec<Item>,
    pub recipes: Vec<Recipe>,
    pub list: List,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Category {
    pub id: Id,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub id: Id,
    pub name: String,
    /// `None` = Uncategorized.
    #[serde(default)]
    pub category_id: Option<Id>,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// "Usually have it": unchecked by default in the cull dialog.
    #[serde(default)]
    pub staple: bool,
    /// Times added to the list (search ranking).
    #[serde(default)]
    pub use_count: u64,
    /// Unix seconds of the last add to the list; 0 = never.
    #[serde(default)]
    pub last_used: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recipe {
    pub id: Id,
    pub name: String,
    #[serde(default)]
    pub item_ids: Vec<Id>,
}

/// The single active grocery list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct List {
    #[serde(default)]
    pub entries: Vec<ListEntry>,
    /// Recipes added to the list ("Recipes on this list" chips).
    #[serde(default)]
    pub recipe_ids: Vec<Id>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListEntry {
    pub item_id: Id,
    /// Serialized as `null` when absent.
    #[serde(default)]
    pub note: Option<String>,
    /// Why the entry is on the list; never empty, no duplicates.
    pub sources: Vec<Source>,
    /// Unix seconds.
    #[serde(default)]
    pub added_at: u64,
}

/// `{"kind": "manual"}` or `{"kind": "recipe", "recipe_id": 20}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Source {
    Manual,
    Recipe { recipe_id: Id },
}

/// What clients see (`GET /api/state`, and `state` in every mutation response): the DB without
/// its storage bookkeeping (`schema_version`, `next_id`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub version: u64,
    pub categories: Vec<Category>,
    pub items: Vec<Item>,
    pub recipes: Vec<Recipe>,
    pub list: List,
}

/// Body of every mutation response (SPEC §4): `{"state": Snapshot, "id": <id> | null}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationResponse {
    pub state: Snapshot,
    pub id: Option<Id>,
}

impl MutationResponse {
    pub fn new(state: Snapshot, id: impl Into<Option<Id>>) -> Self {
        Self {
            state,
            id: id.into(),
        }
    }
}

/// Current time as unix seconds (for `added_at` / `last_used`).
pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Shared lookups for the id/name entities.
trait Entity {
    const KIND: &'static str;
    /// `KIND` with its indefinite article ("an item").
    const A_KIND: &'static str;
    fn id(&self) -> Id;
    fn name(&self) -> &str;
}

macro_rules! entity {
    ($ty:ty, $kind:literal, $a_kind:literal) => {
        impl Entity for $ty {
            const KIND: &'static str = $kind;
            const A_KIND: &'static str = $a_kind;
            fn id(&self) -> Id {
                self.id
            }
            fn name(&self) -> &str {
                &self.name
            }
        }
    };
}
entity!(Category, "category", "a category");
entity!(Item, "item", "an item");
entity!(Recipe, "recipe", "a recipe");

fn not_found<T: Entity>(id: Id) -> ApiError {
    ApiError::not_found(format!("{} {id} not found", T::KIND))
}

fn find<T: Entity>(all: &[T], id: Id) -> Result<&T, ApiError> {
    all.iter()
        .find(|e| e.id() == id)
        .ok_or_else(|| not_found::<T>(id))
}

fn find_mut<T: Entity>(all: &mut [T], id: Id) -> Result<&mut T, ApiError> {
    all.iter_mut()
        .find(|e| e.id() == id)
        .ok_or_else(|| not_found::<T>(id))
}

fn by_name_ci<'a, T: Entity>(all: &'a [T], name: &str) -> Option<&'a T> {
    let key = names::fold(name);
    all.iter().find(|e| names::fold(e.name()) == key)
}

/// 409 if another entity (not `exclude`) already has this name, case-insensitively.
fn check_unique_name<T: Entity>(
    all: &[T],
    name: &str,
    exclude: Option<Id>,
) -> Result<(), ApiError> {
    let key = names::fold(name);
    match all
        .iter()
        .find(|e| Some(e.id()) != exclude && names::fold(e.name()) == key)
    {
        Some(existing) => Err(ApiError::conflict(format!(
            "{} named \"{}\" already exists",
            T::A_KIND,
            existing.name()
        ))),
        None => Ok(()),
    }
}

impl Db {
    /// An empty DB at the current schema: no categories, ids start at 1.
    pub fn empty() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            version: 0,
            next_id: 1,
            categories: Vec::new(),
            items: Vec::new(),
            recipes: Vec::new(),
            list: List::default(),
        }
    }

    /// A fresh DB: [`DEFAULT_CATEGORIES`] in order with ids 1..=11, nothing else.
    pub fn with_default_categories() -> Self {
        let mut db = Self::empty();
        for name in DEFAULT_CATEGORIES {
            let id = db.alloc_id();
            db.categories.push(Category {
                id,
                name: name.to_string(),
            });
        }
        db
    }

    /// Hands out the next id from the shared counter.
    pub fn alloc_id(&mut self) -> Id {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// The largest category/item/recipe id in use (0 if none).
    pub fn max_id(&self) -> Id {
        let categories = self.categories.iter().map(|c| c.id);
        let items = self.items.iter().map(|i| i.id);
        let recipes = self.recipes.iter().map(|r| r.id);
        categories.chain(items).chain(recipes).max().unwrap_or(0)
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            version: self.version,
            categories: self.categories.clone(),
            items: self.items.clone(),
            recipes: self.recipes.clone(),
            list: self.list.clone(),
        }
    }

    // --- lookups by id: 404 `"<kind> <id> not found"` when missing ---

    pub fn find_category(&self, id: Id) -> Result<&Category, ApiError> {
        find(&self.categories, id)
    }

    pub fn find_category_mut(&mut self, id: Id) -> Result<&mut Category, ApiError> {
        find_mut(&mut self.categories, id)
    }

    pub fn find_item(&self, id: Id) -> Result<&Item, ApiError> {
        find(&self.items, id)
    }

    pub fn find_item_mut(&mut self, id: Id) -> Result<&mut Item, ApiError> {
        find_mut(&mut self.items, id)
    }

    pub fn find_recipe(&self, id: Id) -> Result<&Recipe, ApiError> {
        find(&self.recipes, id)
    }

    pub fn find_recipe_mut(&mut self, id: Id) -> Result<&mut Recipe, ApiError> {
        find_mut(&mut self.recipes, id)
    }

    /// The list entry for `item_id`, if the item is on the list.
    pub fn list_entry(&self, item_id: Id) -> Option<&ListEntry> {
        self.list.entries.iter().find(|e| e.item_id == item_id)
    }

    pub fn list_entry_mut(&mut self, item_id: Id) -> Option<&mut ListEntry> {
        self.list.entries.iter_mut().find(|e| e.item_id == item_id)
    }

    // --- lookups by name (case-insensitive; pass normalized names) ---

    pub fn category_by_name_ci(&self, name: &str) -> Option<&Category> {
        by_name_ci(&self.categories, name)
    }

    /// Matches item names only (not aliases).
    pub fn item_by_name_ci(&self, name: &str) -> Option<&Item> {
        by_name_ci(&self.items, name)
    }

    /// Matches an item name first, then any alias.
    pub fn item_by_name_or_alias_ci(&self, name: &str) -> Option<&Item> {
        self.item_by_name_ci(name).or_else(|| {
            let key = names::fold(name);
            self.items
                .iter()
                .find(|i| i.aliases.iter().any(|a| names::fold(a) == key))
        })
    }

    pub fn recipe_by_name_ci(&self, name: &str) -> Option<&Recipe> {
        by_name_ci(&self.recipes, name)
    }

    // --- uniqueness checks (SPEC §2.3): 409 on conflict; `exclude` = the entity being renamed ---

    pub fn check_category_name(&self, name: &str, exclude: Option<Id>) -> Result<(), ApiError> {
        check_unique_name(&self.categories, name, exclude)
    }

    pub fn check_recipe_name(&self, name: &str, exclude: Option<Id>) -> Result<(), ApiError> {
        check_unique_name(&self.recipes, name, exclude)
    }

    /// Item names are unique, and no alias may equal another item's name (in either direction:
    /// the new name may not be another item's alias, the new aliases may not be another item's
    /// name). Two items may share an alias. Pass values from `names::validate_*`.
    pub fn check_item_names(
        &self,
        name: &str,
        aliases: &[String],
        exclude: Option<Id>,
    ) -> Result<(), ApiError> {
        check_unique_name(&self.items, name, exclude)?;
        let others = || self.items.iter().filter(move |i| Some(i.id) != exclude);
        if let Some(other) = others().find(|i| i.aliases.iter().any(|a| names::same_name(a, name)))
        {
            return Err(ApiError::conflict(format!(
                "\"{name}\" is already an alias of \"{}\"",
                other.name
            )));
        }
        for alias in aliases {
            if let Some(other) = others().find(|i| names::same_name(&i.name, alias)) {
                return Err(ApiError::conflict(format!(
                    "alias \"{alias}\" is already the name of item \"{}\"",
                    other.name
                )));
            }
        }
        Ok(())
    }

    /// Every broken invariant, as human-readable strings (empty = consistent). For tests and
    /// diagnostics: ids unique and below `next_id`, names normalized/valid/unique, references
    /// resolve, list entries unique with non-empty, duplicate-free sources whose recipes are on
    /// the list.
    pub fn consistency_problems(&self) -> Vec<String> {
        let mut problems = Vec::new();
        if self.schema_version != SCHEMA_VERSION {
            problems.push(format!("schema_version is {}", self.schema_version));
        }

        let mut ids = HashSet::new();
        let all_ids = (self.categories.iter().map(|c| ("category", c.id)))
            .chain(self.items.iter().map(|i| ("item", i.id)))
            .chain(self.recipes.iter().map(|r| ("recipe", r.id)));
        for (kind, id) in all_ids {
            if id == 0 || id >= self.next_id {
                problems.push(format!(
                    "{kind} id {id} not in 1..next_id ({})",
                    self.next_id
                ));
            }
            if !ids.insert(id) {
                problems.push(format!("duplicate id {id}"));
            }
        }

        check_names(&self.categories, &mut problems);
        check_names(&self.items, &mut problems);
        check_names(&self.recipes, &mut problems);

        let category_ids: HashSet<Id> = self.categories.iter().map(|c| c.id).collect();
        let item_ids: HashSet<Id> = self.items.iter().map(|i| i.id).collect();
        let recipe_ids: HashSet<Id> = self.recipes.iter().map(|r| r.id).collect();

        for item in &self.items {
            if let Some(c) = item.category_id.filter(|c| !category_ids.contains(c)) {
                problems.push(format!("item {} has unknown category {c}", item.id));
            }
            match names::validate_aliases(&item.aliases, &item.name) {
                Ok(valid) if valid == item.aliases => {}
                _ => problems.push(format!("item {} has invalid aliases", item.id)),
            }
            for alias in &item.aliases {
                if let Some(other) = self
                    .items
                    .iter()
                    .find(|o| o.id != item.id && names::same_name(&o.name, alias))
                {
                    problems.push(format!(
                        "alias \"{alias}\" of item {} is item {}'s name",
                        item.id, other.id
                    ));
                }
            }
        }

        for recipe in &self.recipes {
            check_refs(
                &format!("recipe {}", recipe.id),
                "item",
                &recipe.item_ids,
                &item_ids,
                &mut problems,
            );
        }

        check_refs(
            "list.recipe_ids",
            "recipe",
            &self.list.recipe_ids,
            &recipe_ids,
            &mut problems,
        );
        let entry_items: Vec<Id> = self.list.entries.iter().map(|e| e.item_id).collect();
        check_refs("list", "item", &entry_items, &item_ids, &mut problems);
        for entry in &self.list.entries {
            let at = format!("list entry for item {}", entry.item_id);
            if entry.sources.is_empty() {
                problems.push(format!("{at} has no sources"));
            }
            let unique: HashSet<&Source> = entry.sources.iter().collect();
            if unique.len() != entry.sources.len() {
                problems.push(format!("{at} has duplicate sources"));
            }
            for source in &entry.sources {
                if let Source::Recipe { recipe_id } = source
                    && !self.list.recipe_ids.contains(recipe_id)
                {
                    problems.push(format!(
                        "{at} has recipe {recipe_id} not in list.recipe_ids"
                    ));
                }
            }
            match names::validate_note(entry.note.as_deref()) {
                Ok(valid) if valid == entry.note => {}
                _ => problems.push(format!("{at} has an invalid note")),
            }
        }
        problems
    }
}

fn check_names<T: Entity>(all: &[T], problems: &mut Vec<String>) {
    let mut seen = HashSet::new();
    for e in all {
        match names::validate_name(e.name(), T::KIND) {
            Ok(valid) if valid == e.name() => {}
            _ => problems.push(format!(
                "{} {} has invalid name {:?}",
                T::KIND,
                e.id(),
                e.name()
            )),
        }
        if !seen.insert(names::fold(e.name())) {
            problems.push(format!("duplicate {} name {:?}", T::KIND, e.name()));
        }
    }
}

fn check_refs(at: &str, kind: &str, refs: &[Id], known: &HashSet<Id>, problems: &mut Vec<String>) {
    let mut seen = HashSet::new();
    for id in refs {
        if !known.contains(id) {
            problems.push(format!("{at} references unknown {kind} {id}"));
        }
        if !seen.insert(id) {
            problems.push(format!("{at} lists {kind} {id} twice"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(db: &mut Db, name: &str, aliases: &[&str]) -> Id {
        let id = db.alloc_id();
        db.items.push(Item {
            id,
            name: name.into(),
            category_id: None,
            aliases: aliases.iter().map(|a| a.to_string()).collect(),
            staple: false,
            use_count: 0,
            last_used: 0,
        });
        id
    }

    #[test]
    fn default_categories_in_walk_order_with_sequential_ids() {
        let db = Db::with_default_categories();
        let names: Vec<&str> = db.categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, DEFAULT_CATEGORIES);
        let ids: Vec<Id> = db.categories.iter().map(|c| c.id).collect();
        assert_eq!(ids, (1..=11).collect::<Vec<_>>());
        assert_eq!(db.next_id, 12);
        assert_eq!(db.version, 0);
        assert_eq!(db.schema_version, SCHEMA_VERSION);
        assert!(db.items.is_empty() && db.recipes.is_empty());
        assert_eq!(db.list, List::default());
        assert_eq!(db.consistency_problems(), Vec::<String>::new());
    }

    #[test]
    fn alloc_id_is_monotonic_and_max_id_tracks_usage() {
        let mut db = Db::empty();
        assert_eq!(db.max_id(), 0);
        assert_eq!(db.alloc_id(), 1);
        assert_eq!(db.alloc_id(), 2);
        assert_eq!(db.next_id, 3);
        let id = item(&mut db, "Milk", &[]);
        assert_eq!(id, 3);
        assert_eq!(db.max_id(), 3);
    }

    #[test]
    fn source_serializes_internally_tagged() {
        assert_eq!(
            serde_json::to_value(Source::Manual).unwrap(),
            json!({ "kind": "manual" })
        );
        assert_eq!(
            serde_json::to_value(Source::Recipe { recipe_id: 20 }).unwrap(),
            json!({ "kind": "recipe", "recipe_id": 20 })
        );
        let parsed: Vec<Source> = serde_json::from_value(
            json!([{ "kind": "manual" }, { "kind": "recipe", "recipe_id": 7 }]),
        )
        .unwrap();
        assert_eq!(
            parsed,
            vec![Source::Manual, Source::Recipe { recipe_id: 7 }]
        );
        assert!(serde_json::from_value::<Source>(json!({ "kind": "other" })).is_err());
    }

    #[test]
    fn db_parses_the_spec_example_and_round_trips() {
        let doc = json!({
          "schema_version": 1, "version": 42, "next_id": 120,
          "categories": [{ "id": 1, "name": "Produce" }],
          "items": [{
            "id": 10, "name": "Parmigiano Reggiano", "category_id": 1,
            "aliases": ["Parmesan"], "staple": false, "use_count": 4, "last_used": 1760650000
          }],
          "recipes": [{ "id": 20, "name": "Tacos", "item_ids": [10] }],
          "list": {
            "entries": [{
              "item_id": 10, "note": "2 wedges",
              "sources": [{ "kind": "manual" }, { "kind": "recipe", "recipe_id": 20 }],
              "added_at": 1760650000
            }],
            "recipe_ids": [20]
          }
        });
        let db: Db = serde_json::from_value(doc.clone()).unwrap();
        assert_eq!(db.items[0].aliases, vec!["Parmesan"]);
        assert_eq!(serde_json::to_value(&db).unwrap(), doc);
        assert_eq!(db.consistency_problems(), Vec::<String>::new());
    }

    #[test]
    fn optional_fields_default_when_missing() {
        let item: Item = serde_json::from_value(json!({ "id": 1, "name": "Milk" })).unwrap();
        assert_eq!(item.category_id, None);
        assert!(item.aliases.is_empty() && !item.staple);
        assert_eq!((item.use_count, item.last_used), (0, 0));
        let entry: ListEntry =
            serde_json::from_value(json!({ "item_id": 1, "sources": [{ "kind": "manual" }] }))
                .unwrap();
        assert_eq!(entry.note, None);
        // Absent note is written as null.
        assert_eq!(serde_json::to_value(&entry).unwrap()["note"], json!(null));
    }

    #[test]
    fn snapshot_excludes_storage_bookkeeping() {
        let mut db = Db::with_default_categories();
        db.version = 7;
        let snap = serde_json::to_value(db.snapshot()).unwrap();
        let mut keys: Vec<&str> = snap
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["categories", "items", "list", "recipes", "version"]);
        assert_eq!(snap["version"], 7);
        assert_eq!(snap["categories"][0], json!({ "id": 1, "name": "Produce" }));
    }

    #[test]
    fn mutation_response_shape() {
        let db = Db::empty();
        let with_id = serde_json::to_value(MutationResponse::new(db.snapshot(), 5)).unwrap();
        assert_eq!(with_id["id"], 5);
        assert_eq!(with_id["state"]["version"], 0);
        let without = serde_json::to_value(MutationResponse::new(db.snapshot(), None)).unwrap();
        assert_eq!(without["id"], json!(null));
    }

    #[test]
    fn find_by_id_returns_404_errors() {
        let mut db = Db::with_default_categories();
        let milk = item(&mut db, "Milk", &[]);
        assert_eq!(db.find_category(1).unwrap().name, "Produce");
        assert_eq!(db.find_item(milk).unwrap().name, "Milk");
        db.find_item_mut(milk).unwrap().staple = true;
        assert!(db.find_item(milk).unwrap().staple);
        db.find_category_mut(2).unwrap().name = "Bread".into();
        assert_eq!(db.categories[1].name, "Bread");

        assert_eq!(
            db.find_item(999),
            Err(ApiError::not_found("item 999 not found"))
        );
        assert_eq!(
            db.find_category(milk).unwrap_err(),
            ApiError::not_found(format!("category {milk} not found"))
        );
        assert_eq!(
            db.find_recipe(1).unwrap_err().message(),
            "recipe 1 not found"
        );
        assert!(db.find_recipe_mut(1).is_err());
    }

    #[test]
    fn list_entry_lookup() {
        let mut db = Db::empty();
        let milk = item(&mut db, "Milk", &[]);
        assert!(db.list_entry(milk).is_none());
        db.list.entries.push(ListEntry {
            item_id: milk,
            note: None,
            sources: vec![Source::Manual],
            added_at: 1,
        });
        db.list_entry_mut(milk).unwrap().note = Some("2%".into());
        assert_eq!(db.list_entry(milk).unwrap().note.as_deref(), Some("2%"));
    }

    #[test]
    fn name_lookups_are_case_insensitive() {
        let mut db = Db::with_default_categories();
        let parm = item(&mut db, "Parmigiano Reggiano", &["Parmesan"]);
        assert_eq!(db.category_by_name_ci("dairy & EGGS").unwrap().id, 5);
        assert_eq!(db.item_by_name_ci("parmigiano reggiano").unwrap().id, parm);
        assert!(db.item_by_name_ci("parmesan").is_none());
        assert_eq!(db.item_by_name_or_alias_ci("PARMESAN").unwrap().id, parm);
        assert!(db.item_by_name_or_alias_ci("cheddar").is_none());
        assert!(db.recipe_by_name_ci("tacos").is_none());
    }

    #[test]
    fn category_and_recipe_names_must_be_unique() {
        let mut db = Db::with_default_categories();
        let err = db.check_category_name("produce", None).unwrap_err();
        assert_eq!(
            err,
            ApiError::conflict("a category named \"Produce\" already exists")
        );
        assert!(db.check_category_name("Garden", None).is_ok());
        // Renaming a category to a different case of its own name is fine.
        assert!(db.check_category_name("PRODUCE", Some(1)).is_ok());

        let id = db.alloc_id();
        db.recipes.push(Recipe {
            id,
            name: "Tacos".into(),
            item_ids: vec![],
        });
        assert_eq!(
            db.check_recipe_name("TACOS", None).unwrap_err().status(),
            409
        );
        assert!(db.check_recipe_name("Tacos", Some(id)).is_ok());
    }

    #[test]
    fn item_names_and_aliases_must_not_collide() {
        let mut db = Db::empty();
        let parm = item(&mut db, "Parmigiano Reggiano", &["Parmesan"]);
        let milk = item(&mut db, "Milk", &[]);

        // Duplicate name.
        let err = db.check_item_names("milk", &[], None).unwrap_err();
        assert_eq!(
            err,
            ApiError::conflict("an item named \"Milk\" already exists")
        );
        // New name equals another item's alias.
        let err = db.check_item_names("Parmesan", &[], None).unwrap_err();
        assert_eq!(
            err,
            ApiError::conflict("\"Parmesan\" is already an alias of \"Parmigiano Reggiano\"")
        );
        // New alias equals another item's name.
        let err = db
            .check_item_names("Whole milk", &["MILK".to_string()], None)
            .unwrap_err();
        assert_eq!(
            err,
            ApiError::conflict("alias \"MILK\" is already the name of item \"Milk\"")
        );
        // Shared aliases are allowed; renaming an item excludes itself.
        assert!(
            db.check_item_names("Grana Padano", &["Parmesan".to_string()], None)
                .is_ok()
        );
        assert!(db.check_item_names("MILK", &[], Some(milk)).is_ok());
        assert!(
            db.check_item_names("Parmesan", &["Parmigiano".to_string()], Some(parm))
                .is_ok()
        );
    }

    #[test]
    fn consistency_problems_are_reported() {
        let mut db = Db::with_default_categories();
        let milk = item(&mut db, "Milk", &[]);
        db.items[0].category_id = Some(999);
        db.items.push(Item {
            id: milk,
            name: "milk".into(),
            ..db.items[0].clone()
        });
        db.recipes.push(Recipe {
            id: 500,
            name: "Tacos".into(),
            item_ids: vec![milk, milk, 77],
        });
        db.list.entries.push(ListEntry {
            item_id: 88,
            note: Some(" ".into()),
            sources: vec![
                Source::Recipe { recipe_id: 3 },
                Source::Recipe { recipe_id: 3 },
            ],
            added_at: 0,
        });
        let problems = db.consistency_problems().join("\n");
        for expected in [
            "item 12 has unknown category 999",
            "duplicate id 12",
            "item 12 has invalid name \"milk\"",
            "duplicate item name \"milk\"",
            "recipe id 500 not in 1..next_id (13)",
            "recipe 500 lists item 12 twice",
            "recipe 500 references unknown item 77",
            "list references unknown item 88",
            "list entry for item 88 has duplicate sources",
            "list entry for item 88 has recipe 3 not in list.recipe_ids",
            "list entry for item 88 has an invalid note",
        ] {
            assert!(
                problems.contains(expected),
                "missing {expected:?} in:\n{problems}"
            );
        }
    }

    #[test]
    fn unix_now_is_plausible() {
        assert!(unix_now() > 1_700_000_000);
    }
}
