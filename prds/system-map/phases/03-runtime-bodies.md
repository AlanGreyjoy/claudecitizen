# Phase 03 — Runtime bodies (consume system layout)

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Complete  
**Depends on:** [Phase 01](./01-system-document.md) (Phase 02 recommended)  
**Unlocks:** Phases 04–05

## Objective

Play sessions load an active `SystemDocument` and place **station instances from system data**, replacing the single hardcoded orbital frame path as the source of truth for authored stations. Keep **one active planet** at world origin; do not render multiple planet terrains.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/world/systems/runtime.ts` | Activate system alongside planet |
| `src/app/play_session.ts` | Load `?systemId=` (default `default`); activate system after planet |
| `src/world/station.ts` | Drive frame(s) from system station entries for the active planet |
| `src/player/world_state.ts` | Track active `systemId` / station instance id if needed |
| `src/app/bootstrap.ts` / URL params | Document `systemId` query param |
| Docs: play.md / system-map.md | Note runtime behavior |

## Tasks

### Session wiring

- [x] Resolve `systemId` from URL (`default` if omitted).
- [x] `loadSystemDocument` + `activateSystemDocument` during play bootstrap (with planet load).
- [x] Fail soft: if system missing, log warning and fall back to today’s single-station behavior once; prefer always shipping `default.system.json`.

### Station placement

- [x] For each `SystemStationEntry` whose `parentBodyId` resolves to the **active** planet entry, compute a world `StationFrame`:
  - **Locked approach for v1:** Map station `offsetMeters` on the system ecliptic to a stable orbital frame around the active planet: convert offset direction into a surface bearing + keep altitude from `altitudeMeters`.
- [x] Support **multiple** station frames / instances in play (primary walkable + secondary visual roots).
- [x] `?stationPrefab=` continues to select which prefab to enter initially; map it to a system station instance when possible.
- [x] `getStationFrameAt` / `setStationOrbitHint` / `orbitHintFromSystemOffset` generalize the old spawn-only path.

### Planet activation prep (no full handoff yet)

- [x] Export helpers: `listSystemPlanets(system)`, `getSystemStationEntriesForPlanet(system, planetEntryId)`.
- [x] Document that switching `planetId` re-binds which stations are local. Quantum planet handoff is phase 05.
- [x] Inactive-parent stations: do not spawn their interiors in the active session.

### Single-planet invariant

- [x] Confirm terrain/tiles/workers still see exactly one `activatePlanetDocument`.
- [x] System positions are **not** used to offset the planet mesh away from origin.

## Acceptance criteria

- [x] With `default.system.json`, play spawns both authored stations (primary walkable + secondary visual root).
- [x] Moving a station in the editor and reloading play changes its orbital placement.
- [x] `?systemId=` selects the system document.
- [x] No multi-planet terrain loaded.
- [x] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- In-ship System Map UI (phase 04).
- Quantum to stations/planets (phase 05).
- Simultaneous multi-planet rendering.
- Orbital animation / revolution over time.

## Implementation notes

- Primary station owns Rapier walk physics; additional system stations on the active planet are rendered via `SpikeRendererOptions.additionalStations` (visual roots only).
- Offset → orbit: `atan2(offset.x, offset.z)` added to `DEFAULT_SPAWN_SITE.lonRadians`; altitude from entry / 200 km default.
- Switching `planetId` later will change which system stations are considered local; planet handoff quantum is phase 05.
