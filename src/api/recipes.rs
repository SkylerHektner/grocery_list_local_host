//! Recipes: `POST /api/recipes`, `PUT|DELETE /api/recipes/{id}`. Logic in `catalog.rs`.

use axum::Router;
use axum::extract::State;
use axum::routing::{post, put};
use serde::Deserialize;

use super::{Mutation, reply};
use crate::error::{ApiJson, ApiPath};
use crate::model::{Id, Ingredient};
use crate::store::{AppState, ListUndo};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/recipes", post(create))
        .route("/recipes/{id}", put(update).delete(remove))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewRecipe {
    name: String,
    #[serde(default)]
    ingredients: Vec<Ingredient>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecipeUpdate {
    name: String,
    ingredients: Vec<Ingredient>,
}

/// `POST /api/recipes {name, ingredients?: [{item_id, note?}]}` → id of the new recipe.
async fn create(State(app): State<AppState>, ApiJson(body): ApiJson<NewRecipe>) -> Mutation {
    app.mutate(|db| db.create_recipe(&body.name, &body.ingredients))
        .map(reply)
}

/// `PUT /api/recipes/{id} {name, ingredients}` → full replace; the list is untouched.
async fn update(
    State(app): State<AppState>,
    ApiPath(id): ApiPath<Id>,
    ApiJson(body): ApiJson<RecipeUpdate>,
) -> Mutation {
    app.mutate(|db| {
        db.update_recipe(id, &body.name, &body.ingredients)
            .map(|()| id)
    })
    .map(reply)
}

/// `DELETE /api/recipes/{id}` → strips it from the list (orphans become manual); clears list
/// undo, since older list states would reference the recipe.
async fn remove(State(app): State<AppState>, ApiPath(id): ApiPath<Id>) -> Mutation {
    app.mutate_with(ListUndo::Clear, |db| db.delete_recipe(id).map(|()| id))
        .map(reply)
}
