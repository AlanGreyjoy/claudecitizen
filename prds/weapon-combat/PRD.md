# Weapon Combat PRD

**Status:** Ready for phased implementation  
**Owner:** ClaudeCitizen engineering  
**Last updated:** 2026-07-21  
**Phases:** [01](./phases/01-ammo-weapon-catalog.md) · [02](./phases/02-weapon-prefab-authoring.md) · [03](./phases/03-hitscan-fire-runtime.md) · [04](./phases/04-fx-combat-hud.md) · [05](./phases/05-shop-seed-docs.md)  
**Checklist:** [CHECKLIST.md](./CHECKLIST.md)

## 1. Summary

ClaudeCitizen will gain **Weapon Combat**: third-person over-the-shoulder (OTS) gunplay for **rifles** and **handguns**. Players draw a weapon (hotbar 1–3), aim with RMB (existing), fire with LMB, cycle fire modes, reload from inventory ammo, and see muzzle flash, hit decals on world geometry, and an ammo / fire-mode HUD.

Today, weapons are inventory + visual + animation ready (equip, draw, holster, stance packs, RMB aim, crosshair, weapon shop). There is **no fire, ammo, magazine, hitscan, muzzle FX, or combat HUD**.

This PRD defines authoring, ammo economy, client-local ballistics against **world geometry only**, and presentation. **Phases 1–4 are the MVP.** Phase 5 stocks shops and polishes docs.

## 2. Problem

Without a shoot/reload loop:

- Drawn weapons are cosmetic — LMB is unused for firearms (`primaryClickPressed` exists for cockpit controls only).
- There is no ammo item type, no magazine, and no way to buy ammo at the weapon shop.
- Authors cannot place muzzle flash or barrel-end points on weapon prefabs (only `drawn-grip` exists).
- Roadmap Phase III (“third-person weapons”, muzzle flash, hitscan, combat HUD) remains open while the hard parts of presence (equip/aim/stance) are already done.

## 3. Goals

1. Name the feature **Weapon Combat** (third-person OTS gunplay). Do not ship a first-person camera or label the mode “FPS” in product UI.
2. Add **`itemType: 'ammo'`** with calibers via `subType`; weapons reference an ammo definition; ammo is purchasable and stackable.
3. Extend **`WeaponDefinition`** with combat/ammo/ballistics fields (magazine, fire modes, RPM, muzzle velocity, gravity, range, damage stored for later).
4. Author **muzzle-flash** and **barrel-end** marker positions on item prefabs in the editor (entity TRS, same spirit as `drawn-grip`), plus drag-and-drop **audio** and **hit-decal** fields on a `weapon-combat` component.
5. Implement **client-local** fire: bolt / single / 3-round burst / full auto as configured per weapon; session-local magazine; reload consumes server-backed ammo stacks.
6. Resolve shots with **hitscan + bullet drop** (segmented raycasts along a gravity-bent path from barrel-end) against **world geometry only** (terrain, station statics, ship props). Spawn pooled hit decals on those surfaces.
7. Present muzzle flash at the muzzle marker, play fire/dry/reload SFX, and show ammo + fire-mode on the combat HUD.
8. Respect AGENTS.md: fire/ammo policy in `player/` (no Three.js); FX/decals in `render/`; thin wiring in `app/`; frame-budget discipline (decal pool, one path per shot).

## 4. Non-goals

- First-person camera / viewmodel / arms-only FPS mode.
- Player, NPC, or mob damage, death, ragdoll, or hit reactions (entity combat is a later PRD). Damage values may be authored on weapons but are **unused** in this pack.
- Authoritative multiplayer hits, WebTransport combat intents, or interest-based damage sync.
- Discrete ballistic projectile meshes / trails as physics objects.
- Sword / melee combat.
- Persisting chamber/magazine across sessions (default: **session-local mag**, durable reserve stacks). Mag persistence may be added later without reopening product scope.
- Recoil camera kick, ADS walk-speed modifiers, or new locomotion rules beyond what already exists for aim stance (optional feel polish only if fire is unusable without it — not a product fork).
- Reworking ship weapons or flight combat.

## 5. Locked decisions

| Decision | Choice |
| --- | --- |
| Name | **Weapon Combat** (roadmap: third-person combat). UI: ammo, fire mode — not “FPS mode”. |
| Camera | Keep **third-person OTS**. Existing draw/holster, RMB aim, crosshair, rifle/pistol stances. **No first-person camera.** |
| MVP hits | **World geometry only** (terrain, station statics, ship props). Hit decals on those surfaces. **No player / NPC / mob damage.** |
| Ballistics | **Hitscan with bullet drop** — segmented raycasts along a gravity-bent path from **barrel-end**, not discrete projectile entities. |
| Fire modes | Per weapon subset of: **`bolt`**, **`single`**, **`burst3`**, **`auto`**. |
| Authority | **Client-local fire + magazine** for MVP. Inventory ammo stacks remain **server-backed** (purchase / reload consume). No combat WebTransport. |
| Authoring split | **Prefab (spatial + FX):** `muzzle-flash` + `barrel-end` markers (entity TRS); `weapon-combat` fields for audio URLs + hit-decal texture. **Catalog (`WeaponDefinition`):** ammo item id, magazine size, enabled fire modes, RPM, damage (stored unused), muzzle velocity, gravity, max range. |
| Ammo | New `itemType: 'ammo'` with `subType` calibers; weapons reference `ammoItemDefinitionId`; sellable in the **weapon shop**. |
| Mag state | **Session-local** magazine/chamber; durable **reserve** in inventory. Reload pulls from matching ammo stacks via a server consume/decrement path. |
| MVP after this pack | Implement phases **1 → 4** first; then **5**. |

## 6. Users and critical journeys

### Content author (editor + admin)

1. Admin: create ammo definitions (`itemType: ammo`, stackMax, costArc, subType caliber).
2. Admin: set weapon combat fields (ammo link, magazine, fire modes, RPM, ballistics).
3. Prefab editor: open a weapon item prefab; place **Barrel End** and **Muzzle Flash** empties; adjust TRS in viewport.
4. On `weapon-combat`: drag audio clips (fire / dry / reload) and a hit-decal texture from the asset browser.
5. Optionally tune markers in Base Characters while the weapon is drawn.
6. Save prefab; seed/demo weapons include markers so play works without custom assets for layout.

### Player (play, signed-in)

1. Buy a rifle/handgun and matching ammo at the weapon shop (ARC).
2. Equip weapon to a hotbar slot; press **1–3** to draw.
3. Hold **RMB** to aim (existing); **LMB** fires per current fire mode.
4. Cycle fire mode (binding defined in phase 03; default: a dedicated key such as **B** or hold-to-cycle — lock in phase doc).
5. **R** (or existing reload binding) reloads from inventory ammo when magazine is empty/partial.
6. See muzzle flash, hear SFX, see hit decals on walls/floors/terrain, and read mag / reserve / mode on HUD.
7. Dry-fire click when mag empty and no reload in progress.

## 7. Current baseline (do not rediscover)

| Fact | Detail |
| --- | --- |
| Slot types | `sword` \| `handgun` \| `rifle` in `src/types/equipment.ts`. |
| Inventory types | `consumable` \| `weapon` \| `backpack` \| `armor` \| `clothing` \| `material` \| `misc` — **no `ammo`**. `src/player/inventory/types.ts`. |
| Weapon catalog | `WeaponDefinition` = item fields + `weaponSlotType` only. Migration `0008_equipment_catalog.sql`. Admin `/admin/weapons`. |
| Seeded weapons | e.g. `starter-sidearm` (handgun); item prefabs `assault-01`, `twin-horned-pistol`, `brown-50` with `drawn-grip`. |
| Hotbar | `weapon_select.ts` — slots `rifle-primary`, `rifle-secondary`, `handgun`; stance `unarmed` \| `rifle` \| `pistol`. |
| Aim | RMB aim + FOV zoom + aim-idle; crosshair when drawn. **No LMB fire** for weapons. |
| Input | `primaryClickPressed` in `player_controls.ts` — used for cockpit gaze activate today; reuse carefully for fire when drawn. |
| Weapon shop | Prefab `weapon-shop`; HUD filters `itemType === 'weapon'`; `POST /game/inventory/purchase`. Unique weapons (qty 1). |
| Purchase rules | Stackable purchase only for `consumable`; unique for weapon/backpack/armor/clothing; **material/misc blocked**. |
| Prefab markers | `drawn-grip` singleton TRS-only; audio DnD via `assetUrlField` (`.ogg/.mp3/.wav/.m4a`). |
| Audio | `playSfx(url)` in `src/audio/sfx.ts`. |
| Vitals / damage | `health01` cosmetic client-only; no FPS damage. Ship damage unrelated. |
| Roadmap | Phase III combat checklist still open in `docs/docs/roadmap.md`. |

## 8. Data model (sketch)

Finalize field lists and defaults in phase 01 / 02 docs.

### Catalog — ammo + weapon combat

```ts
// Conceptual — ItemDefinition gains itemType 'ammo'
// Ammo: stackMax high, costArc, subType e.g. 'rifle-556' | 'handgun-9mm'

// WeaponDefinition extensions (DB + admin + client types)
ammoItemDefinitionId: string | null; // required for firearms that shoot; null = cannot fire
magazineSize: number;                // >= 1
fireModes: Array<'bolt' | 'single' | 'burst3' | 'auto'>; // non-empty
roundsPerMinute: number;             // cadence for auto / burst spacing
muzzleVelocityMps: number;
bulletGravityMps2: number;           // downward accel along world up for drop path
maxRangeMeters: number;
damage: number;                      // authored; unused until entity-combat PRD
```

### Prefab — spatial + FX

```ts
// Marker components (kinds: ['item'], marker: true, singleton each)
{ type: 'muzzle-flash' }  // entity local TRS = flash origin / orientation
{ type: 'barrel-end' }    // entity local TRS = ray origin; local +Z (or documented axis) = bore forward

// Singleton fields component (on marker empty or item root — lock in phase 02)
{
  type: 'weapon-combat';
  fireSoundUrl: string | null;
  dryFireSoundUrl: string | null;
  reloadSoundUrl: string | null;
  hitDecalUrl: string | null; // image texture for world hit decals
}
```

### Runtime session state (client)

```ts
// Conceptual — player/ weapon fire module
interface WeaponFireState {
  activeSlotId: string | null;
  fireModeIndex: number;
  roundsInMag: number;
  reloading: boolean;
  cooldownRemainingSec: number;
  burstRoundsRemaining: number;
}
```

## 9. Architecture constraints

```
math/ ← player/ (fire policy, mag, mode, reload intent)
              ↑
       app/game_loop.ts  (LMB when drawn; call fire tick)
              ↑
       render/ (muzzle flash, decal pool, HUD) reads fire events — never owns ammo truth
```

- `player/` must not import `three`, `render/`, or DOM.
- Hitscan world queries: prefer existing physics/render hit surfaces (station Rapier, ship Rapier, terrain mesh ray) behind a small adapter owned by `app/` or a dedicated `player/`-safe result type fed from render/physics. Do **not** put Three.js in `player/`.
- Performance: capped **decal pool**; **one** ballistic path evaluation per shot; reuse vectors; no unbounded allocations on the fire hot path; muzzle flash is short-lived / pooled.
- Reload: server must decrement ammo stacks (new endpoint or extend consume). Optimistic UI may show local mag immediately; reconcile on response.
- Do not introduce a second shop purchase API — extend `purchase_inventory_item` allowlist for `ammo`.

## 10. Product requirements

### 10.1 Ammo + weapon catalog (phase 1)

- `itemType: 'ammo'` valid in client types, admin validation, and purchase stackable branch.
- Weapon admin create/edit exposes combat fields; migration adds columns or JSON metadata (pick one approach in phase 01; prefer explicit columns on `WeaponDefinition` or documented `metadata` keys — **prefer columns** if SQLx-friendly).
- Existing weapons get sensible defaults (or null ammo → cannot fire until seeded in phase 05).

### 10.2 Prefab authoring (phase 2)

- Add `muzzle-flash`, `barrel-end`, `weapon-combat` to schema + registry + inspector + `item_runtime` collectors/validators (at most one of each marker).
- Document forward axis for barrel-end.
- Seed markers on at least one rifle and one handgun prefab.
- Docs under `docs/docs/cc-editor/components/`.

### 10.3 Fire runtime (phase 3)

- When a firearm is drawn and eligible, LMB fires per mode; empty mag dry-fires.
- Segmented hitscan with drop from barrel-end world pose; stop at first world hit or max range.
- Ignore player/NPC/mob colliders for damage (may ignore them entirely for MVP hit resolution).
- Reload from inventory matching `ammoItemDefinitionId`.

### 10.4 FX + HUD (phase 4)

- Muzzle flash at muzzle marker; SFX from prefab URLs; decals at hit point/normal with pool cap.
- HUD: rounds in mag, reserve count, current fire mode; integrate with existing weapon crosshair / weapon bar.

### 10.5 Shop + seed + docs (phase 5)

- Weapon shop lists ammo (section or tabs) and sells via existing purchase.
- Seed ammo SKUs; wire `ammoItemDefinitionId` on demo weapons; optional curated `itemDefinitionIds` on demo weapon-shop.
- Update play docs + roadmap Phase III checkboxes that this pack completes.

## 11. Phased delivery

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| [01](./phases/01-ammo-weapon-catalog.md) | Ammo type, weapon combat catalog fields, purchase, admin | — |
| [02](./phases/02-weapon-prefab-authoring.md) | Prefab markers + weapon-combat FX authoring | 01 recommended |
| [03](./phases/03-hitscan-fire-runtime.md) | Fire / reload / hitscan drop (world only) | 01, 02 |
| [04](./phases/04-fx-combat-hud.md) | Muzzle, SFX, decals, combat HUD | 03 |
| [05](./phases/05-shop-seed-docs.md) | Shop ammo UI, seed stock, docs polish | 01–04 |

## 12. Acceptance (product-level)

- [ ] Authors can set muzzle-flash and barrel-end positions on a weapon prefab and drop fire/reload/dry audio + hit-decal texture in the inspector.
- [ ] Admin can create ammo items and configure weapon fire modes, magazine, ammo link, and ballistics.
- [ ] Player can buy ammo at the weapon shop and reload a drawn rifle/handgun.
- [ ] LMB fires with configured mode; hits world geometry with bullet drop; spawns a hit decal; no entity damage required.
- [ ] Combat HUD shows mag, reserve, and fire mode while a firearm is drawn.
- [ ] Domain fire/ammo policy lives under `player/` without Three.js/DOM imports.
- [ ] `npm run lint` / `npm run typecheck` clean for touched code at end of each implementation phase (per AGENTS.md).

## 13. Open implementation notes (resolved in phase docs, not product forks)

- SQLx shape for weapon combat fields (columns vs `ItemDefinition.metadata`) → phase 01; prefer explicit `WeaponDefinition` columns.
- Barrel-end forward axis (`+Z` vs `-Z`) → phase 02; document and stick to one convention matching drawn weapon orientation.
- Fire-mode cycle key binding → phase 03 (default suggestion: **B**).
- Exact world-hit adapters (Rapier ray vs mesh ray vs terrain sampler) → phase 03; must hit station/ship props and terrain.
- Reload API shape (`POST /game/inventory/consume-ammo` vs generalize consume) → phase 03.
- Muzzle flash VFX: short-lived sprite/particle vs mesh flash → phase 04; keep cheap and pooled.
- Whether Base Characters gets muzzle/barrel gizmo modes in MVP → phase 02 optional; prefab viewport markers are required.

## 14. References

- Roadmap Phase III: `docs/docs/roadmap.md`
- Weapon shop docs: `docs/docs/cc-editor/components/weapon-shop.md`
- Prefab schema: `src/world/prefabs/schema.ts`
- Item runtime: `src/world/prefabs/item_runtime.ts`
- Inventory types: `src/player/inventory/types.ts`
- Game purchase/consume: `backend/crates/server/src/game.rs`
- Conventions: `AGENTS.md`
- Mirror pack layout: `prds/system-map/`
