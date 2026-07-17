---
sidebar_position: 44
title: Ship ramp
description: Boarding ramp hinge on the hull GLB.
---

# Ship ramp

Boarding ramp hinge on the hull GLB. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `node` | string | `"RampParent"` | GLB node that rotates |
| `lowerRadians` | number | `-0.62` | Angle when ramp is lowered |
| `axis` | `"x"` \| `"y"` \| `"z"` | `"x"` | Hinge axis |

## Usage

Omit to use Starhopper defaults. Preview with the viewport toolbar **Ramp** toggle or **F** in the ship sandbox.

Pair with [Ramp interact](./ramp-interact) for the player raise/lower prompt. Boarding uses the Rapier ramp collider mesh — walk onto the lowered ramp.

## See also

- [Ship authoring](../ship-authoring)
- [Ramp interact](./ramp-interact)
