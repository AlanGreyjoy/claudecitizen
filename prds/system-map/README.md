# System Map — PRD pack

ClaudeCitizen needs a **System Map**: one star, multiple planets, and orbital stations placed relative to each other — authored in the editor, consumed in play for navigation and quantum travel (Star Citizen–style set-route → jump blip → quantum).

This folder is the handoff pack for implementation. A new chat should read these docs instead of rediscovering planet authoring, station placement, HaloBand, and quantum from scratch.

## Recommended build order

1. **Phases 1–2** — editor authoring MVP (schema + System Map tab). Ship this before runtime work.
2. **Phases 3–5** — play: place stations from the system doc, in-ship map UI, quantum to bodies.

## Files

| File | Role |
| --- | --- |
| [PRD.md](./PRD.md) | Product requirements, locked decisions, data model, acceptance |
| [CHECKLIST.md](./CHECKLIST.md) | Master checklist + pasteable new-chat prompt |
| [phases/01-system-document.md](./phases/01-system-document.md) | `SystemDocument` schema, loader, editor API, seed JSON |
| [phases/02-editor-system-map.md](./phases/02-editor-system-map.md) | Editor System Map tab (drag planets & stations) |
| [phases/03-runtime-bodies.md](./phases/03-runtime-bodies.md) | Runtime consumes layout; station placement; planet activation prep |
| [phases/04-inship-system-map.md](./phases/04-inship-system-map.md) | In-ship System Map UI + Set Route |
| [phases/05-quantum-to-bodies.md](./phases/05-quantum-to-bodies.md) | Quantum destinations for planets/stations + jump blips |

## New chat

Paste the prompt block at the top of [CHECKLIST.md](./CHECKLIST.md). Work phases in order; mark checklist items as you go.

## Related code (today)

| Area | Path |
| --- | --- |
| Planet documents | `src/world/planets/` |
| Planet Authoring editor | `src/editor/panels/planet_authoring.ts` |
| Station orbital frame | `src/world/station.ts` |
| Station prefabs | `src/world/prefabs/data/demo-station.prefab.json`, `blackmarketstation.prefab.json` |
| Quantum (surface POIs) | `src/flight/quantum_travel.ts`, `src/world/quantum_destinations.ts` |
| HaloBand (not a map yet) | `src/render/effects/hud/haloband.ts` |
| Agent conventions | `AGENTS.md` |
