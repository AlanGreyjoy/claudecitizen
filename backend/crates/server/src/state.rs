use std::sync::Arc;

use anyhow::Context;
use metrics_exporter_prometheus::PrometheusHandle;
use redis::aio::ConnectionManager;
use sqlx::{PgPool, postgres::PgPoolOptions};
use tokio::sync::RwLock;

use crate::{cell::CellCoordinator, config::Config};

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportInfo {
    pub url: String,
    pub certificate_hash_base64: Option<String>,
    pub listening: bool,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: PgPool,
    pub redis: ConnectionManager,
    pub metrics: PrometheusHandle,
    pub transport: Arc<RwLock<TransportInfo>>,
    pub cells: CellCoordinator,
}

impl AppState {
    pub async fn connect(config: Config, metrics: PrometheusHandle) -> anyhow::Result<Self> {
        let db = PgPoolOptions::new()
            .max_connections(32)
            .min_connections(2)
            .connect(&config.database_url)
            .await
            .context("connect to PostgreSQL")?;
        let redis_client = redis::Client::open(config.redis_url.clone())?;
        let redis = ConnectionManager::new(redis_client.clone())
            .await
            .context("connect to Redis")?;
        let config = Arc::new(config);
        let cells = CellCoordinator::new(
            config.node_id.clone(),
            db.clone(),
            redis.clone(),
            redis_client.clone(),
        );
        Ok(Self {
            transport: Arc::new(RwLock::new(TransportInfo {
                url: config.webtransport_public_url.clone(),
                certificate_hash_base64: None,
                listening: false,
            })),
            config,
            db,
            redis,
            metrics,
            cells,
        })
    }

    pub async fn readiness(&self) -> anyhow::Result<()> {
        sqlx::query("SELECT 1").execute(&self.db).await?;
        let latest_migration: i64 = sqlx::query_scalar(
            r#"SELECT COALESCE(MAX("version"), 0) FROM "_sqlx_migrations" WHERE "success" = TRUE"#,
        )
        .fetch_one(&self.db)
        .await?;
        anyhow::ensure!(latest_migration >= 11, "SQLx migrations are behind");
        let mut redis = self.redis.clone();
        let pong: String = redis::cmd("PING").query_async(&mut redis).await?;
        anyhow::ensure!(pong == "PONG", "Redis PING returned an unexpected response");
        anyhow::ensure!(
            self.transport.read().await.listening,
            "WebTransport endpoint is not listening"
        );
        Ok(())
    }
}
