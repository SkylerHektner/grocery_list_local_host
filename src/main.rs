mod grocery_list;
mod items;
mod recipe;
mod utils;

use axum::{
    Router,
    routing::{get, patch, post},
};
use grocery_list::{
    add_to_grocery_list, add_items_to_grocery_list, delete_from_grocery_list, 
    delete_items_from_grocery_list, delete_grocery_list, get_grocery_list,
};
use items::{add_item, delete_item, get_categories, get_items, update_item};
use recipe::{add_recipe, get_recipes, delete_recipe, edit_recipe};
use std::net::SocketAddr;
use std::path::Path;
use tokio::fs;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    // Ensure the data directory exists
    if !Path::new("data").exists() {
        fs::create_dir("data").await.unwrap();
    }

    // Set up our router. We have an API endpoint and the static fallback.
    let app = Router::new()
        .route("/api/items", get(get_items).post(add_item))
        .route("/api/items/{name}", patch(update_item).delete(delete_item))
        .route("/api/categories", get(get_categories))
        .route(
            "/api/grocery_list",
            get(get_grocery_list)
                .post(add_to_grocery_list)
                .delete(delete_grocery_list),
        )
        .route("/api/grocery_list/batch", post(add_items_to_grocery_list))
        .route("/api/grocery_list/delete", post(delete_from_grocery_list))
        .route("/api/grocery_list/batch/delete", post(delete_items_from_grocery_list))
        .route("/api/recipes", post(add_recipe).get(get_recipes))
        .route("/api/recipes/delete", post(delete_recipe))
        .route("/api/recipes/edit", patch(edit_recipe))
        .fallback_service(ServeDir::new("public"));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
