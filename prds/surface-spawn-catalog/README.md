# Surface Spawn Catalog — PRD pack

ClaudeCitizen needs a **Surface Spawn Catalog**: dozens of surface prop types (rocks, debris, fixtures) authored on a planet without one draw-call pipeline and one full sample loop per type. Today each spawn layer is an independent placer + InstancedMesh batch; two dense layers already stressed FPS before pack-path fixes, and ~50 layers would not hold.

This folder is the handoff pack for implementation. A new chat should read these docs instead of rediscovering planet spawning, placement, and the surface-spawn manager.

## Recommended build order

1. **Phases 1–3** — MVP: catalog schema, shared-probe placement + budgets, batched render. Ship this before editor polish / disk cache.
2. **Phase 4** — Planet Authoring catalog UX + docs.
3. **Phase 5** — Worker + IndexedDB spawn tiles (amortize cold walks).

## Files

| File | Role |
| --- | --- |
| [PRD.md](./PRD.md) | Product requirements, locked decisions, data model, acceptance |
| [CHECKLIST.md](./CHECKLIST.md) | Master checklist + pasteable new-chat prompt |
| [phases/01-catalog-schema.md](./phases/01-catalog-schema.md) | Catalog types, parse, migrate from `PlanetSpawnLayer[]` |
| [phases/02-shared-placement.md](./phases/02-shared-placement.md) | Shared probes, weights, global instance budgets |
| [phases/03-batched-render.md](./phases/03-batched-render.md) | Batch by asset; draw/instance caps; keep focus-relative pack |
| [phases/04-editor-catalog.md](./phases/04-editor-catalog.md) | Planet Authoring Spawn Catalog UI + docs |
| [phases/05-worker-disk-cache.md](./phases/05-worker-disk-cache.md) | Worker builds + IndexedDB via `surfaceSpawnStorageKey` |

## New chat

Paste the prompt block at the top of [CHECKLIST.md](./CHECKLIST.md). Work phases in order; mark checklist items as you go.

## Related code (today)

| Area | Path |
| --- | --- |
| Spawn types | `src/types/surface_spawn.ts` |
| Planet schema / spawning | `src/world/planets/schema.ts`, `data/asteron.planet.json` |
| Placement (domain) | `src/world/surface_spawns/` |
| Render stream | `src/render/surface_spawns/manager.ts`, `asset_cache.ts`, `instance_matrix.ts` |
| Physics | `src/physics/planet_physics.ts` |
| Play wire-up | `src/app/play_session.ts`, `src/app/game_loop.ts` |
| Editor | `src/editor/panels/planet_authoring.ts` (Spawning section) |
| Cache keys (unused disk path) | `src/cache/cache_keys.ts` (`SURFACE_SPAWN_CACHE_VERSION`, `surfaceSpawnStorageKey`) |
| Docs | `docs/docs/cc-editor/planet-authoring.md` |
| Agent conventions | `AGENTS.md`, `.cursor/rules/terrain-cache.mdc` |
