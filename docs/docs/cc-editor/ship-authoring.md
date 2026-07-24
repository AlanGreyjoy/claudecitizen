---
sidebar_position: 8
title: Ship authoring
description: Ship Editor mode — hull controller, colliders, doors, seats, ramp, and gear.
---

# Ship authoring

Ship prefabs (`kind: "ship"`) define flyable vessels with on-foot interiors — the same ship the player boards, walks inside, and pilots.

The tracked default is `phobos-starhopper`.

## Ship Editor mode

When the prefab kind is `ship`:

- Toolbar shows a **SHIP EDITOR** chip
- Component palette narrows to ship types
- Viewport toolbar gains **Gear**, **Ramp**, and per-door toggle buttons

### Auto-detect from GLB drop

Dragging a GLB from a path containing `/ships/` prompts:

> Create as ship prefab?

Confirming switches kind to `ship`, suggests the model name as the prefab id, and tags the hull entity with **ship-controller** (if no hull exists yet). The hull entity is moved to **0, 0, 0**.

## Core ship components

### ship-controller (singleton on hull)

One wiring panel on the hull GLB entity. See [Ship controller](./components/ship-controller).

- **stats**, **gear**, **ramp**, **doors[]**, **seats[]**
- Child empties referenced by **entity id** for interact spots (ramp buttons, door panel, pilot seat)
- Prefer **Ship Door** / **Bed** marker empties for doors and bunks (not only controller arrays)
- **cameraBounds[]** for interior third-person camera clamping

### collider (on GLB nodes)

Deck walking uses mesh colliders on individual GLB nodes — not on the hull entity root.

- Drill into the hull GLB and **sub-select** a node (e.g. `RampParent`, interior floor meshes, `CockpitDoor_L`)
- Add **Collider** → defaults to `shape: "mesh"` on that node's override
- Animated parts (ramp, doors) pick up rig motion automatically when the node name matches **ship-controller** bindings

The hull entity with **ship-controller** should not carry walk colliders; the editor hides **Collider** from the hull palette until a GLB node is sub-selected.

Deck walking uses Rapier hull/ramp colliders — no separate walk-zone components.

### ship-frame (singleton on root)

Marks the prefab origin the flight body anchors to (auto-added on save).

## GLB node names

Door, gear, and ramp bindings in **ship-controller** reference **exact GLB node names**.

Find names via:

```bash
node scripts/inspect_glb.mjs <path-to.glb>
```

Or in the ship sandbox console:

```js
window.__claudecitizenShipModel.listNodeNames()
```

## Authoring workflow

1. Drop or place the hull GLB — confirm ship prefab creation
2. Verify hull at origin with **ship-controller** only on the hull entity
3. Tune ramp hinge **lowerRadians**, gear nodes, stats in the controller
4. Place child empties for ramp buttons, door interact, pilot seat — wire their entity ids in the controller
5. Drill into the GLB → sub-select walk surfaces and doors → add **mesh** colliders per node (`RampParent`, interior floors, `CockpitDoor_L` / `CockpitDoor_R`, …)
6. Set **cameraBounds** in the controller for interior camera clamp and ramp dismount detection (not walk floors — those are mesh colliders on GLB nodes)
7. Save and press **Play**

## Ship sandbox

```text
http://localhost:4173/?shipPrefab=<prefab-id>
```

Isolated flat pad — no planet or station. Verify:

- Walk all deck collider floors
- Board via lowered ramp (step onto ramp collider)
- Toggle ramp with **F** at outside/deck interact spots
- Open/close every door
- Take the pilot seat (cockpit camera from seat `eye` offset)
- Toggle landing gear (**G** in sandbox)

**Back to Editor** returns to `/?boot=editor&prefab=<id>`.

## Legacy prefabs

Older ships may still use scattered components (`ship-door`, `pilot-seat`, …). Prefer migrating to **ship-controller**.

## Fallback behavior

If the ship prefab is missing at runtime, the game falls back to a hardcoded Starhopper layout. Always ship a complete prefab for production ships.
