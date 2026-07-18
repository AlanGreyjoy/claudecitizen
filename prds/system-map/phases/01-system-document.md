# Phase 01 — System document (schema, loader, API, seed)

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Complete  
**Depends on:** Nothing  
**Unlocks:** Phase 02 (editor), Phase 03 (runtime)

## Objective

Introduce `SystemDocument` as a first-class world asset parallel to planet documents: TypeScript schema, parse/validate, runtime loader, Vite editor CRUD API, and a seeded `default.system.json` with Asteron plus both station prefabs.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/world/systems/schema.ts` | **Add** — types, id pattern, `parseSystemDocument`, defaults |
| `src/world/systems/loader.ts` | **Add** — `import.meta.glob` + DEV API load |
| `src/world/systems/runtime.ts` | **Add** — optional `activateSystemDocument` / `getActiveSystemDocument` singleton (mirror planets) |
| `src/world/systems/data/default.system.json` | **Add** — seed layout |
| `src/editor/api.ts` | **Extend** — `fetchSystemList`, `fetchSystem`, `saveSystem` |
| `vite.config.ts` | **Extend** — `/__editor/systems`, `/__editor/system` (GET/POST) writing under `src/world/systems/data/` |
| `docs/docs/cc-editor/system-map.md` | **Add stub** or leave for phase 02 if preferred; at minimum note data location in phase 02 docs |

## Tasks

### Schema

- [x] Define `SystemDocument`, `SystemPlanetEntry`, `SystemStationEntry` per PRD §8.
- [x] Id pattern: reuse planet-style slug `^[a-z0-9][a-z0-9-]{0,63}$` for `system.id`, planet entry ids, station instance ids.
- [x] `parseSystemDocument(raw): SystemDocument | null` — reject invalid ids, missing positions, unknown shapes; coerce numbers.
- [x] `createDefaultSystemDocument(id, name)` for New System flows.
- [x] Document coordinate convention in a short file comment: **ecliptic meters from star at (0,0)**; `positionMeters.x/z` and `offsetMeters.x/z`; no `y` in v1.
- [x] Choose and document default map distances so six planets are draggable (e.g. planets on the order of `1e9`–`5e10` meters from star, or a named `SYSTEM_MAP_METERS` scale). Record the choice in schema comments and seed JSON.

### Seed data

- [x] Write `default.system.json`:
  - `id: "default"`, display name e.g. `"Asteron System"`.
  - Star name (e.g. `"Asteron Prime"`).
  - One planet entry: `planetId: "asteron"`, non-zero ecliptic position.
  - Two station entries: `demo-station` and `blackmarketstation`, distinct `id`s, `parentBodyId` pointing at the Asteron planet entry, distinct `offsetMeters`, sensible `altitudeMeters` (default 200_000 for demo-station to match today’s feel).

### Loader / runtime

- [x] Glob `./data/*.system.json` like `world/planets/loader.ts`.
- [x] `loadSystemDocument(id)` — DEV prefers `/__editor/system?id=`, else bundled module.
- [x] `listSystemDocumentIds()` or equivalent for editor list.
- [x] Module-level active system (optional in this phase, required by phase 03): `activateSystemDocument` / `getActiveSystemDocument`.

### Editor API (data only — no UI yet)

- [x] `GET /__editor/systems` → `{ systems: [{ id, name }] }`.
- [x] `GET /__editor/system?id=` → `{ document }`.
- [x] `POST /__editor/system` body `{ document }` → write `src/world/systems/data/<id>.system.json`, return `{ path }`.
- [x] Mirror safety of planet routes (validate id, no path traversal).
- [x] Wire `src/editor/api.ts` helpers that call `parseSystemDocument`.

## Acceptance criteria

- [x] Seed file loads through `parseSystemDocument` without null.
- [ ] DEV API list/get/save round-trips the default system (manual or via editor API from console).
- [x] Production glob can resolve `default` after save/commit.
- [x] No Three.js / DOM imports under `src/world/systems/`.
- [x] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Editor canvas / System Map tab (phase 02).
- Play session wiring (phase 03).
- Quantum or HaloBand changes.

## Implementation notes

- Mirror `src/world/planets/schema.ts` + `loader.ts` + planet Vite plugin block in `vite.config.ts` for consistency.
- Station prefab ids must match files under `src/world/prefabs/data/` (`demo-station`, `blackmarketstation`).
- Do not embed full `PlanetDocument` inside the system JSON.
- Scale constants: `SYSTEM_MAP_PLANET_DISTANCE_METERS` = 1e10, `SYSTEM_MAP_STATION_OFFSET_METERS` = 5e7, default altitude 200_000.
