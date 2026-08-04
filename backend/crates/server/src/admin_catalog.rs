//! Catalog export / import for Deploy → Sync Catalog.
//!
//! Upserts definition rows by stable TEXT id. Never touches PaymentProvider,
//! player data, or CreditPack.stripePriceId.

use axum::{Json, extract::State};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};

use crate::{
    auth::AdminUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

const CATALOG_EXPORT_VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogImportBody {
    pub version: u32,
    #[serde(default)]
    pub include_game_settings: bool,
    #[serde(default)]
    pub ships: Vec<Value>,
    #[serde(default)]
    pub props: Vec<Value>,
    #[serde(default)]
    pub items: Vec<Value>,
    #[serde(default)]
    pub weapons: Vec<Value>,
    #[serde(default)]
    pub backpacks: Vec<Value>,
    #[serde(default)]
    pub wearables: Vec<Value>,
    #[serde(default)]
    pub credit_packs: Vec<Value>,
    #[serde(default)]
    pub mall_listings: Vec<Value>,
    #[serde(default)]
    pub settings: Option<Value>,
}

#[derive(Default)]
struct SectionCounts {
    inserted: u32,
    updated: u32,
}

impl SectionCounts {
    fn json(&self) -> Value {
        json!({ "inserted": self.inserted, "updated": self.updated })
    }

    fn record(&mut self, existed: bool) {
        if existed {
            self.updated += 1;
        } else {
            self.inserted += 1;
        }
    }
}

/// `GET /admin/catalog/export`
pub async fn export_catalog(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let ships = rows_to_json(
        sqlx::query(r#"SELECT * FROM "ShipDefinition" ORDER BY "id""#)
            .fetch_all(&state.db)
            .await?,
        ship_export,
    )?;
    let props = rows_to_json(
        sqlx::query(r#"SELECT * FROM "PropDefinition" ORDER BY "id""#)
            .fetch_all(&state.db)
            .await?,
        prop_export,
    )?;
    let items = rows_to_json(
        sqlx::query(r#"SELECT * FROM "ItemDefinition" ORDER BY "id""#)
            .fetch_all(&state.db)
            .await?,
        item_export,
    )?;
    let weapons = rows_to_json(
        sqlx::query(r#"SELECT * FROM "WeaponDefinition" ORDER BY "itemDefinitionId""#)
            .fetch_all(&state.db)
            .await?,
        weapon_export,
    )?;
    let backpacks = rows_to_json(
        sqlx::query(r#"SELECT * FROM "BackpackDefinition" ORDER BY "itemDefinitionId""#)
            .fetch_all(&state.db)
            .await?,
        backpack_export,
    )?;
    let wearables = rows_to_json(
        sqlx::query(r#"SELECT * FROM "WearableDefinition" ORDER BY "itemDefinitionId""#)
            .fetch_all(&state.db)
            .await?,
        wearable_export,
    )?;
    let credit_packs = rows_to_json(
        sqlx::query(r#"SELECT * FROM "CreditPack" ORDER BY "id""#)
            .fetch_all(&state.db)
            .await?,
        credit_pack_export,
    )?;
    let mall_listings = rows_to_json(
        sqlx::query(r#"SELECT * FROM "MallListing" ORDER BY "id""#)
            .fetch_all(&state.db)
            .await?,
        mall_export,
    )?;
    let settings_row = sqlx::query(r#"SELECT * FROM "GameSettings" WHERE "id"='singleton'"#)
        .fetch_optional(&state.db)
        .await?;
    let settings = settings_row.map(settings_export).transpose()?;

    Ok(Json(json!({
        "version": CATALOG_EXPORT_VERSION,
        "exportedAt": Utc::now().to_rfc3339(),
        "ships": ships,
        "props": props,
        "items": items,
        "weapons": weapons,
        "backpacks": backpacks,
        "wearables": wearables,
        "creditPacks": credit_packs,
        "mallListings": mall_listings,
        "settings": settings,
    })))
}

/// `PUT /admin/catalog/import`
pub async fn import_catalog(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<CatalogImportBody>,
) -> ApiResult<Json<Value>> {
    if body.version != CATALOG_EXPORT_VERSION {
        return Err(ApiError::BadRequest(format!(
            "Unsupported catalog export version {} (expected {CATALOG_EXPORT_VERSION}).",
            body.version
        )));
    }

    let mut tx = state.db.begin().await?;
    let mut items = SectionCounts::default();
    let mut weapons = SectionCounts::default();
    let mut backpacks = SectionCounts::default();
    let mut wearables = SectionCounts::default();
    let mut ships = SectionCounts::default();
    let mut props = SectionCounts::default();
    let mut credit_packs = SectionCounts::default();
    let mut mall_listings = SectionCounts::default();
    let mut settings = SectionCounts::default();

    for row in &body.items {
        upsert_item(&mut tx, row, &mut items).await?;
    }
    for row in &body.weapons {
        upsert_weapon(&mut tx, row, &mut weapons).await?;
    }
    for row in &body.backpacks {
        upsert_backpack(&mut tx, row, &mut backpacks).await?;
    }
    for row in &body.wearables {
        upsert_wearable(&mut tx, row, &mut wearables).await?;
    }
    for row in &body.ships {
        upsert_ship(&mut tx, row, &mut ships).await?;
    }
    for row in &body.props {
        upsert_prop(&mut tx, row, &mut props).await?;
    }
    for row in &body.credit_packs {
        upsert_credit_pack(&mut tx, row, &mut credit_packs).await?;
    }
    for row in &body.mall_listings {
        upsert_mall(&mut tx, row, &mut mall_listings).await?;
    }
    if body.include_game_settings
        && let Some(settings_row) = &body.settings
    {
        upsert_settings(&mut tx, settings_row, &mut settings).await?;
    }

    tx.commit().await?;

    Ok(Json(json!({
        "ok": true,
        "includeGameSettings": body.include_game_settings,
        "items": items.json(),
        "weapons": weapons.json(),
        "backpacks": backpacks.json(),
        "wearables": wearables.json(),
        "ships": ships.json(),
        "props": props.json(),
        "creditPacks": credit_packs.json(),
        "mallListings": mall_listings.json(),
        "settings": settings.json(),
    })))
}

fn rows_to_json(
    rows: Vec<PgRow>,
    map: fn(PgRow) -> Result<Value, sqlx::Error>,
) -> ApiResult<Vec<Value>> {
    rows.into_iter()
        .map(map)
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn ship_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "id": row.try_get::<String, _>("id")?,
        "name": row.try_get::<String, _>("name")?,
        "description": row.try_get::<String, _>("description")?,
        "prefabId": row.try_get::<String, _>("prefabId")?,
        "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?,
        "costArc": row.try_get::<i32, _>("costArc")?,
        "maxHp": row.try_get::<f64, _>("maxHp")?,
        "maxShields": row.try_get::<f64, _>("maxShields")?,
        "shieldRegenPerSec": row.try_get::<f64, _>("shieldRegenPerSec")?,
        "maxSpeedMps": row.try_get::<f64, _>("maxSpeedMps")?,
        "throttleAccelMps2": row.try_get::<f64, _>("throttleAccelMps2")?,
    }))
}

fn prop_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "id": row.try_get::<String, _>("id")?,
        "name": row.try_get::<String, _>("name")?,
        "description": row.try_get::<String, _>("description")?,
        "prefabId": row.try_get::<String, _>("prefabId")?,
        "costArc": row.try_get::<i32, _>("costArc")?,
        "category": row.try_get::<String, _>("category")?,
        "maxPerHangar": row.try_get::<Option<i32>, _>("maxPerHangar")?,
        "allowRotateY": row.try_get::<bool, _>("allowRotateY")?,
        "snapGridM": row.try_get::<Option<f64>, _>("snapGridM")?,
    }))
}

fn item_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "id": row.try_get::<String, _>("id")?,
        "name": row.try_get::<String, _>("name")?,
        "description": row.try_get::<String, _>("description")?,
        "itemType": row.try_get::<String, _>("itemType")?,
        "subType": row.try_get::<String, _>("subType")?,
        "prefabId": row.try_get::<Option<String>, _>("prefabId")?,
        "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?,
        "stackMax": row.try_get::<i32, _>("stackMax")?,
        "costArc": row.try_get::<i32, _>("costArc")?,
        "rarity": row.try_get::<String, _>("rarity")?,
        "metadata": row.try_get::<Option<Value>, _>("metadata")?,
    }))
}

fn weapon_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "itemDefinitionId": row.try_get::<String, _>("itemDefinitionId")?,
        "weaponSlotType": row.try_get::<String, _>("weaponSlotType")?,
        "ammoItemDefinitionId": row.try_get::<Option<String>, _>("ammoItemDefinitionId")?,
        "magazineSize": row.try_get::<i32, _>("magazineSize")?,
        "fireModes": row.try_get::<Value, _>("fireModes")?,
        "roundsPerMinute": row.try_get::<f64, _>("roundsPerMinute")?,
        "muzzleVelocityMps": row.try_get::<f64, _>("muzzleVelocityMps")?,
        "bulletGravityMps2": row.try_get::<f64, _>("bulletGravityMps2")?,
        "maxRangeMeters": row.try_get::<f64, _>("maxRangeMeters")?,
        "damage": row.try_get::<f64, _>("damage")?,
    }))
}

fn backpack_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "itemDefinitionId": row.try_get::<String, _>("itemDefinitionId")?,
        "capacityLiters": row.try_get::<f64, _>("capacityLiters")?,
        "emptyMassKg": row.try_get::<f64, _>("emptyMassKg")?,
    }))
}

fn wearable_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "itemDefinitionId": row.try_get::<String, _>("itemDefinitionId")?,
        "wearableSlotType": row.try_get::<String, _>("wearableSlotType")?,
        "occupiedSlotTypes": row.try_get::<Vec<String>, _>("occupiedSlotTypes")?,
        "sidekickPartPresetId": row.try_get::<i32, _>("sidekickPartPresetId")?,
    }))
}

fn credit_pack_export(row: PgRow) -> Result<Value, sqlx::Error> {
    // stripePriceId intentionally omitted — env-specific; import never writes it.
    Ok(json!({
        "id": row.try_get::<String, _>("id")?,
        "name": row.try_get::<String, _>("name")?,
        "description": row.try_get::<String, _>("description")?,
        "credits": row.try_get::<i32, _>("credits")?,
        "bonusCredits": row.try_get::<i32, _>("bonusCredits")?,
        "priceCents": row.try_get::<i32, _>("priceCents")?,
        "currency": row.try_get::<String, _>("currency")?,
        "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?,
        "sortOrder": row.try_get::<i32, _>("sortOrder")?,
        "active": row.try_get::<bool, _>("active")?,
    }))
}

fn mall_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "id": row.try_get::<String, _>("id")?,
        "itemDefinitionId": row.try_get::<String, _>("itemDefinitionId")?,
        "priceCredits": row.try_get::<i32, _>("priceCredits")?,
        "category": row.try_get::<String, _>("category")?,
        "sortOrder": row.try_get::<i32, _>("sortOrder")?,
        "featured": row.try_get::<bool, _>("featured")?,
        "active": row.try_get::<bool, _>("active")?,
        "limitPerPlayer": row.try_get::<Option<i32>, _>("limitPerPlayer")?,
    }))
}

fn settings_export(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(json!({
        "id": "singleton",
        "startingArcBalance": row.try_get::<i32, _>("startingArcBalance")?,
        "starterShipDefinitionIds": row.try_get::<Vec<String>, _>("starterShipDefinitionIds")?,
        "starterPropDefinitionIds": row.try_get::<Vec<String>, _>("starterPropDefinitionIds")?,
        "starterItemDefinitionIds": row.try_get::<Vec<String>, _>("starterItemDefinitionIds")?,
    }))
}

fn req_str(row: &Value, key: &str) -> ApiResult<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::BadRequest(format!("Missing required field \"{key}\".")))
}

fn opt_str(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(|v| {
            if v.is_null() {
                None
            } else {
                v.as_str().map(str::to_owned)
            }
        })
        .filter(|s| !s.is_empty())
}

fn req_i32(row: &Value, key: &str) -> ApiResult<i32> {
    row.get(key)
        .and_then(Value::as_i64)
        .map(|n| n as i32)
        .ok_or_else(|| ApiError::BadRequest(format!("Missing required field \"{key}\".")))
}

fn opt_i32(row: &Value, key: &str) -> Option<i32> {
    row.get(key).and_then(Value::as_i64).map(|n| n as i32)
}

fn req_f64(row: &Value, key: &str) -> ApiResult<f64> {
    row.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| ApiError::BadRequest(format!("Missing required field \"{key}\".")))
}

fn opt_f64(row: &Value, key: &str) -> Option<f64> {
    row.get(key).and_then(Value::as_f64)
}

fn req_bool(row: &Value, key: &str, default: bool) -> bool {
    row.get(key).and_then(Value::as_bool).unwrap_or(default)
}

async fn exists_id(tx: &mut Transaction<'_, Postgres>, table: &str, id: &str) -> ApiResult<bool> {
    // table names are fixed literals from this module only
    let sql = format!(r#"SELECT EXISTS(SELECT 1 FROM "{table}" WHERE "id"=$1)"#);
    Ok(sqlx::query_scalar(&sql).bind(id).fetch_one(&mut **tx).await?)
}

async fn exists_item_ext(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    id: &str,
) -> ApiResult<bool> {
    let sql = format!(r#"SELECT EXISTS(SELECT 1 FROM "{table}" WHERE "itemDefinitionId"=$1)"#);
    Ok(sqlx::query_scalar(&sql).bind(id).fetch_one(&mut **tx).await?)
}

async fn upsert_item(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "id")?;
    let name = req_str(row, "name")?;
    let description = row
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let item_type = req_str(row, "itemType")?;
    let sub_type = row
        .get("subType")
        .and_then(Value::as_str)
        .unwrap_or("generic")
        .to_owned();
    let prefab_id = opt_str(row, "prefabId");
    let icon_url = opt_str(row, "iconUrl");
    let stack_max = opt_i32(row, "stackMax").unwrap_or(99);
    let cost_arc = opt_i32(row, "costArc").unwrap_or(0);
    let rarity = row
        .get("rarity")
        .and_then(Value::as_str)
        .unwrap_or("common")
        .to_owned();
    let metadata = row.get("metadata").cloned().unwrap_or(Value::Null);
    let metadata = if metadata.is_null() {
        None
    } else {
        Some(metadata)
    };

    let existed = exists_id(tx, "ItemDefinition", &id).await?;
    if existed {
        sqlx::query(
            r#"UPDATE "ItemDefinition" SET
                "name"=$2, "description"=$3, "itemType"=$4, "subType"=$5,
                "prefabId"=$6, "iconUrl"=$7, "stackMax"=$8, "costArc"=$9,
                "rarity"=$10, "metadata"=$11, "updatedAt"=NOW()
               WHERE "id"=$1"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(&item_type)
        .bind(&sub_type)
        .bind(&prefab_id)
        .bind(&icon_url)
        .bind(stack_max)
        .bind(cost_arc)
        .bind(&rarity)
        .bind(&metadata)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "ItemDefinition"
               ("id","name","description","itemType","subType","prefabId","iconUrl",
                "stackMax","costArc","rarity","metadata","createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(&item_type)
        .bind(&sub_type)
        .bind(&prefab_id)
        .bind(&icon_url)
        .bind(stack_max)
        .bind(cost_arc)
        .bind(&rarity)
        .bind(&metadata)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_weapon(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "itemDefinitionId")?;
    let slot = req_str(row, "weaponSlotType")?;
    let ammo = opt_str(row, "ammoItemDefinitionId");
    let magazine = req_i32(row, "magazineSize")?;
    let fire_modes = row
        .get("fireModes")
        .cloned()
        .unwrap_or_else(|| json!(["single"]));
    let rpm = req_f64(row, "roundsPerMinute")?;
    let muzzle = req_f64(row, "muzzleVelocityMps")?;
    let gravity = opt_f64(row, "bulletGravityMps2").unwrap_or(9.81);
    let range = req_f64(row, "maxRangeMeters")?;
    let damage = opt_f64(row, "damage").unwrap_or(0.0);

    let existed = exists_item_ext(tx, "WeaponDefinition", &id).await?;
    if existed {
        sqlx::query(
            r#"UPDATE "WeaponDefinition" SET
                "weaponSlotType"=$2, "ammoItemDefinitionId"=$3, "magazineSize"=$4,
                "fireModes"=$5, "roundsPerMinute"=$6, "muzzleVelocityMps"=$7,
                "bulletGravityMps2"=$8, "maxRangeMeters"=$9, "damage"=$10, "updatedAt"=NOW()
               WHERE "itemDefinitionId"=$1"#,
        )
        .bind(&id)
        .bind(&slot)
        .bind(&ammo)
        .bind(magazine)
        .bind(&fire_modes)
        .bind(rpm)
        .bind(muzzle)
        .bind(gravity)
        .bind(range)
        .bind(damage)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "WeaponDefinition"
               ("itemDefinitionId","weaponSlotType","ammoItemDefinitionId","magazineSize",
                "fireModes","roundsPerMinute","muzzleVelocityMps","bulletGravityMps2",
                "maxRangeMeters","damage","createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(&slot)
        .bind(&ammo)
        .bind(magazine)
        .bind(&fire_modes)
        .bind(rpm)
        .bind(muzzle)
        .bind(gravity)
        .bind(range)
        .bind(damage)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_backpack(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "itemDefinitionId")?;
    let capacity = req_f64(row, "capacityLiters")?;
    let mass = req_f64(row, "emptyMassKg")?;
    let existed = exists_item_ext(tx, "BackpackDefinition", &id).await?;
    if existed {
        sqlx::query(
            r#"UPDATE "BackpackDefinition" SET
                "capacityLiters"=$2, "emptyMassKg"=$3, "updatedAt"=NOW()
               WHERE "itemDefinitionId"=$1"#,
        )
        .bind(&id)
        .bind(capacity)
        .bind(mass)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "BackpackDefinition"
               ("itemDefinitionId","capacityLiters","emptyMassKg","createdAt","updatedAt")
               VALUES ($1,$2,$3,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(capacity)
        .bind(mass)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_wearable(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "itemDefinitionId")?;
    let slot = req_str(row, "wearableSlotType")?;
    let occupied = row
        .get("occupiedSlotTypes")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![slot.clone()]);
    let preset = req_i32(row, "sidekickPartPresetId")?;
    let existed = exists_item_ext(tx, "WearableDefinition", &id).await?;
    if existed {
        sqlx::query(
            r#"UPDATE "WearableDefinition" SET
                "wearableSlotType"=$2, "occupiedSlotTypes"=$3, "sidekickPartPresetId"=$4,
                "updatedAt"=NOW()
               WHERE "itemDefinitionId"=$1"#,
        )
        .bind(&id)
        .bind(&slot)
        .bind(&occupied)
        .bind(preset)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "WearableDefinition"
               ("itemDefinitionId","wearableSlotType","occupiedSlotTypes","sidekickPartPresetId",
                "createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(&slot)
        .bind(&occupied)
        .bind(preset)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_ship(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "id")?;
    let name = req_str(row, "name")?;
    let description = row
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let prefab_id = req_str(row, "prefabId")?;
    let icon_url = opt_str(row, "iconUrl");
    let cost_arc = req_i32(row, "costArc")?;
    let max_hp = req_f64(row, "maxHp")?;
    let max_shields = req_f64(row, "maxShields")?;
    let shield_regen = req_f64(row, "shieldRegenPerSec")?;
    let max_speed = req_f64(row, "maxSpeedMps")?;
    let throttle = req_f64(row, "throttleAccelMps2")?;

    let existed = exists_id(tx, "ShipDefinition", &id).await?;
    if existed {
        sqlx::query(
            r#"UPDATE "ShipDefinition" SET
                "name"=$2, "description"=$3, "prefabId"=$4, "iconUrl"=$5, "costArc"=$6,
                "maxHp"=$7, "maxShields"=$8, "shieldRegenPerSec"=$9, "maxSpeedMps"=$10,
                "throttleAccelMps2"=$11, "updatedAt"=NOW()
               WHERE "id"=$1"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(&prefab_id)
        .bind(&icon_url)
        .bind(cost_arc)
        .bind(max_hp)
        .bind(max_shields)
        .bind(shield_regen)
        .bind(max_speed)
        .bind(throttle)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "ShipDefinition"
               ("id","name","description","prefabId","iconUrl","costArc","maxHp","maxShields",
                "shieldRegenPerSec","maxSpeedMps","throttleAccelMps2","createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(&prefab_id)
        .bind(&icon_url)
        .bind(cost_arc)
        .bind(max_hp)
        .bind(max_shields)
        .bind(shield_regen)
        .bind(max_speed)
        .bind(throttle)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_prop(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "id")?;
    let name = req_str(row, "name")?;
    let description = row
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let prefab_id = req_str(row, "prefabId")?;
    let cost_arc = req_i32(row, "costArc")?;
    let category = row
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or("decoration")
        .to_owned();
    let max_per = opt_i32(row, "maxPerHangar");
    let allow_rotate = req_bool(row, "allowRotateY", true);
    let snap = opt_f64(row, "snapGridM");

    let existed = exists_id(tx, "PropDefinition", &id).await?;
    if existed {
        sqlx::query(
            r#"UPDATE "PropDefinition" SET
                "name"=$2, "description"=$3, "prefabId"=$4, "costArc"=$5, "category"=$6,
                "maxPerHangar"=$7, "allowRotateY"=$8, "snapGridM"=$9, "updatedAt"=NOW()
               WHERE "id"=$1"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(&prefab_id)
        .bind(cost_arc)
        .bind(&category)
        .bind(max_per)
        .bind(allow_rotate)
        .bind(snap)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "PropDefinition"
               ("id","name","description","prefabId","costArc","category","maxPerHangar",
                "allowRotateY","snapGridM","createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(&prefab_id)
        .bind(cost_arc)
        .bind(&category)
        .bind(max_per)
        .bind(allow_rotate)
        .bind(snap)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_credit_pack(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "id")?;
    let name = req_str(row, "name")?;
    let description = row
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let credits = req_i32(row, "credits")?;
    let bonus = opt_i32(row, "bonusCredits").unwrap_or(0);
    let price_cents = req_i32(row, "priceCents")?;
    let currency = row
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("usd")
        .to_owned();
    let icon_url = opt_str(row, "iconUrl");
    let sort_order = opt_i32(row, "sortOrder").unwrap_or(0);
    let active = req_bool(row, "active", true);

    let existed = exists_id(tx, "CreditPack", &id).await?;
    if existed {
        // Never touch stripePriceId.
        sqlx::query(
            r#"UPDATE "CreditPack" SET
                "name"=$2, "description"=$3, "credits"=$4, "bonusCredits"=$5, "priceCents"=$6,
                "currency"=$7, "iconUrl"=$8, "sortOrder"=$9, "active"=$10, "updatedAt"=NOW()
               WHERE "id"=$1"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(credits)
        .bind(bonus)
        .bind(price_cents)
        .bind(&currency)
        .bind(&icon_url)
        .bind(sort_order)
        .bind(active)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "CreditPack"
               ("id","name","description","credits","bonusCredits","priceCents","currency",
                "stripePriceId","iconUrl","sortOrder","active","createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .bind(credits)
        .bind(bonus)
        .bind(price_cents)
        .bind(&currency)
        .bind(&icon_url)
        .bind(sort_order)
        .bind(active)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_mall(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let id = req_str(row, "id")?;
    let item_id = req_str(row, "itemDefinitionId")?;
    let price = req_i32(row, "priceCredits")?;
    let category = row
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or("consumable")
        .to_owned();
    let sort_order = opt_i32(row, "sortOrder").unwrap_or(0);
    let featured = req_bool(row, "featured", false);
    let active = req_bool(row, "active", true);
    let limit = opt_i32(row, "limitPerPlayer");

    let existed = exists_id(tx, "MallListing", &id).await?;
    if existed {
        sqlx::query(
            r#"UPDATE "MallListing" SET
                "itemDefinitionId"=$2, "priceCredits"=$3, "category"=$4, "sortOrder"=$5,
                "featured"=$6, "active"=$7, "limitPerPlayer"=$8, "updatedAt"=NOW()
               WHERE "id"=$1"#,
        )
        .bind(&id)
        .bind(&item_id)
        .bind(price)
        .bind(&category)
        .bind(sort_order)
        .bind(featured)
        .bind(active)
        .bind(limit)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO "MallListing"
               ("id","itemDefinitionId","priceCredits","category","sortOrder","featured",
                "active","limitPerPlayer","createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())"#,
        )
        .bind(&id)
        .bind(&item_id)
        .bind(price)
        .bind(&category)
        .bind(sort_order)
        .bind(featured)
        .bind(active)
        .bind(limit)
        .execute(&mut **tx)
        .await?;
    }
    counts.record(existed);
    Ok(())
}

async fn upsert_settings(
    tx: &mut Transaction<'_, Postgres>,
    row: &Value,
    counts: &mut SectionCounts,
) -> ApiResult<()> {
    let starting = req_i32(row, "startingArcBalance")?;
    let ships = row
        .get("starterShipDefinitionIds")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let props = row
        .get("starterPropDefinitionIds")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let items = row
        .get("starterItemDefinitionIds")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let existed = exists_id(tx, "GameSettings", "singleton").await?;
    sqlx::query(
        r#"INSERT INTO "GameSettings"
           ("id","startingArcBalance","starterShipDefinitionIds","starterPropDefinitionIds",
            "starterItemDefinitionIds","createdAt","updatedAt")
           VALUES ('singleton',$1,$2,$3,$4,NOW(),NOW())
           ON CONFLICT ("id") DO UPDATE SET
             "startingArcBalance"=EXCLUDED."startingArcBalance",
             "starterShipDefinitionIds"=EXCLUDED."starterShipDefinitionIds",
             "starterPropDefinitionIds"=EXCLUDED."starterPropDefinitionIds",
             "starterItemDefinitionIds"=EXCLUDED."starterItemDefinitionIds",
             "updatedAt"=NOW()"#,
    )
    .bind(starting)
    .bind(&ships)
    .bind(&props)
    .bind(&items)
    .execute(&mut **tx)
    .await?;
    counts.record(existed);
    Ok(())
}
