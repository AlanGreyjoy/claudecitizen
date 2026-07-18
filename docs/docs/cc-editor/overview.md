---
sidebar_position: 1
title: Overview
description: What the CC Editor is — a dev-only world builder and prefab authoring tool.
---

# CC Editor overview

The **CC Editor** (ClaudeCitizen Editor) is the dev-only in-browser authoring environment for ClaudeCitizen. It is both a **3D scene builder** and a **prefab authoring tool**: you assemble environments from GLB models, box primitives, and lights, place gameplay markers and colliders, then save the result as versioned JSON that the game loads at runtime.

Production builds strip all editor code. The editor is only available under `npm run dev`.

![CC Editor layout](/img/editor-screenshot.png)

The screenshot shows the Unity-style layout: hierarchy, scene view, inspector, and project browser. Here a station corridor is being assembled from modular GLB pieces with colliders and transform gizmos.

## Builder + prefab author

Think of the CC Editor in two layers:

| Layer | What you do |
| --- | --- |
| **Scene building** | Drag GLBs into the viewport, add boxes and empties, parent and transform entities, edit GLB sub-meshes, tune materials, place lights |
| **Prefab authoring** | Pick a **prefab kind** (station, ship, site, prop, item), attach **gameplay components** (spawn points, doors, colliders, interactions), save to `src/world/prefabs/data/<id>.prefab.json` |

Saved prefabs are plain JSON tracked in git (metadata only — asset URLs may point at gitignored protected files). The game bundles them via Vite and the production build copies only referenced assets.

## Prefab kinds at a glance

| Kind | Purpose |
| --- | --- |
| **station** | Orbital stations — modular interiors with spawn, elevators, hangar pads, AVMS terminals |
| **ship** | Flyable ships — hull, deck colliders, doors, pilot seats, landing gear, boarding ramp |
| **site** | General-purpose world sites (outposts, landmarks) — colliders, interactions, lights |
| **prop** | Placeable hangar/apartment decorations for the player build system |
| **item** | Inventory item visuals — world pickup or icon-only catalog entries |

See [Prefab kinds](./prefab-kinds) for when to use each.

## Architecture

```mermaid
flowchart LR
  UI["src/editor/ panels + document"]
  Viewport["src/render/editor/ viewport"]
  Schema["world/prefabs/schema.ts"]
  JSON["prefab JSON on disk"]
  Game["prefab_renderer + runtime"]

  UI --> Viewport
  UI --> Schema
  UI -->|"serialize.ts"| JSON
  JSON --> Game
  Viewport -->|"live preview"| Game
```

| Path | Role |
| --- | --- |
| `src/editor/` | Document store, panels, commands, serialization, dev API client |
| `src/render/editor/` | Three.js viewport, character previewer, thumbnails |
| `src/world/prefabs/schema.ts` | Canonical prefab JSON contract and validators |
| `src/world/prefabs/component_registry.ts` | Component palette metadata per prefab kind |
| Vite `/__editor/*` routes | Dev-only save/load and asset listing |

Domain simulation rules stay in `world/`, `flight/`, and `player/`. The editor writes prefab data; it does not own gameplay logic.

## Open the editor

From the title screen (**Editor** button) or deep-link:

```text
http://localhost:4173/?boot=editor
```

Reopen a saved prefab after playtesting:

```text
http://localhost:4173/?boot=editor&prefab=<prefab-id>
```

## Doc map

- [Getting started](./getting-started) — first session workflow
- [Interface](./interface) — panels, toolbar, shortcuts, scene tabs
- [Building scenes](./building-scenes) — entities, transforms, GLB editing
- [Components](./components) — gameplay component system
- [Station authoring](./station-authoring)
- [Ship authoring](./ship-authoring)
- [Props and items](./props-and-items)
- [Character preview](./character-preview)
- [Material manager](./material-manager)
- [Planet authoring](./planet-authoring)
- [System Map](./system-map)
- [Menu Manager](./menu-manager)
- [Assets and GLB](./assets-and-glb)
- [Preview and playtest](./preview-and-playtest)
