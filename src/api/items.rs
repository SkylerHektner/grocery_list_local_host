//! Items catalog: `POST /api/items`, `PUT|DELETE /api/items/{id}`,
//! `POST /api/items/{id}/merge`. Logic in `catalog.rs`.

use axum::Router;
use axum::extract::State;
use axum::routing::{post, put};
use serde::Deserialize;

use super::{Mutation, reply, required_nullable};
use crate::catalog::ItemFields;
use crate::error::{ApiJson, ApiPath};
use crate::model::Id;
use crate::store::{AppState, ListUndo};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/items", post(create))
        .route("/items/{id}", put(update).delete(remove))
        .route("/items/{id}/merge", post(merge))
}

/// `POST` body: only `name` is required.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewItem {
    name: String,
    #[serde(default)]
    category_id: Option<Id>,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    staple: bool,
}

/// `PUT` body: a full replace, so every field is required (`category_id` may be `null`).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ItemUpdate {
    name: String,
    #[serde(deserialize_with = "required_nullable")]
    category_id: Option<Id>,
    aliases: Vec<String>,
    staple: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MergeBody {
    into_id: Id,
}

/// `POST /api/items {name, category_id?, aliases?, staple?}` → id of the new item.
async fn create(State(app): State<AppState>, ApiJson(body): ApiJson<NewItem>) -> Mutation {
    let fields = ItemFields {
        name: body.name,
        category_id: body.category_id,
        aliases: body.aliases,
        staple: body.staple,
    };
    app.mutate(|db| db.create_item(fields)).map(reply)
}

/// `PUT /api/items/{id} {name, category_id, aliases, staple}`.
async fn update(
    State(app): State<AppState>,
    ApiPath(id): ApiPath<Id>,
    ApiJson(body): ApiJson<ItemUpdate>,
) -> Mutation {
    let fields = ItemFields {
        name: body.name,
        category_id: body.category_id,
        aliases: body.aliases,
        staple: body.staple,
    };
    app.mutate(|db| db.update_item(id, fields).map(|()| id))
        .map(reply)
}

/// `DELETE /api/items/{id}` → cascades out of recipes and the list; clears list undo.
async fn remove(State(app): State<AppState>, ApiPath(id): ApiPath<Id>) -> Mutation {
    app.mutate_with(ListUndo::Clear, |db| db.delete_item(id).map(|()| id))
        .map(reply)
}

/// `POST /api/items/{id}/merge {into_id}` → `id` = `into_id`; clears list undo.
async fn merge(
    State(app): State<AppState>,
    ApiPath(id): ApiPath<Id>,
    ApiJson(body): ApiJson<MergeBody>,
) -> Mutation {
    let into_id = body.into_id;
    app.mutate_with(ListUndo::Clear, |db| {
        db.merge_item(id, into_id).map(|()| into_id)
    })
    .map(reply)
}
