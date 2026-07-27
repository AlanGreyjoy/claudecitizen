---
sidebar_position: 13
title: Preview and playtest
description: Play, pause, and stop the open document in the editor's Game view.
---

# Preview and playtest

The AsteronEngine editor plays the open document in-window, Unity-style. **Play** runs the
active scene — or wraps the active prefab in a throwaway stage scene — in the
Game view layered over the workspace.

## Play, pause, stop

| Action | Shortcut |
| --- | --- |
| Play / Stop | `F6` |
| Pause / Resume | `F7` |
| Stop | `Shift+F6` |

Play reads the **live editor document**, unsaved edits included, so you can
tweak a transform and press Play without saving first. Stop disposes the runtime
and restores the editor viewport. There is no separate Play Mode window.

Play mounts into `#editor-play-host`, a fixed overlay over the Game region, so the
HUD's `position: fixed` elements stay contained inside that region instead of
escaping across the whole workspace. The host is a sibling of `#editor-root` and
must outrank it in `z-index` (currently `260` vs the shell's `250`); otherwise
Play runs under the opaque editor chrome and looks like a blank blue screen while
audio still works. Pause feeds the game loop's `isPaused()` check rather than
tearing the session down.

There is **no browser URL playtest workflow**. Author and test in the editor;
ship a browser build with **File → Build Web**.

## Station playtest

Open a station prefab and press **F6**. Play loads that prefab's layout in a
stage scene.

What comes from the prefab:

- Visual geometry and materials
- Collider-based walking
- Spawn point, elevators, hangar pads, ladders
- Interactions and animated doors
- AVMS terminal and shop zones
- NPC spawners, waypoints, and placements

## Ship tab

The **Ship** tab is where ships are authored and flown. It reuses the scene
viewport, hierarchy, and inspector — ship components (`ship-controller`,
`ship-door`, `cockpit-control`, `bed`, `ladder`, `collider`) live in the normal prefab
palette, and the toolbar's ship group still previews gear, ramp, and door
articulation statically. What the tab adds is a bar with three things:

- **Ship picker / New Ship / Save** — the ship prefabs in the open project.
- **Validation summary** — builds the open ship's layout and lists what would
  break the playtest: no hull GLB, no deck colliders, no pilot-role seat, doors
  that animate with no collider bound. Click it to re-check after edits.
- **Test** — starts the playtest in the selected environment.

### Test environments

| Env | What it boots | Use it for |
| --- | --- | --- |
| **Pad** | Isolated flat pad, no terrain or station | Deck colliders, doors, ramp, seats, flight feel — fastest loop |
| **Planet** | The full stage scene on the active planet | Landing clamp, walking off the ship onto the surface |

Both spawn you **on foot beside the ship with the ramp already down**, so a
single run covers the whole loop. `F6` starts and stops it; `F7` pauses.

Verify in either environment:

| Check | How |
| --- | --- |
| Deck colliders | Walk the interior |
| Doors | F to interact; all `ship-door` ids |
| Ramp | F at ramp interact; walk up when lowered |
| Pilot seat | F at seat — cockpit camera from `eye` offset |
| Leave the seat | Hold **Y** — works at any time, settling onto the pad when nearby |
| Landing gear | **G** toggles gear |
| Flight feel | Sit the pilot, then take off using the normal flight model |

Stat edits (mass, thrust, torque) apply on the next **Test**, not live.

## Planet and system

- **Planet Authoring → Test Play** — full terrain LOD, vegetation, and surface-spawn streaming for the open planet document.
- **System Map** — place stations and planets; playable scenes pick the system via `game-manager`, not URL reloads.

## Round-trip workflow

```mermaid
sequenceDiagram
  participant Ed as AsteronEngine editor
  participant Disk as prefab JSON
  participant Play as Game view

  Ed->>Disk: Save (Ctrl+S)
  Ed->>Play: Play active document (F6)
  Play->>Play: Walk, interact, test
  Play->>Ed: Stop (F6 / Shift+F6)
```

## Build Web

When a build is worth sharing, **File → Build Web** (`Ctrl+B`) saves the active
document and produces the browser release. See [Build Web](./build-web).

## Catalog integration

Station and ship prefabs referenced by the [Server console](/server-console) catalog are the same JSON files you author here. After playtesting locally, create or update definitions so online players receive the content.

## Related

- [Getting started](./getting-started) — save/load basics
- [Projects and settings](./projects-and-settings)
- [Station authoring](./station-authoring)
- [Ship authoring](./ship-authoring)
