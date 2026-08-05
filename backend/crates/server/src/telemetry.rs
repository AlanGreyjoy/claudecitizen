//! Client telemetry ingest.
//!
//! The browser does not speak OTLP and does not hold observability credentials
//! — a public ingest endpoint would be an unauthenticated write path into the
//! log store. Instead the client posts compact JSON here, and this module
//! stamps it with server-side identity and forwards it to OpenObserve.
//!
//! Deliberately schema-free. Events pass through as `serde_json::Value`, so the
//! client can add a field without a matching Rust struct change and a version
//! skew between a cached web build and a fresh server drops nothing. The only
//! shape this module enforces is the envelope.

use std::sync::OnceLock;

use axum::{Json, extract::State, http::HeaderMap, http::StatusCode};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{auth::optional_user_id, auth::rate_limit, error::ApiResult, state::AppState};

/// One batch is a flush interval's worth of samples plus whatever errors fired.
/// Well above the ~6 events a healthy client sends per minute, low enough that a
/// malfunctioning or hostile client cannot turn one request into a bulk load.
const MAX_EVENTS_PER_BATCH: usize = 256;
/// Flushes are every 10 s plus a beacon on hide, so a well-behaved client sends
/// well under this. The cap is for the pathological case.
const MAX_BATCHES_PER_MINUTE: i64 = 30;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientBatch {
    session_id: String,
    /// Static per-session facts — build, GPU, core count, viewport. Copied onto
    /// every record so a single row explains itself without a join.
    context: Value,
    events: Vec<Value>,
}

/// Accepts a batch and returns immediately.
///
/// 202 regardless of what happens downstream: a player's client must not see an
/// error, retry, or change behaviour because the log store is down. Telemetry
/// that degrades the thing it observes is worse than no telemetry.
pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(batch): Json<ClientBatch>,
) -> ApiResult<StatusCode> {
    if batch.session_id.is_empty() || batch.events.is_empty() {
        return Ok(StatusCode::ACCEPTED);
    }
    // Keyed on the client-supplied session id, which is spoofable — this bounds
    // an honest client's mistakes, not an attacker's. The body size limit and
    // the event cap are what bound the hostile case.
    rate_limit(
        &state,
        &format!("client-telemetry:{}", batch.session_id),
        MAX_BATCHES_PER_MINUTE,
        60,
    )
    .await?;

    let Some(url) = state.config.client_telemetry_url.clone() else {
        // Export is not configured. Dropping is correct: buffering would grow
        // without bound and the client has already moved on.
        return Ok(StatusCode::ACCEPTED);
    };

    // Never read from the body. A client that wants to attribute its telemetry
    // to another player should not be able to just say so.
    let player_id = optional_user_id(&state, &headers).await;
    let records = build_records(&state, &batch, player_id);
    let auth = state.config.client_telemetry_auth.clone();
    // Detached so the response does not wait on the log store. A slow or dead
    // OpenObserve would otherwise add its latency to a player's request.
    tokio::spawn(async move {
        if let Err(error) = forward(&url, auth.as_deref(), &records).await {
            tracing::warn!(error = ?error, "client telemetry forward failed");
        }
    });
    Ok(StatusCode::ACCEPTED)
}

/// Flattens each event into a self-contained row: event fields, then the
/// session's static context, then server-stamped identity.
///
/// Server-stamped keys are written last so a client cannot overwrite them by
/// including its own `playerId`.
fn build_records(state: &AppState, batch: &ClientBatch, player_id: Option<String>) -> Vec<Value> {
    let timestamp = Utc::now().timestamp_micros();
    let context = batch.context.as_object();
    batch
        .events
        .iter()
        .take(MAX_EVENTS_PER_BATCH)
        .map(|event| {
            let mut record = event.as_object().cloned().unwrap_or_else(Map::new);
            if let Some(context) = context {
                for (key, value) in context {
                    record.entry(key.clone()).or_insert_with(|| value.clone());
                }
            }
            record.insert("_timestamp".to_owned(), Value::from(timestamp));
            record.insert(
                "sessionId".to_owned(),
                Value::from(batch.session_id.clone()),
            );
            record.insert(
                "nodeId".to_owned(),
                Value::from(state.config.node_id.clone()),
            );
            record.insert(
                "playerId".to_owned(),
                player_id.clone().map_or(Value::Null, Value::from),
            );
            Value::Object(record)
        })
        .collect()
}

/// Shared so batches reuse connections. A fresh `Client` per request would open
/// a new TCP+TLS connection for every flush from every player.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

async fn forward(url: &str, auth: Option<&str>, records: &[Value]) -> anyhow::Result<()> {
    let mut request = http_client().post(url).json(records);
    if let Some(auth) = auth {
        request = request.header("Authorization", auth);
    }
    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("telemetry ingest returned {status}: {body}");
    }
    Ok(())
}
