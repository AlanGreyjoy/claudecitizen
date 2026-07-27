---
sidebar_position: 53
title: Ship Entry
description: Ground-level board circle for exterior-entry ships.
---

# Ship Entry

Ground-level board point. Stand inside the circle beside a parked hull and press **F** to take the pilot seat — no deck walk. **Ship** prefabs only, and only consulted when the hull's [Ship controller](./ship-controller) has **Entry** set to `exterior`.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `label` | string | `"ship"` | Prompt name — `Press F — board {label}` |
| `radius` | number | `3` | Ground-level stand reach around the marker (m) |
| `seatEntityId` | entity ref | — | Seat this entry serves; defaults to the primary pilot seat |

Only **pilot**-role seats can be boarded today. Pointing `seatEntityId` at a copilot or passenger seat raises a Ship-tab warning, because that prompt would do nothing.

## How the circle is matched

The check is horizontal, at ground level:

1. The ship must be **parked** — grounded and under 1 m/s. You cannot board a hovering hull.
2. Your feet must be within the gear-rest band (±2.8 m of `−restHeight` in ship-local up), which is why an unauthored `restHeight` raises a warning.
3. Your ship-local right/forward must be inside `radius` of the marker. Nearest circle wins when several overlap.

The viewport draws the circle as a flat mint disc, not a sphere — that matches the horizontal test rather than implying reach up the hull side.

## Fallback

With **Entry = Exterior** and no Ship Entry marker at all, one circle is synthesised at the pilot seat's ground projection with radius 3. A bare hull is therefore testable the moment you flip Entry Mode; place markers when you want the board spot beside a specific door or on a specific side.

## Leaving the seat

Hold **Y**. An exterior-entry pilot steps onto the ground at the board circle facing away from the hull, and resumes planet walking or hangar-floor walking — whichever the ship is parked on. There is no deck landing.

Because there is no deck, leaving the seat **requires the ship to be parked**. Hold Y mid-flight and you get `Land before leaving the seat` instead of being dropped into empty air. Interior ships are not gated — they always have a deck to land on.

## Usage

1. Set **Entry** to `Exterior` on the hull's Ship Controller
2. Register at least one seat with role **pilot** in the controller's seat list
3. Add an Empty on the ground beside the hull → component **Ship Entry** → set radius
4. Ship tab **Test** → walk up → **F** to board → **hold Y** to step off

## See also

- [Ship controller](./ship-controller) (Entry mode)
- [Ship authoring](../ship-authoring)
