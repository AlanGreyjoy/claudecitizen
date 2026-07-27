//! The Item Mall — an operator-curated storefront priced in AsteronCredits.
//!
//! `MallListing` is a layer over `ItemDefinition`, so delisting an item from the mall never
//! touches the item itself or the ARC-priced station shops that also sell it.

use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::{AccessUser, require_player_id},
    error::{ApiError, ApiResult},
    game::inventory_state,
    payments::ledger::{self, CreditOutcome, CreditReason},
    state::AppState,
};

/// Item types the mall is allowed to sell. Phase one is consumables only; widening this is a
/// deliberate product decision, not something an operator can do by mispricing a listing.
const SELLABLE_ITEM_TYPES: [&str; 1] = ["consumable"];

/// Upper bound on a single mall transaction, so a fat-fingered quantity cannot drain a balance.
const MAX_PURCHASE_QUANTITY: i32 = 99;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseMallItemBody {
    pub listing_id: String,
    /// Defaults to 1 when omitted.
    #[serde(default)]
    pub quantity: Option<i32>,
}

/// `GET /game/mall` — active listings plus the player's spending power.
pub async fn list_mall(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    Ok(Json(json!({
        "listings": mall_listings(&state).await?,
        "creditBalance": ledger::credit_balance(&state.db, &player_id).await?,
    })))
}

/// `POST /game/mall/purchase` — spends credits and adds the item to the player's inventory.
///
/// Mirrors the ARC purchase path in `game::purchase_inventory_item`: a single transaction that
/// locks the balance row before reading it, so concurrent requests cannot overspend.
pub async fn purchase_mall_item(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<PurchaseMallItemBody>,
) -> ApiResult<Json<Value>> {
    let listing_id = body.listing_id.trim();
    if listing_id.is_empty() {
        return Err(ApiError::BadRequest("listingId is required.".to_owned()));
    }
    let quantity = body.quantity.unwrap_or(1);
    if !(1..=MAX_PURCHASE_QUANTITY).contains(&quantity) {
        return Err(ApiError::BadRequest(format!(
            "quantity must be between 1 and {MAX_PURCHASE_QUANTITY}."
        )));
    }
    let player_id = require_player_id(&state, &access.user_id).await?;

    let mut tx = state.db.begin().await?;
    let balance: i32 =
        sqlx::query(r#"SELECT "creditBalance" FROM "Player" WHERE "id" = $1 FOR UPDATE"#)
            .bind(&player_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::NotFound("Player not found.".to_owned()))?
            .try_get("creditBalance")?;

    let listing = sqlx::query(
        r#"SELECT l."itemDefinitionId", l."priceCredits", l."limitPerPlayer",
                  i."itemType", i."stackMax"
           FROM "MallListing" l
           JOIN "ItemDefinition" i ON i."id" = l."itemDefinitionId"
           WHERE l."id" = $1 AND l."active" = true"#,
    )
    .bind(listing_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Mall listing not found.".to_owned()))?;

    let item_definition_id: String = listing.try_get("itemDefinitionId")?;
    let price_credits: i32 = listing.try_get("priceCredits")?;
    let limit_per_player: Option<i32> = listing.try_get("limitPerPlayer")?;
    let item_type: String = listing.try_get("itemType")?;
    let stack_max: i32 = listing.try_get("stackMax")?;

    if !SELLABLE_ITEM_TYPES.contains(&item_type.as_str()) {
        return Err(ApiError::BadRequest(
            "This item cannot be purchased from the Item Mall.".to_owned(),
        ));
    }

    let total_cost = price_credits
        .checked_mul(quantity)
        .ok_or_else(|| ApiError::BadRequest("Requested quantity is too large.".to_owned()))?;
    if balance < total_cost {
        return Err(ApiError::BadRequest(
            "Insufficient AsteronCredits.".to_owned(),
        ));
    }

    let owned: i32 = sqlx::query_scalar(
        r#"SELECT COALESCE((SELECT "quantity" FROM "PlayerItem"
           WHERE "playerId" = $1 AND "itemDefinitionId" = $2), 0)"#,
    )
    .bind(&player_id)
    .bind(&item_definition_id)
    .fetch_one(&mut *tx)
    .await?;

    let next_owned = owned.saturating_add(quantity);
    if next_owned > stack_max {
        return Err(ApiError::BadRequest(
            "Inventory stack is already full.".to_owned(),
        ));
    }
    // `limitPerPlayer` caps how many of this item a player may hold, not lifetime purchases —
    // consumables are meant to be bought again after they are used.
    if let Some(limit) = limit_per_player
        && next_owned > limit
    {
        return Err(ApiError::BadRequest(format!(
            "You may only hold {limit} of this item."
        )));
    }

    // Every credit movement goes through the ledger, so mall spending is auditable next to
    // purchases and grants. The key is unique per transaction: this is a fresh intent, not a
    // replay of an external event.
    let outcome = ledger::apply_credit_delta(
        &mut tx,
        &player_id,
        -total_cost,
        CreditReason::Spend,
        Some(("mall_listing", listing_id)),
        &format!("mall:{}", Uuid::new_v4()),
    )
    .await?;
    let credit_balance = match outcome {
        CreditOutcome::Applied(balance) => balance,
        CreditOutcome::AlreadyApplied => {
            return Err(ApiError::Conflict(
                "Duplicate mall purchase was ignored.".to_owned(),
            ));
        }
    };

    sqlx::query(
        r#"INSERT INTO "PlayerItem"
           ("id", "playerId", "itemDefinitionId", "quantity", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT ("playerId", "itemDefinitionId") DO UPDATE
           SET "quantity" = "PlayerItem"."quantity" + $4, "updatedAt" = NOW()"#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&player_id)
    .bind(&item_definition_id)
    .bind(quantity)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "creditBalance": credit_balance,
        "inventory": inventory_state(&state, &player_id).await?,
    })))
}

/// Active listings joined to the item detail the storefront needs to render a card.
pub(crate) async fn mall_listings(state: &AppState) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"SELECT l."id", l."itemDefinitionId", l."priceCredits", l."category", l."sortOrder",
                  l."featured", l."limitPerPlayer",
                  i."name", i."description", i."itemType", i."subType", i."iconUrl",
                  i."stackMax", i."rarity", i."metadata"
           FROM "MallListing" l
           JOIN "ItemDefinition" i ON i."id" = l."itemDefinitionId"
           WHERE l."active" = true
           ORDER BY l."sortOrder" ASC, i."name" ASC"#,
    )
    .fetch_all(&state.db)
    .await?;

    rows.into_iter()
        .map(|row| -> ApiResult<Value> {
            Ok(json!({
                "id": row.try_get::<String, _>("id")?,
                "itemDefinitionId": row.try_get::<String, _>("itemDefinitionId")?,
                "name": row.try_get::<String, _>("name")?,
                "description": row.try_get::<String, _>("description")?,
                "itemType": row.try_get::<String, _>("itemType")?,
                "subType": row.try_get::<String, _>("subType")?,
                "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?,
                "rarity": row.try_get::<String, _>("rarity")?,
                "stackMax": row.try_get::<i32, _>("stackMax")?,
                "priceCredits": row.try_get::<i32, _>("priceCredits")?,
                "category": row.try_get::<String, _>("category")?,
                "featured": row.try_get::<bool, _>("featured")?,
                "limitPerPlayer": row.try_get::<Option<i32>, _>("limitPerPlayer")?,
                "sortOrder": row.try_get::<i32, _>("sortOrder")?,
                "metadata": row.try_get::<Option<Value>, _>("metadata")?,
            }))
        })
        .collect()
}
