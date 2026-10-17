//! Plain-text export of the list (SPEC §3.6), pasted into a notes app:
//!
//! ```text
//! PRODUCE
//! Bananas
//! Garlic
//!
//! DAIRY & EGGS
//! Eggs
//! Milk (2 gallons)
//! ```
//!
//! - One group per non-empty category, in walk order; the header is the category name
//!   uppercased. Groups are separated by one blank line.
//! - Within a group, items are sorted case-insensitively by name (Unicode lowercase, then code
//!   point order); a note is appended as ` (note)`. Recipe sources are not shown.
//! - Uncategorized items go last under `OTHER`, unless a category named "Other"
//!   (case-insensitive) exists: then they are sorted into that category's group instead.
//! - No trailing whitespace and no trailing newline; an empty list renders as `""`.

use std::collections::HashMap;

use crate::model::{Db, Id};
use crate::names;

/// Header of the group for uncategorized items when no "Other" category exists.
pub const OTHER_HEADER: &str = "OTHER";

/// Renders the list as export text (see the module docs).
pub fn render(db: &Db) -> String {
    let other = db.category_by_name_ci("Other").map(|c| c.id);
    // Group key: a category id, or None for the trailing OTHER group. Values: (sort key, line).
    let mut groups: HashMap<Option<Id>, Vec<(String, String)>> = HashMap::new();
    for entry in &db.list.entries {
        let Some(item) = db.items.iter().find(|i| i.id == entry.item_id) else {
            continue;
        };
        let category = item
            .category_id
            .filter(|&c| db.categories.iter().any(|cat| cat.id == c))
            .or(other);
        let line = match &entry.note {
            Some(note) => format!("{} ({note})", item.name),
            None => item.name.clone(),
        };
        groups
            .entry(category)
            .or_default()
            .push((names::fold(&item.name), line));
    }

    let mut out: Vec<String> = Vec::new();
    for category in &db.categories {
        if let Some(lines) = groups.remove(&Some(category.id)) {
            out.push(group(&category.name.to_uppercase(), lines));
        }
    }
    if let Some(lines) = groups.remove(&None) {
        out.push(group(OTHER_HEADER, lines));
    }
    out.join("\n\n")
}

fn group(header: &str, mut lines: Vec<(String, String)>) -> String {
    lines.sort();
    let mut text = header.to_string();
    for (_, line) in lines {
        text.push('\n');
        text.push_str(&line);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Category, Item, ListEntry, Source};

    /// A DB with the given categories (ids 1..) and items `(name, category index or None,
    /// note)`, all on the list in the given order.
    fn db(categories: &[&str], items: &[(&str, Option<usize>, Option<&str>)]) -> Db {
        let mut db = Db::empty();
        for name in categories {
            let id = db.alloc_id();
            db.categories.push(Category {
                id,
                name: name.to_string(),
            });
        }
        for (name, category, note) in items {
            let id = db.alloc_id();
            db.items.push(Item {
                id,
                name: name.to_string(),
                category_id: category.map(|i| db.categories[i].id),
                aliases: vec![],
                staple: false,
                use_count: 0,
                last_used: 0,
            });
            db.list.entries.push(ListEntry {
                item_id: id,
                note: note.map(String::from),
                sources: vec![Source::Manual],
                added_at: 0,
            });
        }
        assert_eq!(db.consistency_problems(), Vec::<String>::new());
        db
    }

    #[test]
    fn empty_list_is_empty_text() {
        assert_eq!(render(&db(&["Produce"], &[])), "");
        assert_eq!(render(&Db::with_default_categories()), "");
    }

    #[test]
    fn spec_example() {
        let db = db(
            &["Produce", "Bakery", "Dairy & Eggs"],
            &[
                ("Milk", Some(2), Some("2 gallons")),
                ("Garlic", Some(0), None),
                ("Eggs", Some(2), None),
                ("Bananas", Some(0), None),
            ],
        );
        assert_eq!(
            render(&db),
            "PRODUCE\nBananas\nGarlic\n\nDAIRY & EGGS\nEggs\nMilk (2 gallons)"
        );
    }

    #[test]
    fn groups_follow_walk_order_not_list_order() {
        let mut db = db(
            &["Produce", "Frozen", "Pantry"],
            &[
                ("Rice", Some(2), None),
                ("Peas", Some(1), None),
                ("Kale", Some(0), None),
            ],
        );
        assert_eq!(render(&db), "PRODUCE\nKale\n\nFROZEN\nPeas\n\nPANTRY\nRice");
        db.categories.reverse();
        assert_eq!(render(&db), "PANTRY\nRice\n\nFROZEN\nPeas\n\nPRODUCE\nKale");
    }

    #[test]
    fn items_sort_case_insensitively() {
        let db = db(
            &["Pantry"],
            &[
                ("Zucchini noodles", Some(0), None),
                ("BBQ sauce", Some(0), None),
                ("Apple butter", Some(0), None),
                ("Bay leaves", Some(0), None),
                ("Almonds", Some(0), Some("raw")),
            ],
        );
        assert_eq!(
            render(&db),
            "PANTRY\nAlmonds (raw)\nApple butter\nBay leaves\nBBQ sauce\nZucchini noodles"
        );
    }

    #[test]
    fn uncategorized_go_last_under_other() {
        let db = db(
            &["Produce", "Household"],
            &[
                ("Candles", None, Some("blue")),
                ("Paper towels", Some(1), None),
                ("Batteries", None, None),
                ("Kale", Some(0), None),
            ],
        );
        assert_eq!(
            render(&db),
            "PRODUCE\nKale\n\nHOUSEHOLD\nPaper towels\n\nOTHER\nBatteries\nCandles (blue)"
        );
        // Only uncategorized items.
        let only = db_only_uncategorized();
        assert_eq!(render(&only), "OTHER\nCandles");
    }

    fn db_only_uncategorized() -> Db {
        db(&["Produce"], &[("Candles", None, None)])
    }

    #[test]
    fn uncategorized_merge_into_an_other_category_in_its_walk_position() {
        let db = db(
            &["Produce", "OtHeR", "Household"],
            &[
                ("Zip ties", Some(1), None),
                ("Paper towels", Some(2), None),
                ("Candles", None, None),
                ("Kale", Some(0), None),
                ("Batteries", None, Some("AA")),
            ],
        );
        assert_eq!(
            render(&db),
            "PRODUCE\nKale\n\nOTHER\nBatteries (AA)\nCandles\nZip ties\n\nHOUSEHOLD\nPaper towels"
        );
    }

    #[test]
    fn empty_other_category_still_receives_uncategorized_items() {
        let db = db(&["Other", "Produce"], &[("Candles", None, None)]);
        assert_eq!(render(&db), "OTHER\nCandles");
        // ... and an "Other" category with nothing in it is omitted like any other.
        let db = db_with_items_in_produce_only();
        assert_eq!(render(&db), "PRODUCE\nKale");
    }

    fn db_with_items_in_produce_only() -> Db {
        db(&["Other", "Produce"], &[("Kale", Some(1), None)])
    }

    #[test]
    fn headers_uppercase_unicode_and_lines_have_no_trailing_whitespace() {
        let db = db(
            &["Crème & café"],
            &[("Crème fraîche", Some(0), Some("1 tub"))],
        );
        let text = render(&db);
        assert_eq!(text, "CRÈME & CAFÉ\nCrème fraîche (1 tub)");
        assert!(text.lines().all(|l| l == l.trim_end()));
        assert!(!text.ends_with('\n'));
    }

    #[test]
    fn recipe_sources_are_not_shown() {
        let mut db = db(&["Produce"], &[("Limes", Some(0), None)]);
        db.list.entries[0].sources = vec![Source::Recipe { recipe_id: 99 }];
        assert_eq!(render(&db), "PRODUCE\nLimes");
    }
}
