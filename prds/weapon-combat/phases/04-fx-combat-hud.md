# Phase 04 — FX and combat HUD

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Implemented — static validation complete; interactive visual/audio QA pending
**Depends on:** Phase 03 (shot + hit events)  
**Unlocks:** Phase 05 (polish / docs against working gunplay)

## Objective

Present **muzzle flash**, **fire/dry/reload SFX**, **pooled world hit decals**, and a **combat HUD** (mag / reserve / fire mode) driven by phase 03 fire events — without owning ammo truth in `render/`.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/render/effects/muzzle_flash.ts` (or under `effects/combat/`) | **Add** — short-lived flash at muzzle world pose |
| `src/render/effects/hit_decals.ts` | **Add** — pooled decals (cap N), texture from `weapon-combat.hitDecalUrl` |
| `src/render/effects/hud/combat_ammo.ts` (or extend weapon bar) | **Add** — mag, reserve, fire-mode readout |
| `index.html` / `src/ui/sc-ui.css` | **Extend** — HUD markup/styles matching existing SC HUD |
| `src/audio/sfx.ts` | **Reuse** — `playSfx` for one-shots |
| `src/app/game_loop.ts` | **Wire** — on shot/dry/reload/hit → FX + HUD update |
| Existing crosshair / weapon bar HUD | **Extend** — show combat info only while firearm drawn |

## Tasks

### Muzzle flash

- [x] Spawn/show flash at `muzzle-flash` world position/orientation for a short duration (or one-shot particle).
- [x] Pool or hard-limit concurrent flashes (2 per local player).
- [x] If marker missing, skip flash (still allow fire from barrel-end).
- [x] Keep GPU cost trivial — two crossed additive planes, not a full particle system.

### Audio

- [x] On shot: `playSfx(fireSoundUrl)` if set.
- [x] On dry-fire: `dryFireSoundUrl`.
- [x] On reload start: `reloadSoundUrl`.
- [x] Missing URL → silent (no throw).

### Hit decals

- [x] On world hit: place a small decal quad at point with normal alignment.
- [x] Texture from active weapon’s `hitDecalUrl`; null intentionally skips drawing until authored.
- [x] **Pool cap** of 48; recycle oldest; `dispose` safely on session teardown.
- [x] Do not spawn decals for sky/misses.

### Combat HUD

- [x] While firearm drawn: show magazine, reserve, and current fire mode label (`AUTO`, `BURST`, `SEMI`, `BOLT`).
- [x] Hide when holstered / unarmed / sword.
- [x] Diff updates on fire, reload, mode cycle, and inventory refresh without reallocating HUD DOM.
- [x] Integrate visually with existing `#weapon-crosshair` HUD styling.

### Wiring

- [x] `game_loop` consumes fire module events once per frame tick without allocating query closures that churn.
- [x] Menus / weapon shop suppress fire through the existing paused/input-suppressed gates.

## Acceptance criteria

- [ ] Firing shows a muzzle flash near the barrel and plays fire SFX when URLs are set.
- [ ] Hitting a wall/floor/terrain leaves a recycled hit decal.
- [ ] HUD shows mag + reserve + mode while drawn; updates on shoot/reload/mode change.
- [x] Decal pool never grows without bound during sustained auto fire.
- [x] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Entity blood/hit FX.
- Weapon shop ammo merchandising (phase 05).
- New animation clips for fire/reload (optional later; not required for MVP acceptance).

## Implementation notes

- UI stays out of the render hot path: mutate text nodes on events.
- Prefer CSS HUD over world-space text for ammo counters.
- If hit-decal projection on terrain is hard, start with station/ship mesh hits and add terrain in the same phase if feasible — still world-only.
- Do not import domain mutation into `render/`; pass immutable event payloads.
