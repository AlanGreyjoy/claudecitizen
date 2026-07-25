---
sidebar_position: 13
title: Preview and playtest
description: Play, pause, and stop the open document in the editor's Game view.
---

# Preview and playtest

The CC Editor plays the open document in-window, Unity-style. **Play** runs the
active scene — or wraps the active prefab in a throwaway stage scene — in the
Game view layered over the workspace.

## Play, pause, stop

| Action | Shortcut |
| --- | --- |
| Play / Stop | `F6` |
| Pause / Resume | `F7` |

Play reads the **live editor document**, unsaved edits included, so you can
tweak a transform and press Play without saving first. Stop disposes the runtime
and restores the editor viewport. There is no separate Play Mode window.

## Deep-link URLs

| Scene/runtime | Internal route |
| --- | --- |
| Scene asset | `/?boot=scene&sceneId=<id>` |
| Station prefab stage | `/?stationPrefab=<id>` |
| Ship prefab stage | `/?shipPrefab=<id>` |
| Planet surface test | `/?boot=play&planetId=<id>&spawn=surface&from=editor` |

### Examples

```text
?stationPrefab=demo-station
?shipPrefab=phobos-starhopper
?boot=play&planetId=asteron&spawn=surface&from=editor
?boot=scene&sceneId=main-game
```

## Station playtest

Loads the prefab station instead of the default procedural layout in Play Mode.

What comes from the prefab:

- Visual geometry and materials
- Collider-based walking
- Spawn point, elevators, hangar pads
- Interactions and animated doors
- AVMS terminal zones

Some UI flows (terminal/hangar-bank) may still use procedural hooks until full station cutover.

## Ship sandbox

Isolated test pad — no planet, orbital station, or free flight.

Verify in the sandbox:

| Check | How |
| --- | --- |
| Deck colliders | Walk the interior |
| Doors | F to interact; all `ship-door` ids |
| Ramp | F at ramp interact; walk up when lowered |
| Pilot seat | F at seat — cockpit camera from `eye` offset |
| Landing gear | **G** toggles gear |

## Back to editor

Play sandboxes show a **Back to Editor** banner. In Electron this closes Play
Mode and returns focus to the unchanged editor window.

## Round-trip workflow

```mermaid
sequenceDiagram
  participant Ed as CC Editor
  participant Disk as prefab JSON
  participant Play as Play sandbox

  Ed->>Disk: Save (Ctrl+S)
  Ed->>Play: Play active document
  Play->>Play: Walk, interact, test
  Play->>Ed: Stop / Back to Editor
```

The Electron editor bundle enables authoring routes. Browser releases exclude
the editor UI but bundle scene documents so released scene links can resolve.

## Catalog integration

Station and ship prefabs referenced by the [Server console](/admin-app) catalog are the same JSON files you author here. After playtesting locally, create or update definitions so online players receive the content.

## Related

- [Getting started](./getting-started) — save/load basics
- [Station authoring](./station-authoring)
- [Ship authoring](./ship-authoring)
