# Phase 02 — Scene-first editor chrome

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 01  
**Unlocks:** Phase 03

## Objective

Unity-style shell: main surface is the Scene viewport; Scene Settings and Open Scene live under File; Hierarchy shows the open document tree.

## Key files

| Path | Action |
| --- | --- |
| `src/editor/react/types.ts` | **Edit** — drop `scene-settings` tab |
| `src/editor/react/EditorApp.tsx` | **Edit** — default scene doc; save/load by documentType |
| `src/editor/react/panels/Toolbar.tsx` | **Edit** — File menus |
| `src/editor/react/TabEditorHosts.tsx` | **Edit** — drop scene-settings host |
| `src/editor/panels/scene_settings.ts` | **Repurpose** — Open Scene list + Settings modal |

## Tasks

- [ ] Remove Scene Settings from tab strip; label viewport Scene (dynamic Prefab when editing prefab)
- [ ] File → New Scene, Open Scene, New Prefab, Open Prefab, Scene → Settings
- [ ] Stop docking Scenes list into Hierarchy
- [ ] Wire save/load/new through `documentType`
- [ ] `npm run typecheck` + `npm run lint`

## Acceptance criteria

- [ ] Boot opens Scene viewport with Hierarchy of GameObjects
- [ ] No Scene Settings tab

## Out of scope

New component types (03), runtime Play (04).
