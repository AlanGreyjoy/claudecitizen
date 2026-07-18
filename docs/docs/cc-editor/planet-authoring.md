---
sidebar_position: 14
title: Planet authoring
description: Author planets, tune generation and vegetation, and playtest on the surface.
---

# Planet authoring

The **Planet Authoring** scene tab lets you edit planet documents (look/feel, height recipe, hydrology, biome palette, vegetation defaults, surface spawn catalog) and jump into offline surface play to hunt FPS spikes.

## Open the tab

1. Start the editor (`?boot=editor` or title-screen **Editor**).
2. Click the **Planet Authoring** scene tab.
3. Or deep-link: `/?boot=editor&tab=planet&planetId=asteron`

## File menu

| Action | Behavior |
| --- | --- |
| **File → Open Planets** | Search/list planet documents under `src/world/planets/data/` |
| **File → Save** / Ctrl+S | Writes `<id>.planet.json` via `/__editor/planet` |
| **Game → Test Play** | Saves, then opens surface playtest |
| **Preview** (panel button) | Rebuilds the heightfield patch and plants grass/trees plus spawn-catalog props from current settings (stays in the editor) |
| **Test Play** (panel button) | Same as **Game → Test Play** |

## Document location

Planet JSON lives at `src/world/planets/data/<id>.planet.json`. Asteron ships as the default (`asteron.planet.json`, seed `20061`).

Authorable fields include identity/seed, physics, height recipe, region thresholds, hydrology, biome palette colors, grass/tree vegetation (density, gap, scale, asset lists), and the **Spawn Catalog** (GLB surface props).

The bottom **Project** asset browser stays visible in this tab so you can drag `.glb` / `.gltf` files into Vegetation asset rows and Spawn Catalog entries.

## Spawn Catalog

Collapsible **Spawn Catalog** section authors a weighted list of surface props (rocks, debris, small fixtures). Legacy planet JSON that still uses a `spawning` **array** migrates on load into this catalog object.

### Catalog settings

| Field | Role |
| --- | --- |
| Samples per tile | Shared UV probes per terrain tile (default 96, hard-capped in code). All entries compete from this set — not one full sample loop per entry. |
| Catalog density | Scales shared sample count (`samplesPerTile × density^1.2`). |

### Per entry

| Field | Role |
| --- | --- |
| Asset | Drop a model from Project (`ASSET_DND_TYPE` URL) |
| Weight | Relative pick chance among entries that accept a probe |
| Density / gap / min–max scale | Per-entry sparsity (legacy density), gap, and size variation |
| Biomes | Allowlist (empty = no placements). Shore props: include `beach` |
| Min/max normalized height | Height band **0–1** (sea→peak). Plains/forest: typically `0`–`1`. Shore: biome `beach` and/or max ≈ `0.012`. **Do not set min=1** unless you only want peaks. |
| Align to normal | Orient to terrain normal |
| Terrain inset (m) | Signed offset along the surface normal (meters at scale 1; scales with instance size). **Negative sinks** into the terrain; positive lifts above it |
| Collider | Authored **box** or **capsule** half-sizes at scale 1 (walkable in play). No trimesh. |

### Performance

- Soft target: ~**50** enabled entries. The editor warns above that count.
- **Prefer reusing GLBs** — draw calls scale with unique assets × mesh parts, not entry count. Many entries can share one rock GLB with different weights/biomes/gaps.
- Use **Test Play** (or surface play with `debug=1`) to judge FPS; the heightfield **Preview** plants grass/trees and a bounded sample of catalog props — not a full play LOD stream.
- Catalog edits invalidate spawn tile caches via hash (`hashSurfaceSpawnCatalog`); placement algorithm or stored-tile schema changes bump `SURFACE_SPAWN_CACHE_VERSION`. Spawn tiles use IndexedDB + a placement worker (main thread only applies results within a frame budget).

In play, props stream as asset-batched instanced meshes near the player. Nearby instances get Rapier box/capsule colliders so on-foot characters can bump into and stand on them.

## Live preview

The Planet Authoring panel shows a bounded heightfield patch around the spawn hint with biome vertex colors plus a translucent ocean/lake/river water overlay (ocean / lakes from the same domain as play). Click **Preview** to plant grass/trees and spawn-catalog GLBs across the whole patch (bounded sample counts — not a full play LOD stream). Camera controls match the Scene tab: **LMB** orbit, **MMB** pan, hold **RMB + WASD/QE** fly (wheel adjusts speed while flying, **Shift** boosts). Use **Test Play** for full terrain LOD, surface-spawn streaming, and FPS/stats.

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

Terrain/vegetation tiles stay in IndexedDB, keyed by `planetId` + generation fingerprint. Palette, noise, vegetation, and spawn-catalog edits invalidate related caches automatically (`SURFACE_SPAWN_CACHE_VERSION` for spawn placement algorithm or stored-tile schema changes).

## Vegetation

The **Vegetation** section authors grass and tree layers separately:

| Field | Role |
| --- | --- |
| Grass color | Tint for procedural + PNG grass billboards |
| Density / gap | Per-layer sparsity |
| Min / max scale | Instance size range |
| Assets | Grass: drag `.png` (or `.jpg` / `.webp`) billboard textures. Trees: drag `.glb` / `.gltf`. Multiple URLs become random variants |

**Grass:** empty asset list → procedural crossed alpha-cutout billboards (default). Non-empty → crossed billboards textured with the authored PNGs (same wind path). Color tints both. **Trees:** instanced meshes from the asset list, with cone LOD at distance. Empty tree assets → no trees.

**Density is per planet** (`vegetation.grass.density` / `vegetation.tree.density`). Quality presets only set a sample budget ceiling; the planet density multiplier scales how much of that budget is used. Asteron ships grass density `1`, tree density `0.2`, empty grass assets (billboards), and Magakit `Pine_1`…`Pine_5` for trees.

Vegetation edits invalidate veg tile caches via `hashVegetationSettings` (includes asset URLs). Placement algorithm or stored-tile schema changes bump `VEGETATION_CACHE_VERSION`.
