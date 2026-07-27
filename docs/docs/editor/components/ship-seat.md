---
sidebar_position: 54
title: Ship Seat
description: Seat settings on the seat marker itself — role, eye, stand, reach.
---

# Ship Seat

Per-seat settings, authored on the seat marker rather than on the hull. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## The marker is the character's root, not the cushion

The entity's own position is where the **seated character's root** goes, and the avatar renders with its feet on that origin — `character-avatar-model.ts` drops the model so its bounds rest there. So the empty belongs **on the deck under the chair**, not up on the seat pad.

:::caution Tune first-person with Eye, not the marker

Raising the marker to make the cockpit view feel right lifts the **whole body** with it — the character floats above the chair and the sitting animation reads as sitting on top of the seat. The marker sets where the body goes; `eye` sets where the camera goes. Put the marker on the floor, then raise `eye.y` until the view sits where you want it.

:::

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `role` | `pilot` / `copilot` / `turret` / `passenger` | `pilot` on add | Only `pilot` seats can be taken and flown today |
| `eye` | Vec3 | `0, 0.87, 0.25` | Offset from the marker to the cockpit camera, in scene axes |
| `stand` | XZ | `0, −1.55` | Get-up spot beside the chair, in scene XZ |
| `interactRadius` | number | `1.45` | Reach for the "take the seat" prompt |

## Gizmo

| Part | Meaning |
| --- | --- |
| Flat disc + ring at the marker | Character root — keep this on the deck |
| Sphere at the top of the stem | The `eye` point, where the cockpit camera lands |
| Stem | The `eye` offset you are authoring |
| Flat ring off to the side | `stand` — get-up spot |

Colour follows the role: **pilot** green, **copilot** blue, **turret** orange, **passenger** grey. The gizmo updates live as you edit Eye.

## Registering the seat

[Ship controller](./ship-controller)'s `seats[]` list decides which entities are seats and their order (first pilot seat wins for flight). Two ways in, both fine:

- Drag the empty into the controller's seat list — the Ship Seat component is added for you.
- Add Ship Seat to the empty directly — the bake adopts it even if it was never listed, appending it after the listed seats.

## Usage

1. Add an Empty on the deck **under** the chair
2. Add component **Ship Seat** → set Role
3. Raise **Eye Y** until the sphere sits at head height for that chair
4. Drag the empty into the hull's Ship Controller seat list
5. **Test** (F6) → take the seat and check the view

## See also

- [Ship controller](./ship-controller) (seat list, entry mode)
- [Ship authoring](../ship-authoring)
