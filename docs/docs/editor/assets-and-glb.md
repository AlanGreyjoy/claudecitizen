---
sidebar_position: 12
title: Assets and GLB
description: Project asset libraries, protected packs, GLB node editing, and inspection tools.
---

# Assets and GLB

AsteronEngine serves assets from the **open project**, not from the engine
checkout. The Project panel browses a single root under that project:

## Asset root

| Root | Path on disk (in the project) | Served at |
| --- | --- | --- |
| **Project library** | `assets/` | `/assets/...` |

The engine checkout's own `src/assets/` holds engine-owned assets (atmosphere
LUTs, skybox, star catalog, brand art), is reached only through ESM imports,
and is not a project asset root.

New projects are scaffolded with `assets/free/` and `assets/protected/`. Prefab
JSON stores absolute URLs like `/assets/protected/synty/.../Wall_01.glb`.

### Protected packs

`assets/protected/` is for paid or otherwise non-redistributable packs. Keep
those out of git. Prefabs reference only the files they need; **File → Build
Web** copies referenced protected assets into the release (see
[Assets](/assets)).

Never commit protected source libraries. Commit prefab JSON (metadata only).

## Project browser

- **Folder tree** — browse `assets`, `protected`, ship folders, etc.
- **Thumbnail grid** — GLB/GLTF show rendered thumbnails; images show lazy-loaded previews
- **Drag and drop** — drop model cards into the Scene viewport
- **Refresh** (↻) — rescan disk after adding files externally

Empty files show a warning badge (`!`) — usually a bad export or Git LFS miss.

## Placing models

Dragging a GLB creates an entity with:

```json
"asset": { "url": "/assets/...", "castShadow": true }
```

Toggle `castShadow` in the Inspector when a model should not cast shadows.

## GLB node operations

See [Building scenes](./building-scenes) for the full workflow. Summary:

| Operation | Persisted as |
| --- | --- |
| Reposition sub-mesh | `nodeOverrides[].transform` |
| Hide sub-mesh (`Del`) | `hiddenNodes[]` (by node name) |
| Collider on sub-mesh | `nodeOverrides[].components` |
| Child marker on node | Entity `glbAnchor` |

### Inspecting node names

Bindings (`ship-door`, `ship-gear`, `animation`) require **exact GLB node names**.

```bash
node scripts/inspect_glb.mjs path/to/model.glb
```

Lists node hierarchy and names — essential before wiring ship doors or station animations.

### Name uniqueness

Overrides and deletions match the **first** node with a given name. Keep node names unique within each GLB.

### Legacy naming

Avoid relying on `EntityName (NodeName)` suffix parsing. Prefer explicit `glbAnchor` set by the editor when authoring from GLB context menus.

## Thumbnails

`src/render/editor/thumbnails.ts` renders GLB thumbnails offscreen for the Project grid. Thumbnails cache in memory for the session.

## Editor API

Asset listing (proxied by Electron):

```text
GET /__editor/assets?root=assets
```

Returns `{ entries: [{ path, kind, size? }] }`. The only project asset root is
`assets/`. Engine-owned `src/assets/` is not listed here.

## Build pipeline

On **File → Build Web** / `npm run build:web`:

1. Prefab JSON is bundled via `import.meta.glob`
2. Referenced asset URLs are traced
3. Only referenced files copy from the project's `assets/` into the release output's `assets/`
4. Unreferenced protected library files stay out of the deploy

The output directory comes from `build.outDir` in **File → Project Settings…**.

## Related docs

- [Assets](/assets) — Synty packs, character avatars, deployment rules
- [Building scenes](./building-scenes) — drag-drop and hierarchy
- [Prefab kinds](./prefab-kinds) — ship / station / prop authoring
