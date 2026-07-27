---
sidebar_position: 39
title: Equipment socket
description: Named attachment point on a character or item for equipped weapons.
---

# Equipment socket

Named attachment point that accepts a specific weapon slot type. Used on item /
character attachment authoring.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique within the item prefab (e.g. `rifle-primary`) |
| `accepts` | weapon slot type | Exact weapon compatibility this socket accepts |

## See also

- [Drawn grip](./drawn-grip)
- [Weapon combat](./weapon-combat)
- [Props and items](../props-and-items)
