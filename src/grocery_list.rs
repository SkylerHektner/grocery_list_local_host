use axum::{Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

const GROCERY_LIST_FILE_PATH: &str = "data/grocery_list.ron";

#[derive(Deserialize, Serialize, Clone)]
pub struct GroceryListPayload {
    pub name: String,
}

#[derive(Deserialize)]
pub struct GroceryListBatchPayload {
    pub items: Vec<String>,
}

async fn load_grocery_list() -> Vec<String> {
    if Path::new(GROCERY_LIST_FILE_PATH).exists() {
        let content = fs::read_to_string(GROCERY_LIST_FILE_PATH)
            .await
            .unwrap_or_default();

        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    }
}

async fn save_grocery_list(items: &[String]) {
    let pretty_config = ron::ser::PrettyConfig::default();
    let ron_string =
        ron::ser::to_string_pretty(items, pretty_config).expect("Failed to serialize to RON");

    fs::write(GROCERY_LIST_FILE_PATH, ron_string)
        .await
        .expect("Failed to write to file");
}

pub async fn get_grocery_list() -> Json<Vec<String>> {
    Json(load_grocery_list().await)
}

pub async fn add_to_grocery_list(Json(payload): Json<GroceryListPayload>) -> (StatusCode, String) {
    let batch_payload = GroceryListBatchPayload {
        items: vec![payload.name],
    };
    add_items_to_grocery_list(Json(batch_payload)).await
}

pub async fn add_items_to_grocery_list(Json(payload): Json<GroceryListBatchPayload>) -> (StatusCode, String) {
    let mut items = load_grocery_list().await;
    let mut added = Vec::new();
    let mut duplicates = Vec::new();

    for name in payload.items {
        if !items
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&name))
        {
            items.push(name.clone());
            added.push(name);
        } else {
            duplicates.push(name);
        }
    }

    if added.is_empty() {
        (
            StatusCode::CONFLICT,
            format!("All items already in grocery list: {:?}", duplicates),
        )
    } else {
        save_grocery_list(&items).await;
        let message = if duplicates.is_empty() {
            format!("Successfully added {} items!", added.len())
        } else {
            format!("Added {} items. Skipped duplicates: {:?}", added.len(), duplicates)
        };
        (StatusCode::OK, message)
    }
}

pub async fn delete_from_grocery_list(
    Json(payload): Json<GroceryListPayload>,
) -> (StatusCode, String) {
    let batch_payload = GroceryListBatchPayload {
        items: vec![payload.name],
    };
    delete_items_from_grocery_list(Json(batch_payload)).await
}

pub async fn delete_items_from_grocery_list(Json(payload): Json<GroceryListBatchPayload>) -> (StatusCode, String) {
    let mut items = load_grocery_list().await;
    let mut removed = Vec::new();
    let mut not_found = Vec::new();

    for name in payload.items {
        let original_len = items.len();
        items.retain(|item| !item.eq_ignore_ascii_case(&name));

        if items.len() == original_len {
            not_found.push(name);
        } else {
            removed.push(name);
        }
    }

    if removed.is_empty() {
        (
            StatusCode::NOT_FOUND,
            format!("No items found: {:?}", not_found),
        )
    } else {
        save_grocery_list(&items).await;
        let message = if not_found.is_empty() {
            format!("Successfully removed {} items!", removed.len())
        } else {
            format!("Removed {} items. Not found: {:?}", removed.len(), not_found)
        };
        (StatusCode::OK, message)
    }
}

pub async fn delete_from_grocery_list_str(name: &str) -> (StatusCode, String) {
    let mut items = load_grocery_list().await;
    let original_len = items.len();

    items.retain(|item| !item.eq_ignore_ascii_case(name));

    if items.len() == original_len {
        (
            StatusCode::NOT_FOUND,
            format!("Item '{}' not found in grocery list.", name),
        )
    } else {
        save_grocery_list(&items).await;
        (
            StatusCode::OK,
            format!("Successfully removed {} from grocery list!", name),
        )
    }
}

pub async fn delete_grocery_list() -> (StatusCode, String) {
    let items: Vec<String> = Vec::new();
    save_grocery_list(&items).await;

    (
        StatusCode::OK,
        "Successfully cleared grocery list!".to_string(),
    )
}

pub async fn rename_item_in_grocery_list(old_name: &str, new_name: &str) {
    let mut items = load_grocery_list().await;
    let mut renamed = false;

    for item in items.iter_mut() {
        if item.eq_ignore_ascii_case(old_name) {
            *item = new_name.to_string();
            renamed = true;
            break;
        }
    }

    if renamed {
        save_grocery_list(&items).await;
    } 
}