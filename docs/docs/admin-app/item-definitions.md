---
sidebar_position: 7
title: Item definitions
description: Manage inventory item catalog entries for the online game.
---

# Item definitions

An **item definition** is a server-side catalog entry for player inventory — consumables, ammunition, weapons, materials, and other stackable types. Items can optionally link to a bundled prefab for 3D representation and/or an icon URL for HUD display.

Stored in `ItemDefinition`. Managed from the Admin App **Items** tab.

## List view

Search by name, item type, sub-type, or prefab id.

| Column | Field |
| --- | --- |
| Name | `name` |
| Type | `itemType` |
| Sub-type | `subType` |
| Prefab | `prefabId` (or —) |
| Icon | `yes` if `iconUrl` is set |
| Stack max | `stackMax` |
| Rarity | `rarity` (free-text, default `common`) |

Click a row to edit. **Create item definition** adds a new entry.

## Item types

`itemType` must be one of:

| Type | Typical use |
| --- | --- |
| `consumable` | Medpens, food, one-shot utilities |
| `ammo` | Stackable reserve rounds, grouped by caliber in `subType` |
| `weapon` | Guns, blades, deployables |
| `armor` | Wearable protection |
| `clothing` | Cosmetic wearables |
| `material` | Crafting / trade goods |
| `misc` | Catch-all |

`subType` is a free-form string (max 40 chars, default `generic`) for finer grouping within a type — for example `medical` under `consumable`. Ammo uses a stable caliber slug such as `rifle-556` or `handgun-9mm`; use a high stack maximum (typically 120–240) and a positive ARC cost.

## Create / edit form

| Field | Validation | Notes |
| --- | --- | --- |
| **Name** | Required, max 80 chars | |
| **Description** | Required, max 2000 chars | |
| **Item type** | One of the types above | |
| **Sub-type** | Max 40 chars | |
| **Item prefab** | Optional | Bundled item prefabs, or **None (icon only)** |
| **Icon URL** | Optional, max 512 chars | HUD / inventory icon when no prefab |
| **Stack max** | Integer 1 – 9,999 | Max quantity per stack |
| **Cost (ARC)** | Integer 0 – 2B | Shop or vendor price |
| **Rarity** | Max 24 chars | Display tier (`common`, `rare`, etc.) |

At least one of **prefab** or **icon URL** is usually needed for the client to render the item in the HUD. Icon-only items are valid for abstract goods.

## Weapon combat fields

Weapons use the specialized **Weapons** tab. In addition to `weaponSlotType`, each definition stores explicit Weapon Combat tuning:

| Field | Validation | Notes |
| --- | --- | --- |
| **Ammo item definition** | Optional; when set, must reference an `ammo` item | `null` means the weapon cannot fire; valid for swords and unfinished firearms |
| **Magazine size** | Integer at least 1 | Session-local loaded rounds |
| **Fire modes** | Non-empty subset of `bolt`, `single`, `burst3`, `auto` | Duplicate or unknown modes are rejected |
| **Rounds per minute** | Greater than 0 | Cadence for bolt, burst, and automatic fire |
| **Muzzle velocity** | Greater than 0 m/s | Drives the segmented hitscan drop path |
| **Bullet gravity** | Non-negative m/s² | Downward acceleration; `0` disables drop |
| **Maximum range** | Greater than 0 m | Shot path cutoff |
| **Damage** | Non-negative | Authored now but unused until entity combat ships |

These values live as columns on `WeaponDefinition`, not in opaque item metadata. Existing weapons migrate to a single-fire, 30-round, 600 RPM baseline with no ammo link.

## Deleting definitions

Unlike ships and props, items **can be deleted** from the edit form.

Deletion is blocked if any player still holds a non-zero quantity of that item (`PlayerItem.quantity > 0`). Clear or consume player copies first, or the API returns a `400` error.

## Starter items

Add definitions to **starter items** in [Game settings](./game-settings). On first bootstrap, each listed item is granted at stack quantity 1 (via `PlayerItem` rows).

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/items` | List all definitions |
| `POST` | `/admin/items` | Create definition |
| `PATCH` | `/admin/items/:id` | Partial update |
| `DELETE` | `/admin/items/:id` | Delete (if no player holds copies) |

See [API reference](./api-reference).
