---
sidebar_position: 9
title: API reference
description: REST endpoints for the ClaudeCitizen admin API.
---

# API reference

All admin endpoints are served by the Rust server under the `/admin` prefix (default base: `http://localhost:3000`).

## Common behavior

- **Authentication** — except `POST /admin/session`, all routes require the `cc_admin` HTTP-only cookie set at login.
- **Content-Type** — request and response bodies are JSON.
- **Credentials** — browser clients must send `credentials: 'include'` (or `withCredentials: true`).
- **Errors** — validation failures return `400` with a `message` string; missing auth returns `401`; missing resources return `404`.

Client helpers live in `src/net/admin_api.ts`.

## Session

### `POST /admin/session`

Log in and receive the session cookie.

**Body:**

```json
{
  "email": "admin@claude-citizen.com",
  "password": "your-password"
}
```

**Response `200`:**

```json
{
  "email": "admin@claude-citizen.com"
}
```

**Sets cookie:** `cc_admin` (JWT, 12-hour expiry)

### `GET /admin/session`

**Response `200`:** `{ "email": "..." }`  
**Response `401`:** missing or invalid session

### `DELETE /admin/session`

**Response `204`:** cookie cleared

---

## Users

### `GET /admin/users`

List accounts with summary player info.

### `GET /admin/users/:id`

Full user detail including `player.ships[]`.

### `POST /admin/users/:id/ships`

Assign a catalog ship to the user's player hangar.

**Body:**

```json
{
  "shipDefinitionId": "starter-phobos-starhopper"
}
```

**Response `201`:** the created owned ship (same shape as entries in `player.ships[]`).

Fails with `400` if the user has no player record, `404` if the user or definition is missing, or `409` if the player already owns that definition or prefab.

---

## Ship definitions

### `GET /admin/ships`

List all `ShipDefinition` rows.

### `POST /admin/ships`

Create a definition.

**Body:**

```json
{
  "name": "Phobos Starhopper",
  "description": "Compact starter hopper.",
  "prefabId": "phobos-starhopper",
  "costArc": 0,
  "maxHp": 1000,
  "maxShields": 500,
  "shieldRegenPerSec": 25,
  "maxSpeedMps": 100,
  "throttleAccelMps2": 308
}
```

### `PATCH /admin/ships/:id`

Partial update — include only fields to change.

---

## Prop definitions

### `GET /admin/props`

List all `PropDefinition` rows.

### `POST /admin/props`

**Body:**

```json
{
  "name": "Hangar Crate",
  "description": "Industrial storage crate.",
  "prefabId": "hangar-crate-01",
  "costArc": 250,
  "category": "decoration",
  "maxPerHangar": 8,
  "allowRotateY": true,
  "snapGridM": 0.5
}
```

`maxPerHangar` and `snapGridM` may be `null` for unlimited / free placement.

### `PATCH /admin/props/:id`

Partial update.

---

## Item definitions

### `GET /admin/items`

List all `ItemDefinition` rows.

### `POST /admin/items`

**Body:**

```json
{
  "name": "Medpen",
  "description": "Restores a small amount of health.",
  "itemType": "consumable",
  "subType": "medical",
  "prefabId": null,
  "iconUrl": "/assets/icons/medpen.png",
  "stackMax": 99,
  "costArc": 50,
  "rarity": "common"
}
```

Valid general `itemType` values include `consumable`, `armor`, `clothing`, `material`, and `misc`. Weapons and backpacks use their specialized endpoints.

### `PATCH /admin/items/:id`

Partial update. `prefabId` and `iconUrl` may be set to `null`.

### `DELETE /admin/items/:id`

**Response `204`** on success.  
**Response `400`** if players still hold copies.

### Weapon definitions

`GET /admin/weapons`, `POST /admin/weapons`, `PATCH /admin/weapons/:id`, and `DELETE /admin/weapons/:id` manage unique weapon items. Create requests include `weaponSlotType` (`rifle`, `sword`, or `handgun`); the server fixes `itemType` to `weapon` and `stackMax` to `1`.

### Backpack definitions

`GET /admin/backpacks`, `POST /admin/backpacks`, `PATCH /admin/backpacks/:id`, and `DELETE /admin/backpacks/:id` manage unique backpack items. Create requests include positive `capacityLiters` and `emptyMassKg`; the server fixes `itemType` to `backpack` and `stackMax` to `1`.

---

## Game settings

### `GET /admin/settings`

**Response:**

```json
{
  "id": "singleton",
  "startingArcBalance": 5000,
  "starterShipDefinitionIds": ["clx..."],
  "starterPropDefinitionIds": [],
  "starterItemDefinitionIds": [],
  "createdAt": "...",
  "updatedAt": "..."
}
```

### `PUT /admin/settings`

Replace settings (all fields required).

**Body:**

```json
{
  "startingArcBalance": 5000,
  "starterShipDefinitionIds": ["ship-def-id-1", "ship-def-id-2"],
  "starterPropDefinitionIds": ["prop-def-id"],
  "starterItemDefinitionIds": ["item-def-id"]
}
```

`starterShipDefinitionIds` must contain at least one valid ship definition id.

---

## Backend implementation map

| Layer | Path |
| --- | --- |
| Admin HTTP/auth/catalog | `backend/crates/server/src/admin.rs` |
| Player game persistence | `backend/crates/server/src/game.rs` |
| API router | `backend/crates/server/src/main.rs` |
| SQL migrations | `backend/migrations/` |
| Client API | `src/net/admin_api.ts` |
