//! The grocery list: entries, recipe chips, clear, undo and the plain-text export. Logic in
//! `list.rs` and `export.rs`. Every list edit records the previous list for undo.

use axum::Router;
use axum::extract::State;
use axum::http::header;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use serde::Deserialize;

use super::{Mutation, reply, required_nullable};
use crate::error::{ApiJson, ApiPath};
use crate::export;
use crate::model::{Id, unix_now};
use crate::store::{AppState, ListUndo};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/list", delete(clear))
        .route("/list/items", post(add_item))
        .route("/list/items/{item_id}", put(set_note).delete(remove_item))
        .route("/list/recipes", post(add_recipe))
        .route("/list/recipes/{recipe_id}", delete(remove_recipe))
        .route("/list/undo", post(undo))
        .route("/list/export", get(export_text))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddItem {
    item_id: Id,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NoteBody {
    #[serde(deserialize_with = "required_nullable")]
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddRecipe {
    recipe_id: Id,
    item_ids: Vec<Id>,
}

/// `POST /api/list/items {item_id, note?}` → manual add (re-adding is fine); `id` = item.
async fn add_item(State(app): State<AppState>, ApiJson(body): ApiJson<AddItem>) -> Mutation {
    let id = body.item_id;
    app.mutate_with(ListUndo::Record, |db| {
        db.add_item_to_list(id, body.note.as_deref(), unix_now())
            .map(|()| id)
    })
    .map(reply)
}

/// `PUT /api/list/items/{item_id} {note}` → set or clear (`null`/`""`) the note.
async fn set_note(
    State(app): State<AppState>,
    ApiPath(id): ApiPath<Id>,
    ApiJson(body): ApiJson<NoteBody>,
) -> Mutation {
    app.mutate_with(ListUndo::Record, |db| {
        db.set_list_note(id, body.note.as_deref()).map(|()| id)
    })
    .map(reply)
}

/// `DELETE /api/list/items/{item_id}` → the entry leaves the list whatever its sources.
async fn remove_item(State(app): State<AppState>, ApiPath(id): ApiPath<Id>) -> Mutation {
    app.mutate_with(ListUndo::Record, |db| {
        db.remove_item_from_list(id).map(|()| id)
    })
    .map(reply)
}

/// `POST /api/list/recipes {recipe_id, item_ids}` → add the culled ingredients; `id` = recipe.
async fn add_recipe(State(app): State<AppState>, ApiJson(body): ApiJson<AddRecipe>) -> Mutation {
    let id = body.recipe_id;
    app.mutate_with(ListUndo::Record, |db| {
        db.add_recipe_to_list(id, &body.item_ids, unix_now())
            .map(|()| id)
    })
    .map(reply)
}

/// `DELETE /api/list/recipes/{recipe_id}` → remove the chip and what only it added.
async fn remove_recipe(State(app): State<AppState>, ApiPath(id): ApiPath<Id>) -> Mutation {
    app.mutate_with(ListUndo::Record, |db| {
        db.remove_recipe_from_list(id).map(|()| id)
    })
    .map(reply)
}

/// `DELETE /api/list` → empty the list (an already-empty list records no undo state).
async fn clear(State(app): State<AppState>) -> Mutation {
    app.mutate_with(ListUndo::Record, |db| {
        db.clear_list();
        Ok(None)
    })
    .map(reply)
}

/// `POST /api/list/undo` → restore the list before the last recorded list edit (409 if none).
async fn undo(State(app): State<AppState>) -> Mutation {
    app.undo_list().map(|state| reply((state, None)))
}

/// `GET /api/list/export` → the list as plain text (SPEC §3.6).
async fn export_text(State(app): State<AppState>) -> impl IntoResponse {
    let text = app.read(export::render);
    ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], text)
}
