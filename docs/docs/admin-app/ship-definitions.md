---
sidebar_position: 5
title: Ship definitions
description: Create and edit playable ship catalog entries in the Admin App.
---

# Ship definitions

A **ship definition** is a server-side catalog row that ties a bundled **ship prefab** to gameplay stats and an ARC shop price. When players receive or purchase ships, the server creates `Ship` instances from these definitions.

Definitions live in the `ShipDefinition` Prisma model. The Admin App **Ships** tab is the primary way to manage them.

## List view

Search by name or prefab id. The table shows:

| Column | Field |
| --- | --- |
| Name | `name` |
| Prefab | `prefabId` |
| Cost (ARC) | `costArc` |
| Max HP | `maxHp` |
| Max shields | `maxShields` |
| Max speed | `maxSpeedMps` (m/s) |
| Accel | `throttleAccelMps2` (m/s²) |

Click a row to edit. Use **Create ship definition** for a new entry.

## Create / edit form

| Field | Validation | Notes |
| --- | --- | --- |
| **Name** | Required, max 80 chars | Display name in catalog and admin |
| **Description** | Required, max 2000 chars | Flavor / shop text |
| **Ship prefab** | Required | Dropdown of bundled ship prefabs (`kind: "ship"` in prefab JSON) |
| **Cost (ARC)** | Integer 0 – 2B | Shop price in Asteron Reserve Credits |
| **Max HP** | Float 1 – 100,000 | Full-health pool |
| **Max shields** | Float 0 – 100,000 | Shield capacity |
| **Shield regen / sec** | Float 0 – 10,000 | Passive shield recharge rate |
| **Max speed (m/s)** | Float 5 – 500 | Flight speed cap |
| **Throttle accel (m/s²)** | Float 1 – 10,000 | Forward acceleration |

### Prefab picker

The prefab dropdown is built from bundled files in `src/world/prefabs/data/*.prefab.json` where `kind === "ship"`. Adding a new flyable ship to the catalog requires:

1. Author the prefab in the [CC Editor](/cc-editor) and save it under `src/world/prefabs/data/`.
2. Create a ship definition here pointing at that prefab id.

Prefab ids must match `^[a-z0-9][a-z0-9-]{0,63}$`.

## Runtime behavior

- **Starter loadout** — definitions referenced in [Game settings](./game-settings) are instantiated as owned ships on first player bootstrap. Order in the starter list matters: the first entry becomes the default primary ship.
- **Owned ships** — each player `Ship` row may reference a `shipDefinitionId`. Stats on the definition are copied when the ship is created; later definition edits do not automatically patch existing owned ships.
- **No delete in UI** — ship definitions cannot be removed from the Admin App. Existing player ships keep a nullable foreign key (`onDelete: SetNull`) if a definition were removed at the database level.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/ships` | List all definitions |
| `POST` | `/admin/ships` | Create definition |
| `PATCH` | `/admin/ships/:id` | Partial update |

See [API reference](./api-reference) for request body shapes.
