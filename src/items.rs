use axum::{Json, extract::Path as AxumPath, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;
use crate::grocery_list::{delete_from_grocery_list_str, rename_item_in_grocery_list};
use crate::utils::format_name;
use crate::recipe::{any_recipe_contains_item, rename_item_in_recipes};

const ITEMS_FILE_PATH: &str = "data/items.ron";

// Categories

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

pub async fn get_categories() -> Json<Vec<Category>> {
    Json(Category::all())
}

// Items

#[derive(Deserialize, Serialize, Clone)]
pub struct Item {
    pub name: String,
    pub category: Category,
}

pub async fn get_items() -> Json<Vec<Item>> {
    let items: Vec<Item> = if Path::new(ITEMS_FILE_PATH).exists() {
        let content = fs::read_to_string(ITEMS_FILE_PATH)
            .await
            .unwrap_or_default();
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
    let formatted_name = format_name(&payload.name);

    let mut items: Vec<Item> = if Path::new(ITEMS_FILE_PATH).exists() {
        let content = fs::read_to_string(ITEMS_FILE_PATH)
            .await
            .unwrap_or_default();
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
        rename_item_in_recipes(&old_name, &formatted_name).await;
        rename_item_in_grocery_list(&old_name, &formatted_name).await;

        item.name = formatted_name.clone();
        item.category = payload.category;

        let pretty_config = ron::ser::PrettyConfig::default();
        let ron_string =
            ron::ser::to_string_pretty(&items, pretty_config).expect("Failed to serialize to RON");

        fs::write(ITEMS_FILE_PATH, ron_string)
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
    let mut items: Vec<Item> = if Path::new(ITEMS_FILE_PATH).exists() {
        let content = fs::read_to_string(ITEMS_FILE_PATH)
            .await
            .unwrap_or_default();
        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    };

    if any_recipe_contains_item(&name).await {
        return (
            StatusCode::CONFLICT,
            format!("Cannot delete '{}'. It is used in a recipe.", name),
        );
    }

    let initial_len = items.len();
    items.retain(|i| !i.name.eq_ignore_ascii_case(&name));

    if items.len() < initial_len {

        delete_from_grocery_list_str(&name).await;

        let pretty_config = ron::ser::PrettyConfig::default();
        let ron_string =
            ron::ser::to_string_pretty(&items, pretty_config).expect("Failed to serialize to RON");

        fs::write(ITEMS_FILE_PATH, ron_string)
            .await
            .expect("Failed to write to file");

        (StatusCode::OK, format!("Successfully deleted {}!", name))
    } else {
        (StatusCode::NOT_FOUND, format!("Item '{}' not found.", name))
    }
}

pub async fn add_item(Json(payload): Json<Item>) -> (StatusCode, String) {
    let formatted_name = format_name(&payload.name);

    // 1. Read the existing items from the file (if it exists)
    let mut items: Vec<Item> = if Path::new(ITEMS_FILE_PATH).exists() {
        let content = fs::read_to_string(ITEMS_FILE_PATH)
            .await
            .unwrap_or_default();
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
    fs::write(ITEMS_FILE_PATH, ron_string)
        .await
        .expect("Failed to write to file");

    (
        StatusCode::OK,
        format!("Successfully added {}!", formatted_name),
    )
}
