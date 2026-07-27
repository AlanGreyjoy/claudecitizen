---
sidebar_position: 23
title: Scene Exit
description: In-play portal that loads another scene (hab → station).
---

# Scene Exit

Walkable F-key portal that **loads another scene document** during Play.
Use this to leave a private hab instance and enter a shared station scene.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |
| Scenes | Yes (station / site palette) |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `sceneId` | string | — | Target scene id (e.g. `blackmarket`) |
| `prompt` | string | `"Press F — exit to station"` | HUD text when in range |
| `radius` | number | `2.5` | Interact distance in meters |
| `networkInstanceId` | string | `"station:public"` | Cell Transition before the swap. Empty = skip |
| `arrivalRoomId` | string | `"lobby"` | Room id sent with the Transition |

## Usage

1. In **BlackMarketHab**, place an Empty at the door / lift
2. Add **Scene Exit**
3. **Target Scene** → `Black Market (blackmarket)`
4. Keep Network Instance `station:public` unless you need another cell
5. Play → walk up → **F** → loads the station scene

This is not a menu `scene-link`, and not a same-layout `elevator`. It stops the
current play session and boots the target scene through the scene host.

## See also

- [Station authoring](../station-authoring)
- [Elevator](./elevator) — same-layout floor rides (not cross-scene)
- [Instanced scene](../scene-components#instanced-scene) — private hab scope
- [Scene components](../scene-components)
- [Spawn point](./spawn-point)
