---
sidebar_position: 26
title: Outfitters
description: Station vendor screen — gaze prompt and ARC outfitters purchase UI with gear category tabs.
---

# Outfitters

Walk-up station terminal for buying apparel and gear into personal inventory with ARC. **Station** prefabs only. Place an Empty on the display face; while on foot, look at it and press **F** to open the shop UI (same ES-style flat panel pattern as the Weapon Shop).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"outfitters-1"` | Unique within prefab |
| `label` | string | `"Browse outfitters"` | Gaze HUD prompt |
| `gazeRadius` | number | `0.4` | Max miss from camera ray to marker (m) |
| `maxDistance` | number | `3` | Max distance from eye to marker (m) |
| `screenWidth` | number | `0.45` | Powered-on plane width (m) |
| `screenHeight` | number | `0.28` | Powered-on plane height (m) |
| `itemDefinitionIds` | string[] | _(empty)_ | Optional filter of catalog item IDs; empty = all stocked items |

## Categories

The panel shows tabs for **Head**, **Shoulders**, **Arms**, **Chest**, **Waist**, **Legs**, **Feet**, and **Back**.

- **Back** lists catalog items with `itemType === "backpack"` (e.g. `demo-backpack`).
- Other categories show “No stock in this category” until armor/clothing catalog entries exist.

## Usage

1. Add Empty on the vendor screen the player looks at while standing
2. Add component **Outfitters**
3. Rotate the Empty so its local **+Z** faces the player (plane is upright by default)
4. Optionally paste comma-separated catalog IDs to limit stock
5. Preview in Play (logged-in session with ARC + backpack catalog) → walk up → look at screen → **F** → pick a tab → Buy → Esc to close

Purchases call `POST /game/inventory/purchase`, deduct ARC, and grant **one** copy into personal inventory. Already-owned items show **Owned** and cannot be bought again. Equip backpacks from Inventory (**I**). Offline / unsigned sessions can open the panel but show “Sign in to browse and buy.”

## See also

- [Weapon Shop](./weapon-shop) (same gaze + purchase pattern)
- [Entertainment System](./entertainment-system) (bunk screen pattern)
- [Station authoring](../station-authoring)
