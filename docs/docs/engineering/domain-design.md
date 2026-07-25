---
sidebar_position: 2
title: Domain-Driven Design
description: Bounded contexts, dependency direction, and import rules in ClaudeCitizen.
---

# Domain-Driven Design

ClaudeCitizen uses **Domain-Driven Design (DDD)** to keep a Star Citizen–scale simulation maintainable in the browser. The idea is simple: each part of the game owns a **bounded context** with explicit boundaries. Simulation rules live in domain modules; rendering only **reads** that state.

## Why DDD here?

A procedural planet, ship physics, on-foot movement, and a Three.js renderer could easily become one tangled file. DDD gives us:

- **Clear ownership** — terrain bugs start in `world/`, not in a shader.
- **Testable logic** — domain modules export pure functions and factories (no Three.js types).
- **Performance guardrails** — `render/` cannot silently mutate simulation state mid-frame.
- **Shared authority semantics** — browser prediction and native authority share Rust simulation primitives.

## Bounded contexts

```mermaid
flowchart TB
  subgraph domain ["Domain · simulation rules"]
    World["world/<br/>planet, terrain, prefabs, coordinates"]
    Flight["flight/<br/>ship body, thrust, drag"]
    Player["player/<br/>character, deck, mode FSM"]
    Npc["npc/<br/>definitions, populations, behavior"]
  end

  subgraph presentation ["Presentation"]
    Render["render/<br/>Three.js, tiles, effects, HUD mesh"]
  end

  subgraph composition ["Composition"]
    App["app/<br/>bootstrap, sessions, HUD wiring"]
    Game["game/<br/>play-loop runtime: modes, combat, hud"]
  end

  Math["math/<br/>vectors, frames, helpers"]

  Math --> World
  World --> Flight
  World --> Player
  World --> Npc
  Flight --> App
  Player --> App
  Npc --> App
  Flight --> Game
  Player --> Game
  Npc --> Game
  App --> Game
  World --> Render
  Player --> Render
  Flight --> Render
  Npc --> Render
  Game --> Render
  App --> Render
```

| Context | Path | Owns |
| --- | --- | --- |
| **World** | `src/world/` | Planet geometry, terrain sampling, lakes, prefab schema & runtime flattening |
| **Flight** | `src/flight/` | Ship rigid-body dynamics, input mapping, radial gravity |
| **Player** | `src/player/` | Character controller, boarding, deck collision, pilot-seat FSM |
| **NPC** | `src/npc/` | Non-player definitions, weighted populations, behavior state — may read station data and character appearance, never mutates player state |
| **Render** | `src/render/` | Meshes, materials, LOD tiles, atmosphere, post-FX — **read-only** toward domain |
| **App** | `src/app/` | Session shell: scene host, play session, HUD, network, and vitals, then hands the frame loop to `game/` |
| **Game** | `src/game/` | Play-loop runtime: `create-game-loop.ts` composes colocated feature modules (modes, combat, station, ship, hud, …); orchestrates, does not own rules |

Supporting modules sit outside the core simulation boundary:

| Module | Role |
| --- | --- |
| `math/` | Shared vector math — no game rules |
| `physics/` | Rapier worlds for stations and ship decks |
| `editor/` | AsteronEngine authoring logic and React panels — stripped from game releases |
| `ui/` | DOM HUD panels |
| `net/` | WebTransport, Protobuf codecs, interpolation, WASM prediction, runtime config |

## Dependency direction

Dependencies flow **inward toward domain**, never from domain into Three.js:

```mermaid
flowchart LR
  M[math/] --> W[world/]
  W --> F[flight/]
  W --> P[player/]
  W --> R[render/]
  F --> R
  P --> R
  F --> A[app/]
  P --> A
  W --> A
  A --> R

  style W fill:#2d5016,color:#fff
  style F fill:#2d5016,color:#fff
  style P fill:#2d5016,color:#fff
  style R fill:#1a3a5c,color:#fff
  style A fill:#4a3728,color:#fff
```

### Import rules (enforced by ESLint + agent docs)

See [Physical Guards](./physical-guards) for the full rule list. Summary:

| From | May import | Must not import |
| --- | --- | --- |
| `world/`, `flight/`, `player/`, `npc/` | `math/`, each other (sparingly) | `three`, `render/`, DOM |
| `npc/` | Player character-appearance data (read) | Ownership or mutation of player state |
| `render/` | `world/`, `player/`, `flight/`, `npc/` (read) | Mutating simulation state |
| `app/` | All contexts | Inline domain logic |
| `editor/` | `world/prefabs`, `render/editor` | Game loop hot path |

**Green rule:** if you need a height sample for gameplay, call `sampleFootPlanetSurface()` in `world/` — do not raycast the mesh in `render/`.

## Ubiquitous language

Terms mean the same thing in code, docs, and prefabs:

| Term | Meaning |
| --- | --- |
| **Tile** | Quadtree cell on the cube-sphere at a given LOD level |
| **Prefab** | JSON tree of entities + components (`*.prefab.json`) |
| **Walk zone** | Authoring volume for on-foot collision (ship deck or station floor) |
| **Foot surface** | Discrete height grid used by the character controller |
| **Mode FSM** | Player state machine: on foot, on deck, in pilot seat, in flight |
| **Intent** | Client request evaluated by the authoritative cell owner |

## Prefabs as the world model

Prefabs are the bridge between **authoring** (editor) and **runtime** (domain flattening):

```mermaid
sequenceDiagram
  participant Editor as editor/
  participant JSON as *.prefab.json
  participant Schema as world/prefabs/schema.ts
  participant Runtime as ship-runtime / station-runtime
  participant Game as game/ loop + player/

  Editor->>JSON: serialize components
  JSON->>Schema: validate on load
  Schema->>Runtime: flatten to layout (doors, zones, colliders)
  Runtime->>Game: ShipLayout / StationLayoutOverride
  Game->>Game: physics, interactions, animations
```

- **Schema** (`schema.ts`) is the single source of truth for component fields.
- **Runtime flatteners** turn entity trees into gameplay structures (door rigs, deck colliders, spawn points).
- **Render** loads GLBs and applies animation blends; **player** and **physics** consume the flattened layout.

## Critical invariant: terrain mesh ↔ foot placement

The most important cross-context contract is that **visible terrain** and **foot physics** sample the **same LOD grid**:

```mermaid
flowchart LR
  TileMgr["render/planet_tiles<br/>selects finest tile level"]
  FootLvl["world/foot_surface_level<br/>stores level for gameplay"]
  Foot["world/planet_surface<br/>sampleFootPlanetSurface()"]
  Mesh["render terrain mesh<br/>same grid corners"]
  Char["player/ character update"]

  TileMgr --> FootLvl
  FootLvl --> Foot
  FootLvl --> Mesh
  Foot --> Char
  Mesh --> GPU[WebGL draw]

  style Foot fill:#5c3d1a,color:#fff
  style Char fill:#5c3d1a,color:#fff
```

Character update runs **before** render each frame, so foot sampling intentionally uses the **previous frame's** tile level (one-frame lag is acceptable; desync is not).

## Mapping to the authoritative backend

Browser domain state is predicted locally, while the Rust cell owner evaluates intents and returns authoritative reconciliation:

```mermaid
flowchart TB
  subgraph client ["Client"]
    CWorld[world queries · prediction]
    CPlayer[player intents]
    CRender[render]
  end

  subgraph server ["Authoritative Rust backend"]
    GW[WebTransport · Protobuf]
    Cell[Cell owner]
    Sim[Shared sim-core · native Rapier]
    Store[SQLx · PostgreSQL]
  end

  CPlayer -->|intent| GW
  GW --> Cell
  Cell --> Sim
  Cell --> Store
  GW -->|snapshot + reconcile| CPlayer
  CWorld --> CRender
```

Clients send **intents**; the cell owner owns outcomes. `backend/crates/sim-core/` compiles to both native code and WebAssembly so prediction does not drift into a second implementation. Rendering remains presentation-only.

## Further reading

- [Physical Guards](./physical-guards) — ESLint boundaries and AI rule layers
- Agent conventions: `AGENTS.md` (architecture section)
- [Design Principles](./design-principles) — SRP, DRY, SOLID applied to this layout
- [Technology Stack](./stack) — frameworks and runtime details
