---
sidebar_position: 30
title: Prop frame
description: Marks the prop origin used when placed in a hangar.
---

# Prop frame

Marks the prop origin used when placed in a hangar or apartment build area. **Prop** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

No configurable fields — `{ type: "prop-frame" }` only.

## Usage

Injected automatically on the root entity when you save a prop prefab. The hangar build system uses this origin for grid snapping and placement feedback.

Typical structure:

```text
root (prop-frame)
└── body — GLB or box primitive + collider
```

## See also

- [Props and items](../props-and-items)
- [Collider](./collider) — footprint for placement
