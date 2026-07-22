# Weapon Combat — Master checklist

**PRD:** [PRD.md](./PRD.md) · **Index:** [README.md](./README.md)

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

- [ ] Migration: ammo support + WeaponDefinition combat fields
- [ ] Client `ITEM_TYPES` includes `ammo`; catalog types include combat fields
- [ ] `purchase_inventory_item` allows stackable ammo
- [ ] Admin weapons/items UI for ammo + combat fields
- [ ] typecheck + lint clean

## Phase 02 — Weapon prefab authoring

Details: [phases/02-weapon-prefab-authoring.md](./phases/02-weapon-prefab-authoring.md)

- [ ] `muzzle-flash`, `barrel-end`, `weapon-combat` in schema + registry
- [ ] Inspector TRS markers + audio/decal DnD
- [ ] `item_runtime` collectors + validators
- [ ] Seed markers on rifle + handgun prefabs
- [ ] cc-editor component docs + index links
- [ ] typecheck + lint clean

## Phase 03 — Hitscan fire runtime

Details: [phases/03-hitscan-fire-runtime.md](./phases/03-hitscan-fire-runtime.md)

- [ ] `player/` fire policy (modes, mag, cooldown, burst) — no Three.js
- [ ] Segmented bullet-drop hitscan; world hits only
- [ ] LMB fire when firearm drawn; reload + consume-ammo API
- [ ] Fire-mode cycle binding; dry-fire event
- [ ] typecheck + lint clean

## Phase 04 — FX and combat HUD

Details: [phases/04-fx-combat-hud.md](./phases/04-fx-combat-hud.md)

- [ ] Muzzle flash at marker (pooled / short-lived)
- [ ] Fire / dry / reload SFX via `playSfx`
- [ ] Pooled world hit decals
- [ ] Mag / reserve / fire-mode HUD (event-driven)
- [ ] typecheck + lint clean

## Phase 05 — Shop seed and docs polish

Details: [phases/05-shop-seed-docs.md](./phases/05-shop-seed-docs.md)

- [ ] Seed ammo SKUs; wire demo weapons’ `ammoItemDefinitionId` + modes
- [ ] Weapon shop lists/sells ammo
- [ ] weapon-shop + play docs; roadmap Phase III checkboxes
- [ ] typecheck + lint clean

---

## Product acceptance (from PRD)

- [ ] Authors set muzzle/barrel + audio/decal on weapon prefabs
- [ ] Admin creates ammo and configures weapon combat fields
- [ ] Player buys ammo at weapon shop and reloads
- [ ] LMB fires with modes; world hit + drop; decal; no entity damage required
- [ ] Combat HUD shows mag, reserve, fire mode while drawn
- [ ] `player/` fire policy has no Three.js/DOM imports
- [ ] lint / typecheck clean per phase
