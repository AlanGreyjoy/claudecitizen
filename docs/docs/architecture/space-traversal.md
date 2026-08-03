---
sidebar_position: 3
title: Space traversal
description: Open Space is the active star system at 1:1 System Map scale; stations are scene documents with Runtime = station (giant prefabs).
---

# Space Traversal Architecture

Authoritative mental model for how a ship moves *inside* a star system once the
player has left a hangar for Open Space — and what a "station scene" actually
**is**.

Related: [Star Map / Star System](./star-map) (one system ↔ one map; Warp Gates
between systems),
[Basic game loop](./game-loop) (Hab → Station → Hangar → Open Space),
[Scene flow](./scene-flow) (boot / starting system only),
[Multiplayer](./multiplayer) (cells, presence, travel intents),
[Ship flight](./ship-flight) (flight computer, Traverse / Combat / Nav, boost, quantum
engage),
[Ship physics](./ship-physics) (vacuum inertia, residual coast, coupled assist),
[Ship combat](./ship-combat) (Combat contact blips — distinct from nav body blips),
[System Map](../editor/system-map) (editor how-to; ecliptic authorship),
[Hangar Open Space Exit](../editor/components/hangar-open-space-exit).

## Permanent decision: scene document, prefab runtime

We keep calling the authoring unit a **scene** (`.scene.json`, GameObject tree,
Scene tab, Scene Settings). That does **not** mean every scene is a separate
play world you teleport between.

For stations (and anything else that must sit as a body inside Open Space), the
document is really a **giant prefab**:

- Same GameObject / component authoring surface as today.
- System Map / Open Space **places** that document at ecliptic meters like a
  hull, not like a full page navigation target.
- Walk physics, markers, `scene-exit`, hangar mouth, etc. live on that tree —
  they travel with the body when it is placed.

**Scene Settings gains a `Runtime` field.** `Runtime` is the permanent switch
that tells play *how* to treat the document. Do not infer this from vibes,
folder names, or "it has a planet component." Agents and features must read
`Runtime`.

| Runtime | Meaning |
| --- | --- |
| `open-space` | **System host.** The current star system's play surface. Planets and station bodies are placed into *this* scene at 1:1 System Map meters. |
| `station` | **Giant prefab body.** Authored as a scene; loaded / culled / blipped / walked as a placeable orbital (or surface-orbit) body inside an `open-space` host. System Map `sceneId` points here. |
| `hab` | Per-player interior cell for that station family. Entered via `scene-exit` / boot hop — not an ecliptic marker. |
| `hangar` | Per-player hangar cell for that station family. Same rule as Hab. |
| `flow` | Menu / boot / loading / character-create documents. Never a world body. |

Existing Scene Settings `kind` (boot, title, instance, …) can keep serving
editor taxonomy and back-compat; **`Runtime` is the world-model truth.** When
they disagree, fix the document — do not invent a third path.

```mermaid
flowchart TB
  OpenSpace["Scene Runtime = open-space<br/>one star system host"]
  StationA["Scene Runtime = station<br/>giant prefab body A"]
  StationB["Scene Runtime = station<br/>giant prefab body B"]
  HabA["Scene Runtime = hab"]
  HangarA["Scene Runtime = hangar"]
  Map[System Map]
  Map -->|"places at map meters"| StationA
  Map -->|"places at map meters"| StationB
  OpenSpace --> StationA
  OpenSpace --> StationB
  Map -->|"ownership ids only"| HabA
  Map -->|"ownership ids only"| HangarA
  StationA -.->|"scene-exit / AVMS"| HabA
  StationA -.->|"scene-exit / AVMS"| HangarA
```

### What this rejects

- Treating every station `sceneId` as a full world swap that leaves Open Space
  behind as an empty void.
- Requiring a separate `*.prefab.json` *and* a scene for the same station hull
  just to satisfy naming. One scene document with `Runtime: station` is enough.
- Dual long-lived paths (`sceneId` XOR `stationPrefabId`) as the *design*.
  Legacy prefab entries may exist until migrated; new work uses
  `Runtime: station` scenes.
- Inferring Open Space vs station vs hab from `kind` alone once `Runtime`
  exists.

## Open Space = the current star system

**Open Space** is whatever star system the player is in right now — the scene
with `Runtime: open-space`.

- One system → one Open Space play surface.
- Every planet, moon, and `Runtime: station` body the System Map places in that
  system lives in that same host.
- Positions and distances are **1:1 with the System Map** (authored meters are
  play meters). Drag a station farther from its parent on the map and it is
  that far in orbit when you fly.

Ship boarding in and out of a station family uses dedicated markers on the
station body and hangar — see **Station boarding** below. That path does not
invent a second coordinate system; arrival always re-enters the same
`open-space` host at the station body's hangar mouth. On-foot Hab / Station /
Hangar hops stay in [Basic game loop](./game-loop).

**Leaving this star system for another** is not thruster, quantum, or
`scene-exit` — it is a **Warp Gate** on the Star Map. See **Warp Gate
(cross-system)** below and [Star Map](./star-map).

## Station boarding (ship ↔ hangar ↔ station)

Stations come in two flavors; **both** use the same boarding components:

| Flavor | Feel |
| --- | --- |
| **Open-air** | Pads / bay mouth exposed to space; ship approaches in the open. |
| **Closed** | Enclosed bay / docking tunnel; ship still crosses an enter volume, then is inside the hangar cell. |

The difference is art and collider layout on the `Runtime: station` body — not
a second travel system.

### Components

| Component | Lives on | Trigger | Destination |
| --- | --- | --- | --- |
| `enter-station` | Station body (`Runtime: station`), nested GameObject | Ship **flies through** the volume | That station family's **hangar instance** (`Runtime: hangar` / System Map `hangarSceneId`) |
| `scene-exit` | Hangar (and Hab / Station as today) | On foot, interact (or authored trigger) | Station concourse, Hab, etc. — **not** Open Space for hangar departure |
| `exit-hangar` | Hangar instance | Ship / player leaves the hangar for space | Open Space host, ship spawned at the owning station body's nested GameObject that has `hangar-open-space-exit` |
| `hangar-open-space-exit` | Station body (`Runtime: station`), nested GameObject at the bay mouth | Pose only — arrival / departure mouth | Local **+Z** = ship nose facing on spawn |

`hangar-open-space-exit` is **not** the teleporter. It is the **mouth pose** on
the giant-prefab station tree. `exit-hangar` is the hangar-side trigger that
resolves the owning station (System Map `hangarSceneId` → station entry →
station body) and places the ship at that nested marker in the Open Space host.

Do **not** use a hangar `scene-exit` targeting `@space` as the designed
departure path once `exit-hangar` exists. One exit primitive for hangar →
space.

```mermaid
flowchart LR
  OpenSpace[Open Space host]
  EnterSt["enter-station<br/>on station body"]
  Hangar[Hangar instance]
  Station[Station concourse]
  ExitHg["exit-hangar<br/>on hangar"]
  Mouth["hangar-open-space-exit<br/>nested on station body"]
  OpenSpace -->|"ship flies through"| EnterSt
  EnterSt --> Hangar
  Hangar -->|"scene-exit on foot"| Station
  Station -->|"AVMS / scene-exit"| Hangar
  Hangar --> ExitHg
  ExitHg --> Mouth
  Mouth --> OpenSpace
```

### Invariants (boarding)

- `enter-station` always lands in the **hangar instance**, never directly in
  the station concourse and never by “falling into” the station body as a
  world swap that drops the Open Space host.
- From the hangar, on-foot travel to the station uses **`scene-exit`** (existing
  portal rules).
- From the hangar back to space uses **`exit-hangar`** → owning station's
  nested `hangar-open-space-exit` pose in the Open Space host.
- Mouth marker stays authored on the **station** document (giant prefab), not
  on the hangar instance — hangar does not know ecliptic meters; the station
  body does.
- Open-air vs closed does not fork these component names or destinations.

## Real flight is legal — and absurdly slow

Because the layout is real scale, a player *can* point the nose at a distant
body and burn the whole way on thrusters alone. That is intentional and
allowed. It is also usually a terrible idea: star-system distances at 1:1 can
take on the order of **an hour** (or worse) of real wall-clock time.

That gap is why **quantum travel** exists. Quantum is the designed way to
cross interplanetary / long orbital ranges without abandoning the single
shared host or inventing a second teleporter stack.

| Mode | When | Cost |
| --- | --- | --- |
| Thruster flight (flight computer → Rapier) | Local maneuvre, approach, combat, scenic | Real time at ship speeds; see [Ship flight](./ship-flight) |
| Quantum travel | Distant planet / station / POI / Warp Gate **in this system** | Short travel sequence; same host, same meters |
| Warp Gate | Leave this Star System for another | Approach gate (thruster or quantum), then host swap to destination Star Map |

Quantum approaches the same ecliptic markers the Star Map authored. It does
**not** swap to a different system host, and it does **not** replace
`scene-exit` for Hab / Hangar / deep interior cells. Cross-system hops are
**Warp Gate only** — see below.

## Warp Gate (cross-system)

Warp Gates connect **Star Maps**. Full authorship law lives in
[Star Map / Star System](./star-map); this section is the Open Space play rule.

| Piece | Role |
| --- | --- |
| Warp Gate prefab | Placeable body on the Star Map (geometry + volumes). |
| `warp-gate` component | Names destination `targetSystemId` (and arrival gate when needed). |
| Approach | Pilot **flies** or **quantums** to the gate like any other ecliptic marker. |
| Trigger | Ship crosses / activates the gate volume → replace Open Space host with destination system's Star Map. |
| Arrival | Ship spawns **in-ship** at the destination map's arrival Warp Gate pose. |

```mermaid
flowchart LR
  HostA["Open Space host A"]
  Approach["Thruster or quantum<br/>to gate on Map A"]
  Gate["warp-gate trigger"]
  HostB["Open Space host B<br/>Star Map B"]
  HostA --> Approach --> Gate --> HostB
```

### What this rejects

- Quantum as an inter-system teleporter (quantum stays inside one Star Map).
- Boot / `game-manager.systemId` as the in-play travel path between systems
  (boot picks the *starting* system; Warp Gate changes system during play).
- A second long-range teleporter that bypasses Star Map placement.
- Merging two systems' bodies into one Open Space host for the hop.

## Distant bodies: culled mesh, visible blip

A system may hold many planets and station bodies. Rendering every body at
full fidelity from anywhere would destroy the frame budget. Distance policy:

1. **Cull from view / render** — far planets and `Runtime: station` bodies drop
   out of the visible mesh / render set. No distant hull sitting as a full
   scene-graph cost when the player is hours of flight away.
2. **Keep a pilot blip** — while the player is **piloting a ship** in Open
   Space, those same distant bodies still appear as **HUD / screen blips**
   (nav markers). The pilot always knows where system content lives even when
   the mesh is gone.
3. **Restore on approach** — when the ship closes to the body's activation
   range (quantum exit, thruster approach, or handoff threshold), the body
   streams / spawns back into the render set at its true ecliptic pose —
   still the same giant-prefab scene document, not a different world.
   **POIs** follow the same idea: the Star Map entry holds pose + assigned
   `prefabId`; on arrival Open Space loads that prefab (see
   [Star Map — POIs](./star-map#pois--map-marker--streamed-prefab)).

```mermaid
flowchart TD
  Pilot[Ship in Open Space host]
  Near["Near bodies<br/>full render + physics as needed"]
  Far["Far station / planet bodies<br/>culled from mesh"]
  Blip["Pilot HUD blips<br/>always for system bodies"]
  Pilot --> Near
  Pilot --> Far
  Far --> Blip
  Near --> Blip
```

On-foot inside `Runtime: hab` / `hangar` / a boarded station interior does not
need the full open-space blip set. Blips are an **in-ship Open Space**
navigation signal.

### Nav body blips vs Combat contact blips

Two HUD jobs — do not merge them into one undifferentiated blip list:

| Set | When | Shows |
| --- | --- | --- |
| **Nav body blips** | In-ship Open Space (any flight mode that needs system nav) | Star Map bodies — planets, stations, POIs, Warp Gates, waypoints — so the pilot can navigate when meshes are culled |
| **Combat contact blips** | **Combat** flight mode only | Other ships / threats in sensor–interest range — [Ship combat](./ship-combat) |

Nav blips are **world catalog** markers. Combat blips are **hostile / peer
contacts**. Combat mode may show both (nav faded or filterable; combat
emphasized) — it must not replace nav bodies with contacts only, and Traverse /
Nav must not arm the full combat contact HUD. Lead circles and lock brackets
belong to combat contacts, not to planet/station nav markers.

## Invariants

- Open Space ≡ the active System Map document's star system, one
  `Runtime: open-space` host.
- System Map meters = Open Space meters. No second scale, no fake compressed
  skybox distances for authored bodies.
- A station on the map is a scene with `Runtime: station` — authored like a
  scene, placed like a giant prefab into the Open Space host.
- Hab / Hangar are `Runtime: hab` / `hangar` ownership scenes, not ecliptic
  bodies. On-foot travel into Hab / Station uses `scene-exit` / AVMS; ship
  travel Open Space ↔ Hangar uses `enter-station` / `exit-hangar`.
- Thruster transit A → B is valid and slow; quantum is the practical bridge.
- Far bodies cull from rendering; they must still show as pilot **nav** blips in
  ship mode so navigation never depends on seeing the mesh. Combat **contact**
  blips are a separate HUD set — see Nav vs Combat blips above.
- Quantum and thruster both target the same ecliptic markers — quantum is
  speed, not a different world model.
- **Cross-system** hops use a Star Map **Warp Gate** (`warp-gate` → other
  `systemId`). Quantum does not leave the active system.
- Do not invent a second long-range teleporter that bypasses the Open Space
  host or Star Map placement.
- Do not reintroduce "stations are only prefabs" *or* "stations are only
  world-swap scenes" as competing truths. **Scene document + `Runtime`** is
  the law.
- Hangar → Open Space is `exit-hangar` → station nested `hangar-open-space-exit`,
  not a hangar `scene-exit` `@space` as the designed path.

## Shipped

- **Scene Settings `Runtime`** — `SceneDocument.runtime` in
  `src/world/scenes/schema.ts`, exposed on `ScenePlayConfig`, editable in Scene
  Settings beside (not instead of) `kind`. Documents authored before the field
  infer it once on read: menu kinds → `flow`, `main-game` → `open-space`, a
  player-scoped instance → `hangar` if it has pads else `hab`, anything else →
  `station`. New scene templates **Station Body** and **Hangar** start from the
  right runtime with the boarding markers already placed.
- **`exit-hangar` / `enter-station`** — schema, parsers, registry, inspector
  fields, viewport gizmos, and play triggers. `exit-hangar` bakes into the same
  station exit marker list as `scene-exit` (tagged `origin: 'exit-hangar'`) so
  the on-foot prompt and the ship crossing test stay in one place;
  `enter-station` gets its own marker list because its destination is resolved
  from System Map ownership at trigger time, not baked.
- A hangar `scene-exit` targeting `@space` still loads and still works, and now
  warns at bake time. It is legacy; new work uses `exit-hangar`.
- **Multi-body placement at 1:1** — `src/world/systems/placement.ts` is the one
  place System Map meters become play meters. The world origin is the active
  planet (the terrain, atmosphere and gravity stacks are built around one planet
  at the origin); every other body — the star, every other planet, every station
  regardless of parent — is placed at its true ecliptic offset from it. Nav,
  quantum, orbit frames and hangar mouths all read the same function, so no two
  of them can disagree about where a body is.

  Before this, `planetDestination` hard-coded every non-active planet to
  lat 0 / lon 0 / 250 km, stacking the whole system on top of the active planet,
  and `getSystemStationEntriesForPlanetDocument` filtered stations to the active
  planet's children so anything orbiting elsewhere never loaded at all.
- **Blips for every body.** `listNavDestinationMarkers` no longer drops
  non-active planets: far bodies leave the render set, so the blip is the only
  thing telling a pilot that system content exists out there.
- **Approach streaming** for station bodies (75 km synchronous backstop,
  activation radius deferred build) in `render/main/scene/secondary-stations.ts`.
  `BODY_ACTIVATION_RADIUS_METERS` in `placement.ts` states the radius once.

## Open / later (implementation, not design)

Design above is settled. Remaining work is product/engine detail:

- Ship-side arrival for `enter-station`: today the fly-through lands the player
  on foot in the hangar with the hull parked by the hangar's own delivery logic
  (same as AVMS To Hangar), and crossing the volume does not auto-assign a bay.
- Only the **active** planet renders as a body. Other planets are placed,
  blipped and quantum-targetable at their true positions, but arriving at one is
  still a handoff that swaps the terrain stack rather than two planets sharing a
  host. Multi-planet rendering needs the terrain/atmosphere/gravity stacks to
  stop assuming a single planet at the origin.
- The star is placed and named but never rendered as a body; sky lighting still
  comes from the environment stack rather than its map position.
- Current activation radii are starting values, not tuned: planet 2,000,000 m,
  station 220,000 m, star none (`BODY_ACTIVATION_RADIUS_METERS`).
- Blip UX (range rings, selection, quantum lock, threat filters).
- Quantum phases (spool, travel, drop-out) vs flight-computer ownership during the hop.
- Multiplayer: who sees whom during quantum; interest / cell sizing across
  system-scale distances — law in [Multiplayer](./multiplayer); implement
  without a second visibility channel.
- **Warp Gate** play path: `warp-gate` component, map placement, approach
  (thruster / quantum), Open Space host swap to `targetSystemId`, arrival at
  destination gate — design in [Star Map](./star-map); implementation open.
- Migration off legacy `stationPrefabId` map entries onto `Runtime: station`
  scenes.
- How inactive-planet stations re-enter the render set relative to planet
  handoff.
