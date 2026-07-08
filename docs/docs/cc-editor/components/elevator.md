---
sidebar_position: 22
title: Elevator
description: Floor-to-floor travel between paired markers.
---

# Elevator

Pairs two markers with the same `id` on different floors. **Station** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"lift-1"` | Shared by both ends of the lift |
| `floorId` | `"hab"` \| `"lobby"` \| `"hangar"` | `"lobby"` | Floor where this marker sits |
| `targetFloor` | `"hab"` \| `"lobby"` \| `"hangar"` | `"lobby"` | Floor this lift delivers the player to |

## Usage

1. Place a marker on the source floor — set `floorId` to where it sits and `targetFloor` to the destination
2. Place a second marker on the destination floor with the **same `id`** — reverse the floor ids
3. Press **F** in play to ride between them

Floor ids group spawn logic, elevator routing, and interaction filtering in the station runtime.

## See also

- [Station authoring](../station-authoring)
- [Spawn point](./spawn-point)
