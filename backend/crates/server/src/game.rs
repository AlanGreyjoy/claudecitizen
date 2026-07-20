use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    auth::{AccessUser, require_player_id},
    error::{ApiError, ApiResult},
    state::AppState,
};

const DEFAULT_SHIELD_REGEN: f64 = 25.0;
const DEFAULT_MAX_SPEED: f64 = 100.0;
const DEFAULT_ACCEL: f64 = 308.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BuildArea {
    Hangar,
    Apartment,
}

impl BuildArea {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hangar => "hangar",
            Self::Apartment => "apartment",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseItemBody {
    item_definition_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquipItemBody {
    slot_id: String,
    item_definition_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchasePropBody {
    prop_definition_id: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementTransform {
    right: f64,
    up: f64,
    forward: f64,
    #[serde(default)]
    rotation_y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlacementBody {
    prop_definition_id: String,
    right: f64,
    up: f64,
    forward: f64,
    #[serde(default)]
    rotation_y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignedBayBody {
    hangar_index: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VitalsPulseBody {
    sequence: i64,
    sprinting_seconds: f64,
}

const HUNGER_FULL_TO_EMPTY_SECONDS: f64 = 4.0 * 60.0 * 60.0;
const THIRST_FULL_TO_EMPTY_SECONDS: f64 = 2.0 * 60.0 * 60.0;

pub async fn bootstrap(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    grant_starter_loadout(&state, &player_id).await?;
    let player = sqlx::query(
        r#"SELECT "id", "handle", "displayName", "characterAppearance", "arcBalance",
                  "currentInstanceId", "currentRoomId", "hungerReserve", "thirstReserve"
           FROM "Player" WHERE "id" = $1"#,
    )
    .bind(&player_id)
    .fetch_one(&state.db)
    .await?;
    let ships = owned_ships(&state, &player_id).await?;
    let hangar = build_state(&state, &player_id, BuildArea::Hangar).await?;
    let apartment = build_state(&state, &player_id, BuildArea::Apartment).await?;
    let inventory = inventory_state(&state, &player_id).await?;
    Ok(Json(json!({
        "player": {
            "id": player.try_get::<String, _>("id")?,
            "handle": player.try_get::<String, _>("handle")?,
            "displayName": player.try_get::<String, _>("displayName")?,
            "characterAppearance": normalize_stored_appearance(player.try_get::<Option<Value>, _>("characterAppearance")?),
            "vitals": vitals_json(
                player.try_get::<f64, _>("hungerReserve")?,
                player.try_get::<f64, _>("thirstReserve")?,
            ),
        },
        "economy": { "arcBalance": player.try_get::<i32, _>("arcBalance")? },
        "spawn": {
            "instanceId": player.try_get::<String, _>("currentInstanceId")?,
            "apartmentInstanceId": format!("apartment:{player_id}"),
            "hangarInstanceId": format!("hangar:{player_id}"),
            "stationRoomId": player.try_get::<String, _>("currentRoomId")?,
        },
        "ships": ships,
        "hangar": hangar,
        "apartment": apartment,
        "inventory": inventory,
        "featureFlags": {
            "webTransportPresence": true,
            "serverAuthoritativePhysics": true,
        }
    })))
}

pub async fn start_vitals_session(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    let session_id = Uuid::new_v4().to_string();
    let row = sqlx::query(
        r#"UPDATE "Player"
           SET "vitalsSessionId" = $2,
               "vitalsSessionSequence" = 0,
               "vitalsSessionSprintSeconds" = 0,
               "vitalsHeartbeatAt" = NOW(),
               "updatedAt" = NOW()
           WHERE "id" = $1
           RETURNING "hungerReserve", "thirstReserve""#,
    )
    .bind(&player_id)
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("Player not found.".to_owned()))?;

    Ok(Json(vitals_session_json(
        &session_id,
        0,
        row.try_get("hungerReserve")?,
        row.try_get("thirstReserve")?,
    )))
}

pub async fn pulse_vitals_session(
    State(state): State<AppState>,
    access: AccessUser,
    Path(session_id): Path<String>,
    Json(body): Json<VitalsPulseBody>,
) -> ApiResult<Json<Value>> {
    update_vitals_session(&state, &access, &session_id, body, false).await
}

pub async fn resume_vitals_session(
    State(state): State<AppState>,
    access: AccessUser,
    Path(session_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    let row = sqlx::query(
        r#"UPDATE "Player"
           SET "vitalsSessionSequence" = 0,
               "vitalsSessionSprintSeconds" = 0,
               "vitalsHeartbeatAt" = NOW(),
               "updatedAt" = NOW()
           WHERE "id" = $1 AND "vitalsSessionId" = $2
           RETURNING "vitalsSessionSequence", "hungerReserve", "thirstReserve""#,
    )
    .bind(&player_id)
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else {
        return Err(ApiError::Conflict(
            "Vitals session was superseded by another play session.".to_owned(),
        ));
    };

    Ok(Json(vitals_session_json(
        &session_id,
        row.try_get("vitalsSessionSequence")?,
        row.try_get("hungerReserve")?,
        row.try_get("thirstReserve")?,
    )))
}

pub async fn stop_vitals_session(
    State(state): State<AppState>,
    access: AccessUser,
    Path(session_id): Path<String>,
    Json(body): Json<VitalsPulseBody>,
) -> ApiResult<Json<Value>> {
    update_vitals_session(&state, &access, &session_id, body, true).await
}

async fn update_vitals_session(
    state: &AppState,
    access: &AccessUser,
    session_id: &str,
    body: VitalsPulseBody,
    stop: bool,
) -> ApiResult<Json<Value>> {
    if body.sequence < 1 || !body.sprinting_seconds.is_finite() || body.sprinting_seconds < 0.0 {
        return Err(ApiError::BadRequest("Vitals pulse is invalid.".to_owned()));
    }

    let player_id = require_player_id(state, &access.user_id).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        r#"SELECT "vitalsSessionId", "vitalsSessionSequence",
                  "vitalsSessionSprintSeconds", "hungerReserve", "thirstReserve",
                  GREATEST(0, EXTRACT(EPOCH FROM (NOW() - "vitalsHeartbeatAt")))::DOUBLE PRECISION AS "elapsedSeconds"
           FROM "Player" WHERE "id" = $1 FOR UPDATE"#,
    )
    .bind(&player_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Player not found.".to_owned()))?;

    let active_session: Option<String> = row.try_get("vitalsSessionId")?;
    if active_session.as_deref() != Some(session_id) {
        return Err(ApiError::Conflict(
            "Vitals session was superseded by another play session.".to_owned(),
        ));
    }

    let accepted_sequence: i64 = row.try_get("vitalsSessionSequence")?;
    let accepted_sprinting_seconds: f64 = row.try_get("vitalsSessionSprintSeconds")?;
    let mut hunger: f64 = row.try_get("hungerReserve")?;
    let mut thirst: f64 = row.try_get("thirstReserve")?;
    let mut next_sequence = accepted_sequence;

    if body.sequence > accepted_sequence {
        let elapsed_seconds = row
            .try_get::<Option<f64>, _>("elapsedSeconds")?
            .unwrap_or_default()
            .max(0.0);
        let sprinting_seconds = (body.sprinting_seconds - accepted_sprinting_seconds)
            .max(0.0)
            .min(elapsed_seconds);
        let effective_seconds = elapsed_seconds + sprinting_seconds;
        hunger = (hunger - effective_seconds / HUNGER_FULL_TO_EMPTY_SECONDS).clamp(0.0, 1.0);
        thirst = (thirst - effective_seconds / THIRST_FULL_TO_EMPTY_SECONDS).clamp(0.0, 1.0);
        next_sequence = body.sequence;

        sqlx::query(
            r#"UPDATE "Player"
               SET "hungerReserve" = $2,
                   "thirstReserve" = $3,
                   "vitalsSessionSequence" = $4,
                   "vitalsSessionSprintSeconds" = GREATEST("vitalsSessionSprintSeconds", $6),
                   "vitalsHeartbeatAt" = NOW(),
                   "vitalsSessionId" = CASE WHEN $5 THEN NULL ELSE "vitalsSessionId" END,
                   "updatedAt" = NOW()
               WHERE "id" = $1"#,
        )
        .bind(&player_id)
        .bind(hunger)
        .bind(thirst)
        .bind(next_sequence)
        .bind(stop)
        .bind(body.sprinting_seconds)
        .execute(&mut *tx)
        .await?;
    } else if stop {
        sqlx::query(
            r#"UPDATE "Player"
               SET "vitalsSessionId" = NULL,
                   "vitalsHeartbeatAt" = NULL,
                   "updatedAt" = NOW()
               WHERE "id" = $1"#,
        )
        .bind(&player_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(vitals_session_json(
        session_id,
        next_sequence,
        hunger,
        thirst,
    )))
}

fn vitals_json(hunger: f64, thirst: f64) -> Value {
    json!({
        "hungerReserve01": hunger.clamp(0.0, 1.0),
        "thirstReserve01": thirst.clamp(0.0, 1.0),
    })
}

fn vitals_session_json(
    session_id: &str,
    accepted_sequence: i64,
    hunger: f64,
    thirst: f64,
) -> Value {
    json!({
        "sessionId": session_id,
        "acceptedSequence": accepted_sequence,
        "vitals": vitals_json(hunger, thirst),
    })
}

pub async fn save_character(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let appearance = validate_appearance(body)?;
    let player_id = require_player_id(&state, &access.user_id).await?;
    sqlx::query(
        r#"UPDATE "Player" SET "characterAppearance" = $2, "updatedAt" = NOW() WHERE "id" = $1"#,
    )
    .bind(player_id)
    .bind(sqlx::types::Json(appearance.clone()))
    .execute(&state.db)
    .await?;
    Ok(Json(appearance))
}

pub async fn get_hangar_build(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<Value>> {
    get_build(state, access, BuildArea::Hangar).await
}

pub async fn get_apartment_build(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<Value>> {
    get_build(state, access, BuildArea::Apartment).await
}

pub async fn purchase_hangar_prop(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<PurchasePropBody>,
) -> ApiResult<Json<Value>> {
    purchase_prop(state, access, body, BuildArea::Hangar).await
}

pub async fn purchase_apartment_prop(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<PurchasePropBody>,
) -> ApiResult<Json<Value>> {
    purchase_prop(state, access, body, BuildArea::Apartment).await
}

pub async fn purchase_inventory_item(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<PurchaseItemBody>,
) -> ApiResult<Json<Value>> {
    if body.item_definition_id.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "itemDefinitionId is required.".to_owned(),
        ));
    }
    let player_id = require_player_id(&state, &access.user_id).await?;
    let mut tx = state.db.begin().await?;
    let player = sqlx::query(r#"SELECT "arcBalance" FROM "Player" WHERE "id" = $1 FOR UPDATE"#)
        .bind(&player_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound("Player not found.".to_owned()))?;
    let definition = sqlx::query(
        r#"SELECT "itemType", "costArc", "stackMax" FROM "ItemDefinition" WHERE "id" = $1"#,
    )
    .bind(&body.item_definition_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Item definition not found.".to_owned()))?;
    if definition.try_get::<String, _>("itemType")? != "weapon" {
        return Err(ApiError::BadRequest(
            "Only weapons can be purchased from this shop.".to_owned(),
        ));
    }
    let cost: i32 = definition.try_get("costArc")?;
    let balance: i32 = player.try_get("arcBalance")?;
    if balance < cost {
        return Err(ApiError::BadRequest("Insufficient ARC balance.".to_owned()));
    }
    let owned: i32 = sqlx::query_scalar(
        r#"SELECT COALESCE((SELECT "quantity" FROM "PlayerItem"
           WHERE "playerId" = $1 AND "itemDefinitionId" = $2), 0)"#,
    )
    .bind(&player_id)
    .bind(&body.item_definition_id)
    .fetch_one(&mut *tx)
    .await?;
    if owned >= 1 {
        return Err(ApiError::BadRequest(
            "You already own this weapon.".to_owned(),
        ));
    }
    sqlx::query(r#"UPDATE "Player" SET "arcBalance" = "arcBalance" - $2, "updatedAt" = NOW() WHERE "id" = $1"#)
        .bind(&player_id)
        .bind(cost)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"INSERT INTO "PlayerItem"
           ("id", "playerId", "itemDefinitionId", "quantity", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 1, NOW(), NOW())
           ON CONFLICT ("playerId", "itemDefinitionId") DO UPDATE
           SET "quantity" = "PlayerItem"."quantity" + 1, "updatedAt" = NOW()"#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&player_id)
    .bind(&body.item_definition_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({
        "arcBalance": balance - cost,
        "inventory": inventory_state(&state, &player_id).await?,
    })))
}

pub async fn equip_inventory_item(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<EquipItemBody>,
) -> ApiResult<Json<Value>> {
    let slot = loadout_slot(body.slot_id.trim()).ok_or_else(|| {
        ApiError::BadRequest(format!("Unknown equipment slot \"{}\".", body.slot_id))
    })?;
    let player_id = require_player_id(&state, &access.user_id).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(r#"SELECT "loadout" FROM "Player" WHERE "id" = $1 FOR UPDATE"#)
        .bind(&player_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound("Player not found.".to_owned()))?;
    let mut loadout = parse_loadout(row.try_get::<Option<Value>, _>("loadout")?);
    let Some(item_id) = body.item_definition_id.map(|value| value.trim().to_owned()) else {
        clear_loadout_slot(&mut loadout, slot.id);
        save_loadout(&mut tx, &player_id, &loadout).await?;
        tx.commit().await?;
        return Ok(Json(
            json!({ "inventory": inventory_state(&state, &player_id).await? }),
        ));
    };
    if item_id.is_empty() {
        return Err(ApiError::BadRequest(
            "itemDefinitionId must be a string or null.".to_owned(),
        ));
    }
    let definition = sqlx::query(
        r#"SELECT i."itemType", w."weaponSlotType", d."wearableSlotType", d."occupiedSlotTypes"
           FROM "ItemDefinition" i
           LEFT JOIN "WeaponDefinition" w ON w."itemDefinitionId" = i."id"
           LEFT JOIN "WearableDefinition" d ON d."itemDefinitionId" = i."id"
           WHERE i."id" = $1"#,
    )
    .bind(&item_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Item definition not found.".to_owned()))?;
    let owned: i32 = sqlx::query_scalar(
        r#"SELECT COALESCE((SELECT "quantity" FROM "PlayerItem"
           WHERE "playerId" = $1 AND "itemDefinitionId" = $2), 0)"#,
    )
    .bind(&player_id)
    .bind(&item_id)
    .fetch_one(&mut *tx)
    .await?;
    if owned < 1 {
        return Err(ApiError::BadRequest("You do not own that item.".to_owned()));
    }
    let item_type: String = definition.try_get("itemType")?;
    match slot.kind {
        LoadoutKind::Backpack if item_type != "backpack" => {
            return Err(ApiError::BadRequest(
                "Only backpacks can fill the backpack slot.".to_owned(),
            ));
        }
        LoadoutKind::Weapon if item_type != "weapon" => {
            return Err(ApiError::BadRequest(
                "Only weapons can fill weapon slots.".to_owned(),
            ));
        }
        LoadoutKind::Weapon => {
            let weapon_type: Option<String> = definition.try_get("weaponSlotType")?;
            if weapon_type.as_deref() != slot.weapon_slot_type {
                return Err(ApiError::BadRequest(format!(
                    "This slot requires a {} weapon.",
                    slot.weapon_slot_type.unwrap_or("compatible")
                )));
            }
        }
        LoadoutKind::Wearable if item_type != "armor" && item_type != "clothing" => {
            return Err(ApiError::BadRequest(
                "Only armor or clothing can fill wearable slots.".to_owned(),
            ));
        }
        LoadoutKind::Wearable => {
            let wearable_slot_type: Option<String> = definition.try_get("wearableSlotType")?;
            if wearable_slot_type.as_deref() != slot.wearable_slot_type {
                return Err(ApiError::BadRequest(format!(
                    "This item belongs in the {} slot.",
                    wearable_slot_type
                        .as_deref()
                        .unwrap_or("configured wearable")
                )));
            }
        }
        LoadoutKind::Backpack => {}
    }
    if let Some(required) = slot.requires_slot_id
        && !loadout.contains_key(required)
    {
        return Err(ApiError::BadRequest(format!(
            "Equip a {required} before using {}.",
            slot.label
        )));
    }
    let occupied: Vec<String> = loadout
        .iter()
        .filter(|(occupied_slot, occupied_item)| {
            occupied_slot.as_str() != slot.id && occupied_item.as_str() == item_id
        })
        .map(|(occupied_slot, _)| occupied_slot.clone())
        .collect();
    for occupied_slot in occupied {
        clear_loadout_slot(&mut loadout, &occupied_slot);
    }
    if matches!(slot.kind, LoadoutKind::Wearable) {
        let new_occupied: Vec<String> = definition.try_get("occupiedSlotTypes")?;
        let equipped_ids: Vec<String> = loadout
            .iter()
            .filter(|(slot_id, _)| {
                LOADOUT_SLOTS.iter().any(|candidate| {
                    candidate.id == slot_id.as_str()
                        && matches!(candidate.kind, LoadoutKind::Wearable)
                })
            })
            .map(|(_, equipped_item)| equipped_item.clone())
            .collect();
        if !equipped_ids.is_empty() {
            let wearable_rows = sqlx::query(
                r#"SELECT "itemDefinitionId", "occupiedSlotTypes"
                   FROM "WearableDefinition" WHERE "itemDefinitionId" = ANY($1)"#,
            )
            .bind(&equipped_ids)
            .fetch_all(&mut *tx)
            .await?;
            let conflicts: HashSet<String> = wearable_rows
                .into_iter()
                .filter_map(|row| {
                    let equipped_item: String = row.try_get("itemDefinitionId").ok()?;
                    let occupied_slots: Vec<String> = row.try_get("occupiedSlotTypes").ok()?;
                    occupied_slots
                        .iter()
                        .any(|candidate| new_occupied.contains(candidate))
                        .then_some(equipped_item)
                })
                .collect();
            loadout.retain(|_, equipped_item| !conflicts.contains(equipped_item));
        }
    }
    loadout.insert(slot.id.to_owned(), item_id);
    save_loadout(&mut tx, &player_id, &loadout).await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "inventory": inventory_state(&state, &player_id).await? }),
    ))
}

pub async fn create_hangar_placement(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<CreatePlacementBody>,
) -> ApiResult<Json<Value>> {
    create_placement(state, access, body, BuildArea::Hangar).await
}

pub async fn create_apartment_placement(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<CreatePlacementBody>,
) -> ApiResult<Json<Value>> {
    create_placement(state, access, body, BuildArea::Apartment).await
}

pub async fn update_hangar_placement(
    State(state): State<AppState>,
    access: AccessUser,
    Path(id): Path<String>,
    Json(transform): Json<PlacementTransform>,
) -> ApiResult<Json<Value>> {
    update_placement(state, access, id, transform, BuildArea::Hangar).await
}

pub async fn update_apartment_placement(
    State(state): State<AppState>,
    access: AccessUser,
    Path(id): Path<String>,
    Json(transform): Json<PlacementTransform>,
) -> ApiResult<Json<Value>> {
    update_placement(state, access, id, transform, BuildArea::Apartment).await
}

pub async fn delete_hangar_placement(
    State(state): State<AppState>,
    access: AccessUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    delete_placement(state, access, id, BuildArea::Hangar).await
}

pub async fn delete_apartment_placement(
    State(state): State<AppState>,
    access: AccessUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    delete_placement(state, access, id, BuildArea::Apartment).await
}

pub async fn set_assigned_bay(
    State(state): State<AppState>,
    access: AccessUser,
    Json(body): Json<AssignedBayBody>,
) -> ApiResult<Json<Value>> {
    if !(1..=3).contains(&body.hangar_index) {
        return Err(ApiError::BadRequest(
            "hangarIndex must be from 1 to 3.".to_owned(),
        ));
    }
    let player_id = require_player_id(&state, &access.user_id).await?;
    sqlx::query(
        r#"UPDATE "Player" SET "assignedHangar" = $2, "updatedAt" = NOW() WHERE "id" = $1"#,
    )
    .bind(&player_id)
    .bind(body.hangar_index)
    .execute(&state.db)
    .await?;
    Ok(Json(
        build_state(&state, &player_id, BuildArea::Hangar).await?,
    ))
}

pub async fn reset_assigned_bay(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    sqlx::query(
        r#"UPDATE "Player" SET "assignedHangar" = NULL, "updatedAt" = NOW() WHERE "id" = $1"#,
    )
    .bind(&player_id)
    .execute(&state.db)
    .await?;
    Ok(Json(
        build_state(&state, &player_id, BuildArea::Hangar).await?,
    ))
}

async fn get_build(state: AppState, access: AccessUser, area: BuildArea) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    Ok(Json(build_state(&state, &player_id, area).await?))
}

async fn purchase_prop(
    state: AppState,
    access: AccessUser,
    body: PurchasePropBody,
    area: BuildArea,
) -> ApiResult<Json<Value>> {
    if body.prop_definition_id.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "propDefinitionId is required.".to_owned(),
        ));
    }
    let player_id = require_player_id(&state, &access.user_id).await?;
    let mut tx = state.db.begin().await?;
    let balance: i32 =
        sqlx::query_scalar(r#"SELECT "arcBalance" FROM "Player" WHERE "id" = $1 FOR UPDATE"#)
            .bind(&player_id)
            .fetch_one(&mut *tx)
            .await?;
    let cost: i32 = sqlx::query_scalar(r#"SELECT "costArc" FROM "PropDefinition" WHERE "id" = $1"#)
        .bind(&body.prop_definition_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::NotFound("Prop definition not found.".to_owned()))?;
    if balance < cost {
        return Err(ApiError::BadRequest("Insufficient ARC balance.".to_owned()));
    }
    sqlx::query(r#"UPDATE "Player" SET "arcBalance" = "arcBalance" - $2, "updatedAt" = NOW() WHERE "id" = $1"#)
        .bind(&player_id)
        .bind(cost)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"INSERT INTO "PlayerProp"
           ("id", "playerId", "propDefinitionId", "quantity", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 1, NOW(), NOW())
           ON CONFLICT ("playerId", "propDefinitionId") DO UPDATE
           SET "quantity" = "PlayerProp"."quantity" + 1, "updatedAt" = NOW()"#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&player_id)
    .bind(&body.prop_definition_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let mut result = build_state(&state, &player_id, area).await?;
    result["arcBalance"] = json!(balance - cost);
    Ok(Json(result))
}

async fn create_placement(
    state: AppState,
    access: AccessUser,
    body: CreatePlacementBody,
    area: BuildArea,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    let transform = PlacementTransform {
        right: body.right,
        up: body.up,
        forward: body.forward,
        rotation_y: body.rotation_y,
    };
    let mut tx = state.db.begin().await?;
    let owned: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE((SELECT "quantity" FROM "PlayerProp"
           WHERE "playerId" = $1 AND "propDefinitionId" = $2), 0)::BIGINT"#,
    )
    .bind(&player_id)
    .bind(&body.prop_definition_id)
    .fetch_one(&mut *tx)
    .await?;
    let placed: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM "HangarPlacement"
           WHERE "playerId" = $1 AND "propDefinitionId" = $2"#,
    )
    .bind(&player_id)
    .bind(&body.prop_definition_id)
    .fetch_one(&mut *tx)
    .await?;
    if placed >= owned {
        return Err(ApiError::BadRequest(
            "No unplaced inventory remains for this prop.".to_owned(),
        ));
    }
    let valid = validate_placement(
        &mut tx,
        &player_id,
        area,
        &body.prop_definition_id,
        transform,
        None,
    )
    .await?;
    sqlx::query(
        r#"INSERT INTO "HangarPlacement"
           ("id", "playerId", "propDefinitionId", "area", "right", "up", "forward", "rotationY", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())"#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&player_id)
    .bind(&body.prop_definition_id)
    .bind(area.as_str())
    .bind(valid.right)
    .bind(valid.up)
    .bind(valid.forward)
    .bind(valid.rotation_y)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(build_state(&state, &player_id, area).await?))
}

async fn update_placement(
    state: AppState,
    access: AccessUser,
    id: String,
    transform: PlacementTransform,
    area: BuildArea,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    let mut tx = state.db.begin().await?;
    let definition_id: String = sqlx::query_scalar(
        r#"SELECT "propDefinitionId" FROM "HangarPlacement"
           WHERE "id" = $1 AND "playerId" = $2 AND "area" = $3 FOR UPDATE"#,
    )
    .bind(&id)
    .bind(&player_id)
    .bind(area.as_str())
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Placement not found.".to_owned()))?;
    let valid = validate_placement(
        &mut tx,
        &player_id,
        area,
        &definition_id,
        transform,
        Some(&id),
    )
    .await?;
    sqlx::query(
        r#"UPDATE "HangarPlacement" SET "right" = $2, "up" = $3, "forward" = $4,
                  "rotationY" = $5, "updatedAt" = NOW() WHERE "id" = $1"#,
    )
    .bind(id)
    .bind(valid.right)
    .bind(valid.up)
    .bind(valid.forward)
    .bind(valid.rotation_y)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(build_state(&state, &player_id, area).await?))
}

async fn delete_placement(
    state: AppState,
    access: AccessUser,
    id: String,
    area: BuildArea,
) -> ApiResult<Json<Value>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    let result = sqlx::query(
        r#"DELETE FROM "HangarPlacement" WHERE "id" = $1 AND "playerId" = $2 AND "area" = $3"#,
    )
    .bind(id)
    .bind(&player_id)
    .bind(area.as_str())
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Placement not found.".to_owned()));
    }
    Ok(Json(build_state(&state, &player_id, area).await?))
}

async fn validate_placement(
    tx: &mut Transaction<'_, Postgres>,
    player_id: &str,
    area: BuildArea,
    definition_id: &str,
    transform: PlacementTransform,
    excluding_id: Option<&str>,
) -> ApiResult<PlacementTransform> {
    if ![
        transform.right,
        transform.up,
        transform.forward,
        transform.rotation_y,
    ]
    .iter()
    .all(|value| value.is_finite())
    {
        return Err(ApiError::BadRequest(
            "Placement transform values must be finite.".to_owned(),
        ));
    }
    let definition =
        sqlx::query(r#"SELECT "allowRotateY", "snapGridM" FROM "PropDefinition" WHERE "id" = $1"#)
            .bind(definition_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| ApiError::NotFound("Prop definition not found.".to_owned()))?;
    let assigned_hangar: Option<i32> =
        sqlx::query_scalar(r#"SELECT "assignedHangar" FROM "Player" WHERE "id" = $1"#)
            .bind(player_id)
            .fetch_one(&mut **tx)
            .await?;
    let room = room_bounds(area, assigned_hangar);
    let grid: Option<f64> = definition.try_get("snapGridM")?;
    let snap = |value: f64| {
        grid.filter(|grid| *grid > 0.0)
            .map(|grid| (value / grid).round() * grid)
            .unwrap_or(value)
    };
    let allow_rotate: bool = definition.try_get("allowRotateY")?;
    let rotation_snap = 15_f64.to_radians();
    let snapped = PlacementTransform {
        right: snap(transform.right),
        up: room.floor,
        forward: snap(transform.forward),
        rotation_y: if allow_rotate {
            (transform.rotation_y / rotation_snap).round() * rotation_snap
        } else {
            0.0
        },
    };
    let footprint = 0.75;
    if snapped.right - footprint < room.min_right
        || snapped.right + footprint > room.max_right
        || snapped.forward - footprint < room.min_forward
        || snapped.forward + footprint > room.max_forward
    {
        return Err(ApiError::BadRequest(match area {
            BuildArea::Hangar => "Placement is outside your hangar bay.".to_owned(),
            BuildArea::Apartment => "Placement is outside your apartment.".to_owned(),
        }));
    }
    if area == BuildArea::Hangar {
        let pad_right = match assigned_hangar.unwrap_or(2) {
            1 => -38.0,
            3 => 38.0,
            _ => 0.0,
        };
        let limit = 8.0 + footprint + 0.5;
        if (snapped.right - pad_right).abs() <= limit && (snapped.forward - 1.0).abs() <= limit {
            return Err(ApiError::BadRequest(
                "Placement is too close to the ship pad.".to_owned(),
            ));
        }
    }
    let rows = sqlx::query(
        r#"SELECT "id", "right", "forward" FROM "HangarPlacement"
           WHERE "playerId" = $1 AND "area" = $2"#,
    )
    .bind(player_id)
    .bind(area.as_str())
    .fetch_all(&mut **tx)
    .await?;
    for row in rows {
        if excluding_id == Some(row.try_get::<String, _>("id")?.as_str()) {
            continue;
        }
        if (snapped.right - row.try_get::<f64, _>("right")?).abs() < 1.5
            && (snapped.forward - row.try_get::<f64, _>("forward")?).abs() < 1.5
        {
            return Err(ApiError::BadRequest(
                "Placement overlaps another prop.".to_owned(),
            ));
        }
    }
    Ok(snapped)
}

struct RoomBounds {
    min_right: f64,
    max_right: f64,
    min_forward: f64,
    max_forward: f64,
    floor: f64,
}

fn room_bounds(area: BuildArea, assigned_hangar: Option<i32>) -> RoomBounds {
    if area == BuildArea::Apartment {
        return RoomBounds {
            min_right: -6.9,
            max_right: -1.9,
            min_forward: 2.6,
            max_forward: 7.8,
            floor: 14.0,
        };
    }
    match assigned_hangar.unwrap_or(2) {
        1 => RoomBounds {
            min_right: -56.0,
            max_right: -20.0,
            min_forward: -22.0,
            max_forward: 22.0,
            floor: -22.0,
        },
        3 => RoomBounds {
            min_right: 20.0,
            max_right: 56.0,
            min_forward: -22.0,
            max_forward: 22.0,
            floor: -22.0,
        },
        _ => RoomBounds {
            min_right: -18.0,
            max_right: 18.0,
            min_forward: -22.0,
            max_forward: 22.0,
            floor: -22.0,
        },
    }
}

async fn build_state(state: &AppState, player_id: &str, area: BuildArea) -> ApiResult<Value> {
    let player =
        sqlx::query(r#"SELECT "assignedHangar", "arcBalance" FROM "Player" WHERE "id" = $1"#)
            .bind(player_id)
            .fetch_one(&state.db)
            .await?;
    let catalog = sqlx::query(
        r#"SELECT "id", "name", "description", "prefabId", "costArc", "category",
                  "maxPerHangar", "allowRotateY", "snapGridM"
           FROM "PropDefinition" ORDER BY "createdAt", "id""#,
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row| -> Result<Value, sqlx::Error> {
        Ok(json!({
            "id": row.try_get::<String, _>("id")?, "name": row.try_get::<String, _>("name")?,
            "description": row.try_get::<String, _>("description")?, "prefabId": row.try_get::<String, _>("prefabId")?,
            "costArc": row.try_get::<i32, _>("costArc")?, "category": row.try_get::<String, _>("category")?,
            "maxPerHangar": row.try_get::<Option<i32>, _>("maxPerHangar")?, "allowRotateY": row.try_get::<bool, _>("allowRotateY")?,
            "snapGridM": row.try_get::<Option<f64>, _>("snapGridM")?,
        }))
    })
    .collect::<Result<Vec<_>, _>>()?;
    let inventory = sqlx::query(
        r#"SELECT "propDefinitionId", "quantity" FROM "PlayerProp" WHERE "playerId" = $1 ORDER BY "createdAt""#,
    )
    .bind(player_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row| -> Result<Value, sqlx::Error> { Ok(json!({ "propDefinitionId": row.try_get::<String, _>("propDefinitionId")?, "quantity": row.try_get::<i32, _>("quantity")? })) })
    .collect::<Result<Vec<_>, _>>()?;
    let placements = sqlx::query(
        r#"SELECT p."id", p."area", p."propDefinitionId", d."prefabId", p."right", p."up", p."forward", p."rotationY"
           FROM "HangarPlacement" p JOIN "PropDefinition" d ON d."id" = p."propDefinitionId"
           WHERE p."playerId" = $1 AND p."area" = $2 ORDER BY p."createdAt""#,
    )
    .bind(player_id)
    .bind(area.as_str())
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row| -> Result<Value, sqlx::Error> {
        Ok(json!({
            "id": row.try_get::<String, _>("id")?, "area": row.try_get::<String, _>("area")?,
            "propDefinitionId": row.try_get::<String, _>("propDefinitionId")?, "prefabId": row.try_get::<String, _>("prefabId")?,
            "right": row.try_get::<f64, _>("right")?, "up": row.try_get::<f64, _>("up")?,
            "forward": row.try_get::<f64, _>("forward")?, "rotationY": row.try_get::<f64, _>("rotationY")?,
        }))
    })
    .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "area": area.as_str(),
        "assignedHangar": player.try_get::<Option<i32>, _>("assignedHangar")?,
        "arcBalance": player.try_get::<i32, _>("arcBalance")?,
        "catalog": catalog,
        "inventory": inventory,
        "placements": placements,
    }))
}

async fn inventory_state(state: &AppState, player_id: &str) -> ApiResult<Value> {
    let catalog = sqlx::query(
        r#"SELECT i."id", i."name", i."description", i."itemType", i."subType", i."prefabId", i."iconUrl", i."stackMax", i."costArc", i."rarity",
                  w."weaponSlotType", b."capacityLiters", b."emptyMassKg",
                  d."wearableSlotType", d."occupiedSlotTypes", d."sidekickPartPresetId"
           FROM "ItemDefinition" i
           LEFT JOIN "WeaponDefinition" w ON w."itemDefinitionId" = i."id"
           LEFT JOIN "BackpackDefinition" b ON b."itemDefinitionId" = i."id"
           LEFT JOIN "WearableDefinition" d ON d."itemDefinitionId" = i."id"
           ORDER BY i."itemType", i."name", i."createdAt""#,
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(item_row_json)
    .collect::<Result<Vec<_>, _>>()?;
    let items = sqlx::query(
        r#"SELECT "itemDefinitionId", "quantity" FROM "PlayerItem" WHERE "playerId" = $1 ORDER BY "createdAt""#,
    )
    .bind(player_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row| -> Result<Value, sqlx::Error> { Ok(json!({ "itemDefinitionId": row.try_get::<String, _>("itemDefinitionId")?, "quantity": row.try_get::<i32, _>("quantity")? })) })
    .collect::<Result<Vec<_>, _>>()?;
    let loadout: Option<Value> =
        sqlx::query_scalar(r#"SELECT "loadout" FROM "Player" WHERE "id" = $1"#)
            .bind(player_id)
            .fetch_one(&state.db)
            .await?;
    Ok(json!({ "catalog": catalog, "items": items, "loadout": parse_loadout(loadout) }))
}

fn item_row_json(row: sqlx::postgres::PgRow) -> Result<Value, sqlx::Error> {
    let mut value = json!({
        "id": row.try_get::<String, _>("id")?, "name": row.try_get::<String, _>("name")?,
        "description": row.try_get::<String, _>("description")?, "itemType": row.try_get::<String, _>("itemType")?,
        "subType": row.try_get::<String, _>("subType")?, "prefabId": row.try_get::<Option<String>, _>("prefabId")?,
        "iconUrl": row.try_get::<Option<String>, _>("iconUrl")?, "stackMax": row.try_get::<i32, _>("stackMax")?,
        "costArc": row.try_get::<i32, _>("costArc")?, "rarity": row.try_get::<String, _>("rarity")?,
    });
    if let Some(weapon_slot_type) = row.try_get::<Option<String>, _>("weaponSlotType")? {
        value["weaponSlotType"] = json!(weapon_slot_type);
    }
    if let Some(capacity_liters) = row.try_get::<Option<f64>, _>("capacityLiters")? {
        value["capacityLiters"] = json!(capacity_liters);
        value["emptyMassKg"] = json!(row.try_get::<Option<f64>, _>("emptyMassKg")?);
    }
    if let Some(wearable_slot_type) = row.try_get::<Option<String>, _>("wearableSlotType")? {
        value["wearableSlotType"] = json!(wearable_slot_type);
        value["occupiedSlotTypes"] = json!(
            row.try_get::<Option<Vec<String>>, _>("occupiedSlotTypes")?
                .unwrap_or_default()
        );
        value["sidekickPartPresetId"] =
            json!(row.try_get::<Option<i32>, _>("sidekickPartPresetId")?);
    }
    Ok(value)
}

#[derive(Clone, Copy)]
enum LoadoutKind {
    Weapon,
    Backpack,
    Wearable,
}

#[derive(Clone, Copy)]
struct LoadoutSlot {
    id: &'static str,
    label: &'static str,
    kind: LoadoutKind,
    weapon_slot_type: Option<&'static str>,
    wearable_slot_type: Option<&'static str>,
    requires_slot_id: Option<&'static str>,
}

const LOADOUT_SLOTS: [LoadoutSlot; 10] = [
    LoadoutSlot {
        id: "head",
        label: "Head",
        kind: LoadoutKind::Wearable,
        weapon_slot_type: None,
        wearable_slot_type: Some("head"),
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "torso",
        label: "Torso",
        kind: LoadoutKind::Wearable,
        weapon_slot_type: None,
        wearable_slot_type: Some("torso"),
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "arms",
        label: "Arms",
        kind: LoadoutKind::Wearable,
        weapon_slot_type: None,
        wearable_slot_type: Some("arms"),
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "legs",
        label: "Legs",
        kind: LoadoutKind::Wearable,
        weapon_slot_type: None,
        wearable_slot_type: Some("legs"),
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "feet",
        label: "Feet",
        kind: LoadoutKind::Wearable,
        weapon_slot_type: None,
        wearable_slot_type: Some("feet"),
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "backpack",
        label: "Backpack",
        kind: LoadoutKind::Backpack,
        weapon_slot_type: None,
        wearable_slot_type: None,
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "rifle-primary",
        label: "Primary Rifle",
        kind: LoadoutKind::Weapon,
        weapon_slot_type: Some("rifle"),
        wearable_slot_type: None,
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "rifle-secondary",
        label: "Secondary Rifle",
        kind: LoadoutKind::Weapon,
        weapon_slot_type: Some("rifle"),
        wearable_slot_type: None,
        requires_slot_id: Some("backpack"),
    },
    LoadoutSlot {
        id: "sword",
        label: "Sword",
        kind: LoadoutKind::Weapon,
        weapon_slot_type: Some("sword"),
        wearable_slot_type: None,
        requires_slot_id: None,
    },
    LoadoutSlot {
        id: "handgun",
        label: "Handgun",
        kind: LoadoutKind::Weapon,
        weapon_slot_type: Some("handgun"),
        wearable_slot_type: None,
        requires_slot_id: None,
    },
];

fn loadout_slot(id: &str) -> Option<LoadoutSlot> {
    LOADOUT_SLOTS.iter().copied().find(|slot| slot.id == id)
}

fn parse_loadout(value: Option<Value>) -> HashMap<String, String> {
    let Some(Value::Object(value)) = value else {
        return HashMap::new();
    };
    value
        .into_iter()
        .filter_map(|(slot, item)| {
            loadout_slot(&slot)?;
            item.as_str()
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(|item| (slot, item.to_owned()))
        })
        .collect()
}

fn clear_loadout_slot(loadout: &mut HashMap<String, String>, slot_id: &str) {
    loadout.remove(slot_id);
    for dependent in LOADOUT_SLOTS
        .iter()
        .filter(|slot| slot.requires_slot_id == Some(slot_id))
    {
        loadout.remove(dependent.id);
    }
}

async fn save_loadout(
    tx: &mut Transaction<'_, Postgres>,
    player_id: &str,
    loadout: &HashMap<String, String>,
) -> ApiResult<()> {
    sqlx::query(r#"UPDATE "Player" SET "loadout" = $2, "updatedAt" = NOW() WHERE "id" = $1"#)
        .bind(player_id)
        .bind(sqlx::types::Json(loadout))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn owned_ships(state: &AppState, player_id: &str) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"SELECT s."id", s."shipDefinitionId", s."prefabId", s."displayName", s."hp", s."shields", s."maxHp", s."maxShields",
                  d."id" AS "definitionId", d."prefabId" AS "definitionPrefabId", d."name" AS "definitionName",
                  d."maxHp" AS "definitionMaxHp", d."maxShields" AS "definitionMaxShields",
                  d."shieldRegenPerSec", d."maxSpeedMps", d."throttleAccelMps2"
           FROM "Ship" s
           LEFT JOIN LATERAL (
             SELECT candidate.* FROM "ShipDefinition" candidate
             WHERE candidate."id"=s."shipDefinitionId"
                OR (s."shipDefinitionId" IS NULL AND candidate."prefabId"=s."prefabId")
             ORDER BY CASE WHEN candidate."id"=s."shipDefinitionId" THEN 0 ELSE 1 END,
                      candidate."createdAt" LIMIT 1
           ) d ON TRUE
           LEFT JOIN "GameSettings" g ON g."id"='singleton'
           WHERE s."playerId" = $1
           ORDER BY COALESCE(array_position(g."starterShipDefinitionIds", d."id"), 2147483647), s."createdAt""#,
    )
    .bind(player_id)
    .fetch_all(&state.db)
    .await?;
    rows.into_iter().map(|row| -> Result<Value, ApiError> {
        let stored_max_hp: f64 = row.try_get("maxHp")?;
        let stored_max_shields: f64 = row.try_get("maxShields")?;
        let max_hp = row.try_get::<Option<f64>, _>("definitionMaxHp")?.unwrap_or(stored_max_hp);
        let max_shields = row.try_get::<Option<f64>, _>("definitionMaxShields")?.unwrap_or(stored_max_shields);
        Ok(json!({
            "id": row.try_get::<String, _>("id")?,
            "shipDefinitionId": row.try_get::<Option<String>, _>("definitionId")?.or(row.try_get::<Option<String>, _>("shipDefinitionId")?),
            "prefabId": row.try_get::<Option<String>, _>("definitionPrefabId")?.unwrap_or(row.try_get::<String, _>("prefabId")?),
            "displayName": row.try_get::<Option<String>, _>("definitionName")?.unwrap_or(row.try_get::<String, _>("displayName")?),
            "hp": row.try_get::<f64, _>("hp")?.clamp(0.0, max_hp), "shields": row.try_get::<f64, _>("shields")?.clamp(0.0, max_shields),
            "maxHp": max_hp, "maxShields": max_shields,
            "shieldRegenPerSec": row.try_get::<Option<f64>, _>("shieldRegenPerSec")?.unwrap_or(DEFAULT_SHIELD_REGEN),
            "maxSpeedMps": row.try_get::<Option<f64>, _>("maxSpeedMps")?.unwrap_or(DEFAULT_MAX_SPEED),
            "throttleAccelMps2": row.try_get::<Option<f64>, _>("throttleAccelMps2")?.unwrap_or(DEFAULT_ACCEL),
        }))
    }).collect()
}

async fn grant_starter_loadout(state: &AppState, player_id: &str) -> ApiResult<()> {
    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"INSERT INTO "GameSettings"
           ("id", "startingArcBalance", "starterShipDefinitionIds", "starterPropDefinitionIds", "starterItemDefinitionIds", "createdAt", "updatedAt")
           SELECT 'singleton', 25000,
                  ARRAY(SELECT "id" FROM "ShipDefinition" WHERE "prefabId"='phobos-starhopper' ORDER BY "createdAt" LIMIT 1),
                  ARRAY[]::TEXT[], ARRAY[]::TEXT[], NOW(), NOW()
           WHERE NOT EXISTS (SELECT 1 FROM "GameSettings" WHERE "id"='singleton')"#,
    )
    .execute(&mut *tx)
    .await?;
    let player =
        sqlx::query(r#"SELECT "starterLoadoutGrantedAt" FROM "Player" WHERE "id" = $1 FOR UPDATE"#)
            .bind(player_id)
            .fetch_one(&mut *tx)
            .await?;
    if player
        .try_get::<Option<chrono::NaiveDateTime>, _>("starterLoadoutGrantedAt")?
        .is_some()
    {
        tx.commit().await?;
        return Ok(());
    }
    let settings = sqlx::query(
        r#"SELECT "startingArcBalance", "starterShipDefinitionIds", "starterPropDefinitionIds", "starterItemDefinitionIds"
           FROM "GameSettings" WHERE "id" = 'singleton'"#,
    )
    .fetch_one(&mut *tx)
    .await?;
    let ship_ids: Vec<String> = settings.try_get("starterShipDefinitionIds")?;
    let prop_ids: Vec<String> = settings.try_get("starterPropDefinitionIds")?;
    let item_ids: Vec<String> = settings.try_get("starterItemDefinitionIds")?;
    let existing_ships =
        sqlx::query(r#"SELECT "shipDefinitionId", "prefabId" FROM "Ship" WHERE "playerId" = $1"#)
            .bind(player_id)
            .fetch_all(&mut *tx)
            .await?;
    let mut existing_definitions: HashSet<String> = existing_ships
        .iter()
        .filter_map(|row| {
            row.try_get::<Option<String>, _>("shipDefinitionId")
                .ok()
                .flatten()
        })
        .collect();
    let mut existing_prefabs: HashSet<String> = existing_ships
        .iter()
        .filter_map(|row| row.try_get::<String, _>("prefabId").ok())
        .collect();
    let definitions = sqlx::query(
        r#"SELECT "id", "name", "prefabId", "maxHp", "maxShields" FROM "ShipDefinition" WHERE "id" = ANY($1)"#,
    )
    .bind(&ship_ids)
    .fetch_all(&mut *tx)
    .await?;
    let by_id: HashMap<String, sqlx::postgres::PgRow> = definitions
        .into_iter()
        .map(|row| (row.get::<String, _>("id"), row))
        .collect();
    for definition_id in &ship_ids {
        let Some(row) = by_id.get(definition_id) else {
            return Err(ApiError::Internal(anyhow::anyhow!(
                "starter ship definition {definition_id} is missing"
            )));
        };
        let prefab: String = row.try_get("prefabId")?;
        if existing_definitions.contains(definition_id) || existing_prefabs.contains(&prefab) {
            continue;
        }
        let max_hp: f64 = row.try_get("maxHp")?;
        let max_shields: f64 = row.try_get("maxShields")?;
        sqlx::query(
            r#"INSERT INTO "Ship"
               ("id", "playerId", "shipDefinitionId", "prefabId", "displayName", "hp", "shields", "maxHp", "maxShields", "currentInstanceId", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7, $8, NOW(), NOW())"#,
        )
        .bind(Uuid::new_v4().to_string()).bind(player_id).bind(definition_id).bind(&prefab)
        .bind(row.try_get::<String, _>("name")?).bind(max_hp).bind(max_shields)
        .bind(format!("hangar:{player_id}"))
        .execute(&mut *tx).await?;
        existing_definitions.insert(definition_id.clone());
        existing_prefabs.insert(prefab);
    }
    for prop_id in prop_ids {
        sqlx::query(
            r#"INSERT INTO "PlayerProp" ("id", "playerId", "propDefinitionId", "quantity", "createdAt", "updatedAt")
               SELECT $1, $2, "id", 3, NOW(), NOW() FROM "PropDefinition" WHERE "id" = $3
               ON CONFLICT ("playerId", "propDefinitionId") DO NOTHING"#,
        ).bind(Uuid::new_v4().to_string()).bind(player_id).bind(prop_id).execute(&mut *tx).await?;
    }
    for item_id in item_ids {
        sqlx::query(
            r#"INSERT INTO "PlayerItem" ("id", "playerId", "itemDefinitionId", "quantity", "createdAt", "updatedAt")
               SELECT $1, $2, "id", 1, NOW(), NOW() FROM "ItemDefinition" WHERE "id" = $3
               ON CONFLICT ("playerId", "itemDefinitionId") DO NOTHING"#,
        ).bind(Uuid::new_v4().to_string()).bind(player_id).bind(item_id).execute(&mut *tx).await?;
    }
    sqlx::query(
        r#"UPDATE "Player" SET "arcBalance" = "arcBalance" + $2,
                  "starterLoadoutGrantedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $1"#,
    )
    .bind(player_id)
    .bind(settings.try_get::<i32, _>("startingArcBalance")?.max(0))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn validate_appearance(value: Value) -> ApiResult<Value> {
    let object = value.as_object().ok_or_else(|| {
        ApiError::BadRequest("Character appearance must be an object.".to_owned())
    })?;
    let allowed: HashSet<&str> = [
        "schemaVersion",
        "type",
        "headVariant",
        "hairVariant",
        "eyebrowVariant",
        "earVariant",
        "noseVariant",
        "facialHairVariant",
        "hairColor",
        "eyebrowColor",
        "facialHairColor",
        "eyeColor",
        "bodySizeValue",
        "muscleValue",
    ]
    .into_iter()
    .collect();
    if let Some(key) = object.keys().find(|key| !allowed.contains(key.as_str())) {
        return Err(ApiError::BadRequest(format!(
            "Unknown character appearance field: {key}."
        )));
    }
    for (key, min, max) in [
        ("schemaVersion", 1, 1),
        ("type", 1, 2),
        ("headVariant", 1, 2),
        ("hairVariant", 1, 10),
        ("eyebrowVariant", 1, 10),
        ("earVariant", 1, 10),
        ("noseVariant", 1, 11),
        ("bodySizeValue", -100, 100),
        ("muscleValue", -100, 100),
    ] {
        let number = object.get(key).and_then(Value::as_i64).ok_or_else(|| {
            ApiError::BadRequest(format!("{key} must be an integer from {min} to {max}."))
        })?;
        if !(min..=max).contains(&number) {
            return Err(ApiError::BadRequest(format!(
                "{key} must be an integer from {min} to {max}."
            )));
        }
    }
    if let Some(value) = object.get("facialHairVariant")
        && !value.is_null()
        && !matches!(value.as_i64(), Some(1..=10))
    {
        return Err(ApiError::BadRequest(
            "facialHairVariant must be an integer from 1 to 10.".to_owned(),
        ));
    }
    for key in ["hairColor", "eyebrowColor", "facialHairColor", "eyeColor"] {
        let color = object
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .trim_start_matches('#');
        if color.len() != 6 || !color.chars().all(|character| character.is_ascii_hexdigit()) {
            return Err(ApiError::BadRequest(format!(
                "{key} must be a six-digit hex color."
            )));
        }
    }
    let mut normalized = object.clone();
    for key in ["hairColor", "eyebrowColor", "facialHairColor", "eyeColor"] {
        let color = normalized
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .trim_start_matches('#')
            .to_uppercase();
        normalized.insert(key.to_owned(), json!(color));
    }
    Ok(Value::Object(normalized))
}

fn normalize_stored_appearance(value: Option<Value>) -> Option<Value> {
    let mut value = value?;
    let object = value.as_object_mut()?;
    for key in ["hairColor", "eyebrowColor", "facialHairColor"] {
        object.entry(key.to_owned()).or_insert(json!("26272D"));
    }
    object
        .entry("eyeColor".to_owned())
        .or_insert(json!("503E2B"));
    validate_appearance(value).ok()
}
