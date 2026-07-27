---
sidebar_position: 40
title: Ship frame
description: Marks the prefab origin the flight body is anchored to.
---

# Ship frame

Marks the prefab origin the flight body is anchored to. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

No configurable fields — `{ type: "ship-frame" }` only.

## Usage

Injected automatically on the root entity when you save a ship prefab. Author
new ships with [Ship controller](./ship-controller) on the hull. Legacy
[Ship stats](./ship-stats) / [Ship gear](./ship-gear) / [Ship ramp](./ship-ramp)
components still load on old prefabs but are not in the add palette.

## See also

- [Ship authoring](../ship-authoring)
- [Ship hull](./ship-hull)
