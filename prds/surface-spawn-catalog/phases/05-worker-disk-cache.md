# Phase 05 — Worker + IndexedDB spawn tiles

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Complete  
**Depends on:** Phases 02–03  
**Unlocks:** Cold-cache walks without main-thread placement spikes at catalog scale

## Objective

Move spawn-tile placement off the main thread and persist results with the already-defined `surfaceSpawnStorageKey` / `SURFACE_SPAWN_CACHE_VERSION`, mirroring terrain/vegetation cache discipline so large catalogs do not hitch when streaming new tiles.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/cache/cache_keys.ts` | **Use** `surfaceSpawnStorageKey`; bump version on algorithm/schema changes |
| `src/world/surface_spawns/` | **Ensure** placement is worker-safe (no window/DOM; transferable-friendly results) |
| New worker module (e.g. under `src/render/surface_spawns/worker/` or `src/world/surface_spawns/worker/`) | **Add** — build tile instances from catalog + planet + seed + tileInfo |
| `src/render/surface_spawns/manager.ts` | **Wire** — request worker builds; apply within frame budget; IDB get/put |
| Existing IDB helpers used by terrain/veg | **Mirror** — do not invent a second storage stack |
| `.cursor/rules/terrain-cache.mdc` | **Confirm** spawn bump rules still accurate |
| `docs/docs/cc-editor/planet-authoring.md` | **Note** cache invalidation behavior |

## Tasks

### Worker

- [ ] Create a spawn tile worker that runs catalog placement (phase 02 algorithm) for one tile.
- [ ] Message protocol: request `{ planet summary or ids, seed, catalog hash, tileInfo }` → result `{ instances }` (plain data).
- [ ] Main thread must not run unbounded sync `collectTileSurfaceSpawns` for warm paths once worker is live (fallback sync only for tiny budgets / failure).

### IndexedDB

- [ ] Read/write tiles via `surfaceSpawnStorageKey(planet, seed, layersHash, face, level, x, y)`.
- [ ] Validate stored payload shape before use (reject stale/partial).
- [ ] On catalog/planet fingerprint change, misses naturally via key; bump `SURFACE_SPAWN_CACHE_VERSION` when placement code changes.
- [ ] If quality presets affect samples/instances stored in tiles, include those knobs in the key (same lesson as veg sample budgets in terrain-cache.mdc).

### Manager integration

- [ ] Pending queue prefers IDB hit → apply; else enqueue worker job.
- [ ] Keep `BUILD_BUDGET_PER_FRAME` / ms when applying results and uploading instance matrices.
- [ ] Eviction radii unchanged in spirit (700/900 m).
- [ ] Dispose/cancel in-flight work on `setLayers` / dispose.

### Docs / conventions

- [ ] Document bump rules for agents (already in terrain-cache.mdc — verify spawn section matches reality).
- [ ] Brief note in planet-authoring docs: cache auto-invalidates on catalog edits.

## Acceptance criteria

- [ ] Second visit to the same surface neighborhood does not redo full placement work on the main thread (IDB hit path).
- [ ] Catalog edit (weight/samples/asset) yields new keys / fresh tiles — no stuck old props.
- [ ] Algorithm code change with version bump invalidates old tiles.
- [ ] No Three.js inside the worker placement path.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Baking offline spawn packs into `public/cache/` (terrain corridor packs are a different system).
- Cross-entry gap.
- Server-authoritative spawns.

## Implementation notes

- Mirror vegetation/terrain worker + IDB patterns; prefer existing cache utilities over new databases.
- `public/cache/spawn/` and `src/cache/spawn_pack.ts` are **terrain corridor** packs — do not overload them for prop instances without an explicit rename/design change.
- Keep physics on main thread consuming streamed instances only.
- Performance: worker helps cold CPU; phase 03 batching remains mandatory for GPU draw calls.
