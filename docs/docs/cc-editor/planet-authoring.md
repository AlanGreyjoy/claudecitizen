---
sidebar_position: 14
title: Planet authoring
description: Author planets, tune generation and vegetation, and playtest on the surface.
---

# Planet authoring

The **Planet Authoring** scene tab lets you edit planet documents (look/feel, height recipe, hydrology, biome palette, vegetation defaults, surface spawn layers) and jump into offline surface play to hunt FPS spikes.

## Open the tab

1. Start the editor (`?boot=editor` or title-screen **Editor**).
2. Click the **Planet Authoring** scene tab.
3. Or deep-link: `/?boot=editor&tab=planet&planetId=asteron`

## File menu

| Action | Behavior |
| --- | --- |
| **File → Open Planets** | Search/list planet documents under `src/world/planets/data/` |
| **File → Save** / Ctrl+S | Writes `<id>.planet.json` via `/__editor/planet` |
| **Game → Preview Planet** | Saves, then opens surface playtest |

## Document location

Planet JSON lives at `src/world/planets/data/<id>.planet.json`. Asteron ships as the default (`asteron.planet.json`, seed `20061`).

Authorable fields include identity/seed, physics, height recipe, region thresholds, hydrology, biome palette colors, grass/tree vegetation defaults, and **Spawning** layers (GLB props).

The bottom **Project** asset browser stays visible in this tab so you can drag `.glb` / `.gltf` files into spawn layers.

## Spawning

Collapsible **Spawning** section authors lists of surface props (rocks, special trees, fences, etc.):

| Field | Role |
| --- | --- |
| Asset | Drop a model from Project (`ASSET_DND_TYPE` URL) |
| Density / gap / min–max scale | Placement density and size variation |
| Biomes | Allowlist (empty = no placements). Shore props: include `beach` |
| Min/max normalized height | Height band **0–1** (sea→peak). Plains/forest: typically `0`–`1`. Shore: biome `beach` and/or max ≈ `0.012`. **Do not set min=1** unless you only want peaks. |
| Align to normal | Orient to terrain normal |
| Collider | Authored **box** or **capsule** half-sizes at scale 1 (walkable in play) |

In play, layers stream as instanced meshes near the player. Nearby instances get Rapier colliders so on-foot characters can bump into and stand on them. Dense trimesh colliders are intentionally unsupported — keep collider boxes/capsules simple.

## Live preview

The Planet Authoring panel shows a bounded heightfield patch around the spawn hint with biome vertex colors plus a translucent ocean/lake/river water overlay (from `lakeWaterLevelMeters`, same domain as play). Camera controls match the Scene tab: **LMB** orbit, **MMB** pan, hold **RMB + WASD/QE** fly (wheel adjusts speed while flying, **Shift** boosts). Use **Preview Planet** for full terrain LOD, vegetation, surface spawns, and FPS/stats.

## Offline surface playtest

```text
http://localhost:4173/?boot=play&planetId=asteron&spawn=surface&from=editor&debug=1
```

| Param | Effect |
| --- | --- |
| `planetId` | Loads that planet document (default `asteron`) |
| `spawn=surface` | Starts on-foot at the landing site (skips station spawn) |
| `from=editor` | Shows **Back to Editor** → Planet Authoring tab |
| `debug=1` | Forces the stats panel open |
| `quality=` | `performance` \| `balanced` \| `high` |

Terrain/vegetation tiles stay in IndexedDB, keyed by `planetId` + generation fingerprint. Palette, noise, vegetation, and spawn-layer edits invalidate related caches automatically (`SURFACE_SPAWN_CACHE_VERSION` for spawn placement algorithm changes).

## Grass

Grass is rendered as crossed alpha-cutout quads (instanced), not Magakit meshes. Trees remain instanced meshes with cone LOD.

**Density is per planet** (`vegetation.grass.density` on the planet document / Planet Authoring panel). Quality presets only set a sample budget ceiling; the planet density multiplier scales how much of that budget is used. Asteron ships at `5`.
