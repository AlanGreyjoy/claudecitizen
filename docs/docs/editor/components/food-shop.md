---
sidebar_position: 26
title: Food Shop
description: Station vendor screen — gaze prompt and ARC food consumable purchase UI.
---

# Food Shop

Walk-up station terminal for buying food consumables into personal inventory with ARC. **Station** prefabs only. Place an Empty on the display face; while on foot, look at it and press **F** to open the shop UI (same ES-style flat panel pattern as the Weapon Shop).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"food-shop-1"` | Unique within prefab |
| `label` | string | `"Browse food"` | Gaze HUD prompt |
| `gazeRadius` | number | `0.4` | Max miss from camera ray to marker (m) |
| `maxDistance` | number | `3` | Max distance from eye to marker (m) |
| `screenWidth` | number | `0.45` | Powered-on plane width (m) |
| `screenHeight` | number | `0.28` | Powered-on plane height (m) |
| `itemDefinitionIds` | string[] | _(empty)_ | Optional filter of catalog food IDs; empty = all `consumable` / `food` |

## Usage

1. Add Empty on the vendor screen the player looks at while standing
2. Add component **Food Shop**
3. Rotate the Empty so its local **+Z** faces the player (plane is upright by default)
4. Optionally paste comma-separated food definition IDs to limit the catalog
5. Preview in Play (logged-in session with ARC + consumable catalog) → walk up → look at screen → **F** → Buy → Esc to close

Purchases call `POST /game/inventory/purchase`, deduct ARC, and add **one** stack unit (up to `stackMax`). Use consumables from personal inventory to restore hunger. HaloBand inventory and balance refresh after a successful buy.

## See also

- [Drinks Shop](./drinks-shop)
- [Canteen](./canteen)
- [Weapon Shop](./weapon-shop)
