---
sidebar_position: 51
title: Bed
description: Ship bunk with F-key lie-down and head-look camera.
---

# Bed

Lie down in a ship bunk. Entity position is the mattress / interact spot. **Ship** prefabs only. Does **not** enable flight.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"bed-1"` | Unique within prefab |
| `label` | string | `"bed"` | Prompt text ("Press F — lie down") |
| `trigger` | `"radial"` \| `"raycast"` | `"radial"` | Stand-in sphere vs camera-aim within range |
| `radius` | number | `1.6` | Radial stand reach / raycast max camera distance |
| `aimRadius` | number | `0.35` | Raycast only: max miss from camera ray to marker |
| `eye` | `{ x, y, z }` | `{0, 0.3, 0.15}` | Head camera offset from the marker (scene axes) |
| `stand` | `{ x, z }` | `{-0.9, 0}` | Get-up spot offset from the marker (scene XZ) |

### Triggers

| Trigger | Interact when |
| --- | --- |
| `radial` | Character stands inside the sphere at the marker |
| `raycast` | Camera aims at the marker within `radius`, within `aimRadius` of the ray |

## Usage

1. Add Empty at the bunk mattress / stand-up interact spot
2. Add component **Bed**
3. Tune **Eye** (pillow head height) and **Stand XZ** (aisle get-up spot)
4. Preview: walk near → **F** to lie down → mouse looks around → **Hold Y** to get up
5. Optional: place an [Entertainment System](./entertainment-system) empty on the bunk screen for in-bed Docs / YouTube

## See also

- [Entertainment System](./entertainment-system) (bunk mini-TV)
- [Ship door](./ship-door) (same radial / raycast interact pattern)
- [Ship authoring](../ship-authoring)
