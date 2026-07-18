# Surface Spawn Catalog — Master checklist

**PRD:** [PRD.md](./PRD.md) · **Index:** [README.md](./README.md)

## New chat prompt (paste this)

```
Implement the next unfinished phase of the ClaudeCitizen Surface Spawn Catalog feature.

Read these first (in order):
1. prds/surface-spawn-catalog/README.md
2. prds/surface-spawn-catalog/PRD.md
3. prds/surface-spawn-catalog/CHECKLIST.md — find the first phase with open items
4. That phase file under prds/surface-spawn-catalog/phases/

Follow AGENTS.md. Do not start dev servers. After multi-file work, run npm run lint (and npm run typecheck before any commit I request).

Locked decisions are in the PRD — do not reopen naming (Surface Spawn Catalog), shared probes vs per-entry sample loops, batch-by-assetUrl, or keeping the catalog on PlanetDocument.

When you finish a phase, check off items in CHECKLIST.md and the phase file.
```

---

## Phase 01 — Catalog schema + migration

Details: [phases/01-catalog-schema.md](./phases/01-catalog-schema.md)

- [x] `PlanetSpawnCatalog` / `PlanetSpawnEntry` types
- [x] Parse array→catalog migrate + object catalog parse
- [x] Hash includes samplesPerTile, density, weights
- [x] Asteron / legacy JSON still loads
- [x] Compat adapter so play does not break pre-02/03
- [x] typecheck + lint clean

## Phase 02 — Shared-probe placement + budgets

Details: [phases/02-shared-placement.md](./phases/02-shared-placement.md)

- [x] One probe set per tile (`samplesPerTile`)
- [x] Weighted / rule accept across entries (seed-stable)
- [x] Per-entry gap grids retained
- [x] Instance/sample hard caps
- [x] Manager uses new collector API
- [x] Bump `SURFACE_SPAWN_CACHE_VERSION`
- [x] typecheck + lint clean

## Phase 03 — Batched render by asset

Details: [phases/03-batched-render.md](./phases/03-batched-render.md)

- [x] Batch InstancedMesh by `assetUrl` (not per entry)
- [x] Shared asset load for duplicate URLs
- [x] Dirty selection + translation-only focus pack preserved
- [x] Global instance budget + debug stats
- [x] Multi-part GLB warning
- [x] Physics still resolves collider by entry id
- [x] typecheck + lint clean

## Phase 04 — Editor Spawn Catalog UX

Details: [phases/04-editor-catalog.md](./phases/04-editor-catalog.md)

- [x] samplesPerTile + catalog density fields
- [x] Per-entry weight field
- [x] Soft warning at >50 entries
- [x] Save/load catalog object shape
- [x] Update `docs/docs/cc-editor/planet-authoring.md`
- [x] typecheck + lint clean

## Phase 05 — Worker + IndexedDB

Details: [phases/05-worker-disk-cache.md](./phases/05-worker-disk-cache.md)

- [x] Spawn tile worker running phase-02 placement
- [x] IndexedDB get/put via `surfaceSpawnStorageKey`
- [x] Manager apply path budgeted; invalidate on catalog/version change
- [x] Docs / terrain-cache bump rules verified
- [x] typecheck + lint clean

---

## Product acceptance

- [ ] ~50 enabled catalog entries sustain interactive FPS near spawn (Preview Planet / play)
- [x] Legacy `spawning` arrays still load
- [x] Draw calls scale with unique assets × parts, not entry count
- [x] Placement probes do not run a full per-entry sample loop
- [x] On-foot box/capsule collision still works
- [x] `world/surface_spawns` stays Three/DOM-free
- [x] Docs describe Spawn Catalog + performance knobs
