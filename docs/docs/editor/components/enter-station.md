---
sidebar_position: 26
title: Enter Station
description: Open Space → hangar. Ship fly-through volume on a station body.
---

# Enter Station

Boarding volume on a **Station** body (`Runtime: station`). A ship that flies
through it lands in that station family's **hangar instance** — never the
concourse, and never by "falling into" the station body as a world swap that
drops the Open Space host.

Open-air and closed stations use the same component. The difference between
them is art and collider layout, not a second travel system.

Docs name: `ENTER-STATION`. Component type: `enter-station`.

Architecture: [Space traversal — Station boarding](../../architecture/space-traversal).

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |
| Scenes | Yes (station palette) |

## Fields

| Field | Default | Notes |
| --- | --- | --- |
| Radius | `60` | Crossing radius in meters. Station bay mouths are large; size it to the opening. |
| Hangar Scene | *(System Map Hangar Scene)* | Override. Empty resolves the hangar from the System Map entry that placed this body. |
| Arrival Room | `hangar` | Room id sent with the network Transition. |

The destination is resolved **at trigger time**, not at bake time: a station
document does not know which System Map entry placed it, so the runtime looks
up ownership from the active station instance. A body that no map entry owns
and that authors no override logs a warning and stays in open space.

## Arrival

`default` — the player walks into the hangar and the hull is parked by the
hangar's own delivery logic, exactly as an AVMS **To Hangar** hop does. Crossing
the volume does not auto-assign a hangar bay.

## Usage

1. Open the station scene and set **Scene Settings → Runtime** to `station`
2. Place an Empty at the bay mouth (nested under the station tree)
3. Add **Enter Station**, size the radius to the opening
4. On the System Map, set this station's **Hangar scene**
5. On that hangar, place [Exit Hangar](./exit-hangar) for the trip back out

## See also

- [Exit Hangar](./exit-hangar) — hangar → Open Space
- [Hangar Open Space Exit](./hangar-open-space-exit) — the departure mouth pose
- [System Map](../system-map) — `hangarSceneId` ownership
- [Space traversal](../../architecture/space-traversal)
