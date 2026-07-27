---
sidebar_position: 10
title: API reference
description: REST endpoints for the ClaudeCitizen admin API.
---

# API reference

All admin endpoints are served by the Rust server under the `/admin` prefix (default base: `http://localhost:3000`).

## Common behavior

- **Authentication** — except `POST /admin/session`, all routes require the `cc_admin` HTTP-only cookie set at login.
- **Content-Type** — request and response bodies are JSON.
- **Credentials** — external browser clients must send `credentials: 'include'` (or `withCredentials: true`). The AsteronEngine editor never calls these routes from the renderer; it uses `/__editor/backend/*` so Electron can hold the cookie.
- **Errors** — validation failures return `400` with a `message` string; missing auth returns `401`; missing resources return `404`.

Client helpers live in `src/net/admin-api.ts`.

The editor never calls these routes directly. Requests go through the Electron
main process at `/__editor/backend/*`, which holds the `cc_admin` cookie on the
editor's behalf — the renderer's `cceditor://app` origin cannot store it.

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

Valid general `itemType` values include `consumable`, `ammo`, `armor`, `clothing`, `material`, and `misc`. Weapons and backpacks use their specialized endpoints. Ammo definitions require a caliber-style `subType`, `stackMax` of at least 2, and a positive `costArc`.

### `PATCH /admin/items/:id`

Partial update. `prefabId` and `iconUrl` may be set to `null`.

### `DELETE /admin/items/:id`

**Response `204`** on success.  
**Response `400`** if players still hold copies.

### Weapon definitions

`GET /admin/weapons`, `POST /admin/weapons`, `PATCH /admin/weapons/:id`, and `DELETE /admin/weapons/:id` manage unique weapon items. Create requests include `weaponSlotType` (`rifle`, `sword`, or `handgun`); the server fixes `itemType` to `weapon` and `stackMax` to `1`.

Weapon create requests also include:

```json
{
  "ammoItemDefinitionId": "ammo-rifle-556",
  "magazineSize": 30,
  "fireModes": ["single", "burst3", "auto"],
  "roundsPerMinute": 700,
  "muzzleVelocityMps": 880,
  "bulletGravityMps2": 9.81,
  "maxRangeMeters": 1200,
  "damage": 24
}
```

`ammoItemDefinitionId` may be `null`; otherwise it must reference an existing `ammo` item. Fire modes must be a non-empty, duplicate-free subset of `bolt`, `single`, `burst3`, and `auto`. Magazine size must be at least 1; cadence, velocity, and range must be positive; gravity and damage must be non-negative.

### Backpack definitions

`GET /admin/backpacks`, `POST /admin/backpacks`, `PATCH /admin/backpacks/:id`, and `DELETE /admin/backpacks/:id` manage unique backpack items. Create requests include positive `capacityLiters` and `emptyMassKg`; the server fixes `itemType` to `backpack` and `stackMax` to `1`.

### Wearable definitions

`GET /admin/wearables`, `POST /admin/wearables`, `PATCH /admin/wearables/:id`, and `DELETE /admin/wearables/:id` manage equippable apparel and armor.

**Body adds:**

```json
{
  "wearableSlotType": "torso",
  "occupiedSlotTypes": ["torso", "arms"],
  "sidekickPartPresetId": 3
}
```

- `wearableSlotType` must be one of `head`, `torso`, `arms`, `legs`, or `feet`.
- `occupiedSlotTypes` lists every slot the garment consumes. It must include
  `wearableSlotType` and contain no duplicates, so a torso piece with sleeves can
  block the arms slot too.
- `sidekickPartPresetId` must be greater than zero — it selects the character mesh
  preset the item swaps in.

## Player loadout slots

Equipped items map onto ten fixed slots, which the game validates on equip:

| Slot | Kind | Notes |
| --- | --- | --- |
| `head`, `torso`, `arms`, `legs`, `feet` | Wearable | Must match the item's `wearableSlotType` |
| `backpack` | Backpack | — |
| `rifle-primary` | Weapon (`rifle`) | — |
| `rifle-secondary` | Weapon (`rifle`) | Requires a `backpack` equipped first |
| `sword` | Weapon (`sword`) | — |
| `handgun` | Weapon (`handgun`) | — |

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

## Payments and commerce

See [Payments and the Item Mall](./payments.md) for the setup walkthrough. All routes below require an operator session.

### `GET /admin/payments/config`

Stripe status. **Secrets are never returned** — only whether one exists and a masked preview.

```json
{
  "provider": "stripe",
  "mode": "test",
  "secretKeyConfigured": true,
  "secretKeySource": "console",
  "secretKeyPreview": "sk_\u2022\u2022\u2022\u20224242",
  "webhookSecretConfigured": true,
  "webhookSecretSource": "environment",
  "successUrl": "",
  "cancelUrl": "",
  "webhookUrl": "http://localhost:3000/payments/stripe/webhook",
  "checkoutEnabled": true,
  "encryptionConfigured": true
}
```

`secretKeySource` is `environment`, `console`, or `unset`. Environment variables take priority over stored values.

### `PUT /admin/payments/config`

Stores Stripe settings. Secrets are encrypted with AES-256-GCM before they reach the database.

```json
{
  "mode": "test",
  "secretKey": "sk_test_...",
  "webhookSecret": "whsec_...",
  "successUrl": "https://your-game.example/?checkout=success",
  "cancelUrl": "https://your-game.example/?checkout=cancelled"
}
```

Omit or send an empty `secretKey` / `webhookSecret` to leave the stored value untouched. Returns the same shape as the `GET`. Fails with `400` when `PAYMENTS_ENCRYPTION_KEY` is not configured on the server.

### `GET /admin/credit-packs`

Every pack, active or not. `POST` creates one, `PATCH /admin/credit-packs/{id}` partially updates (omitted fields keep their value), `DELETE` removes it — or deactivates it instead when purchase history exists.

```json
{
  "name": "Credit Chest",
  "description": "A reinforced chest of AsteronCredits.",
  "credits": 2500,
  "bonusCredits": 250,
  "priceCents": 2499,
  "currency": "usd",
  "stripePriceId": null,
  "iconUrl": null,
  "sortOrder": 3,
  "active": true
}
```

`credits` and `priceCents` must be positive.

### `GET /admin/mall`

Every Item Mall listing, including hidden ones, joined to its item definition. `POST` creates, `PATCH /admin/mall/{id}` updates, `DELETE` delists (the `ItemDefinition` is untouched).

```json
{
  "itemDefinitionId": "station-hot-meal",
  "priceCredits": 60,
  "category": "consumable",
  "sortOrder": 1,
  "featured": true,
  "active": true,
  "limitPerPlayer": null
}
```

`itemDefinitionId` is fixed once created. Returns `409` when the item is already listed.

`GET /admin/mall/preview` returns exactly what a player would see, for verifying a curation change.

### `GET /admin/payments/purchases`

The purchase log, newest first, capped at 200. Optional `?status=` filter accepts `pending`, `paid`, `failed`, `refunded`, or `disputed`.

### `GET /admin/users/{id}/credits`

AsteronCredit balance and the last 50 ledger entries for one player. **`{id}` is the player id**, not the user id.

```json
{
  "creditBalance": 1250,
  "entries": [
    {
      "id": "...",
      "delta": 1050,
      "balanceAfter": 1250,
      "reason": "purchase",
      "refType": "credit_purchase",
      "refId": "...",
      "createdAt": "..."
    }
  ]
}
```

### `POST /admin/users/{id}/credits`

Grants or claws back credits. Writes one ledger entry.

```json
{ "delta": 500, "reason": "support ticket 1284", "reasonCode": "grant" }
```

`delta` must be non-zero; negative values deduct and clamp the balance at zero. `reasonCode` is `grant` (support/compensation) or `award` (promotion/prize).

---

## Player payment endpoints

These use the player cookie session, not the operator session.

| Route | Purpose |
| --- | --- |
| `GET /payments/packs` | Active credit packs plus `checkoutEnabled` |
| `POST /payments/checkout` | `{ packId }` → `{ purchaseId, sessionId, url }`. Records intent only; grants nothing. |
| `GET /payments/purchases` | This player's recent purchases and current balance |
| `GET /game/mall` | Active listings and the player's credit balance |
| `POST /game/mall/purchase` | `{ listingId, quantity }` → `{ creditBalance, inventory }` |

### `POST /payments/stripe/webhook`

Unauthenticated by design: Stripe authenticates with an HMAC-SHA256 signature over the raw request body, verified in constant time with a five-minute timestamp tolerance. **This is the only place credits are granted for money.**

Fulfillment is keyed on the Stripe event id through the ledger's unique idempotency index, so a replayed event is a no-op. Verified but unhandled event types return `200` so Stripe stops retrying.

---

## Backend implementation map

| Layer | Path |
| --- | --- |
| Admin HTTP/auth/catalog | `backend/crates/server/src/admin.rs` |
| Admin payments/commerce | `backend/crates/server/src/admin_payments.rs` |
| Stripe + credit ledger | `backend/crates/server/src/payments/` |
| Item Mall | `backend/crates/server/src/mall.rs` |
| Player game persistence | `backend/crates/server/src/game.rs` |
| API router | `backend/crates/server/src/main.rs` |
| SQL migrations | `backend/migrations/` |
| Client API | `src/net/admin-api.ts` |
| Console UI | `src/editor/react/panels/server/` |
