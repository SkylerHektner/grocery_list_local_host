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

#[tokio::test]
async fn static_files_never_escape_the_static_dir() {
    // <tmp>/secret.txt next to <tmp>/public/, which is what gets served.
    let root = tempfile::tempdir().expect("temp dir");
    let public = root.path().join("public");
    std::fs::create_dir_all(public.join("js")).unwrap();
    std::fs::write(
        public.join("index.html"),
        "<!doctype html><title>ok</title>",
    )
    .unwrap();
    std::fs::write(public.join("js").join("app.js"), "export {};\n").unwrap();
    std::fs::write(root.path().join("secret.txt"), "TOP SECRET").unwrap();
    let app = TestApp::with_static_dir(&public);

    assert_eq!(app.get("/js/app.js").await.status, StatusCode::OK);
    for uri in [
        "/../secret.txt",
        "/js/../../secret.txt",
        "/%2e%2e/secret.txt",
        "/%2E%2E/secret.txt",
        "/..%2fsecret.txt",
        "/..%2Fsecret.txt",
        "/js/..%2f..%2fsecret.txt",
        "/%2e%2e%2fsecret.txt",
        "/..%5csecret.txt",
        "/js/..%5c..%5csecret.txt",
        "/%2e%2e%5csecret.txt",
        "//secret.txt",
        "/%2f..%2fsecret.txt",
        "/js/%2e%2e/%2e%2e/secret.txt",
    ] {
        let res = app.get(uri).await;
        assert_ne!(res.status, StatusCode::OK, "{uri} was served");
        assert!(
            !String::from_utf8_lossy(&res.body).contains("TOP SECRET"),
            "{uri} leaked the file"
        );
    }
    // An absolute path smuggled in (Windows drive / UNC style) is refused too.
    let secret = root.path().join("secret.txt");
    let absolute = secret.to_string_lossy().replace('\\', "/");
    for uri in [format!("/{absolute}"), format!("/js/{absolute}")] {
        let res = app.get(&uri).await;
        assert_ne!(res.status, StatusCode::OK, "{uri} was served");
    }
}
