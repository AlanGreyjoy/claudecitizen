---
sidebar_position: 42
title: Ship controller
description: Singleton ship wiring on the hull entity.
---

# Ship controller

One **ship-controller** singleton on the hull GLB entity replaces the older scattered ship components (`ship-stats`, `ship-gear`, `ship-ramp`, `ship-door`, `pilot-seat`, `ramp-interact`, `ramp-mount`, `ship-walk-zone`).

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## What it owns

- **restHeight** — parked height above ground
- **stats** — max speed, HP, shields, regen
- **gear.nodes[]** — landing gear hinge bindings
- **ramp** — hinge + outside/deck interact entity ids
- **doors[]** — GLB node motion + interact entity id
- **seats[]** — role, entity id, eye/stand offsets
- **cameraBounds[]** — interior camera clamp volumes
- **deckSpawnEntityId** — optional spawn marker

## Child empties

Place transform-only child entities for interact spots (`ramp-button-outside`, `door-cockpit`, `pilot-seat`, …) and reference them by **entity id** in the controller. Drag them with the gizmo; no per-marker components needed.

## Walking

Deck movement uses **collider** components on the hull (box floors, mesh ramp/doors). Walk zones are no longer required for new ships.

## See also

- [Ship authoring](../ship-authoring)
- [Collider](./collider)
