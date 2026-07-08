---
sidebar_position: 4
title: Prefab editor
description: Dev-only in-browser editor for station and ship prefabs.
---

# Prefab editor (dev only)

The in-browser editor assembles **prefabs** — trees of GLB assets, box primitives, and gameplay markers — that the game loads as the orbital station or the player ship. It is only available under `npm run dev`; production builds contain no editor code.

![ClaudeCitizen prefab editor](/img/editor-screenshot.png)

The screenshot above shows the dev-only prefab editor: a Unity-style layout with hierarchy, scene view, inspector, and project browser. Here the Phobos Starhopper is being placed in a station prefab with a `walk-volume` component for on-foot collision.

Open it from the title screen or deep-link with `http://localhost:4173/?boot=editor`.

## Panels

| Panel | What it does |
| --- | --- |
| **Hierarchy** (left) | Scene tree — click to select, double-click to rename, drag rows to reparent, eye toggles visibility |
| **Scene View** (center) | Orbit camera (LMB drag orbit, MMB pan, wheel zoom), Unity-style flythrough (hold RMB + WASD, `Q`/`E` down/up, `Shift` fast, wheel adjusts fly speed), transform gizmo, click to select, drag assets in to place them |
| **Inspector** (right) | Name, transform fields, box primitive / model settings, and gameplay components |
| **Project** (bottom) | Merged asset browser over `editor/assets/` and `src/assets/` with model thumbnails; drag GLB/GLTF cards into the scene |

## Toolbar

**Move / Rotate / Scale** (`W` / `E` / `R`), local/world space, snap toggle with translate (default `0.25 m`) and rotate (default `15°`) increments (hold `Ctrl` to invert snapping while dragging), `+ Box` / `+ Empty`, undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`), prefab name + kind, **New / Load / Save** (`Ctrl+S`), **Preview Station / Preview Ship** (per kind), Exit. `F` focuses the selection, `Ctrl+D` duplicates, `Del` deletes.

## Prefabs

Saving writes JSON to `src/world/prefabs/data/<id>.prefab.json` (tracked — metadata only, asset urls may point at gitignored protected files). The game bundles these files, and the production build copies only the asset files referenced by those prefabs.

Components are added in the Inspector through a **search/autocomplete box** (type to filter, arrows + Enter to add) that only offers types valid for the current prefab kind. Unity-style placement: adding a spatial component (zones, doors, seats, pads, …) to a model entity creates an **empty child marker** carrying the component, selected and ready to move with the gizmo; adding to an empty attaches directly.

### Station components

| Component | Purpose |
| --- | --- |
| `walk-volume` | Walkable floor box per floor (`hab` / `lobby` / `hangar`); edges are collision. Mark hangar mouths with open sides |
| `spawn-point` | Player spawn; the entity's forward (+Z) sets facing |
| `elevator` | Two markers sharing a pair id on different floors form a working elevator (F to ride) |
| `hangar-pad` | Ship parking spot inside a hangar walk volume; place at pad surface height. Parked ships rest at their own prefab-authored gear height above it |
| `interaction` | Shows a prompt within a radius |
| `collider` | Reserved for future physics |

### Previewing a station prefab

The hand-rolled procedural station remains the default. To play a prefab station instead (dev only):

```text
http://localhost:4173/?stationPrefab=<prefab-id>
```

Try the tracked example: `?stationPrefab=demo-station`. The **Preview Station** toolbar button saves and jumps there directly, and the **Back to Editor** banner at the top of the preview returns you to the editor with the same prefab open (press `Esc` first to release the mouse). Walk volumes, spawn, elevators, and hangar pads all come from the prefab's components; the ship terminal/hangar-bank flow still belongs to the procedural station until cutover.

## Ship prefabs (Ship Editor mode)

Setting the prefab kind to `ship` switches the editor into **Ship Editor** mode: the toolbar shows a SHIP EDITOR chip, the component palette narrows to ship types, and the viewport toolbar grows a **Ship** group with **Gear** / **Ramp** toggles plus one button per authored door for articulation preview. Dragging a GLB from a `ships/` folder also offers to start a ship prefab and marks the model as the hull.

The player ship is itself a prefab: the game loads `phobos-starhopper` (`src/world/prefabs/data/phobos-starhopper.prefab.json`) at startup, so its hull model, walkable interior, doors, pilot seat, and ramp all come from components. The hardcoded Starhopper layout remains only as a fallback when the prefab is missing.

### Ship components

| Component | Purpose |
| --- | --- |
| `ship-hull` | Marks the entity whose GLB model is the flyable hull (one per prefab, keep at 0,0,0). `restHeight` sets the parked height above ground; unset lets previews rest the hull on the pad automatically |
| `ship-walk-zone` | Walkable deck rect; entity height sets the floor, `slopeMinUp` slopes ramps/steps, `gate` locks it behind the boarding ramp or a door, `passage` marks doorways |
| `ship-door` | Open/close door bound to GLB nodes (slide meters or hinge radians per node); entity position is the F-interact spot; walk zones gate on its id |
| `pilot-seat` | Seat pose + eye offset (cockpit camera) + stand-up spot |
| `ramp-interact` | Raise/lower ramp prompt — `outside` at the ramp foot or a `deck` panel |
| `ramp-mount` | Ground strip where walking in steps onto the lowered ramp |
| `interaction` / `collider` | Shared with stations |

Use `window.__claudecitizenShipModel.listNodeNames()` in the play/sandbox console (or `node scripts/inspect_glb.mjs <path>`) to find GLB node names for `ship-door` bindings.

### Ship sandbox

**Preview Ship** saves and opens the isolated ship sandbox (dev only):

```text
http://localhost:4173/?shipPrefab=<prefab-id>
```

The ship sits parked on a flat test pad — no planet, station, or flight — so you can verify everything a ship prefab authors: walk the deck, mount/dismount the ramp, open and close every door, take the pilot seat (cockpit camera comes from `pilot-seat.eye`), and toggle the landing gear (`G`). The **Back to Editor** banner returns to the editor with the prefab open. Try it with the tracked default: `?shipPrefab=phobos-starhopper`.
