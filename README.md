# ClaudeCitizen

![ClaudeCitizen gameplay screenshot](docs/screenshot.png)

A browser-based space sandbox inspired by Star Citizen — procedural planets, ship flight, on-foot exploration, and seamless surface-to-orbit transitions. Built with TypeScript, Vite, and Three.js.

The homeworld is **Asteron**: Earth-scale radius, deterministic terrain, lakes, vegetation, volumetric clouds, and a full atmospheric shell.

This project is **100% vibe coded** — built iteratively with AI-assisted development rather than a formal spec or roadmap. I'm a Staff Software Engineer and Solutions Architect with 17+ years of experience; this is a passion sandbox, not a production product.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). Click the canvas to lock the mouse.

## Commands

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server with hot reload (port 4173) |
| `npm run serve` | Same as `dev` |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm run demo` | Headless scripted takeoff / orbit / landing demo |

## Controls

| Input | On foot / ship deck | In ship |
|-------|---------------------|---------|
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
| `R` | Reset to landing site | Reset to landing site |

Use the **Vegetation** panel (top-left) to tune grass, trees, and fog at runtime.

## What's in the box

- **Procedural planet** — cube-sphere tiles, height sampling, landing sites, lake water
- **Flight** — inertial ship body with radial gravity, drag, and hover assist near the pad
- **Player** — third-person character, ship boarding animations, walkable ship deck
- **Rendering** — tiled terrain meshing (Web Worker), instanced vegetation, star field, Takram atmosphere/clouds, volumetric fog, post-processing

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
