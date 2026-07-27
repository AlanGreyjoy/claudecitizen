---
sidebar_position: 8
title: Ship authoring
description: Ship Editor mode — hull controller, colliders, doors, seats, ramp, and gear.
---

# Ship authoring

Ship prefabs (`kind: "ship"`) define flyable vessels — the same ship the player boards and pilots. Most have on-foot interiors; open-frame hulls do not (see [Exterior-entry ships](#exterior-entry-ships)).

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
4. Place child empties for ramp buttons, door interact, pilot seat — wire their entity ids in the controller. **Seat empties go on the deck under the chair, not on the cushion** — see [Seats](./components/ship-controller#seats); tune first-person height with the seat's `eye`, not by raising the marker
5. Drill into the GLB → sub-select walk surfaces and doors → add **mesh** colliders per node (`RampParent`, interior floors, `CockpitDoor_L` / `CockpitDoor_R`, …)
6. Set **cameraBounds** in the controller for interior camera clamp and ramp dismount detection (not walk floors — those are mesh colliders on GLB nodes)
7. Save and press **Play**

## Exterior-entry ships

Not every ship has an inside. A hovercraft, a buggy, an open-frame fighter with four exposed seats — the player never walks around in those, they climb straight into the seat from the ground. Authoring them as interior ships is a dead end: with no deck colliders there is nothing to walk on, so there is no way in at all, and the Ship tab flags the missing colliders as a blocker.

Set **Entry** to `Exterior` on the hull's [Ship controller](./components/ship-controller#entry-mode) instead. Then:

- Deck Rapier is never created. No deck colliders, no deck spawn hint, no ramp walking.
- Stand on the ground beside the parked hull inside a **[Ship entry](./components/ship-entry)** circle → **F** takes the pilot seat.
- **Hold Y** steps you back out onto the ground at the same circle, facing away from the hull — planet surface or hangar floor, whichever the ship is parked on. You must land first; mid-flight it refuses rather than dropping you into air.
- A **pilot**-role seat becomes mandatory (there is no deck to fall back to), and the "no deck colliders" / "no deck spawn hint" blockers no longer apply.
- With no Ship Entry marker placed, one circle is synthesised at the pilot seat's ground projection so the hull is testable immediately.

Authoring an open-frame hull, start to finish:

1. Hull GLB at origin with **ship-controller**; set **Entry** to `Exterior`
2. Set **restHeight** to the parked ground clearance — the board circle is matched against that band
3. Add a child empty per seat; register them in the controller's seat list with roles (**one must be `pilot`**)
4. Add an Empty on the ground beside the hull → component **Ship Entry** → radius ≈ 3
5. Save, **Test** on Pad, walk up, **F** to board, **hold Y** to step off

Colliders are still worth adding on an exterior-entry hull for camera occlusion and weapon hits — they simply do not create a walkable deck.

## Ship test

Use the **Ship** tab **Test** control:

| Env | What it boots | Use it for |
| --- | --- | --- |
| **Pad** | Isolated flat pad, no terrain or station | Deck colliders, doors, ramp, seats, flight feel — fastest loop |
| **Planet** | Full stage scene on the active planet | Landing clamp, walking off the ship onto the surface |

Exterior-entry ships boot the same way, minus the deck: you spawn on the pad and board with **F** from the ground.

Both spawn you **on foot beside the ship with the ramp already down**. `F6`
starts and stops; `F7` pauses. Verify:

- Walk all deck collider floors
- Board via lowered ramp (step onto ramp collider)
- Toggle ramp with **F** at outside/deck interact spots
- Open/close every door
- Take the pilot seat (cockpit camera from seat `eye` offset)
- Toggle landing gear (**G**)

Press `F6` again (or **Stop**) to leave Play mode — the editor window and the open
document are untouched.

## Legacy prefabs

Older ships may still use scattered components (`pilot-seat`, `ship-gear`, …). Prefer migrating to **ship-controller**. `ship-door` remains the active door component.

## Fallback behavior

If the ship prefab is missing at runtime, the game falls back to a hardcoded Starhopper layout. Always ship a complete prefab for production ships.
