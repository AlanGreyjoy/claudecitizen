---
sidebar_position: 5
title: Building scenes
description: Entities, transforms, hierarchy, GLB editing, and the scene builder workflow.
---

# Building scenes

Before attaching gameplay components, you build the visual and structural scene — the **builder** half of the AsteronEngine editor.

The same viewport, hierarchy, and inspector build both **scenes** and **prefabs**.
The difference is what the document means: a prefab is reusable content, while a
scene is something the game can launch.

## Assembling a scene

A scene document is a GameObject tree, and its components decide what it *is*.
There is no separate settings screen for scene contents.

| Goal | Add this |
| --- | --- |
| Pick the system, planet, and spawn mode | `game-manager` |
| Reference a planet document | `planet` |
| Set where the player appears | `player-start` |
| Place a station, ship, or prop you authored | `prefab-instance` |
| Show title / login / character-create / loading UI | `ui-screen` |
| Hand off to another scene | `scene-link` (set `auto` + `delaySeconds` for a timed hop) |
| Give each player their own copy (habs, hangars) | `instanced-scene` |

A title screen is often just an empty with a `ui-screen` and a `scene-link`. A
playable scene usually needs a `game-manager`, a `planet`, a `player-start`, and
one or more `prefab-instance` GameObjects.

Scene-level startup options live in **File → Scene Settings…**; everything about
the scene's *contents* is components on GameObjects.

## Entities

Everything in the hierarchy is an **entity** with:

| Property | Description |
| --- | --- |
| **Transform** | Position, rotation (Euler degrees in the inspector), scale |
| **Visual** | GLB asset URL, and/or box primitive (size + hex color) |
| **Visibility** | Eye toggle in hierarchy |
| **Components** | Gameplay markers and colliders (see [Components](./components)) |
| **Children** | Nested entities forming a tree |

### Create entities

| Method | Result |
| --- | --- |
| **+ Box** (toolbar) | 2×2×2 m box at y=1, gray default color |
| **+ Empty** (toolbar) | Invisible parent/marker node |
| **Drag GLB** (project panel) | Model entity at drop position |
| **RMB viewport** on GLB sub-mesh | Add empty or component at node position |
| **Ctrl+D** | Duplicate selected entities |

### Parenting

Drag hierarchy rows to reparent. Child transforms are **local** to the parent.

For GLB models, child empties can bind to a **GLB node** via `glbAnchor` so they follow animated or repositioned sub-meshes in the outliner.

## Coordinate space

Prefab space equals the editor viewport axes — what you see is what the game renders. Station prefabs map to gameplay axes as: right = **−x**, up = **y**, forward = **+z**.

Ship hull entities should sit at **0, 0, 0** — the game recenters the hull model on the ship origin.

## GLB sub-selection

GLB assets are not entities themselves; their internal node tree appears under the owning entity in the hierarchy.

| Action | How |
| --- | --- |
| Drill into mesh | Click the same spot in the viewport repeatedly |
| Select node in hierarchy | Expand the GLB tree, click a node row |
| Transform a sub-mesh | Sub-select, then use the gizmo (writes a **node override**) |
| Hide/delete a sub-mesh | Sub-select, press `Del` — adds to `hiddenNodes` (persisted by **node name**) |
| Add collider to sub-mesh | Sub-select, add `collider` — lands on the node override |

### GLB anchor binding

Child marker entities can parent to a GLB node in the outliner using `glbAnchor` (the exact GLB node name). This is preferred over legacy `Name (NodeName)` suffix parsing.

When adding components from a GLB context menu, the editor sets `glbAnchor` automatically.

## Node overrides

Per-node data persisted on the entity:

- **Transform override** — reposition/rotate/scale a sub-mesh without editing the source GLB
- **Node-scoped components** — typically box or mesh colliders sized to a wall panel
- **hiddenNodes** — list of deleted/hidden node names

Overrides persist by **node name**, not Three.js UUID. Node names must be unique within a model.

## Primitives

Box primitives are useful for greyboxing, placeholder props, and quick collision proxies.

- Set size and color in the Inspector
- Add a `collider` component matching the box for walkable surfaces
- Material overrides use the special `__primitive__` material slot (see [Material manager](./material-manager))

## Selection model

- **Entity selection** — LMB viewport or hierarchy; clears GLB sub-selection
- **GLB sub-selection** — required for node-scoped inspector fields and "Add Component to Node"
- **Multi-select** — `Ctrl+click` or `Shift+click` range in hierarchy; bulk collider add via context menu

## Undo / redo

Every document mutation goes through the command stack. `Ctrl+Z` / `Ctrl+Shift+Z` reverses structure, transforms, components, and visibility changes.

## Inspector transforms

Rotation is edited as **Euler XYZ degrees** in the inspector for readability. Serialization converts to quaternions in prefab JSON.

Use **local** vs **world** gizmo space from the toolbar when placing markers relative to a rotated parent.

## Tips

- **Focus** (`F`) frames the selection — essential after loading large station layouts
- Search the hierarchy when scenes grow to hundreds of entities (`demo-station` is a good stress test)
- Use empties as organizational parents — group a room's props under one empty for easier moves
- Match colliders to visible geometry before playtesting on-foot movement

Next: [Components](./components) for gameplay markers and physics.
