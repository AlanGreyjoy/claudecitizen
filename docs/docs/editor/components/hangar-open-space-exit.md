---
sidebar_position: 24
title: Hangar Open Space Exit
description: Station hangar mouth — open-space fly-through arrival pose.
---

# Hangar Open Space Exit

Singleton marker on a **Station** concourse scene at the hangar bay mouth. When
a hangar `scene-exit` targets **Open Space** (`@space` / `fly-through`), the
runtime finds the System Map station that owns that hangar and arrives
**in-ship** at this marker's world pose.

Docs name: `HANGAR-OPEN-SPACE-EXIT`. Component type: `hangar-open-space-exit`.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | Yes |
| Scenes | Yes (station palette) |

## Fields

None — pose comes from the empty's transform. Local **+Z** is exit facing
(ship nose points that way on arrival).

## Usage

1. Open the **Station** concourse scene (not the hangar instance scene)
2. Place an Empty at the hangar mouth in open space
3. Add **Hangar Open Space Exit**
4. Aim local +Z out of the bay
5. On the System Map, set this station's **Hangar scene** to the hangar that
   flies out here
6. On the hangar mouth **Scene Exit**, set Target Scene → Open Space

## See also

- [Scene Exit](./scene-exit) — hangar fly-through
- [System Map](../system-map) — `hangarSceneId` ownership
- [Station authoring](../station-authoring)
- [Game loop](../../architecture/game-loop) — Hab → Station → Hangar → Open Space
