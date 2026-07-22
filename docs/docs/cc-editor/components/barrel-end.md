---
sidebar_position: 33
title: Barrel end
description: Marks the origin and bore direction of firearm shot queries.
---

# Barrel end

Marks the local origin and orientation used to start a firearm's segmented hitscan path.

| Property | Value |
| --- | --- |
| Prefab kind | Item |
| Marker | Yes |
| Singleton | Yes — at most one per document |

## Fields

No component fields — `{ type: "barrel-end" }` only. The marker entity's transform is the authored value.

## Placement

Place the empty at the open end of the barrel and align it with the viewport gizmo. **Local +Z is bore forward.** This convention is shared by rifles and handguns and must not be flipped per asset.

Fire runtime may fall back to the weapon root when this marker is missing, but authored firearms should include it so shots begin outside the mesh.

## See also

- [Muzzle flash](./muzzle-flash)
- [Weapon combat](./weapon-combat)
- Admin App [item definitions](/admin-app/item-definitions#weapon-combat-fields)
