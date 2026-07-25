---
sidebar_position: 24
title: AVMS terminal
description: Opens the Asteron Vehicle Management System UI.
---

# AVMS terminal

Interaction zone that opens the **Asteron Vehicle Management System** — lets players call ships from inventory. **Station** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"avms-1"` | Unique within the prefab |
| `radius` | number | `2.5` | Interact distance in meters |
| `floorId` | `"hab"` \| `"lobby"` \| `"hangar"` | `"lobby"` | Floor filter for the terminal |

## Usage

Place near hangar access on the lobby or hangar deck. Tune `radius` so the prompt appears when the player stands at the console.

Unlike a generic [Interaction](./interaction), AVMS terminals open the dedicated vehicle management UI rather than a text prompt.

## See also

- [Station authoring](../station-authoring)
- [Hangar pad](./hangar-pad)
