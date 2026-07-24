# Scene-First Unity Editor — PRD

**Status:** In progress  
**Owner:** AsteronEngine / editor + world  
**Last updated:** 2026-07-24  
**Phases:** [01](./phases/01-scene-document.md) · [02](./phases/02-editor-chrome.md) · [03](./phases/03-world-components.md) · [04](./phases/04-scene-runtime.md) · [05](./phases/05-prefab-instances.md) · [06](./phases/06-cleanup.md)  
**Checklist:** [CHECKLIST.md](./CHECKLIST.md)

## 1. Summary

Re-center AsteronEngine on a Unity-style model: a **Scene** is the root document (GameObject tree + Components). The open scene is what you edit and Play. Planet/system/spawn become components on GameObjects. Prefabs remain reusable assets opened via File → Open Prefab. Migrate with a strangler pattern so the game keeps running.

**MVP:** Phases 1–2 (author scenes with GameObjects in the viewport; Unity-style File menu).

## 2. Problem

- The 3D viewport was relabeled **Prefab**; **Scene Settings** became a form-only first tab with a “Scenes” list docked into Hierarchy.
- `SceneDocument` holds only startup settings — no entity tree — so there is no way to visually compose a scene.
- Play uses URL params (`boot`, `planetId`, `stationPrefab`); scenes are launch adapters, not content.

## 3. Goals

1. Scene documents own a GameObject tree (`gameObjects`), editable in the main viewport + Hierarchy.
2. Editor chrome is scene-first: File → New/Open Scene, New/Open Prefab, Scene → Settings; no Scene Settings tab.
3. World config is authorable as components (`game-manager`, `planet`, `player-start`, `prefab-instance`).
4. Play instantiates the open scene’s GameObject tree via `scene_runtime`.
5. Prefab instances resolve with transform/component overrides.
6. Dead boot/launch/tab paths are deleted after migration.

## 4. Non-goals

- Multi-station walkable Rapier worlds in one scene (Phase 4: one authoritative station).
- Full Unity Prefab Variant / nested override UI polish (Phase 5: functional instances).
- Replacing the Rust backend or WebTransport.
- Browser Vite as primary authoring surface.

## 5. Locked decisions

| Decision | Lock |
| --- | --- |
| Product model | Unity-style: Scene is root; Prefabs are reusable assets |
| Scene JSON | Reuse `PrefabEntity` shape for `gameObjects[]`; schemaVersion 2 |
| Prefab frame components | Stay prefab-only (not injected on scenes) |
| EditorStore | Shared tree; `documentType: 'scene' \| 'prefab'` |
| Persistence | Existing `/__editor/scene` + `.scene.json` |
| Runtime migration | Strangler: old URL routes until Phase 6 |
| Phase 4 physics | One authoritative station GameObject per scene |
| Engine name | AsteronEngine |

## 6. Users and critical journeys

- **Author:** New Scene → place GameObjects / prefab instances → set GameManager/Planet/PlayerStart → Save → Play.
- **Author (prefab):** File → Open Prefab → edit → Save; instantiate into scenes.
- **Player:** Play Mode loads the active scene’s content (not a bespoke boot route).

## 7. Current baseline

| Fact | Path |
| --- | --- |
| Settings-only SceneDocument | `src/world/scenes/schema.ts` |
| Entity editor is prefab-named | `src/editor/document.ts` `EditorDocumentState` |
| Serialize injects synthetic root + frames | `src/editor/serialize.ts` |
| Scene Settings tab + docked list | `EditorApp.tsx`, `scene_settings.ts` |
| Tabs: Scene Settings first, Prefab viewport | `src/editor/react/types.ts` |
| Launch adapter | `src/app/scene_launch.ts` |
| Boot URL dispatch | `src/app/bootstrap.ts` |
| Single station from system map | `src/app/play_session_world.ts` |

## 8. Data model (sketch)

```ts
// SceneDocument v2
{
  schemaVersion: 2,
  id: string,
  name: string,
  kind: SceneKind,           // kept for migration / screen kinds
  settings: SceneSettings,   // temporary until components fully own config
  gameObjects: PrefabEntity[]  // flat roots; no synthetic scene root
}
```

New components: `game-manager`, `planet`, `player-start`, `prefab-instance`.

## 9. Architecture constraints

- Domain in `world/`; no Three.js in `world/` or `scenes/scene_runtime` domain flatteners.
- Render via `prefab_renderer` / hangar-style instance groups.
- Frame budgets: async GLB loads; distance-bound secondary content.
- Editor: Electron only; do not start Vite.

## 10. Product requirements (by theme)

- **Authoring:** Scene = default document; Hierarchy = open document tree; File owns Open Scene / Open Prefab / Settings.
- **Components:** GameManager/Planet/PlayerStart/PrefabInstance authorable in Inspector.
- **Play:** Open scene saves then launches; runtime walks `gameObjects` and dispatches components.
- **Cleanup:** Title/loading/character-creator/sidekick become scenes; delete dead paths.

## 11. Phased delivery

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| 01 | Schema v2 + serialize + EditorStore | — |
| 02 | Scene-first chrome + File menus | 01 |
| 03 | World-config components + main-game scene | 01–02 |
| 04 | scene_runtime + Play open scene | 03 |
| 05 | Prefab instances + overrides | 04 |
| 06 | Migrate screens; delete dead code | 04–05 |

## 12. Acceptance

- [ ] New Scene opens empty viewport; Hierarchy shows scene roots (not a Scenes list).
- [ ] File → Open Scene / Open Prefab / Scene → Settings work; no Scene Settings tab.
- [ ] Scenes save/load `gameObjects` in `.scene.json`.
- [ ] Play runs the open scene via scene_runtime (strangler until Phase 6).
- [ ] Prefab instances resolve in editor and play.
- [ ] Old boot-only scene adapter and Scene Settings tab code removed.

## 13. Open implementation notes

- Phase 01 owns exact `parseSceneDocument` v1→v2 upgrade rules.
- Phase 04 owns how GameManager settings map into existing play_session_world.
- Multi-station physics deferred explicitly.

## 14. References

- Plan: Scene-First Unity Editor (attached conversation plan)
- `AGENTS.md`, `.cursor/rules/editor-first-migration.mdc`, `.cursor/rules/prefab-editor.mdc`
- Mirror pack: `prds/system-map/`
