# ClaudeCitizen — Agent Conventions

## Two surfaces, nothing else

This project ships **one authoring app and one server**: the **AsteronEngine**
Electron editor and the Rust backend. There is no browser dev workflow, no
second desktop shell, and no standalone admin app. The web game is a *build
target* produced by **File → Build Web**, not a place features are developed.

| Surface | Entry | Owns |
|---------|-------|------|
| AsteronEngine editor | `editor.html` → `src/editor-main.ts` | Projects hub, scenes, prefabs, planets, systems, base characters, menus, Server console, Build Web |
| Game runtime | `index.html` → `src/game-main.ts` | Scene host + play loop; loaded by in-editor Play and by the shipped release |
| Rust backend | `backend/` | Auth, catalog, persistence, authoritative cells |

## Key facts

- **No unit tests.** Unit tests are not part of the normal implementation workflow.
- **User owns interactive QA.** Agents may run non-interactive build and static validation commands such as `cargo check`, `cargo build`, `cargo clippy`, `npm run build:editor:web`, `npm run build:web`, `npm run typecheck`, and `npm run lint` when useful. Agents should not run tests, browser QA, screenshot checks, or dev-server validation unless explicitly asked. When skipping relevant validation, say what was not run. At the end of a multi-file feature or spike, run `npm run lint` and fix any **errors** (and trivial warnings in touched files when practical). For explicit commit requests, run `npm run typecheck` and `npm run lint` first unless told not to.
- **SQLx migrations.** Append migration SQL under `backend/migrations/` and run `npm run backend:migrate` only when explicitly applying schema changes. The Rust migration runner owns all schema history; do not introduce another ORM or migration system.
- **Do not start bare Vite or backend watchers.** Day-to-day editor HMR is `npm run editor:dev` (Electron owns Vite). Do not run `npm run dev:server`, standalone `vite`, `tsx watch`, or similar unless explicitly asked. If server context is needed, check existing ports/processes or ask first.
- **Rust server reloads.** `npm run dev:server` uses Watchexec to rebuild and gracefully restart on backend, Protobuf, Cargo, migration, or backend environment changes. `npm run start:server` is the one-shot runner. Install the watcher with `cargo install watchexec-cli --locked`.
- **TypeScript, ESM** at root (`"type": "module"`). The backend is a Rust 2024 workspace.
- Editor build = Rust/WASM build, `tsc --noEmit`, then `vite build --mode editor`. `npm run build:web` produces the release target. Agents may run either as non-interactive validation.
- Editor launch: `npm run editor:dev` for HMR / Fast Refresh; `npm run editor` for a production-like `dist-editor` build. Cold start shows the **AsteronEngine — Projects** hub; open/create a project before the editor workspace loads.
- **GitHub Actions.** `.github/workflows/quality.yml` runs repository-safety, typecheck/lint, editor and web builds, Rust formatting/clippy/build, and docs builds on pull requests and `main`. `.github/workflows/dependency-review.yml` rejects vulnerable dependency additions. Do not add deploy workflows unless explicitly requested.

## Workspace structure

| Path | Role | Module system | Framework |
|------|------|--------------|-----------|
| `src/` | Editor + game runtime (Three.js) | ESM | Vite |
| `editor-desktop/` | Electron shell, Projects hub, `cceditor:` protocol, backend proxy, Build Web | ESM | Electron |
| `backend/` | Authoritative API + cell simulation (Cargo workspace root) | Rust 2024 | Axum, Rapier, SQLx, Redis, WebTransport |
| `proto/` | Realtime wire contract | Protobuf | prost + browser codec |

Authoring assets live **inside the open AsteronEngine project**, in the single
asset library `<project>/assets/` served at `/assets/`, not at the engine repo
root. The engine checkout's own `src/assets/` holds engine-owned assets only
(atmosphere LUTs, skybox, star catalog, brand art), is reached exclusively
through ESM imports, and is **not** a project asset root.

## Scenes own everything

Scene documents (`*.scene.json`, schema v3) are GameObject trees. Components
decide what a scene is — there is no `settings` block any more; v1/v2 documents
migrate forward on read in `src/world/scenes/schema.ts`.

**Two scene locations, one relative path.** `src/world/scenes/loader.ts` resolves
an id in this order:

1. When authoring (`AUTHORING_ENABLED`), `GET /__editor/scene?id=` — the Electron
   repository reads the **open project** at `<project>/src/world/scenes/data/<id>.scene.json`
   (`editor-desktop/repository.mjs` `sceneDataDir()`).
2. Otherwise the bundled fallback: a recursive `import.meta.glob` over **this
   checkout's** `src/world/scenes/data/*.scene.json`, which holds only the
   engine-owned menu flow (`title`, `login`, `character-creation`, `loading`,
   `main-game`).

So the engine's own scene data is a shipped default, not where project content
belongs. Authoring a scene in the editor writes into the project root.

| Component | Role |
|-----------|------|
| `game-manager` | System, planet, spawn mode |
| `planet` | Planet document reference |
| `player-start` | Spawn pose and mode |
| `prefab-instance` | Places a reusable prefab |
| `ui-screen` | Mounts title / login / character-create / loading UI |
| `scene-link` | Scene transition target (`auto` + `delaySeconds` for timed hops) |
| `instanced-scene` | Per-player content (habs, hangars) |

`src/app/scene-host.ts` is the runtime: it loads a scene, mounts its UI screens
or starts play from its GameObjects, and switches scenes **in-process**. Scene
navigation must not reload the page.

## Project settings and backend config

`asteron.project.json` at the project root holds `name`, `backendUrl`,
`defaultScene`, and `build.outDir`. **File → Project Settings…** edits it;
`/__editor/project-settings` reads and writes it.

- `src/net/runtime-config.ts` resolves the backend URL at startup — from project
  settings in the editor, from `asteron.runtime.json` in a shipped release.
  Never reintroduce a build-time `VITE_API_BASE_URL`.
- **There is no API key.** Players authenticate with the existing cookie session
  (`/auth/login` → `cc_at` / `cc_rt`); operators use `/admin/session`. Nothing
  secret ships to the client.
- Editor → backend requests go through `/__editor/backend/*`, proxied by the
  Electron main process with `net.fetch`. This exists because the renderer's
  `cceditor://app` origin fails the backend's single-origin CORS check and
  cannot store the session cookies. Do not try to call the backend directly from
  the editor renderer.

## Prefab & Animation Architecture

- **Prefabs** (`src/world/prefabs/`) are JSON trees of entities with transforms, GLB assets, and gameplay components. Data files are `*.prefab.json` filed in **any folder** under the project asset library (`<project>/assets/`) — `assets/Prefabs/` is the default landing spot. A prefab's identity is its document `id`, never its path, so moving the file breaks nothing; `editor-desktop/repository.mjs` scans the asset roots to map id to path.
- **Schema** (`src/world/prefabs/schema.ts`) defines every component type and its validator. Read this first when a component's fields are unclear.
- **Ship runtime** (`src/world/prefabs/ship-runtime.ts`) flattens a ship prefab into `ShipLayout` (doors, seats, beds, colliders). Ship doors use the `ship-door` component; bunks use the `bed` component.
- **Station runtime** (`src/world/prefabs/station-runtime.ts`) flattens a station prefab into `StationLayoutOverride` (spawn, elevators, hangar pads, info markers, colliders). Station doors use the `animation` component (toggled via an `interaction` component with `interactionType: "animation"` and `targetAnimationId`).
- **Game loop** (`src/game/create-game-loop.ts`) is a thin orchestrator that composes colocated feature modules under `src/game/`. Station animation blend values (`stationAnimationStates`) live in `src/game/station/animations.ts`; the F-key interaction dispatch lives in `src/game/modes/in-station.ts`.

### Rifle ADS locomotion blending

- `src/player/character-locomotion.ts` owns effective on-foot aim and facing for planet, station, and ship-deck walkers. While effective ADS is active, the whole character turns toward the camera-forward aim direction; otherwise it faces movement. Do not make equipped rifle/pistol stances camera-locked when RMB is not held.
- `src/player/animation/resolve-locomotion.ts` owns the base/upper clip decision. Rifle ADS while idle uses full-body `idle_aiming`; rifle ADS while walking/running uses the current rifle gait as the lower-body base plus `idle_aiming` as the upper-body override.
- Sprint takes precedence over ADS. Moving with the sprint gait suppresses the aim pose, camera-facing lock, and aim camera zoom until the character stops sprinting. Sprint always uses its normal full-body locomotion clip; the drawn-weapon crosshair remains available for hip fire.
- `src/render/characters/sidekick/animation-runtime.ts` splits the clips at `spine_01`. Do not play full-body gait and ADS actions over the same spine/arm tracks, and do not turn ADS into a generic additive delta; both approaches double-drive the upper skeleton and distort the weapon pose.
- The rifle gait GLBs contain materially different root/pelvis rotations. A masked upper clip still inherits those parents, which previously made moving ADS point away from the authored aim direction. `applyUpperParentCompensation` keeps the live gait parents for the legs but cancels their orientation at `spine_01` against the authored ADS parent space.
- Parent compensation is fade-weighted and must be restored before every `AnimationMixer.update()`. Three.js may skip writing an unchanged track, so applying correction repeatedly without restore accumulates rotation drift.
- Switching between full and lower-body variants of the same gait must preserve `AnimationAction.time`; otherwise pressing or releasing RMB visibly restarts the foot cycle.
- Diagnose aim-only orientation bugs in this order: confirm `upperBodyAnimation`, inspect the root/pelvis tracks in both clips, then inspect the spine compensation. Do not patch walk/sprint `yawOffsetDegrees` unless the corresponding full-body clip is also facing incorrectly.

### Friendly station NPCs

- Ambient populations use `npc-spawner` markers connected to an undirected graph of `npc-waypoint` markers. Named/service characters use `npc-placement`.
- `station-runtime.ts` flattens those components into station-local NPC specs. `src/world/npc.ts` validates duplicate/missing ids, cross-floor links, missing route groups, and disconnected graphs.
- `src/npc/station-population.ts` currently runs a deterministic, cosmetic, non-colliding local population. `src/render/main/scene/station-npcs.ts` renders it through the existing character avatar pipeline with distance activation.
- NPC definitions and weighted populations live in `src/npc/catalog.ts`; station prefabs reference ids instead of embedding appearance data.
- Local NPCs must remain non-authoritative. Before adding dialogue outcomes, persistence, inventory, combat, or player collision, promote NPCs to real backend cell entities and snapshot them with an explicit entity kind; do not model them as fake players.

### Animation → collider → interaction wiring

This is the most common source of "door doesn't work" bugs. Trace these paths:

#### Station prefab doors (animation component)

1. **Visual**: `src/game/station/animations.ts` `updateStationAnimations` lerps `stationAnimationStates[id].value` toward `target`, then calls `renderer.getStationRoot().userData.updateAnimations(blends)`. The renderer (`src/render/prefabs/prefab-renderer.ts` `setupUpdateAnimations`) looks up GLB nodes by name and translates/rotates them.
2. **Collider**: station colliders are baked as **static Rapier bodies** in `play-session.ts` `createStationPhysics` → `syncStaticColliders`. They do NOT move with the animation unless bound via `collider.animation` (set in `station-runtime.ts` `bindStationColliderAnimations`). Nodes named by an `animation` component are excluded from parent mesh bakes and auto-given their own collider — same `articulatedNodes` mechanism as ship doors (`stationAnimatedNodeNames`). When bound, `src/game/station/animations.ts` toggles their `setEnabled` state in `updateStationAnimations` based on the open blend.
3. **F-key toggle**: an `interaction` component with `interactionType: "animation"` + `targetAnimationId` produces a `prefab-info` interaction (`station-interaction.ts`). `src/game/modes/in-station.ts` handles it at the `interaction.kind === 'prefab-info'` branch using `actions.wasKeyPressed(keyCode)` — NOT `actions.interactPressed`. See gotcha below.

#### Ship prefab doors (ship-door component)

1. **Visual**: ship model articulation follows door blends from `ship-rig.ts`.
2. **Collider**: collider-deck ships use **Rapier** (`ship-physics.ts`). Door trimeshes bake at rest and are **disabled** when `open01 >= 0.85` (same threshold as stations). Ramp meshes bake **two** Rapier bodies (closed door + open walk) and swap with `ramp01`; parent hull bakes skip **articulated** child nodes, subtree included — every node named by a `ship-door` or the ramp hinge, plus any node carrying its own collider — so the closed door is not embedded as a ghost barrier. `ship-runtime.ts` `articulatedNodeNames` supplies that list to `buildPrefabColliders(doc, { articulatedNodes })`, and any articulated node with no authored collider gets one baked from its own geometry (`<entity>:<node>:collider-articulated`) so it still blocks while closed. Authors can carve out anything else by dragging GLB nodes into the mesh collider's **Exclude from bake** list (`collider.excludeNodes`); it unions with the automatic set. Landing gear is deliberately **not** articulated-excluded: it is exterior, gates no doorway, and pulling it out would drop leg collision from existing ships. Near a parked ship, a ship-local pad plane shares that Rapier world so exterior hull collision and ramp walk are continuous (`shipHasFloorBelow`); freefall off the pad hands back to planet/station.
3. **F-key toggle**: `ship-play-session.ts` / `src/game/modes/on-ship-deck.ts` deck-mode branches use `actions.interactPressed` (a captured boolean) to flip `doorRig.isOpen`.
4. **Collider pass-through**: door trimeshes disable when `open01 >= 0.85` (same threshold as stations).

#### Ship bunks (bed component)

1. Marker empty + `bed` component (radial or raycast trigger, like doors).
2. Deck **F** → `entering-bed` → `in-bed` (always-on mouse head look; **no flight**).
3. **Hold Y** → `leaving-bed` → deck at the bed's stand offset.
4. Baked into `ShipLayout.beds` via `ship-runtime.ts` `collectBeds` (works with ship-controller hulls).

### Ship flight (SC-style IFCS)

Flight is **not** Rapier. Deck walking may use Rapier; flying uses the custom integrator in `src/flight/`.

- **Per-ship feel** is authored on `ship-controller` stats: `massKg`, `maxSpeedMps`, `maxAngularRateRadps`, thrust (N), torque (N·m). Baked into `ShipSpec` via `ship-runtime.ts`. Accel ≈ thrust/mass; turn ≈ torque/(mass × `INERTIA_FACTOR`).
- **Global feel** (mouse aim gain, IFCS damping, coupled bleed, drag) lives in `src/flight/flight-config.ts` — only change when *all* ships feel wrong.
- **Gravity (Star Wars–style):** once airborne, gravity does **not** pull the ship down. Altitude is thruster-only (Space/C). Landing uses ground/hangar clamp. **No auto-level** — roll/pitch attitude sticks until the pilot corrects (preview levels on pad exit).
- **Mouse dual-reticle**: persistent aim pip + nose pip; IFCS PD-tracks aim (`flight-aim.ts`). Hold **F** = cockpit free-look (camera only); while free-looking, gaze + **LMB** activates `cockpit-control` markers (gear/ramp). **Alt+C** = coupled ↔ decoupled.
- **Main play**: `src/game/modes/in-ship.ts` (`MODE_IN_SHIP`) → `integrateFlightBody` + dual reticle HUD (`src/game/hud/frame-hud.ts`).
- **Ship tab playtest** (`src/editor/ship-test.ts`): **Pad** runs `startShipSandboxSession` (flat pad, no terrain); **Planet** runs `startEditorPlay(store, { shipSpawn: 'surface' })`. Both spawn on foot beside the hull with the ramp down and return the same `EditorPlaySession`, so F6/F7/Stop drive them identically. `?shipPrefab=` still boots the pad sandbox as a standalone page.
- **Which hull spawns**: a scene's placed `prefab-instance{prefabKind:'ship'}` flows `scene-runtime.ts` → `PlayWorldParams.shipPrefabOverride` → `activateShipPrefab` → `createWorldState({ shipPrefabId })`. Break any link in that chain and every Play silently flies `DEFAULT_SHIP_PREFAB_ID` (the Starhopper) instead of the authored ship.
- **Tuning workflow**: read `.cursor/skills/ship-flight/SKILL.md` (and `.cursor/rules/ship-flight.mdc`). Symptom → fix tables live there.

## Editor (Electron desktop)

The Electron editor (**AsteronEngine**) is the only authoring workspace. Cold start opens the **Projects** window (New / Open / Recent); choosing a project closes the hub and opens the editor. **File → Open Project…** returns to Projects. Skip the hub with `--project-root=` / `CLAUDECITIZEN_EDITOR_PROJECT_ROOT`. The editor owns project file access through the private `cceditor:` protocol, plays scenes in-window, and builds the release through **File → Build Web**.

| Path | Role |
|------|------|
| `editor-desktop/main.mjs` | Electron shell: `cceditor:` protocol, `/__editor` API, backend proxy, menus, Build Web |
| `editor-desktop/agent_server.mjs` | Loopback agent HTTP API + discovery file for AsteronEngine MCP |
| `editor-desktop/project_hub.mjs` | Recent projects, validation, new-project scaffolding |
| `editor-desktop/repository.mjs` | Project-scoped document read/write, including project settings |
| `src/editor/` | Editor business logic: document store, commands, serialization |
| `src/editor/agent-bridge.ts` | Live EditorStore snapshot/commands for the agent IPC bridge |
| `src/editor/react/` | React shell + panels (Fast Refresh); entry `react/main.tsx` |
| `src/editor/document.ts` | `EditorEntity` model, `EditorStore`, selection, GLB overrides; `documentType: 'scene' \| 'prefab'` |
| `src/editor/play-in-editor.ts` | Play / Pause / Stop of the open document in the Game view |
| `src/editor/create-prefab-from-selection.ts` | Extract a GameObject subtree into a prefab + instance |
| `src/editor/react/panels/ProjectSettingsModal.tsx` | File → Project Settings… (`asteron.project.json`) |
| `src/editor/react/panels/server/ServerConsolePanel.tsx` | Server tab: live `/admin/*` operator console |
| `src/editor/serialize.ts` | Convert editor state to/from `PrefabDocument` / `SceneDocument` |
| `src/render/editor/viewport.ts` | Three.js editor viewport (imperative host) |
| `src/world/scenes/` | Scene documents (GameObject trees), runtime resolution, bundled loader |
| `src/app/scene-host.ts` | Runtime scene host: load, switch, pause, dispose |
| `src/app/play-chrome.ts` | Mountable in-play HUD tree (`play-chrome.html`) |
| `src/world/prefabs/schema.ts` | Canonical prefab JSON schema (+ scene components) |
| `tools/asteron-mcp/` | Stdio MCP server (Cursor) → live editor agent API |

React owns editor chrome and all panel/form UI; `EditorStore` stays framework-agnostic. Tabs: **Scene** (default), Material Manager, **Ship**, Base Characters, Planet Authoring, System Map, Menu Manager, **Server**. Ship is the one tab that shares Scene's viewport/hierarchy/inspector instead of replacing them — it only adds a bar (browse, validate, Test), so it is wired through `EditorWorkspace`, not `TabEditorHosts`. WebGL/canvas preview stages (viewport, planet terrain, system map, base-character stage, menu HUD) stay imperative behind React hosts. Component field editors live in `src/editor/react/panels/component_fields/`.

**Live project/scene context for agents:** use the **AsteronEngine MCP** (`asteron-engine` in `.cursor/mcp.json`). It reads `~/.asteron/agent.json` written by a running editor and exposes session, open document, hierarchy, selection, play state, disk catalogs, and safe play/save/select/open commands. See `editor-desktop/README.md` (“AsteronEngine MCP”).

### Play mode

**F6** plays and stops, **F7** pauses. `startEditorPlay()` serializes the live
`EditorStore` document (unsaved edits included) and hands it to a scene host
mounted in `#editor-play-host`, a fixed overlay carrying a CSS `transform` so the
HUD's `position: fixed` elements are contained by the Game region. The host must
stack above `#editor-root` (`z-index: 260` vs shell `250`) or Play paints under
the opaque editor chrome and looks like a blank blue screen. Pause feeds
`ctx.isPaused()` in `src/game/create-game-loop.ts`. There is no external Play
Mode window — do not reintroduce one.

### GLB node overrides and deletions

Editor-side transform overrides (`glbNodeTransforms`) and deleted nodes (`glbNodeHidden`) are persisted by **GLB node name**, not by Three.js UUID. This means:

- Node names are assumed unique within a model. If two nodes share a name, overrides/deletions apply to the first match.
- Hierarchy selections use UUIDs for the current session, but resolve to names before persisting.
- To add a new GLB-node-level operation: resolve the selected UUID→name via `store.getGlbNodeName()`, mutate the entity in `document.ts`, round-trip it through `serialize.ts`, and apply it in both `src/render/editor/viewport.ts` and `src/render/prefabs/prefab-renderer.ts`.

## Backend dev setup

```bash
npm run dev:infra     # docker compose up -d postgres redis mailpit
npm run dev:server    # watch/rebuild/restart Rust API on TCP 3000 + WebTransport on UDP 4433
npm run start:server  # run the Rust backend once
npm run backend:migrate  # apply committed SQLx migrations
npm run build:wasm       # compile shared prediction code for the browser
```

Backend env template: `backend/.env.example`. JWT secrets, DB URLs, certificate paths, etc. live there.

### Authoritative multiplayer

- Cells are single-writer authorities leased through Redis and fenced by a PostgreSQL epoch.
- `backend/crates/sim-core/` is shared by native Rapier authority and browser WASM prediction.
- `proto/world.proto` is the canonical realtime contract. WebTransport carries reliable control/reconciliation streams plus datagram intents/snapshots.
- PostgreSQL stores durable accounts, catalog, inventory, and cell checkpoints; Redis stores ephemeral tickets, leases, routing streams, and cross-pod snapshot fan-out.
- Never add a WebSocket fallback, second backend, client-authoritative outcomes, or a separate prediction implementation.

## Architecture — Domain-Driven Design

Bounded contexts (do not leak across):

| Context | Path | Owns |
|---------|------|------|
| `world/` | `src/world/` | Planet, terrain, coordinates, surface queries, prefabs |
| `flight/` | `src/flight/` | Ship physics, body dynamics |
| `player/` | `src/player/` | Character, deck, ship interaction, mode transitions |
| `npc/` | `src/npc/` | Non-player definitions, population lifecycle, behavior state |
| `render/` | `src/render/` | Three.js presentation — reads domain, never mutates simulation |

**Dependency direction:**
```
math/  ←  world/  ←  flight/, player/
           ↑               ↑
           └──── npc/ ─────┘  (reads station data + character appearance data)
                    ↑
                  render/  (reads domain; never owns simulation rules)
                    ↑
                  src/app/scene-host.ts  (wires everything; minimal logic)
```

**Import rules:**
- `world/`, `flight/`, `player/`, `npc/` must not import `three`, `render/`, or DOM APIs
- `npc/` may reuse player character-appearance data, but must not own or mutate player state
- `render/` may read from `world/`/`player/`/`npc/` but must not mutate simulation state
- `src/app/scene-host.ts` orchestrates only — no domain logic inline

## Terrain mesh vs foot placement (critical)

The visible terrain mesh and on-foot physics **must sample the same LOD grid**. If they diverge, the character floats or sinks.

- Mesh grid vertices use `sampleAnalyticPlanetSurface()` with the band-limited spacing from `renderableGridSampleSpacingMeters()`. Foot placement uses **`sampleFootPlanetSurface()`** (`world/planet-surface.ts`) at the level from **`getFootSurfaceSampleLevel()`** (`world/foot-surface-level.ts`); both paths must resolve the same per-LOD grid heights.
- Each frame, the tile manager sets that level from `finestSelectedTileLevel` (`render/planet_tiles/domain/tile-coverage.ts`). Character update runs *before* render, so foot sampling uses the **previous frame's** level (one-frame lag is OK).
- Below ~2 km altitude, `shouldSplitTile` forces L17 detail only for **nearby facing tiles** (`GROUND_DETAIL_RADIUS_METERS` in `render/planet_tiles/domain/lod.ts`). The 450 m radius keeps max-detail tile pressure close to the former L16/900 m budget while halving on-foot triangle span.
- Every vertex in a tile uses the tile level's uniform band limit. Do not give inherited even/even vertices coarser octave cutoffs: isolated coarse samples surrounded by fine samples become pyramid spikes or inverted holes. Same-LOD neighbors remain bit-identical; `render/planet_tiles/render/seam-stitching.ts` handles active mixed-LOD boundaries.
- Terrain tiles append radially inset, two-sided skirt walls on all four edges while the main material remains `FrontSide`. `render/planet_tiles/render/seam-stitching.ts` snaps the finer side of active mixed-LOD contacts onto the coarse rendered surface and collapses that edge's skirt; the base skirts remain the fallback for culled or temporarily uncovered neighbors. Changing the stored skirt layout requires updating `TERRAIN_TILE_VERTEX_COUNT` and bumping `TERRAIN_CACHE_VERSION`.
- The terrain fallback chain must reach L0, and the six synchronously built L0 roots must remain pinned in `mesh-cache.ts`. This is the no-hole coverage guarantee when disk/worker tiles are cold, delayed, or over budget.
- `world/base-elevation.ts` owns the terrain recipe through lake carving. `world/rivers.ts` builds one cached, spatially indexed downhill drainage graph from that pre-river surface; vertex sampling only queries the graph. Preserve its acyclic confluences and non-increasing water levels—do not put route solving back in the per-vertex hot path.
- **Do not vary `TILE_SEGMENTS` / `RENDER_SURFACE_SEGMENTS` per quality preset.** The low-poly triangle layout, foot sampler, lake mesh, and disk cache assume a fixed count. Validate cached tiles with `isValidTerrainTileBuffers()`.
- Terrain tiles are non-indexed, flat-shaded triangles with baked per-face palette colors. `terrain-triangulation.ts` owns the alternating diagonal rule shared by mesh generation and foot sampling; do not reintroduce smooth normals or photographic terrain splat textures without an explicit art-direction change.
- **Do not bypass** the per-frame tile build budget in `mesh-cache.ts` — unbounded sync builds freeze at 0 FPS.
- **Debugging:** `npm run terrain:validate` checks horizon coverage, cold-cache/root fallback, packed mesh/foot height and normal agreement, uniform per-LOD sampling, same- and mixed-LOD seams across cube faces, two-sided skirt coverage, routed-water invariants, and finest triangle span. `scripts/measure_desync.ts` compares analytic/mesh heights. `?quality=balanced|performance|high` toggles render presets.

## Terrain & vegetation disk cache invalidation

IndexedDB keys live in `src/cache/cache-keys.ts` (`TERRAIN_CACHE_VERSION`, `VEGETATION_CACHE_VERSION`, `planetCacheId()`, `hashVegetationSettings()`). Cursor rule: `.cursor/rules/terrain-cache.mdc`.

**Planet Authoring / `*.planet.json` — no manual version bump.** Height, regions, hydrology, seed, radius, amplitude → `terrainFingerprint()`; palette → `paletteHash()`; vegetation density/gap/scale/assetUrls → settings hash. New keys miss cache automatically.

**Code/algorithm edits — bump the matching version** (or extend the key) when:

| Change | Action |
|--------|--------|
| Terrain mesh layout, skirts, triangulation, vertex count, worker buffer format | Bump `TERRAIN_CACHE_VERSION` (and vertex-count constants when skirts/layout change) |
| Veg placement formula, LOD sample multipliers, grass/tree assets, stored veg tile schema | Bump `VEGETATION_CACHE_VERSION` |
| Biome/climate accept rules that change instances without changing height probes | Bump `VEGETATION_CACHE_VERSION` (fingerprint only samples heights) |
| Quality sample budgets (`grassSampleCount` / `treeSampleCount`) | Already in the veg storage key via `hashVegetationQualityBudgets` — no version bump for budget-only changes |

When unsure whether probes catch a code change, bump. Stale veg tiles with wrong instance counts tank FPS; stale terrain tiles desync feet from mesh.

## Protected assets security

- Project authoring packs live under the open project's `assets/protected/`.
  That tree is local to the project — **never stage or commit** paid/protected
  packs. The engine repo also gitignores `public/assets/protected/` for the same
  reason. A few protected paths are looked up by fixed convention rather than by
  reference (UAL retarget skeleton, rifle/pistol locomotion packs, the character
  avatar catalog); the scaffolded `assets/README.md` lists them.
- `npm run build:web` strips `dist/assets/protected/` then copies only files
  referenced by saved prefab JSON. Prefabs only store asset paths, so they are
  safe to commit.
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

The renderer's `bindAnimationComponent` (`prefab-renderer.ts`) searches `targetObject.getObjectByName(name)` then falls back to `rootGroup.getObjectByName(name)`. If a node isn't found it logs a warning and marks the binding incomplete; check the browser console for "could not find node" messages.

### Colliders
- **Station**: Rapier physics. `src/physics/station-physics.ts` owns the world; `src/physics/rapier-world.ts` bakes `GameplayCollider` into Rapier trimesh/cuboid bodies. Station walk uses `KinematicCharacterController.computeColliderMovement`.
- **Ship (collider-deck)**: Rapier physics in **ship-local** space. `src/physics/ship-physics.ts` mirrors the station API; `ship-deck.ts` drives locomotion on hull/ramp/pad colliders. Doors/ramp toggle via `setEnabled` from articulation blends. Near a parked ship, on-foot enters that same world (pad + hull) and walks the open ramp continuously; leaving is freefall with no floor underfoot (off the pad) → planet/station at current feet. **Area gating**: `tryEnterShipPadInterest` only hands locomotion to the ship world when the player shares the ship's walkable area — in a station the ship must rest on a hangar pad (`sampleHangarRest`) in the player's current `stationRoomId`, and on-foot outdoors never targets a hangar-parked ship. The raw ship-local proximity box (`isNearParkedShipPad`, ±36 m) reaches through station walls/floors; do not call it ungated.
- **Ship flight**: custom IFCS in `flight-body.ts` / `flight-aim.ts` — **do not** put flight simulation in Rapier. Rapier is for on-foot deck/station contact only.

## Common gotchas

- **F6 Play is a solid blue/dark screen but footsteps work**: `#editor-play-host` is a sibling of `#editor-root`. The editor shell (`sc-ui.css`) is fixed at `z-index: 250` with an opaque background; if the play host stacks below that, the canvas paints but stays invisible under the shell (`--ed-viewport` / `#141a21` shows through). Keep `#editor-play-host` above the shell (`z-index: 260` in `src/editor/styles.ts`). Also mount play chrome into `#editor-play-host`, not `document.body` — a body-mounted chrome leaves the host as an empty overlay that eats clicks. Symptom looks like a render/GPU failure; it is stacking.
- **F-key does nothing for station animation doors**: `consumeActions()` (`src/input/player-controls.ts`) returns `wasKeyPressed` as a closure. It must snapshot `justPressed` before `justPressed.clear()` runs, otherwise the closure always reads an empty set. `interactPressed` is a captured boolean and is safe; only `wasKeyPressed` had this bug.
- **"Open on spawn" works but F doesn't**: the animation init path (`stationAnimationStates` seeded from `defaultOpen`) runs without any key input, so it masks a broken key-press path. If `defaultOpen` works but F doesn't, suspect the `wasKeyPressed` closure or the `prefab-info` interaction branch.
- **Door animates visually but player can't walk through**: the collider isn't bound to the animation (check `collider.animation` is set) or the Rapier collider isn't being toggled (check `setDoorColliderEnabled` is called in `updateStationAnimations`).
- **Door animation with no bound collider**: `ship-runtime.ts` `bindColliderAnimations` and `station-runtime.ts` `bindStationColliderAnimations` log a warning **per door/animation** that has zero colliders bound to its node(s) — the door will animate but its collider stays enabled (player can't walk through). A collider with no matching node is a normal static floor/hull collider and is intentionally **not** warned about (that was a prior false-positive flood). Check the console for "has no collider bound".
- **Ship pitch bounces after mouse aim**: IFCS overshoot — raise `AIM_IFCS_DAMPING` in `flight-config.ts` or lower per-ship pitch torque / `maxAngularRateRadps`. See ship-flight skill.
- **One ship too twitchy / sluggish**: tune that prefab's `ship-controller` mass/thrust/torque — do not edit `FLIGHT_CONFIG` unless every hull is wrong.
- **Preview pilot won't exit**: Hold Y should always leave the seat (same as main play). If the hold doesn't fire, check `exitSeat` binding / `updateExitSeatHold` in `player-controls.ts`.

## Key files

| File | Role |
| --- | --- |
| `src/world/prefabs/schema.ts` | Component type definitions + validators |
| `src/world/prefabs/ship-runtime.ts` | Ship prefab → ShipLayout + collider animation binding |
| `src/world/prefabs/station-runtime.ts` | Station prefab → StationLayoutOverride + collider animation binding |
| `src/world/npc.ts` | Station NPC authoring specs + route validation |
| `src/npc/catalog.ts` | Reusable friendly NPC definitions and population pools |
| `src/npc/station-population.ts` | Deterministic cosmetic station population + waypoint movement |
| `src/render/main/scene/station-npcs.ts` | Station NPC avatar lifecycle, animation, and distance activation |
| `src/physics/prefab-colliders.ts` | Bakes `collider` components into `GameplayCollider` objects |
| `src/physics/ship-physics.ts` | Ship-local Rapier world for collider-deck walking (doors/ramp/pad enable toggles) |
| `src/physics/colliders.ts` | GameplayCollider types, mesh BVH bake/ground sample, legacy custom capsule push |
| `src/physics/station-physics.ts` | Rapier world + static/dynamic collider sync; door-collider enable/disable |
| `src/physics/rapier-world.ts` | Rapier body/collider creation from GameplayColliders |
| `src/player/ship-layout.ts` | `ShipSpec` + defaults (mass, thrust, torque) |
| `src/player/ship-rig.ts` | Ship articulation state (gear/ramp/doors) |
| `src/player/ship-deck.ts` | Ship deck walking + collider step resolution |
| `src/player/character-settings.ts` | Editor-tunable walk/sprint/jump speeds; persisted in `src/player/data/character-settings.json` via the Electron `/__editor/character-settings` endpoint (Base Characters → Char Settings) |
| `src/player/animation/data/*.controller.json` | Engine-owned animation controllers (stance → clip bindings). Base Characters → Controllers reads/writes these via `/__editor/animation-controllers`. Clip GLBs live in the open project under `assets/animations/` |
| `src/player/character-locomotion.ts` | Shared on-foot locomotion policy for all walkers (planet/station/deck): walk input intent, effective ADS (sprint suppresses aim), facing resolution (active aim faces camera), clip selection, jump animation phases |
| `src/player/animation/resolve-locomotion.ts` | Selects full-body locomotion and optional rifle ADS upper-body layers |
| `src/render/characters/sidekick/animation-runtime.ts` | Retargeted clip playback, lower/upper masks, crossfades, and ADS parent-space compensation |
| `src/player/station-walk.ts` | Station walking (Rapier character controller) |
| `src/player/station-interaction.ts` | Resolves nearby station interactions from markers |
| `src/flight/flight-config.ts` | Global IFCS / drag / damping / mouse aim knobs |
| `src/flight/flight-aim.ts` | Aim state, mouse → aim, PD IFCS torque demand |
| `src/flight/flight-body.ts` | Mass/thrust/torque integrate (planet + sandbox flat) |
| `src/input/player-controls.ts` | Keyboard/gamepad input; aim persistence; Alt+C coupled; `wasKeyPressed` |
| `src/game/create-game-loop.ts` | Thin play-loop orchestrator; wires feature modules + owns `frame()`/start/stop |
| `src/game/modes/` | Per-mode frame logic (on-foot, in-ship, in-bed, ship-deck, station, elevator, transitions) |
| `src/game/station/animations.ts` | `stationAnimationStates` blend + door-collider enable toggle |
| `src/app/ship-play-session.ts` | `startShipSandboxSession` (disposable pad sandbox) + `?shipPrefab=` page wrapper |
| `src/editor/ship-test.ts` | Ship tab playtest launcher (pad vs planet) |
| `src/player/ship-layout-issues.ts` | Pure ship authoring checks rendered by the Ship tab |
| `src/render/effects/hud/flight-reticle.ts` | Dual-reticle aim + nose pips |
| `src/player/flight-camera-feel.ts` | Thrust FOV + boost shake (ship-controller stats) |
| `src/player/cockpit-gaze.ts` | Cockpit look-at pick + gear/ramp activate |
| `src/player/cockpit-stats.ts` | Cockpit-stat instrument visibility / screen projection |
| `src/render/effects/hud/cockpit-gaze-hud.ts` | Screen-space cockpit control labels |
| `src/render/effects/hud/cockpit-speed-hud.ts` | Speed number + bar (boost-aware) |
| `src/render/prefabs/prefab-renderer.ts` | Binds animation components to GLB nodes; `updateAnimations` / `updateParticles` callbacks |
| `src/render/particles/` | Unity-style `particle-system` runtime (billboards, modules, plane collision only) |
| `scripts/inspect_glb.mjs` | CLI GLB node hierarchy dump |
| `.cursor/skills/ship-flight/SKILL.md` | Flight tuning skill (mass/thrust/IFCS symptoms) |
| `.cursor/skills/prefab-editor/SKILL.md` | Prefab editor skill |
| `.cursor/skills/prd/SKILL.md` | PRD handoff packs under `prds/<slug>/` (README, PRD, phases, checklist) |

## Utility scripts

| Script | Purpose |
|--------|---------|
| `scripts/inspect_glb.mjs` | List node names/bindings in a GLB (for `ship-door` bindings) |
| `scripts/measure_desync.ts` | Compare analytic vs mesh height at a landing site |
| `scripts/validate_terrain_system.ts` | Validate terrain LOD, seams, mesh/foot fidelity, and routed hydrology |
| `scripts/spike-demo.ts` | Headless scripted takeoff/orbit/landing (`npm run demo`) |
| `scripts/bake_ship_textures.py` | Fix Unity trim-sheet materials for Three.js PBR |
| `scripts/check_page.mjs` | Page validation |

## Other conventions

- `.cursor/rules/agent-conventions.mdc` exists and defers to this file as the primary source — update both if changing architecture boundaries.
- Project skills: `.cursor/skills/prefab-editor/`, `.cursor/skills/ship-flight/`, `.cursor/skills/prd/` — read when editing those domains (PRD packs when creating `prds/` handoffs).
- Export **factories + pure functions** from domain modules (not classes). Three.js objects never appear in `world/` or `flight/`.
- Prefab JSON lives in the project asset library as `<folder>/<id>.prefab.json` and is committed (metadata only) — `.gitignore` re-includes `*.prefab.json` under the otherwise-ignored `/assets/` tree. The game bundles them via a recursive `import.meta.glob`.
- **Filenames:** `*.ts` is kebab-case, `*.tsx` is PascalCase (except Vite's `main.tsx`) — enforced by `eslint-plugin-check-file`. Directories were not migrated and several remain snake_case (`src/render/planet_tiles/`, `src/world/surface_spawns/`, `src/app/ship_sandbox/`, `src/render/effects/lake_water/`), as do `scripts/` files, which are exempt.
- Response style (caveman mode) is configured per-tool in `.cursor/rules/caveman.mdc`, `.clinerules/caveman.md`, and `.windsurf/rules/caveman.md` — not here. This file is architecture only.
