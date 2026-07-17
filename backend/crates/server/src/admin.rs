use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::{
    auth::{AdminUser, admin_ttl, issue_admin_token},
    error::{ApiError, ApiResult},
    http::{auth_cookie, clear_cookie, cookie_headers},
    state::AppState,
};

#[derive(Deserialize)]
pub struct AdminLoginBody {
    email: String,
    password: String,
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<AdminLoginBody>,
) -> ApiResult<Response> {
    if state.config.admin_password.is_empty() {
        return Err(ApiError::BadRequest(
            "Admin password is not configured.".to_owned(),
        ));
    }
    let email_matches = body
        .email
        .trim()
        .eq_ignore_ascii_case(&state.config.admin_email);
    let supplied = Sha256::digest(body.password.as_bytes());
    let expected = Sha256::digest(state.config.admin_password.as_bytes());
    if !email_matches || !bool::from(supplied.ct_eq(&expected)) {
        return Err(ApiError::Unauthorized(
            "Invalid admin credentials.".to_owned(),
        ));
    }
    let headers = cookie_headers([auth_cookie(
        &state.config,
        "cc_admin",
        issue_admin_token(&state)?,
        admin_ttl(),
    )]);
    Ok((headers, Json(json!({ "email": state.config.admin_email }))).into_response())
}

pub async fn session(State(state): State<AppState>, _admin: AdminUser) -> Json<Value> {
    Json(json!({ "email": state.config.admin_email }))
}

pub async fn logout(State(state): State<AppState>, _admin: AdminUser) -> Response {
    let headers = cookie_headers([clear_cookie(&state.config, "cc_admin")]);
    (headers, StatusCode::NO_CONTENT).into_response()
}

pub async fn list_users(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    let rows = sqlx::query(
        r#"SELECT u."id", u."email", u."username", u."displayName", u."createdAt", u."updatedAt",
                  p."id" AS "playerId", p."handle", p."displayName" AS "playerDisplayName",
                  p."currentInstanceId", p."currentRoomId", p."arcBalance", p."starterLoadoutGrantedAt",
                  p."createdAt" AS "playerCreatedAt", p."updatedAt" AS "playerUpdatedAt",
                  COUNT(s."id")::BIGINT AS "shipCount"
           FROM "User" u LEFT JOIN "Player" p ON p."userId" = u."id"
           LEFT JOIN "Ship" s ON s."playerId" = p."id"
           GROUP BY u."id", p."id" ORDER BY u."createdAt""#,
    )
    .fetch_all(&state.db)
    .await?;
    let values = rows
        .into_iter()
        .map(user_summary)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(values))
}

pub async fn get_user(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(user_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query(
        r#"SELECT u."id", u."email", u."username", u."displayName", u."createdAt", u."updatedAt",
                  p."id" AS "playerId", p."handle", p."displayName" AS "playerDisplayName",
                  p."currentInstanceId", p."currentRoomId", p."arcBalance", p."starterLoadoutGrantedAt",
                  p."createdAt" AS "playerCreatedAt", p."updatedAt" AS "playerUpdatedAt"
           FROM "User" u LEFT JOIN "Player" p ON p."userId" = u."id" WHERE u."id" = $1"#,
    )
    .bind(&user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound(format!("User \"{user_id}\" not found.")))?;
    let player_id: Option<String> = row.try_get("playerId")?;
    let ships = if let Some(player_id) = &player_id {
        sqlx::query(
            r#"SELECT s."id", s."shipDefinitionId", s."prefabId", s."displayName", s."currentInstanceId",
                      s."hp", s."shields", s."maxHp", s."maxShields", s."createdAt", s."updatedAt",
                      d."id" AS "definitionId", d."name" AS "definitionName", d."prefabId" AS "definitionPrefabId", d."costArc" AS "definitionCostArc"
               FROM "Ship" s LEFT JOIN "ShipDefinition" d ON d."id" = s."shipDefinitionId"
               WHERE s."playerId" = $1 ORDER BY s."createdAt""#,
        )
        .bind(player_id)
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(owned_ship_json)
        .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![]
    };
    Ok(Json(json!({
        "id": row.try_get::<String, _>("id")?, "email": row.try_get::<Option<String>, _>("email")?,
        "username": row.try_get::<String, _>("username")?, "displayName": row.try_get::<String, _>("displayName")?,
        "createdAt": iso(&row, "createdAt")?, "updatedAt": iso(&row, "updatedAt")?,
        "player": player_id.map(|id| json!({
            "id": id, "handle": row.get::<String, _>("handle"), "displayName": row.get::<String, _>("playerDisplayName"),
            "currentInstanceId": row.get::<String, _>("currentInstanceId"), "currentRoomId": row.get::<String, _>("currentRoomId"),
            "arcBalance": row.get::<i32, _>("arcBalance"), "starterLoadoutGrantedAt": optional_iso(&row, "starterLoadoutGrantedAt").ok().flatten(),
            "createdAt": iso(&row, "playerCreatedAt").ok(), "updatedAt": iso(&row, "playerUpdatedAt").ok(), "ships": ships,
        }))
    })))
}

pub async fn list_ships(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    Ok(Json(list_ship_rows(&state).await?))
}

pub async fn create_ship(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    validate_ship_fields(&body)?;
    let values = ship_values(&body, false)?;
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO "ShipDefinition"
           ("id", "name", "description", "prefabId", "costArc", "maxHp", "maxShields", "shieldRegenPerSec", "maxSpeedMps", "throttleAccelMps2", "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())"#,
    )
    .bind(&id).bind(values.string("name")?).bind(values.string("description")?).bind(values.string("prefabId")?)
    .bind(values.int("costArc")?).bind(values.number("maxHp")?).bind(values.number("maxShields")?)
    .bind(values.number("shieldRegenPerSec")?).bind(values.number("maxSpeedMps")?).bind(values.number("throttleAccelMps2")?)
    .execute(&state.db).await?;
    Ok((StatusCode::CREATED, Json(ship_by_id(&state, &id).await?)))
}

pub async fn update_ship(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    ensure_exists(&state, "ShipDefinition", &id).await?;
    validate_ship_fields(&body)?;
    update_dynamic(
        &state,
        "ShipDefinition",
        &id,
        &body,
        &[
            ("name", FieldKind::String),
            ("description", FieldKind::String),
            ("prefabId", FieldKind::String),
            ("costArc", FieldKind::Integer),
            ("maxHp", FieldKind::Number),
            ("maxShields", FieldKind::Number),
            ("shieldRegenPerSec", FieldKind::Number),
            ("maxSpeedMps", FieldKind::Number),
            ("throttleAccelMps2", FieldKind::Number),
        ],
    )
    .await?;
    sqlx::query(
        r#"UPDATE "Ship" s SET "prefabId"=d."prefabId", "displayName"=d."name",
                  "maxHp"=d."maxHp", "maxShields"=d."maxShields", "updatedAt"=NOW()
           FROM "ShipDefinition" d WHERE d."id"=$1 AND s."shipDefinitionId"=d."id""#,
    )
    .bind(&id)
    .execute(&state.db)
    .await?;
    Ok(Json(ship_by_id(&state, &id).await?))
}

pub async fn get_settings(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    Ok(Json(settings(&state).await?))
}

pub async fn update_settings(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let object = object(&body)?;
    let starting = integer(object.get("startingArcBalance"), "startingArcBalance")?;
    if starting < 0 {
        return Err(ApiError::BadRequest(
            "startingArcBalance must be non-negative.".to_owned(),
        ));
    }
    let ships = string_array(
        object.get("starterShipDefinitionIds"),
        "starterShipDefinitionIds",
    )?;
    if ships.is_empty() {
        return Err(ApiError::BadRequest(
            "Choose at least one starter ship.".to_owned(),
        ));
    }
    let props = string_array(
        object.get("starterPropDefinitionIds"),
        "starterPropDefinitionIds",
    )?;
    let items = string_array(
        object.get("starterItemDefinitionIds"),
        "starterItemDefinitionIds",
    )?;
    validate_ids(&state, "ShipDefinition", &ships).await?;
    validate_ids(&state, "PropDefinition", &props).await?;
    validate_ids(&state, "ItemDefinition", &items).await?;
    sqlx::query(
        r#"INSERT INTO "GameSettings"
           ("id", "startingArcBalance", "starterShipDefinitionIds", "starterPropDefinitionIds", "starterItemDefinitionIds", "createdAt", "updatedAt")
           VALUES ('singleton',$1,$2,$3,$4,NOW(),NOW()) ON CONFLICT ("id") DO UPDATE SET
           "startingArcBalance"=EXCLUDED."startingArcBalance", "starterShipDefinitionIds"=EXCLUDED."starterShipDefinitionIds",
           "starterPropDefinitionIds"=EXCLUDED."starterPropDefinitionIds", "starterItemDefinitionIds"=EXCLUDED."starterItemDefinitionIds", "updatedAt"=NOW()"#,
    ).bind(starting as i32).bind(ships).bind(props).bind(items).execute(&state.db).await?;
    Ok(Json(settings(&state).await?))
}

pub async fn list_props(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    Ok(Json(list_prop_rows(&state).await?))
}

pub async fn create_prop(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    validate_prop_fields(&body)?;
    let values = ObjectValues(object(&body)?);
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO "PropDefinition"
           ("id","name","description","prefabId","costArc","category","maxPerHangar","allowRotateY","snapGridM","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())"#,
    ).bind(&id).bind(values.string("name")?).bind(values.string("description")?).bind(values.string("prefabId")?)
      .bind(values.int("costArc")?).bind(values.string("category")?).bind(values.optional_int("maxPerHangar")?)
      .bind(values.boolean("allowRotateY")?).bind(values.optional_number("snapGridM")?).execute(&state.db).await?;
    Ok((StatusCode::CREATED, Json(prop_by_id(&state, &id).await?)))
}

pub async fn update_prop(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    ensure_exists(&state, "PropDefinition", &id).await?;
    validate_prop_fields(&body)?;
    update_dynamic(
        &state,
        "PropDefinition",
        &id,
        &body,
        &[
            ("name", FieldKind::String),
            ("description", FieldKind::String),
            ("prefabId", FieldKind::String),
            ("costArc", FieldKind::Integer),
            ("category", FieldKind::String),
            ("maxPerHangar", FieldKind::NullableInteger),
            ("allowRotateY", FieldKind::Boolean),
            ("snapGridM", FieldKind::NullableNumber),
        ],
    )
    .await?;
    Ok(Json(prop_by_id(&state, &id).await?))
}

pub async fn list_items(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    Ok(Json(list_item_rows(&state).await?))
}

pub async fn create_item(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    reject_specialized_item_type(body.get("itemType"))?;
    validate_item_fields(&body)?;
    let id = create_item_row(&state, &body, None).await?;
    Ok((StatusCode::CREATED, Json(item_by_id(&state, &id).await?)))
}

pub async fn update_item(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let current = sqlx::query(
        r#"SELECT i."itemType", w."itemDefinitionId" AS "weaponId", b."itemDefinitionId" AS "backpackId"
           FROM "ItemDefinition" i
           LEFT JOIN "WeaponDefinition" w ON w."itemDefinitionId"=i."id"
           LEFT JOIN "BackpackDefinition" b ON b."itemDefinitionId"=i."id"
           WHERE i."id"=$1"#,
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound(format!("Item definition \"{id}\" not found.")))?;
    if current.try_get::<Option<String>, _>("weaponId")?.is_some()
        || current
            .try_get::<Option<String>, _>("backpackId")?
            .is_some()
    {
        return Err(specialized_item_error());
    }
    reject_specialized_item_type(body.get("itemType"))?;
    validate_item_fields(&body)?;
    update_dynamic(
        &state,
        "ItemDefinition",
        &id,
        &body,
        &[
            ("name", FieldKind::String),
            ("description", FieldKind::String),
            ("itemType", FieldKind::String),
            ("subType", FieldKind::String),
            ("prefabId", FieldKind::NullableString),
            ("iconUrl", FieldKind::NullableString),
            ("stackMax", FieldKind::Integer),
            ("costArc", FieldKind::Integer),
            ("rarity", FieldKind::String),
        ],
    )
    .await?;
    Ok(Json(item_by_id(&state, &id).await?))
}

pub async fn delete_item(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    delete_item_definition(&state, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_weapons(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    let rows = sqlx::query(
        r#"SELECT i.*, w."weaponSlotType" FROM "ItemDefinition" i JOIN "WeaponDefinition" w ON w."itemDefinitionId"=i."id" ORDER BY i."createdAt",i."id""#,
    ).fetch_all(&state.db).await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| specialized_item_json(row, "weaponSlotType", None))
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

pub async fn create_weapon(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(mut body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    body["itemType"] = json!("weapon");
    body["stackMax"] = json!(1);
    let slot = body
        .get("weaponSlotType")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::BadRequest("weaponSlotType is required.".to_owned()))?
        .to_owned();
    validate_weapon_slot(&slot)?;
    validate_item_fields(&body)?;
    let mut tx = state.db.begin().await?;
    let id = create_item_tx(&mut tx, &body, None).await?;
    sqlx::query(r#"INSERT INTO "WeaponDefinition" ("itemDefinitionId","weaponSlotType","createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW())"#)
        .bind(&id).bind(slot).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(weapon_by_id(&state, &id).await?)))
}

pub async fn update_weapon(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    ensure_exists(&state, "WeaponDefinition", &id).await?;
    validate_item_fields(&body)?;
    let mut tx = state.db.begin().await?;
    update_item_tx(&mut tx, &id, &body).await?;
    if let Some(slot) = body.get("weaponSlotType") {
        validate_weapon_slot(&required_string(Some(slot), "weaponSlotType")?)?;
        sqlx::query(r#"UPDATE "WeaponDefinition" SET "weaponSlotType"=$2,"updatedAt"=NOW() WHERE "itemDefinitionId"=$1"#).bind(&id).bind(required_string(Some(slot),"weaponSlotType")?).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(weapon_by_id(&state, &id).await?))
}

pub async fn delete_weapon(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    delete_item_definition(&state, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_backpacks(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<Value>>> {
    let rows=sqlx::query(r#"SELECT i.*,b."capacityLiters",b."emptyMassKg" FROM "ItemDefinition" i JOIN "BackpackDefinition" b ON b."itemDefinitionId"=i."id" ORDER BY i."createdAt",i."id""#).fetch_all(&state.db).await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| specialized_item_json(row, "capacityLiters", Some("emptyMassKg")))
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

pub async fn create_backpack(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(mut body): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    body["itemType"] = json!("backpack");
    body["stackMax"] = json!(1);
    let capacity = number(body.get("capacityLiters"), "capacityLiters")?;
    let mass = number(body.get("emptyMassKg"), "emptyMassKg")?;
    validate_positive(capacity, "capacityLiters")?;
    validate_positive(mass, "emptyMassKg")?;
    validate_item_fields(&body)?;
    let mut tx = state.db.begin().await?;
    let id = create_item_tx(&mut tx, &body, None).await?;
    sqlx::query(r#"INSERT INTO "BackpackDefinition" ("itemDefinitionId","capacityLiters","emptyMassKg","createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())"#).bind(&id).bind(capacity).bind(mass).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(backpack_by_id(&state, &id).await?),
    ))
}

pub async fn update_backpack(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    ensure_exists(&state, "BackpackDefinition", &id).await?;
    validate_item_fields(&body)?;
    let mut tx = state.db.begin().await?;
    update_item_tx(&mut tx, &id, &body).await?;
    if body.get("capacityLiters").is_some() {
        let capacity = number(body.get("capacityLiters"), "capacityLiters")?;
        validate_positive(capacity, "capacityLiters")?;
        sqlx::query(r#"UPDATE "BackpackDefinition" SET "capacityLiters"=$2,"updatedAt"=NOW() WHERE "itemDefinitionId"=$1"#).bind(&id).bind(capacity).execute(&mut *tx).await?;
    }
    if body.get("emptyMassKg").is_some() {
        let mass = number(body.get("emptyMassKg"), "emptyMassKg")?;
        validate_positive(mass, "emptyMassKg")?;
        sqlx::query(r#"UPDATE "BackpackDefinition" SET "emptyMassKg"=$2,"updatedAt"=NOW() WHERE "itemDefinitionId"=$1"#).bind(&id).bind(mass).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(backpack_by_id(&state, &id).await?))
}

pub async fn delete_backpack(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    delete_item_definition(&state, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn settings(state: &AppState) -> ApiResult<Value> {
    sqlx::query(r#"INSERT INTO "GameSettings" ("id","startingArcBalance","starterShipDefinitionIds","starterPropDefinitionIds","starterItemDefinitionIds","createdAt","updatedAt") SELECT 'singleton',25000,ARRAY(SELECT "id" FROM "ShipDefinition" WHERE "prefabId"='phobos-starhopper' ORDER BY "createdAt" LIMIT 1),ARRAY[]::TEXT[],ARRAY[]::TEXT[],NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "GameSettings" WHERE "id"='singleton')"#).execute(&state.db).await?;
    let row = sqlx::query(r#"SELECT * FROM "GameSettings" WHERE "id"='singleton'"#)
        .fetch_one(&state.db)
        .await?;
    Ok(
        json!({"id":"singleton","startingArcBalance":row.try_get::<i32,_>("startingArcBalance")?,"starterShipDefinitionIds":row.try_get::<Vec<String>,_>("starterShipDefinitionIds")?,"starterPropDefinitionIds":row.try_get::<Vec<String>,_>("starterPropDefinitionIds")?,"starterItemDefinitionIds":row.try_get::<Vec<String>,_>("starterItemDefinitionIds")?,"createdAt":iso(&row,"createdAt")?,"updatedAt":iso(&row,"updatedAt")?}),
    )
}

async fn list_ship_rows(state: &AppState) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(r#"SELECT * FROM "ShipDefinition" ORDER BY "createdAt","id""#)
        .fetch_all(&state.db)
        .await?;
    rows.into_iter()
        .map(ship_json)
        .collect::<Result<_, _>>()
        .map_err(Into::into)
}
async fn ship_by_id(state: &AppState, id: &str) -> ApiResult<Value> {
    let row = sqlx::query(r#"SELECT * FROM "ShipDefinition" WHERE "id"=$1"#)
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    Ok(ship_json(row)?)
}
fn ship_json(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(
        json!({"id":row.try_get::<String,_>("id")?,"name":row.try_get::<String,_>("name")?,"description":row.try_get::<String,_>("description")?,"prefabId":row.try_get::<String,_>("prefabId")?,"costArc":row.try_get::<i32,_>("costArc")?,"maxHp":row.try_get::<f64,_>("maxHp")?,"maxShields":row.try_get::<f64,_>("maxShields")?,"shieldRegenPerSec":row.try_get::<f64,_>("shieldRegenPerSec")?,"maxSpeedMps":row.try_get::<f64,_>("maxSpeedMps")?,"throttleAccelMps2":row.try_get::<f64,_>("throttleAccelMps2")?,"createdAt":iso(&row,"createdAt")?,"updatedAt":iso(&row,"updatedAt")?}),
    )
}

async fn list_prop_rows(state: &AppState) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(r#"SELECT * FROM "PropDefinition" ORDER BY "createdAt","id""#)
        .fetch_all(&state.db)
        .await?;
    rows.into_iter()
        .map(prop_json)
        .collect::<Result<_, _>>()
        .map_err(Into::into)
}
async fn prop_by_id(state: &AppState, id: &str) -> ApiResult<Value> {
    let row = sqlx::query(r#"SELECT * FROM "PropDefinition" WHERE "id"=$1"#)
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    Ok(prop_json(row)?)
}
fn prop_json(row: PgRow) -> Result<Value, sqlx::Error> {
    Ok(
        json!({"id":row.try_get::<String,_>("id")?,"name":row.try_get::<String,_>("name")?,"description":row.try_get::<String,_>("description")?,"prefabId":row.try_get::<String,_>("prefabId")?,"costArc":row.try_get::<i32,_>("costArc")?,"category":row.try_get::<String,_>("category")?,"maxPerHangar":row.try_get::<Option<i32>,_>("maxPerHangar")?,"allowRotateY":row.try_get::<bool,_>("allowRotateY")?,"snapGridM":row.try_get::<Option<f64>,_>("snapGridM")?,"createdAt":iso(&row,"createdAt")?,"updatedAt":iso(&row,"updatedAt")?}),
    )
}

async fn list_item_rows(state: &AppState) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"SELECT i.*, w."weaponSlotType", b."capacityLiters", b."emptyMassKg"
           FROM "ItemDefinition" i
           LEFT JOIN "WeaponDefinition" w ON w."itemDefinitionId"=i."id"
           LEFT JOIN "BackpackDefinition" b ON b."itemDefinitionId"=i."id"
           ORDER BY i."itemType",i."name",i."createdAt""#,
    )
    .fetch_all(&state.db)
    .await?;
    rows.into_iter()
        .map(item_json)
        .collect::<Result<_, _>>()
        .map_err(Into::into)
}
async fn item_by_id(state: &AppState, id: &str) -> ApiResult<Value> {
    let row = sqlx::query(
        r#"SELECT i.*, w."weaponSlotType", b."capacityLiters", b."emptyMassKg"
           FROM "ItemDefinition" i
           LEFT JOIN "WeaponDefinition" w ON w."itemDefinitionId"=i."id"
           LEFT JOIN "BackpackDefinition" b ON b."itemDefinitionId"=i."id"
           WHERE i."id"=$1"#,
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(item_json(row)?)
}
fn item_json(row: PgRow) -> Result<Value, sqlx::Error> {
    let mut value = item_json_from_ref(&row)?;
    if let Ok(Some(slot)) = row.try_get::<Option<String>, _>("weaponSlotType") {
        value["weaponSlotType"] = json!(slot);
    }
    if let Ok(Some(capacity)) = row.try_get::<Option<f64>, _>("capacityLiters") {
        value["capacityLiters"] = json!(capacity);
    }
    if let Ok(Some(mass)) = row.try_get::<Option<f64>, _>("emptyMassKg") {
        value["emptyMassKg"] = json!(mass);
    }
    Ok(value)
}
fn specialized_item_json(
    row: PgRow,
    first: &str,
    second: Option<&str>,
) -> Result<Value, sqlx::Error> {
    let mut value = item_json_from_ref(&row)?;
    value[first] = if first == "weaponSlotType" {
        json!(row.try_get::<String, _>(first)?)
    } else {
        json!(row.try_get::<f64, _>(first)?)
    };
    if let Some(field) = second {
        value[field] = json!(row.try_get::<f64, _>(field)?);
    }
    Ok(value)
}
fn item_json_from_ref(row: &PgRow) -> Result<Value, sqlx::Error> {
    Ok(
        json!({"id":row.try_get::<String,_>("id")?,"name":row.try_get::<String,_>("name")?,"description":row.try_get::<String,_>("description")?,"itemType":row.try_get::<String,_>("itemType")?,"subType":row.try_get::<String,_>("subType")?,"prefabId":row.try_get::<Option<String>,_>("prefabId")?,"iconUrl":row.try_get::<Option<String>,_>("iconUrl")?,"stackMax":row.try_get::<i32,_>("stackMax")?,"costArc":row.try_get::<i32,_>("costArc")?,"rarity":row.try_get::<String,_>("rarity")?,"createdAt":iso(row,"createdAt")?,"updatedAt":iso(row,"updatedAt")?}),
    )
}
async fn weapon_by_id(state: &AppState, id: &str) -> ApiResult<Value> {
    let row=sqlx::query(r#"SELECT i.*,w."weaponSlotType" FROM "ItemDefinition" i JOIN "WeaponDefinition" w ON w."itemDefinitionId"=i."id" WHERE i."id"=$1"#).bind(id).fetch_one(&state.db).await?;
    Ok(specialized_item_json(row, "weaponSlotType", None)?)
}
async fn backpack_by_id(state: &AppState, id: &str) -> ApiResult<Value> {
    let row=sqlx::query(r#"SELECT i.*,b."capacityLiters",b."emptyMassKg" FROM "ItemDefinition" i JOIN "BackpackDefinition" b ON b."itemDefinitionId"=i."id" WHERE i."id"=$1"#).bind(id).fetch_one(&state.db).await?;
    Ok(specialized_item_json(
        row,
        "capacityLiters",
        Some("emptyMassKg"),
    )?)
}

async fn create_item_row(
    state: &AppState,
    body: &Value,
    item_type: Option<&str>,
) -> ApiResult<String> {
    let mut tx = state.db.begin().await?;
    let id = create_item_tx(&mut tx, body, item_type).await?;
    tx.commit().await?;
    Ok(id)
}
async fn create_item_tx(
    tx: &mut Transaction<'_, Postgres>,
    body: &Value,
    item_type: Option<&str>,
) -> ApiResult<String> {
    let values = ObjectValues(object(body)?);
    let id = Uuid::new_v4().to_string();
    let item_type = item_type
        .map(str::to_owned)
        .unwrap_or(values.string("itemType")?);
    sqlx::query(r#"INSERT INTO "ItemDefinition" ("id","name","description","itemType","subType","prefabId","iconUrl","stackMax","costArc","rarity","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())"#).bind(&id).bind(values.string("name")?).bind(values.string("description")?).bind(item_type).bind(values.string("subType")?).bind(values.optional_string("prefabId")?).bind(values.optional_string("iconUrl")?).bind(values.int("stackMax")?).bind(values.int("costArc")?).bind(values.string("rarity")?).execute(&mut **tx).await?;
    Ok(id)
}
async fn update_item_tx(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    body: &Value,
) -> ApiResult<()> {
    let fields = [
        ("name", FieldKind::String),
        ("description", FieldKind::String),
        ("subType", FieldKind::String),
        ("prefabId", FieldKind::NullableString),
        ("iconUrl", FieldKind::NullableString),
        ("costArc", FieldKind::Integer),
        ("rarity", FieldKind::String),
    ];
    update_dynamic_tx(tx, "ItemDefinition", id, body, &fields).await
}

#[derive(Clone, Copy)]
enum FieldKind {
    String,
    NullableString,
    Integer,
    NullableInteger,
    Number,
    NullableNumber,
    Boolean,
}
async fn update_dynamic(
    state: &AppState,
    table: &str,
    id: &str,
    body: &Value,
    fields: &[(&str, FieldKind)],
) -> ApiResult<()> {
    let mut tx = state.db.begin().await?;
    update_dynamic_tx(&mut tx, table, id, body, fields).await?;
    tx.commit().await?;
    Ok(())
}
async fn update_dynamic_tx(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    id: &str,
    body: &Value,
    fields: &[(&str, FieldKind)],
) -> ApiResult<()> {
    let obj = object(body)?;
    for (field, kind) in fields {
        let Some(value) = obj.get(*field) else {
            continue;
        };
        let sql =
            format!("UPDATE \"{table}\" SET \"{field}\"=$2, \"updatedAt\"=NOW() WHERE \"id\"=$1");
        let mut query = sqlx::query(&sql).bind(id);
        query = match kind {
            FieldKind::String => query.bind(required_string(Some(value), field)?),
            FieldKind::NullableString => query.bind(optional_string(Some(value), field)?),
            FieldKind::Integer => query.bind(integer(Some(value), field)? as i32),
            FieldKind::NullableInteger => {
                query.bind(optional_integer(Some(value), field)?.map(|v| v as i32))
            }
            FieldKind::Number => query.bind(number(Some(value), field)?),
            FieldKind::NullableNumber => query.bind(optional_number(Some(value), field)?),
            FieldKind::Boolean => query.bind(
                value
                    .as_bool()
                    .ok_or_else(|| ApiError::BadRequest(format!("{field} must be a boolean.")))?,
            ),
        };
        query.execute(&mut **tx).await?;
    }
    Ok(())
}

async fn ensure_exists(state: &AppState, table: &str, id: &str) -> ApiResult<()> {
    let column = if matches!(table, "WeaponDefinition" | "BackpackDefinition") {
        "itemDefinitionId"
    } else {
        "id"
    };
    let sql = format!("SELECT EXISTS(SELECT 1 FROM \"{table}\" WHERE \"{column}\"=$1)");
    let exists: bool = sqlx::query_scalar(&sql)
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    if exists {
        Ok(())
    } else {
        Err(ApiError::NotFound(format!(
            "Definition \"{id}\" not found."
        )))
    }
}
fn reject_specialized_item_type(value: Option<&Value>) -> ApiResult<()> {
    if matches!(value.and_then(Value::as_str), Some("weapon" | "backpack")) {
        return Err(specialized_item_error());
    }
    Ok(())
}
fn specialized_item_error() -> ApiError {
    ApiError::BadRequest("Use the specialized weapon or backpack catalog.".to_owned())
}
fn validate_item_fields(body: &Value) -> ApiResult<()> {
    if let Some(item_type) = body.get("itemType") {
        let item_type = required_string(Some(item_type), "itemType")?;
        if !matches!(
            item_type.as_str(),
            "consumable" | "weapon" | "backpack" | "armor" | "clothing" | "material" | "misc"
        ) {
            return Err(ApiError::BadRequest("itemType is invalid.".to_owned()));
        }
    }
    if let Some(value) = body.get("stackMax")
        && integer(Some(value), "stackMax")? < 1
    {
        return Err(ApiError::BadRequest(
            "stackMax must be at least 1.".to_owned(),
        ));
    }
    if let Some(value) = body.get("costArc")
        && integer(Some(value), "costArc")? < 0
    {
        return Err(ApiError::BadRequest(
            "costArc must be non-negative.".to_owned(),
        ));
    }
    Ok(())
}
fn validate_ship_fields(body: &Value) -> ApiResult<()> {
    validate_range(body, "costArc", 0.0, 2_000_000_000.0)?;
    validate_range(body, "maxHp", 1.0, 100_000.0)?;
    validate_range(body, "maxShields", 0.0, 100_000.0)?;
    validate_range(body, "shieldRegenPerSec", 0.0, 10_000.0)?;
    validate_range(body, "maxSpeedMps", 5.0, 500.0)?;
    validate_range(body, "throttleAccelMps2", 1.0, 10_000.0)
}
fn validate_prop_fields(body: &Value) -> ApiResult<()> {
    validate_range(body, "costArc", 0.0, 2_000_000_000.0)?;
    if let Some(value) = body.get("maxPerHangar")
        && !value.is_null()
        && integer(Some(value), "maxPerHangar")? < 1
    {
        return Err(ApiError::BadRequest(
            "maxPerHangar must be at least 1 or null.".to_owned(),
        ));
    }
    if let Some(value) = body.get("snapGridM")
        && !value.is_null()
        && number(Some(value), "snapGridM")? <= 0.0
    {
        return Err(ApiError::BadRequest(
            "snapGridM must be greater than zero or null.".to_owned(),
        ));
    }
    Ok(())
}
fn validate_range(body: &Value, field: &str, min: f64, max: f64) -> ApiResult<()> {
    let Some(value) = body.get(field) else {
        return Ok(());
    };
    let value = number(Some(value), field)?;
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "{field} must be between {min} and {max}."
        )))
    }
}
fn validate_weapon_slot(slot: &str) -> ApiResult<()> {
    if matches!(slot, "rifle" | "sword" | "handgun") {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "weaponSlotType must be rifle, sword, or handgun.".to_owned(),
        ))
    }
}
fn validate_positive(value: f64, name: &str) -> ApiResult<()> {
    if value > 0.0 {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "{name} must be greater than zero."
        )))
    }
}
async fn delete_item_definition(state: &AppState, id: &str) -> ApiResult<()> {
    let owned: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)::BIGINT FROM "PlayerItem" WHERE "itemDefinitionId"=$1 AND "quantity">0"#,
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    if owned > 0 {
        return Err(ApiError::BadRequest(
            "Cannot delete an item definition while players still hold copies.".to_owned(),
        ));
    }
    delete_definition(state, "ItemDefinition", id).await
}
async fn delete_definition(state: &AppState, table: &str, id: &str) -> ApiResult<()> {
    let sql = format!("DELETE FROM \"{table}\" WHERE \"id\"=$1");
    let result = sqlx::query(&sql).bind(id).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        Err(ApiError::NotFound(format!(
            "Definition \"{id}\" not found."
        )))
    } else {
        Ok(())
    }
}
async fn validate_ids(state: &AppState, table: &str, ids: &[String]) -> ApiResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let sql = format!("SELECT COUNT(*)::BIGINT FROM \"{table}\" WHERE \"id\"=ANY($1)");
    let count: i64 = sqlx::query_scalar(&sql)
        .bind(ids)
        .fetch_one(&state.db)
        .await?;
    if count == ids.len() as i64 {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "One or more {table} ids do not exist."
        )))
    }
}

fn user_summary(row: PgRow) -> Result<Value, sqlx::Error> {
    let player_id: Option<String> = row.try_get("playerId")?;
    Ok(
        json!({"id":row.try_get::<String,_>("id")?,"email":row.try_get::<Option<String>,_>("email")?,"username":row.try_get::<String,_>("username")?,"displayName":row.try_get::<String,_>("displayName")?,"createdAt":iso(&row,"createdAt")?,"updatedAt":iso(&row,"updatedAt")?,"player":player_id.map(|id|json!({"id":id,"handle":row.get::<String,_>("handle"),"displayName":row.get::<String,_>("playerDisplayName"),"currentInstanceId":row.get::<String,_>("currentInstanceId"),"currentRoomId":row.get::<String,_>("currentRoomId"),"arcBalance":row.get::<i32,_>("arcBalance"),"starterLoadoutGrantedAt":optional_iso(&row,"starterLoadoutGrantedAt").ok().flatten(),"createdAt":iso(&row,"playerCreatedAt").ok(),"updatedAt":iso(&row,"playerUpdatedAt").ok(),"shipCount":row.get::<i64,_>("shipCount")}))}),
    )
}
fn owned_ship_json(row: PgRow) -> Result<Value, sqlx::Error> {
    let definition_id: Option<String> = row.try_get("definitionId")?;
    Ok(
        json!({"id":row.try_get::<String,_>("id")?,"shipDefinitionId":row.try_get::<Option<String>,_>("shipDefinitionId")?,"prefabId":row.try_get::<String,_>("prefabId")?,"displayName":row.try_get::<String,_>("displayName")?,"currentInstanceId":row.try_get::<Option<String>,_>("currentInstanceId")?,"hp":row.try_get::<f64,_>("hp")?,"shields":row.try_get::<f64,_>("shields")?,"maxHp":row.try_get::<f64,_>("maxHp")?,"maxShields":row.try_get::<f64,_>("maxShields")?,"createdAt":iso(&row,"createdAt")?,"updatedAt":iso(&row,"updatedAt")?,"shipDefinition":definition_id.map(|id|json!({"id":id,"name":row.get::<String,_>("definitionName"),"prefabId":row.get::<String,_>("definitionPrefabId"),"costArc":row.get::<i32,_>("definitionCostArc")}))}),
    )
}

fn iso(row: &PgRow, column: &str) -> Result<String, sqlx::Error> {
    let value: NaiveDateTime = row.try_get(column)?;
    Ok(DateTime::<Utc>::from_naive_utc_and_offset(value, Utc).to_rfc3339())
}
fn optional_iso(row: &PgRow, column: &str) -> Result<Option<String>, sqlx::Error> {
    let value: Option<NaiveDateTime> = row.try_get(column)?;
    Ok(value.map(|value| DateTime::<Utc>::from_naive_utc_and_offset(value, Utc).to_rfc3339()))
}
fn object(value: &Value) -> ApiResult<&Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("Request body must be an object.".to_owned()))
}
fn required_string(value: Option<&Value>, name: &str) -> ApiResult<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| ApiError::BadRequest(format!("{name} is required.")))
}
fn optional_string(value: Option<&Value>, name: &str) -> ApiResult<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => Ok(Some(required_string(Some(value), name)?)),
    }
}
fn integer(value: Option<&Value>, name: &str) -> ApiResult<i64> {
    value
        .and_then(Value::as_i64)
        .ok_or_else(|| ApiError::BadRequest(format!("{name} must be an integer.")))
}
fn optional_integer(value: Option<&Value>, name: &str) -> ApiResult<Option<i64>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => Ok(Some(integer(Some(value), name)?)),
    }
}
fn number(value: Option<&Value>, name: &str) -> ApiResult<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| ApiError::BadRequest(format!("{name} must be a finite number.")))
}
fn optional_number(value: Option<&Value>, name: &str) -> ApiResult<Option<f64>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => Ok(Some(number(Some(value), name)?)),
    }
}
fn string_array(value: Option<&Value>, name: &str) -> ApiResult<Vec<String>> {
    value
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::BadRequest(format!("{name} must be an array.")))?
        .iter()
        .map(|value| required_string(Some(value), name))
        .collect()
}
struct ObjectValues<'a>(&'a Map<String, Value>);
impl ObjectValues<'_> {
    fn string(&self, name: &str) -> ApiResult<String> {
        required_string(self.0.get(name), name)
    }
    fn optional_string(&self, name: &str) -> ApiResult<Option<String>> {
        optional_string(self.0.get(name), name)
    }
    fn int(&self, name: &str) -> ApiResult<i32> {
        Ok(integer(self.0.get(name), name)? as i32)
    }
    fn optional_int(&self, name: &str) -> ApiResult<Option<i32>> {
        Ok(optional_integer(self.0.get(name), name)?.map(|v| v as i32))
    }
    fn number(&self, name: &str) -> ApiResult<f64> {
        number(self.0.get(name), name)
    }
    fn optional_number(&self, name: &str) -> ApiResult<Option<f64>> {
        optional_number(self.0.get(name), name)
    }
    fn boolean(&self, name: &str) -> ApiResult<bool> {
        self.0
            .get(name)
            .and_then(Value::as_bool)
            .ok_or_else(|| ApiError::BadRequest(format!("{name} must be a boolean.")))
    }
}
fn ship_values(body: &Value, _partial: bool) -> ApiResult<ObjectValues<'_>> {
    Ok(ObjectValues(object(body)?))
}
