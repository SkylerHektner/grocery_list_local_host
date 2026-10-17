//! Scaffold-level tests for `app()`: health, JSON 404s under /api, static file serving.

mod common;

use axum::http::{Method, StatusCode};
use serde_json::json;

use common::{get, send};

/// A temp static dir with a known index.html, so tests never depend on `public/` contents.
fn static_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("index.html"),
        "<!doctype html><title>test index</title>",
    )
    .unwrap();
    std::fs::write(dir.path().join("app.js"), "export const x = 1;\n").unwrap();
    dir
}

#[tokio::test]
async fn health_returns_ok_and_version() {
    let dir = static_dir();
    let app = rust_html_server::app(dir.path());

    let res = get(&app, "/api/health").await;

    assert_eq!(res.status, StatusCode::OK);
    assert!(res.content_type().starts_with("application/json"));
    assert_eq!(res.json(), json!({ "ok": true, "version": 0 }));
}

#[tokio::test]
async fn unknown_api_routes_are_json_404() {
    let dir = static_dir();
    let app = rust_html_server::app(dir.path());

    for uri in ["/api/nope", "/api/nope/deeper", "/api", "/api/"] {
        let res = get(&app, uri).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{uri}");
        assert!(res.content_type().starts_with("application/json"), "{uri}");
        assert!(res.json()["error"].is_string(), "{uri}");
    }
}

#[tokio::test]
async fn wrong_method_on_api_route_is_json_405() {
    let dir = static_dir();
    let app = rust_html_server::app(dir.path());

    let res = send(&app, Method::POST, "/api/health", Some(json!({}))).await;

    assert_eq!(res.status, StatusCode::METHOD_NOT_ALLOWED);
    assert!(res.json()["error"].is_string());
}

#[tokio::test]
async fn root_serves_index_html() {
    let dir = static_dir();
    let app = rust_html_server::app(dir.path());

    let res = get(&app, "/").await;

    assert_eq!(res.status, StatusCode::OK);
    assert!(res.content_type().starts_with("text/html"));
    assert!(res.text().contains("test index"));
    assert_eq!(res.headers["cache-control"], "no-cache");
}

#[tokio::test]
async fn static_files_are_served_and_missing_ones_404() {
    let dir = static_dir();
    let app = rust_html_server::app(dir.path());

    let res = get(&app, "/app.js").await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(res.content_type().contains("javascript"));

    let res = get(&app, "/missing.css").await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn real_public_dir_has_index() {
    let public = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("public");
    let app = rust_html_server::app(&public);

    let res = get(&app, "/").await;

    assert_eq!(res.status, StatusCode::OK);
    assert!(res.text().contains("js/main.js"));
}
