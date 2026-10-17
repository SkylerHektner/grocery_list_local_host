//! Grocery list server. [`app`] builds the complete axum [`Router`]; `main.rs` serves it and the
//! integration tests in `tests/` drive it in-process with `tower::ServiceExt::oneshot`.

pub mod api;
pub mod catalog;
pub mod config;
pub mod demo;
pub mod error;
pub mod export;
pub mod list;
pub mod model;
pub mod names;
pub mod store;

use std::path::Path;

use axum::Router;
use axum::http::{HeaderValue, header};
use axum::middleware::map_response;
use axum::response::Response;
use axum::routing::any;
use tower_http::services::ServeDir;

pub use config::AppConfig;
pub use error::{ApiError, ApiJson, ApiPath};
pub use store::AppState;

/// Builds the app around an opened store: JSON API under `/api`, static files from `static_dir`
/// for every other path (`/` serves `index.html`). Unknown `/api/*` paths get a JSON 404, never
/// the static fallback.
pub fn app(state: AppState, static_dir: impl AsRef<Path>) -> Router {
    Router::new()
        .nest("/api", api::router())
        // `nest` covers `/api` and `/api/x…` but not the bare `/api/`.
        .route("/api/", any(api::not_found))
        .fallback_service(ServeDir::new(static_dir.as_ref()))
        .layer(map_response(default_no_cache))
        .with_state(state)
}

/// Static files are edited live during development, and API responses must always be fresh,
/// so tell browsers to revalidate everything (ServeDir still answers 304 when unchanged).
async fn default_no_cache(mut res: Response) -> Response {
    res.headers_mut()
        .entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("no-cache"));
    res
}
