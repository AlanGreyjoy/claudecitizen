---
sidebar_position: 1
title: Components
description: The gameplay component system — palette, markers, colliders, lights, and interactions.
---

# Components

**Components** attach gameplay meaning to entities. They serialize into prefab JSON and are read by station, ship, and physics runtimes at load time.

The add-component palette is driven entirely by `src/world/prefabs/component-registry.ts` — filtered by the current prefab **kind**.

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

Some types allow only one per document — the frames (`station-frame`, `ship-frame`, `prop-frame`, `item-frame`) and `ship-controller`. The palette hides them once present.

## Component reference

### Shared (most kinds)

| Component | Summary |
| --- | --- |
| [Collider](./collider) | Box or mesh geometry that blocks walking characters |
| [Interaction](./interaction) | Prompt bubble when the player is within range |
| [Animation](./animation) | Authored slide or hinge motion of GLB nodes |
| [Object Animation](./object-animation) | Continuous spin or hover on an entity or GLB nodes |
| [Point light](./point-light) | Omnidirectional light source |
| [Area light](./area-light) | Rectangular soft panel light |
| [Spot light](./spot-light) | Directional cone beam |
| [Particle system](./particle-system) | Unity-style particle emitter — modules for emission, shape, velocity, color, size, trails, collision |
| [Sound](./sound) | Positional audio emitter (station and ship kinds) |

### Scene

These components only appear on scene documents, and they decide what the scene
*is*. See [Scene components](../scene-components) and [Building scenes](../building-scenes).

| Component | Summary |
| --- | --- |
| [game-manager](../scene-components#game-manager) | System, planet, spawn mode, and the entry pipeline (Title → Character Create → Starting Scene, plus Open Space and Loading) |
| [planet](../scene-components#planet) | Planet document reference |
| [player-start](../scene-components#player-start) | Spawn pose and mode |
| [prefab-instance](../scene-components#prefab-instance) | Places a reusable prefab in the scene |
| [ui-screen](../scene-components#ui-screen) | Mounts title / login / character-create / loading UI |
| [scene-link](../scene-components#scene-link) | Menu scene transition (`auto` + `delaySeconds` for timed hops) |
| [instanced-scene](../scene-components#instanced-scene) | Per-player or shared instance content (habs, hangars) |

### Station

| Component | Summary |
| --- | --- |
| [Station frame](./station-frame) | Orbital placement origin (auto on save) |
| [Spawn point](./spawn-point) | Player spawn location and facing |
| [Elevator](./elevator) | Floor-to-floor travel between paired markers |
| [Scene Exit](./scene-exit) | On-foot portal that loads another scene (hab ↔ station ↔ hangar) |
| [Exit Hangar](./exit-hangar) | Hangar → Open Space, on foot or fly-through; arrives at the owning station's mouth |
| [Enter Station](./enter-station) | Open Space → hangar; ship fly-through volume on a station body |
| [Hangar Open Space Exit](./hangar-open-space-exit) | Station mouth pose; where `exit-hangar` puts the ship |
| [Ladder](./ladder) | Climbable rail — foot marker, +Y up, +Z step-off |
| [Hangar pad](./hangar-pad) | Ship parking spot inside a hangar |
| [AVMS terminal](./avms-terminal) | Opens the vehicle management UI |
| [Weapon Shop](./weapon-shop) | Gaze + F vendor screen — buy weapons and ammo for ARC |
| [Outfitters](./outfitters) | Gaze + F vendor screen — buy backpacks / gear for ARC |
| [Food Shop](./food-shop) | Gaze + F vendor screen — buy consumable food |
| [Drinks Shop](./drinks-shop) | Gaze + F vendor screen — buy drinks |
| [Canteen](./canteen) | Gaze + F vendor — buy food and drink consumables |
| [Pharmacy](./pharmacy) | Gaze + F vendor — buy medical heal pills for ARC |

### Station NPCs

Ambient crowds use a spawner plus an undirected waypoint graph; named service
characters are placed directly. Definitions live in `src/npc/catalog.ts`.

| Component | Summary |
| --- | --- |
| [NPC spawner](./npc-spawner) | Seeds an ambient population that walks a waypoint route group or free-roams a disc |
| [NPC waypoint](./npc-waypoint) | A node in the walkable route graph |
| [NPC placement](./npc-placement) | A specific named or service character at a fixed spot |

Station NPCs are cosmetic and non-authoritative: they do not collide with the
player, hold inventory, or persist. Promote them to backend cell entities before
adding any of that.

→ Workflow details in [Station authoring](../station-authoring)

### Prop and item

| Component | Summary |
| --- | --- |
| [Prop frame](./prop-frame) | Placement origin for hangar decorations |
| [Item frame](./item-frame) | Origin for world pickup/drop visuals |
| [Equipment socket](./equipment-socket) | Named attachment point for equipped items |
| [Drawn grip](./drawn-grip) | Where the character's hands hold a drawn weapon |
| [Muzzle flash](./muzzle-flash) | Firearm flash origin; local +Z is bore forward |
| [Barrel end](./barrel-end) | Firearm shot origin and bore direction |
| [Weapon combat](./weapon-combat) | Fire/reload/dry audio and hit-decal assets |

→ [Props and items](../props-and-items)

### Ship

| Component | Summary |
| --- | --- |
| [Ship frame](./ship-frame) | Flight body anchor (auto on save) |
| [Ship controller](./ship-controller) | Singleton hull wiring — stats, gear, ramp, doors, seats |
| [Ship door](./ship-door) | F-key articulated door / cubby (radial or raycast) |
| [Ship seat](./ship-seat) | Seat marker — role, eye, stand, reach (marker = character root, not the cushion) |
| [Ship entry](./ship-entry) | Ground-level board circle for exterior-entry hulls (no deck walk) |
| [Bed](./bed) | F-key bunk — lie down, head look, Hold Y to get up (no flight) |
| [Entertainment System](./entertainment-system) | Bunk mini-TV — gaze + F opens Docs / YouTube launcher |
| [Cockpit control](./cockpit-control) | Gaze + LMB control in the cockpit (gear, ramp) while free-looking |
| [Cockpit Stat](./cockpit-stat) | Always-on pilot instrument (speed number + bar; boost-aware) |
| [Ladder](./ladder) | Climbable rail on decks |
| [Collider](./collider) | Deck floors, ramp, doors, hull blocking |

→ Workflow details in [Ship authoring](../ship-authoring)

### Legacy ship components

`ship-controller` replaced a set of separate ship components. Older prefabs still
load — the schema continues to parse these types — but they are no longer in the
add-component palette. Author new ships with `ship-controller`.

| Legacy component | Now part of |
| --- | --- |
| [Ship hull](./ship-hull), [Ship stats](./ship-stats) | `ship-controller` stats |
| [Ship gear](./ship-gear) | `ship-controller` gear nodes |
| [Ship ramp](./ship-ramp), [Ramp interact](./ramp-interact) | `ship-controller` ramp |
| [Pilot seat](./pilot-seat) | [Ship seat](./ship-seat) on the marker + `ship-controller` seat list |

## Collider placement paths

Where a new `collider` lands depends on context:

| Context | Destination |
| --- | --- |
| GLB sub-selected | `nodeOverrides[].components` on that node |
| Marker component on model | New child empty with `glbAnchor` |
| Empty or model root | `entity.components` |

## Validation

On save, `parsePrefabDocument` in `schema.ts` validates every component field. Invalid documents throw with a path to the failing field — fix in the Inspector and save again.

## Extending components

To add a new component type:

1. Add the type to `PrefabComponent` in `schema.ts` with a validator
2. Register it in `component-registry.ts` (kinds, defaults, marker/singleton flags)
3. Add Inspector field editors in `src/editor/react/panels/component_fields/`
4. Wire runtime consumption in the appropriate `world/prefabs/*-runtime.ts` or physics module
