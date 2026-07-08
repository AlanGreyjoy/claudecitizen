---
sidebar_position: 8
title: Ship authoring
description: Ship Editor mode — hull, walk zones, doors, seats, ramp, and gear.
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

Confirming switches kind to `ship`, suggests the model name as the prefab id, and tags the entity with `ship-hull` (if no hull exists yet). The hull entity is moved to **0, 0, 0**.

## Core ship components

### ship-hull (singleton)

Marks which entity's GLB is the flyable hull. **One per prefab**, positioned at the origin.

Optional `restHeight` — parked height above ground in meters. When unset, previews rest the hull's lowest point on the pad automatically.

### ship-stats (singleton)

Combat and flight tuning on the root (alongside `ship-frame`):

- `maxSpeedMps`, `maxHp`, `maxShields`, `shieldRegenPerSec`

These can also be overridden by server-side ship definitions in the [Admin App](/admin-app/ship-definitions).

### ship-gear (singleton)

Landing gear hinge bindings — GLB `nodes` with `deployRadians` per leg. Omit to use Starhopper defaults.

Preview with the toolbar **Gear** toggle.

### ship-ramp (singleton)

Boarding ramp hinge — `node`, `lowerRadians`, optional axis. Omit for Starhopper defaults.

Preview with the toolbar **Ramp** toggle.

### ship-walk-zone

Walkable deck volume as a local **XZ rectangle**; entity **Y** sets floor height.

| Field | Meaning |
| --- | --- |
| `zoneId` | Unique room id (`cabin`, `cockpit`, …) |
| `min` / `max` | Local XZ bounds |
| `height` | Camera containment above floor (default 3.1 m) |
| `slopeMinUp` | Floor delta at min-Z edge for ramps |
| `gate` | `"ramp"` or `{ doorId }` — zone only walkable when gate is open |
| `passage` | Doorway connector between rooms |

Rotate the marker entity to tilt ramps and passages.

### ship-door

Articulated door bound to GLB nodes:

- `motion`: `slide` (meters) or `hinge` (radians)
- `nodes[]`: GLB names + signed open delta
- Entity position = F-interact spot
- `radius` = interact distance

Walk zones can `gate` on a door id. Preview open/close from the viewport toolbar.

### pilot-seat

Seat marker — set `role` to `pilot` for flight controls.

| Field | Meaning |
| --- | --- |
| `eye` | Cockpit camera offset from seat |
| `stand` | Stand-up position offset (XZ) |
| `interactRadius` | F-key interact range |

### ship-stairs / ship-ladder

Vertical movement between decks:

- **stairs** variant — discrete treads with `stepCount` and `riseUp`
- **ladder** variant — smooth climb; press F at foot/head

### ramp-interact + ramp-mount

- **ramp-interact** — prompt to raise/lower ramp (`outside` at ground or `deck` panel)
- **ramp-mount** (singleton) — ground XZ strip where walking in steps onto the lowered ramp

## GLB node names

Door, gear, and ramp bindings reference **exact GLB node names**.

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
2. Verify hull at origin with `ship-hull`
3. Add `ship-stats`, `ship-gear`, `ship-ramp` on root
4. Place `ship-walk-zone` markers for each deck room
5. Add `ship-door` markers at doorways; bind GLB nodes
6. Place `pilot-seat` in the cockpit (`role: "pilot"`)
7. Add `ramp-interact` (outside) and `ramp-mount` at the boarding area
8. Add colliders on hull details that should block the character
9. Save and **Preview Ship**

## Ship sandbox

```text
http://localhost:4173/?shipPrefab=<prefab-id>
```

Isolated flat pad — no planet or station. Verify:

- Walk all deck zones
- Board via ramp (`F` to toggle ramp in sandbox)
- Open/close every door
- Take the pilot seat (cockpit camera from `pilot-seat.eye`)
- Toggle landing gear (**G** in sandbox)

**Back to Editor** returns to `/?boot=editor&prefab=<id>`.

## Fallback behavior

If the ship prefab is missing at runtime, the game falls back to a hardcoded Starhopper layout. Always ship a complete prefab for production ships.
