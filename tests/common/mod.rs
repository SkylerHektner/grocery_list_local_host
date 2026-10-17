//! Shared helpers for integration tests: drive `app()` in-process, no sockets, no real data dir.
#![allow(dead_code)] // each test crate uses a different subset

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
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
