---
sidebar_position: 16
title: Menu Manager
description: Live preview of HaloBand and other play menus with mock data.
---

# Menu Manager

The **Menu Manager** scene tab mounts live play HUD menus so you can iterate on layout without entering play. Online data (ARC, inventory, ships) uses in-code mocks.

## Open

1. Editor → **Menu Manager** scene tab
2. **File → Open Menus** — pick any menu from the catalog
3. Deep link: `/?boot=editor&tab=menu` (optional `&menu=<id>`)

## Catalog

| Id | Menu |
| --- | --- |
| `haloband` | HaloBand personal device |
| `game-menu` | Esc pause / settings |
| `personal-inventory` | I-key inventory |
| `weapon-shop` | Station weapon vendor |
| `outfitters` | Station outfitters |
| `avms` | AVMS hangar terminal |
| `build-terminal` | Build mode UI (chrome only) |
| `entertainment` | Entertainment System |

Sidebar lists the same entries. HaloBand adds tab jump buttons (**Home** default, Comms, Missions, Map, Inventory, Ship) and a ship-mode toggle.

## Notes

- Preview-only — no save / dirty state
- Weapon / outfitters **Buy** still hits the live API and will fail offline (list UI still iterates)
- Build Terminal shows static chrome without the hangar build controller
- Styles live in `src/ui/sc-ui.css`; controllers under `src/render/effects/hud/`
