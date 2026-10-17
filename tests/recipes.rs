//! `POST /api/recipes`, `PUT|DELETE /api/recipes/{id}`.

mod common;

use rust_html_server::model::{Recipe, Source};
use serde_json::json;

use common::TestApp;

fn recipe(app: &TestApp, id: u64) -> Recipe {
    app.state.read(|db| db.find_recipe(id).cloned()).unwrap()
}

#[tokio::test]
async fn create_with_and_without_items() {
    let app = TestApp::demo();
    let (milk, eggs) = (app.item_id("Milk"), app.item_id("Eggs"));

    let body = app
        .post_ok(
            "/api/recipes",
            json!({ "name": " pancakes ", "item_ids": [milk, eggs, milk] }),
        )
        .await;
    let id = body["id"].as_u64().unwrap();
    assert_eq!(
        body["state"]["recipes"].as_array().unwrap().last().unwrap(),
        &json!({ "id": id, "name": "Pancakes", "item_ids": [milk, eggs] })
    );

    let body = app.post_ok("/api/recipes", json!({ "name": "Soup" })).await;
    let soup = recipe(&app, body["id"].as_u64().unwrap());
    assert!(soup.item_ids.is_empty());
    assert!(
        app.listed().is_empty(),
        "creating a recipe does not touch the list"
    );
}

#[tokio::test]
async fn create_errors() {
    let app = TestApp::demo();
    let milk = app.item_id("Milk");

    assert_eq!(
        app.post_err("/api/recipes", json!({ "name": "TACOS" }), 409)
            .await,
        "a recipe named \"Tacos\" already exists"
    );
    assert_eq!(
        app.post_err(
            "/api/recipes",
            json!({ "name": "Soup", "item_ids": [milk, 999] }),
            400
        )
        .await,
        "item 999 does not exist"
    );
    // A recipe id is not an item id.
    let tacos = app.recipe_id("Tacos");
    app.post_err(
        "/api/recipes",
        json!({ "name": "Soup", "item_ids": [tacos] }),
        400,
    )
    .await;
    assert_eq!(
        app.post_err("/api/recipes", json!({ "name": " " }), 400)
            .await,
        "recipe name must not be empty"
    );
    app.post_err("/api/recipes", json!({ "item_ids": [] }), 400)
        .await;
    app.post_err(
        "/api/recipes",
        json!({ "name": "Soup", "item_ids": milk }),
        400,
    )
    .await;
}

#[tokio::test]
async fn update_replaces_name_and_items_and_leaves_the_list_alone() {
    let app = TestApp::demo();
    let tacos = app.add_recipe_to_list("Tacos", &["Limes", "Salt"]).await;
    let list_before = app.db().list;
    let (milk, limes, salt) = (
        app.item_id("Milk"),
        app.item_id("Limes"),
        app.item_id("Salt"),
    );
    let depth = app.state.undo_depth();

    let body = app
        .put_ok(
            &format!("/api/recipes/{tacos}"),
            json!({ "name": "taco night", "item_ids": [milk, salt, salt] }),
        )
        .await;

    assert_eq!(body["id"], tacos);
    let r = recipe(&app, tacos);
    assert_eq!(r.name, "Taco night");
    assert_eq!(r.item_ids, [milk, salt]);
    // Limes keeps its Tacos source although it is no longer an ingredient.
    assert_eq!(app.db().list, list_before);
    assert_eq!(
        app.entry(limes).unwrap().sources,
        [Source::Recipe { recipe_id: tacos }]
    );
    assert_eq!(app.state.undo_depth(), depth);
    // Same name in a different case is fine.
    app.put_ok(
        &format!("/api/recipes/{tacos}"),
        json!({ "name": "TACO NIGHT", "item_ids": [] }),
    )
    .await;
}

#[tokio::test]
async fn update_errors() {
    let app = TestApp::demo();
    let tacos = app.recipe_id("Tacos");
    let uri = format!("/api/recipes/{tacos}");

    assert_eq!(
        app.put_err(&uri, json!({ "name": "stir fry", "item_ids": [] }), 409)
            .await,
        "a recipe named \"Stir Fry\" already exists"
    );
    assert_eq!(
        app.put_err(&uri, json!({ "name": "Tacos", "item_ids": [999] }), 400)
            .await,
        "item 999 does not exist"
    );
    assert_eq!(
        app.put_err(
            "/api/recipes/999",
            json!({ "name": "X", "item_ids": [] }),
            404
        )
        .await,
        "recipe 999 not found"
    );
    let msg = app.put_err(&uri, json!({ "name": "Tacos" }), 400).await;
    assert!(msg.contains("missing field `item_ids`"), "{msg}");
    app.put_err(&uri, json!({ "item_ids": [] }), 400).await;
}

#[tokio::test]
async fn delete_strips_sources_keeps_orphans_as_manual_and_clears_undo() {
    let app = TestApp::demo();
    let tacos = app.add_recipe_to_list("Tacos", &["Limes", "Salt"]).await;
    let carbonara = app
        .add_recipe_to_list("Spaghetti Carbonara", &["Salt", "Bacon"])
        .await;
    let (limes, salt, bacon) = (
        app.item_id("Limes"),
        app.item_id("Salt"),
        app.item_id("Bacon"),
    );
    app.post_ok("/api/list/items", json!({ "item_id": limes, "note": "6" }))
        .await;
    assert!(app.state.undo_depth() > 0);

    let body = app.delete_ok(&format!("/api/recipes/{tacos}")).await;

    assert_eq!(body["id"], tacos);
    let db = app.db();
    assert!(db.find_recipe(tacos).is_err());
    assert_eq!(db.list.recipe_ids, [carbonara]);
    assert_eq!(
        app.listed(),
        [limes, salt, bacon],
        "nothing leaves the list"
    );
    assert_eq!(app.entry(limes).unwrap().sources, [Source::Manual]);
    assert_eq!(app.entry(limes).unwrap().note.as_deref(), Some("6"));
    assert_eq!(
        app.entry(salt).unwrap().sources,
        [Source::Recipe {
            recipe_id: carbonara
        }]
    );
    assert_eq!(app.state.undo_depth(), 0);

    assert_eq!(
        app.delete_err(&format!("/api/recipes/{tacos}"), 404).await,
        format!("recipe {tacos} not found")
    );
}

#[tokio::test]
async fn delete_a_recipe_only_on_the_list_as_a_chip_turns_its_entries_manual() {
    let app = TestApp::demo();
    let weekly = app
        .add_recipe_to_list("Weekly Staples", &["Bananas", "Milk"])
        .await;

    app.delete_ok(&format!("/api/recipes/{weekly}")).await;

    let list = app.db().list;
    assert!(list.recipe_ids.is_empty());
    assert_eq!(list.entries.len(), 2);
    assert!(list.entries.iter().all(|e| e.sources == [Source::Manual]));
    assert_eq!(app.export().await, "PRODUCE\nBananas\n\nDAIRY & EGGS\nMilk");
}
