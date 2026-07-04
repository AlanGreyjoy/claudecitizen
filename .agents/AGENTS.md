# ClaudeCitizen — Agent Conventions

## Key facts

- **No unit tests anywhere.** `npm run test -w server` exists as a stub but is unused. Unit tests are pointless with AI — they just check water = water.
- **TypeScript, ESM** at root (`"type": "module"`). Server workspace is **CommonJS**.
- Build = `tsc --noEmit && vite build` (typecheck first, then bundle). Run `npm run typecheck` before commits.
- Dev server on port **4173**: `npm run dev`. Editor only available in dev mode.
- No GitHub Actions / CI workflows.

## Workspace structure

| Path | Role | Module system | Framework |
|------|------|--------------|-----------|
| `src/` | Browser game (Vite + Three.js) | ESM | Vite |
| `server/` | Nest.js API (`@claudecitizen/server`) | CommonJS | NestJS, Prisma, Postgres, Redis |
| `editor/assets/` | Local editor asset library (gitignored) | — | — |

## Server dev setup

```bash
npm run dev:infra     # docker compose up -d postgres redis mailpit
npm run dev:server    # tsx watch src/main.ts (Nest.js, port 3000)
npm run prisma:generate   # prisma generate
npm run prisma:migrate    # prisma migrate dev
npm run prisma:deploy     # prisma migrate deploy
```

Server env template: `server/.env.example`. JWT secrets, DB URLs, etc. live there.

## Architecture — Domain-Driven Design

Bounded contexts (do not leak across):

| Context | Path | Owns |
|---------|------|------|
| `world/` | `src/world/` | Planet, terrain, coordinates, surface queries, prefabs |
| `flight/` | `src/flight/` | Ship physics, body dynamics |
| `player/` | `src/player/` | Character, deck, ship interaction, mode transitions |
| `render/` | `src/render/` | Three.js presentation — reads domain, never mutates simulation |

**Dependency direction:**
```
math/  ←  world/  ←  flight/, player/
                ↑
              render/  (reads domain; never owns simulation rules)
                ↑
              app/bootstrap.ts   (wires everything; minimal logic)
```

**Import rules:**
- `world/`, `flight/`, `player/` must not import `three`, `render/`, or DOM APIs
- `render/` may read from `world/`/`player/` but must not mutate simulation state
- `app/bootstrap.ts` orchestrates only — no domain logic inline

## Terrain mesh vs foot placement (critical)

The visible terrain mesh and on-foot physics **must sample the same LOD grid**. If they diverge, the character floats or sinks.

- Mesh uses `sampleRenderablePlanetSurface()` at the tile's LOD. Foot placement uses **`sampleFootPlanetSurface()`** (`world/planet_surface.ts`) — it reads the LOD level from **`getFootSurfaceSampleLevel()`** (`world/foot_surface_level.ts`).
- Each frame, the tile manager sets that level from `finestSelectedTileLevel` (`render/planet_tiles/domain/tile_coverage.ts`). Character update runs *before* render, so foot sampling uses the **previous frame's** level (one-frame lag is OK).
- Below ~2 km altitude, `shouldSplitTile` forces max detail only for **nearby facing tiles** (`GROUND_DETAIL_RADIUS_METERS` in `render/planet_tiles/domain/lod.ts`).
- **Do not vary `TILE_SEGMENTS` / `RENDER_SURFACE_SEGMENTS` per quality preset.** Shared index buffers and disk cache assume a fixed count. Validate cached tiles with `isValidTerrainTileBuffers()`.
- **Do not bypass** the per-frame tile build budget in `mesh_cache.ts` — unbounded sync builds freeze at 0 FPS.
- **Debugging:** `scripts/measure_desync.ts` compares analytic/mesh heights. `?quality=balanced|performance|high` toggles render presets.

## Protected assets security

- `editor/assets/`, `public/assets/protected/`, `src/assets/protected/` are gitignored — **never stage or commit**.
- `npm run build` unconditionally strips `dist/assets/protected/` and `dist/editor/assets/`. Prefab JSON only references asset paths, so prefabs are safe to commit.
- No secrets in client code — API keys, DB URLs, JWT secrets belong server-side only.

## Utility scripts

| Script | Purpose |
|--------|---------|
| `scripts/inspect_glb.mjs` | List node names/bindings in a GLB (for `ship-door` bindings) |
| `scripts/measure_desync.ts` | Compare analytic vs mesh height at a landing site |
| `scripts/spike-demo.ts` | Headless scripted takeoff/orbit/landing (`npm run demo`) |
| `scripts/bake_ship_textures.py` | Fix Unity trim-sheet materials for Three.js PBR |
| `scripts/check_page.mjs` | Page validation |

## Other conventions

- `.cursor/rules/agent-conventions.mdc` exists and defers to this file as the primary source — update both if changing architecture boundaries.
- Export **factories + pure functions** from domain modules (not classes). Three.js objects never appear in `world/` or `flight/`.
- Prefab JSON lives in `src/world/prefabs/data/<id>.prefab.json` and is committed (metadata only). The game bundles them via `import.meta.glob`.
