//! Shared helpers for integration tests: drive `app()` in-process, no sockets, no real data dir.
//!
//! ```ignore
//! let app = TestApp::new();          // fresh DB (default categories) in a temp dir
//! let app = TestApp::demo();         // fresh DB + demo catalog (src/demo.rs)
//! let res = app.post("/api/items", json!({ "name": "Milk" })).await;
//! assert_eq!(res.status, StatusCode::OK);
//! let milk = app.item_id("Milk");
//! app.assert_consistent();
//!
//! // Mutations that must succeed (200, version +1, state == store, consistent + saved):
//! let body = app.post_ok("/api/list/items", json!({ "item_id": milk })).await;
//! // ... or fail with a status and change nothing (memory, disk, undo depth):
//! let msg = app.post_err("/api/list/items", json!({ "item_id": 999 }), 404).await;
//! ```
#![allow(dead_code)] // each test crate uses a different subset

use std::path::{Path, PathBuf};

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use http_body_util::BodyExt;
use rust_html_server::AppState;
use rust_html_server::model::{Db, Id, ListEntry, Snapshot};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl TestResponse {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| {
            panic!(
                "body is not JSON ({e}): {}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }

    pub fn text(&self) -> String {
        String::from_utf8(self.body.clone()).expect("body is not UTF-8")
    }

    pub fn content_type(&self) -> &str {
        self.headers
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
    }

    /// The `error` message of a JSON error body (panics if there is none).
    pub fn error(&self) -> String {
        match self.json()["error"].as_str() {
            Some(msg) => msg.to_string(),
            None => panic!("no \"error\" in {}", self.text()),
        }
    }
}

/// A complete app on a temp data dir and a temp static dir (`index.html`, `app.js`).
/// Both dirs are deleted when the `TestApp` is dropped.
pub struct TestApp {
    pub router: Router,
    pub state: AppState,
    data_dir: TempDir,
    static_dir: StaticDir,
}

enum StaticDir {
    Temp(TempDir),
    Fixed(PathBuf),
}

impl StaticDir {
    fn path(&self) -> &Path {
        match self {
            Self::Temp(dir) => dir.path(),
            Self::Fixed(path) => path,
        }
    }
}

impl TestApp {
    /// Fresh DB: default categories only, version 0.
    pub fn new() -> Self {
        Self::build(false, None)
    }

    /// Fresh DB seeded with the demo catalog (`rust_html_server::demo`), version 0.
    pub fn demo() -> Self {
        Self::build(true, None)
    }

    /// Fresh DB, serving static files from `static_dir` (e.g. the real `public/`).
    pub fn with_static_dir(static_dir: impl Into<PathBuf>) -> Self {
        Self::build(false, Some(static_dir.into()))
    }

    fn build(demo: bool, static_dir: Option<PathBuf>) -> Self {
        let data_dir = tempfile::tempdir().expect("temp data dir");
        let static_dir = match static_dir {
            Some(path) => StaticDir::Fixed(path),
            None => StaticDir::Temp(temp_static_dir()),
        };
        let (state, _report) = AppState::open(data_dir.path(), demo).expect("open store");
        let router = rust_html_server::app(state.clone(), static_dir.path());
        Self {
            router,
            state,
            data_dir,
            static_dir,
        }
    }

    /// Simulates a server restart: drops the state and re-opens the same data dir
    /// (which writes a startup backup, like a real restart).
    pub fn restart(self) -> Self {
        let Self {
            router,
            state,
            data_dir,
            static_dir,
        } = self;
        drop((router, state));
        let (state, _report) = AppState::open(data_dir.path(), false).expect("re-open store");
        let router = rust_html_server::app(state.clone(), static_dir.path());
        Self {
            router,
            state,
            data_dir,
            static_dir,
        }
    }

    pub fn data_dir(&self) -> &Path {
        self.data_dir.path()
    }

    pub async fn send(&self, method: Method, uri: &str, body: Option<Value>) -> TestResponse {
        send(&self.router, method, uri, body).await
    }

    pub async fn get(&self, uri: &str) -> TestResponse {
        self.send(Method::GET, uri, None).await
    }

    pub async fn post(&self, uri: &str, body: Value) -> TestResponse {
        self.send(Method::POST, uri, Some(body)).await
    }

    pub async fn put(&self, uri: &str, body: Value) -> TestResponse {
        self.send(Method::PUT, uri, Some(body)).await
    }

    pub async fn delete(&self, uri: &str) -> TestResponse {
        self.send(Method::DELETE, uri, None).await
    }

    /// Sends a mutation that must succeed and returns its JSON body. Asserts: 200, the body is
    /// `{state, id}` with `state.version` one higher than before and equal to the store's
    /// snapshot, and the DB is consistent and saved (`assert_consistent`).
    pub async fn ok(&self, method: Method, uri: &str, body: Option<Value>) -> Value {
        let before = self.state.version();
        let res = self.send(method.clone(), uri, body).await;
        assert_eq!(
            res.status,
            StatusCode::OK,
            "{method} {uri} failed: {}",
            res.text()
        );
        let json = res.json();
        let keys: Vec<&String> = json.as_object().expect("object body").keys().collect();
        assert_eq!(keys, ["id", "state"], "{method} {uri}: mutation body shape");
        assert_eq!(
            json["state"]["version"],
            before + 1,
            "{method} {uri}: version"
        );
        let snapshot: Snapshot = serde_json::from_value(json["state"].clone()).unwrap();
        assert_eq!(snapshot, self.state.snapshot(), "{method} {uri}: state");
        self.assert_consistent();
        json
    }

    pub async fn post_ok(&self, uri: &str, body: Value) -> Value {
        self.ok(Method::POST, uri, Some(body)).await
    }

    pub async fn put_ok(&self, uri: &str, body: Value) -> Value {
        self.ok(Method::PUT, uri, Some(body)).await
    }

    pub async fn delete_ok(&self, uri: &str) -> Value {
        self.ok(Method::DELETE, uri, None).await
    }

    /// Sends a request that must fail with `status` and change nothing: same DB in memory and
    /// on disk (so no version bump), same undo depth. Returns the error message.
    pub async fn fails(
        &self,
        method: Method,
        uri: &str,
        body: Option<Value>,
        status: u16,
    ) -> String {
        let before = self.db();
        let disk = std::fs::read(self.data_dir().join("db.json")).expect("read db.json");
        let undo = self.state.undo_depth();
        let res = self.send(method.clone(), uri, body).await;
        assert_eq!(
            res.status.as_u16(),
            status,
            "{method} {uri}: {}",
            res.text()
        );
        assert!(res.content_type().starts_with("application/json"));
        assert_eq!(self.db(), before, "{method} {uri} changed the DB");
        let disk_after = std::fs::read(self.data_dir().join("db.json")).unwrap();
        assert!(disk_after == disk, "{method} {uri} rewrote db.json");
        assert_eq!(self.state.undo_depth(), undo, "{method} {uri}: undo depth");
        res.error()
    }

    pub async fn post_err(&self, uri: &str, body: Value, status: u16) -> String {
        self.fails(Method::POST, uri, Some(body), status).await
    }

    pub async fn put_err(&self, uri: &str, body: Value, status: u16) -> String {
        self.fails(Method::PUT, uri, Some(body), status).await
    }

    pub async fn delete_err(&self, uri: &str, status: u16) -> String {
        self.fails(Method::DELETE, uri, None, status).await
    }

    // --- shortcuts for common setup (each goes through the HTTP API) ---

    /// `POST /api/list/items` for the item named `name`; returns its id.
    pub async fn add_to_list(&self, name: &str) -> Id {
        let id = self.item_id(name);
        self.post_ok("/api/list/items", json!({ "item_id": id }))
            .await;
        id
    }

    /// `POST /api/list/recipes` with the named recipe and the named subset of its items.
    pub async fn add_recipe_to_list(&self, recipe: &str, items: &[&str]) -> Id {
        let id = self.recipe_id(recipe);
        let item_ids: Vec<Id> = items.iter().map(|n| self.item_id(n)).collect();
        self.post_ok(
            "/api/list/recipes",
            json!({ "recipe_id": id, "item_ids": item_ids }),
        )
        .await;
        id
    }

    /// `POST /api/items` with just a name (and optional category name); returns the new id.
    pub async fn create_item(&self, name: &str, category: Option<&str>) -> Id {
        let category_id = category.map(|c| self.category_id(c));
        let res = self
            .post_ok(
                "/api/items",
                json!({ "name": name, "category_id": category_id }),
            )
            .await;
        res["id"].as_u64().expect("created id")
    }

    /// The list entry of `item_id`, if on the list.
    pub fn entry(&self, item_id: Id) -> Option<ListEntry> {
        self.state.read(|db| db.list_entry(item_id).cloned())
    }

    /// `(use_count, last_used)` of the item.
    pub fn usage(&self, item_id: Id) -> (u64, u64) {
        self.state.read(|db| {
            let item = db.find_item(item_id).expect("item exists");
            (item.use_count, item.last_used)
        })
    }

    /// Item ids on the list, in list order.
    pub fn listed(&self) -> Vec<Id> {
        self.state
            .read(|db| db.list.entries.iter().map(|e| e.item_id).collect())
    }

    /// `GET /api/list/export` body (asserting 200 + `text/plain; charset=utf-8`).
    pub async fn export(&self) -> String {
        let res = self.get("/api/list/export").await;
        assert_eq!(res.status, StatusCode::OK);
        assert_eq!(res.content_type(), "text/plain; charset=utf-8");
        res.text()
    }

    /// A copy of the in-memory DB.
    pub fn db(&self) -> Db {
        self.state.read(Db::clone)
    }

    /// `db.json` as currently saved on disk.
    pub fn db_on_disk(&self) -> Db {
        let bytes = std::fs::read(self.data_dir().join("db.json")).expect("read db.json");
        serde_json::from_slice(&bytes).expect("db.json parses")
    }

    /// Panics unless the in-memory DB is consistent and identical to `db.json` on disk.
    pub fn assert_consistent(&self) {
        let db = self.db();
        let problems = db.consistency_problems();
        assert!(
            problems.is_empty(),
            "inconsistent DB:\n{}",
            problems.join("\n")
        );
        assert_eq!(self.db_on_disk(), db, "db.json differs from memory");
    }

    /// Id of the item named `name` (case-insensitive); panics if missing.
    pub fn item_id(&self, name: &str) -> Id {
        self.state
            .read(|db| db.item_by_name_ci(name).map(|i| i.id))
            .unwrap_or_else(|| panic!("no item named {name:?}"))
    }

    /// Id of the recipe named `name` (case-insensitive); panics if missing.
    pub fn recipe_id(&self, name: &str) -> Id {
        self.state
            .read(|db| db.recipe_by_name_ci(name).map(|r| r.id))
            .unwrap_or_else(|| panic!("no recipe named {name:?}"))
    }

    /// Id of the category named `name` (case-insensitive); panics if missing.
    pub fn category_id(&self, name: &str) -> Id {
        self.state
            .read(|db| db.category_by_name_ci(name).map(|c| c.id))
            .unwrap_or_else(|| panic!("no category named {name:?}"))
    }
}

/// A temp static dir with a known index.html, so tests never depend on `public/` contents.
fn temp_static_dir() -> TempDir {
    let dir = tempfile::tempdir().expect("temp static dir");
    std::fs::write(
        dir.path().join("index.html"),
        "<!doctype html><title>test index</title>",
    )
    .unwrap();
    std::fs::write(dir.path().join("app.js"), "export const x = 1;\n").unwrap();
    dir
}

/// Sends one request through a clone of `app`. `body` (if any) is sent as JSON.
pub async fn send(app: &Router, method: Method, uri: &str, body: Option<Value>) -> TestResponse {
    let mut req = Request::builder().method(method).uri(uri);
    let body = match body {
        Some(json) => {
            req = req.header("content-type", "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    let res = app
        .clone()
        .oneshot(req.body(body).unwrap())
        .await
        .expect("router is infallible");
    let status = res.status();
    let headers = res.headers().clone();
    let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    TestResponse {
        status,
        headers,
        body,
    }
}

pub async fn get(app: &Router, uri: &str) -> TestResponse {
    send(app, Method::GET, uri, None).await
}
