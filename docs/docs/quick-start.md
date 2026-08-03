---
sidebar_position: 2
title: Quick start
---

# Quick start

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer (CI builds on 24)
- [Rust](https://rustup.rs/) — `rust-toolchain.toml` pins 1.96.0 and installs the
  `wasm32-unknown-unknown` target automatically
- npm

Rust is required even for editor-only work: the build compiles the shared
prediction core to WASM (`npm run build:wasm`).

## Open the editor

From the repository root:

```bash
npm install
npm run editor
```

`npm run editor` builds the renderer and launches the Electron app.
`npm run editor:dev` starts the same app with Vite HMR and React Fast Refresh —
use that one while iterating.

Cold start opens the **Projects** hub. Create a new project or open an existing
one, and the editor workspace loads on that project root. Press **F6** to play
the open scene, **F7** to pause, and use **File → Build Web** for a browser
release.

There is no Vite dev server to start separately — Electron owns Vite.

## AsteronEngine

See the [AsteronEngine](/editor) docs for projects, scenes, prefabs, components,
Play mode, and builds.

## Server console

The operator console for the Rust backend (players, catalog definitions, game
settings) is the **Server** tab inside the editor. It needs `npm run dev:infra`,
a running backend, and admin credentials in `backend/.env`. See the
[Server console](/server-console) docs.

## Commands

### Editor

| Script | Description |
| --- | --- |
| `npm run editor` | Build the renderer and launch AsteronEngine |
| `npm run editor:dev` | Launch AsteronEngine with Vite HMR / React Fast Refresh |
| `npm run build:editor:web` | Build the editor renderer into `dist-editor/` |
| `npm run build:editor:desktop` | Package an unpacked editor build |
| `npm run editor:desktop:package` | Build the current platform's editor distributable |

### Game

| Script | Description |
| --- | --- |
| `npm run build:web` | Typecheck + build the web release target (what **File → Build Web** runs) |
| `npm run build:wasm` | Build shared Rust prediction code for the browser |
| `npm run demo` | Headless scripted takeoff / orbit / landing demo |

### Backend

| Script | Description |
| --- | --- |
| `npm run dev:infra` | Start PostgreSQL, Redis, and Mailpit in Docker |
| `npm run dev:server` | Watch, rebuild, and restart the Rust API and authoritative cell server |
| `npm run start:server` | Run the Rust backend once without file watching |
| `npm run backend:migrate` | Apply committed SQLx migrations |
| `npm run build:server` | Release build of the `cc-server` binary |

### Checks and docs

| Script | Description |
| --- | --- |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm run lint` | Run ESLint |
| `npm run terrain:validate` | Validate terrain LOD, seams, mesh/foot fidelity, hydrology |
| `npm run docs:dev` | Local Docusaurus docs site (port 3000) |
| `npm run docs:build` | Build static docs to `docs/build/` |

The backend watcher requires Watchexec:

```bash
cargo install watchexec-cli --locked
```

Rust changes are rebuilt incrementally. Watchexec sends `SIGTERM`, waits up to 20
seconds for graceful shutdown, and then starts the updated backend. Changes under
`backend/`, `proto/`, or `rust-toolchain.toml` trigger a restart.

## Shipping the game

**File → Build Web** runs the release build into the project's configured output
directory and writes `asteron.runtime.json` beside it containing the backend URL
and boot scene from **File → Project Settings…**. Deploy that directory to any
static host; re-stamp the runtime file to point the same bundle at a different
backend.

For large GLB texture atlases, install **KTX-Software** via **Tools →
Packages…**, then **Tools → Transcode Project Textures…** before building so
the release can prefer KTX2 twins under `.asteron/derived/`. See
[Packages and textures](/editor/packages-and-textures).

The backend URL is resolved at **runtime**, not baked in at build time — there is
no `VITE_API_BASE_URL`. There is also no client API key: players sign in with a
cookie session and operators use a separate admin session.

Anything in that directory is publicly downloadable. Keep proprietary source
libraries under the project's `assets/protected/`; only reference assets in
prefabs when they are allowed to ship. See [Assets](/assets) for details.

## Repository layout

```
src/
  editor-main.ts      Editor renderer entry (editor.html)
  game-main.ts        Game runtime entry (index.html)
  editor/             Editor logic, React shell, panels
  app/                Scene host, play session, in-play chrome
  math/               Pure vector math
  world/              Planet, surface, coordinates, prefabs, scenes, systems
  flight/             Ship physics and flight computer aim
  player/             Character, deck, ship interaction
  npc/                NPC definitions and station populations
  render/             Three.js presentation layer
editor-desktop/       Electron shell, Projects hub, backend proxy, Build Web
backend/
  crates/server/      Axum API, cell authority, WebTransport
  crates/sim-core/    Shared native/WASM prediction and Rapier authority
  crates/protocol/    Generated Protobuf types and framing
  migrations/         SQLx/PostgreSQL migrations
proto/                Canonical realtime Protobuf schema
scripts/              Dev utilities and the orbit demo
docs/                 This documentation site
AGENTS.md             Architecture and agent conventions
```

Authoring **content** lives inside the open AsteronEngine project (its own
`assets/` and scene/prefab data), not in this repository.

Domain rules live in `world/`, `flight/`, `player/`, and `npc/`. Rendering reads
from those modules but does not own simulation state. See
[Engineering](/engineering) for the full dependency map.
