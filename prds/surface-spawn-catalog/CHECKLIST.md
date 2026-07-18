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

- [ ] `PlanetSpawnCatalog` / `PlanetSpawnEntry` types
- [ ] Parse array→catalog migrate + object catalog parse
- [ ] Hash includes samplesPerTile, density, weights
- [ ] Asteron / legacy JSON still loads
- [ ] Compat adapter so play does not break pre-02/03
- [ ] typecheck + lint clean

## Phase 02 — Shared-probe placement + budgets

Details: [phases/02-shared-placement.md](./phases/02-shared-placement.md)

- [ ] One probe set per tile (`samplesPerTile`)
- [ ] Weighted / rule accept across entries (seed-stable)
- [ ] Per-entry gap grids retained
- [ ] Instance/sample hard caps
- [ ] Manager uses new collector API
- [ ] Bump `SURFACE_SPAWN_CACHE_VERSION`
- [ ] typecheck + lint clean

## Phase 03 — Batched render by asset

Details: [phases/03-batched-render.md](./phases/03-batched-render.md)

- [ ] Batch InstancedMesh by `assetUrl` (not per entry)
- [ ] Shared asset load for duplicate URLs
- [ ] Dirty selection + translation-only focus pack preserved
- [ ] Global instance budget + debug stats
- [ ] Multi-part GLB warning
- [ ] Physics still resolves collider by entry id
- [ ] typecheck + lint clean

## Phase 04 — Editor Spawn Catalog UX

Details: [phases/04-editor-catalog.md](./phases/04-editor-catalog.md)

- [ ] samplesPerTile + catalog density fields
- [ ] Per-entry weight field
- [ ] Soft warning at >50 entries
- [ ] Save/load catalog object shape
- [ ] Update `docs/docs/cc-editor/planet-authoring.md`
- [ ] typecheck + lint clean

## Phase 05 — Worker + IndexedDB

Details: [phases/05-worker-disk-cache.md](./phases/05-worker-disk-cache.md)

- [ ] Spawn tile worker running phase-02 placement
- [ ] IndexedDB get/put via `surfaceSpawnStorageKey`
- [ ] Manager apply path budgeted; invalidate on catalog/version change
- [ ] Docs / terrain-cache bump rules verified
- [ ] typecheck + lint clean

---

## Product acceptance

- [ ] ~50 enabled catalog entries sustain interactive FPS near spawn (Preview Planet / play)
- [ ] Legacy `spawning` arrays still load
- [ ] Draw calls scale with unique assets × parts, not entry count
- [ ] Placement probes do not run a full per-entry sample loop
- [ ] On-foot box/capsule collision still works
- [ ] `world/surface_spawns` stays Three/DOM-free
- [ ] Docs describe Spawn Catalog + performance knobs
