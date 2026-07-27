---
sidebar_position: 11
title: Base Characters
description: Character definitions, settings, animation controllers, and project clip assets.
---

# Base Characters

The **Base Characters** tab authors character appearance definitions, locomotion
settings, and animation controllers used by on-foot play (planet, station, ship
deck).

## What it owns

| Surface | Storage |
| --- | --- |
| Character definitions | Editor API `/__editor/base-characters` |
| Char Settings (walk/sprint/jump) | `/__editor/character-settings` → `src/player/data/character-settings.json` |
| Animation controllers | `/__editor/animation-controllers` → engine-owned `src/player/animation/data/*.controller.json` |
| Clip GLBs | Open project under `assets/animations/` (and related protected packs) |

Controllers bind stance → clip. Clip GLBs live in the **project**; controller JSON
is engine-owned and edited through the tab.

## Project panel → Anims

In the Project panel, open an animations folder and use a model card's **Anims**
action to load clips into this tab for retarget / controller authoring.

## Rifle ADS reminder

While ADS is active and the character is moving, the lower body keeps the rifle
gait and `idle_aiming` overrides from `spine_01` up. Sprint suppresses aim.
Details live in AGENTS.md under "Rifle ADS locomotion blending".

## Related

- [Assets](/assets#runtime-character-avatars)
- [Interface](./interface)
- [Preview and playtest](./preview-and-playtest)
