---
sidebar_position: 3
title: Interface
description: CC Editor layout, panels, toolbar, scene tabs, and keyboard shortcuts.
---

# Interface

The CC Editor is a standalone, Unity-style Electron workspace with resizable
panels. Panel sizes persist in `localStorage`.

Launch it with `npm run editor`. No Vite development server is required.

## Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ File/Edit/Game  │       ▶ Play       │ active document      │
├──────────┬──────────────────────────────┬─────────────────────┤
│          │  Scene | Material Manager |  │                     │
│ Hierarchy│  Base Characters | …         │    Inspector        │
│          │  ┌────────────────────────┐  │                     │
│          │  │  Viewport / tab panel  │  │                     │
│          │  └────────────────────────┘  │                     │
├──────────┴──────────────────────────────┴─────────────────────┤
│  Project — asset browser (folder tree + thumbnail grid)      │
└─────────────────────────────────────────────────────────────┘
```

Drag the column and row splitters to resize hierarchy, inspector, and project panels.

## Hierarchy (left)

GameObject tree for the open scene (or prefab). Roots are entities in the active document.

| Action | How |
| --- | --- |
| Select | Click a row |
| Multi-select | `Ctrl+click` toggle; `Shift+click` range |
| Rename | Double-click the name |
| Reparent | Drag rows onto another entity |
| Visibility | Eye icon toggles `visible` |
| Search | Filter bar at the top |
| Context menu | Right-click — add components, colliders, duplicate, delete |

GLB model entities expand to show the **GLB node tree**. Sub-select a node for per-node transforms, colliders, and components.

## Scene view (center)

The main Three.js viewport when the **Prefab** tab is active.

### Camera

| Input | Action |
| --- | --- |
| **LMB drag** | Orbit around the target |
| **MMB drag** | Pan |
| **Wheel** | Zoom |
| **Hold RMB + WASD** | Flythrough (`Q`/`E` down/up, `Shift` faster, wheel adjusts fly speed) |

While flying, keyboard shortcuts for gizmo modes are disabled so WASD belongs to the camera.

### Selection

| Input | Action |
| --- | --- |
| **LMB click** | Select the GLB mesh under the cursor (re-click walks up to the entity) |
| **Ctrl+click** | Add/remove from selection |
| **RMB on sub-mesh** | Context menu — add empty, add component to node |
| **Escape** | Clear selection |

### Transform gizmo

Toolbar **Move / Rotate / Scale** (`W` / `E` / `R`), local/world space toggle, snap toggle.

Default snap: **0.25 m** translate, **15°** rotate. Hold **Ctrl** while dragging to invert snapping.

### Drop assets

Drag GLB/GLTF cards from the Project panel into the viewport to spawn a new model entity at the drop position.

## Inspector (right)

Edits the current selection:

- Entity name, transform (position, rotation in degrees, scale)
- Box primitive size and color
- Model asset URL and cast-shadow flag
- **Add component** search/autocomplete (filtered by prefab kind)
- Per-component field editors
- GLB node override transforms when a sub-mesh is selected

## Project (bottom)

Merged asset browser over:

- `editor/assets/` — local library (free + `protected/` gitignored packs)
- `src/assets/` — tracked game assets

Folder tree on the left, thumbnail grid on the right. Model cards support drag-and-drop into the scene. GLB cards also expose an **Anims** button that loads clips into the **Base Characters** tab.

## Toolbar

| Control | Description |
| --- | --- |
| **W / E / R** | Translate / rotate / scale gizmo |
| Local / World | Gizmo space |
| Snap | Toggle grid snapping |
| **+ Box** / **+ Empty** | Add primitive or empty entity |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) |
| Prefab name + kind | Metadata for save; kind switches component palette |
| **SHIP EDITOR** chip | Visible when kind is `ship` |
| **New Scene / New Prefab / Open / Save** | Document lifecycle (`Ctrl+S` saves) |
| **Play / Stop** | Universal Play Mode for the active scene, prefab, planet, system, or character test (`F6`) |
| **Build Web** | Save the active document and create the browser release in `dist/` (`Ctrl+B`) |
| **Exit** | Return to title screen |

### Ship preview controls (ship kind)

When editing a ship, the viewport toolbar shows a **Ship** group:

- **Gear** — toggle landing gear articulation preview
- **Ramp** — toggle boarding ramp
- **Per-door buttons** — open/close each `ship-door` for visual verification

Station prefabs with `animation` components also get door toggle buttons.

## Scene tabs

The center column switches between authoring surfaces:

| Tab | Purpose |
| --- | --- |
| **Scene** | Open scene (or prefab) 3D viewport — Hierarchy shows its GameObjects |
| **Material Manager** | Batch material overrides across the document |
| **Base Characters** | Sidekick equipment, animation controllers, and play-test stage |
| **Planet Authoring** | Planet terrain / biome documents |
| **System Map** | Star / planet / station ecliptic layout |
| **Menu Manager** | Live HaloBand + play menu previews (File → Open Menus) |

Scenes and prefabs open from **File → Open Scene / Open Prefab**. Scene startup settings live under **File → Scene → Settings…**.

See [Material manager](./material-manager), [Planet authoring](./planet-authoring), [System Map](./system-map), and [Menu Manager](./menu-manager).

## Keyboard shortcuts

Shortcuts are ignored while typing in inputs or during RMB flythrough.

| Key | Action |
| --- | --- |
| `W` / `E` / `R` | Gizmo mode |
| `F` | Frame/focus selection in viewport |
| `Ctrl+D` | Duplicate selected entities |
| `Del` / `Backspace` | Delete selection (or hide selected GLB node if sub-selected) |
| `Ctrl+S` | Save |
| `Ctrl+B` | Build the web release |
| `F6` | Play/stop the active document |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Escape` | Clear selection |

Undo depth is capped at 200 commands (`src/editor/commands.ts`).
