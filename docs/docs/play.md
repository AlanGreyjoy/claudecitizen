---
sidebar_position: 3
title: Play
---

# Play

## Live build

**[https://claudecitizen.netlify.app/](https://claudecitizen.netlify.app/)**

Click the canvas to lock the mouse. Press `Esc` to release it.

## Controls

| Input | On foot / ship deck | In ship |
| --- | --- | --- |
| Click canvas | Lock mouse | Lock mouse |
| Mouse | Orbit camera | Pitch / yaw |
| Scroll | Zoom camera | Zoom camera |
| `W` / `S` | Move forward / back | Throttle |
| `A` / `D` | Strafe | Strafe |
| `Shift` | Sprint | Boost |
| `Q` / `E` | — | Roll |
| `←` / `→` | — | Yaw |
| `↑` / `↓` | — | Pitch |
| `Space` / `C` | Jump | Lift / descend |
| `B` | — | Brake |
| `F` | Enter / exit ship, leave / return to pilot seat | Same |
| `V` | — | Toggle cockpit / external view |
| `R` | Reset to landing site | Reset to landing site |
| `F2` | HaloBand home dashboard (dock: Comms / Missions / Map / Inventory / Ship) | HaloBand home dashboard (dock: Comms / Missions / Map / Inventory / Ship) |

## Quality presets

Add a query parameter to tune render quality:

```text
?quality=performance
?quality=balanced
?quality=high
```

## System Map / stations

Play loads a **system document** (default `default`) and places stations authored on the System Map around the active planet:

```text
?systemId=default
?planetId=asteron
?stationPrefab=demo-station
```

| Param | Effect |
| --- | --- |
| `systemId` | System document under `src/world/systems/data/` (default `default`) |
| `planetId` | Active planet terrain at world origin (one planet at a time) |
| `stationPrefab` | Which station interior is walkable (matches a system station instance when possible) |

Stations parented to the active planet spawn at distinct orbital bearings derived from their System Map `offsetMeters`. The primary station owns walk physics; other instances on that planet render as visual roots. Stations parented to inactive planets are not spawned until that planet is active.

Author layouts in the editor **System Map** tab (`?boot=editor&tab=system`).

### In-ship System Map (HaloBand)

1. Press **F2** → open HaloBand **Home**, then **Map** on the dock
2. Click a planet or station
3. **Set Route** stores a nav target (persists after closing HaloBand)
4. **Clear Route** removes it
5. Switch to **Nav** flight mode (tap **U**), align toward the cyan jump blip, hold **U** to quantum

- **Station route** — drops near that station’s orbital approach on the active planet.
- **Planet route (other planet)** — spool/travel VFX, then reloads play on the destination `planetId` (requires a second planet document).
- **Surface POIs** — still available as Nav destinations without Set Route.
