---
sidebar_position: 41
title: Ship hull
description: Marks the flyable hull GLB model.
---

# Ship hull

Marks which entity's GLB is the flyable hull. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `restHeight` | number | — | Parked height above ground in meters |

## Usage

**One per prefab**, positioned at **0, 0, 0**. The game recenters the hull model on the ship origin.

When `restHeight` is unset, previews rest the hull's lowest point on the pad automatically. Set it explicitly when the default parked pose does not match your gear bindings.

Dragging a GLB from a path containing `/ships/` can auto-tag the entity with `ship-hull` when you confirm ship prefab creation.

## See also

- [Ship authoring](../ship-authoring)
- [Ship gear](./ship-gear) — landing leg bindings
