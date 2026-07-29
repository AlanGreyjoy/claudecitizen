use std::{env, net::SocketAddr, str::FromStr};

use anyhow::{Context, Result, bail};
use cookie::SameSite;

#[derive(Clone, Debug)]
pub struct Config {
    pub node_id: String,
    pub http_bind: SocketAddr,
    pub client_origin: String,
    /// Origins accepted on the WebTransport handshake. Separate from
    /// `client_origin` (which is also the single CORS origin) because the
    /// desktop editor's game windows dial from a custom scheme that must never
    /// be granted CORS access to the REST API. The literal `null` entry accepts
    /// a missing `Origin` header, which some privileged schemes send.
    pub webtransport_allowed_origins: Vec<String>,
    pub database_url: String,
    pub redis_url: String,
    pub jwt_access_secret: String,
    pub jwt_refresh_secret: String,
    pub admin_email: String,
    pub admin_password: String,
    pub admin_session_secret: String,
    pub cookie_domain: Option<String>,
    pub cookie_same_site: SameSite,
    pub cookie_secure: bool,
    pub discord_client_id: String,
    pub discord_client_secret: String,
    pub discord_redirect_uri: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_pass: String,
    pub smtp_from: String,
    pub webtransport_bind: SocketAddr,
    pub webtransport_public_url: String,
    pub webtransport_cert_path: Option<String>,
    pub webtransport_key_path: Option<String>,
    pub run_migrations: bool,
    /// Base64 32-byte key that wraps Stripe secrets at rest. Empty disables console storage.
    pub payments_encryption_key: String,
    /// Optional env override for the console-stored Stripe secret key.
    pub stripe_secret_key: Option<String>,
    /// Optional env override for the console-stored Stripe webhook signing secret.
    pub stripe_webhook_secret: Option<String>,
    pub api_public_url: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let production = read("APP_ENV", "development") == "production";
        let http_bind = SocketAddr::from_str(&read("HTTP_BIND", "0.0.0.0:3000"))
            .context("HTTP_BIND must be a socket address")?;
        let api_public_url = read("API_PUBLIC_URL", "http://localhost:3000");
        let webtransport_bind = SocketAddr::from_str(&read("WEBTRANSPORT_BIND", "0.0.0.0:4433"))
            .context("WEBTRANSPORT_BIND must be a socket address")?;
        let jwt_access_secret = read("JWT_ACCESS_SECRET", "dev-access-secret-change-me");
        let jwt_refresh_secret = read("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me");
        if production
            && (jwt_access_secret.starts_with("dev-") || jwt_refresh_secret.starts_with("dev-"))
        {
            bail!("production JWT secrets must be configured");
        }
        let payments_encryption_key = read("PAYMENTS_ENCRYPTION_KEY", "");
        let stripe_secret_key = optional("STRIPE_SECRET_KEY");
        if production && stripe_secret_key.is_some() && payments_encryption_key.is_empty() {
            bail!("PAYMENTS_ENCRYPTION_KEY must be configured when Stripe is enabled");
        }
        let cookie_same_site = match read("COOKIE_SAME_SITE", "lax").as_str() {
            "strict" => SameSite::Strict,
            "none" => SameSite::None,
            _ => SameSite::Lax,
        };
        let client_origin = read("CLIENT_ORIGIN", "http://localhost:4173");
        let webtransport_allowed_origins = read("WEBTRANSPORT_ALLOWED_ORIGINS", &client_origin)
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect::<Vec<String>>();

        Ok(Self {
            node_id: env::var("POD_NAME")
                .or_else(|_| env::var("HOSTNAME"))
                .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string()),
            http_bind,
            client_origin,
            webtransport_allowed_origins,
            database_url: read(
                "DATABASE_URL",
                "postgresql://claude:citizen@localhost:5432/claude_citizen",
            ),
            redis_url: read("REDIS_URL", "redis://localhost:6379"),
            jwt_access_secret: jwt_access_secret.clone(),
            jwt_refresh_secret,
            admin_email: read("ADMIN_EMAIL", "admin@claude-citizen.com"),
            admin_password: read("ADMIN_PASSWORD", ""),
            admin_session_secret: read("ADMIN_SESSION_SECRET", &jwt_access_secret),
            cookie_domain: optional("COOKIE_DOMAIN"),
            cookie_same_site,
            cookie_secure: read_bool("COOKIE_SECURE", production),
            discord_client_id: read("DISCORD_CLIENT_ID", ""),
            discord_client_secret: read("DISCORD_CLIENT_SECRET", ""),
            discord_redirect_uri: read(
                "DISCORD_REDIRECT_URI",
                &format!("{api_public_url}/auth/discord/callback"),
            ),
            smtp_host: read("SMTP_HOST", ""),
            smtp_port: read_number("SMTP_PORT", 587),
            smtp_user: read("SMTP_USER", ""),
            smtp_pass: read("SMTP_PASS", ""),
            smtp_from: read("SMTP_FROM", "ClaudeCitizen <noreply@localhost>"),
            webtransport_bind,
            // An IP literal, not `localhost`. Chromium's resolver maps
            // localhost to ::1 ahead of 127.0.0.1 regardless of /etc/hosts,
            // and `WEBTRANSPORT_BIND` defaults to IPv4 — a `localhost` dial
            // therefore reaches nothing and surfaces in the browser as the
            // opaque `WebTransportError: Opening handshake failed.`
            webtransport_public_url: read(
                "WEBTRANSPORT_PUBLIC_URL",
                "https://127.0.0.1:4433/world",
            ),
            webtransport_cert_path: optional("WEBTRANSPORT_CERT_PATH"),
            webtransport_key_path: optional("WEBTRANSPORT_KEY_PATH"),
            run_migrations: read_bool("RUN_MIGRATIONS", !production),
            payments_encryption_key,
            stripe_secret_key,
            stripe_webhook_secret: optional("STRIPE_WEBHOOK_SECRET"),
            api_public_url,
        })
    }
}

fn read(name: &str, fallback: &str) -> String {
    env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

fn optional(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.is_empty())
}

fn read_bool(name: &str, fallback: bool) -> bool {
    optional(name)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(fallback)
}

fn read_number<T: FromStr>(name: &str, fallback: T) -> T {
    optional(name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}
