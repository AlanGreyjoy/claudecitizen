# System Map — Master checklist

**PRD:** [PRD.md](./PRD.md) · **Index:** [README.md](./README.md)

## New chat prompt (paste this)

```
Implement the next unfinished phase of the ClaudeCitizen System Map feature.

Read these first (in order):
1. prds/system-map/README.md
2. prds/system-map/PRD.md
3. prds/system-map/CHECKLIST.md — find the first phase with open items
4. That phase file under prds/system-map/phases/

Follow AGENTS.md. Do not start dev servers. After multi-file work, run npm run lint (and npm run typecheck before any commit I request).

Locked decisions are in the PRD — do not reopen naming (System Map), flat x/z ecliptic, one active planet, or SystemDocument vs embedding planet recipes.

When you finish a phase, check off items in CHECKLIST.md and the phase file.
```

---

## Phase 01 — System document

Details: [phases/01-system-document.md](./phases/01-system-document.md)

- [x] `src/world/systems/schema.ts` — types, parse, defaults, coordinate comments
- [x] `src/world/systems/loader.ts` — glob + DEV load
- [x] `src/world/systems/runtime.ts` — activate / get active
- [x] `src/world/systems/data/default.system.json` — Asteron + demo-station + blackmarketstation
- [x] Vite `/__editor/systems` + `/__editor/system` GET/POST
- [x] `src/editor/api.ts` — fetchSystemList / fetchSystem / saveSystem
- [x] typecheck + lint clean

## Phase 02 — Editor System Map tab

Details: [phases/02-editor-system-map.md](./phases/02-editor-system-map.md)

- [x] `src/editor/panels/system_map.ts` — canvas + inspector
- [x] Wire tab in `editor_session.ts` (`tab=system`)
- [x] Drag planets / stations; save / dirty / leave guards
- [x] Add / remove station instances; planet entry dropdown
- [x] `docs/docs/cc-editor/system-map.md`
- [x] typecheck + lint clean

## Phase 03 — Runtime bodies

Details: [phases/03-runtime-bodies.md](./phases/03-runtime-bodies.md)

- [x] Play loads `?systemId=` (default `default`)
- [x] Activate system document in play bootstrap
- [x] Station placement driven by system entries (not spawn-only hardcoded frame)
- [x] Multi-station support (both instances, or documented interim)
- [x] Helpers for planets/stations by parent; inactive parents not spawned
- [x] typecheck + lint clean

## Phase 04 — In-ship System Map + Set Route

Details: [phases/04-inship-system-map.md](./phases/04-inship-system-map.md)

- [x] `NavRouteTarget` (or equivalent) in flight/player
- [x] HaloBand **Map** tab with system view
- [x] Select body → Set Route / Clear Route
- [x] Input suppress while open; route persists after close
- [x] Update `docs/docs/play.md`
- [x] typecheck + lint clean

## Phase 05 — Quantum to bodies + jump blips

Details: [phases/05-quantum-to-bodies.md](./phases/05-quantum-to-bodies.md)

- [x] Extend quantum destinations for system-station / system-planet
- [x] Nav blip for active route
- [x] Quantum to station near approach volume
- [x] Planet handoff quantum (activate destination planet)
- [x] Surface POIs still work
- [x] Update play docs (and roadmap checkboxes if desired)
- [x] typecheck + lint clean

---

## Product acceptance (from PRD)

- [x] Authors place planets + both stations on System Map and save `*.system.json`
- [x] Play uses system data for stations
- [x] Pilot: Map → Set Route → Nav blip → quantum / planet handoff
- [x] `world/systems/` has no Three.js or DOM imports
