---
sidebar_position: 20
title: Station frame
description: Marks the prefab origin used for orbital placement.
---

# Station frame

Marks the prefab origin used for orbital placement. **Station** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

No configurable fields — `{ type: "station-frame" }` only.

## Usage

Injected automatically on the root entity when you save a station prefab. Do not delete it — the station runtime uses this origin when placing the module in orbit.

## See also

- [Station authoring](../station-authoring)
- [Spawn point](./spawn-point)
