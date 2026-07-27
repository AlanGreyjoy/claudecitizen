---
sidebar_position: 42
title: Ship controller
description: Singleton ship wiring on the hull entity.
---

# Ship controller

One **ship-controller** singleton on the hull GLB entity replaces the older scattered ship components (`ship-stats`, `ship-gear`, `ship-ramp`, `ship-hull`, `pilot-seat`, `ramp-interact`). Prefer separate **[Ship door](./ship-door)** markers for articulated doors; the controller's `doors[]` list remains for legacy wiring.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## What it owns

- **restHeight** — parked height above ground (viewport shows a cyan pad disc at local Y = −restHeight; amber dashed = auto from hull lowest point)
- **stats** — combat + flight tuning (see below)
- **gear.nodes[]** — landing gear hinge bindings
- **gear.deploySoundUrl / retractSoundUrl** — optional landing-gear SFX
- **ramp** — hinge + outside/deck interact entity ids
- **ramp.openSoundUrl / closeSoundUrl** — optional cargo-ramp SFX
- **doors[]** — legacy GLB node motion + interact entity id (prefer Ship Door markers)
- **seats[]** — role, entity id, eye/stand offsets
- **cameraBounds[]** — interior camera clamp volumes
- **deckSpawnEntityId** — optional spawn marker
- **entry** — `interior` (default) or `exterior`; see [Entry mode](#entry-mode)

Ramp / gear SFX play on intentional toggles (F interact, cockpit gaze click, sandbox **G** for gear). Auto-closing the ramp when taking off does not play audio.

## Flight stats

Mass-scaled thrusters (Star Citizen–style IFCS). Acceleration ≈ thrust / mass; turn rate lags on heavy hulls.

| Field | Unit | Role |
| --- | --- | --- |
| `maxSpeedMps` | m/s | Hard speed cap |
| `massKg` | kg | Inertia; capital ships use much higher values |
| `maxAngularRateRadps` | rad/s | Max \|ω\| (max rotation) |
| `forwardThrustN` | N | Nose thruster |
| `backwardThrustN` | N | Reverse thruster |
| `verticalThrustN` | N | Lift / descend |
| `lateralThrustN` | N | Strafe |
| `pitchTorqueNm` / `yawTorqueNm` / `rollTorqueNm` | N·m | Angular thrusters |
| `thrustFovForwardDeg` | deg | Cockpit FOV widen at full forward thrust (default 5) |
| `thrustFovBackwardDeg` | deg | Cockpit FOV narrow at full reverse (default 3.5) |
| `thrustFovBlendPerSec` | 1/s | FOV lerp speed (default 8) |
| `boostShakeAmplitudeM` | m | Cockpit eye shake while boosting (default 0.015; 0 = off) |
| `boostShakeHz` | Hz | Boost shake frequency (default 20) |
| `boostBlendPerSec` | 1/s | Boost SFX / shake / HUD fade in-out (default 4.5) |
| `boostSoundUrl` | audio asset | Looping SFX while **Shift** boost is held (drag from asset browser) |
| `boostSoundVolume` | 0..1 | Boost SFX gain (default 1) |
| `thrustSoundUrl` | audio asset | Looping SFX on any translational thrust (W/S, A/D, Space/C); volume fades with input (drag from asset browser) |
| `thrustSoundVolume` | 0..1 | Thrust SFX gain (default 1) |
| `maxHp` / `maxShields` / `shieldRegenPerSec` | — | Combat vitals |

Ship tab **Test** (Pad or Planet) and main Play both use these values. Toggle **coupled / decoupled** with **Alt+C** while flying. Camera feel applies in cockpit view only (not external chase cam).

## Child empties

Place transform-only child entities for interact spots (`ramp-button-outside`, `door-cockpit`, `pilot-seat`, …) and reference them by **entity id** in the controller. Drag them with the gizmo; no per-marker components needed.

### Seats

A seat is an empty registered in `seats[]`. The empty is the seated character's **root**, and the avatar renders its model with the feet on that origin — so the marker belongs **on the deck under the chair, not on the cushion**.

| Field | Meaning |
| --- | --- |
| Marker position | Character root — floor level under the seat |
| `role` | `pilot` flies; `copilot` / `turret` / `passenger` are seated only |
| `eye` | Offset from the marker to the cockpit camera (scene axes; default `0, 0.87, 0.25`) |
| `stand` | Get-up spot beside the chair (scene XZ; default `0, −1.55`) |
| `interactRadius` | Reach for the "take the seat" prompt (default 1.45) |

:::caution Tune first-person with `eye`, not the marker

Raising the marker to make the cockpit view feel right lifts the **whole body** with it — the character ends up floating above the chair and the sitting animation reads as sitting on top of the seat. The marker only sets where the body goes. Put it on the floor, then raise `eye.y` until the view sits where you want it.

:::

### Seat gizmos

The referenced empty carries no component of its own, so the viewport draws its gizmo from the controller reference — it appears the moment you drop the empty into the seat list, and disappears when you remove it.

| Part | Meaning |
| --- | --- |
| Flat disc + ring at the marker | Character root; keep this on the deck |
| Sphere at the top of the stem | The `eye` point — where the cockpit camera lands |
| Stem | The `eye` offset you are authoring |
| Flat ring off to the side | `stand` — get-up spot |

Colour follows the role: **pilot** green, **copilot** blue, **turret** orange, **passenger** grey. Drag the empty with the gizmo and the whole seat marker follows.

## Entry mode

`entry` decides how the player reaches the pilot seat.

| Value | Behaviour |
| --- | --- |
| `interior` (default) | Board the ramp, walk the deck in ship-local Rapier, sit. Needs deck colliders and a deck spawn hint. |
| `exterior` | No walkable interior. Stand on the ground beside the parked hull inside a **[Ship entry](./ship-entry)** circle and press **F** to take the pilot seat; leaving the seat steps you back onto the ground. |

Use `exterior` for open-frame hulls — hovercraft, buggies, single-seat fighters — anything the player never walks around inside. It changes what the Ship tab validates: the "no deck colliders" and "no deck spawn hint" blockers disappear, and a **pilot-role seat becomes required** instead (there is no deck to fall back to).

`exterior` skips deck Rapier entirely, so ramp and door colliders are never consulted for locomotion. Gear, ramp, and door *animation* still play.

## Walking

Deck movement uses **collider** components on the hull (box floors, mesh ramp/doors). Walk zones are no longer required for new ships. Exterior-entry ships skip this entirely.

## See also

- [Ship authoring](../ship-authoring)
- [Ship entry](./ship-entry)
- [Collider](./collider)
