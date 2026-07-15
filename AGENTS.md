# ClaudeCitizen — Agent Conventions

## Key facts

- **No unit tests anywhere.** `npm run test -w server` exists as a stub but is unused. Unit tests are pointless with AI — they just check water = water.
- **User owns QA.** Agents should not run tests, browser QA, screenshot checks, dev-server validation, `npm run build`, `npm run typecheck`, or `npm run lint` during normal implementation work unless explicitly asked for validation. When skipping validation, say what was not run. At the end of a multi-file feature or spike, run `npm run lint` and fix any **errors** (and trivial warnings in touched files when practical). For explicit commit requests, run `npm run typecheck` and `npm run lint` first unless told not to.
- **Prisma migrations.** Agents may run `npm run prisma:generate` after schema changes. Agents may run `npm run prisma:migrate` or `npm run prisma:deploy` when applying schema changes — Alan has authorized this. If the migration SQL file already exists under `server/prisma/migrations/`, prefer `npm run prisma:deploy` (applies pending migrations, no interactive prompt). When creating a new migration via `prisma migrate dev`, pass `--name <slug>` (e.g. `npm run prisma:migrate -w server -- --name add_items`) so the command does not hang waiting for input.
- **Do not start dev servers.** Vite and API servers are normally already running locally. Do not run `npm run dev`, `npm run dev:server`, `npm run start:dev`, `vite`, `tsx watch`, or similar long-running local servers unless explicitly asked. If server context is needed, check existing ports/processes or ask first.
- **TypeScript, ESM** at root (`"type": "module"`). Server workspace is **CommonJS**.
- Build = `tsc --noEmit && vite build` (typecheck first, then bundle), but do not run it unless explicitly requested.
- Dev server on port **4173**: `npm run dev`. Editor only available in dev mode.
- **GitHub Actions.** `.github/workflows/quality.yml` runs repository-safety, typecheck, lint, Prisma generation, and production builds on pull requests and `main`. `.github/workflows/dependency-review.yml` rejects vulnerable dependency additions. Netlify remains responsible for deployment; do not add deploy workflows unless explicitly requested.

## Workspace structure

| Path | Role | Module system | Framework |
|------|------|--------------|-----------|
| `src/` | Browser game (Vite + Three.js) | ESM | Vite |
| `server/` | Nest.js API (`@claudecitizen/server`) | CommonJS | NestJS, Prisma, Postgres, Redis |
| `editor/assets/` | Local editor asset library (gitignored) | — | — |

## Prefab & Animation Architecture

- **Prefabs** (`src/world/prefabs/`) are JSON trees of entities with transforms, GLB assets, and gameplay components. Data files live in `src/world/prefabs/data/*.prefab.json`.
- **Schema** (`src/world/prefabs/schema.ts`) defines every component type and its validator. Read this first when a component's fields are unclear.
- **Ship runtime** (`src/world/prefabs/ship_runtime.ts`) flattens a ship prefab into `ShipLayout` (walk zones, doors, seats, colliders). Ship doors use the `ship-door` component.
- **Station runtime** (`src/world/prefabs/station_runtime.ts`) flattens a station prefab into `StationLayoutOverride` (spawn, elevators, hangar pads, info markers, colliders). Station doors use the `animation` component (toggled via an `interaction` component with `interactionType: "animation"` and `targetAnimationId`).
- **Game loop** (`src/app/game_loop.ts`) owns `stationAnimationStates` (per-animation blend values) and the F-key interaction dispatch.

### Animation → collider → interaction wiring

This is the most common source of "door doesn't work" bugs. Trace these paths:

#### Station prefab doors (animation component)

1. **Visual**: `game_loop.ts` `updateStationAnimations` lerps `stationAnimationStates[id].value` toward `target`, then calls `renderer.getStationRoot().userData.updateAnimations(blends)`. The renderer (`src/render/prefabs/prefab_renderer.ts` `setupUpdateAnimations`) looks up GLB nodes by name and translates/rotates them.
2. **Collider**: station colliders are baked as **static Rapier bodies** in `play_session.ts` `createStationPhysics` → `syncStaticColliders`. They do NOT move with the animation unless bound via `collider.animation` (set in `station_runtime.ts` `bindStationColliderAnimations`). When bound, `game_loop.ts` toggles their `setEnabled` state in `updateStationAnimations` based on the open blend.
3. **F-key toggle**: an `interaction` component with `interactionType: "animation"` + `targetAnimationId` produces a `prefab-info` interaction (`station_interaction.ts`). `game_loop.ts` handles it at the `interaction.kind === 'prefab-info'` branch using `actions.wasKeyPressed(keyCode)` — NOT `actions.interactPressed`. See gotcha below.

#### Ship prefab doors (ship-door component)

1. **Visual + collider**: `ship_runtime.ts` `bindColliderAnimations` binds each collider whose `node` matches a door/ramp/gear node. The custom collision resolver (`colliders.ts` `matrixForAnimation` / `animatedNodeToRoot`) moves the collider transform with the blend.
2. **F-key toggle**: `ship_play_session.ts` / `game_loop.ts` deck-mode branches use `actions.interactPressed` (a captured boolean) to flip `doorRig.isOpen`.
3. **Walk-zone gating**: `ship_rig.ts` `isDoorPassable` returns true at `open01 >= 0.85`; `colliders.ts` `DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD` skips the collider at the same threshold.

## Editor (dev-only)

The in-browser prefab editor is only available under `npm run dev`. It assembles prefabs from entities, GLB assets, primitives, and gameplay components.

| Path | Role |
|------|------|
| `src/editor/` | Editor business logic: document store, panels, commands, serialization |
| `src/editor/document.ts` | `EditorEntity` model, `EditorStore`, selection, GLB overrides |
| `src/editor/panels/hierarchy.ts` | Scene tree / outliner |
| `src/editor/panels/inspector.ts` | Entity properties & component editor |
| `src/editor/panels/project.ts` | Asset browser |
| `src/editor/serialize.ts` | Convert editor state to/from `PrefabDocument` |
| `src/render/editor/viewport.ts` | Three.js editor viewport |
| `src/world/prefabs/schema.ts` | Canonical prefab JSON schema |
| `src/render/prefabs/prefab_renderer.ts` | Runtime prefab rendering |

### GLB node overrides and deletions

Editor-side transform overrides (`glbNodeTransforms`) and deleted nodes (`glbNodeHidden`) are persisted by **GLB node name**, not by Three.js UUID. This means:

- Node names are assumed unique within a model. If two nodes share a name, overrides/deletions apply to the first match.
- Hierarchy selections use UUIDs for the current session, but resolve to names before persisting.
- To add a new GLB-node-level operation: resolve the selected UUID→name via `store.getGlbNodeName()`, mutate the entity in `document.ts`, round-trip it through `serialize.ts`, and apply it in both `src/render/editor/viewport.ts` and `src/render/prefabs/prefab_renderer.ts`.

## Server dev setup

```bash
npm run dev:infra     # docker compose up -d postgres redis mailpit
npm run dev:server    # tsx watch src/main.ts (Nest.js, port 3000)
npm run prisma:generate   # prisma generate — agents may run after schema edits
npm run prisma:migrate    # prisma migrate dev — agents may run; use --name <slug> to avoid prompts
npm run prisma:deploy     # prisma migrate deploy — agents may run to apply committed migrations
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

## Debugging GLB nodes & Colliders

### GLB nodes
Animation/door/collider components reference GLB nodes **by name**. A name mismatch = silent failure (node doesn't move, collider doesn't bind).

```bash
# Dump full node hierarchy, meshes, and animation clips of a GLB:
node scripts/inspect_glb.mjs path/to/model.glb
```

In the play/sandbox console (dev only):

```js
window.__claudecitizenShipModel.listNodeNames();   // ship hull node names
```

The renderer's `bindAnimationComponent` (`prefab_renderer.ts`) searches `targetObject.getObjectByName(name)` then falls back to `rootGroup.getObjectByName(name)`. If a node isn't found it logs a warning and marks the binding incomplete; check the browser console for "could not find node" messages.

### Colliders
- **Station**: Rapier physics. `src/physics/station_physics.ts` owns the world; `src/physics/rapier_world.ts` bakes `GameplayCollider` into Rapier trimesh/cuboid bodies. `resolveCharacterAgainstColliders` in `colliders.ts` is the **ship** path (custom capsule push); the **station** path is Rapier's `KinematicCharacterController.computeColliderMovement`.
- **Ship**: `src/player/ship_deck.ts` `resolveDeckColliderStep` calls `resolveCharacterAgainstColliders` every frame with `colliderRig = { gear01, ramp01, doors: doorBlends }`.
- `colliders.ts` has `console.debug` lines (gated to iteration 0) that log when no push is produced and when a push is rejected by `isAllowed`. Filter the devtools console by `[collider]` to see them.

## Common gotchas

- **F-key does nothing for station animation doors**: `consumeActions()` (`src/flight/player_controls.ts`) returns `wasKeyPressed` as a closure. It must snapshot `justPressed` before `justPressed.clear()` runs, otherwise the closure always reads an empty set. `interactPressed` is a captured boolean and is safe; only `wasKeyPressed` had this bug.
- **"Open on spawn" works but F doesn't**: the animation init path (`stationAnimationStates` seeded from `defaultOpen`) runs without any key input, so it masks a broken key-press path. If `defaultOpen` works but F doesn't, suspect the `wasKeyPressed` closure or the `prefab-info` interaction branch.
- **Door animates visually but player can't walk through**: the collider isn't bound to the animation (check `collider.animation` is set) or the Rapier collider isn't being toggled (check `setDoorColliderEnabled` is called in `updateStationAnimations`).
- **Door animation with no bound collider**: `ship_runtime.ts` `bindColliderAnimations` and `station_runtime.ts` `bindStationColliderAnimations` log a warning **per door/animation** that has zero colliders bound to its node(s) — the door will animate but its collider stays enabled (player can't walk through). A collider with no matching node is a normal static floor/hull collider and is intentionally **not** warned about (that was a prior false-positive flood). Check the console for "has no collider bound".

## Key files

| File | Role |
| --- | --- |
| `src/world/prefabs/schema.ts` | Component type definitions + validators |
| `src/world/prefabs/ship_runtime.ts` | Ship prefab → ShipLayout + collider animation binding |
| `src/world/prefabs/station_runtime.ts` | Station prefab → StationLayoutOverride + collider animation binding |
| `src/world/prefabs/collider_runtime.ts` | Bakes `collider` components into `GameplayCollider` objects |
| `src/player/colliders.ts` | Custom capsule-vs-collider resolver (ship); animation matrix math; door-open skip threshold |
| `src/physics/station_physics.ts` | Rapier world + static/dynamic collider sync; door-collider enable/disable |
| `src/physics/rapier_world.ts` | Rapier body/collider creation from GameplayColliders |
| `src/player/ship_rig.ts` | Ship articulation state (gear/ramp/doors) + `isDoorPassable` threshold |
| `src/player/ship_deck.ts` | Ship deck walking + collider step resolution |
| `src/player/station_walk.ts` | Station walking (Rapier character controller) |
| `src/player/station_interaction.ts` | Resolves nearby station interactions from markers |
| `src/app/game_loop.ts` | Main frame loop; owns `stationAnimationStates` + F-key dispatch |
| `src/app/ship_play_session.ts` | Ship sandbox/deck mode; door + ramp toggles |
| `src/render/prefabs/prefab_renderer.ts` | Binds animation components to GLB nodes; `updateAnimations` callback |
| `src/flight/player_controls.ts` | Keyboard/gamepad input; `consumeActions` + `wasKeyPressed` |
| `scripts/inspect_glb.mjs` | CLI GLB node hierarchy dump |

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
