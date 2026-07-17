---
sidebar_position: 53
title: Entertainment System
description: Bunk mini-TV — gaze prompt and fullscreen Entertainment System UI.
---

# Entertainment System

Bunk overhead screen for the in-bed Entertainment System (ES). **Ship** prefabs only. Place an Empty on the black bunk panel; while lying in bed, look at it and press **F** to open the Google TV–style launcher (Docs + YouTube).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"es-1"` | Unique within prefab |
| `label` | string | `"Turn on ES"` | Gaze HUD prompt |
| `gazeRadius` | number | `0.35` | Max miss from camera ray to marker (m) |
| `maxDistance` | number | `2` | Max distance from bed eye to marker (m) |
| `screenWidth` | number | `0.55` | Powered-on plane width (m) |
| `screenHeight` | number | `0.32` | Powered-on plane height (m) |

## Usage

1. Add Empty on the bunk overhead / wall screen the player looks at when lying down
2. Add component **Entertainment System**
3. Rotate the Empty so its local **+Z** faces the pillow (plane is upright by default — do not leave a pitched gizmo unless the hull screen is tilted)
4. Tune gaze radius / max distance so the prompt appears from the pillow
5. Preview: lie down → look at screen (camera eases in) → **F** → ES apps → Esc to close · Hold Y to get up

While the panel is under gaze or open, the bed camera uses a Star Citizen–style FOV zoom + slight dolly toward the screen.

Apps: **Docs**, **YouTube** (embeds), and **NASA TV** (official [NASA Live](https://www.youtube.com/channel/UCNwkvBoDag92nHiZBzbYicA) YouTube channel embed — may be offline between events).

## See also

- [Bed](./bed) (lie-down / head look)
- **Cockpit Control** markers use the same gaze-label pattern in the pilot seat.
