# Phase 01 — Ammo and weapon catalog

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Nothing  
**Unlocks:** Phase 02 (prefab FX can assume ammo ids exist), Phase 03 (fire needs catalog fields), Phase 05 (shop seed)

## Objective

Introduce purchasable **`ammo`** inventory items and extend **`WeaponDefinition`** with combat/ammo/ballistics fields so admin and client catalog data can drive fire runtime. Wire purchase allowlists so ammo stacks can be bought like consumables.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `backend/migrations/0016_weapon_combat_ammo.sql` (or next free number) | **Add** — ammo item type support, weapon combat columns / seed placeholders |
| `backend/crates/server/src/admin.rs` | **Extend** — validate `ammo`; weapon create/update combat fields |
| `backend/crates/server/src/game.rs` | **Extend** — `purchase_inventory_item` allow stackable `ammo`; flatten combat fields onto catalog JSON |
| `src/player/inventory/types.ts` | **Extend** — `ITEM_TYPES` + `ammo`; weapon combat optional fields on `ItemDefinition` / helpers |
| `src/net/admin_api.ts` | **Extend** — `WeaponDefinition` / `WeaponDefinitionInput` combat fields |
| `src/app/admin_screen.ts` | **Extend** — Weapons admin form + Items form for ammo |
| `docs/docs/admin-app/item-definitions.md` (if present) | **Extend** — document `ammo` and weapon combat fields |

## Tasks

### Item type: ammo

- [ ] Add `'ammo'` to client `ITEM_TYPES` in `src/player/inventory/types.ts`.
- [ ] Backend admin `validate_item_fields` (and any itemType enums) accept `ammo`.
- [ ] Ammo items: high `stackMax` (e.g. 120–240), `costArc` > 0, `subType` as caliber slug (e.g. `rifle-556`, `handgun-9mm`), `prefabId` null unless needed later.
- [ ] Do **not** require a new shop endpoint — reuse `POST /game/inventory/purchase`.

### Purchase allowlist

- [ ] In `purchase_inventory_item` (`game.rs`), treat `ammo` like `consumable` for stacking: allow buy while `owned < stackMax`, increment quantity by 1 per purchase (or document `roundsPerPurchase` in metadata if buying packs — default **+1 stack unit per buy**; pack size is just how you price/name the SKU).
- [ ] Keep unique-gear rules for weapons unchanged.
- [ ] Keep `material` / `misc` non-purchasable unless explicitly required (do not reopen).

### WeaponDefinition combat fields

Prefer **explicit columns** on `WeaponDefinition` (or a parallel table) over opaque JSON if SQLx stays clear. If columns are painful, store under `ItemDefinition.metadata` with a documented key set — record the choice in this file when implementing.

Required conceptual fields (PRD §8):

- [ ] `ammoItemDefinitionId` (`TEXT NULL` FK-ish to `ItemDefinition.id`)
- [ ] `magazineSize` (`INT`, default e.g. 30)
- [ ] `fireModes` — non-empty list; store as JSONB array of `'bolt' | 'single' | 'burst3' | 'auto'`
- [ ] `roundsPerMinute` (`DOUBLE` or `INT`)
- [ ] `muzzleVelocityMps`
- [ ] `bulletGravityMps2`
- [ ] `maxRangeMeters`
- [ ] `damage` (authored now; **unused** until entity-combat PRD)

- [ ] Migration backfills existing weapon rows with safe defaults (`ammoItemDefinitionId` NULL, `fireModes` `['single']`, sensible RPM/velocity/gravity/range).
- [ ] Admin GET/POST/PATCH weapons read/write these fields.
- [ ] `item_row_json` / catalog payload includes them on client `ItemDefinition` (or a typed weapon extension the fire module can read).

### Client + admin UI

- [ ] Update `WeaponDefinition` / `WeaponDefinitionInput` in `src/net/admin_api.ts`.
- [ ] Admin Weapons screen: fields for ammo id, magazine, fire modes (multi-select), RPM, ballistics, damage.
- [ ] Admin Items: allow creating `itemType: ammo` (or dedicated Ammo admin section if cleaner).
- [ ] Personal inventory filters should not break (ammo appears under a sensible filter in a later phase if needed; at minimum catalog parses).

### Validation

- [ ] Reject empty `fireModes`.
- [ ] `magazineSize >= 1`.
- [ ] If `ammoItemDefinitionId` set, target must exist and `itemType === 'ammo'` (on write).
- [ ] Fire mode strings must be from the locked enum only.

## Acceptance criteria

- [ ] Migration applies cleanly via existing SQLx runner (`npm run backend:migrate` when user applies).
- [ ] Admin can create an ammo item and a weapon that references it with fire modes + magazine.
- [ ] `POST /game/inventory/purchase` with an ammo id increments the stack (signed-in player with ARC).
- [ ] Client catalog types include `ammo` and weapon combat fields without type errors.
- [ ] No Three.js changes required in this phase.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Prefab muzzle/barrel markers (phase 02).
- LMB fire / hitscan (phase 03).
- Muzzle FX / decals / HUD (phase 04).
- Seeding playable ammo SKUs onto the demo weapon shop (phase 05) — this phase may insert placeholder ammo rows if useful for admin testing, but shop UI stock is phase 05.

## Implementation notes

- Mirror consumable restore pattern (`0015_consumable_restore.sql` + `item_row_json`) for how catalog extras reach the client.
- Weapon shop HUD still filters weapons only until phase 05 — purchasing ammo via API/admin grant is enough to validate phase 01.
- Keep sword weapons valid: `ammoItemDefinitionId` null and empty/non-gun modes OK; fire runtime will no-op.
- Do not start dev servers; assume local API is already running if smoke-checking purchase.
