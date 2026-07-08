---
sidebar_position: 12
title: Animation
description: Authored slide or hinge motion of GLB nodes inside a prefab.
---

# Animation

Authored translation or rotation of GLB nodes inside this prefab. Available on **all prefab kinds**.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | — | Unique within the prefab; referenced by interactions |
| `name` | string | `"animation"` | Display name in the editor toolbar |
| `motion` | `"slide"` \| `"hinge"` | `"slide"` | Translation vs rotation |
| `axis` | `"x"` \| `"y"` \| `"z"` | `"x"` | Node-local axis |
| `nodes` | `{ name, delta }[]` | — | GLB node names + signed open delta |
| `defaultOpen` | boolean | `false` | Initial state when the prefab loads |
| `duration` | number | `1.0` | Seconds for a full open/close cycle |

### Delta units

| Motion | Delta unit |
| --- | --- |
| `slide` | Meters along the axis |
| `hinge` | Radians of rotation |

## Usage

Use for station doors, hangar gates, and any articulated props.

1. Add an `animation` component with the target GLB `nodes`, motion type, axis, and delta
2. Optionally add an [Interaction](./interaction) with `interactionType: "animation"` and matching `targetAnimationId`
3. Toggle from the viewport toolbar or press **F** in play

Node names must match the GLB exactly — inspect with `node scripts/inspect_glb.mjs <path-to.glb>`.

## See also

- [Interaction](./interaction) — F-key toggling
- [Ship door](./ship-door) — ship-specific door variant with built-in interact
