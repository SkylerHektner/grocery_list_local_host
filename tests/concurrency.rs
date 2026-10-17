//! Simultaneous edits from several devices (the laptop and a phone) through the real router on a
//! multi-threaded runtime: every request is applied exactly once, in some order, each with its
//! own version; nothing is lost or duplicated; and `db.json` ends up identical to memory and
//! survives a restart.

mod common;

use std::collections::HashSet;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use common::{TestApp, send};

/// POSTs/PUTs through a router clone and returns the JSON body (asserting 200).
async fn ok(router: &axum::Router, method: Method, uri: &str, body: Value) -> Value {
    let res = send(router, method, uri, Some(body)).await;
    assert_eq!(res.status, StatusCode::OK, "{uri}: {}", res.text());
    res.json()
}

fn version(body: &Value) -> u64 {
    body["state"]["version"].as_u64().expect("state.version")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn simultaneous_edits_from_two_devices_all_land() {
    let app = TestApp::demo();
    let start = app.state.version();
    let categories: Vec<u64> = app
        .state
        .read(|db| db.categories.iter().map(|c| c.id).collect());

    let mut tasks = Vec::new();
    // Each device creates items and puts them on the list with a note, one request at a time
    // (like the client's queue), while the other device does the same.
    for device in ["Laptop", "Phone"] {
        let router = app.router.clone();
        tasks.push(tokio::spawn(async move {
            let mut versions = Vec::new();
            for i in 0..20 {
                let created = ok(
                    &router,
                    Method::POST,
                    "/api/items",
                    json!({ "name": format!("{device} item {i}") }),
                )
                .await;
                versions.push(version(&created));
                let id = created["id"].as_u64().expect("created id");
                let added = ok(
                    &router,
                    Method::POST,
                    "/api/list/items",
                    json!({ "item_id": id, "note": format!("from {device}") }),
                )
                .await;
                versions.push(version(&added));
            }
            versions
        }));
    }
    // Meanwhile a third writer keeps reordering the store walk (always a full permutation).
    {
        let router = app.router.clone();
        let mut order = categories.clone();
        tasks.push(tokio::spawn(async move {
            let mut versions = Vec::new();
            for _ in 0..10 {
                order.rotate_left(1);
                let body = ok(
                    &router,
                    Method::PUT,
                    "/api/categories/order",
                    json!({ "ids": order }),
                )
                .await;
                versions.push(version(&body));
            }
            versions
        }));
    }

    let mut versions = Vec::new();
    for task in tasks {
        versions.extend(task.await.expect("task panicked"));
    }

    // Every mutation got a version of its own: none overwrote another mid-flight.
    assert_eq!(versions.len(), 2 * 20 * 2 + 10);
    let unique: HashSet<u64> = versions.iter().copied().collect();
    assert_eq!(
        unique.len(),
        versions.len(),
        "two mutations shared a version"
    );
    assert_eq!(app.state.version(), start + versions.len() as u64);
    assert_eq!(
        unique,
        (start + 1..=start + versions.len() as u64).collect::<HashSet<u64>>()
    );

    // Nothing lost: every item exists once and is on the list with its device's note.
    for device in ["Laptop", "Phone"] {
        for i in 0..20 {
            let id = app.item_id(&format!("{device} item {i}"));
            let entry = app.entry(id).expect("on the list");
            assert_eq!(
                entry.note.as_deref(),
                Some(format!("from {device}").as_str())
            );
        }
    }
    // 10 rotations of the walk: back where it started.
    let order: Vec<u64> = app
        .state
        .read(|db| db.categories.iter().map(|c| c.id).collect());
    let mut expected = categories.clone();
    expected.rotate_left(10 % categories.len());
    assert_eq!(order, expected);

    app.assert_consistent(); // also: db.json on disk == memory
    let before = app.get("/api/state").await.json();
    let app = app.restart();
    assert_eq!(app.get("/api/state").await.json(), before);
    app.assert_consistent();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_same_new_item_from_two_devices_is_created_once() {
    let app = TestApp::new();
    let tasks: Vec<_> = (0..8)
        .map(|_| {
            let router = app.router.clone();
            tokio::spawn(async move {
                send(
                    &router,
                    Method::POST,
                    "/api/items",
                    Some(json!({ "name": "Oat milk" })),
                )
                .await
            })
        })
        .collect();
    let mut statuses = Vec::new();
    for task in tasks {
        let res = task.await.expect("task panicked");
        if res.status == StatusCode::CONFLICT {
            assert_eq!(res.error(), "an item named \"Oat milk\" already exists");
        }
        statuses.push(res.status);
    }
    assert_eq!(
        statuses.iter().filter(|s| **s == StatusCode::OK).count(),
        1,
        "{statuses:?}"
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::CONFLICT)
            .count(),
        7
    );
    assert_eq!(app.state.read(|db| db.items.len()), 1);
    assert_eq!(app.state.version(), 1);
    app.assert_consistent();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reads_during_writes_always_see_a_whole_state() {
    let app = TestApp::demo();
    let writer = {
        let router = app.router.clone();
        tokio::spawn(async move {
            for i in 0..30 {
                ok(
                    &router,
                    Method::POST,
                    "/api/items",
                    json!({ "name": format!("Busy item {i}") }),
                )
                .await;
            }
        })
    };
    let reader = {
        let router = app.router.clone();
        tokio::spawn(async move {
            let mut last = 0;
            for _ in 0..60 {
                let res = send(&router, Method::GET, "/api/state", None).await;
                assert_eq!(res.status, StatusCode::OK);
                let state = res.json();
                let v = state["version"].as_u64().expect("version");
                assert!(v >= last, "versions went backwards: {last} -> {v}");
                last = v;
                // Each version adds exactly one item: the snapshot is never half-applied.
                let items = state["items"].as_array().expect("items").len() as u64;
                let busy = state["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|i| i["name"].as_str().unwrap_or("").starts_with("Busy item"))
                    .count() as u64;
                assert_eq!(busy, v, "version {v} with {items} items");
            }
        })
    };
    writer.await.expect("writer panicked");
    reader.await.expect("reader panicked");
    assert_eq!(app.state.version(), 30);
    app.assert_consistent();
}
