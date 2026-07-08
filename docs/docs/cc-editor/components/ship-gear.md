---
sidebar_position: 43
title: Ship gear
description: Landing gear hinge bindings on the hull GLB.
---

# Ship gear

Landing gear hinge bindings on the hull GLB. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `nodes` | `{ name, deployRadians, axis? }[]` | GLB node names and deploy angles |

### Node fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | string | — | Exact GLB node name |
| `deployRadians` | number | — | Rotation when gear is deployed |
| `axis` | `"x"` \| `"y"` \| `"z"` | `"x"` | Hinge axis |

## Usage

Omit to use Starhopper defaults. Preview deployment with the viewport toolbar **Gear** toggle or **G** in the ship sandbox.

Find node names with:

```bash
node scripts/inspect_glb.mjs <path-to.glb>
```

## See also

- [Ship authoring](../ship-authoring)
- [Ship hull](./ship-hull)
