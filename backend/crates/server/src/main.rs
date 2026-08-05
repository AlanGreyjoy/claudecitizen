mod admin;
mod admin_catalog;
mod admin_payments;
mod auth;
mod cell;
mod config;
mod error;
mod game;
mod grid;
mod health;
mod http;
mod mail;
mod mall;
mod observability;
mod payments;
mod replication;
mod state;
mod telemetry;
mod world_transport;

use std::time::Duration;

use anyhow::{Context, Result};
use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, header},
    middleware,
    routing::{get, patch, post, put},
};
use config::Config;
use metrics_exporter_prometheus::PrometheusBuilder;
use state::AppState;
use tokio::net::TcpListener;
use tower_http::{
    catch_panic::CatchPanicLayer,
    cors::CorsLayer,
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

#[tokio::main]
async fn main() -> Result<()> {
    load_dotenv();
    // Config is read before the subscriber is installed because the OTLP
    // resource needs `node_id`. Nothing in `from_env` logs — it fails by
    // returning, and that error still reaches stderr through `main`.
    let config = Config::from_env()?;
    let _telemetry = observability::init_tracing(&config.node_id)?;
    let migrate_only = std::env::args().nth(1).as_deref() == Some("migrate");
    let metrics = PrometheusBuilder::new().install_recorder()?;
    observability::describe_metrics();
    let state = AppState::connect(config, metrics).await?;
    if state.config.run_migrations || migrate_only {
        sqlx::migrate!("../../migrations")
            .run(&state.db)
            .await
            .context("apply SQLx migrations")?;
    }
    if migrate_only {
        tracing::info!("database migrations applied");
        return Ok(());
    }

    let webtransport_state = state.clone();
    let webtransport = tokio::spawn(async move { world_transport::run(webtransport_state).await });
    tokio::spawn(observability::run_pool_sampler(state.db.clone()));
    let app = router(state.clone())?;
    let listener = TcpListener::bind(state.config.http_bind)
        .await
        .context("bind HTTP server")?;
    tracing::info!(bind = %state.config.http_bind, node_id = state.config.node_id, "Rust backend listening");
    let server = axum::serve(listener, app).with_graceful_shutdown(shutdown_signal());
    tokio::select! {
        result = server => result.context("HTTP server failed")?,
        result = webtransport => {
            result.context("WebTransport task panicked")??;
        }
    }
    Ok(())
}

/// Loads `backend/.env` when present, and complains loudly when it is malformed.
///
/// A missing file is normal — the runtime image has none and every value comes
/// from the environment. A *parse error* is not: dotenvy stops at the offending
/// line, so every variable below it is silently missing and the server starts
/// looking healthy. That failure mode cost a long debugging session once, where
/// an unquoted `Authorization=Basic <token>` truncated at the space and the only
/// evidence was a 401 in another service's access log.
///
/// The message deliberately does not echo the line: these files hold secrets.
fn load_dotenv() {
    match dotenvy::from_filename("backend/.env") {
        Ok(_) => {}
        // The path is CWD-relative, so this is also the normal case when the
        // server is run from anywhere but the repository root.
        Err(dotenvy::Error::Io(_)) => {}
        Err(error) => {
            // Before `init_tracing`, so there is no subscriber to log through.
            eprintln!(
                "[config] backend/.env could not be parsed ({}); variables at or below \
                 the bad line were NOT loaded. Values containing spaces must be quoted, \
                 e.g. OTEL_EXPORTER_OTLP_HEADERS=\"Authorization=Basic <token>\".",
                match error {
                    dotenvy::Error::LineParse(_, index) => format!("bad syntax at column {index}"),
                    other => other.to_string(),
                }
            );
        }
    }
}

fn router(state: AppState) -> Result<Router> {
    let origin = HeaderValue::from_str(&state.config.client_origin)
        .context("CLIENT_ORIGIN must be a valid HTTP header value")?;
    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        // `X-Client-Session` carries the browser's telemetry session id. Without
        // it in the allow-list the preflight fails and every REST call dies.
        .allow_headers([
            header::CONTENT_TYPE,
            HeaderName::from_static("x-client-session"),
        ])
        // Set by `SetRequestIdLayer` and echoed by `PropagateRequestIdLayer`.
        // Without exposing it the browser can see the response but not its
        // request id, so a client error report has nothing to join to the
        // server-side span.
        .expose_headers([HeaderName::from_static("x-request-id")]);
    // Catalog import carries weapon icon data-URLs (~3MB+). Axum's default body
    // limit is 2MB — RequestBodyLimitLayer alone does not raise it; Json extract
    // still hits DefaultBodyLimit ("length limit exceeded").
    let catalog = Router::new()
        .route(
            "/admin/catalog/export",
            get(admin_catalog::export_catalog),
        )
        .route(
            "/admin/catalog/import",
            put(admin_catalog::import_catalog),
        )
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .layer(RequestBodyLimitLayer::new(16 * 1024 * 1024))
        .with_state(state.clone());

    Ok(Router::new()
        .route("/livez", get(health::live))
        .route("/readyz", get(health::ready))
        .route("/metrics", get(health::metrics))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/refresh", post(auth::refresh))
        .route("/auth/forgot-password", post(auth::forgot_password))
        .route("/auth/reset-password", post(auth::reset_password))
        .route("/auth/discord/start", get(auth::discord_start))
        .route("/auth/discord/callback", get(auth::discord_callback))
        .route("/game/bootstrap", get(game::bootstrap))
        .route("/game/character", put(game::save_character))
        .route("/game/vitals/session", post(game::start_vitals_session))
        .route(
            "/game/vitals/session/{id}/pulse",
            post(game::pulse_vitals_session),
        )
        .route(
            "/game/vitals/session/{id}/resume",
            post(game::resume_vitals_session),
        )
        .route(
            "/game/vitals/session/{id}/stop",
            post(game::stop_vitals_session),
        )
        .route(
            "/game/inventory/purchase",
            post(game::purchase_inventory_item),
        )
        .route(
            "/game/inventory/consume",
            post(game::consume_inventory_item),
        )
        .route(
            "/game/inventory/consume-ammo",
            post(game::consume_inventory_ammo),
        )
        .route("/game/inventory/equip", post(game::equip_inventory_item))
        .route("/game/chest/deposit", post(game::deposit_chest_item))
        .route("/game/chest/withdraw", post(game::withdraw_chest_item))
        .route("/game/chest/{chest_id}", get(game::get_chest_contents))
        .route("/game/hangar/build", get(game::get_hangar_build))
        .route("/game/apartment/build", get(game::get_apartment_build))
        .route("/game/hangar/purchase", post(game::purchase_hangar_prop))
        .route(
            "/game/apartment/purchase",
            post(game::purchase_apartment_prop),
        )
        .route(
            "/game/hangar/placements",
            post(game::create_hangar_placement),
        )
        .route(
            "/game/apartment/placements",
            post(game::create_apartment_placement),
        )
        .route(
            "/game/hangar/placements/{id}",
            patch(game::update_hangar_placement).delete(game::delete_hangar_placement),
        )
        .route(
            "/game/apartment/placements/{id}",
            patch(game::update_apartment_placement).delete(game::delete_apartment_placement),
        )
        .route(
            "/game/hangar/assigned-bay",
            post(game::set_assigned_bay).delete(game::reset_assigned_bay),
        )
        .route("/payments/packs", get(payments::list_packs))
        .route("/payments/checkout", post(payments::create_checkout))
        .route("/payments/purchases", get(payments::list_purchases))
        // Unauthenticated by design: Stripe authenticates with an HMAC over the raw body.
        .route("/payments/stripe/webhook", post(payments::stripe_webhook))
        .route("/game/mall", get(mall::list_mall))
        .route("/game/mall/purchase", post(mall::purchase_mall_item))
        .route("/world/session", post(world_transport::create_session))
        // Unauthenticated by design: a crash on the title screen, before any
        // login, is exactly the report worth keeping. Identity is stamped from
        // the session cookie when one is present, never from the body.
        .route("/telemetry/client", post(telemetry::ingest))
        .route(
            "/admin/session",
            get(admin::session).post(admin::login).delete(admin::logout),
        )
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/{id}", get(admin::get_user))
        .route("/admin/users/{id}/ships", post(admin::assign_ship))
        .route(
            "/admin/users/{id}/credits",
            get(admin_payments::list_player_ledger).post(admin_payments::grant_credits),
        )
        .route(
            "/admin/payments/config",
            get(admin_payments::get_payment_config).put(admin_payments::update_payment_config),
        )
        .route(
            "/admin/payments/purchases",
            get(admin_payments::list_purchases),
        )
        .route(
            "/admin/credit-packs",
            get(admin_payments::list_credit_packs).post(admin_payments::create_credit_pack),
        )
        .route(
            "/admin/credit-packs/{id}",
            patch(admin_payments::update_credit_pack).delete(admin_payments::delete_credit_pack),
        )
        .route("/admin/mall/preview", get(admin_payments::preview_mall))
        .route(
            "/admin/mall",
            get(admin_payments::list_mall_listings).post(admin_payments::create_mall_listing),
        )
        .route(
            "/admin/mall/{id}",
            patch(admin_payments::update_mall_listing).delete(admin_payments::delete_mall_listing),
        )
        .route(
            "/admin/ships",
            get(admin::list_ships).post(admin::create_ship),
        )
        .route("/admin/ships/{id}", patch(admin::update_ship))
        .route(
            "/admin/settings",
            get(admin::get_settings).put(admin::update_settings),
        )
        .route(
            "/admin/props",
            get(admin::list_props).post(admin::create_prop),
        )
        .route("/admin/props/{id}", patch(admin::update_prop))
        .route(
            "/admin/items",
            get(admin::list_items).post(admin::create_item),
        )
        .route(
            "/admin/items/{id}",
            patch(admin::update_item).delete(admin::delete_item),
        )
        .route(
            "/admin/weapons",
            get(admin::list_weapons).post(admin::create_weapon),
        )
        .route(
            "/admin/weapons/{id}",
            patch(admin::update_weapon).delete(admin::delete_weapon),
        )
        .route(
            "/admin/backpacks",
            get(admin::list_backpacks).post(admin::create_backpack),
        )
        .route(
            "/admin/backpacks/{id}",
            patch(admin::update_backpack).delete(admin::delete_backpack),
        )
        .route(
            "/admin/wearables",
            get(admin::list_wearables).post(admin::create_wearable),
        )
        .route(
            "/admin/wearables/{id}",
            patch(admin::update_wearable).delete(admin::delete_wearable),
        )
        .layer(RequestBodyLimitLayer::new(512 * 1024))
        .merge(catalog)
        // route_layer, not layer: this only runs once axum has matched a route,
        // which is what makes `MatchedPath` available and keeps the metric's
        // route label bounded. Unmatched paths are not worth a time series.
        .route_layer(middleware::from_fn(observability::track_http_metrics))
        .layer(CatchPanicLayer::new())
        // Ordering matters and reads bottom-up: the last layer applied is the
        // outermost. `SetRequestId` has to run before the span is built so the
        // id lands in it, and `PropagateRequestId` has to run after the handler
        // so it can copy that id onto the response.
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(observability::HttpSpan)
                .on_response(observability::HttpResponseLog)
                // Suppressed: every 5xx already logs its chain and backtrace in
                // `ApiError::into_response`, and the default here would emit a
                // second, thinner line for the same failure.
                .on_failure(()),
        )
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(cors)
        .with_state(state))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!(
        grace_period_seconds = Duration::from_secs(20).as_secs(),
        "shutdown requested"
    );
}
