---
name: prefab-editor
description: Navigate and debug the ClaudeCitizen in-browser prefab editor — selection, hierarchy, inspector, adding components to entities or GLB nodes, and troubleshooting GLB node name mismatches. Use when authoring or debugging prefabs, the editor, inspector, hierarchy, GLB nodes, node overrides, colliders, doors, or animations.
---

# Prefab Editor

Dev-only in-browser editor for station/ship/site/prop prefabs. Requires `npm run dev` (port 4173); open via title-screen **Editor** or `?boot=editor`.

## Layout

| Panel | Path | Role |
|-------|------|------|
| Shell | `src/editor/react/EditorApp.tsx` | React chrome, tabs, HMR soft-remount |
| Hierarchy | `src/editor/react/panels/HierarchyPanel.tsx` | Entity tree + expandable GLB node tree under asset entities |
| Viewport | `src/render/editor/viewport.ts` | 3D scene, picking, gizmo, flythrough (imperative) |
| Inspector | `src/editor/react/panels/InspectorPanel.tsx` | Transform, visual, materials, components |
| Project | `src/editor/react/panels/ProjectPanel.tsx` | Asset browser |
| Toolbar | `src/editor/react/panels/Toolbar.tsx` | New/Save/Load/Preview, gizmo modes |

Canonical data flow: `document.ts` (store) → `serialize.ts` (prefab JSON) → `src/world/prefabs/schema.ts` (validators). React UI sits on top of `EditorStore`; dense component field editors still use `panels/inspector_component_fields_dom.ts`.

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

Palette is filtered by prefab **kind** (`station` / `ship` / `site` / `prop`) and **singleton** types already in the document are disabled. Registry + defaults: `src/world/prefabs/component_registry.ts`. Field editors: `inspector_component_fields_dom.ts` (mounted from React inspector).

### Where components land

Behavior depends on component def (`marker` flag) and current selection:

| Situation | Result |
|-----------|--------|
| **Marker** component on entity with visual (GLB/primitive) | New **child marker entity** at GLB node world position (or entity origin). Name may include `(NodeName)`. Position with gizmo. |
| **Collider** + GLB node sub-selected | Stored on **node override** (`nodeOverrides[].components`). Defaults to `shape: "mesh"` (BVH). |
| **Animation** or **ship-door** + GLB node sub-selected | Added as marker child **or** entity component with `nodes` pre-filled from node name and generated `id`. |
| **Non-marker** on entity (no node sub-selection) | Appended to `entity.components`. |
| **Collider** on ship hull with **ship-controller** (no sub-node) | Hidden from palette — sub-select a GLB node first. |
| **Collider** on other entity with GLB (no node) | Defaults to `shape: "mesh"`. Box primitive → box sized to primitive. |

**Marker components** (spawn-point, interaction, ship-door, animation, lights, **cockpit-control**, **cockpit-stat**, etc.) are spatial — they live on empty child entities, not on the hull mesh entity itself.

### Ship doors / cubbies

Prefer **Ship Door** marker empties (not `ship-controller.doors[]`):

1. Add Empty at the interact stand position (or Add Component → Ship Door on the hull to spawn a marker)
2. Set **Id**, **Label**, **Motion** / **Axis**, and GLB **nodes** + signed open **delta**
3. Choose **Trigger**: `radial` (stand in sphere) or `raycast` (camera aim within max distance + aim radius)
4. Drag audio from the Project asset browser onto **Open SFX** / **Close SFX**
5. Preview: radial → walk near the empty → **F**; raycast → look at the marker within range → **F**

Optional: sub-select a GLB door panel first, then add Ship Door — `nodes` pre-fills from that name. Add a second node row for double doors.

Colliders bound to the same GLB node names still disable when the door is mostly open.

### Bed (ships)

SC-style bunk: place an Empty on the mattress → **Bed** component → **radial** (or raycast) trigger.

1. Tune **Eye** (pillow head cam) and **Stand XZ** (get-up aisle spot)
2. Preview: walk near → **F** to lie down → mouse looks around → **Hold Y** to get up
3. Does **not** enable flight (separate from the pilot seat)

### Cockpit look-at controls (ships)

SC-style while seated: **Hold F** free-look → gaze at a `cockpit-control` empty → **left-click** to toggle gear/ramp.

1. Add Empty near the physical switch in the cockpit
2. Add component **Cockpit Control** (`landing-gear` | `cargo-ramp`)
3. Tune **Gaze radius** / **Max distance** if the hit feel is too tight or loose

### Cockpit instruments (ships)

Always-on while piloting: place a **Cockpit Stat** empty on the dash (`kind: speed` → number + bar). Boost (Shift) raises the speed cap and accents the bar. Separate from clickable cockpit-control markers.

### Ramp / landing gear / boost SFX (ship-controller)

On the hull **Ship Controller** (not cockpit-control markers):

- **Ramp** → drag Hierarchy empties onto **Out btn** / **Deck btn** (outside + deck F interact points); drag **Open SFX** / **Close SFX** from Project (plays on F interact + cockpit cargo-ramp click)
- **Landing gear** → drag **Deploy SFX** / **Retract SFX** (plays on cockpit landing-gear click + sandbox **G**)
- **Camera feel** → drag **Boost SFX** (loops while **Shift** boost is held) and **Thrust SFX** (loops with any translation: W/S, A/D, Space/C; both fade in/out)

Auto-close of the ramp when taking off does **not** play SFX.

See also `.cursor/skills/ship-flight/SKILL.md`.

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
| Particle System | `schema.ts` `particle-system` + `src/render/particles/` + inspector modules; plane collision only; live in editor + play via `updateParticles(dt)` |
| Add-component behavior | `component_actions.ts` |
| Context menus | `component_actions.ts`, `hierarchy.ts`, `viewport.ts` |
| Node override persistence | `document.ts`, `serialize.ts` |
| Runtime GLB binding | `prefab_renderer.ts` |
| Ship/station door wiring | `ship_runtime.ts`, `station_runtime.ts`, `game_loop.ts` |

Read AGENTS.md sections **Editor**, **Prefab & Animation Architecture**, **Ship flight**, and **Debugging GLB nodes & Colliders** before cross-cutting prefab changes.

## Troubleshooting

For symptom → cause → fix flows (doors, animations, colliders, F-key, name mismatches), see [troubleshooting.md](troubleshooting.md).
