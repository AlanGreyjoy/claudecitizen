---
sidebar_position: 36
title: NPC spawner
description: Ambient station population that walks a waypoint route group or free-roams a disc.
---

# NPC spawner

Seeds an ambient crowd from a catalog population. **Station** prefabs only.
`behavior` picks how they move: `route` walks an undirected
[npc-waypoint](./npc-waypoint) graph, `roam` needs no waypoints at all and
wanders a disc centred on the marker.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique within the station prefab |
| `populationId` | string | Population definition from `src/npc/catalog.ts` |
| `modelUrl` | asset url? | Character GLB worn by everyone this spawner spawns |
| `floorId` | station floor | Floor the spawner belongs to |
| `minAlive` / `maxAlive` | number | Alive count range |
| `behavior` | `route` \| `roam` | How spawned NPCs move. Defaults to `route` on documents authored before roaming existed |
| `routeGroup` | string | Waypoint route group spawned NPCs use. Ignored by `roam` |
| `radius` | number | Horizontal spawn jitter around the marker (m) |
| `roamRadius` | number | `roam` only: wander disc radius around the marker (m, max 60) |
| `roamWaitMinSeconds` / `roamWaitMaxSeconds` | number | `roam` only: pause taken on reaching each roam target |

## Roaming

Roam mode trades authoring effort for accuracy. Targets are random points in the
disc and NPCs walk to them in a straight line — **there is no station navmesh**,
so a disc that overlaps a wall, a counter, or a stairwell produces NPCs clipping
through it. Keep the radius inside open floor, or use `route` with waypoints when
the space has obstacles. The viewport draws the roam disc as a wireframe ring so
its extent is visible while placing the marker.

The disc is centred on the marker, not on each NPC's jittered spawn point, so one
spawner produces a crowd milling around a shared area.

## Notes

Station NPCs are cosmetic and non-authoritative: no player collision, inventory,
or persistence. Promote to backend cell entities before adding those.

**Character model** applies to every NPC this spawner produces, so a mixed crowd
still comes from the population's Sidekick appearances — leave it empty for that
and use [NPC placement](./npc-placement) when one specific character needs a
specific GLB. Model requirements are the same as for placements.

## See also

- [NPC waypoint](./npc-waypoint)
- [NPC placement](./npc-placement)
- [Station authoring](../station-authoring)
