// TODO Add recipe
// TODO delete recipe
// TODO edit recipe

use std::path::Path;
use axum::{Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use crate::utils::format_name;
use tokio::fs;

const RECIPES_FILE_PATH: &str = "data/recipes.ron";


#[derive(Deserialize, Serialize, Clone)]
pub struct Recipe {
    name: String,
    items: Vec<String>
}

pub async fn add_recipe(Json(payload): Json<Recipe>) -> (StatusCode, String) {
    let formatted_name = format_name(&payload.name);

    // 1. Read the existing recipes from the file (if it exists)
    let mut recipes: Vec<Recipe> = if Path::new(RECIPES_FILE_PATH).exists() {
        let content = fs::read_to_string(RECIPES_FILE_PATH)
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
    if recipes
        .iter()
        .any(|recipe| recipe.name.eq_ignore_ascii_case(&formatted_name))
    {
        return (
            StatusCode::CONFLICT,
            format!("Recipe '{}' already exists.", formatted_name),
        );
    }

    // 3. Add the new recipe
    let mut new_recipe = payload.clone();
    new_recipe.name = formatted_name.clone();
    recipes.push(new_recipe);

    // 4. Serialize back to RON format with nice indentation
    let pretty_config = ron::ser::PrettyConfig::default();
    let ron_string =
        ron::ser::to_string_pretty(&recipes, pretty_config).expect("Failed to serialize to RON");

    // 5. Save the file
    fs::write(RECIPES_FILE_PATH, ron_string)
        .await
        .expect("Failed to write to file");

    (
        StatusCode::OK,
        format!("Successfully added {}!", formatted_name),
    )
}

pub async fn get_recipes() -> Json<Vec<Recipe>> {
    let recipes: Vec<Recipe> = if Path::new(RECIPES_FILE_PATH).exists() {
        let content = fs::read_to_string(RECIPES_FILE_PATH)
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

    Json(recipes)
}