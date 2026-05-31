use axum::{Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

#[derive(Deserialize, Serialize, Clone)]
pub struct GroceryListPayload {
    pub name: String,
}

pub async fn get_grocery_list() -> Json<Vec<String>> {
    let file_path = "data/grocery_list.ron";

    let items: Vec<String> = if Path::new(file_path).exists() {
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

pub async fn add_to_grocery_list(Json(payload): Json<GroceryListPayload>) -> (StatusCode, String) {
    let file_path = "data/grocery_list.ron";

    let mut items: Vec<String> = if Path::new(file_path).exists() {
        let content = fs::read_to_string(file_path).await.unwrap_or_default();
        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    };

    if !items.iter().any(|item| item.eq_ignore_ascii_case(&payload.name)) {
        items.push(payload.name.clone());

        let pretty_config = ron::ser::PrettyConfig::default();
        let ron_string =
            ron::ser::to_string_pretty(&items, pretty_config).expect("Failed to serialize to RON");

        fs::write(file_path, ron_string)
            .await
            .expect("Failed to write to file");

        (StatusCode::OK, format!("Successfully added {} to grocery list!", payload.name))
    } else {
        (StatusCode::CONFLICT, format!("Item '{}' already in grocery list.", payload.name))
    }
}

pub async fn delete_grocery_list() -> (StatusCode, String) {
    let file_path = "data/grocery_list.ron";

    let items: Vec<String> = Vec::new();
    let pretty_config = ron::ser::PrettyConfig::default();
    let ron_string =
        ron::ser::to_string_pretty(&items, pretty_config).expect("Failed to serialize to RON");

    fs::write(file_path, ron_string)
        .await
        .expect("Failed to write to file");

    (StatusCode::OK, "Successfully cleared grocery list!".to_string())
}
