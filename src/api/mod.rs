//! JSON API mounted at `/api` (SPEC §4, reference in `docs/API.md`). One module per resource,
//! each exposing `routes() -> Router<AppState>` that is merged here. Handlers are thin: extract,
//! call a `Db` function (`catalog.rs`, `list.rs`) inside `AppState::mutate`, reply.

mod categories;
mod items;
mod list;
mod meta;
mod recipes;

use axum::extract::OriginalUri;
use axum::{Json, Router};
use serde::{Deserialize, Deserializer};

use crate::error::ApiError;
use crate::model::{Id, MutationResponse, Snapshot};
use crate::store::AppState;

/// All `/api` routes. Paths here are relative to `/api`.
///
/// Keep the two fallbacks LAST: axum applies `method_not_allowed_fallback` only to routes
/// registered before it.
pub fn router() -> Router<AppState> {
    let routes = Router::new()
        .merge(meta::routes())
        .merge(categories::routes())
        .merge(items::routes())
        .merge(recipes::routes())
        .merge(list::routes());

    routes
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
}

/// What every mutation handler returns: `{"state": Snapshot, "id": ...}` or an error.
type Mutation = Result<Json<MutationResponse>, ApiError>;

/// Maps `AppState::mutate`'s `(snapshot, id)` to the response body.
fn reply<I: Into<Option<Id>>>((state, id): (Snapshot, I)) -> Json<MutationResponse> {
    Json(MutationResponse::new(state, id))
}

/// For `Option` body fields that must be present but may be `null` (serde treats a missing
/// `Option` field as `None` unless `deserialize_with` is set).
fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub(crate) async fn not_found(OriginalUri(uri): OriginalUri) -> ApiError {
    ApiError::not_found(format!("no API route for {}", uri.path()))
}

async fn method_not_allowed(OriginalUri(uri): OriginalUri) -> ApiError {
    ApiError::MethodNotAllowed(format!("method not allowed for {}", uri.path()))
}
