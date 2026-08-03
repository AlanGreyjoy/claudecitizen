---
sidebar_position: 6.5
title: Game flow
description: The boot scene, the Game Manager pipeline, and how a player gets from launch to gameplay.
---

# Game flow

A game's entry pipeline is authored, not built in. One scene — the **boot
scene** — owns it, and everything from the login screen to the starting hab is a
field you set on its **Game Manager**.

```
Boot scene ──► Title ──► Character Create ──► Starting Hab ──► Open Space
(Game Manager  (auth UI) (no saved appearance)  (gameplay)     (fly a ship through
 + world                                                        a scene-exit)
 defaults)
```

## The boot scene

Create it with **File → New Scene → Boot**. It arrives with three GameObjects:

| GameObject | Why it is there |
| --- | --- |
| Game Manager | The pipeline: which scene is Title, Character Create, Starting Hab, Open Space |
| Planet | Default planet handed down to scenes that name none |
| Player Start | Default spawn mode handed down the same way |

Point **File → Project Settings → Boot Scene** at it. That id is what a shipped
release boots (`asteron.runtime.json`) and what **Play** runs in the editor.

A boot scene never runs gameplay itself. It resolves the next hop and hands off,
so it needs no station, no prefabs, and no geometry.

## Wiring the hops

Select the Game Manager and fill in the pipeline. Every field is a dropdown of
the project's scenes:

| Field | Points at | Leave empty to… |
| --- | --- | --- |
| **Title Scene** | A `title` scene holding only a `ui-screen` | Host the title UI on the boot scene itself |
| **Character Create Scene** | A `character-creator` scene | Use the inline character-create gate |
| **Starting Hab** | Where play begins, usually a per-player `instance` | Fall back to an authored `scene-link` |
| **Open Space Scene** | The MMO travel scene | Disable `@space` scene exits |
| **Loading Scene** | A `loading` scene shown between hops | Use the built-in loading overlay |
| **Require sign-in** | — | (unchecked) Run an offline / single-player flow |
| **Skip title when signed in** | — | (checked) Send returning players straight to their hab |

The scenes it points at should author **no Game Manager of their own**. Title and
Character Create are UI surfaces; keeping the flow in one document is what makes
it configurable rather than scattered.

## What the runtime does

On boot, with the flow in hand:

1. **Not signed in and sign-in is required** → load the Title Scene.
2. **Signed in, Skip title unchecked** → still show the Title Scene (it just
   won't block).
3. **No saved character appearance** → load the Character Create Scene.
4. **Otherwise** → load the Starting Hab.

A deep link into a specific scene outranks all of it: the player asked for a
place, and auth was only in the way — they land there after signing in.

If the backend cannot be reached, the flow falls through to the Starting Hab
rather than stranding the player on the title screen.

## Open space

Open space is an ordinary scene; what makes it reachable is a **Scene Exit** with
`trigger: fly-through` placed at a hangar mouth. Set its target scene to
**Open Space (Game Manager)** — that stores the token `@space`, which resolves
through the boot scene's Open Space Scene at runtime. A hangar authored that way
works in any project without knowing its open-space scene id.

Arrival pose comes from **station family ownership**, not a field on the exit.
Put a [Hangar Open Space Exit](./components/hangar-open-space-exit) on the Station
concourse scene, and on the [System Map](./system-map) set that station's
**Hangar scene** to the hangar you fly out of. Runtime looks up `hangarSceneId`
and spawns at that mouth instead of a generic orbit altitude.

Flying through the marker swaps both the scene and the authoritative cell
(`space:<systemId>`), and you arrive **still in the cockpit** rather than on
foot.

## Starting from scratch

1. **New Scene → Boot**, name it (e.g. `main-game`), save.
2. **New Scene → UI Screen** for the title, set its kind to `title` in
   **Scene Settings**, and delete the `scene-link` — the flow owns the hop now.
3. **New Scene** for character creation, kind `character-creator`.
4. **New Scene** for the starting hab, kind `instance`, add `instanced-scene`
   with scope `player`.
5. Back on the boot scene, point the Game Manager at all four.
6. **File → Project Settings → Boot Scene** → the boot scene.
7. Press **Play**.

New projects are scaffolded with exactly this set already wired.

## Upgrading an older project

Projects built before the boot scene put the Game Manager on the **Title** scene.
That still works — no migration is forced. To move to the new shape:

1. Add a `boot` scene (or change an existing empty scene's kind in **Scene Settings**).
2. Move the Game Manager, Planet and Player Start GameObjects onto it.
3. Set its **Title Scene** to your title scene, and leave the title scene with
   just its `ui-screen`.
4. Repoint **Project Settings → Boot Scene** at the boot scene.
