---
sidebar_position: 14
title: Area light
description: Rectangular soft panel light without shadows.
---

# Area light

Rectangular soft light panel. Available on **all prefab kinds**.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | hex string | `"#cfe8ff"` | Light color |
| `intensity` | number | `5` | Three.js rectangular area light luminance |
| `width` | number | `4` | Panel width in meters |
| `height` | number | `0.45` | Panel height in meters |

## Usage

Ideal for ceiling panels and soft fill in station concourses and ship cabins.

Entity **rotation** aims the panel — local **−Z** is the lit side. Area lights do **not** cast shadows.

## See also

- [Point light](./point-light) — omnidirectional sources
- [Spot light](./spot-light) — accent and hangar floods
