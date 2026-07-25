---
sidebar_position: 32
title: Muzzle flash
description: Marks the origin and orientation of firearm muzzle presentation.
---

# Muzzle flash

Marks where short-lived muzzle presentation originates on a weapon item prefab.

| Property | Value |
| --- | --- |
| Prefab kind | Item |
| Marker | Yes |
| Singleton | Yes — at most one per document |

## Fields

No component fields — `{ type: "muzzle-flash" }` only. The marker entity's transform is the authored value.

## Placement

Place the empty just outside the visible muzzle and use the viewport gizmo to align it. **Local +Z is bore forward.** Phase 04 uses this pose for the pooled flash effect; it does not control ballistics.

Keep the marker as a sibling under the item root when practical. The Inspector hint shows the same +Z convention.

## See also

- [Barrel end](./barrel-end)
- [Weapon combat](./weapon-combat)
- [Props and items](../props-and-items)
