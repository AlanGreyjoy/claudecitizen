---
sidebar_position: 1
title: Decoded texture source release
description: WebGPU-unsafe ImageBitmap release after upload — currently forced off to stop black-screen crashes.
---

# Decoded texture source release

| | |
| --- | --- |
| Status | **Parked** — release path forced off |
| Severity | Correctness blocker if re-enabled as-is; memory cost while off |
| Code | `src/render/assets/texture-upload.ts` |
| Related | `src/cache/asset-residency.ts`, `src/render/assets/texture-dedup.ts`, `src/app/play-session.ts` |
| Found | 2026-08-03 (prod black hab / blackmarket after WebGPU post work) |
| When done | Move a short write-up into [Resolved](./resolved.md) and remove this page |

## Symptom

Prod play black-screens (HUD/FPS still run) with:

```text
TypeError: Cannot read properties of null (reading 'complete')
  at updateTexture (three.webgpu.js)
```

Stack often goes through sampled-texture binding `_update` → `Textures.updateTexture`. Auth `401` on `/auth/me` in the same console log is unrelated noise when the player already reached the scene.

## What we wanted

GLTFLoader leaves decoded `ImageBitmap`s in `texture.source.data` for the texture lifetime, so large atlases cost RAM **twice** (CPU decode + GPU upload). `queueSourceRelease` / `drainSourceReleases` uploaded via `renderer.initTexture`, then `bitmap.close()` and `texture.source.data = null` to free the CPU copy.

That was gated off under authoring (`AUTHORING_ENABLED`) because the editor runs several WebGPU renderers that each need the CPU source. It was enabled for shipped builds on the assumption of one play renderer.

## Why it is unsafe on WebGPU

WebGPU/TSL node materials re-enter `Textures.updateTexture` when a sampled-texture binding reports `updated`. That path does roughly:

```text
image === undefined  → warn
image.complete === false → warn
else → upload / update
```

`null` is neither `undefined` nor an object with `complete`, so Three throws. That can happen **in the same session** a few frames after the first drain — not only across scene switches.

Scene switches make a second failure mode: play tears down the `WebGPURenderer` and starts a new one. Cache hits that already nulled `source.data` cannot re-upload into the new backend.

A related AO bug (separate, already fixed) fed a remapped float depth node into GTAO/Denoise, which call `.sample(uv)` and need a TextureNode — see `src/render/main/post/webgpu-post-stack.ts` (`rawSceneDepth` vs remapped `sceneDepth`).

## Current mitigation

```ts
// src/render/assets/texture-upload.ts
const RELEASE_DECODED_TEXTURE_SOURCES = false;
```

Release code stays in tree but does nothing. Atlases keep CPU bitmaps while cached. Dedup still guards against non-uploadable canonicals as a belt-and-suspenders check.

**Trade-off:** higher CPU texture memory for large stations / shared Synty atlases until a safe release lands.

## Proper fixes to consider later

Pick when memory pressure shows up on low-RAM clients or huge concourses — not required for correctness while the flag is false.

1. **Release only on cache eviction**  
   Keep bitmaps for live templates; `close()` + null in `disposeCacheTemplate` / `releaseTextureOwner` when residency sweeps the URL. Simple. Still 2× for everything in the *current* scene for the whole session.

2. **Three-safe “source released” contract**  
   After upload, mark the texture so binding updates skip CPU re-read (or leave a tiny placeholder Three accepts without re-uploading real data). Needs careful testing against the pinned `three` version; Three may change this path.

3. **Long-lived play renderer**  
   Avoid dispose/recreate on every scene switch so GPU uploads survive. Larger architecture change; does **not** by itself fix mid-session binding re-touch after nulling `image`.

Do **not** re-enable `RELEASE_DECODED_TEXTURE_SOURCES` without one of the above and a hab → station → hab smoke pass on a shipped (non-authoring) build.

## Review checklist

- [ ] Confirm memory impact in prod (HUD / browser task manager on BlackMarket + hab)
- [ ] Choose approach 1 vs 2 (3 only if renderer lifetime is tackled for other reasons)
- [ ] Re-enable only behind `!AUTHORING_ENABLED` plus the chosen guard
- [ ] Smoke: cold hab load, hab → station, station → open space, quality presets with AO on
