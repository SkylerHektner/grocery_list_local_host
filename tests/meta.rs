//! `GET /api/health`, `GET /api/state`, `GET /api/version`.

mod common;

use axum::http::StatusCode;
use rust_html_server::demo;
use rust_html_server::model::{DEFAULT_CATEGORIES, Item, ListEntry, Snapshot, Source};
use serde_json::json;

use common::TestApp;

/// Adds an item and puts it on the list straight through the store (fixed usage stats and
/// timestamps, which the API would set to "now").
fn add_to_list(app: &TestApp, name: &str) -> u64 {
    let (_, id) = app
        .state
        .mutate(|db| {
            let id = db.alloc_id();
            db.items.push(Item {
                id,
                name: name.to_string(),
                category_id: Some(1),
                aliases: vec![],
                staple: false,
                use_count: 1,
                last_used: 1_760_650_000,
            });
            db.list.entries.push(ListEntry {
                item_id: id,
                note: Some("ripe".into()),
                sources: vec![Source::Manual],
                added_at: 1_760_650_000,
            });
            Ok(id)
        })
        .unwrap();
    id
}

#[tokio::test]
async fn health_returns_ok_and_db_version() {
    let app = TestApp::new();

    let res = app.get("/api/health").await;

    assert_eq!(res.status, StatusCode::OK);
    assert!(res.content_type().starts_with("application/json"));
    assert_eq!(res.json(), json!({ "ok": true, "version": 0 }));

    add_to_list(&app, "Bananas");
    assert_eq!(
        app.get("/api/health").await.json(),
        json!({ "ok": true, "version": 1 })
    );
}

#[tokio::test]
async fn version_is_cheap_poll_that_tracks_mutations() {
    let app = TestApp::new();

    let res = app.get("/api/version").await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json(), json!({ "version": 0 }));
    assert_eq!(res.headers["cache-control"], "no-cache");

    add_to_list(&app, "Bananas");
    add_to_list(&app, "Milk");
    assert_eq!(
        app.get("/api/version").await.json(),
        json!({ "version": 2 })
    );
}

#[tokio::test]
async fn state_of_a_fresh_db_has_default_categories_only() {
    let app = TestApp::new();

    let res = app.get("/api/state").await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.headers["cache-control"], "no-cache");
    let body = res.json();
    let categories: Vec<_> = DEFAULT_CATEGORIES
        .iter()
        .zip(1..)
        .map(|(name, id)| json!({ "id": id, "name": name }))
        .collect();
    assert_eq!(
        body,
        json!({
            "version": 0,
            "categories": categories,
            "items": [],
            "recipes": [],
            "list": { "entries": [], "recipe_ids": [] }
        })
    );
    app.assert_consistent();
}

#[tokio::test]
async fn state_has_the_documented_shape() {
    let app = TestApp::new();
    let id = add_to_list(&app, "Bananas");

    let body = app.get("/api/state").await.json();

    assert_eq!(body["version"], 1);
    assert!(body.get("schema_version").is_none());
    assert!(body.get("next_id").is_none());
    assert_eq!(
        body["items"][0],
        json!({
            "id": id, "name": "Bananas", "category_id": 1, "aliases": [], "staple": false,
            "use_count": 1, "last_used": 1_760_650_000
        })
    );
    assert_eq!(
        body["list"],
        json!({
            "entries": [{
                "item_id": id, "note": "ripe", "sources": [{ "kind": "manual" }],
                "added_at": 1_760_650_000
            }],
            "recipe_ids": []
        })
    );
    // It is exactly the store's snapshot.
    let parsed: Snapshot = serde_json::from_value(body).unwrap();
    assert_eq!(parsed, app.state.snapshot());
}

#[tokio::test]
async fn state_of_a_demo_db_has_the_demo_catalog() {
    let app = TestApp::demo();

    let snapshot: Snapshot = serde_json::from_value(app.get("/api/state").await.json()).unwrap();

    assert_eq!(snapshot.version, 0);
    assert_eq!(snapshot.categories.len(), DEFAULT_CATEGORIES.len());
    assert_eq!(snapshot.items.len(), demo::ITEMS.len());
    let recipes: Vec<&str> = snapshot.recipes.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(
        recipes,
        ["Tacos", "Spaghetti Carbonara", "Stir Fry", "Weekly Staples"]
    );
    assert!(snapshot.list.entries.is_empty());
    let parm = app.item_id("Parmigiano Reggiano");
    let carbonara = app.recipe_id("Spaghetti Carbonara");
    assert!(
        snapshot
            .recipes
            .iter()
            .any(|r| r.id == carbonara && r.has_item(parm))
    );
    assert_eq!(app.category_id("Deli & Cheese"), 3);
    app.assert_consistent();
}

#[tokio::test]
async fn state_survives_a_restart() {
    let app = TestApp::demo();
    let id = add_to_list(&app, "Kumquats");
    let before = app.get("/api/state").await.json();

    let app = app.restart();

    assert_eq!(app.get("/api/state").await.json(), before);
    assert_eq!(
        app.get("/api/version").await.json(),
        json!({ "version": 1 })
    );
    assert_eq!(app.item_id("kumquats"), id);
    // The restart backed up the previous db.json.
    let backups = std::fs::read_dir(app.data_dir().join("backups"))
        .unwrap()
        .count();
    assert_eq!(backups, 1);
    app.assert_consistent();
}
