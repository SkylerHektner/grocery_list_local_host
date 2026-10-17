//! `GET /api/list/export`: the plain-text list (SPEC §3.6). Formatting details are unit-tested
//! in `src/export.rs`; these cover the endpoint against real API-built lists.

mod common;

use axum::http::StatusCode;
use serde_json::json;

use common::TestApp;

#[tokio::test]
async fn empty_list_exports_an_empty_body() {
    let app = TestApp::demo();

    let res = app.get("/api/list/export").await;

    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.content_type(), "text/plain; charset=utf-8");
    assert_eq!(res.headers["cache-control"], "no-cache");
    assert_eq!(res.text(), "");
    assert_eq!(app.state.version(), 0, "exporting is not a mutation");
}

#[tokio::test]
async fn groups_in_walk_order_sorted_with_notes_and_other_last() {
    let app = TestApp::demo();
    app.add_recipe_to_list("Tacos", &["Taco seasoning", "Limes", "Ground beef"])
        .await;
    for name in ["Milk", "Bananas", "Birthday candles", "BBQ sauce"] {
        app.add_to_list(name).await;
    }
    let milk = app.item_id("Milk");
    app.put_ok(
        &format!("/api/list/items/{milk}"),
        json!({ "note": "2 gallons" }),
    )
    .await;
    let eggs = app.item_id("Eggs");
    app.post_ok(
        "/api/list/items",
        json!({ "item_id": eggs, "note": "1 dozen" }),
    )
    .await;

    assert_eq!(
        app.export().await,
        "PRODUCE\nBananas\nLimes\n\
         \n\
         MEAT & SEAFOOD\nGround beef\n\
         \n\
         DAIRY & EGGS\nEggs (1 dozen)\nMilk (2 gallons)\n\
         \n\
         PANTRY\nBBQ sauce\n\
         \n\
         OTHER\nBirthday candles\nTaco seasoning"
    );
}

#[tokio::test]
async fn an_other_category_absorbs_uncategorized_items_in_its_walk_position() {
    let app = TestApp::demo();
    let other = app
        .post_ok("/api/categories", json!({ "name": "oTHER" }))
        .await["id"]
        .as_u64()
        .unwrap();
    // "oTHER" is normalized to "OTHER"; move it to the front of the walk.
    let mut order: Vec<u64> = app
        .state
        .read(|db| db.categories.iter().map(|c| c.id).collect());
    order.retain(|&id| id != other);
    order.insert(0, other);
    app.put_ok("/api/categories/order", json!({ "ids": order }))
        .await;
    let zip_ties = app.create_item("Zip ties", Some("Other")).await;
    app.post_ok("/api/list/items", json!({ "item_id": zip_ties }))
        .await;
    for name in ["Taco seasoning", "Birthday candles", "Toothpaste"] {
        app.add_to_list(name).await;
    }

    assert_eq!(
        app.export().await,
        "OTHER\nBirthday candles\nTaco seasoning\nZip ties\n\nPERSONAL CARE\nToothpaste"
    );

    // Deleting the Other category: its items become uncategorized and land under OTHER, last.
    app.delete_ok(&format!("/api/categories/{other}")).await;
    assert_eq!(
        app.export().await,
        "PERSONAL CARE\nToothpaste\n\nOTHER\nBirthday candles\nTaco seasoning\nZip ties"
    );
}

#[tokio::test]
async fn export_follows_renames_and_recipe_names_never_appear() {
    let app = TestApp::demo();
    app.add_recipe_to_list("Weekly Staples", &["Sparkling water"])
        .await;
    let beverages = app.category_id("Beverages");
    app.put_ok(
        &format!("/api/categories/{beverages}"),
        json!({ "name": "Drinks & Soda" }),
    )
    .await;

    let text = app.export().await;

    assert_eq!(text, "DRINKS & SODA\nSparkling water");
    assert!(!text.contains("Weekly"));
}
