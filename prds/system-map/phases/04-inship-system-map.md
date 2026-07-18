# Phase 04 — In-ship System Map UI + Set Route

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Complete  
**Depends on:** [Phase 01](./01-system-document.md), [Phase 03](./03-runtime-bodies.md)  
**Unlocks:** Phase 05

## Objective

Give pilots a **System Map** surface in play (HaloBand **Map** tab by default) that shows bodies from the active system document, supports selection, and **Set Route** to store a navigation target for quantum (wired in phase 05).

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/render/effects/hud/haloband.ts` | Add `map` tab; host System Map panel |
| `src/render/effects/hud/system_map_panel.ts` | System Map HUD canvas |
| `src/flight/nav_route.ts` | Route state: active destination id + kind |
| `index.html` / `sc-ui.css` | Markup/styles for Map tab |
| `docs/docs/play.md` | Document F2 Map tab + Set Route |

## Tasks

### Route state (domain-friendly)

- [x] Define `NavRouteTarget`: `{ kind: 'system-planet' | 'system-station' | 'surface-poi'; id: string; label: string }`.
- [x] Store active route in `src/flight/nav_route.ts` (no DOM). Clear route API included.
- [x] Set Route from UI only writes this state; does not start quantum.

### HaloBand Map tab

- [x] Add tab id `map` alongside comms / missions / inventory / ship.
- [x] When Map is active, show a simplified top-down system view from `getActiveSystemDocument()`.
- [x] Click body → selection details (name, type, parent locality).
- [x] **Set Route** / **Clear Route**.
- [x] Bodies whose parent planet is not active: labeled as quantum handoff required.
- [x] Opening HaloBand suppresses ship input (`setInputSuppressed`).

### UX constraints

- [x] Map tab is one composition: system view + selection + Set Route.
- [x] Matches existing HaloBand / SC-UI language.
- [x] Map updates on open / tab select — not every game frame.

## Acceptance criteria

- [x] Pilot opens F2 → Map, sees Asteron + both stations from the active system.
- [x] Set Route stores a target readable from `getNavRoute()`.
- [x] Closing HaloBand leaves the route set.
- [x] No quantum travel changes required to pass this phase.
- [x] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- Quantum engage / spool to system bodies (phase 05).
- Editor System Map changes.
- Mission system integration.
