mod admin;
mod auth;
mod cell;
mod config;
mod error;
mod game;
mod health;
mod http;
mod mail;
mod state;
mod world_transport;

use std::time::Duration;

use anyhow::{Context, Result};
use axum::{
    Router,
    http::{HeaderValue, Method, header},
    routing::{get, patch, post, put},
};
use config::Config;
use metrics_exporter_prometheus::PrometheusBuilder;
use state::AppState;
use tokio::net::TcpListener;
use tower_http::{
    catch_panic::CatchPanicLayer, cors::CorsLayer, limit::RequestBodyLimitLayer, trace::TraceLayer,
};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::from_filename("backend/.env");
    init_tracing();
    let config = Config::from_env()?;
    let migrate_only = std::env::args().nth(1).as_deref() == Some("migrate");
    let metrics = PrometheusBuilder::new().install_recorder()?;
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
        .allow_headers([header::CONTENT_TYPE]);
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
        .route(
            "/game/inventory/purchase",
            post(game::purchase_inventory_item),
        )
        .route("/game/inventory/equip", post(game::equip_inventory_item))
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
        .route("/world/session", post(world_transport::create_session))
        .route(
            "/admin/session",
            get(admin::session).post(admin::login).delete(admin::logout),
        )
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/{id}", get(admin::get_user))
        .route("/admin/users/{id}/ships", post(admin::assign_ship))
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
        .layer(RequestBodyLimitLayer::new(512 * 1024))
        .layer(CatchPanicLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state))
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("cc_server=info,tower_http=info")),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();
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
