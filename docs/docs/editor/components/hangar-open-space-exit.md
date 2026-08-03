---
sidebar_position: 24
title: Hangar Open Space Exit
description: Station hangar mouth — open-space fly-through arrival pose.
---

# Hangar Open Space Exit

Singleton marker on a **Station** body (`Runtime: station`) — a nested
GameObject at the hangar bay mouth. Pose only: when hangar **`exit-hangar`**
fires, the runtime finds the System Map station that owns that hangar and
spawns the ship **in-ship** in Open Space at this marker's world pose.

Docs name: `HANGAR-OPEN-SPACE-EXIT`. Component type: `hangar-open-space-exit`.

Architecture: [Space traversal — Station boarding](../../architecture/space-traversal).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | Yes |
| Scenes | Yes (station palette) |

## Fields

None — pose comes from the empty's transform. Local **+Z** is exit facing
(ship nose points that way on arrival).

## Usage

1. Open the **Station** scene (`Runtime: station` — not the hangar instance)
2. Place an Empty at the hangar mouth (nested under the station tree)
3. Add **Hangar Open Space Exit**
4. Aim local +Z out of the bay
5. On the System Map, set this station's **Hangar scene** to the hangar that
   flies out here
6. On the hangar, place **Exit Hangar** (departure). On the station body, place
   **Enter Station** (ship fly-through → hangar instance)

## See also

- [Space traversal](../../architecture/space-traversal) — `enter-station` / `exit-hangar`
- [System Map](../system-map) — `hangarSceneId` ownership
- [Station authoring](../station-authoring)
- [Game loop](../../architecture/game-loop) — Hab ↔ Station ↔ Hangar; ship boarding
