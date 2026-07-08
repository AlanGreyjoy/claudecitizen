---
sidebar_position: 15
title: Spot light
description: Directional cone beam with optional shadows.
---

# Spot light

Directional cone beam. Available on **all prefab kinds**.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | hex string | `"#dfeaff"` | Light color |
| `intensity` | number | `28` | Three.js spot light intensity (editor-scale candela) |
| `distance` | number | `24` | Maximum reach in meters |
| `decay` | number | `2` | Attenuation exponent |
| `angle` | number | `45` | Cone angle in degrees |
| `penumbra` | number | `0.1` | Soft edge ratio, 0..1 |
| `castShadow` | boolean | `false` | Cheaper shadows than point lights |

## Usage

Use for accents, hangar floods, and directed interior lighting.

Entity **rotation** aims the beam — local **−Z** is the beam axis. Tune `angle` and `penumbra` for hard vs soft edges.

## See also

- [Area light](./area-light) — shadowless ceiling fill
- [Point light](./point-light) — omnidirectional (higher shadow cost)
