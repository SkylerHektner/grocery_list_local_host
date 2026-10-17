//! `POST /api/list/items`, `PUT|DELETE /api/list/items/{item_id}`, `POST /api/list/recipes`,
//! `DELETE /api/list/recipes/{recipe_id}`, `DELETE /api/list`, `POST /api/list/undo`.
//! (Export: `tests/export.rs`.)

mod common;

use axum::http::Method;
use rust_html_server::model::{ListEntry, Source, unix_now};
use rust_html_server::store::UNDO_CAP;
use serde_json::{Value, json};

use common::TestApp;

async fn undo(app: &TestApp) -> Value {
    app.ok(Method::POST, "/api/list/undo", None).await
}

// --- POST /api/list/items ---

#[tokio::test]
async fn add_item_creates_a_manual_entry_and_bumps_usage() {
    let app = TestApp::demo();
    let eggs = app.item_id("Eggs");
    let start = unix_now();

    let body = app
        .post_ok(
            "/api/list/items",
            json!({ "item_id": eggs, "note": " 2   dozen " }),
        )
        .await;

    assert_eq!(body["id"], eggs);
    let entry = app.entry(eggs).unwrap();
    assert_eq!(entry.note.as_deref(), Some("2 dozen"));
    assert_eq!(entry.sources, [Source::Manual]);
    assert!(entry.added_at >= start && entry.added_at <= unix_now());
    let (count, last) = app.usage(eggs);
    assert_eq!(count, 1);
    assert!(last >= start);
    assert_eq!(
        body["state"]["list"]["entries"][0]["sources"],
        json!([{ "kind": "manual" }])
    );
}

#[tokio::test]
async fn re_adding_is_a_no_op_apart_from_a_given_note() {
    let app = TestApp::demo();
    let eggs = app.item_id("Eggs");
    app.post_ok(
        "/api/list/items",
        json!({ "item_id": eggs, "note": "2 dozen" }),
    )
    .await;
    let usage = app.usage(eggs);
    let entry = app.entry(eggs).unwrap();

    // No note, null note, blank note: entry and usage unchanged (still a 200, version +1).
    for body in [
        json!({ "item_id": eggs }),
        json!({ "item_id": eggs, "note": null }),
        json!({ "item_id": eggs, "note": "  " }),
    ] {
        app.post_ok("/api/list/items", body).await;
        assert_eq!(app.entry(eggs).unwrap(), entry);
        assert_eq!(app.usage(eggs), usage, "re-adds are not counted twice");
    }
    assert_eq!(
        app.state.undo_depth(),
        1,
        "no-op re-adds record no undo state"
    );

    app.post_ok(
        "/api/list/items",
        json!({ "item_id": eggs, "note": "1 dozen" }),
    )
    .await;
    let updated = app.entry(eggs).unwrap();
    assert_eq!(updated.note.as_deref(), Some("1 dozen"));
    assert_eq!(updated.added_at, entry.added_at);
    assert_eq!(app.listed(), [eggs]);
    assert_eq!(app.usage(eggs), usage);
}

#[tokio::test]
async fn manual_add_of_a_recipe_entry_adds_the_manual_source_and_counts() {
    let app = TestApp::demo();
    let carbonara = app
        .add_recipe_to_list("Spaghetti Carbonara", &["Eggs"])
        .await;
    let eggs = app.item_id("Eggs");
    assert_eq!(app.usage(eggs).0, 1);

    app.add_to_list("Eggs").await;

    assert_eq!(
        app.entry(eggs).unwrap().sources,
        [
            Source::Recipe {
                recipe_id: carbonara
            },
            Source::Manual
        ]
    );
    assert_eq!(app.usage(eggs).0, 2);
}

#[tokio::test]
async fn add_item_errors() {
    let app = TestApp::demo();
    let eggs = app.item_id("Eggs");

    assert_eq!(
        app.post_err("/api/list/items", json!({ "item_id": 999 }), 404)
            .await,
        "item 999 not found"
    );
    let tacos = app.recipe_id("Tacos");
    app.post_err("/api/list/items", json!({ "item_id": tacos }), 404)
        .await;
    let long = "n".repeat(81);
    assert_eq!(
        app.post_err(
            "/api/list/items",
            json!({ "item_id": eggs, "note": long }),
            400
        )
        .await,
        "note is too long (81 characters, max 80)"
    );
    app.post_err("/api/list/items", json!({}), 400).await;
    app.post_err("/api/list/items", json!({ "item_id": "12" }), 400)
        .await;
    app.post_err("/api/list/items", json!({ "item_id": eggs, "qty": 2 }), 400)
        .await;
    let res = app.send(Method::POST, "/api/list/items", None).await;
    assert_eq!(res.status.as_u16(), 400, "no body");
}

// --- PUT /api/list/items/{item_id} ---

#[tokio::test]
async fn set_and_clear_a_note() {
    let app = TestApp::demo();
    let eggs = app.add_to_list("Eggs").await;
    let uri = format!("/api/list/items/{eggs}");
    let usage = app.usage(eggs);

    let body = app.put_ok(&uri, json!({ "note": " brown\n" })).await;
    assert_eq!(body["id"], eggs);
    assert_eq!(app.entry(eggs).unwrap().note.as_deref(), Some("brown"));
    app.put_ok(&uri, json!({ "note": "" })).await;
    assert_eq!(app.entry(eggs).unwrap().note, None);
    app.put_ok(&uri, json!({ "note": "white" })).await;
    app.put_ok(&uri, json!({ "note": null })).await;
    assert_eq!(app.entry(eggs).unwrap().note, None);
    assert_eq!(app.usage(eggs), usage);
    assert_eq!(body["state"]["list"]["entries"][0]["note"], "brown");
}

#[tokio::test]
async fn set_note_errors() {
    let app = TestApp::demo();
    let eggs = app.add_to_list("Eggs").await;
    let milk = app.item_id("Milk");

    assert_eq!(
        app.put_err(
            &format!("/api/list/items/{milk}"),
            json!({ "note": "x" }),
            404
        )
        .await,
        "\"Milk\" is not on the list"
    );
    assert_eq!(
        app.put_err("/api/list/items/999", json!({ "note": "x" }), 404)
            .await,
        "item 999 not found"
    );
    let uri = format!("/api/list/items/{eggs}");
    let msg = app.put_err(&uri, json!({}), 400).await;
    assert!(msg.contains("missing field `note`"), "{msg}");
    app.put_err(&uri, json!({ "note": "a\u{7}" }), 400).await;
    app.put_err(&uri, json!({ "note": 5 }), 400).await;
    app.put_err("/api/list/items/eggs", json!({ "note": "x" }), 400)
        .await;
}

// --- DELETE /api/list/items/{item_id} ---

#[tokio::test]
async fn remove_item_drops_the_entry_whatever_its_sources_and_keeps_the_chip() {
    let app = TestApp::demo();
    let tacos = app.add_recipe_to_list("Tacos", &["Limes", "Salt"]).await;
    let limes = app.add_to_list("Limes").await;
    let salt = app.item_id("Salt");

    let body = app.delete_ok(&format!("/api/list/items/{limes}")).await;
    assert_eq!(body["id"], limes);
    assert_eq!(app.listed(), [salt]);

    app.delete_ok(&format!("/api/list/items/{salt}")).await;
    assert!(app.listed().is_empty());
    assert_eq!(app.db().list.recipe_ids, [tacos], "chip stays");
    // The chip can still be removed.
    app.delete_ok(&format!("/api/list/recipes/{tacos}")).await;
    assert!(app.db().list.recipe_ids.is_empty());
}

#[tokio::test]
async fn remove_item_errors() {
    let app = TestApp::demo();
    let milk = app.item_id("Milk");
    assert_eq!(
        app.delete_err(&format!("/api/list/items/{milk}"), 404)
            .await,
        "\"Milk\" is not on the list"
    );
    assert_eq!(
        app.delete_err("/api/list/items/999", 404).await,
        "item 999 not found"
    );
    app.delete_err("/api/list/items/-1", 400).await;
}

// --- POST /api/list/recipes ---

#[tokio::test]
async fn add_recipe_adds_the_culled_subset_with_a_recipe_source() {
    let app = TestApp::demo();
    let tacos = app.recipe_id("Tacos");
    let (beef, limes, salt) = (
        app.item_id("Ground beef"),
        app.item_id("Limes"),
        app.item_id("Salt"),
    );
    let salt_usage = app.usage(salt);

    let body = app
        .post_ok(
            "/api/list/recipes",
            json!({ "recipe_id": tacos, "item_ids": [limes, beef, limes] }),
        )
        .await;

    assert_eq!(body["id"], tacos);
    assert_eq!(
        app.listed(),
        [beef, limes],
        "recipe order, duplicates ignored"
    );
    let entry = app.entry(beef).unwrap();
    assert_eq!(entry.sources, [Source::Recipe { recipe_id: tacos }]);
    assert_eq!(entry.note.as_deref(), Some("1 lb"), "the recipe's note");
    assert_eq!(app.db().list.recipe_ids, [tacos]);
    assert_eq!(app.usage(beef).0, 1);
    assert_eq!(app.usage(salt), salt_usage, "culled items are not touched");
    assert_eq!(
        body["state"]["list"]["entries"][0]["sources"],
        json!([{ "kind": "recipe", "recipe_id": tacos }])
    );
}

#[tokio::test]
async fn add_recipe_extends_existing_entries_without_duplicates() {
    let app = TestApp::demo();
    let salt = app.item_id("Salt");
    app.post_ok(
        "/api/list/items",
        json!({ "item_id": salt, "note": "kosher" }),
    )
    .await;
    let usage = app.usage(salt);

    let tacos = app.add_recipe_to_list("Tacos", &["Salt"]).await;
    let carbonara = app
        .add_recipe_to_list("Spaghetti Carbonara", &["Salt"])
        .await;
    app.add_recipe_to_list("Tacos", &["Salt"]).await;

    assert_eq!(
        app.entry(salt).unwrap(),
        ListEntry {
            item_id: salt,
            note: Some("kosher".into()),
            sources: vec![
                Source::Manual,
                Source::Recipe { recipe_id: tacos },
                Source::Recipe {
                    recipe_id: carbonara
                },
            ],
            added_at: app.entry(salt).unwrap().added_at,
        }
    );
    assert_eq!(app.listed(), [salt]);
    assert_eq!(app.db().list.recipe_ids, [tacos, carbonara]);
    assert_eq!(app.usage(salt), usage, "already on the list: not counted");
}

#[tokio::test]
async fn add_recipe_with_nothing_selected_still_shows_the_chip() {
    let app = TestApp::demo();
    let tacos = app.recipe_id("Tacos");

    app.post_ok(
        "/api/list/recipes",
        json!({ "recipe_id": tacos, "item_ids": [] }),
    )
    .await;

    assert!(app.listed().is_empty());
    assert_eq!(app.db().list.recipe_ids, [tacos]);
}

#[tokio::test]
async fn add_recipe_errors() {
    let app = TestApp::demo();
    let tacos = app.recipe_id("Tacos");
    let milk = app.item_id("Milk");
    let limes = app.item_id("Limes");

    assert_eq!(
        app.post_err(
            "/api/list/recipes",
            json!({ "recipe_id": tacos, "item_ids": [limes, milk] }),
            400
        )
        .await,
        format!("item {milk} is not an ingredient of \"Tacos\"")
    );
    app.post_err(
        "/api/list/recipes",
        json!({ "recipe_id": tacos, "item_ids": [999] }),
        400,
    )
    .await;
    assert_eq!(
        app.post_err(
            "/api/list/recipes",
            json!({ "recipe_id": 999, "item_ids": [] }),
            404
        )
        .await,
        "recipe 999 not found"
    );
    let msg = app
        .post_err("/api/list/recipes", json!({ "recipe_id": tacos }), 400)
        .await;
    assert!(msg.contains("missing field `item_ids`"), "{msg}");
    app.post_err("/api/list/recipes", json!({ "item_ids": [] }), 400)
        .await;
}

// --- DELETE /api/list/recipes/{recipe_id} ---

#[tokio::test]
async fn remove_recipe_keeps_items_added_manually_or_by_another_recipe() {
    let app = TestApp::demo();
    let tacos = app
        .add_recipe_to_list("Tacos", &["Ground beef", "Limes", "Salt"])
        .await;
    let carbonara = app
        .add_recipe_to_list("Spaghetti Carbonara", &["Salt", "Bacon"])
        .await;
    let limes = app.add_to_list("Limes").await;
    let (salt, bacon) = (app.item_id("Salt"), app.item_id("Bacon"));

    let body = app.delete_ok(&format!("/api/list/recipes/{tacos}")).await;

    assert_eq!(body["id"], tacos);
    assert_eq!(app.listed(), [limes, salt, bacon], "Ground beef is gone");
    assert_eq!(app.entry(limes).unwrap().sources, [Source::Manual]);
    assert_eq!(
        app.entry(salt).unwrap().sources,
        [Source::Recipe {
            recipe_id: carbonara
        }]
    );
    assert_eq!(app.db().list.recipe_ids, [carbonara]);
    assert!(
        app.db().find_recipe(tacos).is_ok(),
        "the recipe itself stays"
    );
}

#[tokio::test]
async fn recipe_notes_fill_empty_notes_and_leave_with_the_chip() {
    // Demo Tacos: Ground beef "1 lb", Limes "2".
    let app = TestApp::demo();
    let beef = app.add_to_list("Ground beef").await;
    app.post_ok(
        "/api/list/items",
        json!({ "item_id": app.item_id("Limes"), "note": "6" }),
    )
    .await;
    let tacos = app
        .add_recipe_to_list("Tacos", &["Ground beef", "Limes", "Avocados"])
        .await;
    let note = |id| app.entry(id).unwrap().note;
    let (limes, avocados) = (app.item_id("Limes"), app.item_id("Avocados"));
    assert_eq!(note(beef).as_deref(), Some("1 lb"), "empty note filled");
    assert_eq!(note(limes).as_deref(), Some("6"), "existing note kept");
    assert_eq!(note(avocados), None, "no recipe note");

    app.delete_ok(&format!("/api/list/recipes/{tacos}")).await;
    assert_eq!(app.listed(), [beef, limes]);
    assert_eq!(note(beef), None, "the recipe's note leaves with it");
    assert_eq!(note(limes).as_deref(), Some("6"));
}

#[tokio::test]
async fn remove_recipe_errors() {
    let app = TestApp::demo();
    let tacos = app.recipe_id("Tacos");
    assert_eq!(
        app.delete_err(&format!("/api/list/recipes/{tacos}"), 404)
            .await,
        "\"Tacos\" is not on the list"
    );
    assert_eq!(
        app.delete_err("/api/list/recipes/999", 404).await,
        "recipe 999 not found"
    );
}

// --- DELETE /api/list ---

#[tokio::test]
async fn clear_empties_the_list() {
    let app = TestApp::demo();
    app.add_recipe_to_list("Tacos", &["Limes"]).await;
    let milk = app.add_to_list("Milk").await;
    let usage = app.usage(milk);

    let body = app.delete_ok("/api/list").await;

    assert_eq!(body["id"], json!(null));
    assert_eq!(
        body["state"]["list"],
        json!({ "entries": [], "recipe_ids": [] })
    );
    assert_eq!(app.usage(milk), usage, "usage is history and stays");
    assert_eq!(app.export().await, "");
}

#[tokio::test]
async fn clearing_an_empty_list_records_no_undo_state() {
    let app = TestApp::demo();
    app.delete_ok("/api/list").await;
    assert_eq!(app.state.undo_depth(), 0);
    app.post_err("/api/list/undo", json!(null), 409).await;

    app.add_to_list("Milk").await;
    app.delete_ok("/api/list").await;
    app.delete_ok("/api/list").await;
    assert_eq!(app.state.undo_depth(), 2, "add + one real clear");
}

// --- POST /api/list/undo ---

#[tokio::test]
async fn undo_with_nothing_to_undo_is_409() {
    let app = TestApp::demo();
    assert_eq!(
        app.fails(Method::POST, "/api/list/undo", None, 409).await,
        "nothing to undo"
    );
}

#[tokio::test]
async fn undo_reverts_each_kind_of_list_edit_in_lifo_order() {
    let app = TestApp::demo();
    let mut states = vec![app.db().list];
    let eggs = app.item_id("Eggs");
    let tacos = app.recipe_id("Tacos");

    app.add_to_list("Eggs").await;
    states.push(app.db().list);
    app.put_ok(&format!("/api/list/items/{eggs}"), json!({ "note": "6" }))
        .await;
    states.push(app.db().list);
    app.add_recipe_to_list("Tacos", &["Limes", "Salt"]).await;
    states.push(app.db().list);
    app.delete_ok(&format!("/api/list/items/{eggs}")).await;
    states.push(app.db().list);
    app.add_to_list("Milk").await;
    states.push(app.db().list);
    app.delete_ok(&format!("/api/list/recipes/{tacos}")).await;
    states.push(app.db().list);
    assert_eq!(app.listed(), [app.item_id("Milk")]);
    app.delete_ok("/api/list").await;
    assert_eq!(app.state.undo_depth(), 7);

    while let Some(expected) = states.pop() {
        let body = undo(&app).await;
        assert_eq!(body["id"], json!(null));
        assert_eq!(app.db().list, expected);
    }
    assert_eq!(app.state.undo_depth(), 0);
    app.post_err("/api/list/undo", json!(null), 409).await;
}

#[tokio::test]
async fn undo_restores_only_the_list() {
    let app = TestApp::demo();
    let milk = app.add_to_list("Milk").await;
    let usage = app.usage(milk);
    // A catalog edit in between is kept, and does not affect the undo history.
    app.post_ok("/api/items", json!({ "name": "Kale" })).await;
    assert_eq!(app.state.undo_depth(), 1);

    let body = undo(&app).await;

    assert!(app.listed().is_empty());
    assert_eq!(app.usage(milk), usage, "usage is not rolled back");
    assert!(app.db().item_by_name_ci("Kale").is_some());
    assert_eq!(body["state"]["list"]["entries"], json!([]));
}

#[tokio::test]
async fn undo_history_is_capped() {
    let app = TestApp::demo();
    let milk = app.add_to_list("Milk").await;
    let uri = format!("/api/list/items/{milk}");
    for i in 0..UNDO_CAP + 5 {
        app.put_ok(&uri, json!({ "note": format!("v{i}") })).await;
    }
    assert_eq!(app.state.undo_depth(), UNDO_CAP);

    for _ in 0..UNDO_CAP {
        undo(&app).await;
    }

    // The oldest states (incl. "Milk not on the list") were dropped.
    assert_eq!(app.entry(milk).unwrap().note.as_deref(), Some("v4"));
    app.post_err("/api/list/undo", json!(null), 409).await;
}

#[tokio::test]
async fn catalog_deletes_and_merges_clear_undo_but_other_catalog_edits_keep_it() {
    let app = TestApp::demo();
    app.add_to_list("Milk").await;

    let produce = app.category_id("Produce");
    let eggs = app.item_id("Eggs");
    let tacos = app.recipe_id("Tacos");
    app.put_ok(
        &format!("/api/categories/{produce}"),
        json!({ "name": "Veg" }),
    )
    .await;
    app.delete_ok(&format!("/api/categories/{produce}")).await;
    app.put_ok(
        &format!("/api/items/{eggs}"),
        json!({ "name": "Eggs", "category_id": 5, "aliases": [], "staple": true }),
    )
    .await;
    app.put_ok(
        &format!("/api/recipes/{tacos}"),
        json!({ "name": "Tacos", "ingredients": [{ "item_id": eggs }] }),
    )
    .await;
    app.post_ok("/api/recipes", json!({ "name": "Omelette" }))
        .await;
    assert_eq!(app.state.undo_depth(), 1);

    let clearing = [
        format!("/api/recipes/{tacos}"),
        format!("/api/items/{}", app.item_id("Bacon")),
    ];
    for uri in clearing {
        app.add_to_list("Butter").await;
        assert!(app.state.undo_depth() > 0);
        app.delete_ok(&uri).await;
        assert_eq!(app.state.undo_depth(), 0, "{uri}");
        app.delete_ok(&format!("/api/list/items/{}", app.item_id("Butter")))
            .await;
    }
    app.add_to_list("Lemons").await;
    app.post_ok(
        &format!("/api/items/{}/merge", app.item_id("Lemons")),
        json!({ "into_id": app.item_id("Limes") }),
    )
    .await;
    assert_eq!(app.state.undo_depth(), 0, "merge");
}

#[tokio::test]
async fn failed_list_edits_record_nothing() {
    let app = TestApp::demo();
    app.add_to_list("Milk").await;
    let tacos = app.recipe_id("Tacos");
    // Each `*_err` asserts the DB and undo depth are unchanged.
    app.post_err("/api/list/items", json!({ "item_id": 999 }), 404)
        .await;
    app.post_err(
        "/api/list/recipes",
        json!({ "recipe_id": tacos, "item_ids": [999] }),
        400,
    )
    .await;
    app.delete_err("/api/list/items/999", 404).await;
    app.delete_err(&format!("/api/list/recipes/{tacos}"), 404)
        .await;
    assert_eq!(app.state.undo_depth(), 1);
}

#[tokio::test]
async fn wrong_methods_on_list_routes_are_405() {
    let app = TestApp::demo();
    for (method, uri) in [
        (Method::GET, "/api/list"),
        (Method::POST, "/api/list"),
        (Method::GET, "/api/list/items"),
        (Method::GET, "/api/list/undo"),
        (Method::POST, "/api/list/export"),
        (Method::PUT, "/api/list/recipes/5"),
    ] {
        let res = app.send(method.clone(), uri, None).await;
        assert_eq!(res.status.as_u16(), 405, "{method} {uri}");
    }
}
