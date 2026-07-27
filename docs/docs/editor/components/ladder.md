---
sidebar_position: 35
title: Ladder
description: Climbable ladder marker for station and ship prefabs.
---

# Ladder

Climbable ladder. The marker sits at the **foot** of the climb line — the spot
the player stands on to mount. Works in **station** and **ship** prefabs.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

Local **+Y** is the climb axis. Local **+Z** is the side they face away from
while climbing and step off toward at the top. Mount reach measures the whole
climb line in 3D, so one marker serves foot and upper deck.

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | — | Unique within prefab |
| `height` | number | — | Climb length above the marker (m) |
| `radius` | number? | — | Mount / dismount reach from the climb line (m) |
| `climbSpeed` | number? | — | Climb rate (m/s) |
| `label` | string? | `"ladder"` | Prompt noun |

## Usage

1. Add Empty at the foot of the climb
2. Orient so **+Y** goes up the rail and **+Z** points toward the step-off side
3. Add component **Ladder**, set `height`
4. Preview: walk near → **F** to mount → forward/back climbs → top steps off; **jump** drops

Climbing is a sub-state of walking modes (still in-station / on-deck). Motion
goes through the Rapier character controller, so a blocked climb stalls instead
of clipping.

## See also

- [Station authoring](../station-authoring)
- [Ship authoring](../ship-authoring)
- [Elevator](./elevator)
