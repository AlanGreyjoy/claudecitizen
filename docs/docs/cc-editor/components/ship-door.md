---
sidebar_position: 46
title: Ship door
description: Articulated door with built-in F-key interact.
---

# Ship door

Open/close door bound to GLB nodes. Entity position is the interact spot. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"door-1"` | Unique within prefab; walk zones gate on it |
| `label` | string | `"door"` | Display name in prompts ("Press F — open &#123;label&#125;") |
| `motion` | `"slide"` \| `"hinge"` | `"slide"` | Translation vs rotation |
| `axis` | `"x"` \| `"y"` \| `"z"` | `"x"` | Node-local axis |
| `nodes` | `{ name, delta }[]` | — | GLB names + signed open delta |
| `radius` | number | `1.6` | Interact distance from entity position |
| `defaultOpen` | boolean | `false` | Initial state when prefab loads |

### Delta units

| Motion | Delta unit |
| --- | --- |
| `slide` | Meters |
| `hinge` | Radians |

## Usage

Place the marker at the doorway interact spot. Bind `nodes` to exact GLB node names.

[Ship walk zones](./ship-walk-zone) can `gate` on a door id so the room is only reachable when the door is open. Preview open/close from the viewport toolbar.

Unlike station doors (which pair [Animation](./animation) + [Interaction](./interaction)), ship doors bundle motion and interact in one component.

## See also

- [Ship authoring](../ship-authoring)
- [Ship walk zone](./ship-walk-zone)
