---
sidebar_position: 52
title: Cockpit Stat
description: Always-on pilot instrument readout (speed number + bar).
---

# Cockpit Stat

World-projected pilot instrument while seated. Separate from **Cockpit Control** (Hold F + click toggles). **Ship** prefabs only.

| Property | Value |
| --- | --- |
| Marker | Yes |
| Singleton | No |

## Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `"cockpit-stat-1"` | Unique within prefab |
| `kind` | `"speed"` | `"speed"` | Readout type (more kinds may follow) |
| `label` | string | — | Optional title override (default `SPEED`) |
| `maxDistance` | number | `3.5` | Hide when farther than this from the pilot eye (m) |

### Kind: `speed`

- Number: current velocity magnitude (m/s)
- Bar: fill vs **boost max** (`maxSpeedMps × (1 + BOOST_FACTOR)`)
- Tick mark: SCM / cruise cap (`maxSpeedMps`)
- Boost (Shift): raises the hard speed cap and accents the bar

## Usage

1. Add Empty on the dash / panel where the readout should float
2. Add component **Cockpit Stat** → Kind **speed**
3. Preview Ship → sit pilot → fly; hold **Shift** to boost

## See also

- [Ship controller](./ship-controller) (mass / max speed / thrust)
- [Ship authoring](../ship-authoring)
