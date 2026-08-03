---
sidebar_position: 24
title: Hangar Open Space Exit
description: Station hangar mouth — open-space fly-through arrival pose.
---

# Hangar Open Space Exit

Singleton marker on a **Station** prefab at the hangar bay mouth. When a hangar
`scene-exit` targets **Open Space** (`@space` / `fly-through`) and names this
station, the player arrives **in-ship** at this marker's world pose.

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

1. Open the **Station** prefab (not the hangar instance scene)
2. Place an Empty at the hangar mouth in open space
3. Add **Hangar Open Space Exit**
4. Aim local +Z out of the bay
5. On the hangar mouth **Scene Exit**, set Target Scene → Open Space and
   **Station** → this station prefab

## See also

- [Scene Exit](./scene-exit) — hangar fly-through + Station picker
- [Station authoring](../station-authoring)
- [Game loop](../../architecture/game-loop) — Hab → Station → Hangar → Open Space
