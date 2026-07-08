---
sidebar_position: 45
title: Ship walk zone
description: Walkable deck volume as a local XZ box.
---

# Ship walk zone

Walkable deck volume as a local **XZ rectangle**; entity **Y** sets floor height. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `zoneId` | string | `"cabin"` | Unique room id (`cabin`, `cockpit`, …) |
| `min` | `{ x, z }` | — | Local XZ corner |
| `max` | `{ x, z }` | — | Opposite local XZ corner |
| `height` | number | `3.1` | Camera containment above floor (meters) |
| `slopeMinUp` | number | `0` | Floor delta at min-Z edge for ramps/steps |
| `gate` | `"ramp"` \| `{ doorId }` | — | Zone only walkable when gate is open |
| `passage` | boolean | `false` | Doorway connector; real rooms win for camera framing |

## Usage

Place one marker per deck room. Rotate the entity to tilt ramps and passages.

Use `gate: "ramp"` for zones reachable only when the boarding ramp is down. Use `gate: { doorId: "door-1" }` to tie a zone to a [Ship door](./ship-door).

Mark narrow connectors with `passage: true` so the camera prefers framing the main room.

## See also

- [Ship authoring](../ship-authoring)
- [Ship door](./ship-door)
- [Ship stairs / ladder](./ship-stairs)
