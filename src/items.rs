use axum::{Json, extract::Path as AxumPath, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

#[derive(Deserialize, Serialize, Clone, Debug)]
pub enum Category {
    Dairy,
    Meat,
    Produce,
    Bakery,
    Shelf,
    Artisan,
    Frozen,
    Other,
}

impl Category {
    pub fn all() -> Vec<Category> {
        vec![
            Category::Dairy,
            Category::Meat,
            Category::Produce,
            Category::Bakery,
            Category::Shelf,
            Category::Artisan,
            Category::Frozen,
            Category::Other,
        ]
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Item {
    pub name: String,
    pub category: Category,
}

fn format_item_name(name: &str) -> String {
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

pub async fn get_items() -> Json<Vec<Item>> {
    let file_path = "data/items.ron";

    let items: Vec<Item> = if Path::new(file_path).exists() {
        let content = fs::read_to_string(file_path).await.unwrap_or_default();
        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    };

    Json(items)
}

pub async fn update_item(
    AxumPath(old_name): AxumPath<String>,
    Json(payload): Json<Item>,
) -> (StatusCode, String) {
    let file_path = "data/items.ron";
    let formatted_name = format_item_name(&payload.name);

    let mut items: Vec<Item> = if Path::new(file_path).exists() {
        let content = fs::read_to_string(file_path).await.unwrap_or_default();
        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    };

    if let Some(item) = items
        .iter_mut()
        .find(|i| i.name.eq_ignore_ascii_case(&old_name))
    {
        item.name = formatted_name.clone();
        item.category = payload.category;

        let pretty_config = ron::ser::PrettyConfig::default();
        let ron_string =
            ron::ser::to_string_pretty(&items, pretty_config).expect("Failed to serialize to RON");

        fs::write(file_path, ron_string)
            .await
            .expect("Failed to write to file");

        (
            StatusCode::OK,
            format!("Successfully updated {}!", formatted_name),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            format!("Item '{}' not found.", old_name),
        )
    }
}

pub async fn delete_item(AxumPath(name): AxumPath<String>) -> (StatusCode, String) {
    let file_path = "data/items.ron";

    let mut items: Vec<Item> = if Path::new(file_path).exists() {
        let content = fs::read_to_string(file_path).await.unwrap_or_default();
        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    };

    let initial_len = items.len();
    items.retain(|i| !i.name.eq_ignore_ascii_case(&name));

    if items.len() < initial_len {
        let pretty_config = ron::ser::PrettyConfig::default();
        let ron_string =
            ron::ser::to_string_pretty(&items, pretty_config).expect("Failed to serialize to RON");

        fs::write(file_path, ron_string)
            .await
            .expect("Failed to write to file");

        (StatusCode::OK, format!("Successfully deleted {}!", name))
    } else {
        (StatusCode::NOT_FOUND, format!("Item '{}' not found.", name))
    }
}

pub async fn add_item(Json(payload): Json<Item>) -> (StatusCode, String) {
    let file_path = "data/items.ron";
    let formatted_name = format_item_name(&payload.name);

    // 1. Read the existing items from the file (if it exists)
    let mut items: Vec<Item> = if Path::new(file_path).exists() {
        let content = fs::read_to_string(file_path).await.unwrap_or_default();
        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    };

    // 2. Check for duplicate
    if items
        .iter()
        .any(|item| item.name.eq_ignore_ascii_case(&formatted_name))
    {
        return (
            StatusCode::CONFLICT,
            format!("Item '{}' already exists.", formatted_name),
        );
    }

    // 3. Add the new item
    let mut new_item = payload.clone();
    new_item.name = formatted_name.clone();
    items.push(new_item);

    // 4. Serialize back to RON format with nice indentation
    let pretty_config = ron::ser::PrettyConfig::default();
    let ron_string =
        ron::ser::to_string_pretty(&items, pretty_config).expect("Failed to serialize to RON");

    // 5. Save the file
    fs::write(file_path, ron_string)
        .await
        .expect("Failed to write to file");

    (
        StatusCode::OK,
        format!("Successfully added {}!", formatted_name),
    )
}
