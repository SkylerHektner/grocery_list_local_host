//! `POST /api/items`, `PUT|DELETE /api/items/{id}`, `POST /api/items/{id}/merge`.

mod common;

use rust_html_server::model::{Item, Source};
use serde_json::json;

use common::TestApp;

fn item(app: &TestApp, id: u64) -> Item {
    app.state.read(|db| db.find_item(id).cloned()).unwrap()
}

#[tokio::test]
async fn create_with_only_a_name_uses_defaults() {
    let app = TestApp::new();

    let body = app
        .post_ok("/api/items", json!({ "name": " birthday   candles" }))
        .await;

    let id = body["id"].as_u64().unwrap();
    assert_eq!(
        body["state"]["items"][0],
        json!({
            "id": id, "name": "Birthday candles", "category_id": null, "aliases": [],
            "staple": false, "use_count": 0, "last_used": 0
        })
    );
    assert!(app.listed().is_empty(), "creating does not add to the list");
}

#[tokio::test]
async fn create_with_all_fields_normalizes_aliases() {
    let app = TestApp::new();
    let deli = app.category_id("Deli & Cheese");

    let body = app
        .post_ok(
            "/api/items",
            json!({
                "name": "parmigiano reggiano", "category_id": deli,
                "aliases": ["parmesan", " PARMESAN ", "", "Parmigiano Reggiano", "grana"],
                "staple": true
            }),
        )
        .await;

    let it = item(&app, body["id"].as_u64().unwrap());
    assert_eq!(it.name, "Parmigiano reggiano");
    assert_eq!(it.aliases, ["Parmesan", "Grana"]);
    assert_eq!(it.category_id, Some(deli));
    assert!(it.staple);
}

#[tokio::test]
async fn create_errors() {
    let app = TestApp::demo();

    assert_eq!(
        app.post_err("/api/items", json!({ "name": "MILK" }), 409)
            .await,
        "an item named \"Milk\" already exists"
    );
    assert_eq!(
        app.post_err("/api/items", json!({ "name": "parmesan" }), 409)
            .await,
        "\"Parmesan\" is already an alias of \"Parmigiano Reggiano\""
    );
    assert_eq!(
        app.post_err(
            "/api/items",
            json!({ "name": "Whole milk", "aliases": ["milk"] }),
            409
        )
        .await,
        "alias \"Milk\" is already the name of item \"Milk\""
    );
    assert_eq!(
        app.post_err(
            "/api/items",
            json!({ "name": "Kale", "category_id": 999 }),
            400
        )
        .await,
        "category 999 does not exist"
    );
    let milk = app.item_id("Milk");
    app.post_err(
        "/api/items",
        json!({ "name": "Kale", "category_id": milk }),
        400,
    )
    .await;
    app.post_err("/api/items", json!({ "name": "" }), 400).await;
    app.post_err("/api/items", json!({ "name": "a\u{0}b" }), 400)
        .await;
    app.post_err("/api/items", json!({ "aliases": [] }), 400)
        .await;
    app.post_err(
        "/api/items",
        json!({ "name": "Kale", "staple": "yes" }),
        400,
    )
    .await;
    app.post_err("/api/items", json!({ "name": "Kale", "use_count": 3 }), 400)
        .await;
    let long_alias = "a".repeat(81);
    app.post_err(
        "/api/items",
        json!({ "name": "Kale", "aliases": [long_alias] }),
        400,
    )
    .await;
}

#[tokio::test]
async fn update_replaces_editable_fields_and_keeps_usage() {
    let app = TestApp::demo();
    let milk = app.add_to_list("Milk").await;
    let usage = app.usage(milk);

    let body = app
        .put_ok(
            &format!("/api/items/{milk}"),
            json!({
                "name": "whole milk", "category_id": null, "aliases": ["Milk", "2%"],
                "staple": true
            }),
        )
        .await;

    assert_eq!(body["id"], milk);
    let it = item(&app, milk);
    assert_eq!(it.name, "Whole milk");
    assert_eq!(it.aliases, ["Milk", "2%"]);
    assert_eq!(it.category_id, None);
    assert!(it.staple);
    assert_eq!(app.usage(milk), usage);
    assert!(app.entry(milk).is_some(), "still on the list");
    assert_eq!(app.export().await, "OTHER\nWhole milk");

    // A case-only rename of its own name is fine.
    app.put_ok(
        &format!("/api/items/{milk}"),
        json!({ "name": "WHOLE MILK", "category_id": 5, "aliases": [], "staple": false }),
    )
    .await;
    assert_eq!(item(&app, milk).name, "WHOLE MILK");
}

#[tokio::test]
async fn update_errors() {
    let app = TestApp::demo();
    let milk = app.item_id("Milk");
    let uri = format!("/api/items/{milk}");
    let full =
        |name: &str| json!({ "name": name, "category_id": 5, "aliases": [], "staple": false });

    assert_eq!(
        app.put_err(&uri, full("eggs"), 409).await,
        "an item named \"Eggs\" already exists"
    );
    assert_eq!(
        app.put_err("/api/items/999", full("X"), 404).await,
        "item 999 not found"
    );
    app.put_err("/api/items/x1", full("X"), 400).await;
    assert_eq!(
        app.put_err(
            &uri,
            json!({ "name": "Milk", "category_id": 999, "aliases": [], "staple": false }),
            400
        )
        .await,
        "category 999 does not exist"
    );
    // Full replace: every field is required, including a nullable category_id.
    for partial in [
        json!({ "name": "Milk", "aliases": [], "staple": false }),
        json!({ "name": "Milk", "category_id": null, "staple": false }),
        json!({ "name": "Milk", "category_id": null, "aliases": [] }),
        json!({ "category_id": null, "aliases": [], "staple": false }),
    ] {
        let msg = app.put_err(&uri, partial.clone(), 400).await;
        assert!(msg.contains("missing field"), "{partial}: {msg}");
    }
}

#[tokio::test]
async fn delete_cascades_out_of_recipes_and_list_and_clears_undo() {
    let app = TestApp::demo();
    let eggs = app.item_id("Eggs");
    let carbonara = app
        .add_recipe_to_list("Spaghetti Carbonara", &["Eggs", "Bacon"])
        .await;
    let weekly = app.recipe_id("Weekly Staples");
    app.add_to_list("Eggs").await;
    assert!(app.state.undo_depth() > 0);

    let body = app.delete_ok(&format!("/api/items/{eggs}")).await;

    assert_eq!(body["id"], eggs);
    let db = app.db();
    assert!(db.find_item(eggs).is_err());
    for recipe in [carbonara, weekly] {
        assert!(!db.find_recipe(recipe).unwrap().item_ids.contains(&eggs));
    }
    assert_eq!(app.listed(), [app.item_id("Bacon")]);
    assert_eq!(db.list.recipe_ids, [carbonara]);
    assert_eq!(app.state.undo_depth(), 0);
    let res = app.post("/api/list/undo", json!(null)).await;
    assert_eq!(res.status.as_u16(), 409);

    assert_eq!(
        app.delete_err(&format!("/api/items/{eggs}"), 404).await,
        format!("item {eggs} not found")
    );
}

#[tokio::test]
async fn delete_keeps_a_recipe_chip_whose_entries_are_all_gone() {
    let app = TestApp::demo();
    let tacos = app.add_recipe_to_list("Tacos", &["Limes"]).await;
    let limes = app.item_id("Limes");

    app.delete_ok(&format!("/api/items/{limes}")).await;

    assert!(app.listed().is_empty());
    assert_eq!(app.db().list.recipe_ids, [tacos]);
}

#[tokio::test]
async fn merge_folds_everything_into_the_target() {
    let app = TestApp::demo();
    let parm = app.item_id("Parmigiano Reggiano");
    let pecorino = app
        .post_ok(
            "/api/items",
            json!({ "name": "Pecorino", "aliases": ["Romano"], "staple": true }),
        )
        .await["id"]
        .as_u64()
        .unwrap();
    let tacos = app.recipe_id("Tacos");
    let carbonara = app.recipe_id("Spaghetti Carbonara");
    // Pecorino joins Tacos (no Parmigiano) and Carbonara (has Parmigiano).
    let tacos_items = app.db().find_recipe(tacos).unwrap().item_ids.clone();
    let mut new_tacos = tacos_items.clone();
    new_tacos.insert(0, pecorino);
    app.put_ok(
        &format!("/api/recipes/{tacos}"),
        json!({ "name": "Tacos", "item_ids": new_tacos }),
    )
    .await;
    let mut new_carbonara = app.db().find_recipe(carbonara).unwrap().item_ids.clone();
    new_carbonara.push(pecorino);
    app.put_ok(
        &format!("/api/recipes/{carbonara}"),
        json!({ "name": "Spaghetti Carbonara", "item_ids": new_carbonara }),
    )
    .await;
    app.add_recipe_to_list("Spaghetti Carbonara", &["Parmigiano Reggiano"])
        .await;
    app.post_ok(
        "/api/list/items",
        json!({ "item_id": pecorino, "note": "grated" }),
    )
    .await;
    app.add_recipe_to_list("Tacos", &["Pecorino"]).await;
    let (p_count, p_last) = app.usage(parm);
    let (q_count, q_last) = app.usage(pecorino);

    let body = app
        .post_ok(
            &format!("/api/items/{pecorino}/merge"),
            json!({ "into_id": parm }),
        )
        .await;

    assert_eq!(body["id"], parm);
    let db = app.db();
    assert!(db.find_item(pecorino).is_err());
    let p = db.find_item(parm).unwrap();
    assert_eq!(p.name, "Parmigiano Reggiano");
    assert_eq!(p.aliases, ["Parmesan", "Pecorino", "Romano"]);
    assert_eq!(p.category_id, Some(app.category_id("Deli & Cheese")));
    assert!(!p.staple, "target keeps its staple flag");
    assert_eq!(p.use_count, p_count + q_count);
    assert_eq!(p.last_used, p_last.max(q_last));
    assert_eq!(db.find_recipe(tacos).unwrap().item_ids[0], parm);
    assert_eq!(
        db.find_recipe(tacos).unwrap().item_ids[1..],
        tacos_items[..]
    );
    let carb = &db.find_recipe(carbonara).unwrap().item_ids;
    assert_eq!(carb.iter().filter(|&&i| i == parm).count(), 1);
    assert!(!carb.contains(&pecorino));
    let entry = app.entry(parm).unwrap();
    assert_eq!(entry.note.as_deref(), Some("grated"));
    assert_eq!(
        entry.sources,
        [
            Source::Recipe {
                recipe_id: carbonara
            },
            Source::Manual,
            Source::Recipe { recipe_id: tacos },
        ]
    );
    assert_eq!(app.listed(), [parm]);
    assert_eq!(app.state.undo_depth(), 0, "undo history cleared");
    // The old name now finds the target.
    assert_eq!(db.item_by_name_or_alias_ci("pecorino").unwrap().id, parm);
}

#[tokio::test]
async fn merge_moves_a_lone_entry_and_keeps_the_target_note() {
    let app = TestApp::demo();
    let lemons = app.item_id("Lemons");
    let limes = app.item_id("Limes");
    app.post_ok("/api/list/items", json!({ "item_id": lemons, "note": "4" }))
        .await;

    app.post_ok(
        &format!("/api/items/{lemons}/merge"),
        json!({ "into_id": limes }),
    )
    .await;

    assert_eq!(app.listed(), [limes]);
    assert_eq!(app.entry(limes).unwrap().note.as_deref(), Some("4"));

    // Both on the list with notes: the target's note wins.
    let bananas = app.item_id("Bananas");
    app.post_ok(
        "/api/list/items",
        json!({ "item_id": bananas, "note": "ripe" }),
    )
    .await;
    app.post_ok(
        &format!("/api/items/{bananas}/merge"),
        json!({ "into_id": limes }),
    )
    .await;
    assert_eq!(app.listed(), [limes]);
    assert_eq!(app.entry(limes).unwrap().note.as_deref(), Some("4"));
    assert_eq!(item(&app, limes).aliases, ["Lemons", "Bananas"]);
}

#[tokio::test]
async fn merge_errors() {
    let app = TestApp::demo();
    let milk = app.add_to_list("Milk").await;
    let uri = format!("/api/items/{milk}/merge");

    assert_eq!(
        app.post_err(&uri, json!({ "into_id": milk }), 400).await,
        "cannot merge \"Milk\" into itself"
    );
    assert_eq!(
        app.post_err(&uri, json!({ "into_id": 999 }), 404).await,
        "item 999 not found"
    );
    assert_eq!(
        app.post_err("/api/items/999/merge", json!({ "into_id": milk }), 404)
            .await,
        "item 999 not found"
    );
    app.post_err(&uri, json!({}), 400).await;
    app.post_err(&uri, json!({ "into_id": "12" }), 400).await;
    assert_eq!(app.state.undo_depth(), 1, "failed merges keep undo history");
}
