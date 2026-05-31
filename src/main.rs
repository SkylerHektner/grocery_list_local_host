use axum::{Json, Router, routing::post};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::Path;
use tokio::fs;
use tower_http::services::ServeDir;

#[derive(Deserialize, Serialize)]
struct NewName {
    name: String,
}

#[tokio::main]
async fn main() {
    // Ensure the data directory exists
    if !Path::new("data").exists() {
        fs::create_dir("data").await.unwrap();
    }

    // Set up our router. We have an API endpoint and the static fallback.
    let app = Router::new()
        .route("/api/names", post(add_name))
        .fallback_service(ServeDir::new("public"));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn add_name(Json(payload): Json<NewName>) -> String {
    let file_path = "data/names.ron";

    // 1. Read the existing names from the file (if it exists)
    let mut names: Vec<String> = if Path::new(file_path).exists() {
        let content = fs::read_to_string(file_path).await.unwrap_or_default();
        if content.is_empty() {
            Vec::new()
        } else {
            ron::from_str(&content).unwrap_or_else(|_| Vec::new())
        }
    } else {
        Vec::new()
    };

    // 2. Add the new name
    names.push(payload.name.clone());

    // 3. Serialize back to RON format with nice indentation
    let pretty_config = ron::ser::PrettyConfig::default();
    let ron_string =
        ron::ser::to_string_pretty(&names, pretty_config).expect("Failed to serialize to RON");

    // 4. Save the file
    fs::write(file_path, ron_string)
        .await
        .expect("Failed to write to file");

    format!("Successfully added {}!", payload.name)
}
