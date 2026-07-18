# Phase 05 — Quantum to system bodies + jump blips

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Complete  
**Depends on:** [Phase 04](./04-inship-system-map.md)  
**Unlocks:** End-to-end System Map travel loop

## Objective

Extend the existing quantum pipeline so a **Set Route** target (planet or station) produces a Nav-mode jump blip and supports quantum engage. Station routes drop near the station in the active planet’s Cartesian space. Planet routes to a different `planetId` perform an **activation handoff** (one active planet at a time). Keep existing surface POI quantum working.

## Key files touched

| Path | Action |
| --- | --- |
| `src/world/quantum_destinations.ts` | Extended with `kind`, orbital altitude, system body list |
| `src/flight/quantum_travel.ts` | Route preference, station approach, planet handoff pending id |
| `src/app/game_loop.ts` | Consume handoff → reload play with destination `planetId` |
| `docs/docs/play.md` | System Map → quantum flow |

## Tasks

### Destination model

- [x] `QuantumDestination.kind`: `surface-poi` | `system-station` | `system-planet`.
- [x] Station (active parent): world position from orbit hint + approach altitude.
- [x] Planet (same as active): block with `already-here`.
- [x] Planet (other id): handoff flag; travel VFX then session reload.
- [x] `listNavDestinationMarkers()` includes routed / local system stations + surface POIs.

### Engage rules

- [x] Reuse Nav mode, atmosphere check, alignment (stations), hold-U spool.
- [x] Station quantum uses Cartesian slerp path at orbital altitude.
- [x] Planet handoff: spool + travel, then `/?boot=play&planetId=…&systemId=…`.
- [x] Surface POI destinations and `asteron-op-1` preserved.

### Jump blips

- [x] Active route preferred by `resolveNavDestinationId`; Nav markers include system stations.

## Acceptance criteria

- [x] Quantum to an authored station works without breaking surface POI quantum.
- [x] Routed target shows as preferred Nav destination / blip.
- [x] Planet-to-planet handoff path implemented (gated on a second planet document existing).
- [x] Domain rules stay out of `render/`.
- [x] `npm run typecheck` passes.

## Implementation notes

- Destination ids: `sys-station:<instanceId>`, `sys-planet:<entryId>`.
- HaloBand Set Route stores instance/entry ids; quantum maps via `quantumDestinationIdFromNavRoute()`.
- Handoff skips alignment (no live body); reloads the play session rather than hot-swapping tile managers mid-frame.
