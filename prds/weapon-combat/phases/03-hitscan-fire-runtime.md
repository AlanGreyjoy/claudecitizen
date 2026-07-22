# Phase 03 — Hitscan fire runtime

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 01 (catalog fields), Phase 02 (barrel-end pose)  
**Unlocks:** Phase 04 (fire events → FX/HUD)

## Objective

Wire **LMB fire** for drawn rifles/handguns: fire-mode cadence, session-local magazine, reload from server-backed ammo stacks, and **hitscan with bullet drop** against **world geometry only** (no entity damage).

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/player/weapon_fire.ts` (or `src/player/combat/…`) | **Add** — pure fire policy: modes, cooldown, mag, burst state, shot requests |
| `src/player/weapon_ballistics.ts` (optional split) | **Add** — pure path sampling for gravity-bent hitscan segments (no Three.js) |
| `src/net/api.ts` | **Extend** — reload / consume-ammo API helper |
| `backend/crates/server/src/game.rs` + `main.rs` | **Extend** — decrement ammo stack endpoint (or generalize consume) |
| `src/app/player_controls.ts` | **Extend** — fire / reload / fire-mode cycle actions without breaking cockpit click |
| `src/app/game_loop.ts` | **Wire** — when firearm drawn, drive fire tick; resolve hits via world adapters |
| Physics / render hit adapters | **Extend** — station/ship Rapier rays and terrain hit as needed |
| `src/player/inventory/types.ts` / play session inventory hooks | **Wire** — reserve counts for reload eligibility |

## Tasks

### Domain fire policy (`player/`)

- [ ] Module with **no** `three` / DOM imports.
- [ ] State: active weapon def + prefab combat specs handle, `roundsInMag`, `fireModeIndex`, cooldowns, burst remainder, reload flag.
- [ ] On draw: fill mag from `magazineSize` for session (or start empty — **default: start full** for feel; document choice).
- [ ] Fire modes:
  - `single` — one shot per press edge.
  - `bolt` — one shot per press; longer cooldown / bolt delay after shot.
  - `burst3` — up to 3 shots on press at RPM spacing; stop early if mag empty.
  - `auto` — while held, fire at RPM while mag has rounds.
- [ ] Cycle fire mode among weapon’s enabled `fireModes` (default key **B**; confirm in `player_controls` bindings list / docs).
- [ ] Dry-fire event when trigger pulled with empty mag (phase 04 plays SFX).
- [ ] Emit shot events: `{ origin, direction or path samples, weaponId, … }` for app/render consumers.

### Ballistics

- [ ] From barrel-end world position + bore forward, integrate velocity with `bulletGravityMps2` along world up.
- [ ] Sample path into **bounded segments** (cap segment count / length); raycast each segment until hit or `maxRangeMeters`.
- [ ] No projectile entities; no per-frame forever trails.
- [ ] Hit result: point, normal, surface kind (`terrain` \| `station` \| `ship` \| `other`) — **no damage application**.

### World hit resolution

- [ ] Query station static world when on foot in station; ship collider world when on ship pad/deck; terrain when outdoors.
- [ ] Do **not** apply damage to players/NPCs/mobs. Prefer skipping character colliders entirely for MVP.
- [ ] Self-hit: ignore local player capsule.

### Input

- [ ] When firearm drawn and not blocked by UI/menus: LMB → fire policy (`primaryClick` press/hold as modes require).
- [ ] Do not steal cockpit control activation incorrectly — gate: weapon drawn ⇒ firearm fire; else existing cockpit behavior.
- [ ] Reload key (default **R** if free; otherwise choose and document) → request reload.

### Reload + server ammo

- [ ] Reload: if reserve (`itemQuantity` of `ammoItemDefinitionId`) > 0 and mag not full, start reload (timed or instant MVP — **prefer short timed reload** using a constant or weapon field; if no reload-time column yet, use a client constant e.g. 1.5s and note follow-up).
- [ ] On reload complete: fill mag up to `magazineSize`, consuming N rounds from inventory via server API.
- [ ] API: e.g. `POST /game/inventory/consume-ammo` `{ itemDefinitionId, quantity }` → updated inventory; reject if insufficient.
- [ ] Optimistic local reserve optional; always reconcile from response.

### Game loop wiring

- [ ] Tick fire state with `dt`.
- [ ] Resolve barrel-end / muzzle world matrices from equipped drawn weapon attach (equipment_attach / avatar).
- [ ] Collect hit results for phase 04 FX (queue or callback). Ensure **no** heavy sync work beyond one path per shot.

## Acceptance criteria

- [ ] Drawn rifle/handgun with ammo configured: LMB fires in each enabled mode with correct cadence.
- [ ] Empty mag dry-fires; reload consumes inventory ammo and refills mag.
- [ ] Shots that hit station walls / terrain produce a hit result (decals in phase 04).
- [ ] No damage to NPCs/players required or implemented.
- [ ] `player/` fire modules have no Three.js/DOM imports.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Muzzle flash meshes, decal rendering, HUD numbers (phase 04).
- Weapon shop ammo tab (phase 05).
- Entity combat / health.
- Mag persistence across logout.

## Implementation notes

- Performance: preallocate segment buffers; pool ray directions; one shot ⇒ one path eval.
- Bolt vs single: both semi-auto; bolt uses longer post-shot delay (authorable later; constant OK in MVP).
- Swords: no ammo id → fire module idle.
- Mirror how consumable `consume` returns `{ inventory }` for client refresh patterns in `play_session.ts` / inventory HUD.
