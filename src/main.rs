use axum::{Json, Router, http::StatusCode, routing::get};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::Path;
use tokio::fs;
use tower_http::services::ServeDir;

#[derive(Deserialize, Serialize, Clone, Debug)]
enum Category {
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
    fn all() -> Vec<Category> {
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
struct Item {
    name: String,
    category: Category,
}

#[tokio::main]
async fn main() {
    // Ensure the data directory exists
    if !Path::new("data").exists() {
        fs::create_dir("data").await.unwrap();
    }

    // Set up our router. We have an API endpoint and the static fallback.
    let app = Router::new()
        .route("/api/items", get(get_items).post(add_item))
        .route("/api/categories", get(get_categories))
        .fallback_service(ServeDir::new("public"));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn get_categories() -> Json<Vec<Category>> {
    Json(Category::all())
}

async fn get_items() -> Json<Vec<Item>> {
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

async fn add_item(Json(payload): Json<Item>) -> (StatusCode, String) {
    let file_path = "data/items.ron";

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
        .any(|item| item.name.eq_ignore_ascii_case(&payload.name))
    {
        return (
            StatusCode::CONFLICT,
            format!("Item '{}' already exists.", payload.name),
        );
    }

    // 3. Add the new item
    items.push(payload.clone());

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
        format!("Successfully added {}!", payload.name),
    )
}
