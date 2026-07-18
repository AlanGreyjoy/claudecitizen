# System Map PRD

**Status:** Ready for phased implementation  
**Owner:** ClaudeCitizen engineering  
**Last updated:** 2026-07-17  
**Phases:** [01](./phases/01-system-document.md) · [02](./phases/02-editor-system-map.md) · [03](./phases/03-runtime-bodies.md) · [04](./phases/04-inship-system-map.md) · [05](./phases/05-quantum-to-bodies.md)  
**Checklist:** [CHECKLIST.md](./CHECKLIST.md)

## 1. Summary

ClaudeCitizen will gain a **System Map**: a single-star layout of planets and space stations that authors can arrange in the editor and pilots can use in flight for navigation and quantum travel.

Today, planet authoring describes terrain and atmosphere for one sphere at world origin. Stations are a single hardcoded orbital frame. Quantum travel only targets procedural surface POIs on the active planet. There is no place to put six planets relative to each other, no second station placement, and no in-ship map for “set route → jump blip → quantum.”

This PRD defines the product and architecture for System Map authoring and play, split into five implementation phases. **Phases 1–2 (data + editor) are the MVP.** Phases 3–5 wire runtime placement, in-ship UI, and quantum to system bodies.

## 2. Problem

Authors can create planet documents (`*.planet.json`) but cannot place those planets in a shared space. Stations exist as prefabs (`demo-station`, `blackmarketstation`) but only one is spawned, fixed at 200 km over the default spawn lat/lon. Pilots can quantum between surface sites on Asteron, but cannot route to another planet or to an authored station from a map.

Without a system layout:

- Adding five more planets does not create a universe — each remains an isolated `?planetId=` session.
- Station placement cannot be designed or iterated visually.
- The HaloBand (F2) is a personal device (comms / inventory / ship), not navigation.
- Star Citizen–style “open map → set route → find blip → quantum” has no data or UI to hang on.

## 3. Goals

1. Name the feature **System Map** (one star + bodies). Do not call it constellation, galaxy, or universe map in product UI.
2. Introduce a **`SystemDocument`** that references planet IDs and station prefab instances with positions on a flat ecliptic plane.
3. Provide a **dev editor System Map tab** to drag planets and stations, inspect them, save JSON under `src/world/systems/data/`.
4. Support **at least six planet slots** and **multiple station instances** (seed with Asteron + both existing station prefabs).
5. Keep **one active planet at a time** for simulation/render (origin-centered model). System positions drive authoring, nav UI, and quantum destinations — not simultaneous Earth-scale multi-planet LOD.
6. In play: open System Map → select a body → **Set Route** → close map → see a Nav-mode jump blip → align and quantum (extend existing quantum pipeline).
7. Replace hardcoded single-station placement with **system-document-driven station placement** over the course of phases 3+.
8. Respect AGENTS.md boundaries: domain in `world/`, no Three.js in domain modules, editor mirrors planet-authoring save patterns.

## 4. Non-goals

- Galaxy / multi-star / jump-point interstellar travel.
- Rendering six full Earth-scale planets in one continuous scene.
- True n-body gravity, elliptical orbital mechanics, or time-of-day synced orbits in v1.
- Authoring height (`y`) / out-of-ecliptic placement in v1 (flat `x`, `z` only).
- Replacing surface-site quantum POIs (they remain; system bodies are additional destinations).
- Reworking HaloBand into a full MobiGlas clone beyond adding a System Map surface.
- Backend multiplayer authority for system layout (client-authored JSON is enough for this feature).
- Minimap / radar redesign.

## 5. Locked decisions

| Decision | Choice |
| --- | --- |
| Name | **System Map** |
| Authoring space | Flat 2D ecliptic: `x`, `z` meters from star. Display may show AU. No `y` in v1. |
| Data owner | `SystemDocument` at `src/world/systems/data/<id>.system.json`. References `planetId` / `stationPrefabId`; does **not** embed planet recipes. |
| Multi-planet sim | One active planet at origin. Quantum to another planet **activates that planet document** (instance handoff). |
| Stations | System entries place station prefab instances. Placement = parent body (planet or star) + offset in system meters (and/or orbital altitude relative to parent when runtime places them). Seed: `demo-station` + `blackmarketstation`. |
| In-ship UX | System Map in HaloBand (new tab) or dedicated nav overlay → Set Route → Nav blip → quantum. Prefer HaloBand tab unless UX forces a fullscreen overlay. |
| MVP after this pack | Implement phases **1 → 2** first; then 3 → 5. |

## 6. Users and critical journeys

### Content author (editor, `npm run dev`)

1. Open Editor → **System Map** tab.
2. See the star at origin and bodies from the active system document.
3. Drag planets and station markers on the ecliptic plane; adjust inspector fields (name, parent, offsets).
4. Add a station instance pointing at an existing station prefab; remove unused instances.
5. Save → writes `src/world/systems/data/<id>.system.json`.
6. Optionally deep-link `?boot=editor&tab=system&systemId=…`.

### Pilot (play)

1. Board ship, leave atmosphere (or remain eligible per quantum rules as extended).
2. Open System Map (HaloBand **Map** tab or nav overlay).
3. Click a planet or station → **Set Route**.
4. Close the map; switch to **Nav** flight mode.
5. See a jump blip / POI marker for the route target.
6. Align and hold engage (existing U-hold quantum) → spool → travel → drop near station orbit or hand off to destination planet.

### Manual fly (stretch of journey, same data)

- Pilot may SCM-fly toward a marker without quantum; markers must exist in world/nav space once route is set (phase 5). Full continuous flight between distant planets is not required in v1 if quantum handoff is the primary long-range path.

## 7. Current baseline (do not rediscover)

| Fact | Detail |
| --- | --- |
| Planets | One committed planet: `asteron` (`src/world/planets/data/asteron.planet.json`). Schema in `src/world/planets/schema.ts`. No system position fields. |
| Planet editor | `src/editor/panels/planet_authoring.ts`; API `fetchPlanet` / `savePlanet` via `/__editor/planet(s)` in `vite.config.ts`. |
| Active planet | Module singleton `activatePlanetDocument` in `src/world/planets/runtime.ts`; play uses `?planetId=`. |
| Station | `getStationFrame(planet)` in `src/world/station.ts` — fixed lat/lon + `STATION_ALTITUDE_METERS` (200 km). Prefabs: `demo-station`, `blackmarketstation`. |
| Quantum | Surface POIs in `src/world/quantum_destinations.ts`; engage in `src/flight/quantum_travel.ts`; cyan diamond markers in Nav mode. Station is **not** a quantum destination today. |
| HaloBand | F2 — tabs: comms, missions, inventory, ship. No map. `src/render/effects/hud/haloband.ts`. |
| Roadmap | “Additional planets / moons” and “Quantum / long-range travel” still open in `docs/docs/roadmap.md` (quantum surface code already exists). |

## 8. Data model (sketch)

Domain types live under `src/world/systems/` (no Three.js, no DOM).

```ts
// Conceptual — finalize in phase 01 schema.ts
interface SystemDocument {
  id: string;                 // slug, e.g. "default"
  name: string;               // display, e.g. "Asteron System"
  star: {
    name: string;
    // Visual/authoring only in v1; star sits at (0,0)
  };
  planets: SystemPlanetEntry[];
  stations: SystemStationEntry[];
}

interface SystemPlanetEntry {
  id: string;                 // unique within system (often == planetId)
  planetId: string;           // references PlanetDocument.id
  name?: string;              // override display name; else planet name
  /** Ecliptic position in meters from star (y unused). */
  positionMeters: { x: number; z: number };
}

interface SystemStationEntry {
  id: string;                 // unique instance id within system
  stationPrefabId: string;    // e.g. "demo-station"
  name: string;
  /** Parent for orbital placement: "star" or a SystemPlanetEntry.id */
  parentBodyId: string;
  /** Offset from parent in system meters (ecliptic). */
  offsetMeters: { x: number; z: number };
  /** Optional altitude above parent surface/orbit when runtime places the station. */
  altitudeMeters?: number;
}
```

**Seed document (`default.system.json`):**

- Star: system primary.
- Planet: Asteron near a readable placeholder distance (author-tunable; not Earth AU scale required for gameplay).
- Stations: one instance of `demo-station` and one of `blackmarketstation`, parented to Asteron with distinct offsets so both are visible and draggable on the map.

**Scale guidance:** Prefer megameters or a documented “map meters” convention so six planets fit on a 2D canvas without microscopic dragging. Record the chosen unit and default distances in phase 01. Display AU as a label conversion only if helpful (`1 AU ≈ 1.496e11 m`).

## 9. Architecture constraints

```
math/ ← world/systems/ ← (flight quantum destinations, player world_state)
                ↑
         editor/panels/system_map.ts  (DOM + canvas/Three preview)
                ↑
         render/ (in-ship map HUD reads system doc; never owns layout truth)
```

- `world/systems/*` exports factories + pure parse/validate helpers (same spirit as `world/planets/`).
- Editor save/load mirrors planets: Vite `/__editor/systems`, `/__editor/system`, `editor/api.ts` helpers.
- Play loads system via `import.meta.glob` (production) + fresh DEV API when editing.
- Do not put system layout fields onto `PlanetDocument` — keep recipes and placement separated.
- Performance: System Map UI and editor canvas must not run unbounded work on the game render loop. Editor preview is idle until the System Map tab is active.

## 10. Product requirements

### 10.1 Authoring

- List / load / save system documents like planets.
- Visual 2D map with star, planets, stations; drag to move; selection + inspector.
- Planet entries pick from known planet documents; station entries pick from station-kind prefabs.
- Dirty state + leave confirmation (match Planet Authoring).
- Docs page: `docs/docs/cc-editor/system-map.md`.

### 10.2 Runtime placement (phase 3+)

- Active play session loads a system id (default `default`; URL `?systemId=` optional).
- Stations spawned according to system entries relative to the **active** planet (or deferred if parent planet is inactive — document behavior in phase 03).
- Hardcoded `getStationFrame` spawn-only altitude becomes driven by system data for authored stations.

### 10.3 In-ship System Map (phase 4)

- Pilot opens System Map from HaloBand (preferred) or a dedicated overlay.
- Shows bodies from the active system document (not live multi-body simulation).
- Select body → **Set Route** stores an active route target in flight/nav state.
- Closing the map restores flight controls; route persists until cleared or completed.

### 10.4 Quantum to bodies (phase 5)

- System planets and stations appear as quantum destinations when routed (and optionally as listable Nav markers).
- Station quantum drops the ship near the station hangar/approach volume (same Cartesian space as today when that station’s parent is the active planet).
- Planet quantum to a **non-active** planet performs activation handoff (load planet document, re-seed world instance, place ship in safe orbit/approach) — exact spawn rules defined in phase 05.
- Existing Asteron surface POIs remain available.
- Reuse phases/spool/VFX from `quantum_travel.ts` where possible; extend destination types rather than forking a second travel system.

## 11. Phased delivery

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| [01](./phases/01-system-document.md) | Schema, loader, editor API, seed JSON | — |
| [02](./phases/02-editor-system-map.md) | Editor System Map tab | 01 |
| [03](./phases/03-runtime-bodies.md) | Runtime reads system; station placement | 01 (02 recommended) |
| [04](./phases/04-inship-system-map.md) | In-ship map UI + Set Route | 01, 03 |
| [05](./phases/05-quantum-to-bodies.md) | Quantum + blips to system bodies | 04 |

## 12. Acceptance (product-level)

- [ ] Authors can place Asteron and additional planet entries on a 2D System Map and save a `*.system.json`.
- [ ] Authors can place both `demo-station` and `blackmarketstation` instances and move them independently.
- [ ] Play loads the system document; stations are not solely hardcoded to spawn-lat/lon + 200 km without system data.
- [ ] Pilot can open System Map, Set Route to a station or planet, see a Nav blip, and quantum (or complete planet handoff) using the extended quantum pipeline.
- [ ] Domain modules under `world/systems/` do not import `three` or DOM.
- [ ] `npm run lint` / `npm run typecheck` clean for touched code at end of each implementation phase (per AGENTS.md).

## 13. Open implementation notes (resolved in phase docs, not product forks)

- Exact default inter-planet distances and map unit scaling → phase 01.
- Whether inactive-parent stations are hidden vs shown as “offline” on the in-ship map → phase 04.
- Planet handoff loading UX (fade, hold screen, soft reload) → phase 05.
- HaloBand tab vs fullscreen overlay → phase 04 defaults to **HaloBand Map tab**; escalate to overlay only if the canvas needs more space.

## 14. References

- Planet authoring: `docs/docs/cc-editor/planet-authoring.md`, `src/world/planets/`
- Station frame: `src/world/station.ts`
- Quantum: `src/flight/quantum_travel.ts`, `src/world/quantum_destinations.ts`
- HaloBand: `src/render/effects/hud/haloband.ts`
- Conventions: `AGENTS.md`
