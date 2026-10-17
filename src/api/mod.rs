//! JSON API mounted at `/api` (SPEC §4). One module per resource, each contributing routes here.

mod meta;

use axum::Json;
use axum::Router;
use axum::extract::OriginalUri;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::json;

/// All `/api` routes. Paths here are relative to `/api`.
///
/// T2/T3: add state (`Router<AppState>`) and merge one router per resource module
/// (categories, items, recipes, list) into `routes`. Keep the two fallbacks LAST: axum applies
/// `method_not_allowed_fallback` only to routes registered before it.
pub fn router() -> Router {
    let routes = Router::new().route("/health", get(meta::health));

    routes
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
}

/// `{"error": msg}` with the given status. T2 replaces this with `error::ApiError`.
pub(crate) fn json_error(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

pub(crate) async fn not_found(OriginalUri(uri): OriginalUri) -> Response {
    json_error(
        StatusCode::NOT_FOUND,
        format!("no API route for {}", uri.path()),
    )
}

async fn method_not_allowed(OriginalUri(uri): OriginalUri) -> Response {
    json_error(
        StatusCode::METHOD_NOT_ALLOWED,
        format!("method not allowed for {}", uri.path()),
    )
}
