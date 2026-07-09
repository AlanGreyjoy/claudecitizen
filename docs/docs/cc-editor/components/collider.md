---
sidebar_position: 10
title: Collider
description: Box or mesh colliders that block walking characters.
---

# Collider

Blocks walking characters. Available on **station**, **ship**, **site**, **prop**, and **item** prefabs.

| Property | Value |
| --- | --- |
| Marker | No — attaches to the selected entity or GLB node |
| Singleton | No |

## Shapes

### Box

Simple walls, floors, and crates. Tune `size` and optional `offset` to match the visual mesh.

| Field | Type | Notes |
| --- | --- | --- |
| `shape` | `"box"` | Required |
| `size` | `{ x, y, z }` | Half-extents in meters |
| `offset` | `{ x, y, z }` | Local offset from entity origin |
| `node` | string | Optional GLB node whose ship rig motion drives this collider |

### Mesh

Conforms to the **exact triangle geometry** of the bound GLB node (same idea as a mesh collider on a GameObject in Unity or Unreal). Box and mesh colliders on the same node use the **same world placement**; mesh is built asynchronously into a BVH on first prefab load.

| Field | Type | Notes |
| --- | --- | --- |
| `shape` | `"mesh"` | Required |
| `assetUrl` | string | Optional proxy GLB; defaults to the owning entity's asset |
| `convex` | boolean | Checked = convex hull; unchecked = BVH triangle mesh |
| `offset` | `{ x, y, z }` | Local offset |
| `node` | string | GLB node name — must match the asset hierarchy exactly |

**Node names** must match the GLB file. Inspect with:

```bash
node scripts/inspect_glb.mjs path/to/model.glb
```

If the node is missing, the mesh collider is skipped and a console warning is logged at prefab bake time.

**Do not** add a zero/identity `transform` on a node override unless you intend to move or reorient that GLB node. For collider-only authoring, omit `transform` entirely so the model keeps its baked pose (see `PrefabNodeOverride` in the schema).

## Usage

**Stations and sites** — players walk on collider geometry, not abstract walk-volume boxes. Place colliders on every walkable floor and blocking wall.

**Ships** — drill into the hull GLB, sub-select a node, add a **mesh** collider on that node override. Typical nodes: `RampParent` (ramp walk surface), interior floor meshes, door nodes (`CockpitDoor_L`, …). Do not stack colliders on the hull entity when it already has **ship-controller**; the node name is implicit when the collider is on a node override. Enable **Convex hull** only when you need a simple hull approximation (e.g. animated ramp); leave it off for interior floor meshes (BVH is more accurate).

**Props** — match collider bounds to the visible mesh for placement feedback in hangar build mode.

## Placement context

| Context | Destination |
| --- | --- |
| GLB sub-selected | `nodeOverrides[].components` on that node (preferred for ships) |
| Marker component on model | New child empty with `glbAnchor` |
| Empty or model root | `entity.components` |
| Ship hull + **ship-controller** (no sub-node) | **Collider** hidden — sub-select a GLB node first |

## See also

- [Station authoring](../station-authoring) — walking and collision workflow
- [Building scenes](../building-scenes) — GLB node colliders
