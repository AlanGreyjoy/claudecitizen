---
sidebar_position: 1
title: Components
description: The gameplay component system — palette, markers, colliders, lights, and interactions.
---

# Components

**Components** attach gameplay meaning to entities. They serialize into prefab JSON and are read by station, ship, and physics runtimes at load time.

The add-component palette is driven entirely by `src/world/prefabs/component_registry.ts` — filtered by the current prefab **kind**.

## Adding components

| Entry point | Location |
| --- | --- |
| Inspector search box | Type to filter, arrows + Enter to add |
| Hierarchy RMB → Components | Submenu filtered by kind |
| Viewport RMB on GLB sub-mesh | Add component to node |
| Bulk **Add collider** | Hierarchy context menu on selection |

### Marker components

Many spatial components have `marker: true` in the registry. Adding a marker to a **model entity** creates a **child empty** at the chosen position (Unity-style) instead of attaching to the model root. The child is auto-selected so you can move it with the gizmo.

Adding a marker to an **empty entity** attaches directly.

### Singleton components

Some types allow only one per document (frames, `ship-hull`, `ship-stats`, `ship-gear`, `ship-ramp`). The palette hides them once present.

## Component reference

### Shared (most kinds)

| Component | Summary |
| --- | --- |
| [Collider](./collider) | Box or mesh geometry that blocks walking characters |
| [Interaction](./interaction) | Prompt bubble when the player is within range |
| [Animation](./animation) | Authored slide or hinge motion of GLB nodes |
| [Point light](./point-light) | Omnidirectional light source |
| [Area light](./area-light) | Rectangular soft panel light |
| [Spot light](./spot-light) | Directional cone beam |

### Station

| Component | Summary |
| --- | --- |
| [Station frame](./station-frame) | Orbital placement origin (auto on save) |
| [Spawn point](./spawn-point) | Player spawn location and facing |
| [Elevator](./elevator) | Floor-to-floor travel between paired markers |
| [Hangar pad](./hangar-pad) | Ship parking spot inside a hangar |
| [AVMS terminal](./avms-terminal) | Opens the vehicle management UI |
| [Weapon Shop](./weapon-shop) | Gaze + F vendor screen — buy weapons for ARC |
| [Outfitters](./outfitters) | Gaze + F vendor screen — buy backpacks / gear for ARC |

→ Workflow details in [Station authoring](../station-authoring)

### Prop and item

| Component | Summary |
| --- | --- |
| [Prop frame](./prop-frame) | Placement origin for hangar decorations |
| [Item frame](./item-frame) | Origin for world pickup/drop visuals |

→ [Props and items](../props-and-items)

### Ship

| Component | Summary |
| --- | --- |
| [Ship frame](./ship-frame) | Flight body anchor (auto on save) |
| [Ship controller](./ship-controller) | Singleton hull wiring — stats, gear, ramp, doors, seats |
| [Ship door](./ship-door) | F-key articulated door / cubby (radial or raycast) |
| [Bed](./bed) | F-key bunk — lie down, head look, Hold Y to get up (no flight) |
| [Entertainment System](./entertainment-system) | Bunk mini-TV — gaze + F opens Docs / YouTube launcher |
| [Cockpit Stat](./cockpit-stat) | Always-on pilot instrument (speed number + bar; boost-aware) |
| [Collider](./collider) | Deck floors, ramp, doors, hull blocking |

→ Workflow details in [Ship authoring](../ship-authoring)

## Collider placement paths

Where a new `collider` lands depends on context:

| Context | Destination |
| --- | --- |
| GLB sub-selected | `glbNodeTransforms[].components` on that node |
| Marker component on model | New child empty with `glbAnchor` |
| Empty or model root | `entity.components` |

## Validation

On save, `parsePrefabDocument` in `schema.ts` validates every component field. Invalid documents throw with a path to the failing field — fix in the Inspector and save again.

## Extending components

To add a new component type:

1. Add the type to `PrefabComponent` in `schema.ts` with a validator
2. Register it in `component_registry.ts` (kinds, defaults, marker/singleton flags)
3. Add Inspector field editors in `panels/inspector.ts`
4. Wire runtime consumption in the appropriate `world/prefabs/*_runtime.ts` or physics module
