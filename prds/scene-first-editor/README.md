# Scene-First Unity Editor — PRD pack

AsteronEngine becomes **scene-first**: a Scene is a tree of GameObjects with Components; the open scene is what you edit and Play. World config (planet, system, spawn) lives on components (GameManager, Planet, PlayerStart). Prefabs are reusable sub-trees opened via File → Open Prefab.

This folder is the handoff pack for implementation. A new chat should read these docs instead of rediscovering the prefab-first editor, launch-adapter scenes, and boot URL params.

## Recommended build order

1. **Phases 1–2** — schema + editor chrome MVP (scene owns GameObject tree; File menu Scene/Prefab). Ship before runtime.
2. **Phases 3–4** — world-config components + Play-the-open-scene runtime.
3. **Phases 5–6** — prefab instances + migrate remaining screens / delete dead paths.

## Files

| File | Role |
| --- | --- |
| [PRD.md](./PRD.md) | Product requirements, locked decisions, data model, acceptance |
| [CHECKLIST.md](./CHECKLIST.md) | Master checklist + pasteable new-chat prompt |
| [phases/01-scene-document.md](./phases/01-scene-document.md) | Scene schema v2 + serialize + EditorStore documentType |
| [phases/02-editor-chrome.md](./phases/02-editor-chrome.md) | Scene-first tabs/menus; Scene Settings modal |
| [phases/03-world-components.md](./phases/03-world-components.md) | game-manager / planet / player-start / prefab-instance |
| [phases/04-scene-runtime.md](./phases/04-scene-runtime.md) | scene_runtime + Play open scene |
| [phases/05-prefab-instances.md](./phases/05-prefab-instances.md) | Prefab instances with overrides |
| [phases/06-cleanup.md](./phases/06-cleanup.md) | Migrate screens; delete boot/launch dead paths |

## New chat

Paste the prompt block at the top of [CHECKLIST.md](./CHECKLIST.md). Work phases in order; mark checklist items as you go.

## Related code (today)

| Area | Path |
| --- | --- |
| EditorStore / entities | `src/editor/document.ts` |
| Prefab serialize | `src/editor/serialize.ts` |
| Prefab schema | `src/world/prefabs/schema.ts` |
| Scene schema (settings-only) | `src/world/scenes/schema.ts` |
| Scene loader | `src/world/scenes/loader.ts` |
| Scene settings panel | `src/editor/panels/scene_settings.ts` |
| Editor shell | `src/editor/react/EditorApp.tsx`, `Toolbar.tsx`, `types.ts` |
| Launch adapter | `src/app/scene_launch.ts` |
| Boot dispatch | `src/app/bootstrap.ts` |
| Play world load | `src/app/play_session_world.ts` |
| Prefab renderer | `src/render/prefabs/prefab_renderer.ts` |
| Station flatten | `src/world/prefabs/station_runtime.ts` |
| Electron persistence | `editor-desktop/repository.mjs` |
| Agent conventions | `AGENTS.md` |
