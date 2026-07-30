---
sidebar_position: 29
title: Pharmacy
description: Station vendor screen — gaze prompt and ARC medical consumable (heal pill) purchase UI.
---

# Pharmacy

Walk-up station terminal for buying medical consumables (heal pills) into personal inventory with ARC. **Station** prefabs only. Place an Empty on the display face; while on foot, look at it and press **F** to open the shop UI (same ES-style flat panel pattern as the Food Shop).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"pharmacy-1"` | Unique within prefab |
| `label` | string | `"Browse pharmacy"` | Gaze HUD prompt |
| `gazeRadius` | number | `0.4` | Max miss from camera ray to marker (m) |
| `maxDistance` | number | `3` | Max distance from eye to marker (m) |
| `screenWidth` | number | `0.45` | Powered-on plane width (m) |
| `screenHeight` | number | `0.28` | Powered-on plane height (m) |
| `itemDefinitionIds` | string[] | _(empty)_ | Optional filter of catalog medical IDs; empty = all `consumable` / `medical` |

## Usage

1. Add Empty on the vendor screen the player looks at while standing
2. Add component **Pharmacy**
3. Rotate the Empty so its local **+Z** faces the player (plane is upright by default)
4. Optionally paste comma-separated medical definition IDs to limit the catalog
5. Preview in Play (logged-in session with ARC + medical catalog) → walk up → look at screen → **F** → Buy → Esc to close

Purchases call `POST /game/inventory/purchase`, deduct ARC, and add **one** stack unit (up to `stackMax`). Use medical consumables from personal inventory to restore health (`healthRestore01`). Health does not drain yet — combat will lower it later.

## See also

- [Food Shop](./food-shop)
- [Drinks Shop](./drinks-shop)
- [Canteen](./canteen)
- [Weapon Shop](./weapon-shop)
