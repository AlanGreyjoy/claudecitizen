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
3. Press **Play** and verify on-foot movement

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

Elevators stay **inside one station layout**. If the hab and the station are
**separate scenes** (private `instance` hab + shared station), use
[Scene Exit](./components/scene-exit) instead.

### scene-exit

In-play portal that **loads another scene**. Typical private-hab setup:

1. Hab scene: Scene Settings → **Instance**
2. Add `instanced-scene` with `scope: "player"`
3. Place `spawn-point` and a **Scene Exit** toward the station scene id
4. Play → **F** at the exit → boots the station scene

See [Scene Exit](./components/scene-exit).

### hangar-pad

Ship parking spot inside a hangar. Set `hangarId`, `padIndex`, and `floorId: "hangar"`. Place at pad surface height — parked ships rest at their prefab-authored gear height above the pad.

### avms-terminal

Interaction zone that opens the **Asteron Vehicle Management System** — lets players call ships from inventory. Set `radius` and `floorId`.

### weapon-shop

Gaze + **F** vendor screen (ES-style flat panel). Place an Empty on the display face with local **+Z** toward the player. Sells catalog weapons and ammunition for ARC via `POST /game/inventory/purchase`. Optional `itemDefinitionIds` allowlist accepts both item kinds; empty = all weapons and all ammo.

### outfitters

Same gaze + **F** pattern as weapon-shop. Category tabs for Head through Back; **Back** stocks backpacks today (other tabs empty until armor/clothing catalog grows). Purchases use the same inventory purchase endpoint. Optional `itemDefinitionIds` filter; empty = all stocked outfitters items.

### interaction + animation

For doors and moving platforms:

1. Add an `animation` component defining which GLB `nodes` move, motion type, axis, and delta
2. Add an `interaction` with `interactionType: "animation"` and matching `targetAnimationId`
3. In play, press the bound key (default **F**) to toggle

The editor viewport toolbar shows per-animation toggle buttons for preview.

### ladder

Place an Empty at the **foot** of the climb. Local **+Y** climbs; local **+Z** is
the step-off side at the top. See [Ladder](./components/ladder).

### NPCs

- [NPC spawner](./components/npc-spawner) + [NPC waypoint](./components/npc-waypoint) graph for ambient crowds, or a spawner set to `roam` when a wander disc is enough
- [NPC placement](./components/npc-placement) for named/service characters

Cosmetic only — no player collision or persistence yet.

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
5. Wire elevators between floors **or** add `scene-exit` when the hab is a separate instance scene
6. Add hangar-pad markers in ship bays
7. Place AVMS terminals near hangar access
8. Save and press **Play**

### Private hab + shared station (split scenes)

When the residential deck is its own scene (for example `blackmarkethab`) and the
concourse is another (`blackmarket`):

| Scene | Scene Settings kind | Key components |
| --- | --- | --- |
| Hab | `instance` | `instanced-scene` `scope: "player"`, `spawn-point`, `scene-exit` → station id |
| Station | `instance` (shared) or `main-game` | Station layout / prefab; omit player-scoped `instanced-scene` so players share a cell |

The boot scene's Game Manager **Starting Hab** points at the hab scene; the hab's
Scene Exit points back at the station. See [Game flow](./game-flow).

### Hangar → open space

A hangar leaves for space by ship, not on foot:

1. On the **Station** prefab, place a [Hangar Open Space Exit](./components/hangar-open-space-exit) at the bay mouth (local +Z out)
2. In the hangar, place a **Scene Exit** at the mouth, sized to cover the opening
3. Set its target scene to **Open Space (Game Manager)** (`@space` / `fly-through`)
4. Set **Station** to that station prefab so arrival uses its hangar mouth pose
5. Keep `networkInstanceId` `@space` so the cell follows the scene

Flying through swaps the scene and drops you into `space:<systemId>` still at the
controls, at the station's Hangar Open Space Exit. Because the target is a token,
the same hangar prefab works in any project that names an Open Space Scene.

## Preview

Open the station prefab and press **F6** (or toolbar **Play**). Play wraps the
prefab in a throwaway stage scene and runs it in the Game view — unsaved edits
included. Stop with **F6** / **Shift+F6**.

There is no browser URL playtest workflow. Ship the game with **File → Build Web**.

## Back to editor

Press `Esc` to release the mouse, then `F6` (or **Stop**) to leave Play mode. The
editor window and the open document are untouched — Play runs in an overlay over
the Game region, not in a separate window.

## Coordinate reminder

Prefab/scene axes map to station gameplay as: right = **−x**, up = **y**, forward = **+z**. Keep this in mind when orienting spawn facing and hangar pad approach vectors.
