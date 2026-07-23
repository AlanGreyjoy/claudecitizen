# ClaudeCitizen — Agent Conventions

## Key facts

- **No backend unit tests.** Unit tests are not part of the normal implementation workflow.
- **User owns interactive QA.** Agents may run non-interactive build and static validation commands such as `cargo check`, `cargo build`, `cargo clippy`, `npm run build`, `npm run typecheck`, and `npm run lint` when useful. Agents should not run tests, browser QA, screenshot checks, or dev-server validation unless explicitly asked. When skipping relevant validation, say what was not run. At the end of a multi-file feature or spike, run `npm run lint` and fix any **errors** (and trivial warnings in touched files when practical). For explicit commit requests, run `npm run typecheck` and `npm run lint` first unless told not to.
- **SQLx migrations.** Append migration SQL under `backend/migrations/` and run `npm run backend:migrate` only when explicitly applying schema changes. The Rust migration runner owns all schema history; do not introduce another ORM or migration system.
- **Do not start dev servers.** Vite and API servers are normally already running locally. Do not run `npm run dev`, `npm run dev:server`, `npm run start:dev`, `vite`, `tsx watch`, or similar long-running local servers unless explicitly asked. If server context is needed, check existing ports/processes or ask first.
- **Rust server reloads.** `npm run dev:server` uses Watchexec to rebuild and gracefully restart on backend, Protobuf, Cargo, migration, or backend environment changes. `npm run start:server` is the one-shot runner. Install the watcher with `cargo install watchexec-cli --locked`.
- **TypeScript, ESM** at root (`"type": "module"`). The backend is a Rust 2024 workspace.
- Browser build = Rust/WASM build, `tsc --noEmit`, then Vite bundle. Agents may run it as non-interactive validation.
- Dev server on port **4173**: `npm run dev`. Editor only available in dev mode.
- **GitHub Actions.** `.github/workflows/quality.yml` runs repository-safety, browser typecheck/lint/build, Rust formatting/clippy/build, and docs builds on pull requests and `main`. `.github/workflows/dependency-review.yml` rejects vulnerable dependency additions. Netlify remains responsible for browser deployment; do not add deploy workflows unless explicitly requested.

## Workspace structure

| Path | Role | Module system | Framework |
|------|------|--------------|-----------|
| `src/` | Browser game (Vite + Three.js) | ESM | Vite |
| `backend/` | Authoritative API + cell simulation | Rust 2024 | Axum, Rapier, SQLx, Redis, WebTransport |
| `proto/` | Realtime wire contract | Protobuf | prost + browser codec |
| `deploy/k8s/` | Horizontally scalable backend deployment | YAML | Kubernetes |
| `editor/assets/` | Local editor asset library (gitignored) | — | — |

## Prefab & Animation Architecture

- **Prefabs** (`src/world/prefabs/`) are JSON trees of entities with transforms, GLB assets, and gameplay components. Data files live in `src/world/prefabs/data/*.prefab.json`.
- **Schema** (`src/world/prefabs/schema.ts`) defines every component type and its validator. Read this first when a component's fields are unclear.
- **Ship runtime** (`src/world/prefabs/ship_runtime.ts`) flattens a ship prefab into `ShipLayout` (doors, seats, beds, colliders). Ship doors use the `ship-door` component; bunks use the `bed` component.
- **Station runtime** (`src/world/prefabs/station_runtime.ts`) flattens a station prefab into `StationLayoutOverride` (spawn, elevators, hangar pads, info markers, colliders). Station doors use the `animation` component (toggled via an `interaction` component with `interactionType: "animation"` and `targetAnimationId`).
- **Game loop** (`src/app/game_loop.ts`) owns `stationAnimationStates` (per-animation blend values) and the F-key interaction dispatch.

### Rifle ADS locomotion blending

- `src/player/character_locomotion.ts` owns effective on-foot aim and facing for planet, station, and ship-deck walkers. While effective ADS is active, the whole character turns toward the camera-forward aim direction; otherwise it faces movement. Do not make equipped rifle/pistol stances camera-locked when RMB is not held.
- `src/player/animation/resolve_locomotion.ts` owns the base/upper clip decision. Rifle ADS while idle uses full-body `idle_aiming`; rifle ADS while walking/running uses the current rifle gait as the lower-body base plus `idle_aiming` as the upper-body override.
- Sprint takes precedence over ADS. Moving with the sprint gait suppresses the aim pose, camera-facing lock, and aim camera zoom until the character stops sprinting. Sprint always uses its normal full-body locomotion clip; the drawn-weapon crosshair remains available for hip fire.
- `src/render/characters/sidekick/animation_runtime.ts` splits the clips at `spine_01`. Do not play full-body gait and ADS actions over the same spine/arm tracks, and do not turn ADS into a generic additive delta; both approaches double-drive the upper skeleton and distort the weapon pose.
- The rifle gait GLBs contain materially different root/pelvis rotations. A masked upper clip still inherits those parents, which previously made moving ADS point away from the authored aim direction. `applyUpperParentCompensation` keeps the live gait parents for the legs but cancels their orientation at `spine_01` against the authored ADS parent space.
- Parent compensation is fade-weighted and must be restored before every `AnimationMixer.update()`. Three.js may skip writing an unchanged track, so applying correction repeatedly without restore accumulates rotation drift.
- Switching between full and lower-body variants of the same gait must preserve `AnimationAction.time`; otherwise pressing or releasing RMB visibly restarts the foot cycle.
- Diagnose aim-only orientation bugs in this order: confirm `upperBodyAnimation`, inspect the root/pelvis tracks in both clips, then inspect the spine compensation. Do not patch walk/sprint `yawOffsetDegrees` unless the corresponding full-body clip is also facing incorrectly.

### Friendly station NPCs

- Ambient populations use `npc-spawner` markers connected to an undirected graph of `npc-waypoint` markers. Named/service characters use `npc-placement`.
- `station_runtime.ts` flattens those components into station-local NPC specs. `src/world/npc.ts` validates duplicate/missing ids, cross-floor links, missing route groups, and disconnected graphs.
- `src/npc/station_population.ts` currently runs a deterministic, cosmetic, non-colliding local population. `src/render/main/scene/station_npcs.ts` renders it through the existing character avatar pipeline with distance activation.
- NPC definitions and weighted populations live in `src/npc/catalog.ts`; station prefabs reference ids instead of embedding appearance data.
- Local NPCs must remain non-authoritative. Before adding dialogue outcomes, persistence, inventory, combat, or player collision, promote NPCs to real backend cell entities and snapshot them with an explicit entity kind; do not model them as fake players.

### Animation → collider → interaction wiring

This is the most common source of "door doesn't work" bugs. Trace these paths:

#### Station prefab doors (animation component)

1. **Visual**: `game_loop.ts` `updateStationAnimations` lerps `stationAnimationStates[id].value` toward `target`, then calls `renderer.getStationRoot().userData.updateAnimations(blends)`. The renderer (`src/render/prefabs/prefab_renderer.ts` `setupUpdateAnimations`) looks up GLB nodes by name and translates/rotates them.
2. **Collider**: station colliders are baked as **static Rapier bodies** in `play_session.ts` `createStationPhysics` → `syncStaticColliders`. They do NOT move with the animation unless bound via `collider.animation` (set in `station_runtime.ts` `bindStationColliderAnimations`). When bound, `game_loop.ts` toggles their `setEnabled` state in `updateStationAnimations` based on the open blend.
3. **F-key toggle**: an `interaction` component with `interactionType: "animation"` + `targetAnimationId` produces a `prefab-info` interaction (`station_interaction.ts`). `game_loop.ts` handles it at the `interaction.kind === 'prefab-info'` branch using `actions.wasKeyPressed(keyCode)` — NOT `actions.interactPressed`. See gotcha below.

#### Ship prefab doors (ship-door component)

1. **Visual**: ship model articulation follows door blends from `ship_rig.ts`.
2. **Collider**: collider-deck ships use **Rapier** (`ship_physics.ts`). Door trimeshes bake at rest and are **disabled** when `open01 >= 0.85` (same threshold as stations). Ramp meshes bake **two** Rapier bodies (closed door + open walk) and swap with `ramp01`; parent hull bakes skip child nodes that have their own colliders so the closed door is not embedded as a ghost barrier. Near a parked ship, a ship-local pad plane shares that Rapier world so exterior hull collision and ramp walk are continuous (`shipHasFloorBelow`); freefall off the pad hands back to planet/station.
3. **F-key toggle**: `ship_play_session.ts` / `game_loop.ts` deck-mode branches use `actions.interactPressed` (a captured boolean) to flip `doorRig.isOpen`.
4. **Collider pass-through**: door trimeshes disable when `open01 >= 0.85` (same threshold as stations).

#### Ship bunks (bed component)

1. Marker empty + `bed` component (radial or raycast trigger, like doors).
2. Deck **F** → `entering-bed` → `in-bed` (always-on mouse head look; **no flight**).
3. **Hold Y** → `leaving-bed` → deck at the bed's stand offset.
4. Baked into `ShipLayout.beds` via `ship_runtime.ts` `collectBeds` (works with ship-controller hulls).

### Ship flight (SC-style IFCS)

Flight is **not** Rapier. Deck walking may use Rapier; flying uses the custom integrator in `src/flight/`.

- **Per-ship feel** is authored on `ship-controller` stats: `massKg`, `maxSpeedMps`, `maxAngularRateRadps`, thrust (N), torque (N·m). Baked into `ShipSpec` via `ship_runtime.ts`. Accel ≈ thrust/mass; turn ≈ torque/(mass × `INERTIA_FACTOR`).
- **Global feel** (mouse aim gain, IFCS damping, coupled bleed, drag) lives in `src/flight/flight_config.ts` — only change when *all* ships feel wrong.
- **Gravity (Star Wars–style):** once airborne, gravity does **not** pull the ship down. Altitude is thruster-only (Space/C). Landing uses ground/hangar clamp. **No auto-level** — roll/pitch attitude sticks until the pilot corrects (preview levels on pad exit).
- **Mouse dual-reticle**: persistent aim pip + nose pip; IFCS PD-tracks aim (`flight_aim.ts`). Hold **F** = cockpit free-look (camera only); while free-looking, gaze + **LMB** activates `cockpit-control` markers (gear/ramp). **Alt+C** = coupled ↔ decoupled.
- **Main play**: `game_loop.ts` `MODE_IN_SHIP` → `integrateFlightBody` + dual reticle HUD.
- **Preview Ship** (`?shipPrefab=` / `ship_play_session.ts`): sit pilot → takeoff/flight over the flat pad (same flight model). Hold **Y** exits the seat anytime (settles onto the pad when nearby).
- **Tuning workflow**: read `.cursor/skills/ship-flight/SKILL.md` (and `.cursor/rules/ship-flight.mdc`). Symptom → fix tables live there.

## Editor (dev-only)

The in-browser prefab editor is only available under `npm run dev`. It assembles prefabs from entities, GLB assets, primitives, and gameplay components.

| Path | Role |
|------|------|
| `src/editor/` | Editor business logic: document store, commands, serialization |
| `src/editor/react/` | React shell + panels (Fast Refresh); entry `react/main.tsx` |
| `src/editor/document.ts` | `EditorEntity` model, `EditorStore`, selection, GLB overrides |
| `src/editor/react/panels/HierarchyPanel.tsx` | Scene tree / outliner |
| `src/editor/react/panels/InspectorPanel.tsx` | Entity properties & component editor chrome |
| `src/editor/react/panels/ProjectPanel.tsx` | Asset browser |
| `src/editor/serialize.ts` | Convert editor state to/from `PrefabDocument` |
| `src/render/editor/viewport.ts` | Three.js editor viewport (imperative host) |
| `src/world/prefabs/schema.ts` | Canonical prefab JSON schema |
| `src/render/prefabs/prefab_renderer.ts` | Runtime prefab rendering |

React owns editor chrome; `EditorStore` stays framework-agnostic. WebGL/canvas tab editors (viewport, planet, system map, base characters, menu manager) mount via imperative hosts. Dense per-component inspector fields and particle forms still use DOM builders under `panels/`.

### GLB node overrides and deletions

Editor-side transform overrides (`glbNodeTransforms`) and deleted nodes (`glbNodeHidden`) are persisted by **GLB node name**, not by Three.js UUID. This means:

- Node names are assumed unique within a model. If two nodes share a name, overrides/deletions apply to the first match.
- Hierarchy selections use UUIDs for the current session, but resolve to names before persisting.
- To add a new GLB-node-level operation: resolve the selected UUID→name via `store.getGlbNodeName()`, mutate the entity in `document.ts`, round-trip it through `serialize.ts`, and apply it in both `src/render/editor/viewport.ts` and `src/render/prefabs/prefab_renderer.ts`.

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
                  app/bootstrap.ts   (wires everything; minimal logic)
```

**Import rules:**
- `world/`, `flight/`, `player/`, `npc/` must not import `three`, `render/`, or DOM APIs
- `npc/` may reuse player character-appearance data, but must not own or mutate player state
- `render/` may read from `world/`/`player/`/`npc/` but must not mutate simulation state
- `app/bootstrap.ts` orchestrates only — no domain logic inline

## Terrain mesh vs foot placement (critical)

The visible terrain mesh and on-foot physics **must sample the same LOD grid**. If they diverge, the character floats or sinks.

- Mesh grid vertices use `sampleAnalyticPlanetSurface()` with the band-limited spacing from `renderableGridSampleSpacingMeters()`. Foot placement uses **`sampleFootPlanetSurface()`** (`world/planet_surface.ts`) at the level from **`getFootSurfaceSampleLevel()`** (`world/foot_surface_level.ts`); both paths must resolve the same per-LOD grid heights.
- Each frame, the tile manager sets that level from `finestSelectedTileLevel` (`render/planet_tiles/domain/tile_coverage.ts`). Character update runs *before* render, so foot sampling uses the **previous frame's** level (one-frame lag is OK).
- Below ~2 km altitude, `shouldSplitTile` forces L17 detail only for **nearby facing tiles** (`GROUND_DETAIL_RADIUS_METERS` in `render/planet_tiles/domain/lod.ts`). The 450 m radius keeps max-detail tile pressure close to the former L16/900 m budget while halving on-foot triangle span.
- Every vertex in a tile uses the tile level's uniform band limit. Do not give inherited even/even vertices coarser octave cutoffs: isolated coarse samples surrounded by fine samples become pyramid spikes or inverted holes. Same-LOD neighbors remain bit-identical; `render/seam_stitching.ts` handles active mixed-LOD boundaries.
- Terrain tiles append radially inset, two-sided skirt walls on all four edges while the main material remains `FrontSide`. `render/seam_stitching.ts` snaps the finer side of active mixed-LOD contacts onto the coarse rendered surface and collapses that edge's skirt; the base skirts remain the fallback for culled or temporarily uncovered neighbors. Changing the stored skirt layout requires updating `TERRAIN_TILE_VERTEX_COUNT` and bumping `TERRAIN_CACHE_VERSION`.
- The terrain fallback chain must reach L0, and the six synchronously built L0 roots must remain pinned in `mesh_cache.ts`. This is the no-hole coverage guarantee when disk/worker tiles are cold, delayed, or over budget.
- `world/base_elevation.ts` owns the terrain recipe through lake carving. `world/rivers.ts` builds one cached, spatially indexed downhill drainage graph from that pre-river surface; vertex sampling only queries the graph. Preserve its acyclic confluences and non-increasing water levels—do not put route solving back in the per-vertex hot path.
- **Do not vary `TILE_SEGMENTS` / `RENDER_SURFACE_SEGMENTS` per quality preset.** The low-poly triangle layout, foot sampler, lake mesh, and disk cache assume a fixed count. Validate cached tiles with `isValidTerrainTileBuffers()`.
- Terrain tiles are non-indexed, flat-shaded triangles with baked per-face palette colors. `terrain_triangulation.ts` owns the alternating diagonal rule shared by mesh generation and foot sampling; do not reintroduce smooth normals or photographic terrain splat textures without an explicit art-direction change.
- **Do not bypass** the per-frame tile build budget in `mesh_cache.ts` — unbounded sync builds freeze at 0 FPS.
- **Debugging:** `npm run terrain:validate` checks horizon coverage, cold-cache/root fallback, packed mesh/foot height and normal agreement, uniform per-LOD sampling, same- and mixed-LOD seams across cube faces, two-sided skirt coverage, routed-water invariants, and finest triangle span. `scripts/measure_desync.ts` compares analytic/mesh heights. `?quality=balanced|performance|high` toggles render presets.

## Terrain & vegetation disk cache invalidation

IndexedDB keys live in `src/cache/cache_keys.ts` (`TERRAIN_CACHE_VERSION`, `VEGETATION_CACHE_VERSION`, `planetCacheId()`, `hashVegetationSettings()`). Cursor rule: `.cursor/rules/terrain-cache.mdc`.

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
- **Station**: Rapier physics. `src/physics/station_physics.ts` owns the world; `src/physics/rapier_world.ts` bakes `GameplayCollider` into Rapier trimesh/cuboid bodies. Station walk uses `KinematicCharacterController.computeColliderMovement`.
- **Ship (collider-deck)**: Rapier physics in **ship-local** space. `src/physics/ship_physics.ts` mirrors the station API; `ship_deck.ts` drives locomotion on hull/ramp/pad colliders. Doors/ramp toggle via `setEnabled` from articulation blends. Near a parked ship, on-foot enters that same world (pad + hull) and walks the open ramp continuously; leaving is freefall with no floor underfoot (off the pad) → planet/station at current feet. **Area gating**: `tryEnterShipPadInterest` only hands locomotion to the ship world when the player shares the ship's walkable area — in a station the ship must rest on a hangar pad (`sampleHangarRest`) in the player's current `stationRoomId`, and on-foot outdoors never targets a hangar-parked ship. The raw ship-local proximity box (`isNearParkedShipPad`, ±36 m) reaches through station walls/floors; do not call it ungated.
- **Ship flight**: custom IFCS in `flight_body.ts` / `flight_aim.ts` — **do not** put flight simulation in Rapier. Rapier is for on-foot deck/station contact only.

## Common gotchas

- **F-key does nothing for station animation doors**: `consumeActions()` (`src/input/player_controls.ts`) returns `wasKeyPressed` as a closure. It must snapshot `justPressed` before `justPressed.clear()` runs, otherwise the closure always reads an empty set. `interactPressed` is a captured boolean and is safe; only `wasKeyPressed` had this bug.
- **"Open on spawn" works but F doesn't**: the animation init path (`stationAnimationStates` seeded from `defaultOpen`) runs without any key input, so it masks a broken key-press path. If `defaultOpen` works but F doesn't, suspect the `wasKeyPressed` closure or the `prefab-info` interaction branch.
- **Door animates visually but player can't walk through**: the collider isn't bound to the animation (check `collider.animation` is set) or the Rapier collider isn't being toggled (check `setDoorColliderEnabled` is called in `updateStationAnimations`).
- **Door animation with no bound collider**: `ship_runtime.ts` `bindColliderAnimations` and `station_runtime.ts` `bindStationColliderAnimations` log a warning **per door/animation** that has zero colliders bound to its node(s) — the door will animate but its collider stays enabled (player can't walk through). A collider with no matching node is a normal static floor/hull collider and is intentionally **not** warned about (that was a prior false-positive flood). Check the console for "has no collider bound".
- **Ship pitch bounces after mouse aim**: IFCS overshoot — raise `AIM_IFCS_DAMPING` in `flight_config.ts` or lower per-ship pitch torque / `maxAngularRateRadps`. See ship-flight skill.
- **One ship too twitchy / sluggish**: tune that prefab's `ship-controller` mass/thrust/torque — do not edit `FLIGHT_CONFIG` unless every hull is wrong.
- **Preview pilot won't exit**: Hold Y should always leave the seat (same as main play). If the hold doesn't fire, check `exitSeat` binding / `updateExitSeatHold` in `player_controls.ts`.

## Key files

| File | Role |
| --- | --- |
| `src/world/prefabs/schema.ts` | Component type definitions + validators |
| `src/world/prefabs/ship_runtime.ts` | Ship prefab → ShipLayout + collider animation binding |
| `src/world/prefabs/station_runtime.ts` | Station prefab → StationLayoutOverride + collider animation binding |
| `src/world/npc.ts` | Station NPC authoring specs + route validation |
| `src/npc/catalog.ts` | Reusable friendly NPC definitions and population pools |
| `src/npc/station_population.ts` | Deterministic cosmetic station population + waypoint movement |
| `src/render/main/scene/station_npcs.ts` | Station NPC avatar lifecycle, animation, and distance activation |
| `src/physics/prefab_colliders.ts` | Bakes `collider` components into `GameplayCollider` objects |
| `src/physics/ship_physics.ts` | Ship-local Rapier world for collider-deck walking (doors/ramp/pad enable toggles) |
| `src/physics/colliders.ts` | GameplayCollider types, mesh BVH bake/ground sample, legacy custom capsule push |
| `src/physics/station_physics.ts` | Rapier world + static/dynamic collider sync; door-collider enable/disable |
| `src/physics/rapier_world.ts` | Rapier body/collider creation from GameplayColliders |
| `src/player/ship_layout.ts` | `ShipSpec` + defaults (mass, thrust, torque) |
| `src/player/ship_rig.ts` | Ship articulation state (gear/ramp/doors) |
| `src/player/ship_deck.ts` | Ship deck walking + collider step resolution |
| `src/player/character_settings.ts` | Editor-tunable walk/sprint/jump speeds; persisted in `src/player/data/character-settings.json` via the dev-only `/__editor/character-settings` endpoint (Base Characters → Char Settings) |
| `src/player/character_locomotion.ts` | Shared on-foot locomotion policy for all walkers (planet/station/deck): walk input intent, effective ADS (sprint suppresses aim), facing resolution (active aim faces camera), clip selection, jump animation phases |
| `src/player/animation/resolve_locomotion.ts` | Selects full-body locomotion and optional rifle ADS upper-body layers |
| `src/render/characters/sidekick/animation_runtime.ts` | Retargeted clip playback, lower/upper masks, crossfades, and ADS parent-space compensation |
| `src/player/station_walk.ts` | Station walking (Rapier character controller) |
| `src/player/station_interaction.ts` | Resolves nearby station interactions from markers |
| `src/flight/flight_config.ts` | Global IFCS / drag / damping / mouse aim knobs |
| `src/flight/flight_aim.ts` | Aim state, mouse → aim, PD IFCS torque demand |
| `src/flight/flight_body.ts` | Mass/thrust/torque integrate (planet + sandbox flat) |
| `src/input/player_controls.ts` | Keyboard/gamepad input; aim persistence; Alt+C coupled; `wasKeyPressed` |
| `src/app/game_loop.ts` | Main frame loop; flight + `stationAnimationStates` + F-key dispatch |
| `src/app/ship_play_session.ts` | Ship sandbox: deck walk + pilot flight preview |
| `src/render/effects/hud/flight_reticle.ts` | Dual-reticle aim + nose pips |
| `src/player/flight_camera_feel.ts` | Thrust FOV + boost shake (ship-controller stats) |
| `src/player/cockpit_gaze.ts` | Cockpit look-at pick + gear/ramp activate |
| `src/player/cockpit_stats.ts` | Cockpit-stat instrument visibility / screen projection |
| `src/render/effects/hud/cockpit_gaze_hud.ts` | Screen-space cockpit control labels |
| `src/render/effects/hud/cockpit_speed_hud.ts` | Speed number + bar (boost-aware) |
| `src/render/prefabs/prefab_renderer.ts` | Binds animation components to GLB nodes; `updateAnimations` / `updateParticles` callbacks |
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
- Prefab JSON lives in `src/world/prefabs/data/<id>.prefab.json` and is committed (metadata only). The game bundles them via `import.meta.glob`.
