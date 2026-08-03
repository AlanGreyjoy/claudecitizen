---
sidebar_position: 25
title: Exit Hangar
description: Hangar → Open Space. The one departure primitive; on foot or fly-through.
---

# Exit Hangar

The **only** designed way a player leaves a hangar for Open Space. Lives on a
`Runtime: hangar` scene. It has no destination field on purpose:

- **Which** Open Space document is the Game Manager's `openSpaceSceneId` hop.
- **Where in it** is the owning Station body's
  [Hangar Open Space Exit](./hangar-open-space-exit) mouth, found through
  System Map ownership (the entry whose **Hangar scene** is this document).

Authoring either here would be a second source of truth for a decision the map
already makes.

Docs name: `EXIT-HANGAR`. Component type: `exit-hangar`.

Architecture: [Space traversal — Station boarding](../../architecture/space-traversal).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |
| Scenes | Yes (station palette) |

## Fields

| Field | Default | Notes |
| --- | --- | --- |
| Trigger | `fly-through` | `fly-through` fires when a ship crosses the volume, no prompt. `interact` prompts for F on foot. |
| Prompt | `Press F — launch to open space` | Interact trigger only. |
| Radius | `8` | Crossing radius in meters — a pilot who clips the edge of the opening at speed still leaves. |

## Arrival

Both triggers hand the player out **flying** (`arrival: 'in-ship'`): the
destination is a bay mouth in orbit and there is nowhere to stand. Missing
ownership or a station body with no `hangar-open-space-exit` marker falls back
to the generic open-space altitude spawn, with a console warning.

## Usage

1. Open the hangar scene and set **Scene Settings → Runtime** to `hangar`
2. Place an Empty at the bay mouth
3. Add **Exit Hangar**, size the radius to the opening
4. On the System Map, make sure a station entry lists this scene as its
   **Hangar scene**
5. On that station body, place **Hangar Open Space Exit** at the mouth with
   local +Z pointing out

## Migrating from `scene-exit` `@space`

A hangar [Scene Exit](./scene-exit) targeting `@space` still works and warns at
load. Replace it: delete the marker, add **Exit Hangar** in the same spot. The
Network Instance, Arrival Room and Station picker fields all go away — none of
them were ever the author's decision.

## See also

- [Hangar Open Space Exit](./hangar-open-space-exit) — the arrival pose
- [Enter Station](./enter-station) — the way back in
- [Scene Exit](./scene-exit) — on-foot travel between interior cells
- [System Map](../system-map) — `hangarSceneId` ownership
