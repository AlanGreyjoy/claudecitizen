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
3. Verify a file with `node scripts/inspect_glb.mjs <path>` if materials or hierarchy look off; the bake approach in `scripts/bake_ship_textures.py` is the template for fixing Unity trim-sheet materials that do not translate to Three.js PBR. For BlackMarketStation’s Synty triplanar materials, re-run `python3 scripts/bake_blackmarket_textures.py` after a fresh export.
4. Refresh the editor's Project panel — the files appear under the `assets` root with generated thumbnails, ready to drag into a scene.

## Runtime character avatars

Skinned Unity character exports can live under `src/assets/protected/characters/`. The runtime keeps the tracked UAL mannequin as the default avatar; local exports can be selected explicitly while their skeleton and animation mapping is tested.

Try alternate exports with `?character=ual-mannequin`, `?character=space-suit-male`, `?character=soldier-male`, `?character=strider-male`, `?character=alien-armor`, `?character=alien-chef`, `?character=alien-combat`, or `?character=alien-rock`.

In the editor Project panel, open `protected/characters`, then use a model card's **Character** or **Anims** action to test a mesh against embedded clips or the built-in UAL clip source in the scene view's **Character Preview** tab.

Unity's Mecanim animator controller does not export to GLTF/GLB as a usable browser state machine. The game keeps the state machine in TypeScript (`Idle_Loop`, `Walk_Loop`, `Sprint_Loop`, jump phases) and retargets baked humanoid clips onto the Unity-style skeleton at load time. Export additional Unity animation clips as baked FBX/GLB clips, then add them to the character avatar catalog or map them onto the existing state names.

### Rifle ADS locomotion

Rifle aim uses two animation layers only while the character is walking or running:

- The selected rifle walk or run clip drives the lower body.
- `idle_aiming` overrides the skeleton from `spine_01` upward.
- Idle ADS remains the normal full-body `idle_aiming` clip.

The split is an override mask, not an additive animation. Letting both the full gait and ADS clip write the spine and arms produces a blended, inaccurate weapon pose.

While ADS is active, shared character locomotion turns the whole character toward the camera-forward aim direction, including while walking or running. Releasing RMB restores movement-facing. This character-root turn is separate from the skeleton-layer correction below and composes with it safely.

Sprint takes precedence over ADS. Once sprint locomotion is active, the aim pose and camera-facing lock stop, the normal full-body sprint clip plays, and the camera leaves ADS zoom. Holding RMB during the sprint does not restore ADS until the character stops sprinting. The drawn-weapon crosshair remains visible for hip fire.

There is one additional parent-space correction in `src/render/characters/sidekick/animation_runtime.ts`. The rifle locomotion GLBs animate root and pelvis orientations differently from `idle_aiming`. Without compensation, the upper layer inherits the gait's parent rotation and can point away from the authored aim direction. After the mixer runs, the runtime cancels the live gait-parent orientation at `spine_01` and replaces it with the sampled ADS parent orientation. The legs keep the complete gait, while the torso keeps the authored aim direction.

The correction follows the upper layer's fade weight. It is restored before the next mixer update because Three.js can skip writes for unchanged animation tracks; applying the correction repeatedly without restoring the authored pose would accumulate rotation. Full/lower mask switches also copy the active gait time so entering or leaving aim does not restart the foot cycle.

When debugging:

1. If only moving ADS is wrong, inspect the root and pelvis tracks in both the gait and `idle_aiming` GLBs before changing source yaw offsets.
2. If the full-body gait is also facing incorrectly, correct that clip's controller `yawOffsetDegrees`.
3. Verify walking and running RMB transitions independently, then verify that sprint enters its full-body clip and suppresses ADS presentation.
