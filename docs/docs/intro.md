---
slug: /
sidebar_position: 1
title: Introduction
---

# ClaudeCitizen

![ClaudeCitizen banner](/img/banner-with-logo.png)

A browser-based space sandbox inspired by Star Citizen — procedural planets, ship flight, on-foot exploration, and seamless surface-to-orbit transitions. Built with TypeScript, Vite, and Three.js.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes, vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted development rather than a formal spec. It is a passion sandbox, not a production product.

**Work in progress.** Phase 1 is FPS weapons and character-controller updates — see the [roadmap](/roadmap).

![ClaudeCitizen gameplay screenshot](/img/screenshot.png)

## CC Editor

The dev-only **CC Editor** is a Unity-style in-browser world builder for stations, ships, props, and gameplay markers. Drag GLBs into the scene, tune colliders and components in the inspector, and save prefabs as JSON the game loads at runtime.

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

## Next steps

- [Quick start](/quick-start) — run the game locally
- [Play](/play) — controls and quality presets
- [CC Editor](/cc-editor) — dev-only world builder and prefab authoring
- [Admin App](/admin-app) — operator console for catalog, users, and game settings
- [Assets](/assets) — protected models, Synty packs, character avatars
- [Roadmap](/roadmap) — living feature checklist
- [Engineering](/engineering) — stack, DDD, planet math, and design principles
