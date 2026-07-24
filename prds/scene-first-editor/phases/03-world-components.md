# Phase 03 — World config as components

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phases 01–02  
**Unlocks:** Phase 04

## Objective

Author planet/system/spawn as GameObject components and seed `main-game` with GameManager + Planet + station prefab-instance + PlayerStart.

## Key files

| Path | Action |
| --- | --- |
| `src/world/prefabs/schema.ts` | **Extend** — new component types |
| `src/world/prefabs/component_registry.ts` | **Extend** — defaults + palette |
| Inspector fields | **Extend** — component UI |
| `src/world/scenes/data/main-game.scene.json` | **Rewrite** — GameObjects |

## Tasks

- [ ] Add `game-manager`, `planet`, `player-start`, `prefab-instance`
- [ ] Registry + inspector fields
- [ ] Author default main-game scene as GameObjects
- [ ] `npm run typecheck` + `npm run lint`

## Acceptance criteria

- [ ] Components addable in Inspector on scene entities
- [ ] main-game.scene.json has gameObjects reproducing prior settings

## Out of scope

Runtime consumption (04), full prefab-instance expansion UI (05).
