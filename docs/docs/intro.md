---
slug: /
sidebar_position: 1
title: Introduction
---

# ClaudeCitizen

![ClaudeCitizen banner](/img/banner-with-logo.png)

A browser-based space sandbox inspired by Star Citizen — procedural planets, ship flight, on-foot exploration, and seamless surface-to-orbit transitions. The browser client uses TypeScript, Vite, and Three.js; online play runs on an authoritative Rust backend with shared Rust/WASM prediction and Protobuf over WebTransport.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes, vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted development rather than a formal spec. It is a passion sandbox, not a production product.

**Work in progress.** Phase 1 is third-person weapons and over-the-shoulder character-controller updates — see the [roadmap](/roadmap).

![ClaudeCitizen gameplay screenshot](/img/screenshot.png)

## CC Editor

The **CC Editor** is a standalone Unity-style Electron workspace for scenes,
prefabs, world settings, Play Mode, and web builds. Drag GLBs into prefabs,
tune colliders and components, create launchable scenes, and build the browser
release from the File menu.

![CC Editor layout](/img/editor-screenshot.png)

See the [CC Editor overview](/cc-editor) for the full authoring guide.

## Live play test

Play the latest build in your browser:

**[https://claudecitizen.netlify.app/](https://claudecitizen.netlify.app/)**

## What's in the box

- **Procedural planet** — cube-sphere tiles, height sampling, landing sites, lake water
- **Flight** — inertial ship body with radial gravity, drag, and hover assist near the pad
- **Player** — third-person character, ship boarding animations, walkable ship deck
- **Rendering** — tiled terrain meshing (Web Worker), instanced vegetation, star field, Takram atmosphere/clouds, volumetric fog, post-processing
- **Online backend** — Axum APIs, native Rapier cell authority, PostgreSQL/SQLx persistence, Redis coordination, and Kubernetes deployment

## Next steps

- [Quick start](/quick-start) — run the game locally
- [Play](/play) — controls and quality presets
- [CC Editor](/cc-editor) — standalone scene and prefab authoring workspace
- [Admin App](/admin-app) — operator console for catalog, users, and game settings
- [Assets](/assets) — protected models, Synty packs, character avatars
- [Roadmap](/roadmap) — living feature checklist
- [Engineering](/engineering) — stack, DDD, planet math, and design principles
