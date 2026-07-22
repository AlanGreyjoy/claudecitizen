# Phase 04 — FX and combat HUD

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
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

- [ ] Spawn/show flash at `muzzle-flash` world position/orientation for a short duration (or one-shot particle).
- [ ] Pool or hard-limit concurrent flashes (e.g. 1–2 per local player).
- [ ] If marker missing, skip flash (still allow fire from barrel-end).
- [ ] Keep GPU cost trivial — no new full particle-system authoring requirement unless reusing existing particle helpers is easy.

### Audio

- [ ] On shot: `playSfx(fireSoundUrl)` if set.
- [ ] On dry-fire: `dryFireSoundUrl`.
- [ ] On reload start/end: `reloadSoundUrl` (pick one moment; document).
- [ ] Missing URL → silent (no throw).

### Hit decals

- [ ] On world hit: place a small decal quad (or projected stamp) at point with normal alignment.
- [ ] Texture from active weapon’s `hitDecalUrl`; if null, use a single bundled default under **non-protected** public path, or skip drawing until authored.
- [ ] **Pool cap** (e.g. 32–64); recycle oldest; `dispose` safely on session teardown.
- [ ] Do not spawn decals for sky/misses.

### Combat HUD

- [ ] While firearm drawn: show `roundsInMag / magazineSize` (or `roundsInMag | reserve`), and current fire mode label (`AUTO`, `BURST`, `SEMI`, `BOLT`).
- [ ] Hide when holstered / unarmed / sword.
- [ ] Update on fire, reload, mode cycle, inventory refresh — **event-driven**, not reallocating HUD DOM every frame.
- [ ] Integrate visually with existing `#weapon-crosshair` / personal inventory weapon bar patterns.

### Wiring

- [ ] `game_loop` (or play_session) subscribes to fire module events once per frame tick without allocating closures that churn.
- [ ] Ensure menus / weapon shop open suppress fire (already likely via pointer lock / UI gates — verify).

## Acceptance criteria

- [ ] Firing shows a muzzle flash near the barrel and plays fire SFX when URLs are set.
- [ ] Hitting a wall/floor/terrain leaves a recycled hit decal.
- [ ] HUD shows mag + reserve + mode while drawn; updates on shoot/reload/mode change.
- [ ] Decal pool never grows without bound during sustained auto fire.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Entity blood/hit FX.
- Weapon shop ammo merchandising (phase 05).
- New animation clips for fire/reload (optional later; not required for MVP acceptance).

## Implementation notes

- UI stays out of the render hot path: mutate text nodes on events.
- Prefer CSS HUD over world-space text for ammo counters.
- If hit-decal projection on terrain is hard, start with station/ship mesh hits and add terrain in the same phase if feasible — still world-only.
- Do not import domain mutation into `render/`; pass immutable event payloads.
