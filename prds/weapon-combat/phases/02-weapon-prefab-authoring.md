# Phase 02 — Weapon prefab authoring

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 01 recommended (ammo ids exist for docs/examples); schema work can proceed in parallel  
**Unlocks:** Phase 03 (barrel-end world pose), Phase 04 (muzzle + audio + decal URLs)

## Objective

Let authors place **muzzle-flash** and **barrel-end** markers on weapon item prefabs and configure **weapon-combat** FX fields (fire / dry / reload audio, hit-decal texture) via the prefab inspector, following the `drawn-grip` + `assetUrlField` patterns.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/world/prefabs/schema.ts` | **Extend** — `muzzle-flash`, `barrel-end`, `weapon-combat` component types + validators |
| `src/world/prefabs/component_registry.ts` | **Extend** — kinds `['item']`, marker flags, defaults |
| `src/editor/panels/inspector.ts` | **Extend** — cases; audio/image DnD for `weapon-combat` |
| `src/world/prefabs/item_runtime.ts` | **Extend** — collectors + validators (at most one of each) |
| `src/world/prefabs/data/assault-01.prefab.json` | **Extend** — seed muzzle + barrel (+ weapon-combat stub) |
| `src/world/prefabs/data/twin-horned-pistol.prefab.json` (and/or `brown-50`) | **Extend** — same |
| `docs/docs/cc-editor/components/muzzle-flash.md` | **Add** |
| `docs/docs/cc-editor/components/barrel-end.md` | **Add** |
| `docs/docs/cc-editor/components/weapon-combat.md` | **Add** |
| `docs/docs/cc-editor/components/index.md` | **Extend** — link new components |
| `src/render/editor/base_character_equipment_editor.ts` | **Optional** — gizmo modes to tweak muzzle/barrel while drawn |

## Tasks

### Schema + registry

- [ ] Add components:
  - `{ type: 'muzzle-flash' }` — marker; entity TRS is flash origin/orientation.
  - `{ type: 'barrel-end' }` — marker; entity TRS is ray origin; **document forward axis** (lock **local +Z = bore forward** unless existing weapon meshes force otherwise — record choice here).
  - `{ type: 'weapon-combat', fireSoundUrl, dryFireSoundUrl, reloadSoundUrl, hitDecalUrl }` — singleton; URLs nullable strings.
- [ ] Registry: `kinds: ['item']`; `muzzle-flash` / `barrel-end` `marker: true`; `weapon-combat` singleton (marker empty OK).
- [ ] Validators reject unknown fields; coerce empty strings to null for URLs.

### Inspector

- [ ] `muzzle-flash` / `barrel-end`: TRS-only (like `drawn-grip`) — short help text pointing at viewport gizmo.
- [ ] `weapon-combat`: reuse `assetUrlField` for audio (`.ogg/.mp3/.wav/.m4a`); image DnD for `hitDecalUrl` (mirror particle `textureUrlField` / accept common image extensions used elsewhere).
- [ ] Clear / unset controls for each URL.

### Item runtime

- [ ] `collectMuzzleFlash`, `collectBarrelEnd`, `collectWeaponCombat` (names flexible) returning local TRS + URLs.
- [ ] Validate: at most one of each marker/component; warn or error in prefab validation helpers consistent with `drawn-grip`.
- [ ] Firearms without barrel-end: runtime phase 03 may fall back to weapon root forward — authoring should still seed markers on demo guns.

### Seed prefabs

- [ ] Place empties on `assault-01` and at least one handgun prefab near the visible muzzle; approximate positions OK (authors refine in editor).
- [ ] Include `weapon-combat` with null URLs initially (phase 04/05 can point at real clips when assets exist — do not commit protected asset paths).

### Docs

- [ ] Component docs + index links.
- [ ] Note: combat **balance** (modes, mag, ammo id) is Admin → Weapons, not these markers.

### Optional Base Characters

- [ ] If cheap: add mount modes to select/edit muzzle/barrel while weapon is drawn (save back into weapon prefab like weapon-grip). Skip if it risks scope creep — prefab hierarchy editing is sufficient for MVP.

## Acceptance criteria

- [ ] Prefab editor can add Barrel End + Muzzle Flash empties to an item prefab and persist TRS in JSON.
- [ ] Inspector accepts drag-drop audio + hit-decal URLs on `weapon-combat`.
- [ ] `item_runtime` collectors return data for seeded rifle/handgun prefabs.
- [ ] Component docs exist and are linked from the components index.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Actually firing or spawning FX (phases 03–04).
- Catalog ammo/fire-mode fields (phase 01).
- Weapon shop ammo UI (phase 05).

## Implementation notes

- Clone the `drawn-grip` path end-to-end: schema → registry → inspector → `item_runtime` → serialize round-trip.
- GLB node name uniqueness rules still apply if markers are parented under mesh nodes; prefer sibling empties under the item root when possible.
- Never stage `protected/` audio/texture binaries; URL fields only.
