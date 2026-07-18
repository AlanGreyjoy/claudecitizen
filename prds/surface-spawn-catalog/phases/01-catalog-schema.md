# Phase 01 — Catalog schema + legacy migration

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Complete  
**Depends on:** Nothing  
**Unlocks:** Phase 02 (placement), Phase 04 (editor)

## Objective

Introduce a **Surface Spawn Catalog** data shape on `PlanetDocument`, with parse/validate helpers and automatic migration from today’s `PlanetSpawnLayer[]`, so later phases can change placement/render without stranding existing planet JSON.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/types/surface_spawn.ts` | **Extend** — `PlanetSpawnCatalog`, `PlanetSpawnEntry` (or evolve `PlanetSpawnLayer`) |
| `src/world/planets/schema.ts` | **Extend** — parse catalog; `createDefaultSpawnCatalog` / migrate helpers |
| `src/cache/cache_keys.ts` | **Extend** — hash catalog settings + entries (keep or wrap `hashSurfaceSpawnLayers`) |
| `src/world/planets/data/asteron.planet.json` | **Migrate** — rewrite to catalog shape once parser accepts both (or leave array and rely on migrate-on-read) |
| `src/world/surface_spawns/index.ts` | **Export** any new pure helpers if added |
| Call sites using `PlanetSpawnLayer[]` | **Compat typedef** — `PlaySession` / manager may still accept `entries` via adapter until phase 02–03 |

## Tasks

### Types

- [ ] Add `PlanetSpawnCatalog` with at least `samplesPerTile`, `density`, `entries: PlanetSpawnEntry[]`.
- [ ] Define `PlanetSpawnEntry` fields per PRD §8 (id, name, assetUrl, enabled, weight, gap, scales, biomes, height range, alignToNormal, collider, seedOffset; optional legacy `density`).
- [ ] Keep `SurfaceSpawnInstance.layerId` as the catalog entry id (document that naming; do not force a mass rename unless trivial).
- [ ] Prefer exporting catalog types from `src/types` the same way spawn types are exported today.

### Parse / migrate

- [ ] Detect JSON shape: if `spawning` is an **array**, migrate to catalog (`samplesPerTile` default, `density: 1`, entries from layers with `weight: 1`, preserve per-layer `density` if kept on entry).
- [ ] If `spawning` is an **object**, parse as catalog (validate numbers, biomes, collider).
- [ ] Reject invalid ids; coerce finite numbers; empty biomes → no placements (same as today).
- [ ] `createDefaultSpawnLayer` → become or wrap `createDefaultSpawnEntry`; keep a thin alias if editor still calls the old name until phase 04.
- [ ] Round-trip: `parsePlanetDocument` → serialize-equivalent structure suitable for save (prefer writing catalog object going forward).

### Hash / cache keys

- [ ] Update `hashSurfaceSpawnLayers` (or add `hashSurfaceSpawnCatalog`) to include `samplesPerTile`, catalog `density`, and per-entry weight + legacy density.
- [ ] Document that algorithm bumps still use `SURFACE_SPAWN_CACHE_VERSION` (disk unused until phase 05).

### Seed / compatibility

- [ ] Ensure `asteron.planet.json` loads (migrate-on-read is enough; optional commit of catalog-shaped JSON).
- [ ] `play_session` / renderer still receive a usable layer/entry list (adapter `catalog.entries` or temporary flatten) so the game does not break before phase 02–03 land.

## Acceptance criteria

- [ ] Legacy array `spawning` and new catalog object both parse without null.
- [ ] Hash changes when weight / samplesPerTile / entry fields change.
- [ ] No Three.js / DOM in touched `world/` / `types` modules.
- [ ] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Changing placement algorithm to shared probes (phase 02).
- Batched InstancedMesh by asset (phase 03).
- Editor weight / samplesPerTile UI (phase 04).
- Worker / IndexedDB (phase 05).

## Implementation notes

- Mirror how planet vegetation settings nested under a single object while staying on `PlanetDocument`.
- Detect array vs object carefully — `Array.isArray(raw.spawning)`.
- Do not bump `SURFACE_SPAWN_CACHE_VERSION` for JSON-only shape migration if disk cache is still unused; bump when phase 02 changes placement semantics.
- Keep collider defaults (`DEFAULT_SPAWN_COLLIDER`) unchanged.
