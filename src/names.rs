//! Normalization and validation of names, aliases and notes (SPEC §2.3).
//!
//! Every name that reaches the DB goes through [`validate_name`] (or [`validate_aliases`]);
//! comparisons between names use [`same_name`] (case-insensitive, Unicode-aware).

use crate::error::ApiError;

/// Max length of a name or alias, in characters (not bytes), after normalization.
pub const MAX_NAME_CHARS: usize = 80;
/// Max length of a list-entry note, in characters, after normalization.
pub const MAX_NOTE_CHARS: usize = 80;

/// Trims, collapses every run of whitespace (incl. tabs, newlines, NBSP) to one space.
pub fn collapse_whitespace(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Name normalization: [`collapse_whitespace`], then uppercase the first character and leave the
/// rest as typed ("bBQ sauce" → "BBQ sauce"). A first character whose uppercase form is more than
/// one character (e.g. "ß" → "SS") is left unchanged. May return an empty string.
pub fn normalize_name(raw: &str) -> String {
    let collapsed = collapse_whitespace(raw);
    let mut chars = collapsed.chars();
    let Some(first) = chars.next() else {
        return collapsed;
    };
    let mut upper = first.to_uppercase();
    let first = match (upper.next(), upper.next()) {
        (Some(single), None) => single,
        _ => first,
    };
    let mut out = String::with_capacity(collapsed.len() + 2);
    out.push(first);
    out.push_str(chars.as_str());
    out
}

/// Normalizes `raw` and checks it is 1–80 characters with no control characters.
/// `what` names the field in error messages, e.g. `"item name"`, `"recipe name"`.
pub fn validate_name(raw: &str, what: &str) -> Result<String, ApiError> {
    let name = normalize_name(raw);
    if name.is_empty() {
        return Err(ApiError::bad_request(format!("{what} must not be empty")));
    }
    check_text(&name, what, MAX_NAME_CHARS)?;
    Ok(name)
}

/// Normalizes and validates an item's aliases: each must be a valid name; blanks are dropped
/// (so a trailing comma in "a, b," is harmless), as are case-insensitive duplicates and aliases
/// equal to the item's own (already normalized) `own_name`. Order is preserved.
///
/// Uniqueness against *other* items is checked by `Db::check_item_names`.
pub fn validate_aliases<S: AsRef<str>>(raw: &[S], own_name: &str) -> Result<Vec<String>, ApiError> {
    let mut out: Vec<String> = Vec::with_capacity(raw.len());
    for alias in raw {
        let alias = normalize_name(alias.as_ref());
        if alias.is_empty() {
            continue;
        }
        check_text(&alias, "alias", MAX_NAME_CHARS)?;
        if same_name(&alias, own_name) || out.iter().any(|a| same_name(a, &alias)) {
            continue;
        }
        out.push(alias);
    }
    Ok(out)
}

/// Note normalization: whitespace collapsed (so a note never spans lines in the export), max 80
/// characters, no control characters. `None`, empty and all-whitespace all mean "no note".
pub fn validate_note(raw: Option<&str>) -> Result<Option<String>, ApiError> {
    let note = collapse_whitespace(raw.unwrap_or(""));
    if note.is_empty() {
        return Ok(None);
    }
    check_text(&note, "note", MAX_NOTE_CHARS)?;
    Ok(Some(note))
}

/// Case-insensitive comparison key ("Crème" and "CRÈME" fold to the same key).
pub fn fold(name: &str) -> String {
    name.to_lowercase()
}

/// Case-insensitive name equality.
pub fn same_name(a: &str, b: &str) -> bool {
    a == b || fold(a) == fold(b)
}

fn check_text(text: &str, what: &str, max_chars: usize) -> Result<(), ApiError> {
    if text.chars().any(char::is_control) {
        return Err(ApiError::bad_request(format!(
            "{what} must not contain control characters"
        )));
    }
    let len = text.chars().count();
    if len > max_chars {
        return Err(ApiError::bad_request(format!(
            "{what} is too long ({len} characters, max {max_chars})"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err(result: Result<impl std::fmt::Debug, ApiError>) -> String {
        match result {
            Err(ApiError::BadRequest(msg)) => msg,
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn normalize_trims_and_collapses_whitespace() {
        assert_eq!(normalize_name("  green   onions \t"), "Green onions");
        assert_eq!(normalize_name("a\n\nb\r\nc"), "A b c");
        // NBSP and ideographic space are whitespace too.
        assert_eq!(
            normalize_name("\u{00A0}milk\u{3000}tea\u{00A0}"),
            "Milk tea"
        );
        assert_eq!(normalize_name("   "), "");
        assert_eq!(normalize_name(""), "");
    }

    #[test]
    fn normalize_uppercases_only_the_first_character() {
        assert_eq!(normalize_name("BBQ sauce"), "BBQ sauce");
        assert_eq!(normalize_name("bBQ sauce"), "BBQ sauce");
        assert_eq!(normalize_name("heavy Cream"), "Heavy Cream");
        assert_eq!(normalize_name("parmigiano reggiano"), "Parmigiano reggiano");
        assert_eq!(normalize_name("Already Fine"), "Already Fine");
    }

    #[test]
    fn normalize_handles_unicode_first_characters() {
        assert_eq!(normalize_name("éclair"), "Éclair");
        assert_eq!(normalize_name("ñame"), "Ñame");
        assert_eq!(normalize_name("øl"), "Øl");
        // "ß" uppercases to two characters ("SS"): left as typed.
        assert_eq!(normalize_name("ßtuff"), "ßtuff");
        // No case: unchanged.
        assert_eq!(normalize_name("2% milk"), "2% milk");
        assert_eq!(normalize_name("🍌 bananas"), "🍌 bananas");
        assert_eq!(normalize_name("豆腐"), "豆腐");
    }

    #[test]
    fn validate_name_accepts_and_normalizes() {
        assert_eq!(validate_name("  milk ", "item name").unwrap(), "Milk");
        assert_eq!(validate_name("x", "item name").unwrap(), "X");
    }

    #[test]
    fn validate_name_rejects_empty() {
        assert_eq!(
            err(validate_name("", "item name")),
            "item name must not be empty"
        );
        assert_eq!(
            err(validate_name(" \t\n ", "recipe name")),
            "recipe name must not be empty"
        );
    }

    #[test]
    fn validate_name_limit_is_80_chars_not_bytes() {
        let ascii80 = "a".repeat(80);
        assert_eq!(
            validate_name(&ascii80, "item name")
                .unwrap()
                .chars()
                .count(),
            80
        );
        let msg = err(validate_name(&"a".repeat(81), "item name"));
        assert_eq!(msg, "item name is too long (81 characters, max 80)");

        // 80 two-byte characters = 160 bytes: still fine.
        let accented = "é".repeat(80);
        assert_eq!(accented.len(), 160);
        assert!(validate_name(&accented, "item name").is_ok());
        // 80 four-byte emoji: fine; 81: too long.
        assert!(validate_name(&"🍎".repeat(80), "item name").is_ok());
        assert!(validate_name(&"🍎".repeat(81), "item name").is_err());
    }

    #[test]
    fn validate_name_measures_length_after_normalization() {
        let padded = format!("   {}   ", "a".repeat(80));
        assert!(validate_name(&padded, "item name").is_ok());
        let spaced = "a    ".repeat(40); // collapses to 79 chars
        assert_eq!(
            validate_name(&spaced, "item name").unwrap().chars().count(),
            79
        );
    }

    #[test]
    fn validate_name_rejects_control_characters() {
        let msg = err(validate_name("milk\u{0}", "item name"));
        assert_eq!(msg, "item name must not contain control characters");
        assert!(validate_name("bell\u{7}", "alias").is_err());
        assert!(validate_name("del\u{7f}", "alias").is_err());
    }

    #[test]
    fn notes_are_trimmed_collapsed_and_optional() {
        assert_eq!(validate_note(None).unwrap(), None);
        assert_eq!(validate_note(Some("")).unwrap(), None);
        assert_eq!(validate_note(Some("  \t\n ")).unwrap(), None);
        assert_eq!(
            validate_note(Some("  2 dozen ")).unwrap().as_deref(),
            Some("2 dozen")
        );
        // Not capitalized, unlike names.
        assert_eq!(
            validate_note(Some("ripe")).unwrap().as_deref(),
            Some("ripe")
        );
        assert_eq!(
            validate_note(Some("two\nlines")).unwrap().as_deref(),
            Some("two lines")
        );
    }

    #[test]
    fn notes_max_80_chars() {
        assert!(validate_note(Some(&"ü".repeat(80))).unwrap().is_some());
        let msg = err(validate_note(Some(&"n".repeat(81))));
        assert_eq!(msg, "note is too long (81 characters, max 80)");
        assert!(validate_note(Some("a\u{1b}b")).is_err());
    }

    #[test]
    fn aliases_are_normalized_deduped_and_blank_free() {
        let raw = [
            "parmesan",
            " PARMESAN ",
            "",
            "   ",
            "parmigiano reggiano",
            "Parmigiano",
        ];
        let aliases = validate_aliases(&raw, "Parmigiano Reggiano").unwrap();
        assert_eq!(aliases, vec!["Parmesan", "Parmigiano"]);
        assert_eq!(
            validate_aliases::<&str>(&[], "Milk").unwrap(),
            Vec::<String>::new()
        );
    }

    #[test]
    fn aliases_are_validated() {
        let long = "a".repeat(81);
        let msg = err(validate_aliases(&[long.as_str()], "Milk"));
        assert_eq!(msg, "alias is too long (81 characters, max 80)");
        assert!(validate_aliases(&["ok", "bad\u{0}"], "Milk").is_err());
    }

    #[test]
    fn same_name_is_case_insensitive_and_unicode_aware() {
        assert!(same_name("Milk", "milk"));
        assert!(same_name("Milk", "MILK"));
        assert!(same_name("Crème fraîche", "CRÈME FRAÎCHE"));
        assert!(same_name("Ελιές", "ελιές"));
        assert!(!same_name("Milk", "Milk 2%"));
        assert!(!same_name("Creme", "Crème"));
        assert_eq!(fold("Heavy Cream"), "heavy cream");
    }
}
