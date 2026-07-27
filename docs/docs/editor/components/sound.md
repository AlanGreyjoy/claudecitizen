---
sidebar_position: 42
title: Sound
description: Ambient or spatial zone audio on station and ship prefabs.
---

# Sound

Positional audio emitter for **station** and **ship** prefabs.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `soundUrl` | string? | Audio asset; may be empty while authoring |
| `mode` | `"ambient"` \| `"spatial"` | Mix behavior |
| `playback` | `"loop"` \| `"enter"` | Continuous vs enter-trigger |
| `volume` | number | Per-source gain before master/SFX (0..1) |
| `blendDistance` | number | Local-space fade-in distance from zone boundary |
| `zone` | sound zone | Authored zone shape / extent |

Drag audio from the Project panel (prefer `assets/free/sfx/` or
`assets/protected/sfx/`).

## See also

- [Interaction](./interaction) (door open SFX)
- [Particle system](./particle-system)
