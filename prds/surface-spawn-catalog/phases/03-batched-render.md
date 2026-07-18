# Phase 03 — Batched render by asset

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 02  
**Unlocks:** Phase 04 (editor warnings), Phase 05 (cache apply path)

## Objective

Stream surface spawn instances with **InstancedMesh batches keyed by asset URL**, so fifty catalog entries that reuse a handful of GLBs (or many entries sharing materials) do not create fifty independent draw-call pipelines. Preserve the post-fix pack path (dirty selection + focus-relative translation updates).

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/render/surface_spawns/manager.ts` | **Rewrite batching** — batch key = assetUrl; instances carry entry id |
| `src/render/surface_spawns/asset_cache.ts` | **Reuse**; optional part-count warning helper |
| `src/render/surface_spawns/instance_matrix.ts` | **Reuse** — focus-relative compose / scratch |
| `src/render/main/manager.ts` | **Wire** — `setSurfaceSpawnLayers` → catalog / entries |
| `src/app/play_session.ts` | **Wire** — pass catalog from planet document |
| `src/physics/planet_physics.ts` | **Compat** — still resolves collider by entry id via catalog lookup |
| Debug stats | **Extend** — batch count, draw estimate, entry count |

## Tasks

### Batch model

- [ ] Replace “one `LayerRenderState` per entry id” with **batch state per unique `assetUrl`** (enabled entries only).
- [ ] Load each unique asset once via `loadSurfaceSpawnAsset`.
- [ ] Pack instances from **all entries** that share that asset into the same InstancedMesh part set (up to `MAX_INSTANCES_PER_*` cap).
- [ ] Keep `SurfaceSpawnInstance.layerId` for physics/debug; GPU slot order stays stable (numeric/pose sort, not distance shuffle while walking).

### Pack path (do not regress)

- [ ] Selection rebuild only when tile cache / catalog dirty (or capped nearest-N refocus).
- [ ] Walking updates **translations only** when focus moves.
- [ ] Compose once per instance; write to all mesh parts of the batch.
- [ ] Preserve enqueue/keep radii and altitude visibility.

### Budgets / safety

- [ ] Global visible instance budget across all batches (trim nearest-N by focus when over).
- [ ] Cap instances per batch mesh (existing 4096 or revised constant — document choice).
- [ ] Debug stats: `entryCount`, `uniqueAssets`, `batchMeshes`, `totalInstances`, `estimatedDrawCalls`.
- [ ] `console.warn` (dev) when an asset has an excessive `parts.length` (suggest threshold, e.g. >8).

### Call sites

- [ ] `setSurfaceSpawnLayers` → accept catalog or entries+settings; hash via phase 01 helper.
- [ ] `getSurfaceSpawnLayers` / physics lookup still returns entry definitions needed for colliders.
- [ ] game_loop physics path unchanged in spirit: nearby instances + entry list.

### Optional stretch (not required)

- [ ] Merge same-material parts inside `extractInstancedAsset` for spawn assets only — only if low risk; otherwise leave as warning-only.

## Acceptance criteria

- [ ] Two catalog entries with the **same** `assetUrl` produce **one** asset load and **one** batch (not two full mesh sets).
- [ ] Fifty entries that reuse ≤5 assets stay in the draw-call ballpark of those 5 assets × parts — not 50×.
- [ ] Walking does not reintroduce every-frame selection string-sort thrash.
- [ ] On-foot collision still works for distinct entry colliders sharing an asset.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Editor soft warnings UI (phase 04 can read debug stats / part counts).
- Worker / IndexedDB (phase 05).
- Billboard / impostor LOD for distant props (future).

## Implementation notes

- Current manager maps `layerStates` by `layer.id` — switch key to `assetUrl`, keep a side map `entryId → entry` for colliders and baseOffset.
- When catalog hash changes, clear tile cache + batches (same as today’s `setLayers`).
- Multi-part GLBs remain the main draw multiplier inside a batch; warn authors rather than silently dropping parts.
- Do not allocate `Float32Array(16)` per instance per frame — keep scratch buffers from the earlier pack fix.
