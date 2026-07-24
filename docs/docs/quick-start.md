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

The Electron editor is the normal project workspace. Use its Play button for
local testing and **File → Build Web** for a browser release.

## CC Editor

See the [CC Editor](/cc-editor) docs for scenes, prefabs, Play Mode, and builds.

## Admin App

The operator console for the Rust backend (users, ship/prop/item catalogs, game settings) loads via:

```text
http://localhost:4173/?boot=admin
```

Requires `npm run dev:infra`, `npm run dev:server`, and admin credentials in `backend/.env`. See the [Admin App](/admin-app) docs.

## Commands

| Script | Description |
| --- | --- |
| `npm run editor` | Build and launch the standalone Electron editor |
| `npm run build:editor:desktop` | Package an unpacked editor |
| `npm run dev:infra` | Start PostgreSQL, Redis, and Mailpit |
| `npm run dev:server` | Watch, rebuild, and restart the Rust API and authoritative cell server |
| `npm run start:server` | Run the Rust backend once without file watching |
| `npm run backend:migrate` | Apply committed SQLx migrations |
| `npm run build:wasm` | Build shared Rust prediction code for the browser |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run build:protected` | Compatibility alias for `npm run build` |
| `npm run deploy:netlify` | Draft Netlify deploy |
| `npm run deploy:netlify:prod` | Production Netlify deploy |
| `npm run deploy:netlify:protected` | Compatibility alias for draft Netlify deploy |
| `npm run deploy:netlify:protected:prod` | Compatibility alias for production Netlify deploy |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm run demo` | Headless scripted takeoff / orbit / landing demo |
| `npm run docs:dev` | Local Docusaurus docs site (port 3000) |
| `npm run docs:build` | Build static docs to `docs/build/` |

The backend watcher requires Watchexec:

```bash
cargo install watchexec-cli --locked
```

Rust changes are rebuilt incrementally. Watchexec sends `SIGTERM`, waits up to 20 seconds for graceful shutdown, and then starts the updated backend. Changes under `backend/`, `proto/`, or the root Cargo configuration trigger a restart.

## Netlify deployment (game)

Netlify uses `npm run build` and publishes `dist/` via `netlify.toml`.

```bash
npm run deploy:netlify       # draft deploy
npm run deploy:netlify:prod  # production deploy
```

Anything included in a Netlify deploy is publicly downloadable by clients. Keep proprietary source libraries under `editor/assets/protected/`; only reference assets in prefabs when they are allowed to ship in that build. See [Assets](/assets) for details.

## Project layout

```
src/
  app/                Application loop and mode FSM
  math/               Pure vector math
  world/              Planet, surface, coordinates, clouds, prefabs
  flight/             Ship physics and input
  player/             Character, deck, ship interaction
  render/             Three.js presentation layer
  assets/             GLTF models (ship, vegetation)
backend/
  crates/server/      Axum API, cell authority, WebTransport
  crates/sim-core/    Shared native/WASM prediction and Rapier authority
  crates/protocol/    Generated Protobuf types and framing
  migrations/         SQLx/PostgreSQL migrations
proto/                Canonical realtime Protobuf schema
deploy/k8s/           Kubernetes deployment manifests
editor/
  assets/             Local editor asset library (free/protected)
scripts/              Dev utilities and the orbit demo
AGENTS.md             Architecture and agent conventions
```

Domain rules live in `world/`, `flight/`, and `player/`. Rendering reads from those modules but does not own simulation state. See [Engineering](/engineering) for the full dependency map.
