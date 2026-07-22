# Phase 05 — Shop seed and docs polish

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phases 01–04 (gunplay works end-to-end)  
**Unlocks:** Product acceptance for the Weapon Combat pack

## Objective

Stock the **weapon shop** with purchasable **ammo**, seed catalog links so demo rifles/handguns fire with bought ammo, and update **play / editor / roadmap** docs so a cold chat and players know how gunplay works.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `backend/migrations/0017_…_ammo_seed.sql` (or extend 01 migration if not applied yet) | **Add** — seed ammo SKUs; set `ammoItemDefinitionId` on demo weapons |
| `src/render/effects/hud/weapon_shop.ts` | **Extend** — ammo section/list + buy affordances |
| `src/editor/menus/mocks.ts` / `menu_manager.ts` | **Extend** — mock ammo rows if menu preview needs them |
| `src/world/prefabs/data/demo-station.prefab.json` | **Optional** — curated `itemDefinitionIds` including ammo + weapons |
| `docs/docs/cc-editor/components/weapon-shop.md` | **Extend** — documents ammo sales |
| `docs/docs/play.md` (or equivalent play controls doc) | **Extend** — fire, reload, mode cycle, ammo HUD |
| `docs/docs/roadmap.md` | **Extend** — check off completed Phase III combat items this pack delivers |
| `docs/docs/admin-app/…` | **Extend** — ammo + weapon combat admin notes if needed |

## Tasks

### Seed data

- [ ] Insert at least two ammo definitions, e.g.:
  - `ammo-rifle-556` — `subType: rifle-556`, stackMax 120+, costArc tuned for demo.
  - `ammo-handgun-9mm` — `subType: handgun-9mm`, similar.
- [ ] Point existing demo firearms (`assault-01` weapon def, pistols, `starter-sidearm` if it should shoot) at the matching ammo id; set magazine + fire modes (rifle: single+burst3+auto; handgun: single or single+auto).
- [ ] Ensure starter grant / ARC balance still lets a new player buy a mag’s worth of ammo in playtests (tune costs).

### Weapon shop UI

- [ ] Extend `weapon_shop.ts` to list `itemType === 'ammo'` (all, or intersect `itemDefinitionIds`).
- [ ] Buying ammo uses the same `purchaseInventoryItem` path; show stack counts / Owned-at-cap like consumables.
- [ ] Keep weapons unique-Owned behavior.
- [ ] Update weapon-shop component docs: empty `itemDefinitionIds` ⇒ all weapons **and** all ammo (or document if ammo always appended — **prefer**: empty means all weapons + all ammo; non-empty is an explicit allowlist that may include both kinds).
- [ ] Editor menu mocks reflect ammo rows if the Menu Manager clones the live panel.

### Demo station

- [ ] Confirm `weapon-shop-1` sells ammo in play (empty allowlist or explicit ids).
- [ ] Manual QA owned by user — agents do not run browser QA unless asked.

### Docs + roadmap

- [ ] Play controls: draw 1–3, RMB aim, LMB fire, mode cycle key, reload key, shop buy ammo.
- [ ] Roadmap Phase III: mark equip/fire/reload/swap, muzzle/hitscan, combat HUD items appropriately (leave entity combat / online combat unchecked).
- [ ] Cross-link PRD pack from roadmap or play doc if helpful (`prds/weapon-combat/`).

## Acceptance criteria

- [ ] Signed-in player can buy ammo at the demo weapon shop and reload a seeded rifle/handgun.
- [ ] Weapon shop docs describe ammo + allowlist behavior.
- [ ] Roadmap Phase III checkboxes for this pack’s scope are updated.
- [ ] Product-level acceptance in [PRD.md](../PRD.md) §12 can be checked off.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- First-person camera, entity damage, multiplayer combat authority.
- New weapon meshes or protected audio binaries committed to git.

## Implementation notes

- If phase 01 migration not yet applied in an environment, combine seed carefully — never rewrite applied migrations; append only.
- Purchase +1 quantity per click matches food shop; if ammo “boxes” should grant 30 rounds per buy, either price a stack unit as a box (quantity 1 = one box, magazine fill consumes 30) **or** add `metadata.roundsPerPurchase` — **default for MVP: each inventory unit is one round** (simpler math). Name/price SKUs accordingly (e.g. sell “Ammo (30ct)” as quantity grants via multiple purchases or a future pack field). Lock **1 inventory unit = 1 round** unless product asks otherwise mid-phase.
