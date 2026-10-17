//! `POST /api/categories`, `PUT|DELETE /api/categories/{id}`, `PUT /api/categories/order`.

mod common;

use axum::http::{Method, StatusCode};
use rust_html_server::model::{DEFAULT_CATEGORIES, Id};
use serde_json::json;

use common::TestApp;

fn names(app: &TestApp) -> Vec<String> {
    app.state
        .read(|db| db.categories.iter().map(|c| c.name.clone()).collect())
}

fn ids(app: &TestApp) -> Vec<Id> {
    app.state
        .read(|db| db.categories.iter().map(|c| c.id).collect())
}

#[tokio::test]
async fn create_appends_to_the_walk_and_returns_the_id() {
    let app = TestApp::new();

    let body = app
        .post_ok("/api/categories", json!({ "name": "  garden   center " }))
        .await;

    let id = body["id"].as_u64().unwrap();
    assert_eq!(id, 12, "next id after the 11 default categories");
    let last = body["state"]["categories"]
        .as_array()
        .unwrap()
        .last()
        .unwrap();
    assert_eq!(last, &json!({ "id": 12, "name": "Garden center" }));
    assert_eq!(names(&app).len(), DEFAULT_CATEGORIES.len() + 1);
}

#[tokio::test]
async fn create_rejects_duplicates_and_invalid_names() {
    let app = TestApp::new();

    let msg = app
        .post_err("/api/categories", json!({ "name": "produce" }), 409)
        .await;
    assert_eq!(msg, "a category named \"Produce\" already exists");
    let msg = app
        .post_err("/api/categories", json!({ "name": "   " }), 400)
        .await;
    assert_eq!(msg, "category name must not be empty");
    let long = "x".repeat(81);
    app.post_err("/api/categories", json!({ "name": long }), 400)
        .await;
    app.post_err("/api/categories", json!({}), 400).await;
    app.post_err("/api/categories", json!({ "name": 5 }), 400)
        .await;
    let msg = app
        .post_err("/api/categories", json!({ "name": "A", "id": 3 }), 400)
        .await;
    assert!(msg.contains("unknown field `id`"), "{msg}");
}

#[tokio::test]
async fn rename_category() {
    let app = TestApp::new();
    let dairy = app.category_id("Dairy & Eggs");

    let body = app
        .put_ok(
            &format!("/api/categories/{dairy}"),
            json!({ "name": "dairy" }),
        )
        .await;

    assert_eq!(body["id"], dairy);
    assert_eq!(names(&app)[4], "Dairy");
    // A case-only change of its own name is fine.
    app.put_ok(
        &format!("/api/categories/{dairy}"),
        json!({ "name": "DAIRY" }),
    )
    .await;
    assert_eq!(names(&app)[4], "DAIRY");
}

#[tokio::test]
async fn rename_errors() {
    let app = TestApp::new();
    let dairy = app.category_id("Dairy & Eggs");
    let uri = format!("/api/categories/{dairy}");

    assert_eq!(
        app.put_err(&uri, json!({ "name": "frozen" }), 409).await,
        "a category named \"Frozen\" already exists"
    );
    app.put_err(&uri, json!({ "name": "" }), 400).await;
    app.put_err(&uri, json!({}), 400).await;
    assert_eq!(
        app.put_err("/api/categories/999", json!({ "name": "X" }), 404)
            .await,
        "category 999 not found"
    );
    let msg = app
        .put_err("/api/categories/abc", json!({ "name": "X" }), 400)
        .await;
    assert!(msg.contains("abc"), "{msg}");
}

#[tokio::test]
async fn delete_makes_items_uncategorized_and_keeps_list_and_undo() {
    let app = TestApp::demo();
    let produce = app.category_id("Produce");
    let bananas = app.add_to_list("Bananas").await;
    let depth = app.state.undo_depth();

    let body = app.delete_ok(&format!("/api/categories/{produce}")).await;

    assert_eq!(body["id"], produce);
    assert!(!ids(&app).contains(&produce));
    let db = app.db();
    let produce_items = ["Bananas", "Avocados", "Garlic", "Carrots"];
    for name in produce_items {
        assert_eq!(
            db.item_by_name_ci(name).unwrap().category_id,
            None,
            "{name}"
        );
    }
    assert_eq!(db.item_by_name_ci("Milk").unwrap().category_id, Some(5));
    assert!(app.entry(bananas).is_some(), "list is untouched");
    assert_eq!(app.state.undo_depth(), depth, "undo history is kept");
    assert_eq!(app.export().await, "OTHER\nBananas");

    assert_eq!(
        app.delete_err(&format!("/api/categories/{produce}"), 404)
            .await,
        format!("category {produce} not found")
    );
}

#[tokio::test]
async fn reorder_sets_the_walk_order() {
    let app = TestApp::demo();
    let mut order = ids(&app);
    order.reverse();

    let body = app
        .put_ok("/api/categories/order", json!({ "ids": order }))
        .await;

    assert_eq!(body["id"], json!(null));
    assert_eq!(ids(&app), order);
    assert_eq!(names(&app)[0], "Personal Care");
    // The export follows the new walk.
    app.add_to_list("Toothpaste").await;
    app.add_to_list("Bananas").await;
    assert_eq!(
        app.export().await,
        "PERSONAL CARE\nToothpaste\n\nPRODUCE\nBananas"
    );
}

#[tokio::test]
async fn reorder_must_be_an_exact_permutation() {
    let app = TestApp::new();
    let all = ids(&app);

    let msg = app
        .put_err("/api/categories/order", json!({ "ids": &all[1..] }), 400)
        .await;
    assert_eq!(
        msg,
        "the order must list every category; \"Produce\" (1) is missing"
    );
    let mut dup = all.clone();
    dup[0] = dup[1];
    let msg = app
        .put_err("/api/categories/order", json!({ "ids": dup }), 400)
        .await;
    assert_eq!(msg, "category 2 is listed more than once");
    let mut extra = all.clone();
    extra.push(999);
    let msg = app
        .put_err("/api/categories/order", json!({ "ids": extra }), 400)
        .await;
    assert_eq!(msg, "category 999 does not exist");
    app.put_err("/api/categories/order", json!({ "ids": [] }), 400)
        .await;
    app.put_err("/api/categories/order", json!({}), 400).await;
    app.put_err("/api/categories/order", json!({ "ids": "1,2" }), 400)
        .await;
    assert_eq!(ids(&app), all);
}

#[tokio::test]
async fn reorder_with_no_categories_left_accepts_an_empty_list() {
    let app = TestApp::new();
    for id in ids(&app) {
        app.delete_ok(&format!("/api/categories/{id}")).await;
    }
    app.put_ok("/api/categories/order", json!({ "ids": [] }))
        .await;
}

#[tokio::test]
async fn order_route_is_not_an_id() {
    let app = TestApp::new();
    for method in [Method::GET, Method::DELETE, Method::POST] {
        let res = app.send(method, "/api/categories/order", None).await;
        assert_eq!(res.status, StatusCode::METHOD_NOT_ALLOWED);
    }
    let res = app.get("/api/categories").await;
    assert_eq!(res.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(ids(&app).len(), DEFAULT_CATEGORIES.len());
}
