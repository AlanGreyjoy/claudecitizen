//! Logging, request correlation, and metric recording.
//!
//! Two rules govern everything in here.
//!
//! **Metric labels stay low-cardinality.** `player_id`, `cell_id`, `entity_id`
//! and `session_id` are never labels — each distinct value is a permanent time
//! series, so a player id turns one metric into one-per-account. Those belong
//! in log fields and span attributes, which are indexed for search instead of
//! stored forever. Labels here are limited to matched route, method, status,
//! and a handful of fixed enums.
//!
//! **Per-cell and per-session values are recorded as distributions.** Every
//! cell task writing `cc_cell_entities` as a gauge would have them overwrite
//! each other and the last writer would win. A histogram answers "how loaded is
//! a typical cell, and how loaded is the worst one" without a per-cell series.

use std::{
    collections::HashMap,
    env,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use axum::{
    extract::{MatchedPath, Request},
    http::Response,
    middleware::Next,
    response::IntoResponse,
};
use metrics::{
    Unit, counter, describe_counter, describe_gauge, describe_histogram, gauge, histogram,
};
use opentelemetry::{KeyValue, trace::TracerProvider as _};
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporter, Protocol, SpanExporter, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::{Resource, logs::SdkLoggerProvider, trace::SdkTracerProvider};
use sqlx::PgPool;
use tower_http::trace::MakeSpan;
use tracing::Span;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

pub const HTTP_REQUESTS: &str = "cc_http_requests_total";
pub const HTTP_REQUEST_DURATION: &str = "cc_http_request_duration_seconds";
pub const CELL_TICK_DURATION: &str = "cc_cell_tick_duration_seconds";
pub const CELL_TICK_OVERRUN: &str = "cc_cell_tick_overrun_total";
pub const CELL_ENTITIES: &str = "cc_cell_entities";
pub const CELL_FANOUT_DROPPED: &str = "cc_cell_fanout_dropped_total";
pub const CELLS_OWNED: &str = "cc_cells_owned";
pub const WORLD_SESSIONS: &str = "cc_world_sessions_active";
pub const FRAME_PUBLISH_FALLBACK: &str = "cc_frame_publish_fallback_total";
pub const DB_POOL_CONNECTIONS: &str = "cc_db_pool_connections";
pub const DB_POOL_IDLE: &str = "cc_db_pool_idle";

/// How often the sqlx pool is sampled. The pool exposes counters, not events,
/// so it has to be polled; 10 s is well under any scrape interval worth having.
const POOL_SAMPLE_SECONDS: u64 = 10;

/// The exporter talks OTLP over HTTP using `reqwest`, which logs through
/// `tracing`. Without silencing these targets, exporting a log emits a log,
/// which is exported, which emits a log — a feedback loop that saturates the
/// collector with traffic about itself. `cc_server` output is unaffected.
const EXPORTER_SILENCE: &str = "opentelemetry=off,hyper=off,hyper_util=off,reqwest=off,h2=off";

/// Flushes buffered spans and logs on drop.
///
/// Both providers batch, so without an explicit shutdown everything recorded
/// since the last export interval is lost when the process exits — which is
/// exactly the window that matters when the process exited because of a crash.
pub struct TelemetryGuard {
    tracer_provider: Option<SdkTracerProvider>,
    logger_provider: Option<SdkLoggerProvider>,
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.tracer_provider.take()
            && let Err(error) = provider.shutdown()
        {
            eprintln!("[observability] tracer shutdown failed: {error}");
        }
        if let Some(provider) = self.logger_provider.take()
            && let Err(error) = provider.shutdown()
        {
            eprintln!("[observability] logger shutdown failed: {error}");
        }
    }
}

/// Installs the global subscriber.
///
/// The JSON stdout layer is always present, and OTLP export is added only when
/// `OTEL_EXPORTER_OTLP_ENDPOINT` is set. That default matters: a bare
/// `cargo run` with no collector behaves exactly as it did before this existed,
/// rather than blocking on export attempts to a host that is not there.
pub fn init_tracing(node_id: &str) -> Result<TelemetryGuard> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new(format!("cc_server=info,tower_http=info,{EXPORTER_SILENCE}"))
    });
    let stdout = tracing_subscriber::fmt::layer().json();

    let Some(endpoint) = env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .ok()
        .filter(|value| !value.is_empty())
    else {
        tracing_subscriber::registry()
            .with(filter)
            .with(stdout)
            .init();
        return Ok(TelemetryGuard {
            tracer_provider: None,
            logger_provider: None,
        });
    };

    let endpoint = endpoint.trim_end_matches('/').to_owned();
    let headers = otlp_headers();
    let resource = Resource::builder()
        .with_service_name(env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "cc-server".to_owned()))
        .with_attributes([
            // Which process, when several nodes report the same service name.
            KeyValue::new("service.instance.id", node_id.to_owned()),
            KeyValue::new(
                "deployment.environment.name",
                env::var("APP_ENV").unwrap_or_else(|_| "development".to_owned()),
            ),
        ])
        .build();

    let span_exporter = SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(format!("{endpoint}/v1/traces"))
        .with_headers(headers.clone())
        .build()
        .context("build OTLP span exporter")?;
    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(resource.clone())
        .with_batch_exporter(span_exporter)
        .build();

    let log_exporter = LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(format!("{endpoint}/v1/logs"))
        .with_headers(headers)
        .build()
        .context("build OTLP log exporter")?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(log_exporter)
        .build();

    tracing_subscriber::registry()
        .with(filter)
        .with(stdout)
        .with(tracing_opentelemetry::layer().with_tracer(tracer_provider.tracer("cc-server")))
        .with(OpenTelemetryTracingBridge::new(&logger_provider))
        .init();
    tracing::info!(endpoint, "OTLP export enabled");

    Ok(TelemetryGuard {
        tracer_provider: Some(tracer_provider),
        logger_provider: Some(logger_provider),
    })
}

/// Parses `OTEL_EXPORTER_OTLP_HEADERS` in the W3C form the OTel spec defines:
/// `key1=value1,key2=value2`.
///
/// Split on the *first* `=` only — the usual value here is
/// `Authorization=Basic <base64>`, and base64 padding is `=`.
fn otlp_headers() -> HashMap<String, String> {
    let Some(raw) = env::var("OTEL_EXPORTER_OTLP_HEADERS")
        .ok()
        .filter(|value| !value.is_empty())
    else {
        return HashMap::new();
    };
    raw.split(',')
        .filter_map(|entry| entry.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .collect()
}

/// Register help text and units. Without this a scrape is a wall of bare names
/// with no indication of what they measure or which direction is bad.
pub fn describe_metrics() {
    describe_counter!(HTTP_REQUESTS, "HTTP requests by matched route and status");
    describe_histogram!(
        HTTP_REQUEST_DURATION,
        Unit::Seconds,
        "HTTP handler latency by matched route"
    );
    describe_histogram!(
        CELL_TICK_DURATION,
        Unit::Seconds,
        "Wall time of one authoritative cell tick"
    );
    describe_counter!(
        CELL_TICK_OVERRUN,
        "Cell ticks that ran longer than the fixed timestep"
    );
    describe_histogram!(CELL_ENTITIES, "Entities simulated by one cell, sampled");
    describe_counter!(
        CELL_FANOUT_DROPPED,
        "Snapshot frames dropped because the fan-out queue was full"
    );
    describe_gauge!(CELLS_OWNED, "Cells this node currently holds a lease on");
    describe_gauge!(WORLD_SESSIONS, "Open WebTransport world sessions");
    describe_counter!(
        FRAME_PUBLISH_FALLBACK,
        "Snapshots sent over the reliable stream instead of a datagram"
    );
    describe_gauge!(DB_POOL_CONNECTIONS, "PostgreSQL pool connections");
    describe_gauge!(DB_POOL_IDLE, "Idle PostgreSQL pool connections");
}

/// Names the request span. Runs outside the router, so `MatchedPath` is not set
/// yet and the raw path is used — fine for a log field, which is why the metric
/// label is recorded separately in [`track_http_metrics`] instead.
#[derive(Clone, Copy, Debug)]
pub struct HttpSpan;

impl<B> MakeSpan<B> for HttpSpan {
    fn make_span(&mut self, request: &axum::http::Request<B>) -> Span {
        let request_id = request
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        tracing::info_span!(
            "http_request",
            method = %request.method(),
            path = %request.uri().path(),
            request_id = %request_id,
        )
    }
}

/// Emits exactly one line per request, carrying status and latency.
///
/// Deliberately not `FmtSpan::CLOSE`: span-close events would duplicate this
/// with a less useful shape, and every 5xx already gets a detailed line from
/// `ApiError::into_response`.
#[derive(Clone, Copy, Debug)]
pub struct HttpResponseLog;

impl<B> tower_http::trace::OnResponse<B> for HttpResponseLog {
    fn on_response(self, response: &Response<B>, latency: Duration, _span: &Span) {
        tracing::info!(
            status = response.status().as_u16(),
            latency_ms = latency.as_secs_f64() * 1000.0,
            "request completed"
        );
    }
}

/// Records request count and latency against the **matched** route.
///
/// Applied with `route_layer`, so it only runs once axum has matched a route.
/// That is the point: `/game/chest/{chest_id}` is one series, while the raw URI
/// path would mint a new series per chest and unbounded series for 404 spam.
pub async fn track_http_metrics(request: Request, next: Next) -> impl IntoResponse {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".to_owned());
    let method = request.method().as_str().to_owned();
    let started = Instant::now();
    let response = next.run(request).await;
    let latency = started.elapsed();
    histogram!(HTTP_REQUEST_DURATION, "route" => route.clone(), "method" => method.clone())
        .record(latency.as_secs_f64());
    counter!(
        HTTP_REQUESTS,
        "route" => route,
        "method" => method,
        "status" => response.status().as_u16().to_string(),
    )
    .increment(1);
    response
}

/// Samples sqlx pool occupancy on a timer.
///
/// Saturation here is the usual cause of latency that looks like "the database
/// is slow" while Postgres itself is idle — every connection is checked out and
/// handlers are queued behind the pool, not behind a query.
pub async fn run_pool_sampler(db: PgPool) {
    let mut ticker = tokio::time::interval(Duration::from_secs(POOL_SAMPLE_SECONDS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        gauge!(DB_POOL_CONNECTIONS).set(f64::from(db.size()));
        gauge!(DB_POOL_IDLE).set(db.num_idle() as f64);
    }
}

/// Holds the open-session gauge for the lifetime of one WebTransport session.
///
/// A guard rather than a matched increment/decrement pair because the session
/// loop exits through `?` on a dozen paths; a manual decrement would be skipped
/// by every one of them and the gauge would only ever climb.
#[derive(Debug)]
pub struct SessionGuard;

impl SessionGuard {
    pub fn open() -> Self {
        gauge!(WORLD_SESSIONS).increment(1.0);
        Self
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        gauge!(WORLD_SESSIONS).decrement(1.0);
    }
}

pub fn record_cells_owned(count: usize) {
    gauge!(CELLS_OWNED).set(count as f64);
}

pub fn record_cell_tick(elapsed: Duration, budget: Duration) {
    histogram!(CELL_TICK_DURATION).record(elapsed.as_secs_f64());
    if elapsed > budget {
        counter!(CELL_TICK_OVERRUN).increment(1);
    }
}

pub fn record_cell_entities(count: usize) {
    histogram!(CELL_ENTITIES).record(count as f64);
}

pub fn record_fanout_drop() {
    counter!(CELL_FANOUT_DROPPED).increment(1);
}

/// `reason` is a fixed enum — `"budget"` when the payload exceeds the datagram
/// budget, `"refused"` when the transport rejected it. Never derived from an
/// error string, which would be unbounded.
pub fn record_frame_fallback(reason: &'static str) {
    counter!(FRAME_PUBLISH_FALLBACK, "reason" => reason).increment(1);
}
