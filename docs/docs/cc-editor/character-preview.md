---
sidebar_position: 10
title: Character preview
description: Preview skinned characters and animation retargeting in the CC Editor.
---

# Character preview

The **Character Preview** tab is a secondary scene view for inspecting skinned humanoid models and animation clips — separate from the main prefab viewport.

Open it from the center column tab bar, or from the Project panel on any GLB card.

## Opening a preview

| Action | Result |
| --- | --- |
| Project card → **Character** | Load the model as a skinned character |
| Project card → **Anims** | Load animation clips from that GLB as a retarget source |
| Tab → **Character Preview** | Switch to the preview panel (last loaded content persists) |

## What it does

The character previewer (`src/render/editor/character_previewer.ts`):

1. Loads the selected GLB via Three.js `GLTFLoader`
2. For characters — displays the skinned mesh with orbit camera
3. For animation sources — retargets clips onto a Unity humanoid rig when possible via `retargetUnityHumanoidAnimations`
4. Plays common loop clips (`Idle_Loop`, `Walk_Loop`, `Sprint_Loop`, `Jump_Loop`)

### Universal Animation Library

The previewer can load the bundled Universal Animation Library for retarget testing (`UNIVERSAL_ANIMATION_LIBRARY_URL` in `unity_humanoid_retarget.ts`).

## Use cases

- Verify Synty character packs load correctly before placing avatars in scenes
- Check animation retargeting from a new mocap or asset pack GLB
- Inspect skinned mesh bounds and proportions outside the main editor camera

## Synty multi-mesh bodies

Characters like `SM_Chr_ScifiWorlds_*` may contain multiple body mesh variants in one GLB. The previewer hides non-selected body meshes so only the intended variant renders.

## Not a prefab authoring surface

Character preview is **read-only inspection** — it does not write to your prefab document. Use it to validate assets, then drag models into the Scene tab to place them in the prefab hierarchy.

## Camera

Standard orbit controls on the preview canvas — LMB orbit, wheel zoom. No transform gizmo or entity hierarchy.

## Related

- [Assets and GLB](./assets-and-glb) — where character models live
- [Material manager](./material-manager) — tune character materials in the main scene after placement
