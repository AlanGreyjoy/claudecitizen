---
sidebar_position: 5
title: Assets
description: Project assets, protected packs, Synty imports, and character avatars.
---

# Assets

## Project-local assets

AsteronEngine loads and creates **projects**. Importable GLBs and textures live
in the open project under `assets/` (scaffold includes `free/` and
`protected/`). They are served at `/assets/...` while that project is open.

Put paid or otherwise non-redistributable packs under `assets/protected/`. Use
`assets/free/` for license-safe local packs. Keep protected packs out of git.

Example ship path inside a project:

```text
assets/protected/ships/Phobos_Starhopper_Basic.glb
```

If it is missing, the game falls back to the tracked placeholder ship.

**File → Build Web** scans saved prefab JSON and copies only referenced files
from the project's `assets/` into the release `dist/assets/`. Unused library
files stay out of the deploy.

Prefab JSON only references asset paths, so prefabs are safe to commit even when
they point at protected files; checkouts without those packs see missing-model
placeholders.

## Importing Synty packs (e.g. POLYGON Sci-Fi Worlds)

1. Export the modular pieces you want from Unity as FBX, then convert to GLB — Blender (`File → Export → glTF 2.0`) or [`gltf-transform`](https://gltf-transform.dev/) both work. One piece per file keeps snapping simple.
2. Drop the GLBs under the open project's `assets/protected/synty/sci-fi-worlds/{Buildings,Props,Environment,...}/`.
3. Verify a file with `node scripts/inspect_glb.mjs <path>` if materials or hierarchy look off; the bake approach in `scripts/bake_ship_textures.py` is the template for fixing Unity trim-sheet materials that do not translate to Three.js PBR. For BlackMarket’s Synty triplanar materials, re-run `python3 scripts/bake_blackmarket_textures.py [path/to/BlackMarket.glb]` after a fresh export.
4. Refresh the editor's Project panel — the files appear under the `assets` root with generated thumbnails, ready to drag into a scene.

## Runtime character avatars

Skinned Unity character exports can live under the project's
`src/assets/protected/characters/`. The runtime keeps the tracked UAL mannequin
as the default avatar; local exports can be selected explicitly while their
skeleton and animation mapping is tested.

Try alternate exports with `?character=ual-mannequin`, `?character=space-suit-male`, `?character=soldier-male`, `?character=strider-male`, `?character=alien-armor`, `?character=alien-chef`, `?character=alien-combat`, or `?character=alien-rock`.

In the editor Project panel, open `protected/animations`, then use a model card's **Anims** action to load clips into the **Base Characters** tab for retarget and controller authoring.

Unity's Mecanim animator controller does not export to GLTF/GLB as a usable browser state machine. The game keeps the state machine in TypeScript (`Idle_Loop`, `Walk_Loop`, `Sprint_Loop`, jump phases) and retargets baked humanoid clips onto the Unity-style skeleton at load time. Export additional Unity animation clips as baked FBX/GLB clips, then add them to the character avatar catalog or map them onto the existing state names.

### Rifle ADS locomotion

Rifle aim uses two animation layers only while the character is walking or running:

- The selected rifle walk or run clip drives the lower body.
- `idle_aiming` overrides the skeleton from `spine_01` upward.
- Idle ADS remains the normal full-body `idle_aiming` clip.

The split is an override mask, not an additive animation. Letting both the full gait and ADS clip write the spine and arms produces a blended, inaccurate weapon pose.
