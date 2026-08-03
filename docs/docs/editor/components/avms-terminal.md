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
| `gazeRadius` / `maxDistance` | number | `0.4` / `3` | Gaze interact range |
| `hangarSceneId` | scene select | *(empty)* | Family hangar scene — shows **To Hangar** on the panel |
| `hangarLabel` | string | `"To Hangar"` | Button label |
| `hangarInstanceId` | cell select | `"@hangar"` | Auto-fills when Hangar Scene is picked |
| `hangarRoomId` | floor select | `"hangar"` | Auto-fills with Hangar Scene (`hab` / `lobby` / `hangar`) |

## Usage

Place near hangar access on the lobby or hangar deck. Pick a **Hangar Scene** to
enable the hangar button — **Hangar Instance** and **Hangar Room** fill like
scene-exit Network Instance / Arrival Room (`@hangar` + `hangar`).

Unlike a generic [Interaction](./interaction), AVMS terminals open the dedicated vehicle management UI rather than a text prompt.

## See also

- [Station authoring](../station-authoring)
- [Hangar pad](./hangar-pad)
