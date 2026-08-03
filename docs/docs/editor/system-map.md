---
sidebar_position: 15
title: System Map
description: Place planets and stations on a shared ecliptic system layout.
---

# System Map

The **System Map** (Star Map) tab arranges planets and orbital stations around a
single star. Layout is saved as a `SystemDocument` under
`src/world/systems/data/` and is separate from planet terrain recipes (Planet
Authoring). Station **concourses** are scenes; Hab and Hangar scenes are owned
by each station entry but are not separate map markers.

See also: [Basic game loop](../architecture/game-loop) (station family ownership).

## Open the tab

1. Launch AsteronEngine (`npm run editor:dev`) and open a project.
2. Click the **Star Map** / **System Map** scene tab.

## Coordinates

Authoring uses a **flat ecliptic** in meters:

| Axis | Meaning |
| --- | --- |
| Star | Origin `(0, 0)` |
| `x` | Horizontal on the map |
| `z` | Vertical on the map (**+z is up** on screen; canvas Y = −z) |
| `y` | Not used in v1 |

Planets store `positionMeters` from the star. Stations store `offsetMeters` from a **parent** (`star` or a planet entry id). Dashed lines on the map show parent → station relationships.

Default seed distances keep several planets draggable: planets near `1e10` m from the star, station offsets near `5e7` m.

## Sidebar actions

| Action | Behavior |
| --- | --- |
| **Open…** | Load a system by id |
| **Save** / Ctrl+S | Writes `src/world/systems/data/<id>.system.json` via `/__editor/system` |
| **Add planet** | Adds an entry that **references** an existing planet document (does not create terrain) |
| **Add station** | Adds a **scene** station entry (concourse). Prefers `blackmarket` when that scene exists |
| **Remove** | Deletes the selected planet or station entry |
| **Fit** | Zooms the map to fit all bodies |
| **New** | Starts a new system document (prompt for slug id) |

## Station entries

Each station on the map is a `SystemStationEntry`:

| Field | Role |
| --- | --- |
| `sceneId` | Concourse / shared lobby scene (preferred). XOR with legacy `stationPrefabId` |
| `habSceneId` | Instanced Hab scene this station owns (optional until wired) |
| `hangarSceneId` | Instanced Hangar scene this station owns; AVMS **To Hangar** falls back here when the terminal leaves Hangar Scene blank |
| `parentBodyId` / `offsetMeters` / `altitudeMeters` | Orbital placement on the ecliptic |

Hab and Hangar are **ownership only** — they do not get their own ecliptic markers.

Legacy **Station prefab** source remains available when the project still has
`kind: station` prefabs.

## Document location

```text
src/world/systems/data/<id>.system.json
```

The shipped seed is `default.system.json` (**Asteron System**): star Asteron
Prime, planet Asteron, and **Black Market Station** with
`sceneId: blackmarket`, `habSceneId: blackmarkethab`,
`hangarSceneId: blackmarkethanger`.

Planet terrain still lives in `src/world/planets/data/`. Station concourse and
family interiors live in scene documents. The system file places the orbital
station and records which Hab/Hangar belong to it.

## Relationship to play

Playable scenes select a system through the scene's `game-manager` component
(`systemId` / `planetId` / spawn mode). Scenes load and switch **in-process** via
the scene host — never by reloading the page with new URL params.

Stations parented to the **active** planet spawn at orbital bearings from their
System Map `offsetMeters`. The primary station (matched by the played scene's
`sceneId` when possible) is fully walkable. Other stations on the same planet
render as visual roots without a second physics world. Stations parented to
inactive planets are not spawned until that planet is active.

Quantum travel approaches the orbital marker only. Entering the concourse, Hab,
or Hangar stays `scene-exit` / AVMS / Play scene — not a second teleporter.

See also: [Planet authoring](./planet-authoring), [Station authoring](./station-authoring),
[Scene components](./scene-components), [Controls](../play).
