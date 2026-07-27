//! Operator endpoints for payments, credit packs, the Item Mall, and manual credit grants.
//!
//! Split out of `admin.rs` deliberately — that module is already large, and the payment surface
//! carries different risk. Note every handler takes `_admin: AdminUser`: this codebase enforces
//! operator auth per handler, not with a route layer, so omitting it silently makes a route
//! public.

use axum::extract::State;
use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use crate::{
    auth::AdminUser,
    error::{ApiError, ApiResult},
    mall,
    payments::{
        crypto,
        ledger::{self, CreditOutcome, CreditReason},
        provider,
    },
    state::AppState,
};

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentConfigBody {
    pub mode: Option<String>,
    /// Omitted or empty leaves the stored secret untouched, so the console can render a masked
    /// field without round-tripping the real value.
    pub secret_key: Option<String>,
    pub webhook_secret: Option<String>,
    pub success_url: Option<String>,
    pub cancel_url: Option<String>,
}

/// `GET /admin/payments/config` — never returns a secret, only whether one exists.
pub async fn get_payment_config(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let config = provider::load_stripe_config(&state).await?;
    Ok(Json(json!({
        "provider": "stripe",
        "mode": config.mode,
        "secretKeyConfigured": config.secret_key.is_some(),
        "secretKeySource": config.secret_key_source,
        "secretKeyPreview": config.secret_key_last4.as_ref().map(|last4| format!("sk_••••{last4}")),
        "webhookSecretConfigured": config.webhook_secret.is_some(),
        "webhookSecretSource": config.webhook_secret_source,
        "successUrl": config.success_url,
        "cancelUrl": config.cancel_url,
        "webhookUrl": provider::webhook_url(&state),
        "checkoutEnabled": config.is_checkout_ready(),
        // The console explains why saving is blocked rather than failing opaquely.
        "encryptionConfigured": crypto::is_configured(&state.config.payments_encryption_key),
    })))
}

/// `PUT /admin/payments/config` — stores Stripe settings, wrapping secrets before they hit disk.
pub async fn update_payment_config(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<PaymentConfigBody>,
) -> ApiResult<Json<Value>> {
    let encryption_key = state.config.payments_encryption_key.clone();
    let mode = match body.mode.as_deref().map(str::trim) {
        Some("test") | None => "test",
        Some("live") => "live",
        Some(_) => {
            return Err(ApiError::BadRequest(
                "mode must be test or live.".to_owned(),
            ));
        }
    };

    let secret_key = non_empty(body.secret_key.as_deref());
    let webhook_secret = non_empty(body.webhook_secret.as_deref());
    if (secret_key.is_some() || webhook_secret.is_some()) && !crypto::is_configured(&encryption_key)
    {
        return Err(ApiError::BadRequest(
            "Set PAYMENTS_ENCRYPTION_KEY on the server before storing Stripe secrets.".to_owned(),
        ));
    }

    let secret_ciphertext = match secret_key {
        Some(secret) => Some(crypto::encrypt_secret(&encryption_key, secret)?),
        None => None,
    };
    let secret_last4 = secret_key.map(crypto::last4);
    let webhook_ciphertext = match webhook_secret {
        Some(secret) => Some(crypto::encrypt_secret(&encryption_key, secret)?),
        None => None,
    };

    // COALESCE keeps an untouched secret in place, so the console never has to resend it.
    sqlx::query(
        r#"INSERT INTO "PaymentProvider"
           ("id", "mode", "secretKeyCiphertext", "secretKeyLast4", "webhookSecretCiphertext",
            "successUrl", "cancelUrl", "updatedAt")
           VALUES ('stripe', $1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT ("id") DO UPDATE SET
             "mode" = $1,
             "secretKeyCiphertext" = COALESCE($2, "PaymentProvider"."secretKeyCiphertext"),
             "secretKeyLast4" = COALESCE($3, "PaymentProvider"."secretKeyLast4"),
             "webhookSecretCiphertext" =
               COALESCE($4, "PaymentProvider"."webhookSecretCiphertext"),
             "successUrl" = COALESCE($5, "PaymentProvider"."successUrl"),
             "cancelUrl" = COALESCE($6, "PaymentProvider"."cancelUrl"),
             "updatedAt" = NOW()"#,
    )
    .bind(mode)
    .bind(secret_ciphertext)
    .bind(secret_last4)
    .bind(webhook_ciphertext)
    .bind(body.success_url.as_deref().map(str::trim))
    .bind(body.cancel_url.as_deref().map(str::trim))
    .execute(&state.db)
    .await?;

    get_payment_config(State(state), _admin).await
}

// ---------------------------------------------------------------------------
// Credit packs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditPackBody {
    pub name: Option<String>,
    pub description: Option<String>,
    pub credits: Option<i32>,
    pub bonus_credits: Option<i32>,
    pub price_cents: Option<i32>,
    pub currency: Option<String>,
    pub stripe_price_id: Option<String>,
    pub icon_url: Option<String>,
    pub sort_order: Option<i32>,
    pub active: Option<bool>,
}

/// `GET /admin/credit-packs`
pub async fn list_credit_packs(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    let rows =
        sqlx::query(r#"SELECT * FROM "CreditPack" ORDER BY "sortOrder" ASC, "priceCents" ASC"#)
            .fetch_all(&state.db)
            .await?;
    rows.into_iter()
        .map(credit_pack_json)
        .collect::<ApiResult<Vec<_>>>()
        .map(Json)
}

/// `POST /admin/credit-packs`
pub async fn create_credit_pack(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<CreditPackBody>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let name = require(body.name.as_deref(), "name")?;
    let credits = require_positive(body.credits, "credits")?;
    let price_cents = require_positive(body.price_cents, "priceCents")?;
    let bonus = body.bonus_credits.unwrap_or(0);
    if bonus < 0 {
        return Err(ApiError::BadRequest(
            "bonusCredits cannot be negative.".to_owned(),
        ));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO "CreditPack"
           ("id", "name", "description", "credits", "bonusCredits", "priceCents", "currency",
            "stripePriceId", "iconUrl", "sortOrder", "active", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())"#,
    )
    .bind(&id)
    .bind(name)
    .bind(body.description.as_deref().unwrap_or(""))
    .bind(credits)
    .bind(bonus)
    .bind(price_cents)
    .bind(body.currency.as_deref().unwrap_or("usd"))
    .bind(non_empty(body.stripe_price_id.as_deref()))
    .bind(non_empty(body.icon_url.as_deref()))
    .bind(body.sort_order.unwrap_or(0))
    .bind(body.active.unwrap_or(true))
    .execute(&state.db)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(credit_pack_by_id(&state, &id).await?),
    ))
}

/// `PATCH /admin/credit-packs/{id}` — partial update; omitted fields keep their value.
pub async fn update_credit_pack(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<CreditPackBody>,
) -> ApiResult<Json<Value>> {
    if let Some(credits) = body.credits {
        require_positive(Some(credits), "credits")?;
    }
    if let Some(price_cents) = body.price_cents {
        require_positive(Some(price_cents), "priceCents")?;
    }
    let updated = sqlx::query(
        r#"UPDATE "CreditPack" SET
             "name" = COALESCE($2, "name"),
             "description" = COALESCE($3, "description"),
             "credits" = COALESCE($4, "credits"),
             "bonusCredits" = COALESCE($5, "bonusCredits"),
             "priceCents" = COALESCE($6, "priceCents"),
             "currency" = COALESCE($7, "currency"),
             "stripePriceId" = COALESCE($8, "stripePriceId"),
             "iconUrl" = COALESCE($9, "iconUrl"),
             "sortOrder" = COALESCE($10, "sortOrder"),
             "active" = COALESCE($11, "active"),
             "updatedAt" = NOW()
           WHERE "id" = $1"#,
    )
    .bind(&id)
    .bind(non_empty(body.name.as_deref()))
    .bind(body.description.as_deref())
    .bind(body.credits)
    .bind(body.bonus_credits)
    .bind(body.price_cents)
    .bind(non_empty(body.currency.as_deref()))
    .bind(non_empty(body.stripe_price_id.as_deref()))
    .bind(non_empty(body.icon_url.as_deref()))
    .bind(body.sort_order)
    .bind(body.active)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::NotFound("Credit pack not found.".to_owned()));
    }
    Ok(Json(credit_pack_by_id(&state, &id).await?))
}

/// `DELETE /admin/credit-packs/{id}`
///
/// Packs with purchase history are deactivated instead of deleted — a `CreditPurchase` row must
/// stay readable so the operator can still audit what a player paid for.
pub async fn delete_credit_pack(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let purchases: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM "CreditPurchase" WHERE "packId" = $1"#)
            .bind(&id)
            .fetch_one(&state.db)
            .await?;
    if purchases > 0 {
        let updated = sqlx::query(
            r#"UPDATE "CreditPack" SET "active" = false, "updatedAt" = NOW() WHERE "id" = $1"#,
        )
        .bind(&id)
        .execute(&state.db)
        .await?;
        if updated.rows_affected() == 0 {
            return Err(ApiError::NotFound("Credit pack not found.".to_owned()));
        }
        return Ok(StatusCode::NO_CONTENT);
    }
    let deleted = sqlx::query(r#"DELETE FROM "CreditPack" WHERE "id" = $1"#)
        .bind(&id)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(ApiError::NotFound("Credit pack not found.".to_owned()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Mall listings
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MallListingBody {
    pub item_definition_id: Option<String>,
    pub price_credits: Option<i32>,
    pub category: Option<String>,
    pub sort_order: Option<i32>,
    pub featured: Option<bool>,
    pub active: Option<bool>,
    pub limit_per_player: Option<i32>,
}

/// `GET /admin/mall` — every listing, including inactive ones the storefront hides.
pub async fn list_mall_listings(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    let rows = sqlx::query(
        r#"SELECT l.*, i."name", i."itemType", i."subType", i."iconUrl", i."costArc"
           FROM "MallListing" l
           JOIN "ItemDefinition" i ON i."id" = l."itemDefinitionId"
           ORDER BY l."sortOrder" ASC, i."name" ASC"#,
    )
    .fetch_all(&state.db)
    .await?;
    rows.into_iter()
        .map(admin_listing_json)
        .collect::<ApiResult<Vec<_>>>()
        .map(Json)
}

/// `POST /admin/mall`
pub async fn create_mall_listing(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<MallListingBody>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let item_definition_id = require(body.item_definition_id.as_deref(), "itemDefinitionId")?;
    let price_credits = body.price_credits.unwrap_or(0);
    if price_credits < 0 {
        return Err(ApiError::BadRequest(
            "priceCredits cannot be negative.".to_owned(),
        ));
    }
    let item_type: Option<String> =
        sqlx::query_scalar(r#"SELECT "itemType" FROM "ItemDefinition" WHERE "id" = $1"#)
            .bind(item_definition_id)
            .fetch_optional(&state.db)
            .await?;
    let item_type =
        item_type.ok_or_else(|| ApiError::NotFound("Item definition not found.".to_owned()))?;

    let id = Uuid::new_v4().to_string();
    let insert = sqlx::query(
        r#"INSERT INTO "MallListing"
           ("id", "itemDefinitionId", "priceCredits", "category", "sortOrder", "featured",
            "active", "limitPerPlayer", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
           ON CONFLICT ("itemDefinitionId") DO NOTHING"#,
    )
    .bind(&id)
    .bind(item_definition_id)
    .bind(price_credits)
    .bind(body.category.as_deref().unwrap_or(item_type.as_str()))
    .bind(body.sort_order.unwrap_or(0))
    .bind(body.featured.unwrap_or(false))
    .bind(body.active.unwrap_or(true))
    .bind(body.limit_per_player)
    .execute(&state.db)
    .await?;
    if insert.rows_affected() == 0 {
        return Err(ApiError::Conflict(
            "That item is already listed in the Item Mall.".to_owned(),
        ));
    }
    Ok((
        StatusCode::CREATED,
        Json(mall_listing_by_id(&state, &id).await?),
    ))
}

/// `PATCH /admin/mall/{id}`
pub async fn update_mall_listing(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<MallListingBody>,
) -> ApiResult<Json<Value>> {
    if body.price_credits.is_some_and(|price| price < 0) {
        return Err(ApiError::BadRequest(
            "priceCredits cannot be negative.".to_owned(),
        ));
    }
    let updated = sqlx::query(
        r#"UPDATE "MallListing" SET
             "priceCredits" = COALESCE($2, "priceCredits"),
             "category" = COALESCE($3, "category"),
             "sortOrder" = COALESCE($4, "sortOrder"),
             "featured" = COALESCE($5, "featured"),
             "active" = COALESCE($6, "active"),
             "limitPerPlayer" = $7,
             "updatedAt" = NOW()
           WHERE "id" = $1"#,
    )
    .bind(&id)
    .bind(body.price_credits)
    .bind(non_empty(body.category.as_deref()))
    .bind(body.sort_order)
    .bind(body.featured)
    .bind(body.active)
    .bind(body.limit_per_player)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::NotFound("Mall listing not found.".to_owned()));
    }
    Ok(Json(mall_listing_by_id(&state, &id).await?))
}

/// `DELETE /admin/mall/{id}` — delists the item; the `ItemDefinition` is untouched.
pub async fn delete_mall_listing(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let deleted = sqlx::query(r#"DELETE FROM "MallListing" WHERE "id" = $1"#)
        .bind(&id)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(ApiError::NotFound("Mall listing not found.".to_owned()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Grants and purchase history
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantCreditsBody {
    pub delta: i32,
    pub reason: Option<String>,
    /// `grant` for support/compensation, `award` for a promo or in-game prize. Only affects how
    /// the movement is classified in the ledger.
    pub reason_code: Option<String>,
}

/// `POST /admin/users/{id}/credits` — hand-grant or claw back credits for a player.
///
/// `id` is a **player** id, matching what `/admin/users/{id}` returns for the player record.
pub async fn grant_credits(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(player_id): Path<String>,
    Json(body): Json<GrantCreditsBody>,
) -> ApiResult<Json<Value>> {
    if body.delta == 0 {
        return Err(ApiError::BadRequest("delta must not be zero.".to_owned()));
    }
    let note = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .unwrap_or("operator grant")
        .to_owned();
    let reason = match body.reason_code.as_deref().map(str::trim) {
        Some("award") => CreditReason::Award,
        Some("grant") | None => CreditReason::Grant,
        Some(_) => {
            return Err(ApiError::BadRequest(
                "reasonCode must be grant or award.".to_owned(),
            ));
        }
    };

    let mut tx = state.db.begin().await?;
    let outcome = ledger::apply_credit_delta(
        &mut tx,
        &player_id,
        body.delta,
        reason,
        Some(("admin_note", note.as_str())),
        &format!("admin:{}", Uuid::new_v4()),
    )
    .await?;
    tx.commit().await?;

    let balance = match outcome {
        CreditOutcome::Applied(balance) => balance,
        CreditOutcome::AlreadyApplied => ledger::credit_balance(&state.db, &player_id).await?,
    };
    Ok(Json(json!({ "creditBalance": balance })))
}

/// `GET /admin/users/{id}/credits` — recent ledger entries for one player.
pub async fn list_player_ledger(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(player_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let rows = sqlx::query(
        r#"SELECT "id", "delta", "balanceAfter", "reason", "refType", "refId", "createdAt"
           FROM "AsteronCreditLedger"
           WHERE "playerId" = $1 ORDER BY "createdAt" DESC LIMIT 50"#,
    )
    .bind(&player_id)
    .fetch_all(&state.db)
    .await?;

    let entries = rows
        .into_iter()
        .map(|row| -> ApiResult<Value> {
            Ok(json!({
                "id": row.try_get::<String, _>("id")?,
                "delta": row.try_get::<i32, _>("delta")?,
                "balanceAfter": row.try_get::<i32, _>("balanceAfter")?,
                "reason": row.try_get::<String, _>("reason")?,
                "refType": row.try_get::<Option<String>, _>("refType")?,
                "refId": row.try_get::<Option<String>, _>("refId")?,
                "createdAt": iso(&row, "createdAt")?,
            }))
        })
        .collect::<ApiResult<Vec<Value>>>()?;

    Ok(Json(json!({
        "creditBalance": ledger::credit_balance(&state.db, &player_id).await?,
        "entries": entries,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseQuery {
    pub status: Option<String>,
}

/// `GET /admin/payments/purchases` — the purchase log, optionally filtered by status.
pub async fn list_purchases(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(query): Query<PurchaseQuery>,
) -> ApiResult<Json<Vec<Value>>> {
    let status = non_empty(query.status.as_deref());
    let rows = sqlx::query(
        r#"SELECT p."id", p."playerId", p."packId", p."status", p."priceCents", p."currency",
                  p."creditsGranted", p."providerSessionId", p."providerPaymentIntentId",
                  p."createdAt", p."updatedAt",
                  c."name" AS "packName", pl."handle" AS "playerHandle"
           FROM "CreditPurchase" p
           LEFT JOIN "CreditPack" c ON c."id" = p."packId"
           LEFT JOIN "Player" pl ON pl."id" = p."playerId"
           WHERE $1::TEXT IS NULL OR p."status" = $1
           ORDER BY p."createdAt" DESC
           LIMIT 200"#,
    )
    .bind(status)
    .fetch_all(&state.db)
    .await?;

    rows.into_iter()
        .map(|row| -> ApiResult<Value> {
            Ok(json!({
                "id": row.try_get::<String, _>("id")?,
                "playerId": row.try_get::<String, _>("playerId")?,
                "playerHandle": row.try_get::<Option<String>, _>("playerHandle")?,
                "packId": row.try_get::<String, _>("packId")?,
                "packName": row.try_get::<Option<String>, _>("packName")?,
                "status": row.try_get::<String, _>("status")?,
                "priceCents": row.try_get::<i32, _>("priceCents")?,
                "currency": row.try_get::<String, _>("currency")?,
                "creditsGranted": row.try_get::<i32, _>("creditsGranted")?,
                "providerSessionId": row.try_get::<Option<String>, _>("providerSessionId")?,
                "providerPaymentIntentId":
                    row.try_get::<Option<String>, _>("providerPaymentIntentId")?,
                "createdAt": iso(&row, "createdAt")?,
                "updatedAt": iso(&row, "updatedAt")?,
            }))
        })
        .collect::<ApiResult<Vec<Value>>>()
        .map(Json)
}

/// `GET /admin/mall/preview` — what a player would see, for verifying a curation change.
pub async fn preview_mall(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        json!({ "listings": mall::mall_listings(&state).await? }),
    ))
}

// ---------------------------------------------------------------------------
// Row shaping and small validators
// ---------------------------------------------------------------------------

fn credit_pack_json(row: PgRow) -> ApiResult<Value> {
    let credits: i32 = row.try_get("credits")?;
    let bonus: i32 = row.try_get("bonusCredits")?;
    Ok(json!({
        "id": row.try_get::<String, _>("id")?,
        "name": row.try_get::<String, _>("name")?,
        "description": row.try_get::<String, _>("description")?,
        "credits": credits,
        "bonusCredits": bonus,
        "totalCredits": credits + bonus,
        "priceCents": row.try_get::<i32, _>("priceCents")?,
        "currency": row.try_get::<String, _>("currency")?,
        "stripePriceId": row.try_get::<Option<String>, _>("stripePriceId")?,
        "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?,
        "sortOrder": row.try_get::<i32, _>("sortOrder")?,
        "active": row.try_get::<bool, _>("active")?,
        "createdAt": iso(&row, "createdAt")?,
        "updatedAt": iso(&row, "updatedAt")?,
    }))
}

fn admin_listing_json(row: PgRow) -> ApiResult<Value> {
    Ok(json!({
        "id": row.try_get::<String, _>("id")?,
        "itemDefinitionId": row.try_get::<String, _>("itemDefinitionId")?,
        "itemName": row.try_get::<String, _>("name")?,
        "itemType": row.try_get::<String, _>("itemType")?,
        "subType": row.try_get::<String, _>("subType")?,
        "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?,
        "costArc": row.try_get::<i32, _>("costArc")?,
        "priceCredits": row.try_get::<i32, _>("priceCredits")?,
        "category": row.try_get::<String, _>("category")?,
        "sortOrder": row.try_get::<i32, _>("sortOrder")?,
        "featured": row.try_get::<bool, _>("featured")?,
        "active": row.try_get::<bool, _>("active")?,
        "limitPerPlayer": row.try_get::<Option<i32>, _>("limitPerPlayer")?,
        "createdAt": iso(&row, "createdAt")?,
        "updatedAt": iso(&row, "updatedAt")?,
    }))
}

async fn credit_pack_by_id(state: &AppState, id: &str) -> ApiResult<Value> {
    let row = sqlx::query(r#"SELECT * FROM "CreditPack" WHERE "id" = $1"#)
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("Credit pack not found.".to_owned()))?;
    credit_pack_json(row)
}

async fn mall_listing_by_id(state: &AppState, id: &str) -> ApiResult<Value> {
    let row = sqlx::query(
        r#"SELECT l.*, i."name", i."itemType", i."subType", i."iconUrl", i."costArc"
           FROM "MallListing" l
           JOIN "ItemDefinition" i ON i."id" = l."itemDefinitionId"
           WHERE l."id" = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("Mall listing not found.".to_owned()))?;
    admin_listing_json(row)
}

fn iso(row: &PgRow, column: &str) -> Result<String, sqlx::Error> {
    let value: NaiveDateTime = row.try_get(column)?;
    Ok(DateTime::<Utc>::from_naive_utc_and_offset(value, Utc).to_rfc3339())
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn require<'a>(value: Option<&'a str>, name: &str) -> ApiResult<&'a str> {
    non_empty(value).ok_or_else(|| ApiError::BadRequest(format!("{name} is required.")))
}

fn require_positive(value: Option<i32>, name: &str) -> ApiResult<i32> {
    match value {
        Some(value) if value > 0 => Ok(value),
        _ => Err(ApiError::BadRequest(format!(
            "{name} must be a positive integer."
        ))),
    }
}
