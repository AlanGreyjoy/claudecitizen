---
sidebar_position: 6
title: Scene components
description: game-manager, planet, player-start, prefab-instance, ui-screen, scene-link, and instanced-scene.
---

# Scene components

Scene documents (`*.scene.json`, schema v3) are GameObject trees. These
components decide what a scene *is*. There is no separate `settings` block for
scene contents — v1/v2 docs migrate forward on read.

They only appear on **scene** documents (not prefabs).

## Recipes

| Goal | Components |
| --- | --- |
| Title / login / character-create / loading | `ui-screen` (+ optional `scene-link`) |
| Timed hop between menu scenes | `scene-link` with `auto` + `delaySeconds` |
| Playable world | `game-manager` + `planet` + `player-start` + `prefab-instance`(s) |
| Per-player hab / hangar | `instanced-scene` (+ usual play components) |

## `game-manager`

System, planet, and spawn mode for the scene.

| Field | Type | Notes |
| --- | --- | --- |
| `systemId` | string | System Map document id |
| `planetId` | string | Active planet terrain |
| `spawn` | `"station"` \| `"surface"` | Where play starts |

## `planet`

Planet document reference for the open scene.

| Field | Type | Notes |
| --- | --- | --- |
| `planetId` | string | Planet document id |

## `player-start`

Player spawn marker (pose comes from the entity transform).

| Field | Type | Notes |
| --- | --- | --- |
| `spawn` | `"station"` \| `"surface"` | Spawn mode |

## `prefab-instance`

Places a reusable prefab in the scene.

| Field | Type | Notes |
| --- | --- | --- |
| `prefabId` | string | Prefab document id (not path) |
| `prefabKind` | optional | `"station"` \| `"ship"` \| `"site"` \| `"prop"` \| `"item"` |

A scene's ship `prefab-instance` with `prefabKind: "ship"` is what Play flies —
break that link and Play falls back to the default hull.

## `ui-screen`

Full-screen UI the scene mounts instead of (or over) 3D play.

| Field | Type | Notes |
| --- | --- | --- |
| `screen` | enum | `title` \| `login` \| `character-create` \| `loading` \| `menu` |
| `menuId` | string? | Required when `screen` is `"menu"` — Menu Manager document id |

## `scene-link`

Navigation target: which scene this object sends the player to.

| Field | Type | Notes |
| --- | --- | --- |
| `sceneId` | string | Target scene id |
| `auto` | boolean? | Fire when the scene finishes loading |
| `delaySeconds` | number? | Delay before an automatic transition |

Scene switches happen **in-process** through `src/app/scene-host.ts` — never by
reloading the page.

## `instanced-scene`

Marks the scene as per-player instanced content (habs, hangars).

| Field | Type | Notes |
| --- | --- | --- |
| `scope` | enum | `player` \| `party` \| `shared` |

## Related

- [Building scenes](./building-scenes)
- [Menu Manager](./menu-manager)
- [Projects and settings](./projects-and-settings)
- [Preview and playtest](./preview-and-playtest)
