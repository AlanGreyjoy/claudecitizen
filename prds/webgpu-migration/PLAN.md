# WebGPU migration

Migrate the renderer from `THREE.WebGLRenderer` to `THREE.WebGPURenderer`, rebuild the
post stack on TSL nodes, and open up GPU compute for the tile/vegetation workers.

Decision made 2026-07-29. Blockers previously raised and resolved by the owner:
`@takram/three-clouds` has no WebGPU build (we roll our own — it misbehaves today anyway),
and the `postprocessing` stack gets migrated rather than kept.

## Handoff state — read first

**None of this work is committed.** As of 2026-07-29 the entire working tree consists of
exactly these files, and nothing else:

| File | Git | What |
|---|---|---|
| `prds/webgpu-migration/PLAN.md` | untracked | this document |
| `scripts/webgpu_noise_spike.mjs` | untracked | compute spike driver (Electron) |
| `scripts/webgpu_noise_spike_entry.ts` | untracked | compute spike, browser side + WGSL |
| `src/render/webgpu-required.ts` | untracked | WebGPU enforcement, no-fallback |
| `editor-desktop/main.mjs` | modified | Stage 0 Chromium switches |
| `src/render/assets/ktx2.ts` | modified | accepts either renderer |
| `src/render/editor/viewport-scene.ts` | modified | `WebGPURenderer`, `ready`, LTC init |
| `src/render/editor/viewport-procedural-sky.ts` | modified | TSL port, `PMREMGenerator` swap |
| `src/render/editor/viewport.ts` | modified | render loop gates on `ready` |

So `git diff` plus those four untracked files *is* this migration, with no unrelated noise —
unusual for this repo and worth preserving. **Commit before handing off**, or a later agent may
not be able to tell this work from its own.

Other agents work this repo concurrently. Stage explicit paths, never `git add -A`, and do not
revert or clean files outside the list above.

Before starting, read `CLAUDE.md` (orientation, commands, validation policy) and `AGENTS.md`
(the authoritative architecture doc — especially the terrain mesh-vs-foot-placement invariant,
which is why terrain compute is deliberately excluded until after Stage 6).

## WebGPU is a hard requirement

Owner decision, 2026-07-29: **there is no WebGL fallback in the shipped product.** A machine
that cannot do WebGPU cannot run the editor or the game, by design.

Rationale: the compute paths this migration exists to unlock have no WebGL2 equivalent —
WebGL2 has no compute shaders at all. A silent degrade to WebGL2 would ship something that
looks functional while missing the thing that makes terrain and vegetation authoring fast, and
the resulting reports would be indistinguishable from real regressions. The owner measured a
large authoring-performance difference and accepts the compatibility cost.

Enforced in `src/render/webgpu-required.ts`. **Every renderer creation site must route through
it** — `WebGPURenderer` degrades by default and there is no constructor parameter that opts
out (details in that file, and under Gotchas).

Consequences that ripple through the rest of this document:

- Dual-backend portability is **no longer a constraint**. Raw WGSL is safe in material code,
  not just compute.
- `forceWebGL` is migration scaffolding only — a way to stage each surface — never a shipping
  configuration. It must not survive into a release build.

## The load-bearing fact

`three@0.180` ships `WebGPURenderer` with a **`forceWebGL` option** and a WebGL2 backend, and
TSL materials compile to *both* GLSL and WGSL. That makes the shader rewrite and the backend
flip separate steps per surface: move it to `WebGPURenderer` while still rendering through
WebGL2, confirm it looks right, then drop the flag.

There is never a state where nothing renders. This is a **migration technique, not a shipping
posture** — see the hard-requirement section above.

`WebGPURenderer.init()` is **async** and throws if called twice. It also carries an internal
`_getFallback` that degrades automatically when backend init fails; `webgpu-required.ts` strips
that. Threading the `await` through creation sites is the actual work of stage 1 — the type
change is trivial.

## Import strategy — verified, not assumed

`WebGPURenderer` lives in `three/webgpu`, which is a 1.8 MB bundle against `three`'s 589 KB.
The usual hazard is that importing both entry points gives you two copies of core three and
`instanceof` starts failing across the seam.

That does not happen here. Both `three.module.js` and `three.webgpu.js` import from the same
`./three.core.js`, and it checks out at runtime:

```
Mesh / Scene / Vector3 / Group / InstancedMesh / BufferGeometry / Texture / PerspectiveCamera
  -> all SHARED (===) across 'three' and 'three/webgpu'
cross-module instanceof holds : true
WebGPURenderer in 'three'     : undefined   (only in 'three/webgpu')
```

So **the 133 files importing bare `'three'` stay as they are.** Only files that actually need
`WebGPURenderer` or TSL switch to `three/webgpu`. Stage 1's blast radius is 17 files, not 133.

Vite dedupes it too — confirmed, see "Vite dedupe" under Gotchas. No `resolve.dedupe` entry
for `three` is needed.

## The one coupling that sets the order

`postprocessing`'s `EffectComposer` takes a `WebGLRenderer` and will not accept a
`WebGPURenderer`, even on the WebGL backend. Renderer and post stack cannot be separated.

But only **4 of 17** renderer surfaces touch the composer:

- `src/render/main/scene/composer-stack.ts`
- `src/render/effects/clouds/volumetric.ts`
- `src/app/ship_sandbox/scene.ts`
- `src/app/ship_sandbox/types.ts`

The other 13 are composer-free — every editor viewport, thumbnail, and preview surface.
Those migrate first, proving the renderer swap and the TSL material path against real
assets with zero post-stack risk.

## Effect inventory

Most of the stack is off-the-shelf in three 0.180. Corrects an earlier, more pessimistic
estimate that assumed the whole post stack was bespoke work.

| Current | Replacement | Where |
|---|---|---|
| `N8AOPostPass` (`n8ao`) | `GTAONode` | `three/examples/jsm/tsl/display/GTAONode.js` |
| `BloomEffect` | `BloomNode` | three addon |
| `SMAAEffect` | `SMAANode` | three addon |
| `ToneMappingEffect` (AgX) | `AgXToneMapping` | three core |
| `MotionBlurEffect` (161 ln) | `MotionBlur` node, or hand port | three addon |
| takram atmosphere | `@takram/three-atmosphere/webgpu` | already installed |
| `VolumetricFogEffect` (183 ln) | hand port to TSL | ours |
| `SpeedBlurEffect` (51 ln) | hand port to TSL | ours |
| `ColorCorrectionEffect` (94 ln) | hand port, or `Lut3DNode` | ours |
| `VignetteEffect` | hand port (~10 ln TSL) | trivial |
| takram clouds (457 ln consumer) | roll our own | owner's call |

## Shader language policy

**Materials in TSL. Compute in hand-written WGSL.**

TSL is not optional for materials, but the reason is narrower than it looks: `WebGPURenderer`
only consumes node materials, and there is no way to hand it a raw shader and still get lights,
shadows, and fog wired up. That is a `NodeMaterial` integration constraint.

It is **not** a portability constraint. An earlier revision of this document argued for TSL on
the grounds that it emits both GLSL and WGSL, keeping a WebGL fallback viable. The
hard-requirement decision voids that argument entirely — nothing needs to run on WebGL2, so
`wgslFn` / `wgsl` (exported from `three/tsl`) are now **safe in material code**, not only in
compute. Reach for them wherever TSL is awkward or you want exact control over generated code;
there is no portability tax to pay.

Compute stays hand-written WGSL. WebGL2 has no compute at all, and exact numeric control
matters: `scripts/webgpu_noise_spike_entry.ts` hand-writes it because f32-vs-f64 agreement was
the question being measured, and TSL codegen would have obscured it.

## Progress

Current state: **Stage 1 first increment and Stage 2 both verified on the WebGPU backend.
WebGPU enforcement landed. Stages 3-6 not started.**

The editor viewport runs on the **WebGPU backend** with the WebGL fallback stripped. Every
other surface, including the whole game runtime, is still on `WebGLRenderer` — so enforcement
currently covers the editor viewport only. The game gets it at Stage 6.

- **Stage 0 — done.** `editor-desktop/main.mjs` sets `enable-unsafe-webgpu` +
  `enable-features=Vulkan` before `app.whenReady()`. Verified in the running editor:
  `requestAdapter()` reports `nvidia` / `ampere`.
- **Stage 1 — main editor viewport only.** Files:
  - `src/render/editor/viewport-scene.ts` — `WebGPURenderer`, exposes `ready: Promise<void>`,
    routes through `initRequiredWebGpu`, calls `ensureNodeRectAreaLights()` (see Gotchas)
  - `src/render/editor/viewport-procedural-sky.ts` — `ShaderMaterial` → TSL `NodeMaterial`,
    plus the `three/webgpu` `PMREMGenerator` swap (see Gotchas)
  - `src/render/editor/viewport.ts` — render loop gates on `ready`, logs and stays blank on
    rejection
  - `src/render/assets/ktx2.ts` — accepts either renderer; detection moved after `init()`
  - `editor-desktop/main.mjs` — the Stage 0 switches
- **Stage 2 — viewport only, verified.** `forceWebGL` removed; viewport confirmed rendering.
- **Enforcement — done.** `src/render/webgpu-required.ts`, new. Success path exercised; failure
  paths never have been (see below).

  `npm run typecheck` 0 errors repo-wide. `npm run lint` clean on all touched files.

### How enforcement works

`src/render/webgpu-required.ts` is the only sanctioned way to bring up a renderer. Three parts:

1. `assertWebGpuAvailable()` — pre-flight, before any renderer exists. Checks `navigator.gpu`,
   then that `requestAdapter()` actually yields an adapter, then rejects explicit software
   adapters (`swiftshader` / `llvmpipe` in `adapter.info.architecture`). Callable standalone,
   which is the intended entry point for a boot gate.
2. `disableWebGlFallback(renderer)` — nulls the private `renderer._getFallback`. **This must
   happen after construction**: `WebGPURenderer`'s constructor assigns `parameters.getFallback`
   itself whenever `forceWebGL` is falsy, overwriting anything the caller passes, so no
   constructor parameter can opt out. `Renderer.init()` branches on
   `this._getFallback !== null`, so nulling it makes init reject with the real device error.
3. `initRequiredWebGpu(renderer)` — the two above plus `init()`, normalizing every failure to
   `WebGpuUnavailableError` with a `reason` of `no-api` | `no-adapter` | `software-adapter` |
   `device-init-failed`.

Reaching into `_getFallback` is a private-field dependency, taken deliberately because there is
no public alternative. It is guarded: if a three upgrade renames the field,
`disableWebGlFallback` **throws** rather than silently restoring the fallback. Failing loudly
beats shipping a WebGL2 build believed to be WebGPU. Re-check it on every three version bump.

### Verified by the owner

Twice, in two configurations.

**On the WebGL2 backend** (`forceWebGL: true`, before Stage 2): viewport rendered and the
procedural sky toggled cleanly.

**On the WebGPU backend** (after Stage 2, fallback stripped): scene view renders, and both the
light and sky toggles work.

The second run is the stronger evidence, and it is load-bearing: because `webgpu-required.ts`
strips three's automatic WebGL2 fallback, a WebGPU failure can only produce a rejected `ready`
promise — blank viewport plus `[viewport] WebGPU unavailable` in the console. **It rendered,
therefore it is genuinely on WebGPU.** No silent-degrade ambiguity is possible.

Together that confirms:

- the `ShaderMaterial` → TSL `NodeMaterial` port, on both backends
- the `three/webgpu` `PMREMGenerator` env bake
- `RectAreaLightNode.setLTC()` covering the node lighting path
- `disableWebGlFallback` not breaking the success path (the `_getFallback` private-field poke
  works against three 0.180)
- `WebGPURenderer` driving a real editor scene with real project content, on Vulkan via Dawn

Two crashes preceded the first result — `LTC_FLOAT_1` on null, then PMREM `reading 'buffers'` —
both found by the owner running the editor and reporting the stack trace. Both are written up
under Gotchas.

### Still not verified

- **Every enforcement failure path.** Nobody has seen `WebGpuUnavailableError` fire. It cannot
  be triggered on the owner's machine, where WebGPU works. `no-api`, `no-adapter`,
  `software-adapter`, and `device-init-failed` are all untested, as is the guard that throws if
  three renames `_getFallback`. Cheapest way to exercise them: temporarily launch the editor
  *without* the Stage 0 Chromium switches and confirm a clean `no-adapter` error instead of a
  crash or a silent WebGL2 fallback.
- A full `vite build --mode editor`. Only dev-server builds have ever run.
- Whether the cloud *pattern* matches the original. The fbm domain-warp matrix was rewritten
  from a column-major GLSL `mat2` literal into explicit `vec2` math; a transposed rotation
  would still look like plausible clouds, just different ones. Low stakes, easy to miss.

Remaining Stage 1 surfaces — `thumbnails.ts`, `material-preview.ts`,
`planet-preview-controller.ts`, `base-character-equipment-stage.ts`,
`characters/sidekick/preview-stage.ts`, `item-prefab-screenshot.ts`,
`BaseCharactersPanel.tsx`, `render-spike-frame.ts` — are untouched, still on
`WebGLRenderer`, independent, and compile fine. The editor is in a working mixed state.

### Next action

The risky part is done: one surface is fully migrated, verified on the real backend, with
enforcement in place. Everything after this is repetition of a proven pattern.

Pick up with the **eight remaining Stage 1 surfaces** — `thumbnails.ts`,
`material-preview.ts`, `planet-preview-controller.ts`, `base-character-equipment-stage.ts`,
`characters/sidekick/preview-stage.ts`, `item-prefab-screenshot.ts`, `BaseCharactersPanel.tsx`,
`render-spike-frame.ts`. All composer-free, all independent. For each: swap to
`WebGPURenderer`, route through `initRequiredWebGpu`, thread the async init, and port any
`ShaderMaterial` it renders in the same increment (never ahead of it).

`viewport-scene.ts` is the worked reference — copy its shape rather than re-deriving it.

Two things worth doing before grinding through all eight:

1. **Exercise one enforcement failure path** (see "Still not verified"). It is the only
   completely untested code in the migration, and it is the thing that decides whether an
   unsupported machine gets a clear message or a mystery.
2. **The user-facing boot gate** (see Follow-up). Needed before any external playtest.

Residual backend differences to keep an eye on as more surfaces move: shadow acne or missing
shadows (`PCFSoftShadowMap` maps differently across backends), depth-precision artifacts on the
400-unit grid, and `depthTest: false` backdrops compositing correctly.

## Stages

Each stage ends in a verifiable state. Do not start the next until the current one renders
correctly.

### Stage 0 — Enable WebGPU in Electron
`editor-desktop/main.mjs`: `enable-unsafe-webgpu` + `enable-features=Vulkan`, before
`app.whenReady()`. Chromium gates WebGPU on Linux behind Vulkan, and `chrome://flags` does
not carry into Electron. Two lines. Nothing else can be tested without it.

### Stage 1 — Editor surfaces onto `WebGPURenderer({ forceWebGL: true })`
The 13 composer-free files. Includes threading `await renderer.init()` through creation
sites and porting `viewport-procedural-sky.ts`'s `ShaderMaterial` to TSL.

**Correction to an earlier assumption: output will _not_ be pixel-identical.** From three's
own source, on `Renderer._getFrameBufferTarget`:

> *"Unlike in `WebGLRenderer`, this is done in a separate render pass and not inline to
> achieve more correct results."*

Tone mapping and output color space conversion move from inline-in-each-shader to a separate
output pass. Expect a slight grade shift even on the WebGL2 backend. The stage-1 bar is
therefore **visually equivalent, no structural regressions** — not bit equality. Do not chase
a small global exposure/chroma difference as a bug; do investigate anything localized,
banded, or geometry-dependent.

Three concrete consequences, all confirmed by reading `node_modules/three`:

1. **`render()` before init degrades noisily.** It logs
   `".render() called before the backend is initialized. Try using .renderAsync() instead."`
   and delegates to `renderAsync()`. Functional, but it warns per frame — so creation sites
   must `await renderer.init()` explicitly rather than lean on the fallback.

2. **`setKtx2SupportRenderer` ordering has to change.** `KTX2Loader.detectSupport` branches on
   `renderer.isWebGPURenderer` and uses the *synchronous* `renderer.hasFeature(...)`, which
   needs an initialized backend. Today `src/render/assets/ktx2.ts` is called immediately after
   construction. Either move the call after `await renderer.init()`, or switch to
   `detectSupportAsync` (which uses `hasFeatureAsync` and is safe pre-init).
   The throwaway probe in `detectSupportWithProbeRenderer` can stay a `WebGLRenderer` — it
   only reads format capability off the same GPU, and it is a fallback path.

3. **The sky shader's tail includes get deleted, not ported.**
   `viewport-procedural-sky.ts` ends its fragment shader with
   `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`. Those are
   `WebGLRenderer` chunks; under `WebGPURenderer` the output pass already does this work, so
   keeping them would double-apply the grade.

`ShaderMaterial` with raw GLSL is not supported by `WebGPURenderer` — the node system needs a
`NodeMaterial`, and there is no runtime GLSL-to-WGSL path (`three/examples/jsm/transpiler/`
is an offline authoring tool). So a `ShaderMaterial` port is never deferrable: it has to land
in the same increment as the surface that renders it, or that surface ships broken.

This shapes Stage 3's granularity — each of the nine sites must migrate together with whatever
renders it, not ahead of it.

### Stage 2 — Flip editor surfaces to the WebGPU backend
Drop `forceWebGL` for editor surfaces only, and route each through `initRequiredWebGpu`. First
real WebGPU rendering in the product. Game runtime still on WebGL throughout.

### Stage 3 — Port the remaining `ShaderMaterial` sites to TSL `NodeMaterial`
Nine sites. Each verifiable independently, and — since nothing needs to run on WebGL2 — free to
use `wgslFn` / `wgsl` wherever TSL is awkward.

- `src/render/planet_tiles/render/terrain-material.ts`
- `src/render/vegetation/render/wind.ts`
- `src/render/effects/lake_water/render/material.ts`
- `src/render/effects/stars/field.ts`
- `src/render/effects/clouds/shell.ts`
- `src/render/particles/material.ts`
- `src/render/particles/system-render.ts`
- `src/render/effects/quantum-bubble.ts`
- `src/render/editor/viewport-procedural-sky.ts` (lands in stage 1)

### Stage 4 — Rebuild the game post stack on `THREE.PostProcessing`
Replace `composer-stack.ts` (236 ln) per the inventory above. Swap takram atmosphere to its
`/webgpu` entry. This is where `postprocessing` and `n8ao` leave `package.json`.

### Stage 5 — Volumetric clouds, own implementation
Replaces `@takram/three-clouds`. Largest single unknown in the migration; sequenced late so
everything else is already stable.

### Stage 6 — Flip the game runtime, then compute
Remove `forceWebGL` everywhere and route `src/render/main/scene/webgl-renderer.ts` through
`initRequiredWebGpu` — that file is the game's single renderer factory
(`createWebGlRenderer`, one consumer at `src/render/main/manager.ts:153`), so enforcement lands
in one place. It also needs `RectAreaLightNode.setLTC()`; see Gotchas.

Rename that module while you are in it — `webgl-renderer.ts` becomes a lie.

Then land the compute work the spike already validated.

### Follow-up (not stage-ordered) — user-facing boot gate

Enforcement currently fails correctly but unfriendlily: an unsupported machine gets a blank
viewport plus a console error. A real "this machine cannot run the engine" screen belongs at the
**app layer**, not in `src/render/` — the editor boot path and the game boot path each need one.

`assertWebGpuAvailable()` is the entry point, and `WebGpuUnavailableError.reason` exists so the
screen can distinguish "enable these Chrome flags" (`no-adapter` on Linux) from "your hardware
cannot do this" (`no-api`) from "you are on a software rasterizer" (`software-adapter`).

Do this before any external playtest. It is currently the weakest part of the hard-requirement
decision: the policy is enforced, the explanation is not.

## Compute, already measured

`scripts/webgpu_noise_spike.mjs` ported the simplex/fbm climate kernel
(`src/world/terrain-noise.ts`, as called at `climate.ts:181-194`) to WGSL and measured it on
an RTX 3080 Ti:

- Permutation table reproduces the engine's `getNoise3D` **exactly** (max delta 0).
- CPU f64 vs GPU f32 agreement: max |d| ~1e-6, mean ~1e-7 — f32 epsilon.
- 1M samples: CPU 531 ms, GPU kernel 0.19 ms, wall including readback 11 ms.
  2758x kernel-only, 48x with readback. **Readback is 99% of GPU wall time.**

Implications:

- Even the pessimistic hybrid (compute on GPU, read straight back to CPU) is a large win.
- The kernel being effectively free is the argument for GPU-resident instance data, which
  is what the full migration buys.
- `CLIMATE_GRID_CELLS = 6` in `src/render/vegetation/domain/tile-data.ts` exists *only*
  because per-instance climate is too expensive on CPU. It is not anymore. Deleting that
  coarse grid is a visual quality gain, not just a speed one.
- WebGPU is available inside dedicated workers (verified), so the vegetation worker can own
  its own `GPUDevice`. No main-thread detour.

## Writing TSL against `@types/three` — read this before Stage 3

This project types three via **`@types/three@0.180.0`** (DefinitelyTyped), *not* three's own
bundled JSDoc types. Its TSL typings are accurate but awkward in specific ways. All four of the
following were compile errors on the first attempt at the sky port; expect them again on each
of the nine remaining `ShaderMaterial` sites.

1. **`Fn` cannot infer its parameter tuple from a bare destructure.** Writing
   `Fn(([p]) => …)` silently resolves to the *other* overload,
   `Fn(jsFunc: (builder: NodeBuilder) => void)`, and fails with
   `Type 'NodeBuilder' must have a '[Symbol.iterator]()' method`. Name the tuple explicitly:

   ```ts
   import type TslBaseNode from 'three/src/nodes/core/Node.js';
   import type { ShaderNodeObject } from 'three/src/nodes/tsl/TSLCore.js';
   type Tsl = ShaderNodeObject<TslBaseNode>;

   const myFn = Fn<[Tsl]>(([p]) => { /* p has the chaining methods */ });
   ```

   `Tsl` is declared locally in `viewport-procedural-sky.ts`; lift it somewhere shared if a
   second file needs it.

2. **`mat2()` does not accept four scalars.** Its only overloads are `(value: Matrix2)` and
   `(node: Node)` — so the GLSL idiom `mat2(a, b, c, d)` will not compile. Either build a
   `THREE.Matrix2` or write the multiply out by hand. Writing it out is preferable: the GLSL
   literal is **column-major**, which is easy to transpose by accident, and explicit `vec2`
   math removes the ambiguity entirely.

3. **`THREE.Renderer` does not exist in `@types/three`.** There is a type-only `Renderer`
   export from `three/webgpu`, but for function parameters just use `WebGPURenderer`.

4. **Function form and method form of the same op are different functions.** Standalone
   `smoothstep(edge0, edge1, x)` follows GLSL argument order. The *method* `.smoothstep()` maps
   to `smoothstepElement`, where the receiver is `x`. Same for `mix` / `mixElement` and
   `step` / `stepElement`. Check `MathNode.d.ts` before assuming an op chains the way you
   expect. Confirmed chainable: `normalize`, `oneMinus`, `saturate`, `pow`, `clamp`, `max`,
   `min`, `dot`, `mix`, `floor`, `fract`, `abs`, `length`.

Two porting rules that are not type errors but will silently change output:

- **Delete `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`.** They are
  `WebGLRenderer` chunks. Under `WebGPURenderer` the output pass does that work, so keeping
  them double-grades.
- **Prefer base `NodeMaterial` + `fragmentNode` over `MeshBasicNodeMaterial`** for anything
  unlit. `MeshBasicNodeMaterial` sets `lights = true` and runs environment mapping, which for
  the sky dome specifically would have fed `scene.environment` — written from a PMREM bake of
  that same dome — back into itself.

## Gotchas found the hard way

### Rect area lights need a second, node-specific init

Symptom: `Uncaught TypeError: Cannot read properties of null (reading 'LTC_FLOAT_1')`,
thrown from `three.webgpu.js` on **every frame**.

`RectAreaLightNode` stores its LTC BRDF tables in a module-level `_ltcLib` that starts as
`null` (`three/src/nodes/lighting/RectAreaLightNode.js:14`) and dereferences it
unconditionally during light setup (line 95). Nothing populates it automatically.

`RectAreaLightUniformsLib.init()` — called from `ensureRectAreaLightsInitialized` in
`src/render/prefabs/prefab-renderer.ts` — is the **WebGLRenderer** path only. It patches
`UniformsLib` and does nothing for node materials. The node path needs:

```js
RectAreaLightNode.setLTC( RectAreaLightTexturesLib.init() );
```

Handled for the editor viewport in `viewport-scene.ts`. **Stage 4 has to do the same for the
game runtime**, and any other surface that adopts `WebGPURenderer` while rendering a scene
containing an `area-light` prefab component.

Deliberately not placed next to `ensureRectAreaLightsInitialized`: `prefab-renderer.ts` is
shared with the still-WebGL game runtime, and importing `three/webgpu` there would pull
1.8 MB into its module graph.

### There are two PMREMGenerator classes, and `THREE.PMREMGenerator` is the wrong one

Symptom: `Uncaught TypeError: Cannot read properties of undefined (reading 'buffers')`
at `PMREMGenerator._sceneToCubeUV`, thrown from **`three.js`** — not `three_webgpu.js`.

| Import | Path | Works with |
|---|---|---|
| `THREE.PMREMGenerator` | `three/src/extras/PMREMGenerator.js` | `WebGLRenderer` only |
| `PMREMGenerator` from `three/webgpu` | `three/src/renderers/common/extras/PMREMGenerator.js` | `Renderer` / `WebGPURenderer` |

The WebGL one reaches into `renderer.state.buffers`, which `WebGPURenderer` does not have.
The `three/webgpu` one takes a `Renderer` in its constructor — so it needs **no cast** — and
exposes the same `fromScene(scene, sigma, near, far, options)` returning a `RenderTarget`,
plus a `fromSceneAsync` variant.

A cast that silences the type error here buys a runtime crash. `@types/three` types the
WebGL generator's constructor as `WebGLRenderer`-only, which is a correct signal, not noise.

Any other surface constructing a `PMREMGenerator` needs the same swap as it migrates.
`CubeRenderTarget` from `three/webgpu` is WebGPU-compatible but only offers
`fromEquirectangularTexture`, so it is not a substitute for the scene bake.

### Vite dedupe: fine, but verify before blaming it

The error above *looks* like a duplicate-three problem, because the stack points at
`node_modules/.vite/deps/three_webgpu.js`. It is not. Vite emits a single shared
`three.core-<hash>.js` that both `three.js` and `three_webgpu.js` import, so core classes stay
identical — matching the Node-level `===` check recorded above. `vite.config.ts` lists only
`['react', 'react-dom']` in `resolve.dedupe` and `three` still dedupes correctly.

## Known risks

- **f32 threshold flips.** `classifyBiome` compares climate against thresholds. A 1e-6
  delta can flip classification for a sample sitting exactly on a boundary, changing one
  plant's type. Rare but nonzero; needs a tolerance strategy before GPU climate drives
  visuals.
- **Terrain stays on CPU for now.** `buildTerrainTileBuffers` is deliberately excluded.
  AGENTS.md requires the mesh and the foot sampler resolve identical band-limited heights;
  a WGSL port creates a second height implementation that must agree bit-for-bit, and the
  failure mode is characters floating or sinking. Revisit only after stage 6.
- **Browser support is now an accepted cost, not a constraint.** Superseded by the
  hard-requirement decision: Firefox on Linux/Android still lags on WebGPU, and those users
  simply cannot run the engine. This was weighed and accepted by the owner. The engineering
  consequence is inverted from the earlier revision — there is **no** dual-backend
  compatibility rule, and WGSL-only constructs in material code are fine.

  What this *does* require is that the boot gate above exists before external playtesting, and
  that `forceWebGL` never reaches a release build. Worth a guard: a release build that
  constructs a renderer outside `webgpu-required.ts`, or passes `forceWebGL`, should fail the
  build rather than ship silently degraded.
- **`BatchedMesh`.** 36 `InstancedMesh` sites, zero `BatchedMesh`. Independent of this
  migration and available today, but worth folding in during stage 3.

## Working on this

```bash
npm run typecheck                      # tsc --noEmit, must stay at 0 errors
npm run lint                           # scripts/ is eslint-exempt; src/ is not
npm run editor:dev                     # owner runs this — do not start it unprompted
node scripts/webgpu_noise_spike.mjs --samples 1048576 --repeats 3
```

The repo has **no unit tests and no test runner** (see `CLAUDE.md`); validation is typecheck +
lint, and the owner does all interactive QA. That is why the two runtime crashes above were
found by the owner and not in advance — an agent cannot see this render. Write the code, get
typecheck to 0, hand it over with an explicit list of what to look at.

Several agents work this repo concurrently, so `git status` is never clean and unrelated
in-flight edits are expected. Touch only migration files; stage explicit paths, never `-A`.

### Verifying WebGPU capability outside the editor

`scripts/webgpu_noise_spike.mjs` doubles as a working reference for driving WebGPU from
headless Electron. Two traps it encodes, both of which cost real time:

- `navigator.gpu` is **undefined** on opaque origins — `data:` URLs and `about:blank`. Only
  `requestAdapter()` returning `null` is a genuine capability signal. Test on a real
  `file://` or `localhost` origin.
- Headless Chrome silently falls back to **SwiftShader** (CPU) unless given
  `--enable-gpu --use-angle=vulkan` alongside `--enable-unsafe-webgpu --enable-features=Vulkan`.
  Check `adapter.info.vendor` — `google`/`swiftshader` means the measurement is worthless.
