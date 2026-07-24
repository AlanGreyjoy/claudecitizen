---
sidebar_position: 11
title: Interaction
description: Prompt bubble when the player is within interact radius.
---

# Interaction

Shows a prompt when the player is within `radius`. Available on **all prefab kinds**.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | — | Unique within the prefab |
| `prompt` | string | `"Press F — inspect"` | Text shown in the HUD bubble |
| `radius` | number | `2.5` | Interact distance in meters |
| `floorId` | `"hab"` \| `"lobby"` \| `"hangar"` | `"lobby"` | Station floor filter (stations only) |
| `interactionType` | `"info"` \| `"animation"` | `"info"` | `animation` toggles a linked animation |
| `targetAnimationId` | string | — | Required when `interactionType` is `"animation"` |
| `keyLabel` | string | — | Optional override for the bound key label |
| `proximitySoundUrl` | string | — | SFX played once when the player enters the radius |
| `interactSoundUrl` | string | — | SFX played when the bound key is pressed |

## Usage

Place the marker entity at the interact spot. Move it with the gizmo until the prompt feels right in **Play Mode**.

### Info prompts

Leave `interactionType` unset or set to `"info"` for read-only inspect text — terminals, plaques, crate labels.

### Animated doors

Pair with an [Animation](./animation) component:

1. Add `animation` defining which GLB nodes move
2. Add `interaction` with `interactionType: "animation"` and `targetAnimationId` matching the animation's `id`
3. Press **F** in play to toggle

The editor viewport toolbar shows per-animation toggle buttons for preview.

### Sound effects

Assign optional SFX from the Project panel (`.ogg`, `.mp3`, `.wav`, `.m4a`):

- **Proximity SFX** — plays once when the player walks into the interaction radius; retriggers after leaving and re-entering
- **Interact SFX** — plays when the player presses the bound key (e.g. **F**)

Drag an audio file from the Project panel onto the inspector field, or paste the asset URL (e.g. `/editor/assets/free/sfx/door-creak.ogg`). Store files under `editor/assets/free/sfx/` or `src/assets/sfx/`.

Playback respects **Master** and **SFX** volume in the game menu. Station play / preview only today.

## See also

- [Animation](./animation) — authored node motion
- [Station authoring](../station-authoring) — door wiring
