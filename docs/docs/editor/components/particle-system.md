---
sidebar_position: 43
title: Particle system
description: Unity-style particle emitter with modules and a 2,048-particle hard cap.
---

# Particle system

Unity-style particle emitter. Available on station, ship, prop, and related kinds
that expose it in the palette.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Hard cap

`maxParticles` is clamped to **2,048** (`PARTICLE_MAX_PARTICLES_HARD_CAP`). Keep
emitters bounded — particles are a frame-budget cost.

## Core fields

| Field | Notes |
| --- | --- |
| `enabled` / `playOnAwake` / `prewarm` | Playback flags |
| `duration` / `looping` | Emitter lifetime |
| `startDelay` / `startLifetime` / `startSpeed` / `startSize` / `startRotation` | Min/max curves |
| `startColor` | Initial color |
| `gravityModifier` | Gravity scale |
| `simulationSpace` | Local vs world |
| `maxParticles` | Cap (≤ 2048) |
| `emission` / `shape` | Spawn rate and emitter shape |
| `velocityOverLifetime` / `forceOverLifetime` | Optional motion modules |
| `colorOverLifetime` / `sizeOverLifetime` | Optional appearance modules |
| `textureSheetAnimation` | Optional sheet |
| `collision` | Plane collision only |
| `trails` | Optional trails |
| `renderer` | Billboard / mesh renderer settings |

Tune in the Inspector; the runtime lives under `src/render/particles/`.

## See also

- [Muzzle flash](./muzzle-flash)
- [Sound](./sound)
- [Components](./)
