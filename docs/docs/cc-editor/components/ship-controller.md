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
- **stats** — combat + flight tuning (see below)
- **gear.nodes[]** — landing gear hinge bindings
- **gear.deploySoundUrl / retractSoundUrl** — optional landing-gear SFX
- **ramp** — hinge + outside/deck interact entity ids
- **ramp.openSoundUrl / closeSoundUrl** — optional cargo-ramp SFX
- **doors[]** — legacy GLB node motion + interact entity id (prefer Ship Door markers)
- **seats[]** — role, entity id, eye/stand offsets
- **cameraBounds[]** — interior camera clamp volumes
- **deckSpawnEntityId** — optional spawn marker

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

Preview Ship (`?shipPrefab=`) and main play both use these values. Toggle **coupled / decoupled** with **Alt+C** while flying. Camera feel applies in cockpit view only (not external chase cam).

## Child empties

Place transform-only child entities for interact spots (`ramp-button-outside`, `door-cockpit`, `pilot-seat`, …) and reference them by **entity id** in the controller. Drag them with the gizmo; no per-marker components needed.

## Walking

Deck movement uses **collider** components on the hull (box floors, mesh ramp/doors). Walk zones are no longer required for new ships.

## See also

- [Ship authoring](../ship-authoring)
- [Collider](./collider)
