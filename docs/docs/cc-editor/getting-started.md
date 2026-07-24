---
sidebar_position: 2
title: Getting started
description: Open the CC Editor, create your first prefab, and save it to disk.
---

# Getting started

## Prerequisites

- Dependencies installed with `npm install`
- Optional: models in `editor/assets/` or `src/assets/` (see [Assets and GLB](./assets-and-glb))

## Open the editor

Launch the standalone Electron workspace:

```bash
npm run editor
```

## Typical workflow

1. **Open or create a scene** — File → New Scene / Open Scene (the Scene tab is the default 3D viewport).
2. **Build the scene** — Hierarchy shows GameObjects; drag GLBs from Project or add boxes/empties. Add GameManager / Planet / PlayerStart / Prefab Instance components for world config.
3. **Edit prefabs** when needed — File → New Prefab / Open Prefab (same viewport; document bar shows Prefab).
4. **Save** with `Ctrl+S`.
5. **Play** with `F6` (plays the open scene); press it again to stop.
6. **Build Web** with `Ctrl+B` or **File → Build Web**.

## New, load, save

| Action | How |
| --- | --- |
| **New Scene / New Prefab** | File menu |
| **Open Scene / Open Prefab** | File menu flyouts |
| **Scene Settings** | File → Scene → Settings… |
| **Save** | Toolbar **Save** or `Ctrl+S` |

Electron exposes a private, project-scoped API:

- `GET /__editor/prefabs` — list ids
- `GET /__editor/prefab?id=<id>` — load document
- `POST /__editor/prefab` — save document

Client helpers live in `src/editor/api.ts`.

## Unsaved changes

Closing the window or switching documents prompts when there are unsaved edits.

## Quick examples

| Goal | Start here |
| --- | --- |
| Explore an existing station | Load `demo-station`, then press **Play** |
| Edit the default player ship | Load `phobos-starhopper`, then press **Play** |
| Make a hangar decoration | Set kind to `prop`, build geometry, save as `hangar-crate-01` style |
| Drop a ship GLB | Drag from `editor/assets/.../ships/` — editor offers Ship Editor mode |

## Next steps

- [Interface](./interface) — learn the layout and shortcuts
- [Building scenes](./building-scenes) — entities, parenting, GLB drill-down
- [Prefab kinds](./prefab-kinds) — pick the right kind for your content
