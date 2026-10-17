//! Scaffold-level tests for `app()`: JSON 404/405s under /api, static file serving.

mod common;

use axum::http::{Method, StatusCode};
use serde_json::json;

use common::TestApp;

#[tokio::test]
async fn unknown_api_routes_are_json_404() {
    let app = TestApp::new();

    for uri in ["/api/nope", "/api/nope/deeper", "/api", "/api/"] {
        let res = app.get(uri).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{uri}");
        assert!(res.content_type().starts_with("application/json"), "{uri}");
        assert!(res.error().starts_with("no API route for"), "{uri}");
    }
}

#[tokio::test]
async fn wrong_method_on_api_route_is_json_405() {
    let app = TestApp::new();

    for uri in ["/api/health", "/api/state", "/api/version"] {
        let res = app.send(Method::POST, uri, Some(json!({}))).await;
        assert_eq!(res.status, StatusCode::METHOD_NOT_ALLOWED, "{uri}");
        assert_eq!(res.error(), format!("method not allowed for {uri}"));
    }
}

#[tokio::test]
async fn root_serves_index_html() {
    let app = TestApp::new();

    let res = app.get("/").await;

    assert_eq!(res.status, StatusCode::OK);
    assert!(res.content_type().starts_with("text/html"));
    assert!(res.text().contains("test index"));
    assert_eq!(res.headers["cache-control"], "no-cache");
}

#[tokio::test]
async fn static_files_are_served_and_missing_ones_404() {
    let app = TestApp::new();

    let res = app.get("/app.js").await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(res.content_type().contains("javascript"));

    let res = app.get("/missing.css").await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn real_public_dir_has_index() {
    let public = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("public");
    let app = TestApp::with_static_dir(public);

    let res = app.get("/").await;

    assert_eq!(res.status, StatusCode::OK);
    assert!(res.text().contains("js/main.js"));
}
