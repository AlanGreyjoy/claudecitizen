---
sidebar_position: 13
title: Object Animation
description: Continuous spin or hover motion on an entity root or named GLB nodes.
---

# Object Animation

Continuous cosmetic motion for props and scenery. Available on **all prefab kinds**. Separate from [Animation](./animation) (interactive open/close blends).

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | No |

Visual only — does **not** move colliders. Keep walk surfaces on a static collider while the mesh bobs or spins.

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | — | Unique within the prefab |
| `mode` | `"hover"` \| `"spin"` | `"hover"` | Bob vs continuous rotation |
| `axis` | `"x"` \| `"y"` \| `"z"` | `"y"` | Hover offset axis, or spin axis |
| `nodes` | `{ name }[]` | `[]` | GLB node names; empty = animate this entity root |
| `speed` | number | `0.5` (hover) / `0.4` (spin) | Hover: cycles per second. Spin: radians per second |
| `amplitude` | number | `0.08` | Hover only — meters peak displacement from rest |
| `phase` | number | `0` | Radians offset so neighbors don't sync |
| `reverse` | boolean | `false` | Spin only — flip rotation direction |

## Recipes

### Hovering stall / kiosk

1. Select the stall entity (the model root)
2. Add **Object Animation**
3. Leave **nodes** empty so the whole entity bobs
4. Mode `hover`, axis `y`, tune amplitude and speed

### Spinning sign

1. Sub-select the sign GLB node in the hierarchy or viewport
2. Add **Object Animation** — `nodes` prefills from the selection; mode defaults to `spin`
3. Axis `y` (or whichever matches the sign pivot), low speed (e.g. `0.3`–`0.6` rad/s)

Node names must match the GLB exactly — inspect with `node scripts/inspect_glb.mjs <path-to.glb>`.

## See also

- [Animation](./animation) — interactive slide/hinge open/close
- [Collider](./collider) — keep physics static while visuals move
