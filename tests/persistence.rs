//! Every mutation endpoint persists: after each one the server is restarted on the same data
//! dir and must come back with exactly the same state (undo history is memory-only).

mod common;

use axum::http::Method;
use serde_json::{Value, json};

use common::TestApp;

/// Runs one successful mutation, restarts, and checks the state survived.
async fn persists(app: TestApp, method: Method, uri: &str, body: Option<Value>) -> TestApp {
    app.ok(method.clone(), uri, body).await;
    let before = app.get("/api/state").await.json();
    let app = app.restart();
    assert_eq!(
        app.get("/api/state").await.json(),
        before,
        "{method} {uri} did not persist"
    );
    app.assert_consistent();
    app
}

#[tokio::test]
async fn every_mutation_persists_across_a_restart() {
    let mut app = TestApp::demo();

    app = persists(
        app,
        Method::POST,
        "/api/categories",
        Some(json!({ "name": "Garden" })),
    )
    .await;
    let garden = app.category_id("Garden");
    let garden_uri = format!("/api/categories/{garden}");
    app = persists(
        app,
        Method::PUT,
        &garden_uri,
        Some(json!({ "name": "Garden center" })),
    )
    .await;
    let mut order: Vec<u64> = app
        .state
        .read(|db| db.categories.iter().map(|c| c.id).collect());
    order.reverse();
    app = persists(
        app,
        Method::PUT,
        "/api/categories/order",
        Some(json!({ "ids": order })),
    )
    .await;

    app = persists(
        app,
        Method::POST,
        "/api/items",
        Some(json!({ "name": "Kale", "category_id": garden })),
    )
    .await;
    let kale = app.item_id("Kale");
    let kale_uri = format!("/api/items/{kale}");
    app = persists(
        app,
        Method::PUT,
        &kale_uri,
        Some(json!({ "name": "Kale", "category_id": 1, "aliases": ["Cavolo nero"], "staple": false })),
    )
    .await;

    let lemons = app.item_id("Lemons");
    app = persists(
        app,
        Method::POST,
        "/api/recipes",
        Some(json!({ "name": "Salad", "item_ids": [kale] })),
    )
    .await;
    let salad = app.recipe_id("Salad");
    let salad_uri = format!("/api/recipes/{salad}");
    app = persists(
        app,
        Method::PUT,
        &salad_uri,
        Some(json!({ "name": "Kale salad", "item_ids": [kale, lemons] })),
    )
    .await;

    app = persists(
        app,
        Method::POST,
        "/api/list/items",
        Some(json!({ "item_id": kale, "note": "1 bunch" })),
    )
    .await;
    let kale_entry_uri = format!("/api/list/items/{kale}");
    app = persists(
        app,
        Method::PUT,
        &kale_entry_uri,
        Some(json!({ "note": "2 bunches" })),
    )
    .await;
    app = persists(
        app,
        Method::POST,
        "/api/list/recipes",
        Some(json!({ "recipe_id": salad, "item_ids": [lemons] })),
    )
    .await;
    // Undo history lives in memory only: gone after a restart.
    app.post_err("/api/list/undo", json!(null), 409).await;
    app.add_to_list("Milk").await;
    app = persists(app, Method::POST, "/api/list/undo", None).await;
    assert!(app.entry(app.item_id("Milk")).is_none());

    app = persists(
        app,
        Method::DELETE,
        &format!("/api/list/recipes/{salad}"),
        None,
    )
    .await;
    app = persists(app, Method::DELETE, &kale_entry_uri, None).await;
    let limes = app.item_id("Limes");
    app = persists(
        app,
        Method::POST,
        &format!("/api/items/{lemons}/merge"),
        Some(json!({ "into_id": limes })),
    )
    .await;
    app = persists(app, Method::DELETE, &salad_uri, None).await;
    app = persists(app, Method::DELETE, &kale_uri, None).await;
    app = persists(app, Method::DELETE, &garden_uri, None).await;
    app.add_to_list("Eggs").await;
    app = persists(app, Method::DELETE, "/api/list", None).await;

    let db = app.db();
    assert!(db.list.entries.is_empty());
    assert!(db.item_by_name_ci("Lemons").is_none());
    assert_eq!(db.item_by_name_or_alias_ci("lemons").unwrap().id, limes);
    assert_eq!(db.version, 20);
}
