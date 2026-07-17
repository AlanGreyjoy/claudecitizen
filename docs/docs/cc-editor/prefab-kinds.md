---
sidebar_position: 4
title: Prefab kinds
description: Station, ship, site, prop, and item — when to use each prefab kind.
---

# Prefab kinds

Every saved document has a **kind** that controls which components appear in the add-component palette and how the game interprets the prefab at runtime.

Set the kind in the toolbar dropdown before authoring gameplay markers.

## Comparison

| Kind | Frame component (auto on save) | Primary use | Play preview |
| --- | --- | --- | --- |
| **station** | `station-frame` | Orbital station interiors | `?stationPrefab=<id>` |
| **ship** | `ship-frame` | Flyable player ships | `?shipPrefab=<id>` |
| **site** | _(none)_ | Surface outposts, landmarks, POIs | _(future)_ |
| **prop** | `prop-frame` | Hangar/apartment decorations | _(catalog only)_ |
| **item** | `item-frame` | Inventory item world visuals | _(catalog only)_ |

Frame components mark the prefab origin used when the game places or recenters the content.

## station

Build modular station interiors: hab, lobby, and hangar floors connected by elevators.

**Walking** uses real **collider** geometry (box and mesh colliders on walls, floors, and props) — not legacy walk-volume boxes. Place `collider` components on GLB entities and tune them to match walkable surfaces.

Gameplay markers: spawn points, elevators, hangar pads, AVMS terminals, interactions, animated doors.

→ [Station authoring](./station-authoring)

## ship

Author flyable ships with deck colliders, boarding ramp, landing gear, doors, and pilot seats.

Dropping a GLB from a `ships/` folder offers to switch into **Ship Editor** mode and auto-tag the hull.

The tracked default player ship is `phobos-starhopper`.

→ [Ship authoring](./ship-authoring)

## site

A flexible kind for **world sites** that are not stations or ships — surface structures, ruins, landing pads, mission locations.

Shares the general component palette: colliders, interactions, animations, and all three light types. No dedicated `site-frame` yet; use colliders and markers to define playable space.

Runtime integration for site prefabs is still evolving. Author content in the editor and save JSON so it is ready when world placement hooks land.

## prop

Small placeable decorations for the player **build system** (hangar and apartment instances).

Typically a single root with `prop-frame` plus a visual child (GLB or box primitive) and a matching **box collider** for placement snapping.

Examples in the repo: `hangar-crate-01`, `hangar-bench-01`, `hangar-lamp-01`.

Prop definitions in the [Admin App](/admin-app/prop-definitions) link catalog rows to these prefab ids.

→ [Props and items](./props-and-items)

## item

Compact prefabs for **inventory items** — consumables, weapons, materials.

Often minimal geometry (or icon-only with no prefab). The `item-frame` marks the origin for world drops or pickup visuals.

Item definitions in the [Admin App](/admin-app/item-definitions) reference item prefab ids when a 3D representation is needed.

→ [Props and items](./props-and-items)

## Switching kinds mid-session

Changing the kind in the toolbar immediately filters the component palette. Existing components on entities are **not** removed — validate your scene before saving if you switch kinds after placing markers.

Singleton components (frames, `ship-hull`, `pilot-seat` with pilot role, etc.) can only be added once per document.
