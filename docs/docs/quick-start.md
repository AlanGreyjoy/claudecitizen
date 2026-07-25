---
sidebar_position: 2
title: Quick start
---

# Quick start

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- Rust 1.96 with the `wasm32-unknown-unknown` target
- npm

## Open the project

From the repository root:

```bash
npm install
npm run editor
```

The AsteronEngine editor is the only authoring workspace. Cold start opens the
**Projects** hub; create or open a project and the editor loads it. Press **F6**
to play the open scene, **F7** to pause, and use **File → Build Web** for a
browser release.

## CC Editor

See the [CC Editor](/cc-editor) docs for scenes, prefabs, Play mode, and builds.

## Server console

The operator console for the Rust backend (users, catalog definitions, game
settings) is the **Server** tab inside the editor. It needs `npm run dev:infra`,
a running backend, and admin credentials in `backend/.env`. See the
[Server console](/admin-app) docs.

## Commands

| Script | Description |
| --- | --- |
| `npm run editor` | Build and launch the AsteronEngine editor |
| `npm run build:editor:web` | Build the editor renderer into `dist-editor/` |
| `npm run build:editor:desktop` | Package an unpacked editor |
| `npm run editor:desktop:package` | Build the current platform's editor distributable |
| `npm run dev:infra` | Start PostgreSQL, Redis, and Mailpit |
| `npm run dev:server` | Watch, rebuild, and restart the Rust API and authoritative cell server |
| `npm run start:server` | Run the Rust backend once without file watching |
| `npm run backend:migrate` | Apply committed SQLx migrations |
| `npm run build:wasm` | Build shared Rust prediction code for the browser |
| `npm run build:web` | Typecheck + build the web release target (what File → Build Web runs) |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm run lint` | Run ESLint |
| `npm run demo` | Headless scripted takeoff / orbit / landing demo |
| `npm run docs:dev` | Local Docusaurus docs site (port 3000) |
| `npm run docs:build` | Build static docs to `docs/build/` |

The backend watcher requires Watchexec:

```bash
cargo install watchexec-cli --locked
```

Rust changes are rebuilt incrementally. Watchexec sends `SIGTERM`, waits up to 20 seconds for graceful shutdown, and then starts the updated backend. Changes under `backend/`, `proto/`, or the root Cargo configuration trigger a restart.

## Shipping the game

**File → Build Web** runs the release build into the project's configured output
directory and writes `asteron.runtime.json` beside it containing the backend URL
and boot scene from **File → Project Settings…**. Deploy that directory to any
static host; re-stamp the runtime file to point the same bundle at a different
backend.

Anything in that directory is publicly downloadable. Keep proprietary source
libraries under `assets/protected/`; only reference assets in prefabs when
they are allowed to ship. See [Assets](/assets) for details.

## Project layout

```
src/
  editor-main.ts      Editor renderer entry (editor.html)
  game-main.ts        Game runtime entry (index.html)
  editor/             Editor logic, React shell, panels
  app/                Scene host, play session, in-play chrome
  math/               Pure vector math
  world/              Planet, surface, coordinates, clouds, prefabs, scenes
  flight/             Ship physics and input
  player/             Character, deck, ship interaction
  render/             Three.js presentation layer
  assets/             GLTF models (ship, vegetation)
editor-desktop/       Electron shell, Projects hub, backend proxy, Build Web
backend/
  crates/server/      Axum API, cell authority, WebTransport
  crates/sim-core/    Shared native/WASM prediction and Rapier authority
  crates/protocol/    Generated Protobuf types and framing
  migrations/         SQLx/PostgreSQL migrations
proto/                Canonical realtime Protobuf schema
scripts/              Dev utilities and the orbit demo
AGENTS.md             Architecture and agent conventions
```

Domain rules live in `world/`, `flight/`, and `player/`. Rendering reads from those modules but does not own simulation state. See [Engineering](/engineering) for the full dependency map.
