---
sidebar_position: 48
title: Ship stairs / ladder
description: Stepped or smooth vertical movement between ship decks.
---

# Ship stairs / ladder

Vertical movement between decks inside a ship. **Ship** prefabs only.

The palette lists two entries — **Ship Stairs** and **Ship Ladder** — but both serialize as `type: "ship-stairs"` with different `variant` values.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `"stairs"` \| `"ladder"` | `"stairs"` | Discrete treads vs smooth climb |
| `zoneId` | string | — | Unique id for this run |
| `min` | `{ x, z }` | — | Local XZ footprint at bottom |
| `max` | `{ x, z }` | — | Opposite local XZ corner |
| `riseUp` | number | — | Total rise from bottom to top (meters) |
| `stepCount` | number | `4` | Tread count (stairs only; ignored for ladder) |
| `height` | number | `3.1` | Camera containment above top step |
| `gate` | `"ramp"` \| `{ doorId }` | — | Only climbable when gate is open |
| `passage` | boolean | `false` | Narrow connector between rooms |

## Variants

### Stairs

Discrete treads across the run. Entity **Y** is the bottom step; `riseUp` climbs toward **+Z**. Set `stepCount` for tread density.

### Ladder

Smooth vertical climb volume. Press **F** at the foot or head to go up or down. `stepCount` is ignored.

## Usage

Place at the bottom of each vertical run. Match `min`/`max` to the stairwell or ladder well footprint.

Use `gate` when a deck is only reachable through an open [Ship door](./ship-door) or lowered ramp.

## See also

- [Ship authoring](../ship-authoring)
- [Ship walk zone](./ship-walk-zone)
