//! [`ApiError`]: every API failure, rendered as `{"error": "<message>"}` with a fitting status
//! (SPEC §4), plus [`ApiJson`], a `Json` extractor whose rejections use the same shape.

use std::fmt;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRequest, Request};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::de::DeserializeOwned;
use serde_json::json;

/// An API error. Handlers return `Result<_, ApiError>` and use `?`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// 400: invalid input (validation failure, malformed JSON body).
    BadRequest(String),
    /// 404: unknown id or route.
    NotFound(String),
    /// 405: known route, wrong method.
    MethodNotAllowed(String),
    /// 409: duplicate name, or the request conflicts with the current state.
    Conflict(String),
    /// 500: server-side failure (e.g. the DB could not be saved). Logged to stderr.
    Internal(String),
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Conflict(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::MethodNotAllowed(_) => StatusCode::METHOD_NOT_ALLOWED,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::BadRequest(m)
            | Self::NotFound(m)
            | Self::MethodNotAllowed(m)
            | Self::Conflict(m)
            | Self::Internal(m) => m,
        }
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        if status.is_server_error() {
            eprintln!("error: {}", self.message());
        }
        (status, Json(json!({ "error": self.message() }))).into_response()
    }
}

/// Malformed/missing JSON bodies and wrong field types are all 400s.
impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        Self::BadRequest(rejection.body_text())
    }
}

/// Drop-in for `axum::Json<T>` as an extractor: a bad body becomes an [`ApiError::BadRequest`]
/// (`{"error": ...}`, 400) instead of axum's plain-text 400/415/422.
#[derive(Debug, Clone, Copy, Default)]
pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) = Json::<T>::from_request(req, state).await?;
        Ok(Self(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use axum::routing::post;
    use http_body_util::BodyExt;
    use serde::Deserialize;
    use serde_json::Value;
    use tower::ServiceExt;

    async fn body_json(res: Response) -> Value {
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn renders_status_and_error_body() {
        let cases = [
            (ApiError::bad_request("bad"), 400),
            (ApiError::not_found("gone"), 404),
            (ApiError::MethodNotAllowed("nope".into()), 405),
            (ApiError::conflict("dup"), 409),
            (ApiError::internal("disk"), 500),
        ];
        for (err, code) in cases {
            let msg = err.message().to_string();
            assert_eq!(err.to_string(), msg);
            let res = err.into_response();
            assert_eq!(res.status().as_u16(), code);
            assert_eq!(res.headers()["content-type"], "application/json", "{msg}");
            assert_eq!(body_json(res).await, json!({ "error": msg }));
        }
    }

    #[derive(Deserialize)]
    struct Body1 {
        name: String,
    }

    async fn echo(ApiJson(body): ApiJson<Body1>) -> String {
        body.name
    }

    async fn call(content_type: Option<&str>, body: &str) -> Response {
        let app = Router::new().route("/", post(echo));
        let mut req = Request::builder().method("POST").uri("/");
        if let Some(ct) = content_type {
            req = req.header("content-type", ct);
        }
        app.oneshot(req.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn api_json_accepts_valid_body() {
        let res = call(Some("application/json"), r#"{"name":"Milk"}"#).await;
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn api_json_rejections_are_json_400() {
        for (ct, body) in [
            (Some("application/json"), "{not json"),
            (Some("application/json"), r#"{"name": 5}"#),
            (Some("application/json"), "{}"),
            (None, r#"{"name":"Milk"}"#),
        ] {
            let res = call(ct, body).await;
            assert_eq!(res.status(), StatusCode::BAD_REQUEST, "{body}");
            let json = body_json(res).await;
            assert!(
                json["error"].as_str().is_some_and(|m| !m.is_empty()),
                "{json}"
            );
        }
    }
}
