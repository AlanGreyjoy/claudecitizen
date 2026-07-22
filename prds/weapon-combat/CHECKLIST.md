# Weapon Combat — Master checklist

**PRD:** [PRD.md](./PRD.md) · **Index:** [README.md](./README.md)

**Status:** All five phases are implemented and migrations 16–17 are applied. Product acceptance remains open until the user-owned editor and signed-in gameplay QA pass.

## New chat prompt (paste this)

```
Implement the next unfinished phase of the ClaudeCitizen Weapon Combat feature.

Read these first (in order):
1. prds/weapon-combat/README.md
2. prds/weapon-combat/PRD.md
3. prds/weapon-combat/CHECKLIST.md — find the first phase with open items
4. That phase file under prds/weapon-combat/phases/

Follow AGENTS.md. Do not start dev servers. After multi-file work, run npm run lint (and npm run typecheck before any commit I request).

Locked decisions are in the PRD — do not reopen: third-person OTS only (no FP camera), world-geometry hits only (no player/NPC/mob damage), hitscan+bullet drop (no projectile entities), client-local mag + server ammo stacks, authoring split (prefab spatial/FX vs catalog balance), or itemType ammo sold at the weapon shop.

When you finish a phase, check off items in CHECKLIST.md and the phase file.
```

---

## Phase 01 — Ammo and weapon catalog

Details: [phases/01-ammo-weapon-catalog.md](./phases/01-ammo-weapon-catalog.md)

- [x] Migration: ammo support + WeaponDefinition combat fields
- [x] Client `ITEM_TYPES` includes `ammo`; catalog types include combat fields
- [x] `purchase_inventory_item` allows stackable ammo
- [x] Admin weapons/items UI for ammo + combat fields
- [x] typecheck + lint clean

## Phase 02 — Weapon prefab authoring

Details: [phases/02-weapon-prefab-authoring.md](./phases/02-weapon-prefab-authoring.md)

- [x] `muzzle-flash`, `barrel-end`, `weapon-combat` in schema + registry
- [x] Inspector TRS markers + audio/decal DnD
- [x] `item_runtime` collectors + validators
- [x] Seed markers on rifle + handgun prefabs
- [x] cc-editor component docs + index links
- [x] typecheck + lint clean

## Phase 03 — Hitscan fire runtime

Details: [phases/03-hitscan-fire-runtime.md](./phases/03-hitscan-fire-runtime.md)

- [x] `player/` fire policy (modes, mag, cooldown, burst) — no Three.js
- [x] Segmented bullet-drop hitscan; world hits only
- [x] LMB fire when firearm drawn; reload + consume-ammo API
- [x] Fire-mode cycle binding; dry-fire event
- [x] typecheck + lint clean

## Phase 04 — FX and combat HUD

Details: [phases/04-fx-combat-hud.md](./phases/04-fx-combat-hud.md)

- [x] Muzzle flash at marker (pooled / short-lived)
- [x] Fire / dry / reload SFX via `playSfx`
- [x] Pooled world hit decals
- [x] Mag / reserve / fire-mode HUD (event-driven)
- [x] typecheck + lint clean

## Phase 05 — Shop seed and docs polish

Details: [phases/05-shop-seed-docs.md](./phases/05-shop-seed-docs.md)

- [x] Seed ammo SKUs; wire demo weapons’ `ammoItemDefinitionId` + modes
- [x] Weapon shop lists/sells ammo
- [x] weapon-shop + play docs; roadmap Phase III checkboxes
- [x] typecheck + lint clean

---

## Product acceptance (from PRD)

- [ ] Authors set muzzle/barrel + audio/decal on weapon prefabs
- [ ] Admin creates ammo and configures weapon combat fields
- [ ] Player buys ammo at weapon shop and reloads
- [ ] LMB fires with modes; world hit + drop; decal; no entity damage required
- [ ] Combat HUD shows mag, reserve, fire mode while drawn
- [x] `player/` fire policy has no Three.js/DOM imports
- [x] lint / typecheck clean per phase
