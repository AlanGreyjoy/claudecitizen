---
sidebar_position: 7
title: Station authoring
description: Build orbital station prefabs — colliders, spawns, elevators, hangars, and doors.
---

# Station authoring

Station prefabs (`kind: "station"`) are modular orbital interiors — habs, lobbies, and hangars connected by elevators, with ship parking and AVMS terminals.

Load `demo-station` as a reference implementation.

## Walking and collision

Players walk on **real collider geometry**, not abstract walk-volume boxes.

1. Place GLB wall/floor modules from the Project panel
2. Add **box** or **mesh** `collider` components on entities (or GLB sub-meshes) that match walkable floors and blocking walls
3. Preview with **Preview Station** and verify on-foot movement

Use mesh colliders for complex shapes; box colliders for simple floors and walls. Tune `offset` when the collider center does not match the visual mesh.

## Floor ids

Several station components reference a `floorId`:

| floorId | Typical use |
| --- | --- |
| `hab` | Residential / quarters decks |
| `lobby` | Main concourse |
| `hangar` | Ship bays |

Floor ids group spawn logic, elevator routing, and interaction filtering in the station runtime.

## Essential markers

### spawn-point

One or more per station. Entity position sets spawn location; **+Z forward** sets facing direction.

### elevator

Place two markers with the **same `id`** on different floors. Each marker's `floorId` is where it sits; `targetFloor` is where it delivers the player. Press **F** in play to ride.

### hangar-pad

Ship parking spot inside a hangar. Set `hangarId`, `padIndex`, and `floorId: "hangar"`. Place at pad surface height — parked ships rest at their prefab-authored gear height above the pad.

### avms-terminal

Interaction zone that opens the **Asteron Vehicle Management System** — lets players call ships from inventory. Set `radius` and `floorId`.

### interaction + animation

For doors and moving platforms:

1. Add an `animation` component defining which GLB `nodes` move, motion type, axis, and delta
2. Add an `interaction` with `interactionType: "animation"` and matching `targetAnimationId`
3. In play, press the bound key (default **F**) to toggle

The editor viewport toolbar shows per-animation toggle buttons for preview.

## Lighting

Station interiors benefit from authored lights:

- **area-light** for ceiling panels and soft fill
- **spot-light** for accents and hangar floods
- **point-light** sparingly — shadow cost is high

Lights are visual only in the editor; they serialize and render in play.

## Building workflow

1. Set kind to **station**, name the prefab
2. Greybox or kitbash GLB modules into rooms
3. Add colliders on all walkable/blocking geometry
4. Place spawn-point at the intended player entry
5. Wire elevators between floors
6. Add hangar-pad markers in ship bays
7. Place AVMS terminals near hangar access
8. Save and **Preview Station**

## Preview URL

```text
http://localhost:4173/?stationPrefab=<prefab-id>
```

Example: `?stationPrefab=demo-station`

The procedural hand-rolled station remains the default when no prefab param is set. Prefab stations replace the visual layout; some flows (terminal/hangar-bank UI) may still use procedural hooks until full cutover.

## Back to editor

The play preview shows a **Back to Editor** banner. Press `Esc` to release the mouse, then click the banner — returns to `/?boot=editor&prefab=<id>` with the same document open.

## Coordinate reminder

Prefab/scene axes map to station gameplay as: right = **−x**, up = **y**, forward = **+z**. Keep this in mind when orienting spawn facing and hangar pad approach vectors.
