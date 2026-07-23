# Weapon Combat — PRD pack

ClaudeCitizen needs **Weapon Combat**: third-person over-the-shoulder gunplay for rifles and handguns — fire modes, ammo economy, hitscan with bullet drop against world geometry, muzzle/barrel authoring, audio, hit decals, and combat HUD. Equip, draw, RMB aim, and stance packs already exist; this pack covers the missing shoot/reload/ammo slice.

This folder is the handoff pack for implementation. A new chat should read these docs instead of rediscovering inventory, weapon shops, prefab grips, and aim input from scratch.

## Recommended build order

1. **Phases 1–4** — MVP: catalog ammo + weapon combat stats, prefab muzzle/barrel/FX authoring, hitscan fire runtime, FX + combat HUD.
2. **Phase 5** — Weapon-shop ammo stock, seed SKUs, play/roadmap docs polish.

## Files

| File | Role |
| --- | --- |
| [PRD.md](./PRD.md) | Product requirements, locked decisions, data model, acceptance |
| [CHECKLIST.md](./CHECKLIST.md) | Master checklist + pasteable new-chat prompt |
| [phases/01-ammo-weapon-catalog.md](./phases/01-ammo-weapon-catalog.md) | Ammo item type, WeaponDefinition combat fields, purchase allowlist, admin |
| [phases/02-weapon-prefab-authoring.md](./phases/02-weapon-prefab-authoring.md) | Muzzle/barrel markers, weapon-combat FX fields, inspector, item runtime |
| [phases/03-hitscan-fire-runtime.md](./phases/03-hitscan-fire-runtime.md) | Fire modes, magazine/reload, segmented bullet-drop hitscan (world only) |
| [phases/04-fx-combat-hud.md](./phases/04-fx-combat-hud.md) | Muzzle flash, SFX, hit decals, ammo/fire-mode HUD |
| [phases/05-shop-seed-docs.md](./phases/05-shop-seed-docs.md) | Weapon-shop ammo section, seed data, docs / roadmap |

## New chat

Paste the prompt block at the top of [CHECKLIST.md](./CHECKLIST.md). Work phases in order; mark checklist items as you go.

## Related code (today)

| Area | Path |
| --- | --- |
| Weapon slot types | `src/types/equipment.ts` |
| Inventory / item types | `src/player/inventory/types.ts` |
| Weapon hotbar / stance | `src/player/inventory/weapon_select.ts` |
| Loadout slots | `src/player/inventory/loadout_slots.ts` |
| Drawn grip / equipment sockets | `src/world/prefabs/schema.ts`, `src/world/prefabs/item_runtime.ts` |
| Weapon prefabs | `src/world/prefabs/data/assault-01.prefab.json`, `twin-horned-pistol.prefab.json`, `brown-50.prefab.json` |
| Equipment attach | `src/render/characters/sidekick/equipment_attach.ts` |
| Base Characters editor | `src/render/editor/base_character_equipment_editor.ts` |
| Aim / draw / crosshair | `src/app/game_loop.ts`, `src/input/player_controls.ts` |
| Rifle / pistol anims | `src/player/animation/resolve_locomotion.ts`, `src/player/character_locomotion.ts`, `src/render/characters/sidekick/animation_runtime.ts` |
| Weapon shop | `src/player/weapon_shop_gaze.ts`, `src/render/effects/hud/weapon_shop.ts` |
| Purchase / consume API | `src/net/api.ts`, `backend/crates/server/src/game.rs` |
| Weapon admin catalog | `backend/migrations/0008_equipment_catalog.sql`, `src/net/admin_api.ts` |
| Audio one-shots | `src/audio/sfx.ts` (`playSfx`) |
| Inspector asset DnD | `src/editor/panels/inspector.ts` (`assetUrlField`) |
| Roadmap Phase III | `docs/docs/roadmap.md` |
| Agent conventions | `AGENTS.md` |
