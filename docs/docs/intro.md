---
slug: /
sidebar_position: 1
title: Introduction
---

# ClaudeCitizen

![ClaudeCitizen banner](/img/banner-with-logo.png)

A space sandbox inspired by Star Citizen — procedural planets, ship flight,
on-foot exploration, and seamless surface-to-orbit transitions. The game runtime
is TypeScript and Three.js; online play runs on an authoritative Rust backend
with shared Rust/WASM prediction and Protobuf over WebTransport.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes,
vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted
development rather than a formal spec. It is a passion sandbox, not a production
product.

![ClaudeCitizen gameplay screenshot](/img/screenshot.png)

## Two surfaces

ClaudeCitizen ships **one authoring app and one server**. Everything else is a
build output of those two.

| Surface | What it is | Owns |
| --- | --- | --- |
| **[AsteronEngine](/editor)** | Electron desktop editor | Projects, scenes, prefabs, planets, systems, base characters, menus, the Server console, and web builds |
| **[Rust backend](/engineering/stack)** | Axum + Rapier + SQLx + Redis | Auth, catalog, persistence, authoritative cell simulation |

The browser game is a **build target**, not a separate development surface.
There is no Vite dev server to run, no second desktop shell, and no standalone
admin app — the operator console is the editor's [Server tab](/server-console).

## AsteronEngine

**AsteronEngine** is the only authoring workspace: a Unity-style Electron app for
scenes, prefabs, planets, Play mode, and release builds. Cold start opens the
**Projects** hub — create or open a project, and the editor loads it.

![AsteronEngine editor layout](/img/editor-screenshot.png)

Drag GLBs into a scene, tune colliders and components, press **F6** to play the
open document in-window, and use **File → Build Web** to produce the browser
release. See the [AsteronEngine overview](/editor) for the full authoring guide.

## Playing the game

There is no hosted public build. You play either:

- **In the editor** — press **F6** on the open scene ([Play mode](/editor/preview-and-playtest))
- **From a release** — run **File → Build Web** and serve the output directory anywhere static

See [Controls](/play) for input bindings and quality presets.

## What's in the box

- **Procedural planet** — cube-sphere tiles, height sampling, landing sites, lake water
- **Flight** — Rapier hull + flight computer, atmospheric gravity (planet *g*), vacuum thruster flight, drag, dual-reticle mouse aim
- **Player** — third-person character, ship boarding, walkable ship decks and stations
- **Rendering** — tiled terrain meshing (Web Worker), instanced vegetation, star field, Takram atmosphere/clouds, volumetric fog, post-processing
- **Online backend** — Axum APIs, native Rapier cell authority, PostgreSQL/SQLx persistence, Redis coordination, container image (`backend/Dockerfile`)

## Next steps

- [Quick start](/quick-start) — install and open the editor
- [AsteronEngine](/editor) — scenes, prefabs, and authoring
- [Architecture](/architecture/scene-flow) — scene flow, game loop, multiplayer, space, ships
- [Projects and settings](/editor/projects-and-settings) — hub, project JSON, backend proxy
- [Controls](/play) — input bindings and quality presets
- [Server console](/server-console) — catalog, players, and game settings
- [Assets](/assets) — project assets, protected packs, character avatars
- [Roadmap](/roadmap) — living feature checklist
- [Engineering](/engineering) — stack, DDD boundaries, planet math, design principles
