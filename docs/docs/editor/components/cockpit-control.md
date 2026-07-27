---
sidebar_position: 41
title: Cockpit control
description: Seat free-look gaze + LMB control for landing gear and cargo ramp.
---

# Cockpit control

Cockpit look-at control. Empty marker position is the gaze target in ship space.
While piloting, hold **F** for free-look; gaze + **LMB** activates the control.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique within prefab |
| `action` | enum | Control action (landing gear, cargo ramp, …) |
| `label` | string? | Override; runtime otherwise derives from action + rig state |
| `gazeRadius` | number? | Max miss from camera ray (m) |
| `maxDistance` | number? | Max distance from camera to marker (m) |

## See also

- [Cockpit stat](./cockpit-stat)
- [Ship controller](./ship-controller)
- [Ship authoring](../ship-authoring)
