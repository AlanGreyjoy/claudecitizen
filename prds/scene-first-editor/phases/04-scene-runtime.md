# Phase 04 — Scene runtime: Play the open scene

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 03  
**Unlocks:** Phases 05–06

## Objective

Walk the scene GameObject tree at Play and dispatch components into existing planet/station/spawn systems. Keep old URL routes working (strangler).

## Key files

| Path | Action |
| --- | --- |
| `src/world/scenes/scene_runtime.ts` | **Add** |
| `src/app/bootstrap.ts` | **Wire** — scene play path |
| `src/app/scene_launch.ts` | **Extend** |
| `src/editor/react/EditorApp.tsx` | **Wire** — Play saves open scene |

## Tasks

- [ ] `scene_runtime` resolves GameManager/Planet/PlayerStart/prefab-instance + placed entities
- [ ] One authoritative station per scene for walk physics
- [ ] Editor Play → save scene → launch by id
- [ ] Parallel old URL routes
- [ ] `npm run typecheck` + `npm run lint`

## Acceptance criteria

- [ ] Play from editor with main-game scene loads planet + station content from scene GameObjects

## Out of scope

Multi-station physics; deleting old boot paths (06).
