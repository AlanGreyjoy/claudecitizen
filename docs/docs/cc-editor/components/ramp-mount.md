---
sidebar_position: 50
title: Ramp mount
description: Ground strip where walking in steps onto the lowered ramp.
---

# Ramp mount

Ground strip (local XZ box) where a grounded character steps onto the lowered ramp. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | Yes — one per document |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `min` | `{ x, z }` | `{ x: -1.05, z: -0.4 }` | Local XZ corner at ramp tail |
| `max` | `{ x, z }` | `{ x: 1.05, z: 0.4 }` | Opposite local XZ corner |

## Usage

Place at the tail of the boarding ramp on the ground pad. When the ramp is lowered, walking into this volume transitions the player from the pad surface onto the ramp geometry.

Size `min`/`max` to cover the full width of the lowered ramp foot. Entity **Y** should match the pad surface height.

## See also

- [Ship authoring](../ship-authoring)
- [Ship ramp](./ship-ramp)
- [Ramp interact](./ramp-interact)
