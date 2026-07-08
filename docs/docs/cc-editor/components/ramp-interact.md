---
sidebar_position: 49
title: Ramp interact
description: Raise/lower ramp prompt at ground or deck panel.
---

# Ramp interact

Raise/lower ramp prompt. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `placement` | `"outside"` \| `"deck"` | `"outside"` | Ground ramp foot vs interior panel |
| `radius` | number | `3` | Interact distance in meters |

## Usage

| Placement | Where to put it |
| --- | --- |
| `outside` | Ground level at the ramp foot — player toggles before boarding |
| `deck` | Interior control panel near the airlock |

Works with [Ship ramp](./ship-ramp) hinge bindings. Press **F** in play or use the sandbox ramp toggle to preview.

## See also

- [Ship authoring](../ship-authoring)
- [Ship ramp](./ship-ramp)
- [Ramp mount](./ramp-mount)
