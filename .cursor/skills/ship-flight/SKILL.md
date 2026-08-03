---
name: ship-flight
description: Tune ClaudeCitizen ship flight feel — mass, thrust, torque, dual-reticle flight computer aim, coupled/decoupled, and preview testing. Use when adding or balancing ships, adjusting ship-controller flight stats, fixing pitch bounce / sensitivity, or changing flight_body / flight_aim / FLIGHT_CONFIG.
---

# Ship Flight Tuning

Flight computer: mouse aim + nose lag, mass-scaled thrust/torque. **Per-ship** feel lives on `ship-controller` stats; **global** feel lives in `FLIGHT_CONFIG`.

Architecture law (Rapier hull + flight-computer demands, modes, speeds, quantum, controls): `docs/docs/architecture/ship-flight.md`.

**Parked deck** uses ship-local Rapier (`ship-physics.ts`). **Flying hull** is world Rapier; flight computer only emits forces/torques — do not put feel tuning inside the solver, and do not extend the legacy custom pose integrator.

## Authoring (per ship)

1. Editor → ship prefab → hull entity with **Ship Controller**
2. Inspector **Stats** / **Thrust** / **Torque**
3. **Preview Ship** (`?shipPrefab=<id>`) → sit pilot → fly the pad
4. Save prefab JSON when feel is right

| Field | Unit | Effect |
| --- | --- | --- |
| `massKg` | kg | Inertia. ↑ mass → slower accel + turns (`a = F/m`, `α = τ/I`, `I ≈ mass × INERTIA_FACTOR`) |
| `maxSpeedMps` | m/s | Hard speed cap |
| `maxAngularRateRadps` | rad/s | Max \|ω\| (max rotation) |
| `forwardThrustN` / `backwardThrustN` | N | Nose / reverse |
| `verticalThrustN` / `lateralThrustN` | N | Lift / strafe |
| `pitchTorqueNm` / `yawTorqueNm` / `rollTorqueNm` | N·m | Turn authority |
| `thrustFovForwardDeg` / `thrustFovBackwardDeg` | deg | Cockpit FOV kick on thrust |
| `thrustFovBlendPerSec` | 1/s | FOV lerp speed |
| `boostShakeAmplitudeM` / `boostShakeHz` | m / Hz | Boost cockpit shake |
| `boostBlendPerSec` | 1/s | Boost SFX / shake fade in-out |
| `boostSoundUrl` / `boostSoundVolume` | asset / 0..1 | Looping boost SFX + gain |
| `thrustSoundUrl` / `thrustSoundVolume` | asset / 0..1 | Looping thrust SFX (any translation) + gain |

Starhopper reference mass: `DEFAULT_SHIP_MASS_KG = 12000` in `src/player/ship_layout.ts`.

### Class presets (starting points)

Scale from Starhopper defaults; keep thrust/torque roughly proportional to mass unless you want a sluggish capital or a hot rod.

| Class | `massKg` | Feel notes |
| --- | --- | --- |
| Fighter / racer | 8k–15k | Higher torque / max rot; keep aim-track damping healthy |
| Mid freighter | 40k–120k | Mass↑ first; bump thrust so SCM accel still usable |
| Capital | 200k–2M+ | Mass↑ a lot; modest torque → slow nose; lower `maxAngularRateRadps` |

Accel feel ≈ `thrustN / massKg`. Turn snap ≈ `torqueNm / (massKg * INERTIA_FACTOR)`.

## Controls (player)

| Input | Role |
| --- | --- |
| Mouse | Moves HUD aim cursor; flight computer turns nose toward that target (lags) |
| WASD | Forward / back / strafe |
| Space / C | Lift / descend |
| Q / E | Roll |
| Shift | Boost |
| B | Brake |
| Alt+C | Coupled ↔ decoupled |
| Hold F | Cockpit free-look (camera only) |
| Hold F + look + LMB | Activate gazed cockpit control (gear / ramp) |
| Hold Y | Exit seat / walk deck (anytime; settles on pad when nearby) |

### Cockpit look-at controls

Cockpit panel prompts while free-looking:

1. Prefab editor → **Add Empty** near a cockpit switch
2. Add **Cockpit Control** (`landing-gear` or `cargo-ramp`)
3. In play/preview: sit pilot → **Hold F** → look at the marker → **left-click**

Baked into `ShipLayout.cockpitControls` via `ship_runtime.ts`. Gaze pick: `player/cockpit_gaze.ts`. HUD: `cockpit_gaze_hud.ts`.

### Cockpit instruments

Always-on pilot readouts (not clickable):

1. Prefab editor → **Add Empty** on the dash
2. Add **Cockpit Stat** (`kind: speed`)
3. Sit pilot → see speed number + bar; **Shift** boost raises the speed cap / bar ceiling

Baked into `ShipLayout.cockpitStats`. HUD: `cockpit_speed_hud.ts`. Helpers: `resolveBoostMaxSpeedMps` / `resolveSpeedCapMps` in `flight_config.ts`.

Deploy/retract and ramp open/close SFX are authored on **Ship Controller** (`gear.deploySoundUrl` / `retractSoundUrl`, `ramp.openSoundUrl` / `closeSoundUrl`), not on cockpit-control markers. Playback: `player/ship_articulation_sfx.ts`.

**Coupled** (default): no thrust → velocity bleeds. **Decoupled**: newtonian drift.

**Gravity:** inside atmosphere, planet `gravityMetersPerSecond2` pulls planetward — heavier *g* makes escape harder and longer. Outside atmosphere, no planetary pull. Climb/descend with Space/C (and nose thrust) against that pull. Landing is thruster + Rapier contact. **No auto-level** — Q/E roll stays until you roll back (preview levels when exiting on the pad).

## Global knobs (`src/flight/flight_config.ts`)

Touch these when *all* ships feel wrong — not when balancing one hull.

| Knob | When |
| --- | --- |
| `AIM_MOUSE_RAD_PER_PX` | Mouse too twitchy / sluggish |
| `AIM_TRACK_GAIN` | Nose tracks aim too hard / soft |
| `AIM_TRACK_DAMPING` | Pitch/yaw **bounce** or overshoot |
| `AIM_ERROR_DEADZONE` | Micro-wobble when aligned |
| `ANGULAR_DAMPING` | General spin settle |
| `COUPLED_DAMPING` | How fast coupled kills drift |
| `INERTIA_FACTOR` | Global turn sluggishness vs mass |

## Symptom → fix

| Symptom | Fix |
| --- | --- |
| Too sensitive / twitchy | ↓ `maxAngularRateRadps`, pitch/yaw torque; or ↓ `AIM_MOUSE_RAD_PER_PX` / `AIM_TRACK_GAIN` |
| Pitch bounces after mouse leave | ↑ `AIM_TRACK_DAMPING`; ensure auto-level not fighting (already gated on pitch demand in `flight_body`) |
| Capital turns like a fighter | ↑ `massKg`, ↓ torques / max rot |
| Fighter feels like a brick | ↓ `massKg` or ↑ thrust + torques |
| Won't lift off pad | ↑ `verticalThrustN`; check grounded lift uses `GROUND_LIFT_ACCEL` |
| Drifts forever with no input | Coupled off? Toggle Alt+C; or ↑ `COUPLED_DAMPING` |
| Dual reticle missing | Pilot mode + `#flight-reticle`; see `flight_reticle.ts` |
| Saved prefab ignores new defaults | Prefab JSON still has old `stats.*` — edit inspector or clear those fields |

## Code map

| Path | Role |
| --- | --- |
| `src/world/prefabs/schema.ts` | `ship-controller` stats schema + clamps |
| `src/world/prefabs/component_registry.ts` | Default stats for new controllers |
| `src/world/prefabs/ship_runtime.ts` | Bake stats → `ShipSpec` |
| `src/player/ship_layout.ts` | `ShipSpec`, `DEFAULT_SHIP_SPEC` |
| `src/editor/panels/inspector.ts` | Stat field editors |
| `src/flight/flight_config.ts` | Global flight computer / drag / damping |
| `src/flight/flight_aim.ts` | Aim state, mouse → aim, PD flight-computer demand |
| `src/flight/flight_body.ts` | Mass/thrust/torque integrate; planet + sandbox flat |
| `src/input/player_controls.ts` | Aim persistence, Alt+C coupled |
| `src/app/ship_play_session.ts` | Preview flight |
| `src/game/modes/in_ship.ts` | Main-play flight branch (`MODE_IN_SHIP`); dual reticle HUD in `src/game/hud/frame_hud.ts` |
| `src/render/effects/hud/flight_reticle.ts` | Aim + nose pips |
| `docs/docs/cc-editor/components/ship-controller.md` | Author-facing docs |

## Workflow: new ship

```
Task Progress:
- [ ] Add ship-controller on hull; set restHeight + articulation
- [ ] Seed flight stats from class preset (mass first)
- [ ] Preview Ship → pilot → check takeoff, mouse aim settle, strafe, coupled stop
- [ ] Adjust mass / thrust / torque until class feel is right
- [ ] Only then touch FLIGHT_CONFIG if globals feel wrong
- [ ] Save prefab JSON
```

## Do not

- Put flight-computer feel math in `render/`, or import Rapier into pure `flight/` demand code
- Extend the legacy custom pose integrator — apply forces to the Rapier hull instead
- Dual-drive flying world body and parked deck world in the same frame
- Tune one ship by editing `FLIGHT_CONFIG` (breaks every hull)
- Expect admin DB `throttleAccelMps2` alone to replace full thrust/mass authoring — prefer prefab `forwardThrustN` + `massKg`

## Related

- Architecture: `docs/docs/architecture/ship-flight.md`
- Prefab editor skill: `.cursor/skills/prefab-editor/SKILL.md`
- Agent conventions: `AGENTS.md` (Rapier hull + flight-computer demands; deck vs flight worlds)
