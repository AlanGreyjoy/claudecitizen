use std::{env, net::SocketAddr, str::FromStr};

use anyhow::{Context, Result, bail};
use cookie::SameSite;

#[derive(Clone, Debug)]
pub struct Config {
    pub node_id: String,
    pub http_bind: SocketAddr,
    pub client_origin: String,
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
        let cookie_same_site = match read("COOKIE_SAME_SITE", "lax").as_str() {
            "strict" => SameSite::Strict,
            "none" => SameSite::None,
            _ => SameSite::Lax,
        };

        Ok(Self {
            node_id: env::var("POD_NAME")
                .or_else(|_| env::var("HOSTNAME"))
                .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string()),
            http_bind,
            client_origin: read("CLIENT_ORIGIN", "http://localhost:4173"),
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
            webtransport_public_url: read(
                "WEBTRANSPORT_PUBLIC_URL",
                "https://localhost:4433/world",
            ),
            webtransport_cert_path: optional("WEBTRANSPORT_CERT_PATH"),
            webtransport_key_path: optional("WEBTRANSPORT_KEY_PATH"),
            run_migrations: read_bool("RUN_MIGRATIONS", !production),
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
