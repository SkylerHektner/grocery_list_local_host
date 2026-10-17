//! JSON API mounted at `/api` (SPEC §4). One module per resource, each exposing
//! `routes() -> Router<AppState>` that is merged here.

mod meta;

use axum::Router;
use axum::extract::OriginalUri;

use crate::error::ApiError;
use crate::store::AppState;

/// All `/api` routes. Paths here are relative to `/api`.
///
/// T3: merge one router per resource module (categories, items, recipes, list) into `routes`.
/// Keep the two fallbacks LAST: axum applies `method_not_allowed_fallback` only to routes
/// registered before it.
pub fn router() -> Router<AppState> {
    let routes = Router::new().merge(meta::routes());

    routes
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
}

pub(crate) async fn not_found(OriginalUri(uri): OriginalUri) -> ApiError {
    ApiError::not_found(format!("no API route for {}", uri.path()))
}

async fn method_not_allowed(OriginalUri(uri): OriginalUri) -> ApiError {
    ApiError::MethodNotAllowed(format!("method not allowed for {}", uri.path()))
}
