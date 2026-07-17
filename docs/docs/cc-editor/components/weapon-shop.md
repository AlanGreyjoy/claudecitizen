---
sidebar_position: 25
title: Weapon Shop
description: Station vendor screen — gaze prompt and ARC weapon purchase UI.
---

# Weapon Shop

Walk-up station terminal for buying weapons into personal inventory with ARC. **Station** prefabs only. Place an Empty on the display face; while on foot, look at it and press **F** to open the shop UI (same ES-style flat panel pattern as the bunk Entertainment System).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"weapon-shop-1"` | Unique within prefab |
| `label` | string | `"Browse weapons"` | Gaze HUD prompt |
| `gazeRadius` | number | `0.4` | Max miss from camera ray to marker (m) |
| `maxDistance` | number | `3` | Max distance from eye to marker (m) |
| `screenWidth` | number | `0.45` | Powered-on plane width (m) |
| `screenHeight` | number | `0.28` | Powered-on plane height (m) |
| `itemDefinitionIds` | string[] | _(empty)_ | Optional filter of catalog weapon IDs; empty = all weapons |

## Usage

1. Add Empty on the vendor screen the player looks at while standing
2. Add component **Weapon Shop**
3. Rotate the Empty so its local **+Z** faces the player (plane is upright by default)
4. Optionally paste comma-separated weapon definition IDs to limit the catalog
5. Preview in Play (logged-in session with ARC + weapon catalog) → walk up → look at screen → **F** → Buy → Esc to close

Purchases call `POST /game/inventory/purchase`, deduct ARC, and grant **one** copy of the weapon into personal inventory. Already-owned weapons show **Owned** and cannot be bought again. HaloBand inventory and balance refresh after a successful buy. Offline / unsigned sessions can open the panel but show “Sign in to browse and buy.”

## See also

- [AVMS terminal](./avms-terminal) (proximity vehicle UI)
- [Entertainment System](./entertainment-system) (bunk screen pattern)
- [Station authoring](../station-authoring)
