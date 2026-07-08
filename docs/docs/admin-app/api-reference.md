---
sidebar_position: 9
title: API reference
description: REST endpoints for the ClaudeCitizen admin API.
---

# API reference

All admin endpoints are served by the Nest.js server under the `/admin` prefix (default base: `http://localhost:3000`).

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

Valid `itemType` values: `consumable`, `weapon`, `armor`, `clothing`, `material`, `misc`.

### `PATCH /admin/items/:id`

Partial update. `prefabId` and `iconUrl` may be set to `null`.

### `DELETE /admin/items/:id`

**Response `204`** on success.  
**Response `400`** if players still hold copies.

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

## Server implementation map

| Layer | Path |
| --- | --- |
| Controller | `server/src/admin/admin.controller.ts` |
| Service | `server/src/admin/admin.service.ts` |
| Guard | `server/src/admin/admin.guard.ts` |
| Catalog logic | `server/src/game/game.catalog.service.ts` |
| Client API | `src/net/admin_api.ts` |
