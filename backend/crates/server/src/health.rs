use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde_json::json;

use crate::state::AppState;

pub async fn live() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match state.readiness().await {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ready" }))),
        Err(error) => {
            tracing::warn!(error = ?error, "readiness check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "unready" })),
            )
        }
    }
}

pub async fn metrics(State(state): State<AppState>) -> String {
    state.metrics.render()
}
