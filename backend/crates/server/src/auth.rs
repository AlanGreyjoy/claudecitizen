use std::time::Duration;

use axum::{
    Json,
    extract::{FromRequestParts, Query, State},
    http::{HeaderMap, StatusCode, request::Parts},
    response::{IntoResponse, Redirect, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use bcrypt::{DEFAULT_COST, hash, verify};
use chrono::{Duration as ChronoDuration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use rand::RngCore;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::Row;
use tokio::task::spawn_blocking;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    http::{auth_cookie, clear_cookie, cookie_headers, read_cookie},
    mail,
    state::AppState,
};

const ACCESS_TTL: Duration = Duration::from_secs(15 * 60);
const REFRESH_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const ADMIN_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const ACCESS_AUDIENCE: &str = "claudecitizen-api";
const REFRESH_AUDIENCE: &str = "claudecitizen-refresh";
const ADMIN_AUDIENCE: &str = "claudecitizen-admin";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    pub typ: String,
    pub aud: String,
    pub exp: usize,
    pub iat: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jti: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fam: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AccessUser {
    pub user_id: String,
}

#[derive(Clone, Debug)]
pub struct AdminUser;

impl FromRequestParts<AppState> for AccessUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = read_cookie(&parts.headers, "cc_at")
            .ok_or_else(|| ApiError::Unauthorized("Missing access cookie.".to_owned()))?;
        let claims = decode_claims(
            &token,
            &state.config.jwt_access_secret,
            "access",
            ACCESS_AUDIENCE,
        )?;
        Ok(Self {
            user_id: claims.sub,
        })
    }
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = read_cookie(&parts.headers, "cc_admin")
            .ok_or_else(|| ApiError::Unauthorized("Admin session is missing.".to_owned()))?;
        let claims = decode_claims(
            &token,
            &state.config.admin_session_secret,
            "admin",
            ADMIN_AUDIENCE,
        )?;
        if claims.sub != normalize_email(&state.config.admin_email) {
            return Err(ApiError::Unauthorized(
                "Admin session is invalid.".to_owned(),
            ));
        }
        Ok(Self)
    }
}

#[derive(Deserialize)]
pub struct RegisterBody {
    email: String,
    username: String,
    password: String,
}

#[derive(Deserialize)]
pub struct LoginBody {
    identifier: String,
    password: String,
}

#[derive(Deserialize)]
pub struct ForgotPasswordBody {
    email: String,
}

#[derive(Deserialize)]
pub struct ResetPasswordBody {
    token: String,
    password: String,
}

#[derive(Deserialize)]
pub struct DiscordCallbackQuery {
    code: Option<String>,
    state: Option<String>,
}

#[derive(Deserialize)]
struct DiscordTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct DiscordUserResponse {
    id: String,
    username: String,
    global_name: Option<String>,
    email: Option<String>,
    verified: Option<bool>,
}

#[derive(Debug)]
struct IssuedTokens {
    access: String,
    refresh: String,
    refresh_id: String,
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> ApiResult<Response> {
    rate_limit(&state, "register", 10, 60).await?;
    let email = normalize_email(&body.email);
    let username = normalize_username(&body.username);
    if !email.contains('@') {
        return Err(ApiError::BadRequest("Email is invalid.".to_owned()));
    }
    if username.len() < 3 {
        return Err(ApiError::BadRequest("Username is too short.".to_owned()));
    }
    require_password(&body.password)?;
    let password = body.password;
    let password_hash = spawn_blocking(move || hash(password, DEFAULT_COST))
        .await
        .map_err(anyhow::Error::from)?
        .map_err(anyhow::Error::from)?;
    let user_id = Uuid::new_v4().to_string();
    let player_id = Uuid::new_v4().to_string();
    let display_name = body.username.trim().to_owned();
    let mut transaction = state.db.begin().await?;
    let inserted = sqlx::query(
        r#"INSERT INTO "User"
           ("id", "email", "username", "displayName", "passwordHash", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())"#,
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&username)
    .bind(&display_name)
    .bind(&password_hash)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = inserted {
        if is_unique_violation(&error) {
            return Err(ApiError::Conflict(
                "Email or username is already taken.".to_owned(),
            ));
        }
        return Err(error.into());
    }
    sqlx::query(
        r#"INSERT INTO "Player"
           ("id", "userId", "handle", "displayName", "currentInstanceId", "currentRoomId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'hab-room', NOW(), NOW())"#,
    )
    .bind(&player_id)
    .bind(&user_id)
    .bind(&username)
    .bind(&display_name)
    .bind(format!("apartment:{user_id}"))
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    let tokens = issue_tokens(&state, &user_id, None).await?;
    auth_response(&state, &user_id, tokens).await
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> ApiResult<Response> {
    rate_limit(&state, "login", 20, 60).await?;
    let identifier = body.identifier.trim().to_lowercase();
    let row = sqlx::query(
        r#"SELECT "id", "passwordHash" FROM "User"
           WHERE "email" = $1 OR "username" = $2 LIMIT 1"#,
    )
    .bind(&identifier)
    .bind(normalize_username(&identifier))
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else {
        return Err(ApiError::Unauthorized("Invalid credentials.".to_owned()));
    };
    let password_hash: Option<String> = row.try_get("passwordHash")?;
    let Some(password_hash) = password_hash else {
        return Err(ApiError::Unauthorized("Invalid credentials.".to_owned()));
    };
    let password = body.password;
    let valid = spawn_blocking(move || verify(password, &password_hash))
        .await
        .map_err(anyhow::Error::from)?
        .map_err(anyhow::Error::from)?;
    if !valid {
        return Err(ApiError::Unauthorized("Invalid credentials.".to_owned()));
    }
    let user_id: String = row.try_get("id")?;
    let tokens = issue_tokens(&state, &user_id, None).await?;
    auth_response(&state, &user_id, tokens).await
}

pub async fn me(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<serde_json::Value>> {
    Ok(Json(session_for_user(&state, &access.user_id).await?))
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    if let Some(refresh) = read_cookie(&headers, "cc_rt") {
        sqlx::query(
            r#"UPDATE "RefreshToken" SET "revokedAt" = NOW()
               WHERE "tokenHash" = $1 AND "revokedAt" IS NULL"#,
        )
        .bind(sha256(&refresh))
        .execute(&state.db)
        .await?;
    }
    let headers = cookie_headers([
        clear_cookie(&state.config, "cc_at"),
        clear_cookie(&state.config, "cc_rt"),
    ]);
    Ok((headers, StatusCode::NO_CONTENT).into_response())
}

pub async fn refresh(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    rate_limit(&state, "refresh", 60, 60).await?;
    let refresh = read_cookie(&headers, "cc_rt")
        .ok_or_else(|| ApiError::Unauthorized("Missing refresh cookie.".to_owned()))?;
    let claims = decode_claims(
        &refresh,
        &state.config.jwt_refresh_secret,
        "refresh",
        REFRESH_AUDIENCE,
    )?;
    let refresh_id = claims
        .jti
        .as_deref()
        .ok_or_else(|| ApiError::Unauthorized("Refresh token is invalid.".to_owned()))?;
    let family_id = claims
        .fam
        .clone()
        .ok_or_else(|| ApiError::Unauthorized("Refresh token is invalid.".to_owned()))?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        r#"SELECT "id" FROM "RefreshToken"
           WHERE "tokenHash" = $1 AND "userId" = $2 AND "revokedAt" IS NULL AND "expiresAt" > NOW()
           FOR UPDATE"#,
    )
    .bind(sha256(&refresh))
    .bind(&claims.sub)
    .fetch_optional(&mut *tx)
    .await?;
    if row
        .as_ref()
        .and_then(|value| value.try_get::<String, _>("id").ok())
        .as_deref()
        != Some(refresh_id)
    {
        return Err(ApiError::Unauthorized(
            "Refresh token is invalid.".to_owned(),
        ));
    }
    let tokens = build_tokens(&state, &claims.sub, Some(family_id))?;
    sqlx::query(
        r#"INSERT INTO "RefreshToken"
           ("id", "userId", "tokenHash", "familyId", "expiresAt", "createdAt")
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days', NOW())"#,
    )
    .bind(&tokens.refresh_id)
    .bind(&claims.sub)
    .bind(sha256(&tokens.refresh))
    .bind(claims.fam.unwrap_or_default())
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE "RefreshToken" SET "revokedAt" = NOW(), "replacedByTokenId" = $2
           WHERE "id" = $1"#,
    )
    .bind(refresh_id)
    .bind(&tokens.refresh_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    auth_response(&state, &claims.sub, tokens).await
}

pub async fn forgot_password(
    State(state): State<AppState>,
    Json(body): Json<ForgotPasswordBody>,
) -> ApiResult<impl IntoResponse> {
    rate_limit(&state, "forgot-password", 5, 300).await?;
    let email = normalize_email(&body.email);
    let row = sqlx::query(r#"SELECT "id" FROM "User" WHERE "email" = $1"#)
        .bind(&email)
        .fetch_optional(&state.db)
        .await?;
    if let Some(row) = row {
        let user_id: String = row.try_get("id")?;
        let token = random_token(32);
        sqlx::query(
            r#"INSERT INTO "PasswordResetToken"
               ("id", "userId", "tokenHash", "expiresAt", "createdAt")
               VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes', NOW())"#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(user_id)
        .bind(sha256(&token))
        .execute(&state.db)
        .await?;
        let reset_url = format!(
            "{}/?auth=reset&token={}",
            state.config.client_origin,
            url::form_urlencoded::byte_serialize(token.as_bytes()).collect::<String>()
        );
        mail::send_password_reset(&state.config, &email, &reset_url).await?;
    }
    Ok((StatusCode::ACCEPTED, Json(json!({ "ok": true }))))
}

pub async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordBody>,
) -> ApiResult<Response> {
    require_password(&body.password)?;
    let row = sqlx::query(
        r#"SELECT "id", "userId" FROM "PasswordResetToken"
           WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > NOW()"#,
    )
    .bind(sha256(&body.token))
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::Unauthorized("Reset token is invalid or expired.".to_owned()))?;
    let reset_id: String = row.try_get("id")?;
    let user_id: String = row.try_get("userId")?;
    let password = body.password;
    let password_hash = spawn_blocking(move || hash(password, DEFAULT_COST))
        .await
        .map_err(anyhow::Error::from)?
        .map_err(anyhow::Error::from)?;
    let mut tx = state.db.begin().await?;
    sqlx::query(r#"UPDATE "User" SET "passwordHash" = $2, "updatedAt" = NOW() WHERE "id" = $1"#)
        .bind(&user_id)
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;
    sqlx::query(r#"UPDATE "PasswordResetToken" SET "usedAt" = NOW() WHERE "id" = $1"#)
        .bind(reset_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"UPDATE "RefreshToken" SET "revokedAt" = NOW()
           WHERE "userId" = $1 AND "revokedAt" IS NULL"#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let headers = cookie_headers([
        clear_cookie(&state.config, "cc_at"),
        clear_cookie(&state.config, "cc_rt"),
    ]);
    Ok((headers, StatusCode::NO_CONTENT).into_response())
}

pub async fn discord_start(State(state): State<AppState>) -> ApiResult<Redirect> {
    if state.config.discord_client_id.is_empty() {
        return Err(ApiError::BadRequest(
            "Discord OAuth is not configured.".to_owned(),
        ));
    }
    let oauth_state = random_token(24);
    let mut redis = state.redis.clone();
    let _: () = redis
        .set_ex(format!("oauth:discord:{oauth_state}"), "1", 600)
        .await?;
    let url = url::Url::parse_with_params(
        "https://discord.com/oauth2/authorize",
        [
            ("client_id", state.config.discord_client_id.as_str()),
            ("redirect_uri", state.config.discord_redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", "identify email"),
            ("state", oauth_state.as_str()),
        ],
    )
    .map_err(anyhow::Error::from)?;
    Ok(Redirect::temporary(url.as_str()))
}

pub async fn discord_callback(
    State(state): State<AppState>,
    Query(query): Query<DiscordCallbackQuery>,
) -> Response {
    match finish_discord(&state, query).await {
        Ok((user_id, tokens)) => match auth_response(&state, &user_id, tokens).await {
            Ok(response) => {
                let (mut parts, _) = response.into_parts();
                parts.status = StatusCode::TEMPORARY_REDIRECT;
                if let Ok(location) =
                    format!("{}/?auth=discord-success", state.config.client_origin).parse()
                {
                    parts.headers.insert(axum::http::header::LOCATION, location);
                }
                Response::from_parts(parts, axum::body::Body::empty())
            }
            Err(error) => discord_error_redirect(&state, &error.to_string()),
        },
        Err(error) => discord_error_redirect(&state, &error.to_string()),
    }
}

async fn finish_discord(
    state: &AppState,
    query: DiscordCallbackQuery,
) -> ApiResult<(String, IssuedTokens)> {
    let code = query.code.unwrap_or_default();
    let oauth_state = query.state.unwrap_or_default();
    if code.is_empty() || oauth_state.is_empty() {
        return Err(ApiError::BadRequest(
            "Discord callback is missing state or code.".to_owned(),
        ));
    }
    let mut redis = state.redis.clone();
    let key = format!("oauth:discord:{oauth_state}");
    let valid: Option<String> = redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut redis)
        .await?;
    if valid.is_none() {
        return Err(ApiError::Unauthorized("Discord state expired.".to_owned()));
    }
    if state.config.discord_client_id.is_empty() || state.config.discord_client_secret.is_empty() {
        return Err(ApiError::BadRequest(
            "Discord OAuth is not configured.".to_owned(),
        ));
    }
    let client = reqwest::Client::new();
    let token: DiscordTokenResponse = client
        .post("https://discord.com/api/oauth2/token")
        .form(&[
            ("client_id", state.config.discord_client_id.as_str()),
            ("client_secret", state.config.discord_client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", state.config.discord_redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(anyhow::Error::from)?
        .error_for_status()
        .map_err(anyhow::Error::from)?
        .json()
        .await
        .map_err(anyhow::Error::from)?;
    let discord: DiscordUserResponse = client
        .get("https://discord.com/api/users/@me")
        .bearer_auth(token.access_token)
        .send()
        .await
        .map_err(anyhow::Error::from)?
        .error_for_status()
        .map_err(anyhow::Error::from)?
        .json()
        .await
        .map_err(anyhow::Error::from)?;
    let user_id = if let Some(row) =
        sqlx::query(r#"SELECT "id" FROM "User" WHERE "discordId" = $1"#)
            .bind(&discord.id)
            .fetch_optional(&state.db)
            .await?
    {
        row.try_get("id")?
    } else {
        create_discord_user(state, discord).await?
    };
    let tokens = issue_tokens(state, &user_id, None).await?;
    Ok((user_id, tokens))
}

async fn create_discord_user(state: &AppState, discord: DiscordUserResponse) -> ApiResult<String> {
    let display_name = discord
        .global_name
        .unwrap_or_else(|| discord.username.clone());
    let username = unique_username(state, &normalize_username(&discord.username)).await?;
    let email = discord
        .email
        .filter(|_| discord.verified.unwrap_or(false))
        .map(|value| normalize_email(&value));
    if let Some(email) = &email
        && let Some(row) = sqlx::query(r#"SELECT "id" FROM "User" WHERE "email" = $1"#)
            .bind(email)
            .fetch_optional(&state.db)
            .await?
    {
        let user_id: String = row.try_get("id")?;
        sqlx::query(r#"UPDATE "User" SET "discordId" = $2, "updatedAt" = NOW() WHERE "id" = $1"#)
            .bind(&user_id)
            .bind(&discord.id)
            .execute(&state.db)
            .await?;
        return Ok(user_id);
    }
    let user_id = Uuid::new_v4().to_string();
    let player_id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"INSERT INTO "User"
           ("id", "email", "username", "displayName", "discordId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())"#,
    )
    .bind(&user_id)
    .bind(email)
    .bind(&username)
    .bind(&display_name)
    .bind(&discord.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO "Player"
           ("id", "userId", "handle", "displayName", "currentInstanceId", "currentRoomId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'hab-room', NOW(), NOW())"#,
    )
    .bind(player_id)
    .bind(&user_id)
    .bind(&username)
    .bind(&display_name)
    .bind(format!("apartment:{user_id}"))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(user_id)
}

async fn auth_response(
    state: &AppState,
    user_id: &str,
    tokens: IssuedTokens,
) -> ApiResult<Response> {
    let session = session_for_user(state, user_id).await?;
    let headers = cookie_headers([
        auth_cookie(&state.config, "cc_at", tokens.access, ACCESS_TTL),
        auth_cookie(&state.config, "cc_rt", tokens.refresh, REFRESH_TTL),
    ]);
    Ok((headers, Json(session)).into_response())
}

async fn session_for_user(state: &AppState, user_id: &str) -> ApiResult<serde_json::Value> {
    let row = sqlx::query(
        r#"SELECT u."id", u."email", u."username", u."displayName",
                  p."id" AS "playerId", p."handle", p."displayName" AS "playerDisplayName"
           FROM "User" u JOIN "Player" p ON p."userId" = u."id"
           WHERE u."id" = $1"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::Unauthorized("Account has no player.".to_owned()))?;
    Ok(json!({
        "user": {
            "id": row.try_get::<String, _>("id")?,
            "email": row.try_get::<Option<String>, _>("email")?,
            "username": row.try_get::<String, _>("username")?,
            "displayName": row.try_get::<String, _>("displayName")?,
        },
        "player": {
            "id": row.try_get::<String, _>("playerId")?,
            "handle": row.try_get::<String, _>("handle")?,
            "displayName": row.try_get::<String, _>("playerDisplayName")?,
        }
    }))
}

async fn issue_tokens(
    state: &AppState,
    user_id: &str,
    family_id: Option<String>,
) -> ApiResult<IssuedTokens> {
    let tokens = build_tokens(state, user_id, family_id)?;
    let claims = decode_claims(
        &tokens.refresh,
        &state.config.jwt_refresh_secret,
        "refresh",
        REFRESH_AUDIENCE,
    )?;
    let family_id = claims.fam.unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO "RefreshToken"
           ("id", "userId", "tokenHash", "familyId", "expiresAt", "createdAt")
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days', NOW())"#,
    )
    .bind(&tokens.refresh_id)
    .bind(user_id)
    .bind(sha256(&tokens.refresh))
    .bind(family_id)
    .execute(&state.db)
    .await?;
    Ok(tokens)
}

fn build_tokens(
    state: &AppState,
    user_id: &str,
    family_id: Option<String>,
) -> ApiResult<IssuedTokens> {
    let now = Utc::now();
    let family_id = family_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let refresh_id = Uuid::new_v4().to_string();
    let access = encode_claims(
        Claims {
            sub: user_id.to_owned(),
            typ: "access".to_owned(),
            aud: ACCESS_AUDIENCE.to_owned(),
            iat: now.timestamp() as usize,
            exp: (now + ChronoDuration::seconds(ACCESS_TTL.as_secs() as i64)).timestamp() as usize,
            jti: None,
            fam: None,
        },
        &state.config.jwt_access_secret,
    )?;
    let refresh = encode_claims(
        Claims {
            sub: user_id.to_owned(),
            typ: "refresh".to_owned(),
            aud: REFRESH_AUDIENCE.to_owned(),
            iat: now.timestamp() as usize,
            exp: (now + ChronoDuration::seconds(REFRESH_TTL.as_secs() as i64)).timestamp() as usize,
            jti: Some(refresh_id.clone()),
            fam: Some(family_id.clone()),
        },
        &state.config.jwt_refresh_secret,
    )?;
    Ok(IssuedTokens {
        access,
        refresh,
        refresh_id,
    })
}

pub fn issue_admin_token(state: &AppState) -> ApiResult<String> {
    let now = Utc::now();
    encode_claims(
        Claims {
            sub: normalize_email(&state.config.admin_email),
            typ: "admin".to_owned(),
            aud: ADMIN_AUDIENCE.to_owned(),
            iat: now.timestamp() as usize,
            exp: (now + ChronoDuration::seconds(ADMIN_TTL.as_secs() as i64)).timestamp() as usize,
            jti: None,
            fam: None,
        },
        &state.config.admin_session_secret,
    )
}

pub fn admin_ttl() -> Duration {
    ADMIN_TTL
}

fn encode_claims(claims: Claims, secret: &str) -> ApiResult<String> {
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|error| ApiError::Internal(anyhow::Error::from(error)))
}

fn decode_claims(
    token: &str,
    secret: &str,
    expected_type: &str,
    expected_audience: &str,
) -> ApiResult<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.set_audience(&[expected_audience]);
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| ApiError::Unauthorized("Session token is invalid.".to_owned()))?
    .claims;
    if claims.typ != expected_type || claims.sub.is_empty() {
        return Err(ApiError::Unauthorized(
            "Session token is invalid.".to_owned(),
        ));
    }
    Ok(claims)
}

pub async fn require_player_id(state: &AppState, user_id: &str) -> ApiResult<String> {
    sqlx::query_scalar(r#"SELECT "id" FROM "Player" WHERE "userId" = $1"#)
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("Account has no player.".to_owned()))
}

pub async fn rate_limit(state: &AppState, scope: &str, max: i64, seconds: i64) -> ApiResult<()> {
    let mut redis = state.redis.clone();
    let bucket = Utc::now().timestamp() / seconds.max(1);
    let key = format!("cc:rate:{scope}:{bucket}");
    let count: i64 = redis.incr(&key, 1).await?;
    if count == 1 {
        let _: bool = redis.expire(&key, seconds).await?;
    }
    if count > max {
        return Err(ApiError::RateLimited);
    }
    Ok(())
}

fn require_password(password: &str) -> ApiResult<()> {
    if password.len() < 8 {
        Err(ApiError::BadRequest(
            "Password must be at least 8 characters.".to_owned(),
        ))
    } else {
        Ok(())
    }
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn normalize_username(username: &str) -> String {
    username
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '-'
            }
        })
        .take(24)
        .collect()
}

async fn unique_username(state: &AppState, base: &str) -> ApiResult<String> {
    let seed = if base.len() >= 3 {
        base.to_owned()
    } else {
        format!("pilot-{}", if base.is_empty() { "discord" } else { base })
    };
    for index in 0..50 {
        let candidate = if index == 0 {
            seed.clone()
        } else {
            format!("{seed}-{}", index + 1)
        };
        let exists: bool =
            sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "User" WHERE "username" = $1)"#)
                .bind(&candidate)
                .fetch_one(&state.db)
                .await?;
        if !exists {
            return Ok(candidate);
        }
    }
    Ok(format!(
        "pilot-{}",
        &Uuid::new_v4().simple().to_string()[..10]
    ))
}

fn sha256(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
        == Some("23505")
}

fn discord_error_redirect(state: &AppState, reason: &str) -> Response {
    let encoded: String = url::form_urlencoded::byte_serialize(reason.as_bytes()).collect();
    Redirect::temporary(&format!(
        "{}/?auth=discord-error&reason={encoded}",
        state.config.client_origin
    ))
    .into_response()
}
