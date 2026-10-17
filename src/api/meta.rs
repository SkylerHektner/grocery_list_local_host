//! Meta endpoints: health (and, from T2, `GET /api/state` and `GET /api/version`).

use axum::Json;
use serde_json::{Value, json};

/// `GET /api/health` → `{"ok": true, "version": <db version>}`.
///
/// T2 seam: take `State<AppState>` and report the store's real `version`; until then it is 0.
pub async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "version": 0 }))
}
