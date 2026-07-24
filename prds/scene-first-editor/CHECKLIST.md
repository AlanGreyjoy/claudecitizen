# Scene-First Unity Editor — Checklist

## New chat prompt

```
Implement the Scene-First Unity Editor pack at prds/scene-first-editor/.

Read in order: README.md → PRD.md → CHECKLIST.md → the first incomplete phase under phases/.
Follow AGENTS.md and .cursor/rules/editor-first-migration.mdc.
Do not start Vite or other long-running dev servers.
Do not reopen locked decisions in PRD.md without user approval.
Work one phase at a time; check off items in the phase file and this checklist when done.
Run npm run typecheck and npm run lint before marking a phase complete.
```

## Phase checklists

### Phase 01 — Scene document
- [x] Scene schema v2 with `gameObjects`
- [x] `toSceneDocument` / `fromSceneDocument`
- [x] EditorStore `documentType` + `newScene`
- [x] typecheck + lint

### Phase 02 — Editor chrome
- [x] Remove Scene Settings tab
- [x] Viewport default = Scene
- [x] File → New/Open Scene, Open Prefab, Scene → Settings
- [x] Hierarchy always shows open document tree
- [x] typecheck + lint

### Phase 03 — World components
- [x] `game-manager`, `planet`, `player-start`, `prefab-instance` in schema + registry + inspector
- [x] Default `main-game` scene authored as GameObjects
- [x] typecheck + lint

### Phase 04 — Scene runtime
- [x] `scene_runtime.ts` walks gameObjects
- [x] Play open scene from editor + bootstrap path
- [x] typecheck + lint

### Phase 05 — Prefab instances
- [x] Editor resolves prefab-instance content
- [x] Runtime resolves instances with transforms
- [x] typecheck + lint

### Phase 06 — Cleanup
- [x] Screen scenes migrated
- [x] Dead boot/launch/tab code deleted
- [x] typecheck + lint

## Product acceptance

- [x] Scene-first edit + Play works Unity-style
- [x] Prefabs remain File → Open Prefab assets
- [x] No Scene Settings tab / docked Scenes list in Hierarchy
