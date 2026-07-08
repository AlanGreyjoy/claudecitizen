---
name: prefab-editor
description: Navigate and debug the ClaudeCitizen in-browser prefab editor — selection, hierarchy, inspector, adding components to entities or GLB nodes, and troubleshooting GLB node name mismatches. Use when authoring or debugging prefabs, the editor, inspector, hierarchy, GLB nodes, node overrides, colliders, doors, or animations.
---

# Prefab Editor

Dev-only in-browser editor for station/ship/site/prop prefabs. Requires `npm run dev` (port 4173); open via title-screen **Editor** or `?boot=editor`.

## Layout

| Panel | Path | Role |
|-------|------|------|
| Hierarchy | `src/editor/panels/hierarchy.ts` | Entity tree + expandable GLB node tree under asset entities |
| Viewport | `src/render/editor/viewport.ts` | 3D scene, picking, gizmo, flythrough |
| Inspector | `src/editor/panels/inspector.ts` | Transform, visual, materials, components |
| Project | `src/editor/panels/project.ts` | Prefab list, asset browser |
| Toolbar | `src/editor/panels/toolbar.ts` | New/Save/Load/Preview, gizmo modes |

Canonical data flow: `document.ts` (store) → `serialize.ts` (prefab JSON) → `src/world/prefabs/schema.ts` (validators).

## Selection

**Entity** — click in viewport or hierarchy. Clears GLB sub-selection.

**GLB node (sub-selection)** — required before adding node-level components:
1. **Viewport drill-down**: LMB same spot on a GLB entity repeatedly; each click goes deeper in the hit path (`drillDepth` in `viewport.ts`).
2. **Hierarchy**: expand the GLB subtree under an asset entity; click a node row.
3. **Context menu** on a GLB row auto-selects that node.

Sub-selection drives the inspector: node name (read-only), **Mesh Transform** section, and **Components** scoped to that node.

Viewport hint bar: `LMB select · re-click drill · RMB sub-mesh: add empty/component · … · F focus · Del delete`

## Adding Components

Three entry points (all call `addComponentFromPalette` in `component_actions.ts`):

| Where | How |
|-------|-----|
| **Inspector** | Bottom **Add component…** combobox (type to filter, Enter or click) |
| **Hierarchy** | RMB entity → **Components** submenu |
| **GLB node** | RMB GLB row in hierarchy **or** RMB viewport when a GLB node is sub-selected → **Add Component to Node** |

Palette is filtered by prefab **kind** (`station` / `ship` / `site` / `prop`) and **singleton** types already in the document are disabled. Registry + defaults: `src/world/prefabs/component_registry.ts`. Field editors: `inspector.ts` `componentFields()`.

### Where components land

Behavior depends on component def (`marker` flag) and current selection:

| Situation | Result |
|-----------|--------|
| **Marker** component on entity with visual (GLB/primitive) | New **child marker entity** at GLB node world position (or entity origin). Name may include `(NodeName)`. Position with gizmo. |
| **Collider** + GLB node sub-selected | Stored on **node override** (`glbNodeTransforms[].components`). Auto box-sized from mesh bounds when available. |
| **Animation** or **ship-door** + GLB node sub-selected | Added as marker child **or** entity component with `nodes` pre-filled from node name and generated `id`. |
| **Non-marker** on entity (no node sub-selection) | Appended to `entity.components`. |
| **Collider** on entity with GLB (no node) | Defaults to `shape: "mesh"`. Box primitive → box sized to primitive. |

**Marker components** (spawn-point, interaction, ship-door, animation, walk zones, lights, etc.) are spatial — they live on empty child entities, not on the hull mesh entity itself.

**Node override components** persist in prefab JSON as `nodeOverrides[].components` (see `serialize.ts`).

## GLB Nodes — Key Rules

- Overrides and deletions persist by **node name**, not Three.js UUID. Session selection uses UUIDs; `store.getGlbNodeName()` resolves before save.
- Duplicate names within one GLB → first match wins (overrides/deletions/bindings).
- **Delete** a GLB part: RMB node in hierarchy → Delete → adds name to `glbNodeHidden` / prefab `hiddenNodes`.
- **Mesh Transform** edits → `glbNodeTransforms` / prefab `nodeOverrides[].transform`.
- Hierarchy shows a **badge** on nodes with override components; bound marker children nest under the node row.
- **Hierarchy nesting** for child entities uses `glbAnchor` (persisted on the entity, set by **Add Empty Here** and marker components). Legacy prefabs may still use `Name (GlbNodeName)` — parsed via `glbAnchorFromEntityName()` in `glb_binding.ts`. Without a binding, the child is parented to the asset entity but renders as a sibling of the MODEL tree.
- **Copy Node Name** in GLB context menu — use exact string in animation/door/collider `node` / `nodes[].name` fields.

## Inspect a GLB File (CLI)

```bash
node scripts/inspect_glb.mjs path/to/model.glb
# or editor/assets/... for local library assets
```

Dumps scene hierarchy, mesh bindings, and animation clip targets. Use this **before** wiring `animation`, `ship-door`, `ship-gear`, or `collider.node` fields.

## Preview & Validate

- **Preview** (toolbar): loads play session with current prefab (station or ship).
- **Ship kind**: viewport toolbar toggles gear/ramp/doors for in-editor articulation preview.
- **Ship sandbox**: `?shipPrefab=<id>` (dev) — console helper:
  ```js
  window.__claudecitizenShipModel.listNodeNames();
  ```
- After preview, check browser console for binding warnings (see troubleshooting).

## Code Map (common edits)

| Task | Files |
|------|-------|
| New component type | `schema.ts`, `component_registry.ts`, `inspector.ts` fields |
| Add-component behavior | `component_actions.ts` |
| Context menus | `component_actions.ts`, `hierarchy.ts`, `viewport.ts` |
| Node override persistence | `document.ts`, `serialize.ts` |
| Runtime GLB binding | `prefab_renderer.ts` |
| Ship/station door wiring | `ship_runtime.ts`, `station_runtime.ts`, `game_loop.ts` |

Read `.agents/AGENTS.md` sections **Editor**, **Prefab & Animation Architecture**, and **Debugging GLB nodes & Colliders** before cross-cutting prefab changes.

## Troubleshooting

For symptom → cause → fix flows (doors, animations, colliders, F-key, name mismatches), see [troubleshooting.md](troubleshooting.md).
