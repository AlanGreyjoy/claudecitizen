# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Primary source of truth

**`AGENTS.md` is the authoritative agent doc** — 400 lines covering prefab/animation wiring, ship flight (flight computer), terrain LOD invariants, cache invalidation rules, collider debugging, and a key-file index. Read it before any architectural or cross-cutting change. This file is the short orientation layer; do not duplicate AGENTS.md content here.

Also read when the domain matches:

| Doc | When |
|-----|------|
| `.cursor/rules/agent-conventions.mdc` | Performance-as-constraint rules (frame budget, main-thread discipline, server tick) |
| `.cursor/skills/ship-flight/SKILL.md` | Flight tuning; symptom → fix tables |
| `docs/docs/architecture/scene-flow.md` | Boot / Game Manager entry pipeline |
| `docs/docs/architecture/game-loop.md` | Hab → Station → Hangar → Open Space |
| `docs/docs/architecture/multiplayer.md` | Cell authority, presence, travel intents, instances |
| `docs/docs/architecture/space-traversal.md` | Open Space host, boarding, Warp Gate |
| `docs/docs/architecture/star-map.md` | Star System ↔ Star Map catalog |
| `docs/docs/architecture/ship-flight.md` | Rapier + flight computer, modes, boost, quantum |
| `docs/docs/architecture/ship-physics.md` | Vacuum inertia, coupled assist, dual-reticle |
| `docs/docs/architecture/ship-combat.md` | Ship weapons, lock-on, lead markers, combat HUD |
| `.cursor/skills/prefab-editor/SKILL.md` | Prefab/scene editor work |
| `.cursor/skills/prd/SKILL.md` | Creating PRD handoff packs under `prds/<slug>/` |
| `.cursor/rules/terrain-cache.mdc` | Terrain/vegetation cache versioning |

**Filename convention is mixed on purpose.** `*.ts` is kebab-case and `*.tsx` is PascalCase (ESLint `check-file` enforces both), but the migration never touched directory names — `src/render/planet_tiles/`, `src/world/surface_spawns/`, `src/app/ship_sandbox/`, `src/render/effects/lake_water/` are still snake_case, and `scripts/` is exempt entirely (`measure_desync.ts`, `inspect_glb.mjs`). Do not "fix" those; a blind `_`→`-` sweep breaks imports.

## Commands

```bash
npm run editor:dev        # PRIMARY dev loop: Electron + Vite HMR + React Fast Refresh
npm run editor            # production-like: build dist-editor, then Electron
npm run typecheck         # tsc --noEmit
npm run lint              # eslint .   (lint:fix to autofix)
npm run build:editor:web  # build:wasm + typecheck + vite build --mode editor
npm run build:web         # release web target (strips unreferenced protected assets)
npm run build:wasm        # shared Rust prediction core → browser WASM

npm run dev:infra         # docker compose up -d postgres redis mailpit
npm run dev:server        # Watchexec rebuild/restart Rust API (TCP 3000, WebTransport UDP 4433)
npm run start:server      # one-shot Rust backend
npm run backend:migrate   # apply committed SQLx migrations

npm run terrain:validate  # terrain LOD / seam / mesh-vs-foot validation
npm run demo              # headless scripted takeoff/orbit/landing
npm run docs:dev          # Docusaurus docs on :3000
npm run transcode:textures -- --project <dir>  # KTX2 twins (needs Tools → Packages / ktx)
node scripts/inspect_glb.mjs path/to/model.glb   # dump GLB node names
```

Rust: `cargo check|clippy|build --manifest-path backend/Cargo.toml`.

### Testing and validation policy

- **No unit tests exist.** There is no test runner and no "run a single test" command; do not add one unprompted.
- Validation = `npm run typecheck` + `npm run lint` (+ `cargo check`/`clippy` for backend). Run both before any commit request unless told otherwise; run `lint` and fix **errors** at the end of any multi-file change.
- **The user owns interactive QA.** Do not start dev servers, do browser/screenshot checks, or launch watchers unless explicitly asked — in particular never bare `vite`, `tsx watch`, or `npm run dev:server`. If server context is needed, check running ports or ask.
- State plainly what validation you skipped.

## Multiple agents run at once

Several agents work this repo concurrently, so the working tree is almost never clean and is not a snapshot of *your* work.

- **Do not get hung up on pre-existing changes.** Unstaged/uncommitted edits, unfamiliar new files, and a long `git status` are expected. They are not breakage, not yours to explain, and not a reason to pause and ask.
- **Do not revert, stash, `git checkout --`, or "clean up" changes you did not make.** Assume another agent is mid-task in them.
- **Stay in your lane.** Touch only the files your task requires. If your task needs a file another agent is clearly rewriting, make the minimal edit and say so; do not restructure around it.
- **Never `git add -A` / `git commit -a`.** Stage explicit paths you touched, and only when the user asks for a commit.
- **Typecheck/lint noise may not be yours.** `npm run typecheck` and `npm run lint` cover the whole repo — errors in files outside your change are someone else's in-flight work. Fix what your change caused, report the rest as pre-existing, and do not chase it.
- If the tree moves under you (a file changed between read and edit), re-read and reapply on top of the newer content rather than overwriting.

## The two surfaces

Everything else is a build output of these:

| Surface | Entry | Owns |
|---------|-------|------|
| AsteronEngine editor | `editor.html` → `src/editor-main.ts` + `editor-desktop/main.mjs` | Projects hub, scenes, prefabs, planets, base characters, Server console, Build Web |
| Game runtime | `index.html` → `src/game-main.ts` | Scene host + play loop — used by in-editor Play *and* the shipped release |
| Rust backend | `backend/` (Cargo workspace: `server`, `sim-core`, `protocol`) | Auth, catalog, persistence, authoritative cells |

There is no browser dev workflow and no separate admin app. The web game ships via **File → Build Web**; features are developed *in the editor*.

## Architecture

### Layering (ESLint-enforced, not just convention)

```
math/  ←  world/  ←  flight/, player/
           ↑              ↑
           └──── npc/ ────┘
                  ↑
               render/          reads domain, never mutates simulation
                  ↑
            game/ → app/        game/ composes the play loop; app/ wires
```

`eslint.config.js` hard-fails on the violations, so the compiler tells you when you cross a line:

- `src/{math,world,flight,player}/**` may not import `three`, `three-mesh-bvh`, `postprocessing`, `@dimforge/rapier3d`, or `**/{render,editor,game}/**`, and may not touch `document`/`window`/`HTMLElement`.
- `src/render/**` may not import `app/` or `game/`.
- Filenames: `*.ts` → kebab-case, `*.tsx` → PascalCase (except `main.tsx`).
- Function/file size ceilings differ per layer: 120 lines/function for domain, `app/`, `game/`; a temporary 400-line ceiling for `render/` and `editor/`; 900-line file cap in `app/`, `game/`, and the two entry modules. Splitting an oversized function is the intended fix, not raising the ceiling.

Export **factories and pure functions** from domain modules, not classes.

### Data model: scenes and prefabs are documents, not code

- A **scene** (`*.scene.json`, schema v3) is a GameObject tree. Components — `game-manager`, `planet`, `player-start`, `prefab-instance`, `ui-screen`, `scene-link`, `instanced-scene`, `scene-exit` — decide what the scene *is*. There is no `settings` block; v1/v2 docs migrate forward on read in `src/world/scenes/schema.ts`.
- A scene of `kind: 'boot'` is the **entry document** the project's `defaultScene` names. It never runs gameplay: its `game-manager` names every hop (Title → Character Create → Starting Hab, plus Open Space and Loading) and `src/app/scene-flow.ts` follows that authored pipeline. The precedence itself is one pure function, `resolveSceneFlowStep` in `src/world/scenes/scene-runtime.ts` — do not add a second place that decides the entry order, and do not key it off `scene.kind`. Full law: `docs/docs/architecture/scene-flow.md`.
- Scenes resolve from **two** locations at the same relative path: when authoring, `src/world/scenes/loader.ts` fetches `/__editor/scene?id=` and the Electron repository reads the open project's `<project>/src/world/scenes/data/`; otherwise it falls back to this checkout's bundled `src/world/scenes/data/`, which holds only the engine-owned menu flow (boot, title, login, character-creation, loading, main-game).
- `src/app/scene-host.ts` loads, switches, pauses, and disposes scenes **in-process**. Scene navigation must never reload the page.
- A **prefab** (`*.prefab.json`) is identified by its document `id`, never its path — moving the file is safe; `editor-desktop/repository.mjs` maps id → path by scanning asset roots. `src/world/prefabs/schema.ts` is the canonical component list; read it first when a component's fields are unclear.
- `ship-runtime.ts` / `station-runtime.ts` flatten prefab trees into runtime layouts (`ShipLayout`, `StationLayoutOverride`) — doors, seats, beds, elevators, pads, colliders.

### Projects are external to this repo

Authoring assets live in the **open project** at `<project>/assets/`, served as `/assets/`. `src/assets/` in this checkout is engine-owned only (skybox, star catalog, brand art) and is reached through ESM imports. Atmosphere LUT EXRs live under `public/atmosphere/` (stable `/atmosphere/` URL) so release builds ship all four siblings without Vite content-hashing only one of them.

`asteron.project.json` at the project root holds `name`, `backendUrl` (release), `editorBackendUrl` (editor Play/Server; defaults localhost), `defaultScene`, `build.outDir`. `src/net/runtime-config.ts` resolves the backend URL at runtime — from `editorBackendUrl` in the editor, from `asteron.runtime.json` in a shipped release. **Never reintroduce a build-time `VITE_API_BASE_URL`.** There is no client API key: players use cookie sessions (`cc_at`/`cc_rt`), operators use `/admin/session`.

Editor → backend calls must go through `/__editor/backend/*`, proxied by the Electron main process. The renderer's `cceditor://app` origin fails the backend's single-origin CORS check and cannot hold session cookies, so direct calls from the renderer cannot work.

### Physics is split three ways — pick the right one

- **On-foot (station)**: Rapier, `src/physics/station-physics.ts`.
- **On-foot (ship deck)**: Rapier in **ship-local** space, `src/physics/ship-physics.ts`. Door/ramp colliders toggle via `setEnabled` from articulation blends.
- **Ship flight**: Rapier owns the flying hull; flight computer emits forces/torques. See `docs/docs/architecture/ship-flight.md`. Do not extend the legacy custom pose integrator.
- **Ship combat**: Combat mode only — blasters / missiles, lock-on, lead markers, combat HUD. See `docs/docs/architecture/ship-combat.md`.

### Terrain: mesh and feet must sample the same grid

The visible mesh and foot placement must resolve identical per-LOD band-limited heights, or the character floats/sinks. `RENDER_SURFACE_SEGMENTS` (`src/world/renderable-surface.ts`, currently 24) and the `TILE_SEGMENTS` alias in `src/render/planet_tiles/domain/constants.ts` are fixed — the foot sampler, lake mesh, and disk cache all assume that count, so do not vary it per quality preset. Per-frame tile build budgets in `src/render/planet_tiles/cache/mesh-cache.ts` exist to prevent 0-FPS freezes; do not bypass them. Full invariant list in AGENTS.md "Terrain mesh vs foot placement" — read it before touching terrain.

Cache versions live in `src/cache/cache-keys.ts`. Planet JSON edits invalidate automatically via fingerprints; **code/algorithm** edits require bumping `TERRAIN_CACHE_VERSION` or `VEGETATION_CACHE_VERSION` by hand. When unsure, bump.

### Multiplayer invariants

**Plan multiplayer in parallel with every gameplay feature** — authority, intents, and peer visibility ship with the change, not as a later bolt-on. Full law: `docs/docs/architecture/multiplayer.md` (AGENTS.md "Authoritative multiplayer"). Architecture docs are target law; code may lag.

`backend/crates/sim-core/` is shared between native Rapier authority and browser WASM prediction. `proto/world.proto` is the canonical wire contract over WebTransport (reliable streams for control/reconciliation, datagrams for intents/snapshots). Cells are single-writer, leased through Redis, fenced by a PostgreSQL epoch. Do not add a WebSocket fallback, a second backend, client-authoritative outcomes, or a second prediction implementation.

## Live editor context via MCP

The `asteron-engine` MCP server (`.mcp.json` → `tools/asteron-mcp/`) reads `~/.asteron/agent.json` written by a running editor and exposes session, open document, hierarchy, selection, play state, disk catalogs, and safe play/save/select/open commands. Use it instead of guessing at project state when the editor is running.

## Non-negotiables

- **Never stage or commit `assets/protected/`** — paid/licensed packs. `public/assets/protected/` is gitignored for the same reason; `npm run build:web` strips then re-copies only prefab-referenced files. Prefab JSON stores paths only, so it is safe to commit.
- No secrets in client code — JWT secrets, DB URLs, API keys are server-side only.
- SQLx owns all schema history: append SQL under `backend/migrations/`. No second ORM or migration system.
- GLB nodes, animations, and colliders bind **by node name**. A name mismatch fails silently (node doesn't move, collider doesn't bind) — `scripts/inspect_glb.mjs` dumps the real names, and `prefab-renderer.ts` logs "could not find node" warnings.
- Performance is a product constraint, not a polish pass. Main thread is sacred: heavy work goes to workers or spreads across frames. If a change can freeze the tab or tank server tick rate, bound it before shipping.
- Multiplayer is designed in parallel — do not defer authority/replication for shared gameplay ("add MP later" is rejected).
- Update `AGENTS.md` alongside this file when architecture boundaries change — `.cursor/rules/agent-conventions.mdc` defers to it.
