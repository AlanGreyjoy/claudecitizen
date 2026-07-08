---
sidebar_position: 2
title: Getting started
description: Open the CC Editor, create your first prefab, and save it to disk.
---

# Getting started

## Prerequisites

- `npm run dev` running (Vite on port **4173**)
- Optional: models in `editor/assets/` or `src/assets/` (see [Assets and GLB](./assets-and-glb))

## Open the editor

**Title screen** → **Editor**, or navigate directly:

```text
http://localhost:4173/?boot=editor
```

## Typical workflow

1. **Choose a prefab kind** in the toolbar dropdown (`station`, `ship`, `site`, `prop`, or `item`).
2. **Name the prefab** — the name field slugifies to the file id (e.g. `Demo Station` → `demo-station`).
3. **Build the scene** — drag GLBs from the Project panel into the viewport, or add **+ Box** / **+ Empty** from the toolbar.
4. **Add gameplay components** — use the Inspector's component search box, hierarchy context menus, or viewport right-click on a GLB sub-mesh.
5. **Save** — toolbar **Save** or `Ctrl+S`. Writes to `src/world/prefabs/data/<id>.prefab.json`.
6. **Preview** — **Preview Station** or **Preview Ship** (when kind allows) saves and jumps into a play sandbox.

## New, load, save

| Action | How |
| --- | --- |
| **New** | Toolbar **New** — clears the document (prompts if unsaved) |
| **Load** | Toolbar **Load** menu — lists saved prefab ids from disk |
| **Save** | Toolbar **Save** or `Ctrl+S` — requires a name and at least one root entity |

The dev server exposes a private API:

- `GET /__editor/prefabs` — list ids
- `GET /__editor/prefab?id=<id>` — load document
- `POST /__editor/prefab` — save document

Client helpers live in `src/editor/api.ts`.

## Unsaved changes

Closing the tab or clicking **Exit** prompts if the document is dirty. The browser `beforeunload` guard also fires when you have unsaved edits.

## Quick examples

| Goal | Start here |
| --- | --- |
| Explore an existing station | Load `demo-station`, then **Preview Station** |
| Edit the default player ship | Load `phobos-starhopper`, then **Preview Ship** |
| Make a hangar decoration | Set kind to `prop`, build geometry, save as `hangar-crate-01` style |
| Drop a ship GLB | Drag from `editor/assets/.../ships/` — editor offers Ship Editor mode |

## Next steps

- [Interface](./interface) — learn the layout and shortcuts
- [Building scenes](./building-scenes) — entities, parenting, GLB drill-down
- [Prefab kinds](./prefab-kinds) — pick the right kind for your content
