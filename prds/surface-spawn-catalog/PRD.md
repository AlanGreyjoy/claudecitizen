# Surface Spawn Catalog PRD

**Status:** Ready for phased implementation  
**Owner:** ClaudeCitizen engineering  
**Last updated:** 2026-07-17  
**Phases:** [01](./phases/01-catalog-schema.md) · [02](./phases/02-shared-placement.md) · [03](./phases/03-batched-render.md) · [04](./phases/04-editor-catalog.md) · [05](./phases/05-worker-disk-cache.md)  
**Checklist:** [CHECKLIST.md](./CHECKLIST.md)

## 1. Summary

ClaudeCitizen will replace the “one spawn layer = one placer + one InstancedMesh pipeline” model with a **Surface Spawn Catalog**: a weighted list of prop entries on the planet document, placed from **shared surface probes** per tile, and rendered in **batches keyed by asset** (not by catalog entry count).

Authors should be able to stock ~**50 prop types** on a planet (rocks, debris, small fixtures) with sustained interactive FPS near the surface. **Phases 1–3 are the MVP** (schema + placement + render). Phase 4 is editor UX; phase 5 is worker/disk amortize.

## 2. Problem

Planet Authoring already exposes **Spawning** layers (`PlanetDocument.spawning: PlanetSpawnLayer[]`). Each enabled layer with an `assetUrl`:

- Runs its own sample loop (`BASE_SAMPLES_PER_TILE = 96` × density) calling `samplePlanetSurface` (and optionally `sampleVisibleSurfaceFrame`) in `src/world/surface_spawns/placement.ts`.
- Becomes one or more `THREE.InstancedMesh`es in `src/render/surface_spawns/manager.ts` (one mesh per GLB submesh/part).
- Shares only an in-memory tile cache; `surfaceSpawnStorageKey` exists but is unused.

A pack-path fix stopped every-frame string-sort thrash, but **cost still scales with layer count** for placement and draw calls. Two dense rock layers were enough to crater FPS before that fix; fifty independent layers would not be a viable art path.

Without a catalog architecture:

- Adding prop variety means adding pipelines, not variety inside a budget.
- Authors cannot safely aim for a rich surface dressing set.
- Disk-cache scaffolding in `cache_keys.ts` never pays off.

## 3. Goals

1. Name the feature **Surface Spawn Catalog** in docs and PRD; editor section may keep the short label **Spawning** or rename to **Spawn Catalog** (phase 04).
2. Support **~50 enabled catalog entries** on a planet with sustained interactive framerate near spawn (same quality bar as vegetation: no main-thread freezes, no unbounded per-frame work).
3. Introduce a catalog data shape on `PlanetDocument` with **weights**, shared sample budget knobs, and a clean migration from today’s `PlanetSpawnLayer[]`.
4. Place props with **shared probes per tile** — evaluate many entries from one surface sample set (domain stays in `world/surface_spawns`).
5. Render with **batches keyed by `assetUrl`** (and hardened material key if needed), so duplicate assets or many entries sharing one GLB do not multiply draw calls 1:1 with entry count.
6. Enforce **global budgets**: per-tile samples, per-layer and total instances, draw-call soft/hard caps, existing physics collider cap remains.
7. Keep AGENTS.md boundaries: no Three.js / DOM in `world/`; `render/` presents streamed instances; physics only consumes nearby instances.
8. Wire IndexedDB + worker placement in a later phase using existing `SURFACE_SPAWN_CACHE_VERSION` / `surfaceSpawnStorageKey`.

## 4. Non-goals

- Procedural vegetation replacement (grass/trees stay in `src/render/vegetation/`).
- Trimesh / convex hull colliders for props (box/capsule only, as today).
- Authoring unique props that are full interactive prefabs (doors, shops) — catalog is **dressing + simple collision**.
- Cross-planet shared catalog files in v1 (entries live on the planet document; can extract later).
- GPU GPU-driven / compute culling, or texture atlasing of arbitrary Unity trim sheets in v1 (optional stretch in phase 03 notes).
- Backend authority for spawn instances (client-deterministic placement is enough).
- Heightfield editor preview streaming of all catalog props (Preview Planet / play remains the fidelity path).

## 5. Locked decisions

| Decision | Choice |
| --- | --- |
| Name | **Surface Spawn Catalog** |
| Data home | Catalog stays on **`PlanetDocument`** (field evolves from `spawning`). No separate `*.spawn.json` in v1. |
| Placement model | **Shared probes per tile**, then weighted / rule evaluation across enabled entries. Do **not** run a full 96-sample loop per entry. |
| Render model | **Batch by asset URL** (one InstancedMesh set per unique loaded asset, parts as today). Catalog entry id is stored on instances for physics/debug; it does not own a mesh. |
| Instance identity | `SurfaceSpawnInstance` keeps `layerId` (rename to `entryId` only if phase 01 does a clean rename + bump; prefer keeping `layerId` as the entry id string for less churn). |
| Budgets | Hard caps in code (samples/tile, instances/batch, total visible instances, enqueue radius). Soft warning in editor when entry count > 50 or estimated draw calls high. |
| Migration | Old `PlanetSpawnLayer[]` JSON **must still load** — parse migrates 1:1 into catalog entries with equal weights / per-entry density preserved as weight×budget. |
| Gap rule | v1: **per-entry gap** (same as today). Cross-entry global gap is out of scope unless a phase notes it as optional. |
| MVP after this pack | Implement phases **1 → 2 → 3** first; then 4; then 5. |
| Cache invalidation | Placement/schema algorithm changes bump `SURFACE_SPAWN_CACHE_VERSION`. Planet JSON knob edits invalidate via hash (no manual bump). |

## 6. Users and critical journeys

### Content author (editor, `npm run dev`)

1. Open Editor → Planet Authoring → **Spawning / Spawn Catalog**.
2. Drag `.glb` props from Project into the catalog (or add entries).
3. Tune weight, biomes, height range, density feel, gap, scale, collider per entry.
4. Enable/disable entries without deleting them.
5. Save planet JSON; Preview Planet and walk the surface — FPS stays playable with a large catalog.
6. See a soft warning if the catalog is oversized or an asset has many submeshes (draw-call risk).

### Pilot (play)

1. Land / spawn on foot near dressed terrain.
2. See varied props without hitching as tiles stream in.
3. Walk among rocks with box/capsule collision (existing planet physics).
4. Climb above spawn visibility altitude → props hide (existing behavior).

## 7. Current baseline (do not rediscover)

| Fact | Detail |
| --- | --- |
| Types | `PlanetSpawnLayer`, `SurfaceSpawnInstance` in `src/types/surface_spawn.ts` |
| Schema | `PlanetDocument.spawning` in `src/world/planets/schema.ts`; `createDefaultSpawnLayer`; no max count |
| Seed | `asteron.planet.json` has rock layer(s) under `"spawning"` |
| Placement | `collectLayerInstancesForTile` / `collectTileSurfaceSpawns` — per layer, `BASE_SAMPLES_PER_TILE = 96`, min tile level **12** |
| Render | `createSurfaceSpawnManager` — in-memory 64 tiles; build 4/frame @ 10ms; 4096 instances/layer mesh; enqueue 700 m / keep 900 m; altitude hide 4 km |
| Pack path | Focus-relative matrices; selection dirty-flag + translation-only walk path (post-2026-07-17 fix) |
| Assets | `loadSurfaceSpawnAsset` → `extractInstancedAsset` (one InstancedMesh per mesh part) |
| Physics | `planet_physics.ts` — 36 m radius, max 220 colliders; game_loop syncs on foot |
| Disk cache | `surfaceSpawnStorageKey` + `SURFACE_SPAWN_CACHE_VERSION = 'v1'` **defined, unused** |
| Editor | Spawning section in `planet_authoring.ts`; DnD asset URL; no `seedOffset` UI |
| Docs | `docs/docs/cc-editor/planet-authoring.md` |

## 8. Data model (sketch)

Finalize field lists in phase 01. Conceptual shape:

```ts
// Conceptual — finalize in phase 01
interface PlanetSpawnCatalog {
  /** Shared sample attempts per tile before weights (replaces per-layer 96 loops). */
  samplesPerTile: number;       // default e.g. 96–128
  /** Optional global density scale 0–1. */
  density: number;              // default 1
  entries: PlanetSpawnEntry[];
}

interface PlanetSpawnEntry {
  id: string;                   // was PlanetSpawnLayer.id
  name: string;
  assetUrl: string;
  enabled: boolean;
  /** Relative pick weight among entries that accept the probe. */
  weight: number;               // default 1
  gapMeters: number;
  minScale: number;
  maxScale: number;
  biomes: Biome[];
  minNormalizedHeight: number;
  maxNormalizedHeight: number;
  alignToNormal: boolean;
  collider: SurfaceSpawnCollider;
  seedOffset: number;
  /**
   * Legacy density 0–1 mapped into accept probability when migrating old layers.
   * Prefer weight + catalog.density going forward; keep for compat if useful.
   */
  density?: number;
}

// PlanetDocument.spawning becomes PlanetSpawnCatalog
// OR spawning remains PlanetSpawnEntry[] + sibling spawnCatalogSettings
// Phase 01 picks one JSON shape and documents migration.
```

**Instance** (render/physics, largely unchanged):

```ts
interface SurfaceSpawnInstance {
  layerId: string; // catalog entry id
  position: Vec3;
  normal: Vec3;
  yawRadians: number;
  scale: number;
}
```

**Migration rule:** each old `PlanetSpawnLayer` → one `PlanetSpawnEntry` with `weight: 1` (or weight derived from density); `samplesPerTile` defaults so a single-entry catalog feels like today’s one-layer density.

## 9. Architecture constraints

```
math/ ← world/surface_spawns/  (catalog rules, shared probes, pure placement)
                ↑
         render/surface_spawns/  (asset cache, batched InstancedMesh, streaming)
                ↑
         physics/planet_physics.ts  (nearby colliders only)
                ↑
         app/ (play_session sets catalog; game_loop syncs physics)
                ↑
         editor/panels/planet_authoring.ts  (catalog UX)
```

- Domain placement remains deterministic and seed-stable for the same planet + catalog hash + tile coords.
- Main thread stays sacred: per-frame build budget preserved; phase 05 moves heavy placement off-thread.
- Do not put Rapier or Three in `world/`.
- Quality presets may later scale `samplesPerTile` / max instances — if they affect stored tiles, put those knobs in the storage key (phase 05) and bump `SURFACE_SPAWN_CACHE_VERSION` when algorithms change.
- Treat every change as a frame-budget decision (AGENTS.md).

## 10. Product requirements

### 10.1 Catalog data (phase 01)

- Parse/validate catalog; migrate legacy layer arrays.
- Hash includes catalog settings + entries for cache invalidation (`hashSurfaceSpawnLayers` → rename or wrap).
- Asteron seed migrates cleanly.

### 10.2 Shared placement (phase 02)

- One probe set per tile; entries compete by accept rules + weight.
- Global/per-batch instance budgets; no O(entries) full sample loops.
- Gap still per entry.
- `collectTileSurfaceSpawns` API updated; callers (render manager) updated.

### 10.3 Batched render (phase 03)

- Unique `assetUrl` → one asset load → one mesh-part set shared by all entries using that URL.
- Instances from many entries can land in the same InstancedMesh batch.
- Preserve focus-relative packing, dirty selection rebuild, translation-only walk updates.
- Soft/hard draw-call and instance caps; multi-part GLB warning path (console or debug stats).
- Physics still keyed by entry id + pose.

### 10.4 Editor (phase 04)

- Catalog list UX: add/remove/reorder or stable sort, weight field, shared `samplesPerTile` / density.
- Soft warning at >50 entries or high part-count assets.
- Docs update for Planet Authoring spawning section.

### 10.5 Worker + disk cache (phase 05)

- Implement IndexedDB (or existing cache util pattern from terrain/veg) using `surfaceSpawnStorageKey`.
- Worker builds spawn tiles; main thread only applies results within budget.
- Bump `SURFACE_SPAWN_CACHE_VERSION` when placement schema changes.

## 11. Phased delivery

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| [01](./phases/01-catalog-schema.md) | Catalog schema, migrate legacy layers, hash | — |
| [02](./phases/02-shared-placement.md) | Shared-probe placement + budgets | 01 |
| [03](./phases/03-batched-render.md) | Asset-batched InstancedMesh streaming | 02 |
| [04](./phases/04-editor-catalog.md) | Planet Authoring catalog UX + docs | 01 (02–03 recommended) |
| [05](./phases/05-worker-disk-cache.md) | Worker + IndexedDB spawn tiles | 02–03 |

## 12. Acceptance (product-level)

- [ ] A planet with **~50 enabled catalog entries** (can reuse a few GLBs with different weights/biomes) sustains interactive FPS near spawn in Preview Planet / play at default quality.
- [ ] Legacy `spawning: PlanetSpawnLayer[]` JSON still loads without manual rewrite.
- [ ] Draw calls for surface spawns scale with **unique assets × parts**, not with entry count.
- [ ] Placement cost per tile does **not** scale linearly with a full sample loop per entry.
- [ ] On-foot prop collision still works (box/capsule, existing caps).
- [ ] Domain modules under `world/surface_spawns` remain Three/DOM-free.
- [ ] Docs describe Spawn Catalog authoring and performance knobs.

## 13. Open implementation notes

- Exact weighted lottery vs multi-accept-from-probe algorithm: own in phase 02 (must be seed-stable and budget-bound).
- Whether JSON field stays named `spawning` (catalog object) vs `spawnCatalog`: own in phase 01; prefer minimal churn (`spawning` becomes object with `entries` if parsers can detect array vs object).
- Merging multi-material GLB parts into fewer draws: optional phase 03 stretch; warning is required, merge is not.
- Cross-entry exclusion radius: deferred.
- Quality-preset coupling: deferred to phase 05 key design if needed.

## 14. References

- `prds/system-map/` — pack structure mirror
- `AGENTS.md` — DDD, performance, terrain-cache bump rules
- `.cursor/rules/terrain-cache.mdc` — `SURFACE_SPAWN_CACHE_VERSION`
- `docs/docs/cc-editor/planet-authoring.md`
- Vegetation tile cache patterns under `src/render/vegetation/` and `src/cache/` (phase 05 mirror)
