---
sidebar_position: 21
title: Spawn point
description: Player spawn location and facing direction.
---

# Spawn point

Player spawn marker. **Station** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No — place one or more per station |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `floorId` | `"hab"` \| `"lobby"` \| `"hangar"` | `"lobby"` | Floor this spawn belongs to |

## Usage

Entity **position** sets where the player appears. Entity **+Z forward** sets facing direction — orient the marker before saving.

Place at least one spawn near the intended player entry (typically the main lobby). Multiple spawns on the same `floorId` let the runtime pick among them.

## See also

- [Station authoring](../station-authoring)
- [Elevator](./elevator) — routing between floors
