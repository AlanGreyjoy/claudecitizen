---
sidebar_position: 2
title: Getting started
description: Launch AsteronEngine, open a project, and save your first scene or prefab.
---

# Getting started

## Prerequisites

- Dependencies installed with `npm install`
- Rust toolchain (the editor build compiles the shared prediction core to WASM)

## Launch the editor

```bash
npm run editor:dev
```

Use `editor:dev` while iterating — Electron spawns Vite for HMR and React Fast
Refresh. `npm run editor` builds `dist-editor/` first and runs a production-like
app. Do not start a standalone Vite process; Electron owns it.

## Open a project

Cold start opens the **AsteronEngine — Projects** window:

| Action | How |
| --- | --- |
| **New Project** | File → New Project (`Ctrl+N`) — scaffolds a project folder |
| **Open Project…** | File → Open Project… (`Ctrl+O`) — pick an existing project root |
| **Recent** | Click any entry in the recents list |

Choosing a project closes the hub and opens the editor workspace on that project
root. A folder counts as a project when it has `package.json` and an `assets/`
directory. `asteron.project.json` holds the display name, backend URL, boot
scene, and build output — scaffolded on New Project and edited via **Project
Settings…**.

To skip the hub — handy for scripted launches — pass `--project-root=<path>` or set
`CLAUDECITIZEN_EDITOR_PROJECT_ROOT`.

Return to the hub later with **File → Open Project…**.

## Typical workflow

1. **Open or create a scene** — File → New Scene / Open Scene… (the Scene tab is the default 3D viewport). A new project already has a **Boot** scene wiring Title → Character Create → Starting Hab; see [Game flow](./game-flow).
2. **Build the scene** — Hierarchy shows GameObjects; drag GLBs from Project or add boxes/empties. Add `planet`, `player-start`, and `prefab-instance` components to decide what the scene is (`game-manager` belongs on the boot scene, where it owns the game flow).
3. **Edit prefabs** when needed — File → New Prefab / Open Prefab… (same viewport; the document bar shows Prefab).
4. **Save** with `Ctrl+S`.
5. **Play** with `F6`; `F7` pauses, `Shift+F6` stops.
6. **Build Web** with `Ctrl+B` or **File → Build Web**.

## Documents and settings

| Action | How |
| --- | --- |
| **New Scene / New Prefab** | File menu |
| **Open Scene… / Open Prefab… / Open Planets… / Open Menus…** | File menu |
| **Delete Scene…** | File menu or Open Scene browse — removes `<id>.scene.json` from the project (blocked if it is the project default scene) |
| **Scene Settings…** | File → Scene Settings… — per-scene startup options |
| **Project Settings…** | File → Project Settings… — edits `asteron.project.json` (name, backend URL, default scene, build output) |
| **Show Project Folder** | File menu — reveal the project root in your OS file manager |
| **Save** | Toolbar **Save** or `Ctrl+S` |

Scenes are written to the project's `src/world/scenes/data/<id>.scene.json`.
Prefabs are `<id>.prefab.json` files in the project's `assets/` library and may
live in any folder there — `assets/Prefabs/` is the default. A prefab is
referenced by its document `id`, never by its path, so you can move prefab files
around freely.

## How the editor reaches the disk

The renderer has no Node.js or arbitrary filesystem access. Electron exposes a
private, project-scoped HTTP API on the `cceditor:` protocol:

| Route | Purpose |
| --- | --- |
| `GET /__editor/assets` | List project assets (and `POST /__editor/assets/folder` to add a folder) |
| `GET/POST /__editor/prefab`, `GET /__editor/prefabs` | Load and save prefab documents |
| `GET/POST /__editor/scene`, `GET /__editor/scenes`, `POST /__editor/scene/delete` | Load, save, and delete scene documents |
| `GET/POST /__editor/planet`, `GET /__editor/planets` | Planet documents |
| `GET/POST /__editor/system`, `GET /__editor/systems` | System Map documents |
| `GET/POST /__editor/base-characters` | Base character definitions |
| `GET/POST /__editor/character-settings` | Shared walk/sprint/jump tuning |
| `GET/POST /__editor/animation-controllers` | Animation controller documents |
| `GET/POST /__editor/project-settings` | `asteron.project.json` |
| `/__editor/backend/*` | Proxy to the project's configured Rust backend |

Client helpers live in `src/editor/api.ts`.

The backend proxy exists because the renderer's `cceditor://app` origin cannot
pass the backend's single-origin CORS check or hold session cookies. Editor →
backend traffic always goes through `/__editor/backend/*`.

## Unsaved changes

Closing the window or switching documents prompts when there are unsaved edits.

## Quick examples

| Goal | Start here |
| --- | --- |
| Explore an existing station | Open the `demo-station` prefab, then press **F6** |
| Edit the default player ship | Open `phobos-starhopper`, then press **F6** |
| Make a hangar decoration | Set kind to `prop`, build geometry, save as `hangar-crate-01` style |
| Drop a ship GLB | Drag from the project's `assets/.../ships/` — the editor offers Ship Editor mode |

## Next steps

- [Interface](./interface) — layout, tabs, and shortcuts
- [Building scenes](./building-scenes) — entities, parenting, GLB drill-down
- [Prefab kinds](./prefab-kinds) — pick the right kind for your content
- [Preview and playtest](./preview-and-playtest) — Play mode and Build Web
