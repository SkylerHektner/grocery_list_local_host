//! Meta endpoints: `GET /api/health`, `GET /api/state`, `GET /api/version`.

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::routing::get;
use serde_json::{Value, json};

use crate::model::Snapshot;
use crate::store::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/state", get(state))
        .route("/version", get(version))
}

/// `GET /api/health` → `{"ok": true, "version": <db version>}`.
async fn health(State(app): State<AppState>) -> Json<Value> {
    Json(json!({ "ok": true, "version": app.version() }))
}

/// `GET /api/state` → the full [`Snapshot`].
async fn state(State(app): State<AppState>) -> Json<Snapshot> {
    Json(app.snapshot())
}

/// `GET /api/version` → `{"version": <db version>}`: the cheap live-sync poll.
async fn version(State(app): State<AppState>) -> Json<Value> {
    Json(json!({ "version": app.version() }))
}
