---
sidebar_position: 23
title: Scene Exit
description: In-play portal that loads another scene (hab → station, hangar → open space).
---

# Scene Exit

In-play portal that **loads another scene document** during Play.
Use `interact` to leave a private hab on foot, or `fly-through` at a hangar
mouth so a ship crossing the marker leaves for open space.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |
| Scenes | Yes (station / site palette) |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `sceneId` | string | — | Target scene id, or `@space` (Game Manager Open Space hop) |
| `trigger` | `"interact"` \| `"fly-through"` | `"interact"` | F on foot, or ship sphere cross (no prompt) |
| `prompt` | string | `"Press F — exit to station"` | HUD text when in range; unused by fly-through |
| `radius` | number | `2.5` | Foot reach / ship crossing radius in meters |
| `networkInstanceId` | string | `"station:public"` | Cell Transition; `@apartment` / `@hangar` / `@space` tokens allowed |
| `arrivalRoomId` | string | `"lobby"` | Room id sent with the Transition |
| `stationPrefabId` | string? | — | Required for `@space` / fly-through: Station whose Hangar Open Space Exit is the arrival mouth |

## Hab → station (on foot)

1. In the hab, place an Empty at the door / lift
2. Add **Scene Exit**
3. **Target Scene** → the shared station scene
4. Keep Network Instance `station:public` unless you need another cell
5. Play → walk up → **F** → loads the station scene

## Hangar → open space (fly-through)

1. On the **Station** prefab, place a [Hangar Open Space Exit](./hangar-open-space-exit) at the bay mouth
2. In the hangar, place a **Scene Exit** covering the opening
3. **Target Scene** → **Open Space (Game Manager)** (`@space`) — sets `fly-through`
4. **Station** → that station prefab
5. Network Instance stays `@space`

Flying through swaps the scene into `space:<systemId>` and spawns you **still in
the cockpit** at the station's Hangar Open Space Exit pose.

This is not a menu `scene-link`. It stops the current play session and boots the
target scene through the scene host.

## See also

- [Hangar Open Space Exit](./hangar-open-space-exit)
- [Station authoring](../station-authoring)
- [Instanced scene](../scene-components#instanced-scene) — private hab / hangar scope
- [Game loop](../../architecture/game-loop)
- [Spawn point](./spawn-point)
