---
sidebar_position: 3
title: Controls
---

# Playing the game

There is no hosted public build. Launch the game one of two ways:

| Where | How |
| --- | --- |
| **In the editor** | Open a scene in AsteronEngine and press **F6**. **F7** pauses. See [Play mode](/editor/preview-and-playtest). |
| **From a release** | Run **File → Build Web**, then serve the output directory with any static host. |

Click the canvas to lock the mouse. Press `Esc` to release it.

## Controls

Defaults are listed below; keyboard actions are rebindable, so your project may
differ.

### Movement and vehicles

| Input | On foot / ship deck | In ship |
| --- | --- | --- |
| Mouse | Orbit camera | Pitch / yaw (dual-reticle aim) |
| Scroll | Zoom camera | Zoom camera |
| `W` / `S` | Move forward / back | Throttle |
| `A` / `D` | Strafe | Strafe |
| `Shift` | Sprint | Boost |
| `Q` / `E` | — | Roll |
| `←` / `→` | — | Yaw |
| `↑` / `↓` | — | Pitch |
| `Space` / `C` | Jump | Lift / descend |
| `B` | Cycle drawn firearm mode | Brake |
| `F` | Enter / exit ship, leave / return to pilot seat | Hold for cockpit free-look |
| `Y` | — | Hold to leave the pilot seat |
| `V` | — | Toggle cockpit / external view |
| `U` | — | Tap to cycle flight mode; hold in Nav to quantum |
| `R` | Reload drawn firearm; otherwise reset to landing site | Reset to landing site |

### Combat

| Input | Effect |
| --- | --- |
| `1` / `2` / `3` | Draw or holster primary rifle, secondary rifle, or handgun |
| RMB | Aim drawn firearm (ADS) |
| LMB | Fire drawn firearm; activates cockpit controls while free-looking in a seat |
| `B` | Cycle fire mode |
| `R` | Reload |

Sprinting takes precedence over aiming: moving at sprint speed suppresses the ADS
pose and aim camera until you slow down.

### Interface and building

| Input | Effect |
| --- | --- |
| `F2` | HaloBand home dashboard (dock: Comms / Missions / Map / Inventory / Ship) |
| `I` | Personal inventory |
| `H` | Hangar build mode |
| `G` | Rotate prop while placing |
| `X` | Cancel the build tool |

## Weapon combat

Equip a rifle or handgun in HaloBand **Inventory**, then press its `1`–`3` slot to
draw it. The lower-right combat HUD shows rounds in the current magazine, reserve
rounds in personal inventory, and the selected fire mode. Fire is world-geometry
only in this slice: rounds can hit terrain, station walls, and ship colliders, but
do not damage players or NPCs.

Reloading takes 1.5 seconds and consumes the exact rounds loaded from the matching
server-backed ammo stack. Buy 5.56 and 9mm rounds from the station Weapon Shop;
each purchase is one round. An empty Weapon Shop allowlist stocks all catalog
weapons and ammo.

## Quality presets

Add a query parameter to tune render quality:

```text
?quality=performance
?quality=balanced
?quality=high
```

## Scenes and deep links

A shipped release boots the scene named in `asteron.runtime.json` and follows the
`ui-screen` and `scene-link` GameObjects from there — scene changes happen
**in-process**, never by reloading the page.

Authoring and playtest happen in AsteronEngine (**F6** / Ship tab **Test** /
Planet **Test Play**). There is no browser URL playtest workflow for day-to-day
work; the web build is a release artifact from **File → Build Web**.

## System Map and stations

Playable scenes select a **system document** through `game-manager` and place
stations authored on the System Map around the active planet.

| Field | Effect |
| --- | --- |
| `systemId` | System document under the project's systems data (default `default`) |
| `planetId` | Active planet terrain at world origin (one planet at a time) |
| Station `prefab-instance` | Which station interior is walkable |

Stations parented to the active planet spawn at distinct orbital bearings derived
from their System Map `offsetMeters`. The primary station owns walk physics; other
instances on that planet render as visual roots. Stations parented to inactive
planets are not spawned until that planet is active.

Author layouts in the editor's **[System Map](/editor/system-map)** tab.

### In-ship System Map (HaloBand)

1. Press **F2** → open HaloBand **Home**, then **Map** on the dock
2. Click a planet or station
3. **Set Route** stores a nav target (persists after closing HaloBand)
4. **Clear Route** removes it
5. Switch to **Nav** flight mode (tap **U**), align toward the cyan jump blip, hold **U** to quantum

- **Station route** — drops near that station's orbital approach on the active planet.
- **Planet route (other planet)** — spool/travel VFX, then reloads play on the destination `planetId` (requires a second planet document).
- **Surface POIs** — still available as Nav destinations without Set Route.
