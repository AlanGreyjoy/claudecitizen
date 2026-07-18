---
sidebar_position: 15
title: System Map
description: Place planets and stations on a shared ecliptic system layout.
---

# System Map

The **System Map** scene tab arranges planets and orbital stations around a single star. Layout is saved as a `SystemDocument` under `src/world/systems/data/` and is separate from planet terrain recipes (Planet Authoring) and station prefab interiors.

## Open the tab

1. Start the editor (`?boot=editor` or title-screen **Editor**).
2. Click the **System Map** scene tab.
3. Or deep-link: `/?boot=editor&tab=system&systemId=default`

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
| **Add station** | Adds a station prefab instance (station-kind prefabs only) |
| **Remove** | Deletes the selected planet or station entry |
| **Fit** | Zooms the map to fit all bodies |
| **New** | Starts a new system document (prompt for slug id) |

## Map controls

- **LMB** — select / drag bodies
- **MMB** — pan
- **Wheel** — zoom

## Document location

```text
src/world/systems/data/<id>.system.json
```

The shipped seed is `default.system.json` (**Asteron System**): star Asteron Prime, planet Asteron, and instances of `demo-station` and `blackmarketstation`.

Planet terrain still lives in `src/world/planets/data/`. Station interiors still live in prefab JSON. The system file only places them relative to each other.

## Relationship to play

Play loads a system via `?systemId=` (default `default`) and places stations whose parent is the **active** planet (`?planetId=`). Moving stations on this map and reloading play updates their orbital bearings. Only one planet terrain is active at a time; switching planets later will re-bind which stations are local.

The primary station (matched by `?stationPrefab=` when possible) is fully walkable. Other stations on the same planet render as visual roots without a second physics world.

See also: [Planet authoring](./planet-authoring), [Station authoring](./station-authoring), [Play](../play).
