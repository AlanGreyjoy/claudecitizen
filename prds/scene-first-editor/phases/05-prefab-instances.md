# Phase 05 — Prefab instances and overrides

**PRD:** [../PRD.md](../PRD.md)  
**Status:** Not started  
**Depends on:** Phase 04  
**Unlocks:** Phase 06

## Objective

Unity-style prefab instances: scene GameObjects with `prefab-instance` resolve content read-only under the instance root, with transform + component overrides.

## Key files

| Path | Action |
| --- | --- |
| Editor viewport / store | **Extend** — expand instance children for display |
| `src/world/scenes/scene_runtime.ts` | **Extend** — resolve instances |
| Hangar pattern | Mirror `src/render/hangar/prop_instances.ts` |

## Tasks

- [ ] Editor shows resolved prefab content under prefab-instance entities
- [ ] Runtime composes transforms and instantiates
- [ ] `npm run typecheck` + `npm run lint`

## Acceptance criteria

- [ ] Placing a station/ship/prop prefab-instance in a scene appears in viewport and Play

## Out of scope

Full Unity override UI / unpack / apply-all.
