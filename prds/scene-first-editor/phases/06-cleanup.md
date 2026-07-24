# Phase 06 — Migrate screens and delete dead paths

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phases 04–05  
**Unlocks:** —

## Objective

Move remaining screen kinds onto scenes where practical; delete Scene Settings tab code, launch-adapter-only role, and bespoke boot branches superseded by scene_runtime.

## Key files

| Path | Action |
| --- | --- |
| `src/app/bootstrap.ts` | **Trim** dead branches |
| `src/app/scene_launch.ts` | **Simplify** |
| `src/editor/panels/scene_settings.ts` | **Keep** only Open Scene / Settings modal helpers |
| `TabEditorHosts.tsx` / types | Confirm scene-settings tab gone |

## Tasks

- [ ] Ensure title/loading/character-creator/sidekick still launch via scene ids
- [ ] Delete unused scene-settings tab docking and dead launch paths
- [ ] Docs touch-ups for editor-first scene model
- [ ] `npm run typecheck` + `npm run lint`

## Acceptance criteria

- [ ] One primary Play pipeline: open scene → scene_runtime
- [ ] No Scene Settings tab remnants

## Out of scope

New screen content authoring beyond wiring.
