# ClaudeCitizen

![ClaudeCitizen gameplay screenshot](docs/screenshot.png)

A browser-based space sandbox inspired by Star Citizen — procedural planets, ship flight, on-foot exploration, and seamless surface-to-orbit transitions. Built with TypeScript, Vite, and Three.js.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes, vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted development rather than a formal spec or roadmap. I'm a Staff Software Engineer and Solutions Architect with 17+ years of experience; this is a passion sandbox, not a production product.

**Work in progress.** More Star Citizen–style features are on the way — better ships (not just a pirate ship LOL!), deeper flight and exploration, and whatever else the vibe demands.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). Click the canvas to lock the mouse.

## Commands

| Script              | Description                                      |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Dev server with hot reload (port 4173)           |
| `npm run serve`     | Same as `dev`                                    |
| `npm run build`     | Typecheck + production build to `dist/`          |
| `npm run typecheck` | Run TypeScript without emitting                  |
| `npm run demo`      | Headless scripted takeoff / orbit / landing demo |

## Controls

| Input         | On foot / ship deck                             | In ship               |
| ------------- | ----------------------------------------------- | --------------------- |
| Click canvas  | Lock mouse                                      | Lock mouse            |
| Mouse         | Orbit camera                                    | Pitch / yaw           |
| Scroll        | Zoom camera                                     | Zoom camera           |
| `W` / `S`     | Move forward / back                             | Throttle              |
| `A` / `D`     | Strafe                                          | Strafe                |
| `Shift`       | Sprint                                          | Boost                 |
| `Q` / `E`     | —                                               | Roll                  |
| `←` / `→`     | —                                               | Yaw                   |
| `↑` / `↓`     | —                                               | Pitch                 |
| `Space` / `C` | Jump                                            | Lift / descend        |
| `B`           | —                                               | Brake                 |
| `F`           | Enter / exit ship, leave / return to pilot seat | Same                  |
| `R`           | Reset to landing site                           | Reset to landing site |

Use the **Vegetation** panel (top-left) to tune grass, trees, and fog at runtime.

## What's in the box

- **Procedural planet** — cube-sphere tiles, height sampling, landing sites, lake water
- **Flight** — inertial ship body with radial gravity, drag, and hover assist near the pad
- **Player** — third-person character, ship boarding animations, walkable ship deck
- **Rendering** — tiled terrain meshing (Web Worker), instanced vegetation, star field, Takram atmosphere/clouds, volumetric fog, post-processing

## How the planet works

Asteron is **Earth-scale** (~6,371 km radius). You can't treat that as a flat map or shove raw coordinates into WebGL — so the hard parts are all about making a huge sphere feel solid under your feet.

**Cube-sphere, not a UV sphere.** The surface is six cube faces projected onto a sphere. Every point on the planet maps to a face and a `(u, v)` coordinate, then subdivides into a **quadtree of tiles** that get finer near the camera and coarser at the horizon.

**Procedural terrain.** Height comes from layered 3D noise (continents, ridges, hills, detail) plus carved lake basins. Same seed, same world, every time — no heightmap files shipped with the game.

**Adaptive LOD.** Tiles split when you're close and merge when you're far or over the horizon. Meshes build incrementally in a Web Worker (with disk cache), and coarser parent tiles fill in while high-res ones stream in.

**The foot-sync problem.** The visible ground mesh and the character controller don't sample terrain the same way by accident — they share the same discrete height grid. Get that wrong and you float or sink. Keeping mesh LOD and foot placement aligned is the trickiest invariant in the project.

**Floating origin.** The camera/player position recenters the world each frame so Three.js isn't crunching numbers in the millions of meters. You stay near the origin; the planet moves around you.

```mermaid
flowchart TB
  subgraph coords ["Coordinates"]
    Pos["Player / camera position"]
    Dir["Unit direction from center"]
    Face["Cube face + UV"]
    Tile["Quadtree tile (level, x, y)"]
  end

  subgraph terrain ["Terrain"]
    Noise["Layered 3D noise + lakes"]
    Grid["24×24 height grid per tile"]
  end

  subgraph lod ["LOD & streaming"]
    Split["Split near camera · cull at horizon"]
    Worker["Web Worker mesh build + disk cache"]
    Parent["Coarser parent tiles while loading"]
  end

  subgraph output ["Output"]
    Mesh["Terrain mesh"]
    Feet["Foot placement"]
    Render["Three.js · floating origin"]
  end

  Pos --> Dir --> Face --> Tile
  Tile --> Split
  Split --> Noise --> Grid
  Grid --> Worker --> Mesh
  Split --> Parent --> Mesh
  Grid --> Feet
  Mesh --> Render
  Feet --> Render
```

### The math underneath

Nothing here requires a PhD — but there is real geometry and signal processing holding the planet together.

**Cube-sphere projection.** A world position becomes a unit direction, then the dominant axis (`|x|`, `|y|`, or `|z|`) picks a cube face. The other two components, scaled by that axis, give `(u, v)` coordinates on the face. Map back with a face-specific formula and normalize — you get a point on the sphere without polar singularities.

**Horizon culling.** From altitude we compute how much of the sphere is visible (a cone angle). Each tile has an angular width from its chord span. Tiles whose nearest edge falls below the horizon are skipped — no mesh budget wasted on the back side of the planet.

**LOD error metric.** Whether a tile splits comes down to projected screen error: `tileSpan / cameraDistance` compared to a threshold that loosens as you climb. Near the ground we force max detail in a radius around the player so the mesh under your feet is always the finest LOD.

**Dual height sampling.** Terrain noise is continuous — sample anywhere and you get a height. But the mesh only knows about a fixed grid of corner heights. At runtime we locate your `(u, v)` in that grid, bilinearly interpolate between four cached corner points on the sphere (split into two triangles), then project back onto the radial direction for height and surface normal. The mesh and foot controller must use this *same* grid at the *same* LOD — not the raw noise function.

**Layered noise (FBM + ridged).** Height stacks several octaves of 3D simplex noise at different scales: broad continents, sharp ridged mountains, regional hills, fine detail. Ridged noise (`1 − |n|`, squared) gives crisp peaks instead of smooth blobs. A separate noise field carves lake basins into the result.

**Tangent frames on a sphere.** "Up" is always radial from planet center. East is `worldNorth × radialUp`. Trees, grass, and the ship build local `(tangent, bitangent, normal)` frames so objects stand upright on curved ground instead of embedding in a flat plane.

**Floating origin.** Render coordinates are `(worldPos − playerPos) × 1/500`. Simulation stays in full-precision meters; WebGL works near zero. The planet slides around you every frame.

See `.agents/AGENTS.md` for architecture conventions; `src/world/` and `src/render/planet_tiles/` for the implementation.

## Project layout

```
src/
  app.ts              Application loop and mode FSM
  math/               Pure vector math
  world/              Planet, surface, coordinates, clouds
  flight/             Ship physics and input
  player/             Character, deck, ship interaction
  render/             Three.js presentation layer
  assets/             GLTF models (ship, vegetation)
scripts/              Dev utilities and the orbit demo
.agents/AGENTS.md     Architecture and agent conventions
```

Domain rules live in `world/`, `flight/`, and `player/`. Rendering reads from those modules but does not own simulation state. See `.agents/AGENTS.md` for the full dependency map.

## Stack

- [Vite](https://vite.dev/) — dev server and bundler
- [Three.js](https://threejs.org/) — WebGL renderer
- [@takram/three-geospatial](https://github.com/takram-design-engineering/three-geospatial) — atmosphere and clouds
- [postprocessing](https://github.com/pmndrs/postprocessing) — bloom and tone mapping
- [simplex-noise](https://github.com/jwagner/simplex-noise.js/) — procedural terrain

## License

Private project (`"private": true` in `package.json`).
