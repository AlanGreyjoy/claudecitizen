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
- **canopy** — cockpit canopy hinge + optional SFX; exterior entry only, see [Canopy](#canopy)
- **doors[]** — legacy GLB node motion + interact entity id (prefer Ship Door markers)
- **seats[]** — which entities are seats, and their order; settings live on each marker's [Ship seat](./ship-seat) component
- **cameraBounds[]** — interior camera clamp volumes
- **deckSpawnEntityId** — optional spawn marker
- **entry** — `interior` (default) or `exterior`; see [Entry mode](#entry-mode)

Ramp / gear SFX play on intentional toggles (F interact, cockpit gaze click, sandbox **G** for gear). Auto-closing the ramp when taking off does not play audio.

## Flight stats

Mass-scaled thrusters with dual-reticle flight computer. Acceleration ≈ thrust / mass; turn rate lags on heavy hulls.

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

`seats[]` decides **which** entities are seats and in what order — the first pilot-role seat drives flight anchors. The per-seat settings live on each marker's own **[Ship seat](./ship-seat)** component, so you edit them where the gizmo is instead of hunting back through the hull's inspector.

Dropping an empty into the seat list adds a Ship Seat component to it automatically if it does not have one. Adding the component by hand also works: an unlisted `ship-seat` is adopted at bake and appended after the listed seats.

Prefabs authored before the component existed still parse — the inline `role` / `eye` / `stand` / `interactRadius` fields on each `seats[]` entry remain as a fallback, and are overridden field-by-field by the component when one is present.

## Entry mode

`entry` decides how the player reaches the pilot seat.

| Value | Behaviour |
| --- | --- |
| `interior` (default) | Board the ramp, walk the deck in ship-local Rapier, sit. Needs deck colliders and a deck spawn hint. |
| `exterior` | No walkable interior. Stand on the ground beside the parked hull inside a **[Ship entry](./ship-entry)** circle and press **F** to take the pilot seat; leaving the seat steps you back onto the ground. |

Use `exterior` for open-frame hulls — hovercraft, buggies, single-seat fighters — anything the player never walks around inside. It changes what the Ship tab validates: the "no deck colliders" and "no deck spawn hint" blockers disappear, and a **pilot-role seat becomes required** instead (there is no deck to fall back to).

`exterior` skips deck Rapier entirely, so ramp and door colliders are never consulted for locomotion. Gear, ramp, and door *animation* still play.

## Canopy

An optional flip-up cockpit canopy, driven from the pilot seat. The section only appears in the inspector when **Entry** is `exterior`, and the bake drops the canopy on `interior` hulls.

| Field | Type | Notes |
| --- | --- | --- |
| `enabled` | boolean | The inspector checkbox. Unchecking removes the whole `canopy` block |
| `hinge.node` | string | GLB node to rotate — drag it from the Hierarchy onto the field |
| `hinge.openRadians` | number | Fully-open angle, clamped to ±10 rad |
| `hinge.axis` | `x`\|`y`\|`z`? | Rotation axis, default `x` |
| `openSoundUrl` / `closeSoundUrl` | audio asset? | One-shot SFX on toggle |

Authoring: tick **Enabled**, drag the canopy node onto **Hinge**, set **Open °**, then press **Play** in the Canopy row (or the **Canopy** toolbar chip) to swing it in the viewport at the in-game rate. Clicking mid-swing reverses it.

In game the pilot toggles it while seated with the **Toggle Canopy** key (default **N**, rebindable in Controls), or by gaze-clicking a **[Cockpit control](./cockpit-control)** marker whose action is `canopy`. The canopy is animation only — it gets no collider, since exterior-entry hulls have no walkable deck to block. The open blend replicates to other players.

## Walking

Deck movement uses **collider** components on the hull (box floors, mesh ramp/doors). Walk zones are no longer required for new ships. Exterior-entry ships skip this entirely.

## See also

- [Ship authoring](../ship-authoring)
- [Ship entry](./ship-entry)
- [Collider](./collider)
