---
sidebar_position: 47
title: Pilot seat
description: Seat pose, eye offset, and stand-up spot for ship interiors.
---

# Pilot seat

Seat marker for ship interiors. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `role` | `"pilot"` \| `"passenger"` | `"passenger"` | `pilot` enables flight controls |
| `eye` | `{ x, y, z }` | `{0, 0.87, 0.25}` | Cockpit camera offset from seat |
| `stand` | `{ x, z }` | `{0, -1.55}` | Stand-up position offset (XZ) |
| `interactRadius` | number | `1.45` | F-key interact range |

## Usage

Entity **position** is the seat. Set `role` to `"pilot"` on the cockpit chair — only one pilot seat is required for flight.

Tune `eye` in the ship sandbox until the cockpit view feels right. `stand` controls where the character appears when leaving the seat.

## See also

- [Ship authoring](../ship-authoring)
