---
sidebar_position: 38
title: NPC placement
description: Named or service station NPC at a fixed spot.
---

# NPC placement

Places a specific named or service character. **Station** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable authored instance id within the prefab |
| `npcDefinitionId` | string | Definition from `src/npc/catalog.ts` |
| `displayName` | string? | Optional override |
| `modelUrl` | asset url? | Character GLB dragged from the asset browser |
| `floorId` | station floor | Floor for this placement |
| `behavior` | enum | `stationary` \| `wander` \| `patrol` |
| `routeGroup` | string? | Required for wander/patrol; omit for stationary |

## Notes

Same cosmetic / non-authoritative rules as ambient spawners. Definitions and
weighted populations live in the NPC catalog — prefabs reference ids rather than
embedding appearance data.

## Choosing the character model

Leave **Character model** empty and the NPC wears the modular Sidekick avatar
built from `npcDefinitionId` (names, hair/eye colors, body sliders).

Drop a character GLB onto the field — drag it out of the Project asset browser,
e.g. `/assets/Synty/ScifiSpace/Characters/SM_Chr_BR_BigAlien_02.glb` — and that
model replaces the avatar entirely; appearance data is then ignored. The model
needs a Unity humanoid rig (a `Hips` root bone): locomotion clips come from the
project animation controller and are retargeted onto it, so the GLB itself does
not have to ship animations. The editor viewport swaps its capsule marker for
the real model once it loads.

## See also

- [NPC spawner](./npc-spawner)
- [NPC waypoint](./npc-waypoint)
- [Station authoring](../station-authoring)
