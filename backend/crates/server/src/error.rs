use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use tracing::error;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Too many requests.")]
    RateLimited,
    #[error("Service temporarily unavailable.")]
    Unavailable,
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
    #[error(transparent)]
    Redis(#[from] redis::RedisError),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    message: &'a str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::Sql(_) | Self::Redis(_) | Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status.is_server_error() {
            // `error = ?self` alone renders one line of Display text, which for
            // a `sqlx::Error` is often just "error returned from database" with
            // the useful part buried in `source()`. Walk the chain, and pull the
            // backtrace out of the `anyhow` variant — the only one that carries
            // one, and only when RUST_BACKTRACE is set.
            error!(
                error = %self,
                error_chain = %error_chain(&self),
                backtrace = %backtrace(&self),
                "request failed"
            );
        }
        let public_message = if status.is_server_error() {
            "Internal server error.".to_owned()
        } else {
            self.to_string()
        };
        let body = ErrorBody {
            message: &public_message,
        };
        (status, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// Flattens the `source()` chain into one field.
///
/// The chain is where the cause actually lives: a failed insert surfaces as
/// "error returned from database" at the top and "duplicate key value violates
/// unique constraint …" three links down.
fn error_chain(error: &ApiError) -> String {
    let mut parts = Vec::new();
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(link) = current {
        parts.push(link.to_string());
        current = link.source();
    }
    parts.join(": ")
}

/// Renders the backtrace of the `anyhow` variant.
///
/// Only `Internal` captures one — `sqlx` and `redis` errors have no backtrace
/// support, so those report the marker instead of pretending to have a trace.
/// Requires `RUST_BACKTRACE=1`; without it `anyhow` yields a disabled-backtrace
/// placeholder rather than frames.
fn backtrace(error: &ApiError) -> String {
    match error {
        ApiError::Internal(inner) => inner.backtrace().to_string(),
        _ => "<no backtrace on this error type>".to_owned(),
    }
}
