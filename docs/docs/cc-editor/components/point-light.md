---
sidebar_position: 13
title: Point light
description: Omnidirectional light source with optional shadows.
---

# Point light

Omnidirectional light. Entity position sets the source. Available on **all prefab kinds**.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | hex string | `"#dfeaff"` | Light color |
| `intensity` | number | `28` | Three.js point light intensity (editor-scale candela) |
| `distance` | number | `12` | Maximum reach in meters; `0` = unlimited inverse-square falloff |
| `decay` | number | `2` | Attenuation exponent (physically correct default is 2) |
| `castShadow` | boolean | `false` | Expensive — renders 6 cube faces |

## Usage

Use sparingly in station and ship interiors. Shadow cost is high compared to [Spot light](./spot-light).

Lights are visual in the editor and serialize for play rendering. Rotate the entity only if you need to aim linked geometry — point lights emit equally in all directions.

## See also

- [Area light](./area-light) — soft rectangular panels
- [Spot light](./spot-light) — cheaper directional shadows
