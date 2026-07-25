---
sidebar_position: 23
title: Hangar pad
description: Ship parking spot inside a station hangar.
---

# Hangar pad

Ship parking spot inside a hangar bay. **Station** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `hangarId` | string | `"bay-1"` | Hangar bay identifier |
| `padIndex` | number | `1` | Pad slot within the bay |
| `floorId` | `"hab"` \| `"lobby"` \| `"hangar"` | `"hangar"` | Should be `"hangar"` for ship bays |

## Usage

Place at **pad surface height** — parked ships rest at their prefab-authored gear height above the pad.

Use consistent `hangarId` values when a station has multiple bays. Increment `padIndex` for additional pads in the same bay.

## See also

- [Station authoring](../station-authoring)
- [AVMS terminal](./avms-terminal) — call ships to hangar access
- [Ship hull](./ship-hull) — parked ship height
