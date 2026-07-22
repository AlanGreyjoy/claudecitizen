---
sidebar_position: 25
title: Weapon Shop
description: Station vendor screen — gaze prompt and ARC weapon/ammunition purchase UI.
---

# Weapon Shop

Walk-up station terminal for buying weapons and ammunition into personal inventory with ARC. **Station** prefabs only. Place an Empty on the display face; while on foot, look at it and press **F** to open the shop UI (same ES-style flat panel pattern as the bunk Entertainment System).

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
| `itemDefinitionIds` | string[] | _(empty)_ | Explicit allowlist of weapon and ammo IDs; empty = all weapons and all ammo |

## Usage

1. Add Empty on the vendor screen the player looks at while standing
2. Add component **Weapon Shop**
3. Rotate the Empty so its local **+Z** faces the player (plane is upright by default)
4. Optionally paste comma-separated weapon and ammo definition IDs to limit the catalog
5. Preview in Play (logged-in session with ARC + weapon catalog) → walk up → look at screen → **F** → Buy → Esc to close

Purchases call `POST /game/inventory/purchase` and deduct ARC. Weapons grant one unique copy; already-owned weapons show **Owned** and cannot be bought again. Ammo is stackable, shows `Owned / stackMax`, and each purchase grants one round until the stack is full. HaloBand inventory and balance refresh after a successful buy. Offline / unsigned sessions can open the panel but show “Sign in to browse.”

The demo station's `weapon-shop-1` uses an empty allowlist, so it automatically stocks the seeded rifle, handgun, 5.56 rounds, and 9mm rounds.

## See also

- [AVMS terminal](./avms-terminal) (proximity vehicle UI)
- [Entertainment System](./entertainment-system) (bunk screen pattern)
- [Station authoring](../station-authoring)
