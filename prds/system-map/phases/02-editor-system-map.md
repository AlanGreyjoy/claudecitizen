# Phase 02 — Editor System Map tab

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Complete  
**Depends on:** [Phase 01](./01-system-document.md)  
**Unlocks:** Comfortable authoring for phases 03–05; not a hard runtime dependency but strongly recommended first

## Objective

Add a **System Map** editor tab where authors drag planets and stations on a top-down ecliptic canvas, inspect/edit fields, and save the active `SystemDocument` — mirroring Planet Authoring UX patterns.

## Key files to add or touch

| Path | Action |
| --- | --- |
| `src/editor/panels/system_map.ts` | **Add** — panel factory (DOM + canvas/Three top-down view) |
| `src/editor/editor_session.ts` | **Wire** — new tab (`tab=system`), leave/dirty guards |
| `src/editor/styles.ts` | **Extend** — System Map layout classes |
| `src/editor/api.ts` | Use phase 01 helpers |
| `docs/docs/cc-editor/system-map.md` | **Add** — authoring docs |
| `docs/docs/intro.md` or cc-editor index | **Link** if there is a sidebar list of editor pages |

## Tasks

### Tab shell

- [x] Add **System Map** scene tab next to Planet Authoring / prefab editor tabs.
- [x] Deep link: `?boot=editor&tab=system&systemId=default`.
- [x] On activate: load system document; on deactivate: pause/dispose preview loop.
- [x] Dirty tracking + `canLeave` confirm (copy Planet Authoring leave prompt pattern).

### Canvas / map view

- [x] Top-down view of ecliptic (`x` horizontal, `z` vertical or depth — pick one and document in the panel).
- [x] Draw star at origin; planet markers; station markers (distinct shapes/colors).
- [x] Pan + zoom (mouse/wheel). Do not require free-fly 3D for v1.
- [x] Drag selected body to update `positionMeters` (planets) or `offsetMeters` (stations). While dragging stations, either move in parent-local offset space or convert world ecliptic ↔ parent offset consistently.
- [x] Click empty space clears selection; click body selects.
- [x] Performance: only run the preview rAF loop while the tab is active.

### Sidebar / inspector

- [x] System identity: id (readonly after create), name, star name.
- [x] List planets and stations; click list row = select.
- [x] Planet entry fields: `planetId` (dropdown from `fetchPlanetList`), display name override, `positionMeters.x/z` numeric fields.
- [x] Station entry fields: instance `id`, `name`, `stationPrefabId` (dropdown of station-kind prefabs), `parentBodyId`, `offsetMeters`, `altitudeMeters`.
- [x] Actions: **Add planet entry**, **Add station**, **Remove selected**, **Save**, optional **New system**.
- [x] Adding a planet entry should not create a planet document — only reference an existing one (or warn if missing).

### Docs

- [x] Write `docs/docs/cc-editor/system-map.md`: what a system is, coordinate plane, how to place planets/stations, save location, deep link, relationship to Planet Authoring and play (`systemId`).

## Acceptance criteria

- [x] Author can open System Map, move Asteron and both stations, Save, reload editor, and see positions persist.
- [x] Adding a second planet entry (once another `*.planet.json` exists) works via dropdown; without a second planet, UI still allows entries that reference future ids only if validation policy allows — prefer requiring existing planet ids.
- [x] Unsaved leave prompts.
- [x] No game/play regression; editor-only surface.
- [x] `npm run typecheck` and `npm run lint` pass for touched files.

## Out of scope

- In-ship / HaloBand map (phase 04).
- Changing `getStationFrame` play placement (phase 03).
- Quantum routing UI.

## Implementation notes

- Used a **2D canvas** (not Three.js) for the ecliptic map; screen X = system `x`, screen Y = −system `z` (+z up).
- Station markers draw a dashed line to their parent so offsets are understandable.
- Reused `el` / `clearChildren` from `src/editor/dom.ts`.
- rAF draw loop runs only while the tab is active.
