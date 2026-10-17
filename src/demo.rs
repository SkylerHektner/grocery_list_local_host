//! Demo catalog for `--demo` / `GROCERY_DEMO=1`, seeded only into a freshly created DB (the
//! Playwright server always runs with it). Tests may rely on these exact names.
//!
//! Items (`*` = staple, `(aka …)` = aliases), in the order they get ids (12, 13, …):
//! - **Produce:** Bananas, Avocados, Lemons, Limes, Yellow onions, Garlic\*, Scallions
//!   (aka Green onions), Cilantro (aka Coriander), Tomatoes, Broccoli, Bell peppers, Carrots
//! - **Bakery:** Sourdough bread, Corn tortillas
//! - **Deli & Cheese:** Parmigiano Reggiano (aka Parmesan), Sharp cheddar (aka Cheddar)
//! - **Meat & Seafood:** Ground beef, Chicken thighs, Bacon
//! - **Dairy & Eggs:** Eggs, Milk, Butter\*, Greek yogurt, Heavy cream, Sour cream
//! - **Frozen:** Frozen peas, Vanilla ice cream (aka Ice cream)
//! - **Pantry:** Olive oil\* (aka EVOO), Salt\* (aka Kosher salt), Black pepper\*, Spaghetti,
//!   Basmati rice, Soy sauce\*, Black beans, BBQ sauce, Chicken stock
//! - **Snacks:** Tortilla chips
//! - **Beverages:** Coffee beans\*, Sparkling water
//! - **Household:** Paper towels
//! - **Personal Care:** Toothpaste
//! - **Uncategorized:** Taco seasoning, Birthday candles
//!
//! Recipes (staples marked `*`):
//! - **Tacos:** Ground beef, Corn tortillas, Sharp cheddar, Sour cream, Cilantro, Limes,
//!   Avocados, Tomatoes, Yellow onions, Taco seasoning, Salt\*
//! - **Spaghetti Carbonara:** Spaghetti, Bacon, Eggs, Parmigiano Reggiano, Garlic\*,
//!   Black pepper\*, Salt\*
//! - **Stir Fry:** Chicken thighs, Broccoli, Bell peppers, Scallions, Garlic\*, Soy sauce\*,
//!   Basmati rice, Olive oil\*
//! - **Weekly Staples:** Bananas, Milk, Eggs, Greek yogurt, Sourdough bread, Sparkling water
//!
//! Ingredient notes: Tacos gives Ground beef "1 lb" and Limes "2"; Spaghetti Carbonara gives
//! Eggs "4 yolks + 1 whole".
//!
//! The list starts empty and all usage stats are 0.

use crate::model::{Db, Ingredient, Item, Recipe};

pub struct DemoItem {
    pub name: &'static str,
    /// A `DEFAULT_CATEGORIES` name; `None` = Uncategorized.
    pub category: Option<&'static str>,
    pub aliases: &'static [&'static str],
    pub staple: bool,
}

pub struct DemoRecipe {
    pub name: &'static str,
    /// Item names from [`ITEMS`].
    pub items: &'static [&'static str],
    /// `(item name, note)` for the ingredients that have a note.
    pub notes: &'static [(&'static str, &'static str)],
}

impl DemoRecipe {
    pub fn note_for(&self, item: &str) -> Option<&'static str> {
        self.notes
            .iter()
            .find(|(n, _)| *n == item)
            .map(|&(_, note)| note)
    }
}

const fn item(category: &'static str, name: &'static str) -> DemoItem {
    DemoItem {
        name,
        category: Some(category),
        aliases: &[],
        staple: false,
    }
}

const fn staple(category: &'static str, name: &'static str) -> DemoItem {
    DemoItem {
        staple: true,
        ..item(category, name)
    }
}

const fn aka(
    category: &'static str,
    name: &'static str,
    aliases: &'static [&'static str],
) -> DemoItem {
    DemoItem {
        aliases,
        ..item(category, name)
    }
}

const fn uncategorized(name: &'static str) -> DemoItem {
    DemoItem {
        category: None,
        ..item("", name)
    }
}

const PRODUCE: &str = "Produce";
const BAKERY: &str = "Bakery";
const DELI: &str = "Deli & Cheese";
const MEAT: &str = "Meat & Seafood";
const DAIRY: &str = "Dairy & Eggs";
const FROZEN: &str = "Frozen";
const PANTRY: &str = "Pantry";

pub const ITEMS: &[DemoItem] = &[
    item(PRODUCE, "Bananas"),
    item(PRODUCE, "Avocados"),
    item(PRODUCE, "Lemons"),
    item(PRODUCE, "Limes"),
    item(PRODUCE, "Yellow onions"),
    staple(PRODUCE, "Garlic"),
    aka(PRODUCE, "Scallions", &["Green onions"]),
    aka(PRODUCE, "Cilantro", &["Coriander"]),
    item(PRODUCE, "Tomatoes"),
    item(PRODUCE, "Broccoli"),
    item(PRODUCE, "Bell peppers"),
    item(PRODUCE, "Carrots"),
    item(BAKERY, "Sourdough bread"),
    item(BAKERY, "Corn tortillas"),
    aka(DELI, "Parmigiano Reggiano", &["Parmesan"]),
    aka(DELI, "Sharp cheddar", &["Cheddar"]),
    item(MEAT, "Ground beef"),
    item(MEAT, "Chicken thighs"),
    item(MEAT, "Bacon"),
    item(DAIRY, "Eggs"),
    item(DAIRY, "Milk"),
    staple(DAIRY, "Butter"),
    item(DAIRY, "Greek yogurt"),
    item(DAIRY, "Heavy cream"),
    item(DAIRY, "Sour cream"),
    item(FROZEN, "Frozen peas"),
    aka(FROZEN, "Vanilla ice cream", &["Ice cream"]),
    DemoItem {
        staple: true,
        ..aka(PANTRY, "Olive oil", &["EVOO"])
    },
    DemoItem {
        staple: true,
        ..aka(PANTRY, "Salt", &["Kosher salt"])
    },
    staple(PANTRY, "Black pepper"),
    item(PANTRY, "Spaghetti"),
    item(PANTRY, "Basmati rice"),
    staple(PANTRY, "Soy sauce"),
    item(PANTRY, "Black beans"),
    item(PANTRY, "BBQ sauce"),
    item(PANTRY, "Chicken stock"),
    item("Snacks", "Tortilla chips"),
    staple("Beverages", "Coffee beans"),
    item("Beverages", "Sparkling water"),
    item("Household", "Paper towels"),
    item("Personal Care", "Toothpaste"),
    uncategorized("Taco seasoning"),
    uncategorized("Birthday candles"),
];

pub const RECIPES: &[DemoRecipe] = &[
    DemoRecipe {
        name: "Tacos",
        items: &[
            "Ground beef",
            "Corn tortillas",
            "Sharp cheddar",
            "Sour cream",
            "Cilantro",
            "Limes",
            "Avocados",
            "Tomatoes",
            "Yellow onions",
            "Taco seasoning",
            "Salt",
        ],
        notes: &[("Ground beef", "1 lb"), ("Limes", "2")],
    },
    DemoRecipe {
        name: "Spaghetti Carbonara",
        items: &[
            "Spaghetti",
            "Bacon",
            "Eggs",
            "Parmigiano Reggiano",
            "Garlic",
            "Black pepper",
            "Salt",
        ],
        notes: &[("Eggs", "4 yolks + 1 whole")],
    },
    DemoRecipe {
        name: "Stir Fry",
        items: &[
            "Chicken thighs",
            "Broccoli",
            "Bell peppers",
            "Scallions",
            "Garlic",
            "Soy sauce",
            "Basmati rice",
            "Olive oil",
        ],
        notes: &[],
    },
    DemoRecipe {
        name: "Weekly Staples",
        items: &[
            "Bananas",
            "Milk",
            "Eggs",
            "Greek yogurt",
            "Sourdough bread",
            "Sparkling water",
        ],
        notes: &[],
    },
];

/// Adds [`ITEMS`] and [`RECIPES`] to `db`, which should be a fresh
/// `Db::with_default_categories()` (category names are resolved case-insensitively; an unknown
/// category or recipe item name is skipped).
pub fn seed(db: &mut Db) {
    for demo in ITEMS {
        let category_id = demo
            .category
            .and_then(|name| db.category_by_name_ci(name))
            .map(|c| c.id);
        let id = db.alloc_id();
        db.items.push(Item {
            id,
            name: demo.name.to_string(),
            category_id,
            aliases: demo.aliases.iter().map(|a| a.to_string()).collect(),
            staple: demo.staple,
            use_count: 0,
            last_used: 0,
        });
    }
    for demo in RECIPES {
        let ingredients = (demo.items.iter())
            .filter_map(|&name| {
                let item_id = db.item_by_name_ci(name)?.id;
                Some(Ingredient {
                    item_id,
                    note: demo.note_for(name).map(String::from),
                })
            })
            .collect();
        let id = db.alloc_id();
        db.recipes.push(Recipe {
            id,
            name: demo.name.to_string(),
            ingredients,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DEFAULT_CATEGORIES, List};
    use crate::names;

    fn seeded() -> Db {
        let mut db = Db::with_default_categories();
        seed(&mut db);
        db
    }

    #[test]
    fn seeded_db_is_consistent() {
        let db = seeded();
        assert_eq!(db.consistency_problems(), Vec::<String>::new());
        assert_eq!(db.items.len(), ITEMS.len());
        assert_eq!(db.recipes.len(), RECIPES.len());
        assert!((38..=48).contains(&ITEMS.len()), "~40 items");
        assert_eq!(RECIPES.len(), 4);
        assert_eq!(db.list, List::default());
        assert_eq!(db.version, 0);
        // Categories are untouched.
        assert_eq!(db.categories, Db::with_default_categories().categories);
    }

    #[test]
    fn every_reference_resolves() {
        for demo in ITEMS {
            if let Some(cat) = demo.category {
                assert!(DEFAULT_CATEGORIES.contains(&cat), "{cat}");
            }
        }
        let db = seeded();
        for (demo, recipe) in RECIPES.iter().zip(&db.recipes) {
            assert_eq!(recipe.name, demo.name);
            assert_eq!(recipe.ingredients.len(), demo.items.len(), "{}", demo.name);
            for (name, ingredient) in demo.items.iter().zip(&recipe.ingredients) {
                assert_eq!(db.find_item(ingredient.item_id).unwrap().name, *name);
                assert_eq!(ingredient.note.as_deref(), demo.note_for(name));
            }
            for (name, note) in demo.notes {
                assert!(demo.items.contains(name), "{name}");
                assert_eq!(
                    names::validate_note(Some(note)).unwrap().as_deref(),
                    Some(*note)
                );
            }
        }
    }

    #[test]
    fn names_are_normalized_valid_and_unique() {
        let db = seeded();
        for item in &db.items {
            assert_eq!(
                names::validate_name(&item.name, "item name").unwrap(),
                item.name
            );
            for alias in &item.aliases {
                assert_eq!(names::validate_name(alias, "alias").unwrap(), *alias);
                assert!(
                    db.item_by_name_ci(alias).is_none(),
                    "alias {alias} is a name"
                );
            }
            assert!(
                db.check_item_names(&item.name, &item.aliases, Some(item.id))
                    .is_ok()
            );
        }
        for recipe in &db.recipes {
            assert!(db.check_recipe_name(&recipe.name, Some(recipe.id)).is_ok());
        }
    }

    #[test]
    fn has_staples_aliases_and_uncategorized_items() {
        let db = seeded();
        let staples: Vec<&str> = db
            .items
            .iter()
            .filter(|i| i.staple)
            .map(|i| i.name.as_str())
            .collect();
        for s in ["Salt", "Olive oil", "Garlic", "Black pepper"] {
            assert!(staples.contains(&s), "{s} should be a staple");
        }
        for (alias, name) in [
            ("Parmesan", "Parmigiano Reggiano"),
            ("Green onions", "Scallions"),
            ("coriander", "Cilantro"),
        ] {
            assert_eq!(db.item_by_name_or_alias_ci(alias).unwrap().name, name);
        }
        let uncategorized: Vec<&str> = db
            .items
            .iter()
            .filter(|i| i.category_id.is_none())
            .map(|i| i.name.as_str())
            .collect();
        assert_eq!(uncategorized, ["Taco seasoning", "Birthday candles"]);
        // BBQ sauce keeps its capitals; every recipe has a staple to cull except Weekly Staples.
        assert!(db.item_by_name_ci("BBQ sauce").is_some());
        for recipe in &db.recipes[..3] {
            let has_staple =
                (recipe.ingredients.iter()).any(|i| db.find_item(i.item_id).unwrap().staple);
            assert!(has_staple, "{}", recipe.name);
        }
    }

    #[test]
    fn items_spread_across_categories() {
        let db = seeded();
        let used: std::collections::HashSet<_> =
            db.items.iter().filter_map(|i| i.category_id).collect();
        assert_eq!(
            used.len(),
            DEFAULT_CATEGORIES.len(),
            "every category has an item"
        );
    }
}
