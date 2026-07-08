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

Conforms to GLB geometry — use for complex walls and hull details.

| Field | Type | Notes |
| --- | --- | --- |
| `shape` | `"mesh"` | Required |
| `assetUrl` | string | Optional proxy GLB; defaults to the owning entity's asset |
| `convex` | boolean | Checked = convex hull; unchecked = BVH triangle mesh |
| `offset` | `{ x, y, z }` | Local offset |
| `node` | string | Optional GLB node to extract and/or follow for ship rig motion |

## Usage

**Stations and sites** — players walk on collider geometry, not abstract walk-volume boxes. Place colliders on every walkable floor and blocking wall.

**Ships** — add colliders on hull details that should block the character inside the cabin.

**Props** — match collider bounds to the visible mesh for placement feedback in hangar build mode.

## Placement context

| Context | Destination |
| --- | --- |
| GLB sub-selected | `glbNodeTransforms[].components` on that node |
| Marker component on model | New child empty with `glbAnchor` |
| Empty or model root | `entity.components` |

## See also

- [Station authoring](../station-authoring) — walking and collision workflow
- [Building scenes](../building-scenes) — GLB node colliders
