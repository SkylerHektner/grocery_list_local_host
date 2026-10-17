//! Categories (the store walk): `POST /api/categories`, `PUT /api/categories/order`,
//! `PUT|DELETE /api/categories/{id}`. Logic in `catalog.rs`.

use axum::Router;
use axum::extract::State;
use axum::routing::{post, put};
use serde::Deserialize;

use super::{Mutation, reply};
use crate::error::{ApiJson, ApiPath};
use crate::model::Id;
use crate::store::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/categories", post(create))
        // Static segment: matched before `{id}`.
        .route("/categories/order", put(reorder))
        .route("/categories/{id}", put(rename).delete(remove))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NameBody {
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OrderBody {
    ids: Vec<Id>,
}

/// `POST /api/categories {name}` → id of the new category (appended to the walk).
async fn create(State(app): State<AppState>, ApiJson(body): ApiJson<NameBody>) -> Mutation {
    app.mutate(|db| db.create_category(&body.name)).map(reply)
}

/// `PUT /api/categories/{id} {name}` → rename.
async fn rename(
    State(app): State<AppState>,
    ApiPath(id): ApiPath<Id>,
    ApiJson(body): ApiJson<NameBody>,
) -> Mutation {
    app.mutate(|db| db.rename_category(id, &body.name).map(|()| id))
        .map(reply)
}

/// `DELETE /api/categories/{id}` → its items become Uncategorized.
async fn remove(State(app): State<AppState>, ApiPath(id): ApiPath<Id>) -> Mutation {
    app.mutate(|db| db.delete_category(id).map(|()| id))
        .map(reply)
}

/// `PUT /api/categories/order {ids}` → new walk order (a permutation of all ids).
async fn reorder(State(app): State<AppState>, ApiJson(body): ApiJson<OrderBody>) -> Mutation {
    app.mutate(|db| db.reorder_categories(&body.ids).map(|()| None))
        .map(reply)
}
