---
sidebar_position: 12
title: Assets and GLB
description: Asset libraries, protected packs, GLB node editing, and inspection tools.
---

# Assets and GLB

The CC Editor pulls from two on-disk asset roots exposed by the Vite dev server.

## Asset roots

| Root | Path on disk | Served at |
| --- | --- | --- |
| **Editor library** | `editor/assets/` | `/editor/assets/...` |
| **Game assets** | `src/assets/` | `/src/assets/...` |

The Project panel merges both into one browser. Prefab JSON stores absolute dev-server URLs like `/editor/assets/protected/synty/.../Wall_01.glb`.

### Protected packs

`editor/assets/protected/` is **gitignored** — Synty and other licensed packs live here locally. Prefabs reference only the files they need; production builds copy referenced protected assets into `dist/` (see [Assets](/assets) doc).

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
"asset": { "url": "/editor/assets/...", "castShadow": true }
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

## Dev API

Asset listing uses the Vite middleware:

```text
GET /__editor/assets?root=editor/assets
GET /__editor/assets?root=src/assets
```

Returns `{ entries: [{ path, kind, size? }] }`.

## Build pipeline

On `npm run build`:

1. Prefab JSON is bundled via `import.meta.glob`
2. Referenced asset URLs are traced
3. Only referenced files copy from `editor/assets/` into `dist/editor/assets/`
4. Unreferenced protected library files stay out of the deploy

## Related docs

- [Assets](/assets) — Synty packs, character avatars, deployment rules
- [Ship authoring](./ship-authoring) — binding hull nodes
- [Station authoring](./station-authoring) — kitbashing station modules
