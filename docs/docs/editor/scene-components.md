---
sidebar_position: 6
title: Scene components
description: game-manager, planet, player-start, prefab-instance, ui-screen, scene-link, instanced-scene, and scene-exit.
---

# Scene components

Scene documents (`*.scene.json`, schema v3) are GameObject trees. These
components decide what a scene *is*. There is no separate `settings` block for
scene contents — v1/v2 docs migrate forward on read.

They only appear on **scene** documents (not prefabs), except `scene-exit`, which
also appears on station/site prefabs as a gameplay marker.

## Recipes

| Goal | Components |
| --- | --- |
| Game entry point | `kind: "boot"` + `game-manager` with the hops filled in |
| Auth surface | `kind: "title"` + `ui-screen` `title` — **no** `game-manager` |
| Timed hop between menu scenes | `scene-link` with `auto` + `delaySeconds` |
| Playable world | `planet` + `player-start` + `prefab-instance`(s) |
| Per-player hab / hangar | `kind: "instance"` + `instanced-scene` `scope: "player"` + `spawn-point` |
| Exit private hab to station scene | `scene-exit` (target scene id) |
| Fly out to open space | `scene-exit`, `trigger: "fly-through"`, target **Open Space (Game Manager)** |

## `game-manager`

The scene flow *and* the world defaults. On a **Boot** scene this component is
the entire game pipeline; nothing about the hop order is baked into the engine.

| Field | Type | Notes |
| --- | --- | --- |
| `systemId` | string | System Map document id |
| `planetId` | string | Active planet terrain |
| `spawn` | `"station"` \| `"surface"` | Where play starts |
| `titleSceneId` | string? | Auth surface. Empty: the boot scene hosts the title UI itself |
| `characterCreateSceneId` | string? | Character-creator scene when the player has no saved appearance. Empty: inline create gate |
| `startingSceneId` | string? | Hab / gameplay scene after auth (+ create). Wins over `scene-link` when set |
| `openSpaceSceneId` | string? | Scene a `@space` `scene-exit` opens |
| `loadingSceneId` | string? | Scene shown between hops. Empty: built-in loading overlay |
| `requireAuth` | boolean? | Unset means `true`. Off makes an offline / single-player flow |
| `skipTitleWhenSignedIn` | boolean? | Returning players with a live session bypass the title surface |

**The flow:** boot → Title (sign in) → Character Create when the player has no
appearance → Starting Hab. Every hop is optional; an empty field is skipped
rather than blocking. World knobs (`systemId` / `planetId` / `spawn`) carry into
the destination when that scene has no Game Manager of its own — which is why
Title and Character Create should author none.

Only one Game Manager should exist in a project's flow, on the boot scene. A
legacy project that put it on the Title scene still works, but new work should
move it.

:::caution
A boot scene with no `startingSceneId`, no `titleSceneId`, and no `scene-link`
has nowhere to go and logs an error naming the missing field. If Play shows a
black screen, check the console first.
:::

Private habs should be `kind: "instance"` with `instanced-scene` `scope: "player"`
so each citizen stays in their `apartment:` cell.

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

Navigation target: which scene this object sends the player to **from a menu
surface**. Not used for in-play F exits — use [`scene-exit`](./components/scene-exit)
for hab → station.

| Field | Type | Notes |
| --- | --- | --- |
| `sceneId` | string | Target scene id |
| `auto` | boolean? | Fire when the scene finishes loading |
| `delaySeconds` | number? | Delay before an automatic transition |

Scene switches happen **in-process** through `src/app/scene-host.ts` — never by
reloading the page.

## `instanced-scene`

Marks the scene as per-player (or shared) instanced content (habs, hangars).

| Field | Type | Notes |
| --- | --- | --- |
| `scope` | enum | `player` \| `party` \| `shared` |

`player` / `party` keep the citizen on their private apartment cell.
`shared` (or an `instance` scene with no `instanced-scene`) joins `scene:<id>`
so everyone in that scene shares one cell.

## `scene-exit`

In-play **F** portal that loads another scene document (for example private hab →
shared Black Market station). See [Scene Exit](./components/scene-exit).

| Field | Type | Notes |
| --- | --- | --- |
| `sceneId` | string | Target scene id |
| `prompt` | string? | HUD text when in range |
| `radius` | number? | Interact distance in meters |
| `networkInstanceId` | string? | Cell Transition before swap (default `station:public`) |
| `arrivalRoomId` | string? | Room id with the Transition (default `lobby`) |

## Related

- [Building scenes](./building-scenes)
- [Scene Exit](./components/scene-exit)
- [Station authoring](./station-authoring)
- [Menu Manager](./menu-manager)
- [Projects and settings](./projects-and-settings)
- [Preview and playtest](./preview-and-playtest)
