// strips underscores, hyphens, and periods from a name and capitalizes the first letter of each word
pub fn format_name(name: &str) -> String {
    let mut cleaned = String::new();
    for c in name.chars() {
        if c == '_' || c == '-' || c == '.' {
            cleaned.push(' ');
        } else if c.is_alphanumeric() || c == ' ' {
            cleaned.push(c);
        }
    }

    cleaned
        .split_whitespace()
        .map(|word| {
            let mut c = word.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}