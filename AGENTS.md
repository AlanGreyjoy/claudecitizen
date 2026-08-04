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
| Rust backend | `backend/` | Auth, catalog, persistence, payments, authoritative cells |

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
root. The engine checkout's own `src/assets/` holds engine-owned assets
(skybox, star catalog, brand art), reached through ESM imports, and is **not**
a project asset root. Atmosphere LUT EXRs live under `public/atmosphere/` so
Vite ships them at the stable `/atmosphere/` URL in both editor Play and
release builds.

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
   engine-owned menu flow (`boot`, `title`, `login`, `character-creation`,
   `loading`, `main-game`).

So the engine's own scene data is a shipped default, not where project content
belongs. Authoring a scene in the editor writes into the project root.

| Component | Role |
|-----------|------|
| `game-manager` | System, planet, spawn mode **and the whole entry pipeline** (see below) |
| `planet` | Planet document reference |
| `player-start` | Spawn pose and mode |
| `prefab-instance` | Places a reusable prefab |
| `ui-screen` | Mounts title / login / character-create / loading UI |
| `scene-link` | Menu scene transition (`auto` + `delaySeconds` for timed hops) |
| `instanced-scene` | Per-player or shared instance content (habs, hangars) |
| `scene-exit` | In-play portal that loads another scene (hab → station, hangar → open space) |

`src/app/scene-host.ts` is the runtime: it loads a scene, mounts its UI screens
or starts play from its GameObjects, and switches scenes **in-process**. Scene
navigation must not reload the page.

### The boot scene owns the game flow

Full law: `docs/docs/architecture/scene-flow.md`. Thin Cursor pointer:
`.cursor/rules/scene-flow-architecture.mdc`.

`kind: 'boot'` is the entry document, and the project's `defaultScene` should
point at it. It never runs gameplay: it reads the pipeline off its
`game-manager` and hands off.

```
boot scene ──► Title ──► Character Create ──► Home World Select ──► Home Hab ──► Open Space
 (flow +        (auth)    (no appearance)      (no homeWorldId)      (gameplay)   (later markers)
  defaults)
```

Every hop is a `game-manager` field, so the order is a project decision, not an
engine constant: `titleSceneId`, `characterCreateSceneId`,
`homeWorldSelectSceneId`, `startingSceneId` (legacy / template; live starting
Hab resolves from home world), `openSpaceSceneId`, `loadingSceneId`, plus
`requireAuth` (unset means true) and `skipTitleWhenSignedIn`. Leave a hop empty
and it is skipped — no title scene means the boot scene hosts the title UI
itself; no character-create scene falls back to the inline create gate. Home
worlds law: `docs/docs/architecture/home-worlds.md`.

- `resolveSceneFlowStep` (`src/world/scenes/scene-runtime.ts`) is the **single**
  precedence rule, pure and stage-driven. The boot scene and the post-auth
  hand-off both call it, so they cannot drift.
- `src/app/scene-flow.ts` is the impure driver (session + bootstrap fetch);
  `scene-host.ts` only dispatches to it.
- The flow travels with the session in `SceneEntryFlow` — Title, Character
  Create, and Home World Select deliberately author **no** `game-manager`, so
  it is configured in exactly one place; home world bindings supply
  `systemId` / `planetId` / starter Hab for that player.

Do not add a second place that decides the entry order, and do not re-key it off
`scene.kind`. A legacy project whose `title` scene still carries the
`game-manager` keeps working; that is back-compat, not the pattern to copy.

### Player game loop (station family)

After boot lands the player in a starting hab, in-play travel follows the station
family model: **Hab → Station → AVMS → Hangar → Open Space**. Each Station owns
its Hab and Hangar; Hab/Hangar are per-player instances (placeable build; team
follow-in). Full law (diagrams + invariants):
`docs/docs/architecture/game-loop.md`. Thin Cursor pointer:
`.cursor/rules/game-loop-architecture.mdc`.

Open Space itself is the **active star system** (`Runtime: open-space`) at 1:1
Star Map scale. Station map bodies are scene documents with
`Runtime: station` — authored as scenes, placed as giant prefabs; far bodies
cull but keep pilot **nav** blips (Combat contact blips are a separate HUD set —
see space-traversal); quantum bridges hours-long thruster gaps. Ship
boarding: `enter-station` (fly-through → hangar instance) /
`exit-hangar` (→ nested `hangar-open-space-exit` mouth). Full law:
`docs/docs/architecture/space-traversal.md`. Thin Cursor pointer:
`.cursor/rules/space-traversal-architecture.mdc`.

A **Star System** owns exactly one **Star Map** (ecliptic catalog: stations,
planets, moons, waypoints, POIs (map entry + assigned prefab on arrival),
missions, Warp Gates — Hab/Hangar ownership on
stations, not map markers). A project may author many systems;
`game-manager.systemId` selects the starting one. **In-play** cross-system
travel is a Star Map **Warp Gate** (`warp-gate` → `targetSystemId`); quantum
stays inside one system. Product name is Star Map; code may still say
`SystemDocument` / System Map. Full law: `docs/docs/architecture/star-map.md`.
Thin Cursor pointer: `.cursor/rules/star-map-architecture.mdc`.

**`src/world/systems/placement.ts` is the only place Star Map meters become
play meters.** World origin is the active planet — a rendering convention forced
by the single-planet terrain stack, not a second coordinate system. Every other
body (star, other planets, every station regardless of `parentBodyId`) is placed
at its true ecliptic offset from it, so map distances are play distances. Orbit
frames, hangar mouths, nav blips and quantum approach all read that one module;
do not re-derive a body position anywhere else, and do not filter system bodies
by the active planet — that filter is what used to make other planets' stations
vanish from play. Only the active planet *renders*; far bodies cull and keep
their pilot blips (`BODY_ACTIVATION_RADIUS_METERS`).

**Ship flight** (Rapier hull + flight-computer demands, Traverse / Combat / Nav, boost,
quantum) is documented in `docs/docs/architecture/ship-flight.md`. **Ship physics**
(vacuum inertia, residual coast, coupled assist):
`docs/docs/architecture/ship-physics.md`. **Ship combat** (blasters, missiles,
lock-on, lead markers, combat HUD, hierarchy death):
`docs/docs/architecture/ship-combat.md`. Thin Cursor pointers:
`.cursor/rules/ship-flight-architecture.mdc`,
`.cursor/rules/ship-physics-architecture.mdc`,
`.cursor/rules/ship-combat-architecture.mdc`.

`Runtime` is a real field: `SceneDocument.runtime` in
`src/world/scenes/schema.ts` (`open-space` / `station` / `hab` / `hangar` /
`flow`), surfaced on `ScenePlayConfig` and in Scene Settings. **Read `runtime`,
not `kind`, when deciding what a document *is*.** `kind` stays as editor
taxonomy and boot back-compat; when they disagree, fix the document. Documents
written before the field infer it once on read (`inferSceneRuntime`) — menu
kinds → `flow`, `main-game` → `open-space`, a player-scoped instance → `hangar`
when it has `hangar-pad`s else `hab`, otherwise `station`. Do not add a second
inference site.

## Project settings and backend config

`asteron.project.json` at the project root holds `name`, `backendUrl` (release /
Build Web stamp), `editorBackendUrl` (Play / Server / editor proxy; defaults to
localhost), `defaultScene`, and `build.outDir`. **File → Project Settings…**
edits it; `/__editor/project-settings` reads and writes it.

- `src/net/runtime-config.ts` resolves the backend URL at startup — from
  `editorBackendUrl` in the editor, from `asteron.runtime.json` (stamped
  `backendUrl`) in a shipped release.
  Never reintroduce a build-time `VITE_API_BASE_URL`.
- **There is no API key.** Players authenticate with the existing cookie session
  (`/auth/login` → `cc_at` / `cc_rt`); operators use `/admin/session`. Nothing
  secret ships to the client.
- Editor → backend requests go through `/__editor/backend/*`, proxied by the
  Electron main process with `net.fetch`. This exists because the renderer's
  `cceditor://app` origin fails the backend's single-origin CORS check and
  cannot store the session cookies. Do not try to call the backend directly from
  the editor renderer.

### Building a project release

**File → Build Web runs `scripts/build_project_web.mjs` from the engine
checkout, not `npm run build:web` from the project.** The engine owns
`index.html`, `vite.config.ts`, and every `import.meta.glob` that bundles
scenes, planets, systems, and prefabs — and those globs resolve against the
engine, not the open project. A project supplies only `assets/` and a few
`src/**` documents, so neither root can build alone.

The script hardlinks the engine into `.asteron-build/stage`, overlays the
project's `src/**` on top (removing each file first, so a shared inode is never
edited in place), hardlinks the project's `assets/` in, and runs Vite there.
Project documents win on id collisions; engine-only scenes (`login`,
`character-creation`, `loading`) survive because the shipped game needs both.

`editor.html` is only a rollup input when `mode === 'editor'`. Public releases
must not ship the authoring surface.

Deployment specifics — TLS, WebTransport certificates, CORS, cookies — are in
`deploy/README.md` and `docs/docs/engineering/poc-launch.md`.

**Content delivery law:** project files ship via Build Web; live catalog
(ships, items, weapons, …) lives in Postgres and is edited per environment via
Server Console — migrations are schema + one-shot seeds only. Full law:
`docs/docs/architecture/content-delivery.md`. Thin Cursor pointer:
`.cursor/rules/content-delivery-architecture.mdc`.

**Player vitals law:** character HP, hunger, thirst, planet temperature /
breathable air, medicine toxicity, and HUD visibility. Full law:
`docs/docs/architecture/player.md`. Thin Cursor pointer:
`.cursor/rules/player-architecture.mdc`. Ship hull shields/HP stay separate
(`docs/docs/architecture/ship-combat.md`).

**Home worlds law:** after Character Create, pick Asteron / Virelia / Korrath;
binds system + body + starter Hab. Full law:
`docs/docs/architecture/home-worlds.md`. Thin Cursor pointer:
`.cursor/rules/home-worlds-architecture.mdc`.

**Player death law:** respawn to valid custom point, else home-world Hab;
vitals reset on wake. Full law: `docs/docs/architecture/player-death.md`.
Thin Cursor pointer: `.cursor/rules/player-death-architecture.mdc`.

**HaloBand law:** one personal device shell (Home / Comms / Missions / Map /
Inventory / Mall / Ship); open suppresses input, does not pause; presentation
only — Mall / chat / inventory outcomes stay server-owned. Full law:
`docs/docs/architecture/haloband.md`. Thin Cursor pointer:
`.cursor/rules/haloband-architecture.mdc`.

**Item Mall law:** ARC ≠ AsteronCredits; AC spends only in Item Mall
(consumables, outfits pieces/packs with Outfitters slots, placeables into
building inventory for hab/hangar Build Mode — baseline still consumable-only); money grants via Stripe webhook
only; all AC mutations through `apply_credit_delta` + ledger. Full law:
`docs/docs/architecture/item-mall.md`. Thin Cursor pointer:
`.cursor/rules/item-mall-architecture.mdc`. Operator how-to:
`docs/docs/server-console/payments.md`.

**Stripe law:** in-game HaloBand Mall wallet — Payment Element for card entry
(not hosted Checkout/Portal); saved `pm_…` + brand/last4; player default card
with **one card → auto-default**; pack buy charges default when set; purchase
history in Mall; webhook still sole money→AC grant. Full law:
`docs/docs/architecture/stripe.md`. Thin Cursor pointer:
`.cursor/rules/stripe-architecture.mdc`.

**NPC law:** MMO characters — ambient fill (~100 LOD budget), shopkeepers,
dialogue, mission givers / talk-give-take; not mobs; probe-then-commit; cell
owns shop/mission outcomes. Full law: `docs/docs/architecture/npc.md`. Thin
Cursor pointer: `.cursor/rules/npc-architecture.mdc`.

**Mob law:** PVE combatants (monsters, animals, fauna) ≠ NPCs; **network-synced**
cell entities (peers see/help same fight); cell owns aggro/HP/loot/leash;
**editor dens** + **Console** MobDef/loot/packs; LOD + interest budgets; not
ship Combat. Full law: `docs/docs/architecture/mobs.md`. Thin Cursor pointer:
`.cursor/rules/mobs-architecture.mdc`.

## Prefab & Animation Architecture

- **Prefabs** (`src/world/prefabs/`) are JSON trees of entities with transforms, GLB assets, and gameplay components. Data files are `*.prefab.json` filed in **any folder** under the project asset library (`<project>/assets/`) — `assets/Prefabs/` is the default landing spot. A prefab's identity is its document `id`, never its path, so moving the file breaks nothing; `editor-desktop/repository.mjs` scans the asset roots to map id to path.
- **Schema** (`src/world/prefabs/schema.ts`) defines every component type and its validator. Read this first when a component's fields are unclear.
- **Ship runtime** (`src/world/prefabs/ship-runtime.ts`) flattens a ship prefab into `ShipLayout` (doors, seats, beds, ladders, colliders, entry mode + board circles). Ship doors use the `ship-door` component; bunks use the `bed` component; ladders use the `ladder` component; ground-level board points use the `ship-entry` component. Seats are split: `ship-controller.seats[]` lists *which* entities are seats and their order, while role/eye/stand/reach live on each marker's own `ship-seat` component (`resolveSeatSettings` merges component over the legacy inline fields, and `collectShipSeats` adopts a `ship-seat` that was never added to the list).
- **Station runtime** (`src/world/prefabs/station-runtime.ts`) flattens a station prefab into `StationLayoutOverride` (spawn, elevators, ladders, hangar pads, info markers, colliders). Station doors use the `animation` component (toggled via an `interaction` component with `interactionType: "animation"` and `targetAnimationId`).
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

### Weapon fire feedback

- **Recoil rides on top of the aim, never inside it.** `state.lookRecoil` in `src/input/player-controls.ts` is an additive offset added at `sampleCameraState` time and decayed there. Writing kick into `orbitLook.target{Pitch,Yaw}Radians` instead makes the camera climb permanently over a magazine, because nothing ever pulls it back. The pattern itself (climb per consecutive shot, alternating horizontal wander, per-weapon profile derived from RPM and muzzle velocity) is the pure module `src/player/weapon-recoil.ts`; it takes a `random01` callback rather than calling `Math.random` itself.
- **Combat effects update after the camera rig.** `updateCombatEffects` in `src/render/main/render-spike-frame.ts` runs after `updateLightingAndCamera` because muzzle flashes, tracer streaks and impact sparks all billboard against the camera; running them first shows a one-frame swim on fast turns.
- **Combat FX textures are procedural**, generated on canvas in `src/render/effects/combat-fx-textures.ts` with a fixed LCG. They must stay art-free: a project that authored no combat assets still gets flashes, tracers and impacts. Weapon-authored `hitDecalUrl` remains optional decoration on top of the always-on impact burst.
- Tracers simulate travel (`src/render/effects/tracers.ts`): a fixed-length streak chases the round from the muzzle to the impact point at the weapon's clamped muzzle velocity. Do not go back to drawing the full barrel-to-impact line at once — it reads as a laser, not a bullet.
- The crosshair is driven per frame, not toggled. `src/render/effects/hud/weapon-crosshair.ts` writes `--weapon-crosshair-spread` and `--weapon-crosshair-punch`; the bars in `sc-ui.css` are separate elements so recoil can push them apart. Keep those two custom properties as the only JS→CSS channel.

### Friendly station NPCs

Full law: `docs/docs/architecture/npc.md` (MMO townsfolk + crowd LOD;
NPC ≠ mob — see `docs/docs/architecture/mobs.md`). Thin Cursor pointer:
`.cursor/rules/npc-architecture.mdc`. Baseline below still uses the **player
avatar pipeline** for ambient draw — that is known debt; do not extend it.

- Ambient populations use `npc-spawner` markers connected to an undirected graph of `npc-waypoint` markers. Named/service characters use `npc-placement`.
- `station-runtime.ts` flattens those components into station-local NPC specs. `src/world/npc.ts` validates duplicate/missing ids, cross-floor links, missing route groups, and disconnected graphs.
- `src/npc/station-population.ts` runs a deterministic, cosmetic local population. `src/render/main/scene/station-npcs.ts` currently renders through the character avatar pipeline with distance activation (**law:** replace with crowd LOD — not full Sidekick/UAL per ambient).
- NPC definitions and weighted populations live in `src/npc/catalog.ts`; station prefabs reference ids instead of embedding appearance data.
- **Roam motion is analytic, not physics-driven.** No character controller runs per NPC — that would cost a `computeColliderMovement` per actor per frame (~1-2 ms at the 32-actor cap) to reproduce motion the wander step already produces. Instead `physics/station-npc-capsules.ts` validates each candidate target *once* when it is picked (`sampleFloorHeight` snaps it to real floor and rejects drops past the autostep allowance; `isPathClear` sweeps a capsule along the segment), so the walk itself needs no per-frame collision. Segments are re-probed every `ROAM_RECHECK_INTERVAL_SECONDS` because doors and build-mode props move after a target is chosen.
  - The sweep capsule is **lifted `PROBE_GROUND_CLEARANCE_METERS` off the floor**. Rapier reports `time_of_impact = 0` for a shape already touching geometry at the start of a cast, so a floor-hugging probe hits the floor instantly on every candidate and the whole check silently degrades to a no-op. Same trap documented in `camera-occlusion.ts`.
  - The spawn floor-snap **retries across frames** rather than running once at reset: station physics is built asynchronously and Rapier refreshes its broad phase during `step`, so an early sample can legitimately find nothing. A single attempt leaves the population floating, and because the step-height check measures against `position.up`, floating actors reject every target and freeze.
- **NPC capsules are hidden from scene queries via one collision-group bit** (`NPC_CAPSULE_MEMBERSHIP` / `QUERY_GROUPS_EXCLUDE_NPCS` in `rapier-world.ts`). Statics and the player keep Rapier's default all-bits membership, so the player's character controller — which runs unfiltered — still collides with NPCs. **Any new station scene query must pass `QUERY_GROUPS_EXCLUDE_NPCS` unless it genuinely wants to hit NPCs**, or it regresses silently: weapon rays stop on an NPC and spawn a station impact in mid-air with no damage (no health model yet), and camera occlusion yanks the eye whenever an NPC crosses behind the player.
- Local NPCs must remain non-authoritative. Player-vs-NPC **collision** is local and cosmetic, which is why the capsules above are allowed; before adding dialogue outcomes, persistence, inventory, or combat, promote NPCs to real backend cell entities and snapshot them with an explicit entity kind; do not model them as fake players.
  - Consequence of the re-probe: roam RNG streams can now diverge between clients, because whether a segment is abandoned depends on local door state. Harmless while the population is local and cosmetic, and moot once the server owns NPC positions — but do not build shared gameplay on client NPC positions matching.

### Animation → collider → interaction wiring

This is the most common source of "door doesn't work" bugs. Trace these paths:

#### Station prefab doors (`door` component — preferred)

Self-contained like `ship-door`. Marker empty is the interact target.

1. **Visual**: same blend path as below (`stationAnimationStates` + `updateAnimations`). Prefab renderer binds `door` the same way as `animation`.
2. **Collider**: `station-runtime.ts` treats `door` nodes as articulated (same as `animation`) and binds `collider.animation` with `doorId`.
3. **F-key toggle**: baked into `StationLayoutOverride.doors`. `station-interaction.ts` resolves `kind: 'door'` (radial or raycast). `interactions.ts` uses `actions.interactPressed` + open/close SFX.

#### Station prefab doors (legacy: `animation` + `interaction`)

1. **Visual**: `src/game/station/animations.ts` `updateStationAnimations` lerps `stationAnimationStates[id].value` toward `target`, then calls `renderer.getStationRoot().userData.updateAnimations(blends)`. The renderer (`src/render/prefabs/prefab-renderer.ts` `setupUpdateAnimations`) looks up GLB nodes by name and translates/rotates them.
2. **Collider**: station colliders are baked as **static Rapier bodies** in `play-session.ts` `createStationPhysics` → `syncStaticColliders`. They do NOT move with the animation unless bound via `collider.animation` (set in `station-runtime.ts` `bindStationColliderAnimations`). Nodes named by an `animation` or `door` component are excluded from parent mesh bakes and auto-given their own collider — same `articulatedNodes` mechanism as ship doors (`stationAnimatedNodeNames`). When bound, `src/game/station/animations.ts` toggles their `setEnabled` state in `updateStationAnimations` based on the open blend.
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

#### Ladders (ladder component)

Ladders work identically in stations and on ship decks — the same `ladder`
component, the same climb math (`src/world/ladders.ts`, pure), the same
per-surface step (`src/player/ladder-climb.ts`).

1. Marker empty + `ladder` component at the **foot** of the climb line: the spot
   the player stands on to mount. Local **+Y** is the climb axis; local **+Z**
   is the side they face away from while climbing and step off toward at the
   top. `height` is the climb above the marker.
2. Mount reach measures to the whole climb line in 3D, so one marker serves both
   the foot and the upper deck — no paired marker.
3. **F** attaches. Forward / back climbs. Reaching the top releases the player a
   step past the rail (`LADDER_TOP_STEP_OFF_METERS`); reaching the bottom, or
   **jump** anywhere on the rail, drops back to walking.
4. Climbing is a **sub-state of the walking modes**, not a `GameMode`:
   `world.ladderClimb` is set while attached and `in-station.ts` /
   `deck-locomotion.ts` route locomotion through the climb. The player is still
   in-station / on-deck, so camera, HUD, footsteps, and combat gating are
   unchanged. Motion still goes through the Rapier character controller, so a
   blocked climb stalls instead of clipping through geometry.
5. There is no authored climb clip yet — `LADDER_CLIMB_ANIMATION` holds an idle
   pose. Add a `climb_loop` state and point that constant at it.

The **Ship Sandbox** (`src/app/ship_sandbox/walk.ts`) is a *separate* walk loop
with its own seat/bed/door/ramp/ladder handlers — it does not go through
`src/game/modes/deck-locomotion.ts`. Any new deck interaction has to be wired in
both places or it will silently not exist in Ship Test.

### Ship flight (Rapier + flight computer)

**Target law:** flying hull is Rapier; flight computer emits forces/torques. Full doc:
`docs/docs/architecture/ship-flight.md`. Legacy custom `integrateFlightBody` pose
writing is compat only — do not extend it.

- **Per-ship feel** on `ship-controller` stats: `massKg`, `maxSpeedMps`, `maxAngularRateRadps`, thrust (N), torque (N·m) → `ShipSpec`. Demands ≈ thrust/mass and torque vs inertia; Rapier mass matches authored mass.
- **Speed:** cruise max = `maxSpeedMps`; boost (Shift) scales forward thrust demand and the live velocity cap (`BOOST_FACTOR`).
- **Modes:** `traverse` → `combat` → `nav` (tap **U**). Quantum (hold **U**) only in **Nav**.
- **Global flight-computer knobs** (aim gain, damping, coupled bleed, boost factor) — only when *all* ships feel wrong.
- **Gravity:** atmospheric pull from planet `gravityMetersPerSecond2` inside `atmosphereHeightMeters` (heavier *g* → harder/longer escape); **no** planetary pull in vacuum. Vacuum inertia / residual coast / coupled assist: `docs/docs/architecture/ship-physics.md`. Landing = thrusters + Rapier contact (gear/pad/terrain). **No auto-level**.
- **Dual-reticle:** aim pip + nose pip; aim-track PD → torque demand on the Rapier body. Hold **F** free-look; gaze + **LMB** for `cockpit-control`. **Alt+C** coupled ↔ decoupled.
- **Contacts:** land / crash / ship–ship are Rapier outcomes; boarding triggers stay markers/sensors on that body.
- **Combat weapons / lock / lead / combat HUD / destroy:** `docs/docs/architecture/ship-combat.md` (Combat mode only).
- **Deck vs flight:** parked on-foot uses ship-local Rapier; flying uses the world flight body — never dual-drive pose.
- **Main play / preview / spawn wiring:** `in-ship` mode, Ship tab Test, `shipPrefabOverride` chain — see architecture doc + ship-flight skill.
- **Tuning:** `.cursor/skills/ship-flight/SKILL.md`, `.cursor/rules/ship-flight.mdc`.

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
| `src/editor/react/panels/server/ServerConsolePanel.tsx` | Server tab: live `/admin/*` operator console (incl. Commerce: Payments, Credit Packs, Item Mall, Purchases) |
| `src/editor/serialize.ts` | Convert editor state to/from `PrefabDocument` / `SceneDocument` |
| `src/render/editor/viewport.ts` | Three.js editor viewport (imperative host) |
| `src/world/scenes/` | Scene documents (GameObject trees), runtime resolution, bundled loader |
| `src/app/scene-host.ts` | Runtime scene host: load, switch, pause, dispose |
| `src/app/play-chrome.ts` | Mountable in-play HUD tree (`play-chrome.html`) |
| `src/world/prefabs/schema.ts` | Canonical prefab JSON schema (+ scene components) |
| `tools/asteron-mcp/` | Stdio MCP server (Cursor) → live editor agent API |

React owns editor chrome and all panel/form UI; `EditorStore` stays framework-agnostic. Tabs: **Scene** (default), Material Manager, **Ship**, Base Characters, Planet Authoring, System Map, Menu Manager, **Server**. Ship is the one tab that shares Scene's viewport/hierarchy/inspector instead of replacing them — it only adds a bar (browse, validate, Test), so it is wired through `EditorWorkspace`, not `TabEditorHosts`. WebGL/canvas preview stages (viewport, planet terrain, system map, base-character stage, menu HUD) stay imperative behind React hosts. Component field editors live in `src/editor/react/panels/component_fields/`.

**Live project/scene context for agents:** use the **AsteronEngine MCP** (`asteron-engine` in `.cursor/mcp.json`). It reads `~/.asteron/agent.json` written by a running editor and exposes session, open document, hierarchy, selection, play state, viewport capture (`capture_viewport`), disk catalogs, and safe play/save/select/open commands. See `editor-desktop/README.md` (“AsteronEngine MCP”).

### Play mode

**F6** plays and stops, **F7** pauses. `startEditorPlay()` serializes the live
`EditorStore` document (unsaved edits included) and hands it to a scene host
mounted in `#editor-play-host`, a fixed overlay carrying a CSS `transform` so the
HUD's `position: fixed` elements are contained by the Game region. The host must
stack above `#editor-root` (`z-index: 260` vs shell `250`) or Play paints under
the opaque editor chrome and looks like a blank blue screen. Pause feeds
`ctx.isPaused()` in `src/game/create-game-loop.ts`. There is no external Play
Mode window — do not reintroduce one.

### Debug → Multiplayer

Launches N game windows against the running backend, each in its own Electron
`session` partition (`editor-desktop/multiplayer_debug.mjs`) so each holds its
own cookie jar and signs in as its own throwaway account — a shared jar would
log every window in as the same player and the cell, keyed by `player_id`, would
collapse them into one entity. Backend calls route through
`/__editor/mp/<n>/backend` for the same reason. Options include cube avatars
(replaces the character model, so a missing appearance cannot be mistaken for a
missing peer) and `setPresenceDriftLogging`, which prints published position
minus simulated position once a second. On foot that number is the invariant
worth watching: it should be noise around zero, and a large constant value means
presence is publishing some *other* body — which is exactly how the parked-ship
bug was found. This is the only harness that reproduces peer visibility without
a deploy; reach for it before debugging multiplayer against production.

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

#### Checking whether the dev backend is up

Use the port, not a request: `ss -ltnp | grep :3000` (the process is `cc-server`). Health routes are **`/livez` and `/readyz`** — there is no `/health`, and the route table in `backend/crates/server/src/main.rs` is the only source of truth for paths, so read it rather than guessing by convention.

If you do probe with curl, ask for the status code and do not pipe through `head`: axum answers an unknown route with a 404 and an **empty body**, so `curl -s .../health | head` prints exactly the same nothing as a refused connection, and `$?` reports head's status rather than curl's. Both cases look identical.

```bash
curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://localhost:3000/livez
```

#### Reading catalog data (weapons, items, ships)

`/admin/*` endpoints require an operator session (`/admin/session`) and return `401 {"message":"Admin session is missing."}` without one. For read-only inspection, query the dev database directly instead of trying to authenticate:

```bash
docker exec claude-citizen-postgres-1 psql -U claude -d claude_citizen \
  -c 'SELECT i."id", i."prefabId", w.* FROM "ItemDefinition" i
      JOIN "WeaponDefinition" w ON w."itemDefinitionId"=i."id";'
```

Weapon stats live in `WeaponDefinition` joined to `ItemDefinition` on `itemDefinitionId`; a weapon prefab is wired to its catalog row by `ItemDefinition.prefabId`. Table and column names are quoted camelCase.

### Payments and AsteronCredits

Real-money monetization lives in `backend/crates/server/src/payments/` (Stripe client, AES-256-GCM
secret wrapping, credit ledger) and `backend/crates/server/src/mall.rs` (the Item Mall storefront).
Operator CRUD is in `admin_payments.rs`, deliberately not in the already-large `admin.rs`.

Invariants — do not work around these:

- **`payments::ledger::apply_credit_delta` is the only way `Player.creditBalance` may change.**
  Every mutation writes one `AsteronCreditLedger` row in the same transaction and carries an
  idempotency key. Never `UPDATE "creditBalance"` directly.
- **Credits are granted only by the Stripe webhook**, never by `create_checkout`,
  client Elements confirm, or a success redirect. Fulfillment is keyed on the
  Stripe event id, so replays are no-ops.
- **Pay UI (target):** in-game Stripe.js Payment Element + saved-card wallet
  in HaloBand Mall (default PM; one card auto-default; pack charge on
  default). Not hosted Checkout / Customer Portal. React not required. See
  `docs/docs/architecture/stripe.md`.
- The webhook handler takes `axum::body::Bytes`, not `Json` — HMAC verification needs the exact
  raw bytes. Do not parse the body before the signature passes.
- Stripe secrets are AES-256-GCM ciphertext in `PaymentProvider`, wrapped with
  `PAYMENTS_ENCRYPTION_KEY`. They are never returned to any client, only a masked `sk_••••1234`.
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` env vars override the stored values when set.
- ARC and AsteronCredits are separate currencies. ARC stays the earned soft currency for station
  shops; AC is bought or granted and spends only in the Item Mall.
- `mall::SELLABLE_ITEM_TYPES` (consumables today) is mirrored by `MALL_SELLABLE_ITEM_TYPES` in
  `src/editor/react/panels/server/defaults.ts` — widen both together.

Docs: `docs/docs/architecture/item-mall.md` (mall / AC law),
`docs/docs/architecture/stripe.md` (Payment Element pay UI),
`docs/docs/server-console/payments.md` (operator how-to).
Thin Cursor pointers: `.cursor/rules/item-mall-architecture.mdc`,
`.cursor/rules/stripe-architecture.mdc`.

### Authoritative multiplayer

Full law: `docs/docs/architecture/multiplayer.md`. Thin Cursor pointer:
`.cursor/rules/multiplayer-architecture.mdc`. Architecture docs are the
**target law**; code may lag (follow-in, placeables, quantum peers, character
presentation sync) — refactor toward the doc, do not treat today's gaps as
permission to defer authority.

**Multiplayer is designed in parallel, never bolted on later.** Every gameplay
feature, state change, interaction outcome, scene travel path, and entity that
peers must see or affect must answer up front: who owns the truth (cell vs
client), what intents/snapshots carry it, and how a second player observes it.
Local-only stubs are fine for cosmetics that stay non-authoritative (see
friendly station NPCs); they are not an excuse to defer authority, replication,
or presence for real gameplay. "We'll add multiplayer later" is rejected the
same way unbounded main-thread work is.

Replication is a three-stage pipeline; the stages own different things and
conflating any two of them has already cost a launch.

| Stage | Code | Owns |
|-------|------|------|
| Cell | `backend/crates/server/src/cell.rs` | Simulation. Publishes its full state to one Redis channel. Knows nothing about who is watching. |
| Edge | `world_transport.rs` + `replication.rs` | One per connection. Claims the viewer's cell, observes the neighbourhood, decides what *this* viewer needs. |
| Client | `src/net/world-client.ts` | Mirrors the edge's per-connection state, interpolates, renders. |

- Cells are single-writer authorities leased through Redis and fenced by a PostgreSQL epoch.
- `backend/crates/sim-core/` is shared by native Rapier authority and browser WASM prediction.
- `proto/world.proto` is the canonical realtime contract.
- PostgreSQL stores durable accounts, catalog, inventory, and cell checkpoints; Redis stores ephemeral tickets, leases, routing streams, and snapshot fan-out.
- Never add a WebSocket fallback, second backend, client-authoritative outcomes, or a separate prediction implementation. One documented exception, below: the on-foot **position** is client-reported and server-clamped, because no server-side collision geometry exists for it to be authoritative against.

**`world.mode` decides which body a presence intent describes — never the
existence of a ship.** Every player owns an active ship, so keying
`publishPresence` off `getShipInstance` alone published the parked ship's
position as the walking character's: every avatar pinned to its owner's hangar,
motionless, no matter where the player walked. The player is next to it, so it
looks like a frozen peer; in production the hangar is far away, so it looks like
nobody is online at all. `presenceShipBody` in `src/net/world-client.ts` is the
one place that decision is made.

**On foot, the client's position is the truth and the server clamps it.** The
authority world (`sim-core/authority.rs`) holds player capsules and nothing
else — no station geometry, no terrain, zero gravity — so its dead reckoning
walks through walls and can never converge on the client's Rapier result. So:
presence publishes `world.character.position` verbatim, and `anchor_on_foot` in
`cell.rs` moves the authoritative anchor towards it by at most `top speed ×
elapsed`. That clamp is what keeps it from being a teleport primitive; do not
remove it, and do not "restore" server-side dead reckoning of on-foot position.
A player standing on a moving ship deck (`shipZoneId` set) is *carried*, so both
the velocity validation and the clamp switch to ship speed — judging deck motion
by on-foot limits rejects every intent a passenger sends, which is its own
invisible-player bug. Ship flight keeps full server authority.

**Two origin lists, and only one of them is CORS.** `CLIENT_ORIGIN` is the
single CORS origin; `WEBTRANSPORT_ALLOWED_ORIGINS` is checked separately on the
QUIC handshake and must contain it. They are separate because the desktop
editor dials from `cceditor://app`, which must never hold REST session cookies.
Getting the second one wrong is invisible from the outside — the site loads,
players authenticate, chat echoes back, and no player ever sees another. See
`deploy/README.md`; production deploys merge two compose files, and the base
file's development allowlist wins unless the overlay restates it.

**Authored markers are the only way a player moves between places during
Play.** The boot scene's `game-manager` decides where a session *begins*; every
move after that is a `scene-exit`, an `exit-hangar`, or an `enter-station`
marker and nothing else. Elevators are gone — mode, ride state, `elevator`
component and all. Do not reintroduce a second mechanism that picks a cell: two
of them race, and the loser is a player rendering one place while being
simulated in another.

Which primitive:

| Move | Component | Lives on |
| --- | --- | --- |
| Hab ↔ Station ↔ Hangar, on foot | `scene-exit` | any walkable scene |
| Hangar → Open Space | `exit-hangar` | `Runtime: hangar` scene |
| Open Space → Hangar | `enter-station` | `Runtime: station` body |

`exit-hangar` and `enter-station` bake through the same station layout as
`scene-exit` (`exit-hangar` shares the `sceneExitMarkers` list and carries
`origin: 'exit-hangar'`; `enter-station` gets its own `enterStationMarkers`),
so there is still exactly one proximity test and one `onRequestScene` path.

- `exit-hangar` needs no destination: `@space` resolves through the flow, and
  the arrival pose comes from System Map ownership. It always sets
  `arrival: 'in-ship'` — even on the `interact` trigger, because there is
  nowhere to stand in open space.
- `enter-station` resolves its hangar scene at trigger time from the System Map
  entry that placed the body (`hangarSceneId`), unless the marker overrides it.
  It arrives `default` (on foot, hull parked by the hangar's own delivery
  logic); no bay is auto-assigned on crossing.
- A hangar `scene-exit` targeting `@space` still works and warns at bake time.
  It is legacy, not the designed path — migrate it to `exit-hangar`.
- `trigger: "interact"` prompts for F on foot; `trigger: "fly-through"` fires
  when a ship crosses the marker and shows no prompt.
- `networkInstanceId` takes a literal cell id or a per-player token —
  `@apartment`, `@hangar`, `@space` — resolved from the session bootstrap in
  `src/game/station/scene-exit.ts`. Private instance ids are per player and
  cannot be written into a prefab document.
- `sceneId` takes the same treatment: `"@space"` resolves through the flow's
  `openSpaceSceneId` (`resolveSceneExitSceneId`), so a hangar prefab can name
  the destination without knowing any project's scene ids. Unknown `@` tokens
  resolve to nothing rather than reaching the scene loader as a literal.
- Open-space fly-throughs resolve the owning station from System Map
  `hangarSceneId` (the hangar scene being left). Runtime loads that station's
  concourse, sets its orbit frame, and spawns at its `hangar-open-space-exit`
  mouth; missing ownership/marker falls back to the generic open-space altitude
  spawn with a warning. Do not author a Station picker on the hangar exit.
- An `in-ship` arrival (any `exit-hangar`, or a `fly-through` `scene-exit`) sets `arrival: 'in-ship'` on the target, which reaches
  `createWorldState` and spawns the player **seated and flying** in orbit.
  Without it the swap rebuilds the session and drops a mid-flight pilot on foot
  at the destination's Player Start.
- The target rides the scene swap **in memory** (`onRequestScene` carries a
  `SceneExitTarget`). Do not send the Transition on the outgoing connection: a
  scene swap tears the world session down and dials a new one, so that
  Transition would be racing its own reconnect for the Postgres write that
  decides the new session's cell.
- `loginInstanceForScene` is the *only* other thing allowed to choose a cell,
  and only for a fresh session.

**An authority cell is not a view distance.** `src/grid.rs` sizes cells and
interest radii separately, tied by one invariant — `interest <= size` — so a
viewer's interest sphere is always covered by the 3×3×3 neighbourhood of the
cell they stand in. Edges subscribe to that whole neighbourhood. Shrink a cell
below its interest radius and players standing next to each other across a
boundary go invisible again, silently, with a healthy connection throughout.

**Never size a snapshot against `MAX_DATAGRAM_BYTES`.** It is a protocol sanity
bound (48 KB); QUIC carries about 1.2 KB. `Connection::max_datagram_size()` is
the only number that describes the path.

**What goes on which QUIC path is decided by kind, not size.** Structural frames
— a baseline, an entity entering, an entity leaving — take the reliable stream
because nothing restates them. Pure state churn takes a datagram because losing
one costs 50 ms. The client depends on this: it never expires an entity on
silence, because an idle entity is *supposed* to send nothing.

**Identity is not per-tick data.** Appearance and display name ride an
`EntityProfile` sent once per viewer when an entity enters interest; entity
state is addressed by a small per-connection handle. Putting appearance back in
the per-tick path is what blew the MTU and blanked every populated cell.
**Visible equipped loadout** (weapons, backpacks, wearables) updates on change
via the structural / reliable path — same duty: peers must remesh gear. Compact
pose / fire events keep peer avatars honest; cell owns firearm hit outcomes.
Full presentation law: `docs/docs/architecture/multiplayer.md`
(Character presentation). Do not treat a nametag capsule as “peers see me.”

Cell persistence uses `CellCheckpoint`, deliberately *not* the wire `Snapshot` —
the wire format is lossy by design (no velocity, f32 orientation, no identity).

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
- Every vertex in a tile uses the tile level's uniform band limit. Do not give inherited even/even vertices coarser octave cutoffs: isolated coarse samples surrounded by fine samples become pyramid spikes or inverted holes. Same-LOD neighbors agree to well under a pixel — `terrain:validate`'s `sameLodSameFaceSeamErrorByLevel` measures 0.1 mm at L17 and 2 mm at L8, with the 10 cm at L2 sitting on a ~2500 km tile — which is what makes skirt suppression safe on those edges. Mixed-LOD boundaries are folded in the vertex shader from the per-instance edge deltas that `domain/edge-deltas.ts` resolves.
- Terrain tiles append radially inset, two-sided skirt walls on all four edges while the main material remains `FrontSide`. Skirts cover culled, cross-face and temporarily uncovered neighbors; the edge morph covers active mixed-LOD contacts. Changing the skirt layout means changing `grid-geometry.ts` and `tile-vertex.ts` together.
- **The shared grid carries four skirts; the shader draws only the ones an edge needs.** `domain/edge-deltas.ts` returns `EDGE_NEIGHBOUR_ABSENT` (-1) when no neighbor resolves — cross-face, past `MAX_NEIGHBOUR_SEARCH_LEVELS`, culled, or still building — and a delta of exactly `0` now means a same-level, same-face neighbor really is in the rendered set. On that case alone `terrain-node-material.ts` leaves the skirt vertices at their surface corner, so the quads collapse to degenerates and rasterize nothing. `terrain:validate` measures 72% of skirt edges suppressed on a representative selection, ~18% fewer terrain triangles. Topology, vertex counts and the identity attribute are untouched, so this needs **no** `TERRAIN_CACHE_VERSION` bump — but if you make edge deltas mean something else, the skirts are what you are silently turning off.
- **`TERRAIN_SKIRT_MIN_DEPTH_METERS` (48 m) is load-bearing — do not "right-size" it to the cell span.** The gap a skirt covers is driven by terrain relief across the seam, not by cell size: `terrain:validate`'s `skirtGapByLevel` measures 38.71 m at L15 and 20.62 m at L17, where `cellSpan * TERRAIN_SKIRT_DEPTH_FACTOR` would only give 25.8 m and 6.5 m. Lowering the floor to match cell scale opens real holes at exactly the levels a player stands on. Read `skirtGapByLevel` before touching any skirt-depth constant.
- The terrain fallback chain must reach L0, and the six synchronously built L0 roots must remain pinned in `mesh-cache.ts`. This is the no-hole coverage guarantee when disk/worker tiles are cold, delayed, or over budget.
- `world/base-elevation.ts` owns the terrain recipe through lake carving. `world/rivers.ts` builds one cached, spatially indexed downhill drainage graph from that pre-river surface; vertex sampling only queries the graph. Preserve its acyclic confluences and non-increasing water levels—do not put route solving back in the per-vertex hot path.
- **Do not vary `TILE_SEGMENTS` / `RENDER_SURFACE_SEGMENTS` per quality preset.** The low-poly triangle layout, foot sampler, lake mesh, height atlas and disk cache assume a fixed count. `TILE_SEGMENTS` must also stay **even**: the shared index buffer is only valid because an even tile origin cannot change `(gridX + gridY)` diagonal parity.
- **Terrain is one instanced draw, not one draw per tile.** All visible tiles are instances of a single indexed grid (`render/grid-geometry.ts`); a tile is sixteen floats in a params buffer plus a slot in the shared height/colour atlas (`render/height-atlas.ts`). Tiles own no `BufferGeometry`, no scene-graph node, and no per-tile material. Never give the terrain material a per-mesh binding: `Node.customCacheKey()` returns the node id, so a per-tile buffer means a per-tile synchronous pipeline compile.
- **Vertex placement is float32-critical.** A vertex is `direction * (radius + height) - tileCentre`, and both terms are ~6.37e6 m, where float32 spacing is half a metre. `domain/tile-vertex.ts` cancels the large terms symbolically instead; `terrain-node-material.ts` is a transliteration of it, and `terrain:validate` simulates the shader in `Math.fround` to prove it (naive 0.69 m vs 0.00008 m). Change the pure function first, watch the assertion, then mirror it into TSL.
- Terrain reads as flat-shaded triangles with baked per-corner palette colors: `material.flatShading` derives exact facet normals from view-position derivatives, and colour uses a `flat`-interpolated varying. `terrain-triangulation.ts` owns the alternating diagonal rule shared by the shared grid and foot sampling; do not reintroduce smooth normals or photographic terrain splat textures without an explicit art-direction change.
- `build/terrain-buffers.ts`'s `buildTerrainTileBuffers` is the **CPU reference mesh, not a render path** — nothing in `src/` calls it. It exists so `terrain:validate` has concrete triangles to check skirt winding, mixed-LOD gaps and mesh-vs-foot agreement against. Do not wire it back into streaming.
- **Do not bypass** the per-frame tile build budget in `mesh-cache.ts` — unbounded sync builds freeze at 0 FPS.
- **Generation runs in workers; the main thread only installs results.** Terrain (`planet_tiles/worker/`), vegetation (`vegetation/worker/`), and surface spawns (`surface_spawns/worker/`) each own a pool with a startup liveness handshake, because some embedded browsers construct module workers that never run and never fire an error. Failing that handshake reverts the subsystem to a *budgeted* sync path — never an unbudgeted one. Do not move placement or height sampling back onto the main thread: a lush L17 vegetation tile issues over ten thousand surface probes, and the millisecond budget is only checked between tiles.
- The hot samplers (`world/renderable-surface.ts`, `world/rivers.ts`, `world/climate.ts`) are written allocation-free on purpose: numeric cache keys, module scratch objects, scalar math instead of `add`/`cross`/`scale` chains. Reintroducing per-sample strings or vector allocations there costs whole frames, not microseconds. Scratch returns are documented at each site — copy out anything you retain.
- `Tile Build` in the HUD stats panel is the diagnostic that separates the two failure modes: a low average with `workers` means the queue is the bottleneck, a high average means the sampler is, and `sync` means a pool never started.
- **Debugging:** `npm run terrain:validate` checks horizon coverage, cold-cache/root fallback, packed mesh/foot height and normal agreement, uniform per-LOD sampling, same- and mixed-LOD seams across cube faces, two-sided skirt coverage, per-level skirt gap budgets, skirt-edge suppression (including that no cross-face edge ever loses its skirt), routed-water invariants, and finest triangle span. `scripts/measure_desync.ts` compares analytic/mesh heights. `?quality=balanced|performance|high` toggles render presets.

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

## Sky, day/night, and clouds

The sky is **authored per planet**, in the `sky` block of `*.planet.json` (`world/planets/sky-schema.ts`). Defaults are Earth's; the Planet Authoring panel exposes every field under Sky & Atmosphere / Sun / Moon / Clouds / Stars / Night. Nothing here feeds terrain generation, so **sky edits never invalidate a terrain or vegetation cache** — `terrainFingerprint()` hashes only biomes and probed heights.

- **One conversion point.** `render/main/domain/sky-recipe.ts` turns the authored hex/degrees into linear `THREE.Color`s, radians, and Bruneton scattering coefficients, memoized on the recipe object's identity (`activatePlanetDocument` swaps the whole config, so identity is an exact staleness check). Never parse `sky.*` hex strings anywhere else.
- **The atmosphere owns the surface sky.** `post/webgpu-atmosphere.ts` builds takram's `SkyNode` with `showSun`, `showMoon`, and `moonScattering` on. The sun disc and the phase-shaded moon are drawn *by the sky pass*, because only it has the transmittance LUT that reddens a body at the horizon. `scene-lighting.ts`'s `sunMesh` / `moonMesh` are the **orbital** bodies; `updateEnvironment` hides them whenever `resolveAtmosphereSkyActive()` is true, and that predicate has exactly one definition (`scene/scene-environment-apply.ts`) because two would drift and show two suns.
- **The additive `atmosphereMesh` shell is orbit-only.** Inside the atmosphere it was a second, non-physical blue wash stacked on the scattering solve, which is what flattened daylight. Do not re-enable it below `atmosphereHeightMeters`.
- **Night is lifted deliberately.** Physically, a moonless night in this model is black — no airglow, no zodiacal light, no galaxy. `post/night-sky-node.ts` adds those as an authored layer on sky pixels only (`depth == 1`), gated on `atmosphereSkyActive` and faded out with `spaceFactor` so orbit keeps its real black. Ambient has an authored floor (`sky.night.ambientIntensity`); moonlight scales with both moon elevation *and* phase.
- **The moon has real phases.** `update/sun-system.ts` puts it on its own inclined orbit with a `synodicPeriodDays` drift instead of pinning it opposite the sun (which is what made every night a full moon). `matrixMoonFixedToECEF` tidally locks its texture: first basis column = direction to the moon, third = orbit normal. The albedo map is procedural (`scene/moon-texture.ts`) — maria from fBm, craters placed as unit directions so they don't pile up at the poles.
- **Clouds are lit.** `effects/clouds/shell-node-material.ts` is domain-warped fBm shaded against the sun: thin edges transmit, thick cores self-shadow, a low sun washes the lit side with the authored sunset color, looking toward the sun lights a silver rim, and night falls to the night color plus moonlight. Coverage is sampled from the **planet-fixed** direction so banks stay over their geography. There is no GLSL fallback material — `WebGPURenderer` draws a raw `ShaderMaterial` as a blank node material, so `createCloudShell` requires the TSL factory.
- **Judge cloud cell size against the layer altitude, not the horizon.** A cell of size D on a deck at altitude h subtends `2·atan(D/2h)` overhead, so a 12 km cell on a 1.4 km deck is one cloud covering 80 degrees of sky. `CLOUD_CELL_METERS` (3 km) is the base-octave size at `layer.scale === 1`, derived from planet radius because coverage is sampled from a unit direction.
- **Cloud wind is authored in m/s, never rad/s.** `cloudDriftAngle` divides by the shell radius to get the rotation rate, so a value reads the same on a moon and on a gas giant. The pre-recipe deck hard-coded `0.0016 rad/s`, which on an Earth-sized planet is 10.2 km/s — Mach 30 — and only looked still because the coverage field was one cell per planet.
- **`clouds.sharpness` has a narrow useful range.** The coverage field is a normalized fBM — 0.5 mean, ~0.09 spread — so a sharpness above ~0.3 ramps density over several standard deviations and turns the whole sky into one gradient with no clear air.
- **Octave counts are shader constants, not uniforms.** `materials/tsl-noise.ts` compiles one fBm per octave count, normalized so the 0..1 range holds whatever the count is. Changing `clouds.detail`, or adding/removing a layer, is a different graph and needs a Play restart; coverage, sharpness, cell scale, altitude, drift, and the four colors are pushed as uniforms every frame and tune live.
- `DAY_LENGTH_SECONDS` is gone — day length is `sky.dayLengthSeconds`, read through `resolveSkyRecipe()`.

## Texture memory: derived KTX2 assets and the residency sweep

Synty GLBs embed 4k/8k PNG atlases. Decoded to RGBA8 with mips, one station
scene costs gigabytes, and nothing used to free it across a scene switch. Two
mechanisms now bound that; both are invisible until you break them.

**Derived assets (`<project>/.asteron/derived/`).** `npm run transcode:textures
-- --project <dir>` writes KTX2 (Basis) twins of every project GLB at the same
relative path. Source GLBs are never mutated, because `scripts/bake_*.py` parse
the embedded PNG/JPEG with Pillow and must keep working — **run the bake scripts
first, then transcode.** Requires KTX-Software's `ktx` binary: install via
AsteronEngine **Tools → Packages…** (managed under `~/.asteron/tools/`), or set
`ASTERON_KTX`, or put `ktx` on PATH. **Tools → Transcode Project Textures…**
runs the same script from the editor.

`scripts/derived-assets.mjs` is the single resolution rule, imported by both
`editor-desktop/repository.mjs` (`resolveAssetReadPath`, used by every editor
asset request) and `vite.config.ts` (`preferDerivedAsset`, used by the release
copy). It prefers the twin when present and not older than its source, and falls
back to the source on any doubt — so with no derived tree the engine behaves
exactly as before. Rules that are easy to violate:

- Never route a **write** path (save/upload/move/delete) through the derived
  resolver — a rename would move the twin over its own source. That is why
  `resolveAssetPath` and `resolveAssetReadPath` are separate functions.
- In `vite.config.ts`, `sourceRoot` must move with `sourcePath`.
  `enqueueGltfDependencies` validates a `.gltf`'s sibling `.bin` with
  `isInsidePath(..., sourceRoot)`; leaving the root behind ships a data-less glTF.
- The transcode script **refuses to write a file whose textures lost their
  names.** `GLTFLoader` names a texture from `textures[].name || images[].name`,
  and a KTX2 image is a bufferView with no URI fallback. Nameless textures make
  `canonicalTextureKey` return null, runtime dedup stops entirely, and the result
  is worse than no compression.

All ten `new GLTFLoader()` sites call `attachKtx2Loader` (`src/render/assets/ktx2.ts`),
including `src/physics/colliders.ts` — the extension is written as *required*, so
a loader without it throws. One shared `KTX2Loader` app-wide; its worker pool is
never disposed on a scene switch. The transcoder is vendored at `public/basis/`.

**Residency sweep (`src/cache/asset-residency.ts`).** Module-level asset caches
register an evict callback and stamp `touchAsset` on every read.
`beginAssetGeneration()` runs at the top of `startPlaySession`, `sweepUnusedAssets()`
*after* the new scene is published — so an asset both scenes use is already
stamped and survives, and reuse costs no reload. Mark-and-sweep, not refcounting:
loads are fire-and-forget with no owner handle, and a missed stamp costs one
reload while a missed decrement would pin gigabytes.

- `loadPrefabModel` hands out `template.clone(true)`. Clones **share** geometry
  and materials. Use `disposeOwnedGpuResources` on an instance (frees only what
  `userData.ownedGpu` collected) and `disposeCacheTemplate` only on a cache
  template. `disposeCacheTemplate` skips canonical textures; those are refcounted
  by `releaseTextureOwner` in `src/render/assets/texture-dedup.ts`.
- Authoring surfaces that hold clones outside a play session must pass
  `{ pin: true }` / `{ pinModels: true }` — editor viewport, material panels,
  equipment preview. Without the pin, a sweep triggered by Play tears down
  geometry their own WebGL context is still rendering.
- `src/render/assets/texture-upload.ts` closes decoded ImageBitmaps after upload,
  and is **disabled under `AUTHORING_ENABLED`**: the editor runs several WebGL
  contexts over the same templates, and a bitmap closed after uploading to one
  can never reach the others.

The HUD stats panel reports `GPU`, `Tex Mem`, and `Assets` rows. If `GPU tex`
jumps after a transcode, texture names were lost.

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
- **Ship (exterior entry)**: `ship-controller.entry: "exterior"` marks an open-frame hull with **no walkable interior** (hovercraft, buggy, single-seat fighter). Ship-local Rapier is never created for it. Boarding is a ground-level circle test (`nearShipEntryPoint`, from `ship-entry` marker components baked into `ShipLayout.entryPoints`, falling back to the pilot seat's ground projection) → `beginSitTransition` straight from `MODE_ON_FOOT` / `MODE_IN_STATION`. Leaving the seat runs the exterior branch in `updateTransition`, which hands mode selection to `TransitionContext.onDisembarked` → `padInterest.leaveShipDeck()` so planet-vs-hangar resolution is shared with the deck path. `collectShipLayoutIssues` swaps the deck-collider/deck-spawn blockers for a mandatory pilot seat. Gate any new deck-only behaviour on `usesColliderDeck()`, not on "is a ship".
- **Ship flight**: Rapier owns the flying hull; flight computer in `flight/` emits forces/torques (`flight-aim` + demand mix). Target law: `docs/docs/architecture/ship-flight.md`. Parked deck stays ship-local Rapier — do not dual-drive pose. Legacy custom pose integrate is compat only.

## Common gotchas

- **F6 Play is a solid blue/dark screen but footsteps work**: `#editor-play-host` is a sibling of `#editor-root`. The editor shell (`sc-ui.css`) is fixed at `z-index: 250` with an opaque background; if the play host stacks below that, the canvas paints but stays invisible under the shell (`--ed-viewport` / `#141a21` shows through). Keep `#editor-play-host` above the shell (`z-index: 260` in `src/editor/styles.ts`). Also mount play chrome into `#editor-play-host`, not `document.body` — a body-mounted chrome leaves the host as an empty overlay that eats clicks. Symptom looks like a render/GPU failure; it is stacking.
- **F-key does nothing for station animation doors**: `consumeActions()` (`src/input/player-controls.ts`) returns `wasKeyPressed` as a closure. It must snapshot `justPressed` before `justPressed.clear()` runs, otherwise the closure always reads an empty set. `interactPressed` is a captured boolean and is safe; only `wasKeyPressed` had this bug.
- **"Open on spawn" works but F doesn't**: the animation init path (`stationAnimationStates` seeded from `defaultOpen`) runs without any key input, so it masks a broken key-press path. If `defaultOpen` works but F doesn't, suspect the `wasKeyPressed` closure or the `prefab-info` interaction branch.
- **Door animates visually but player can't walk through**: the collider isn't bound to the animation (check `collider.animation` is set) or the Rapier collider isn't being toggled (check `setDoorColliderEnabled` is called in `updateStationAnimations`).
- **Character floats above the seat / sits "on top of" the chair**: a seat marker is the seated character's **root**, and `character-avatar-model.ts` drops the avatar so its bounds rest on that origin — the marker belongs at deck level under the chair, not on the cushion. The bake derives `pilotEye` as marker + `eye` (scene axes, default `0, 0.87, 0.25`), so first-person height is tuned with `eye`, never by raising the marker. Raising the marker moves body and camera together and breaks the sitting pose. The viewport seat gizmo draws the root as a floor disc and the eye as the sphere for exactly this reason.
- **Door animation with no bound collider**: `ship-runtime.ts` `bindColliderAnimations` and `station-runtime.ts` `bindStationColliderAnimations` log a warning **per door/animation** that has zero colliders bound to its node(s) — the door will animate but its collider stays enabled (player can't walk through). A collider with no matching node is a normal static floor/hull collider and is intentionally **not** warned about (that was a prior false-positive flood). Check the console for "has no collider bound".
- **Ship pitch bounces after mouse aim**: Aim-track overshoot — raise `AIM_TRACK_DAMPING` in `flight-config.ts` or lower per-ship pitch torque / `maxAngularRateRadps`. See ship-flight skill.
- **One ship too twitchy / sluggish**: tune that prefab's `ship-controller` mass/thrust/torque — do not edit `FLIGHT_CONFIG` unless every hull is wrong.
- **Preview pilot won't exit**: Hold Y should always leave the seat (same as main play). If the hold doesn't fire, check `exitSeat` binding / `updateExitSeatHold` in `player-controls.ts`.
- **Players cannot see each other**: three unrelated causes wear the same face, so identify the layer before changing code. (1) *No world session at all* — the console shows `WebTransport dial to … failed`; check `WEBTRANSPORT_ALLOWED_ORIGINS`, then UDP 4433, then the certificate (`deploy/README.md` § Diagnosing a failed dial). (2) *Session is up, peers are frozen or absent* — presence is publishing the wrong body; run Debug → Multiplayer with drift logging and read the number. (3) *Peers appear, then stop* — replication sizing or interest radius, covered under Authoritative multiplayer. Chat proves nothing about any of them: the server echoes your own messages back, so an empty cell looks identical to a working one.
- **`WebTransportError: Opening handshake failed` in a debug window but not the editor**: the game windows dial from the Vite dev origin (`http://127.0.0.1:5173`) or `cceditor://app`, not from `CLIENT_ORIGIN`. Both belong in `WEBTRANSPORT_ALLOWED_ORIGINS` in `backend/.env`. Also keep `WEBTRANSPORT_PUBLIC_URL` on an IP literal locally: Chromium resolves `localhost` to `::1` first, and the listener binds IPv4.

## Key files

| File | Role |
| --- | --- |
| `src/world/prefabs/schema.ts` | Component type definitions + validators |
| `src/world/prefabs/ship-runtime.ts` | Ship prefab → ShipLayout + collider animation binding |
| `src/world/prefabs/station-runtime.ts` | Station prefab → StationLayoutOverride + collider animation binding |
| `src/world/ladders.ts` | Pure ladder specs + climb integrator (station and ship) |
| `src/player/ladder-climb.ts` | Surface-agnostic climb step shared by station-walk and ship-deck |
| `src/world/npc.ts` | Station NPC authoring specs + route validation |
| `src/npc/catalog.ts` | Reusable friendly NPC definitions and population pools |
| `src/npc/station-population.ts` | Deterministic cosmetic station population + waypoint movement |
| `src/render/main/scene/station-npcs.ts` | Station NPC avatar lifecycle, animation, and distance activation |
| `src/world/planets/sky-schema.ts` | Authored `sky` block: day length, scattering, sun, moon, stars, clouds, night palette |
| `src/render/main/domain/sky-recipe.ts` | Sole hex/degrees → linear colors, radians, scattering coefficients conversion |
| `src/render/main/post/webgpu-atmosphere.ts` | Takram sky/aerial graph, sun disc, phase-shaded moon, star field, LUT compute |
| `src/render/main/post/night-sky-node.ts` | Airglow, horizon glow, and nebula band added onto sky pixels at night |
| `src/render/main/scene/moon-texture.ts` | Procedural equirect moon albedo (maria + craters) for `MoonNode` |
| `src/render/effects/clouds/shell-node-material.ts` | Sun-lit, domain-warped fBm cloud deck (TSL; no GLSL fallback) |
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
| `src/flight/flight-config.ts` | Global flight computer / drag / damping / mouse aim knobs |
| `src/flight/flight-aim.ts` | Aim state, mouse → aim, PD flight computer torque demand |
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
| `.cursor/skills/ship-flight/SKILL.md` | Flight tuning skill (mass/thrust/flight computer symptoms) |
| `.cursor/skills/prefab-editor/SKILL.md` | Prefab editor skill |
| `.cursor/skills/prd/SKILL.md` | PRD handoff packs under `prds/<slug>/` (README, PRD, phases, checklist) |
| `docs/docs/architecture/scene-flow.md` | Boot / Game Manager: Title → Create → Home World → Hab; one precedence rule |
| `.cursor/rules/scene-flow-architecture.mdc` | Thin always-on pointer to the scene-flow architecture doc |
| `docs/docs/architecture/game-loop.md` | Player game loop: Hab → Station → AVMS → Hangar → Open Space |
| `.cursor/rules/game-loop-architecture.mdc` | Thin always-on pointer to the game-loop architecture doc |
| `docs/docs/architecture/multiplayer.md` | Cell / edge / client, presence body, character presentation (loadout / pose / fire), travel intents, instances |
| `.cursor/rules/multiplayer-architecture.mdc` | Thin always-on pointer to the multiplayer architecture doc |
| `docs/docs/architecture/space-traversal.md` | Open Space host + station boarding + Warp Gate cross-system |
| `.cursor/rules/space-traversal-architecture.mdc` | Thin always-on pointer to the space-traversal architecture doc |
| `docs/docs/architecture/star-map.md` | Star System ↔ Star Map; ecliptic catalog; Warp Gates between systems |
| `.cursor/rules/star-map-architecture.mdc` | Thin always-on pointer to the Star Map architecture doc |
| `docs/docs/architecture/ship-flight.md` | Rapier flight + flight computer: Traverse / Combat / Nav, boost, quantum, contacts |
| `.cursor/rules/ship-flight-architecture.mdc` | Thin always-on pointer to the ship-flight architecture doc |
| `docs/docs/architecture/ship-physics.md` | Vacuum inertia, residual coast, coupled assist, atmosphere drag |
| `.cursor/rules/ship-physics-architecture.mdc` | Thin always-on pointer to the ship-physics architecture doc |
| `docs/docs/architecture/ship-combat.md` | Blasters / missiles, lock-on, lead markers, combat HUD, shields→hull, hierarchy death |
| `.cursor/rules/ship-combat-architecture.mdc` | Thin always-on pointer to the ship-combat architecture doc |
| `docs/docs/architecture/content-delivery.md` | Build Web vs Postgres catalog vs one-shot migrations |
| `.cursor/rules/content-delivery-architecture.mdc` | Thin always-on pointer to the content-delivery architecture doc |
| `docs/docs/architecture/player.md` | Character HP, hunger, thirst, temp/air, medicine toxicity, HUD |
| `.cursor/rules/player-architecture.mdc` | Thin always-on pointer to the player architecture doc |
| `docs/docs/architecture/home-worlds.md` | Home world select; Asteron / Virelia / Korrath; starter Hab bind |
| `.cursor/rules/home-worlds-architecture.mdc` | Thin always-on pointer to the home-worlds architecture doc |
| `docs/docs/architecture/player-death.md` | Death / respawn: custom point or home-world Hab |
| `.cursor/rules/player-death-architecture.mdc` | Thin always-on pointer to the player-death architecture doc |
| `docs/docs/architecture/haloband.md` | Personal device UI: tabs, suppress, Map/Mall/Inventory |
| `.cursor/rules/haloband-architecture.mdc` | Thin always-on pointer to the HaloBand architecture doc |
| `docs/docs/architecture/item-mall.md` | AC mall: consumables, outfit packs/slots, placeables |
| `.cursor/rules/item-mall-architecture.mdc` | Thin always-on pointer to the Item Mall architecture doc |
| `docs/docs/architecture/stripe.md` | In-game Payment Element; no React; webhook-only grants |
| `.cursor/rules/stripe-architecture.mdc` | Thin always-on pointer to the Stripe architecture doc |
| `docs/docs/architecture/npc.md` | MMO NPCs: crowd LOD, shops, dialogue, missions; not mobs |
| `.cursor/rules/npc-architecture.mdc` | Thin always-on pointer to the NPC architecture doc |
| `docs/docs/architecture/mobs.md` | PVE mobs: monsters/animals; cell combat; not NPCs |
| `.cursor/rules/mobs-architecture.mdc` | Thin always-on pointer to the mob architecture doc |

## Utility scripts

| Script | Purpose |
|--------|---------|
| `scripts/build_project_web.mjs` | Build a shippable web release for an external project (`npm run build:project-web -- --project <dir>`) |
| `scripts/inspect_glb.mjs` | List node names/bindings in a GLB (for `ship-door` bindings) |
| `scripts/measure_desync.ts` | Compare analytic vs mesh height at a landing site |
| `scripts/validate_terrain_system.ts` | Validate terrain LOD, seams, mesh/foot fidelity, and routed hydrology |
| `scripts/spike-demo.ts` | Headless scripted takeoff/orbit/landing (`npm run demo`) |
| `scripts/bake_ship_textures.py` | Fix Unity trim-sheet materials for Three.js PBR |
| `scripts/transcode_project_textures.mjs` | Write KTX2 twins to `<project>/.asteron/derived/` (`npm run transcode:textures -- --project <dir>`, or Tools → Transcode Project Textures…). Needs `ktx` via Tools → Packages, `ASTERON_KTX`, or PATH. Run after the bake scripts |
| `scripts/resolve_ktx.mjs` | Resolve managed / env / PATH `ktx` binary |
| `editor-desktop/engine_tools.mjs` | Tools → Packages: download/install KTX-Software under `~/.asteron/tools/` |
| `scripts/derived-assets.mjs` | Shared source-vs-derived resolution rule; imported by `vite.config.ts` and `editor-desktop/repository.mjs` |
| `scripts/check_page.mjs` | Page validation |

## Other conventions

- `.cursor/rules/agent-conventions.mdc` exists and defers to this file as the primary source — update both if changing architecture boundaries.
- Project skills: `.cursor/skills/prefab-editor/`, `.cursor/skills/ship-flight/`, `.cursor/skills/prd/` — read when editing those domains (PRD packs when creating `prds/` handoffs).
- Export **factories + pure functions** from domain modules (not classes). Three.js objects never appear in `world/` or `flight/`.
- Prefab JSON lives in the project asset library as `<folder>/<id>.prefab.json` and is committed (metadata only) — `.gitignore` re-includes `*.prefab.json` under the otherwise-ignored `/assets/` tree. The game bundles them via a recursive `import.meta.glob`.
- **Filenames:** `*.ts` is kebab-case, `*.tsx` is PascalCase (except Vite's `main.tsx`) — enforced by `eslint-plugin-check-file`. Directories were not migrated and several remain snake_case (`src/render/planet_tiles/`, `src/world/surface_spawns/`, `src/app/ship_sandbox/`, `src/render/effects/lake_water/`), as do `scripts/` files, which are exempt.
- Response style (caveman mode) is configured per-tool in `.cursor/rules/caveman.mdc`, `.clinerules/caveman.md`, and `.windsurf/rules/caveman.md` — not here. This file is architecture only.
