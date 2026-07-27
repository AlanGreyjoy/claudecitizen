---
sidebar_position: 37
title: NPC waypoint
description: Undirected route-graph node for ambient station NPCs.
---

# NPC waypoint

A node in the walkable route graph used by ambient NPCs. **Station** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique waypoint id within the prefab |
| `floorId` | station floor | Floor for this node |
| `routeGroup` | string | Groups waypoints into a walkable graph |
| `links` | string[] | Undirected connections to other waypoint ids |
| `waitMinSeconds` / `waitMaxSeconds` | number | Pause range at this node |

## Usage

1. Place waypoints along corridors / rooms that share a `routeGroup`
2. Link neighbors in both directions via `links`
3. Point an [NPC spawner](./npc-spawner) at the same `routeGroup`

Cross-floor links, missing ids, and disconnected graphs are validated when the
station runtime flattens the prefab.

## See also

- [NPC spawner](./npc-spawner)
- [NPC placement](./npc-placement)
