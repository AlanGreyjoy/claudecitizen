---
sidebar_position: 42
title: Ship stats
description: Max speed, HP, shields, and shield regen for a ship type.
---

# Ship stats

Static combat and flight tuning for this ship type. **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | No |
| Singleton | Yes — one per document |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `maxSpeedMps` | number | `100` | Top speed in meters per second |
| `maxHp` | number | `1000` | Hull hit points |
| `maxShields` | number | `500` | Shield capacity |
| `shieldRegenPerSec` | number | `25` | Shield recharge rate |

## Usage

Place on the root entity next to [Ship frame](./ship-frame).

Values can also be overridden by server-side ship definitions in the [Admin App](/admin-app/ship-definitions). Prefab stats serve as defaults when no catalog override exists.

## See also

- [Ship authoring](../ship-authoring)
