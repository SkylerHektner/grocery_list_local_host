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

#[derive(Deserialize)]
pub struct DeleteRecipePayload {
    pub name: String,
}

#[derive(Deserialize)]
pub struct EditRecipePayload {
    pub old_name: String,
    pub new_name: String,
    pub items: Vec<String>,
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

pub async fn any_recipe_contains_item(item_name: &str) -> bool {
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

    for recipe in recipes {
        for item in recipe.items {
            if item.eq_ignore_ascii_case(item_name) {
                return true;
            }
        }
    }

    false
}

pub async fn delete_recipe(Json(payload): Json<DeleteRecipePayload>) -> (StatusCode, String) {
    let formatted_name = format_name(&payload.name);

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

    let original_len = recipes.len();
    recipes.retain(|recipe| !recipe.name.eq_ignore_ascii_case(&formatted_name));

    if recipes.len() == original_len {
        return (
            StatusCode::NOT_FOUND,
            format!("Recipe '{}' not found.", formatted_name),
        );
    }

    let pretty_config = ron::ser::PrettyConfig::default();
    let ron_string =
        ron::ser::to_string_pretty(&recipes, pretty_config).expect("Failed to serialize to RON");

    fs::write(RECIPES_FILE_PATH, ron_string)
        .await
        .expect("Failed to write to file");

    (
        StatusCode::OK,
        format!("Successfully deleted {}!", formatted_name),
    )
}

pub async fn edit_recipe(Json(payload): Json<EditRecipePayload>) -> (StatusCode, String) {
    let formatted_old_name = format_name(&payload.old_name);
    let formatted_new_name = format_name(&payload.new_name);

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

    let recipe_pos = recipes
        .iter()
        .position(|recipe| recipe.name.eq_ignore_ascii_case(&formatted_old_name));

    if recipe_pos.is_none() {
        return (
            StatusCode::NOT_FOUND,
            format!("Recipe '{}' not found.", formatted_old_name),
        );
    }

    if formatted_old_name != formatted_new_name
        && recipes
            .iter()
            .any(|recipe| recipe.name.eq_ignore_ascii_case(&formatted_new_name))
    {
        return (
            StatusCode::CONFLICT,
            format!("Recipe '{}' already exists.", formatted_new_name),
        );
    }

    let pos = recipe_pos.unwrap();
    recipes[pos].name = formatted_new_name;
    recipes[pos].items = payload.items;

    let pretty_config = ron::ser::PrettyConfig::default();
    let ron_string =
        ron::ser::to_string_pretty(&recipes, pretty_config).expect("Failed to serialize to RON");

    fs::write(RECIPES_FILE_PATH, ron_string)
        .await
        .expect("Failed to write to file");

    (
        StatusCode::OK,
        format!("Successfully updated recipe!"),
    )
}

pub async fn rename_item_in_recipes(old_item_name: &str, new_item_name: &str) {
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

    let mut item_found = false;

    for recipe in &mut recipes {
        for item in &mut recipe.items {
            if item.eq_ignore_ascii_case(old_item_name) {
                *item = new_item_name.to_string();
                item_found = true;
            }
        }
    }

    if item_found {
        let pretty_config = ron::ser::PrettyConfig::default();
        let ron_string =
            ron::ser::to_string_pretty(&recipes, pretty_config).expect("Failed to serialize to RON");

        fs::write(RECIPES_FILE_PATH, ron_string)
            .await
            .expect("Failed to write to file");
    }
}