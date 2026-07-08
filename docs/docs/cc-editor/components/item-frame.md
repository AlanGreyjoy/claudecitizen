---
sidebar_position: 31
title: Item frame
description: Marks the item origin for world pickup and drop visuals.
---

# Item frame

Marks the item origin used for world pickup and drop rendering. **Item** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

No configurable fields — `{ type: "item-frame" }` only.

## Usage

Injected automatically on the root entity when you save an item prefab. The game uses this origin when the player drops or picks up the item in the world.

Typical structure:

```text
root (item-frame)
└── visual — small GLB or primitive
```

Items without a prefab can use `iconUrl` in the Admin App instead — the HUD renders the icon without a 3D model.

## See also

- [Props and items](../props-and-items)
- Admin App [item definitions](/admin-app/item-definitions)
