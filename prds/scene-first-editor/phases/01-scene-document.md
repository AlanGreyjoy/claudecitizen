# Phase 01 — Scene document owns GameObject tree

**PRD:** [../PRD.md](../PRD.md)  
**Status:** In progress  
**Depends on:** —  
**Unlocks:** Phase 02

## Objective

Extend `SceneDocument` to own a GameObject tree, add scene serialize/load into `EditorStore`, and keep v1 settings-only scenes loadable.

## Key files

| Path | Action |
| --- | --- |
| `src/world/scenes/schema.ts` | **Extend** — schemaVersion 2, `gameObjects`, v1 upgrade |
| `src/editor/serialize.ts` | **Extend** — shared entity mappers + scene to/from |
| `src/editor/document.ts` | **Extend** — `documentType`, `newScene`, `setDocumentMeta` |

## Tasks

- [ ] Bump `SCENE_SCHEMA_VERSION` to 2; add `gameObjects: PrefabEntity[]`
- [ ] `parseSceneDocument` accepts v1 (upgrade to empty `gameObjects`) and v2
- [ ] Export shared entity JSON mappers; `toSceneDocument` / `fromSceneDocument` (no synthetic root / frames)
- [ ] `EditorDocumentState.documentType`; `newScene()`; generalize meta setters
- [ ] `npm run typecheck` + `npm run lint`

## Acceptance criteria

- [ ] Scenes round-trip GameObjects through serialize
- [ ] Existing v1 `.scene.json` still parse

## Out of scope

Editor chrome (02), new components (03), runtime (04).

## Implementation notes

Reuse `PrefabEntity` for scene roots. Prefab serialize keeps frame injection.
