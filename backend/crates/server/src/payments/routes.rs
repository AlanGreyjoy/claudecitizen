//! Player-facing payment endpoints and the Stripe webhook.
//!
//! Fulfillment happens **only** in the webhook. `create_checkout` records an intent and hands
//! back a URL; it never grants credits. That way a player who closes the Stripe tab still gets
//! what they paid for, and a player who fakes a success redirect gets nothing.

use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    auth::{AccessUser, rate_limit, require_player_id},
    error::{ApiError, ApiResult},
    payments::{
        ledger::{self, CreditOutcome, CreditReason},
        provider::{self, StripeConfig},
        stripe::{self, CheckoutRequest},
    },
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutBody {
    pub pack_id: String,
}

/// `GET /payments/packs` — the credit packs a player can buy right now.
pub async fn list_packs(
    State(state): State<AppState>,
    _access: AccessUser,
) -> ApiResult<Json<Value>> {
    let config = provider::load_stripe_config(&state).await?;
    let rows = sqlx::query(
        r#"SELECT "id", "name", "description", "credits", "bonusCredits", "priceCents",
                  "currency", "iconUrl", "sortOrder"
           FROM "CreditPack" WHERE "active" = true ORDER BY "sortOrder" ASC, "priceCents" ASC"#,
    )
    .fetch_all(&state.db)
    .await?;

    let packs = rows
        .into_iter()
        .map(|row| -> ApiResult<Value> {
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
                "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?,
                "sortOrder": row.try_get::<i32, _>("sortOrder")?,
            }))
        })
        .collect::<ApiResult<Vec<Value>>>()?;

    Ok(Json(json!({
        "packs": packs,
        // The client hides the buy flow rather than letting a player hit a dead end.
        "checkoutEnabled": config.is_checkout_ready(),
    })))
}

/// `POST /payments/checkout` — records a pending purchase and returns a Stripe Checkout URL.
pub async fn create_checkout(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<CheckoutBody>,
) -> ApiResult<Json<Value>> {
    let pack_id = body.pack_id.trim();
    if pack_id.is_empty() {
        return Err(ApiError::BadRequest("packId is required.".to_owned()));
    }
    rate_limit(
        &state,
        &format!("payments:checkout:{}", access.user_id),
        10,
        60,
    )
    .await?;
    let player_id = require_player_id(&state, &access.user_id).await?;

    let config = provider::load_stripe_config(&state).await?;
    let secret_key = config.require_secret_key()?;
    let (success_url, cancel_url) = checkout_urls(&state, &config);

    let pack = sqlx::query(
        r#"SELECT "id", "name", "credits", "bonusCredits", "priceCents", "currency", "stripePriceId"
           FROM "CreditPack" WHERE "id" = $1 AND "active" = true"#,
    )
    .bind(pack_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("Credit pack not found.".to_owned()))?;

    let price_cents: i32 = pack.try_get("priceCents")?;
    let currency: String = pack.try_get("currency")?;
    let pack_name: String = pack.try_get("name")?;
    let stripe_price_id: Option<String> = pack.try_get("stripePriceId")?;
    let purchase_id = Uuid::new_v4().to_string();

    // Insert the intent first so the webhook has a row to reconcile against even if the
    // response never reaches the client.
    sqlx::query(
        r#"INSERT INTO "CreditPurchase"
           ("id", "playerId", "packId", "provider", "status", "priceCents", "currency",
            "creditsGranted", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 'stripe', 'pending', $4, $5, 0, NOW(), NOW())"#,
    )
    .bind(&purchase_id)
    .bind(&player_id)
    .bind(pack_id)
    .bind(price_cents)
    .bind(&currency)
    .execute(&state.db)
    .await?;

    let session = stripe::create_checkout_session(CheckoutRequest {
        secret_key,
        success_url: &success_url,
        cancel_url: &cancel_url,
        client_reference_id: &player_id,
        purchase_id: &purchase_id,
        pack_id,
        pack_name: &pack_name,
        currency: &currency,
        price_cents,
        stripe_price_id: stripe_price_id.as_deref(),
    })
    .await
    .map_err(|error| {
        error!(
            ?error,
            purchase_id, "Stripe checkout session creation failed"
        );
        ApiError::Unavailable
    })?;

    let url = session.url.clone().ok_or_else(|| {
        error!(purchase_id, "Stripe returned a session without a URL");
        ApiError::Unavailable
    })?;

    sqlx::query(
        r#"UPDATE "CreditPurchase"
           SET "providerSessionId" = $2, "updatedAt" = NOW() WHERE "id" = $1"#,
    )
    .bind(&purchase_id)
    .bind(&session.id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "purchaseId": purchase_id,
        "sessionId": session.id,
        "url": url,
    })))
}

/// `GET /payments/purchases` — this player's recent purchase attempts.
///
/// The Mall polls this after checkout so the balance updates without a reload. It is a
/// convenience view of webhook-written state, never the source of truth.
pub async fn list_purchases(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    let rows = sqlx::query(
        r#"SELECT p."id", p."packId", p."status", p."priceCents", p."currency",
                  p."creditsGranted", p."createdAt", c."name" AS "packName"
           FROM "CreditPurchase" p
           LEFT JOIN "CreditPack" c ON c."id" = p."packId"
           WHERE p."playerId" = $1
           ORDER BY p."createdAt" DESC
           LIMIT 20"#,
    )
    .bind(&player_id)
    .fetch_all(&state.db)
    .await?;

    let purchases = rows
        .into_iter()
        .map(|row| -> ApiResult<Value> {
            Ok(json!({
                "id": row.try_get::<String, _>("id")?,
                "packId": row.try_get::<String, _>("packId")?,
                "packName": row.try_get::<Option<String>, _>("packName")?,
                "status": row.try_get::<String, _>("status")?,
                "priceCents": row.try_get::<i32, _>("priceCents")?,
                "currency": row.try_get::<String, _>("currency")?,
                "creditsGranted": row.try_get::<i32, _>("creditsGranted")?,
                "createdAt": row.try_get::<chrono::NaiveDateTime, _>("createdAt")?.and_utc().to_rfc3339(),
            }))
        })
        .collect::<ApiResult<Vec<Value>>>()?;

    Ok(Json(json!({
        "purchases": purchases,
        "creditBalance": ledger::credit_balance(&state.db, &player_id).await?,
    })))
}

/// `POST /payments/stripe/webhook` — the only place credits are granted for money.
///
/// Unauthenticated by design: Stripe authenticates itself with an HMAC signature over the raw
/// body, which is why the handler takes `Bytes` rather than `Json`.
pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Bytes,
) -> ApiResult<StatusCode> {
    let config = provider::load_stripe_config(&state).await?;
    let Some(webhook_secret) = config.webhook_secret.as_deref() else {
        warn!("received a Stripe webhook but no webhook secret is configured");
        return Err(ApiError::Unavailable);
    };
    let signature = headers
        .get("stripe-signature")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::Unauthorized("Missing Stripe signature.".to_owned()))?;

    stripe::verify_webhook_signature(&payload, signature, webhook_secret).map_err(|error| {
        warn!(
            ?error,
            "rejected a Stripe webhook with an invalid signature"
        );
        ApiError::Unauthorized("Invalid Stripe signature.".to_owned())
    })?;

    // Only parse after the signature passes.
    let event: Value = serde_json::from_slice(&payload)
        .map_err(|_| ApiError::BadRequest("Malformed Stripe event.".to_owned()))?;
    let event_id = event["id"].as_str().unwrap_or_default().to_owned();
    let event_type = event["type"].as_str().unwrap_or_default().to_owned();
    let object = &event["data"]["object"];

    match event_type.as_str() {
        "checkout.session.completed" | "checkout.session.async_payment_succeeded" => {
            fulfill_checkout(&state, &event_id, object).await?;
        }
        "checkout.session.expired" | "checkout.session.async_payment_failed" => {
            mark_session_failed(&state, object).await?;
        }
        "charge.refunded" => {
            reverse_charge(&state, &event_id, object, CreditReason::Refund, "refunded").await?;
        }
        "charge.dispute.created" => {
            reverse_charge(
                &state,
                &event_id,
                object,
                CreditReason::Chargeback,
                "disputed",
            )
            .await?;
        }
        _ => {
            // Acknowledge anything else, or Stripe retries it forever.
        }
    }

    Ok(StatusCode::OK)
}

/// Grants credits for a completed session, exactly once.
async fn fulfill_checkout(state: &AppState, event_id: &str, object: &Value) -> ApiResult<()> {
    let session_id = object["id"].as_str().unwrap_or_default();
    let purchase_id = object["metadata"]["purchaseId"]
        .as_str()
        .unwrap_or_default();
    if session_id.is_empty() && purchase_id.is_empty() {
        warn!(event_id, "Stripe session had no id or purchaseId; ignoring");
        return Ok(());
    }
    // Stripe marks a session paid separately from completing it; only fulfill paid ones.
    let payment_status = object["payment_status"].as_str().unwrap_or_default();
    if !matches!(payment_status, "paid" | "no_payment_required") {
        info!(
            event_id,
            payment_status, "Stripe session not paid yet; ignoring"
        );
        return Ok(());
    }
    let payment_intent = object["payment_intent"].as_str().unwrap_or_default();

    let mut tx = state.db.begin().await?;
    let purchase = sqlx::query(
        r#"SELECT "id", "playerId", "packId", "status"
           FROM "CreditPurchase"
           WHERE ("id" = $1 AND $1 <> '') OR ("providerSessionId" = $2 AND $2 <> '')
           FOR UPDATE"#,
    )
    .bind(purchase_id)
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(purchase) = purchase else {
        // A session we never recorded. Log it rather than 500 — Stripe would just retry.
        warn!(
            event_id,
            session_id, "no CreditPurchase matched a paid Stripe session"
        );
        tx.rollback().await?;
        return Ok(());
    };

    let row_id: String = purchase.try_get("id")?;
    let player_id: String = purchase.try_get("playerId")?;
    let pack_id: String = purchase.try_get("packId")?;
    let status: String = purchase.try_get("status")?;
    if status == "paid" {
        tx.rollback().await?;
        return Ok(());
    }

    let pack = sqlx::query(r#"SELECT "credits", "bonusCredits" FROM "CreditPack" WHERE "id" = $1"#)
        .bind(&pack_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound("Credit pack not found.".to_owned()))?;
    let credits: i32 = pack.try_get("credits")?;
    let bonus: i32 = pack.try_get("bonusCredits")?;
    let total = credits.saturating_add(bonus);

    let outcome = ledger::apply_credit_delta(
        &mut tx,
        &player_id,
        total,
        CreditReason::Purchase,
        Some(("credit_purchase", &row_id)),
        // Keying on the Stripe event id makes a replayed webhook a no-op.
        &format!("stripe:{event_id}"),
    )
    .await?;

    sqlx::query(
        r#"UPDATE "CreditPurchase"
           SET "status" = 'paid', "creditsGranted" = $2, "providerPaymentIntentId" = $3,
               "providerSessionId" = COALESCE("providerSessionId", $4), "updatedAt" = NOW()
           WHERE "id" = $1"#,
    )
    .bind(&row_id)
    .bind(total)
    .bind(non_empty(payment_intent))
    .bind(non_empty(session_id))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    match outcome {
        CreditOutcome::Applied(balance) => {
            info!(
                player_id,
                total, balance, "granted AsteronCredits from Stripe purchase"
            );
        }
        CreditOutcome::AlreadyApplied => {
            info!(
                event_id,
                "Stripe event replayed; credits were already granted"
            );
        }
    }
    Ok(())
}

/// Flags an expired or failed session so it stops showing as pending.
async fn mark_session_failed(state: &AppState, object: &Value) -> ApiResult<()> {
    let session_id = object["id"].as_str().unwrap_or_default();
    if session_id.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"UPDATE "CreditPurchase" SET "status" = 'failed', "updatedAt" = NOW()
           WHERE "providerSessionId" = $1 AND "status" = 'pending'"#,
    )
    .bind(session_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

/// Claws credits back after a refund or dispute. Balance clamps at zero in the ledger.
async fn reverse_charge(
    state: &AppState,
    event_id: &str,
    object: &Value,
    reason: CreditReason,
    next_status: &str,
) -> ApiResult<()> {
    // A dispute carries the charge's payment_intent; a refunded charge carries its own.
    let payment_intent = object["payment_intent"].as_str().unwrap_or_default();
    if payment_intent.is_empty() {
        warn!(event_id, "reversal event had no payment_intent; ignoring");
        return Ok(());
    }

    let mut tx = state.db.begin().await?;
    let purchase = sqlx::query(
        r#"SELECT "id", "playerId", "creditsGranted", "status"
           FROM "CreditPurchase" WHERE "providerPaymentIntentId" = $1 FOR UPDATE"#,
    )
    .bind(payment_intent)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(purchase) = purchase else {
        warn!(event_id, "no CreditPurchase matched a reversal event");
        tx.rollback().await?;
        return Ok(());
    };
    let row_id: String = purchase.try_get("id")?;
    let player_id: String = purchase.try_get("playerId")?;
    let granted: i32 = purchase.try_get("creditsGranted")?;
    let status: String = purchase.try_get("status")?;
    if matches!(status.as_str(), "refunded" | "disputed") {
        tx.rollback().await?;
        return Ok(());
    }

    if granted > 0 {
        ledger::apply_credit_delta(
            &mut tx,
            &player_id,
            -granted,
            reason,
            Some(("credit_purchase", &row_id)),
            &format!("stripe:{event_id}"),
        )
        .await?;
    }

    sqlx::query(
        r#"UPDATE "CreditPurchase" SET "status" = $2, "updatedAt" = NOW() WHERE "id" = $1"#,
    )
    .bind(&row_id)
    .bind(next_status)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    warn!(
        player_id,
        granted, next_status, "reversed an AsteronCredit purchase"
    );
    Ok(())
}

/// Falls back to the API public URL when the operator has not set redirect URLs yet.
fn checkout_urls(state: &AppState, config: &StripeConfig) -> (String, String) {
    let fallback = state.config.client_origin.trim_end_matches('/');
    let success = if config.success_url.is_empty() {
        format!("{fallback}/?checkout=success")
    } else {
        config.success_url.clone()
    };
    let cancel = if config.cancel_url.is_empty() {
        format!("{fallback}/?checkout=cancelled")
    } else {
        config.cancel_url.clone()
    };
    (success, cancel)
}

fn non_empty(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}
