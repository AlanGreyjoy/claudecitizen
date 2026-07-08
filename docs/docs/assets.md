---
sidebar_position: 5
title: Assets
description: Protected assets, Synty packs, and character avatars.
---

# Assets

## Optional protected assets

Some local development assets are not part of the open-source repo. Put paid or otherwise non-redistributable runtime assets under `editor/assets/protected/`; editor asset files are ignored by git by default. Use `editor/assets/free/` for local assets that are license-safe but still should not be committed automatically.

The Starhopper model is expected at:

```text
editor/assets/protected/ships/Phobos_Starhopper_Basic.glb
```

If it is missing, the game falls back to the tracked placeholder ship.

Production builds scan saved prefab JSON and copy only referenced files from `editor/assets/` into `dist/editor/assets/`. A prefab that uses one protected asset includes that asset in the web build; a local library of unused assets stays out of `dist/`.

Prefab JSON only references asset paths, so prefabs are safe to commit even when they point at protected files; public checkouts simply see missing-model placeholders.

## Importing Synty packs (e.g. POLYGON Sci-Fi Worlds)

1. Export the modular pieces you want from Unity as FBX, then convert to GLB — Blender (`File → Export → glTF 2.0`) or [`gltf-transform`](https://gltf-transform.dev/) both work. One piece per file keeps snapping simple.
2. Drop the GLBs under `editor/assets/protected/synty/sci-fi-worlds/{Buildings,Props,Environment,...}/`. Everything under `editor/assets/` is gitignored by default, exactly like the Starhopper.
3. Verify a file with `node scripts/inspect_glb.mjs <path>` if materials or hierarchy look off; the bake approach in `scripts/bake_ship_textures.py` is the template for fixing Unity trim-sheet materials that do not translate to Three.js PBR.
4. Refresh the editor's Project panel — the files appear under the `assets` root with generated thumbnails, ready to drag into a scene.

## Runtime character avatars

Skinned Unity character exports can live under `src/assets/protected/characters/`. The runtime keeps the tracked UAL mannequin as the default avatar; local exports can be selected explicitly while their skeleton and animation mapping is tested.

Try alternate exports with `?character=ual-mannequin`, `?character=space-suit-male`, `?character=soldier-male`, `?character=strider-male`, `?character=alien-armor`, `?character=alien-chef`, `?character=alien-combat`, or `?character=alien-rock`.

In the editor Project panel, open `protected/characters`, then use a model card's **Character** or **Anims** action to test a mesh against embedded clips or the built-in UAL clip source in the scene view's **Character Preview** tab.

Unity's Mecanim animator controller does not export to GLTF/GLB as a usable browser state machine. The game keeps the state machine in TypeScript (`Idle_Loop`, `Walk_Loop`, `Sprint_Loop`, jump phases) and retargets baked humanoid clips onto the Unity-style skeleton at load time. Export additional Unity animation clips as baked FBX/GLB clips, then add them to the character avatar catalog or map them onto the existing state names.
