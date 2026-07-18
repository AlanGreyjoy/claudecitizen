# Phase 02 — Shared-probe placement + budgets

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 01  
**Unlocks:** Phase 03 (batched render), Phase 05 (worker cache)

## Objective

Replace per-entry full sample loops with **one shared probe set per tile**, then seed-stable weighted acceptance across catalog entries, under explicit sample/instance budgets — so ~50 entries do not mean 50× `samplePlanetSurface` work.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/world/surface_spawns/placement.ts` | **Rewrite** — shared probes; catalog-aware collect |
| `src/world/surface_spawns/placement_grid.ts` | **Reuse** — per-entry gap grids |
| `src/world/surface_spawns/hash.ts` | **Reuse / extend** — weighted picks must stay deterministic |
| `src/world/surface_spawns/index.ts` | **Export** updated collectors |
| `src/render/surface_spawns/manager.ts` | **Wire** — pass catalog (not only entry array) into collect |
| `src/cache/cache_keys.ts` | **Bump** `SURFACE_SPAWN_CACHE_VERSION` when algorithm changes |

## Tasks

### Shared probes

- [ ] For each tile at `level >= SURFACE_SPAWN_MIN_TILE_LEVEL`, generate `samplesPerTile` (from catalog, clamped) UV jitter samples once.
- [ ] For each sample: one `samplePlanetSurface` (and normal frame only if at least one accepting entry needs `alignToNormal` — or always sample frame once if cheaper than branching; pick one approach and document).
- [ ] Remove / stop calling the old per-entry loop that always ran `BASE_SAMPLES_PER_TILE` independently.

### Acceptance + weights

- [ ] Filter entries that accept biome + normalized height + enabled + assetUrl + weight/density > 0.
- [ ] Implement seed-stable selection among accepting entries (weighted lottery **or** sequential multi-accept with probability — must be documented and deterministic given `planetSeed`, tile coords, sample index, entry `seedOffset`).
- [ ] Preserve stochastic sparsity feel using catalog `density` and/or per-entry legacy `density` without resurrecting per-entry full loops.
- [ ] Apply **per-entry** gap via `placement_grid` (one grid per entry id, or grid keyed by entry).

### Budgets

- [ ] Cap samples per tile (hard clamp on `samplesPerTile`).
- [ ] Cap instances produced per tile (and/or per entry per tile) so a pathological catalog cannot explode memory.
- [ ] Keep collector pure: no Three, no DOM, no allocations that assume render state.

### API

- [ ] Replace `collectTileSurfaceSpawns(..., layers[])` with catalog-taking API (or overload that accepts `PlanetSpawnCatalog`).
- [ ] Instances still emit `layerId = entry.id`.
- [ ] Update manager build path to use the new API.
- [ ] Bump `SURFACE_SPAWN_CACHE_VERSION` (placement semantics changed).

## Acceptance criteria

- [ ] Single-entry catalog density/feel is roughly comparable to today’s one-layer rock (author-tunable via `samplesPerTile` / density / weight — document knobs).
- [ ] Enabling many entries that share biomes does **not** multiply surface probe count by entry count.
- [ ] Same seed + catalog + tile → same instance set (determinism smoke via script or debug dump if practical; no unit test framework required).
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Batching InstancedMeshes by asset (phase 03) — manager may still create per-entry state temporarily if needed, but placement must already be catalog-based.
- Editor weight UI (phase 04).
- Worker / IndexedDB (phase 05).
- Cross-entry global gap.

## Implementation notes

- Today: `collectLayerInstancesForTile` in `placement.ts` — rewrite around a shared loop; keep file ownership in `world/surface_spawns`.
- Prefer scanning accepting entries with a small scratch list per sample to avoid O(entries) allocations in the hot inner path when possible.
- If weighted lottery picks one entry per sample, fifty entries still cost O(samples × cheap accept tests), not O(samples × entries × full surface) — accept tests should use the already-sampled biome/height.
- Physics and render only need the flat `SurfaceSpawnInstance[]` result.
