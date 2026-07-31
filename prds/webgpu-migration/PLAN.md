# WebGPU migration

Migrate the renderer from `THREE.WebGLRenderer` to `THREE.WebGPURenderer`, rebuild the
post stack on TSL nodes, and open up GPU compute for the tile/vegetation workers.

Decision made 2026-07-29. Blockers previously raised and resolved by the owner:
`@takram/three-clouds` has no WebGPU build (we roll our own — it misbehaves today anyway),
and the `postprocessing` stack gets migrated rather than kept.

## Handoff state — read first

Two commits are on `main`:

- `dcade82` — Stage 0, required-WebGPU bootstrap, viewport renderer/sky, KTX2 ordering, spike
- `f4881ef` — runtime verification notes and next-action handoff

**Everything after that is uncommitted, and it is large**: Stages 1–4 and 6, plus the boot-gate
follow-up, the Three 0.182 upgrade, and the ship-sandbox cutover. **The whole product now runs
on WebGPU** — the only `WebGLRenderer` left in `src/` is the throwaway KTX2 capability probe.

Owner QA is partial: the editor viewport and enough of the gameplay path to shake out four real
0.182 runtime failures (see "Found by running it"). The other migrated surfaces are unverified.

Static validation as of this handoff:

- `npm run typecheck` — **0 errors**
- ESLint over every changed `src/**` file — **0 errors**
- `npm run build:editor:web` and `npm run build:web` — **both re-run and passing** on Three
  0.182, with the release guard active

The uncommitted work, by cluster:

| Cluster | Key paths | What |
|---|---|---|
| Dependency gate resolved | `package.json`, `package-lock.json` | `three` and `@types/three` `^0.180.0` → pinned **`0.182.0`**. Installed. Unblocks takram atmosphere `/webgpu` (see Stage 4) |
| Shared WebGPU infrastructure | `src/render/webgpu-required.ts`, `src/render/node-lights.ts` *(new)*, `src/render/webgpu-capture.ts` *(new)*, `src/render/assets/gpu-dispose.ts` | fallback stripping; `ensureNodeRectAreaLights()` extracted for reuse; render-target PNG readback with 256-byte row padding |
| Boot gate | `src/app/required-webgpu-gate.ts` *(new, 283 ln)*, `src/editor-main.ts`, `src/game-main.ts`, `editor.html`, `index.html` | `passRequiredWebGpuStartupGate()` runs before config/auth/scene work in both entrypoints |
| Migrated renderer surfaces | `viewport-scene.ts`, `material-preview.ts`, `planet-preview-controller.ts`, `base-character-equipment-stage.ts`, `thumbnails.ts`, `item-prefab-screenshot.ts`, `sidekick/preview-stage.ts` (+ their callers) | seven live surfaces now construct `WebGPURenderer` through `initRequiredWebGpu` |
| Gameplay renderer | `src/render/main/scene/webgpu-renderer.ts` *(new)*, `manager.ts` | `createWebGpuRenderer()` is the game's only renderer factory. `webgl-renderer.ts` deleted |
| Stage 3 node materials | `particles/node-material.ts`, `vegetation/render/wind-node-material.ts`, `planet_tiles/render/terrain-material.ts`, `effects/clouds/shell-node-material.ts`, `effects/lake_water/render/node-material.ts`, `effects/quantum-bubble-node-material.ts`, `effects/stars/field.ts` | every `ShaderMaterial` site has a TSL twin, selected through an injected factory. `manager.ts` injects all of them |
| Stage 4 post stack | `src/render/main/post/` *(new, 8 files)*, `render-spike-frame.ts`, `manager.ts` | the TSL node graph is the gameplay post stack. `composer-stack.ts` deleted |
| Parity ports | `post/volumetric-fog-node.ts` *(new)* | the depth-aware planet fog raymarch, ported from the deleted WebGL effects. A floating-origin motion-blur port also landed here and was later removed outright — see below |
| Ship sandbox cutover | `app/ship_sandbox/{scene,types,frame}.ts`, `app/ship-play-session{,-helpers}.ts` | `WebGPURenderer` + a `PostProcessing` graph (`GTAONode` + `denoise` + optional `SMAANode`) replacing `EffectComposer`/`N8AOPostPass`/`SMAAEffect`. `createShipSandboxScene` is now async |
| Dead WebGL code removed | `render/effects/{stars,fog}/`, `render/effects/clouds/volumetric.ts`, `render/main/effects/`, `src/types/n8ao.d.ts` | seven modules with zero consumers; `n8ao` and `@takram/three-clouds` left `package.json` with them |
| Release guard | `vite.config.ts` | `enforceRequiredWebGpu()` fails a build that constructs a `WebGLRenderer` outside the KTX2 probe, or passes a `forceWebGL:` option |

Other agents work this repo concurrently. Stage explicit paths, never `git add -A`, and do not
revert or clean files outside the clusters above.

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

`three` (0.180 at the time, now 0.182) ships `WebGPURenderer` with a **`forceWebGL` option** and a WebGL2 backend, and
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
`WebGPURenderer` or TSL switch to `three/webgpu`. Do not infer migration scope from import
counts; several renderer types live in callers or shared runtime modules rather than creation
sites.

Vite dedupes it too — confirmed, see "Vite dedupe" under Gotchas. No `resolve.dedupe` entry
for `three` is needed.

## The one coupling that sets the order

`postprocessing`'s `EffectComposer` takes a `WebGLRenderer` and will not accept a
`WebGPURenderer`, even on the WebGL backend. Renderer and post stack cannot be separated.

The composer-coupled cluster was `composer-stack.ts`, `effects/clouds/volumetric.ts`, and
`ship_sandbox/{scene,types}.ts`. All four are now migrated or deleted, so this ordering
constraint is historical — kept because it explains why the stages are sequenced as they are.

Compatible authoring previews migrated before that cluster. "Composer-free" does not mean
"independent": thumbnails and Sidekick Preview are also used at runtime, Planet Preview reaches
the vegetation wind shader patch, and arbitrary prefab previews can reach particles and area
lights. Audit each call graph before swapping its renderer.

## Effect inventory

Most of the stack was off-the-shelf in three. Corrects an earlier, more pessimistic
estimate that assumed the whole post stack was bespoke work. Every row below is now done except
the last; the originals in the left column are deleted.

| Original | Replacement | Status |
|---|---|---|
| `N8AOPostPass` (`n8ao`) | `GTAONode` + `DenoiseNode` | done — `GTAONode` alone is too blotchy |
| `BloomEffect` | `BloomNode` | done |
| `SMAAEffect` | `SMAANode` | done |
| `ToneMappingEffect` (AgX) | `AgXToneMapping` | done |
| `MotionBlurEffect` (161 ln) | **removed, not ported** | owner call 2026-07-30: motion blur is cut from the product, effect and setting both |
| takram atmosphere | `@takram/three-atmosphere/webgpu` | done — `0.19.1` imports on Three 0.182 |
| `VolumetricFogEffect` (183 ln) | hand port — `post/volumetric-fog-node.ts` | done |
| `SpeedBlurEffect` (51 ln) | hand port — `post/speed-blur-node.ts` | done |
| `ColorCorrectionEffect` (94 ln) | hand port — `post/color-correction-node.ts` | done |
| `VignetteEffect` | hand port — `post/vignette-node.ts` | done |
| takram clouds (457 ln consumer) | roll our own | **Stage 5 — the one open item** |

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

That describes the destination, not the mixed-renderer migration window. A shared material
whose game consumers still run through the old `WebGLRenderer` needs an explicit temporary
split. Particles demonstrate the pattern: one simulation/lifecycle accepts an injected material
factory, the WebGPU viewport injects TSL, and the game keeps GLSL until Stage 6.

Compute stays hand-written WGSL. WebGL2 has no compute at all, and exact numeric control
matters: `scripts/webgpu_noise_spike_entry.ts` hand-writes it because f32-vs-f64 agreement was
the question being measured, and TSL codegen would have obscured it.

## Progress

Current state: **the migration is code-complete except Stage 5 (volumetric clouds). Editor,
shared previews, the game runtime, and the ship sandbox are all on `WebGPURenderer`; every custom
shader site is TSL; the boot gate exists; Three is on 0.182.** What remains is owner QA and
clouds.

Nine live surfaces construct `WebGPURenderer` with the WebGL fallback stripped:
`viewport-scene.ts`, `material-preview.ts`, `planet-preview-controller.ts`,
`base-character-equipment-stage.ts`, `thumbnails.ts`, `item-prefab-screenshot.ts`,
`sidekick/preview-stage.ts`, `main/scene/webgpu-renderer.ts` (gameplay), and
`app/ship_sandbox/scene.ts`.

**Exactly one `WebGLRenderer` construction remains**: the throwaway KTX2 probe in
`assets/ktx2.ts`, which is intentionally WebGL — it only reads format capability off the same
GPU and never renders a frame. `vite.config.ts` now fails a build on any other one.

`n8ao` and `@takram/three-clouds` are gone from `package.json`. `postprocessing` is no longer a
direct dependency and nothing in `src/` imports it, but it stays in the lockfile as a
**non-optional peer of `@takram/three-atmosphere@0.19.1`** — that package declares it required
even though the `/webgpu` entry never loads it. It leaves node_modules only if takram relaxes
that peer.

- **Stage 0 — done.** `editor-desktop/main.mjs` sets `enable-unsafe-webgpu` +
  `enable-features=Vulkan` before `app.whenReady()`. Verified in the running editor:
  `requestAdapter()` reports `nvidia` / `ampere`.
- **Stage 1 — done for every compatible surface.** Each routes through `initRequiredWebGpu`,
  gates its render loop and asset loads on the resulting promise, and calls
  `ensureNodeRectAreaLights()` where it can render arbitrary prefabs.
  - `viewport-scene.ts` / `viewport.ts` — `ready: Promise<void>`; blank viewport plus a console
    error on rejection, never a silent degrade
  - `viewport-procedural-sky.ts` — `ShaderMaterial` → TSL `NodeMaterial`, plus the
    `three/webgpu` `PMREMGenerator` swap (see Gotchas)
  - `material-preview.ts` — WebGPU PMREM built only after init; custom GLB/KTX2 loads await it
  - `planet-preview-controller.ts` / `planet-preview-vegetation.ts` — KTX2 detection,
    vegetation/spawn loading, queued refreshes, and the RAF all ordered behind init
  - `base-character-equipment-*` (6 files) — node area lights, TSL particles, explicit
    ownership cleanup for attached prefab roots
  - `thumbnails.ts`, `item-prefab-screenshot.ts` — image capture moved off
    `preserveDrawingBuffer` + `canvas.toDataURL()` onto `src/render/webgpu-capture.ts`
  - `sidekick/preview-stage.ts` + `equipment-attach.ts`, `character-creation-screen.ts`,
    `inventory-avatar-preview.ts` — the shared editor/runtime preview cluster
  - `src/render/assets/ktx2.ts` — accepts either renderer; detection moved after `init()`
- **Stage 2 — done for editor surfaces.** `forceWebGL` appears nowhere. Every migrated surface
  went straight to required WebGPU.
- **Stage 3 — every custom shader site has a TSL implementation.** The pattern throughout is a
  *dual* material: the GLSL original stays for the still-WebGL game, the TSL twin lives beside
  it, and the consumer picks via an injected factory (`materialFactory`, `ParticleMaterialFactory`,
  `InstancedWindMaterialFactory`, …). Every twin has a live consumer as of Stage 6 —
  `manager.ts` injects terrain, lake water, cloud shell, quantum bubble, wind, and particles.
  `createWebGpuStarField` never got one and has since been deleted along with its GLSL
  original. Per-site notes:
  - particles — seven custom instance fields share one interleaved buffer, staying below
    WebGPU's portable eight-vertex-buffer limit even when Three moves a large instance matrix
    into a vertex buffer
  - vegetation wind — instance transforms read through a storage binding indexed by
    `instanceIndex`, avoiding another vertex buffer and preserving the live
    `InstancedMesh.instanceMatrix`; unlit, Lambert, standard, and physical variants converted
  - terrain — `TerrainNodeMaterial extends MeshLambertNodeMaterial`, replacing the
    `onBeforeCompile` patch that remains for WebGL
- **Stage 6 — done (code).** `manager.ts` awaits `createWebGpuRenderer(canvas)` and builds
  `createWebGpuMainPostStack(...)`. It injects every Stage 3 factory: terrain, lake water, cloud
  shell, quantum bubble, vegetation wind, and particles (into both `createPrefabStationGroup`
  call sites, so station prefab particles are not blank). `webgl-renderer.ts` and
  `composer-stack.ts` are deleted. `RendererMode` gained a `'webgpu'` member; the HUD stats
  panel no longer reports fallback mode for it, and `RenderStats.gpu.programs` now carries draw
  calls because WebGPU's `Info` tracks no program count.
- **Stage 4 — post stack connected, with two known gaps.** `src/render/main/post/` holds
  `webgpu-post-stack.ts` (`PostProcessing` + `GTAONode` + `BloomNode` + AgX),
  `webgpu-atmosphere.ts` (takram `/webgpu` — `AerialPerspectiveNode`, `StarsNode`, `sky`), and
  hand ports `color-correction-node.ts`, `speed-blur-node.ts`, `vignette-node.ts`,
  `volumetric-fog-node.ts`. `render-spike-frame.ts` drives it through the
  neutral `MainPostStack` interface in `post/types.ts`.

  Pass order deliberately mirrors the deleted composer — AO, atmosphere, planet fog, bloom,
  speed blur, motion blur, lens group. The ordering is load-bearing: fog before bloom so fogged
  sky does not bloom, both blurs before tone mapping so they convolve linear color.

  One gap remains, intentional and marked in the file: **volumetric clouds are off.**
  `@takram/three-clouds` has no WebGPU export, so `updateEnvironment` reports
  `volumetricSkyActive: false` unconditionally. Stage 5.

  **SMAA is back on** and follows `renderQuality.useSmaa`. Its `JoinNode` `vec4()`
  parameter-length failure turned out to be the AO-node miscount described below — passing
  `GTAONode.getTextureNode()` whole rather than `.r` — not an `SMAANode` defect. Taking `.r`
  fixed both. **Never seen running**; it is on the QA list.

  Both parity ports reproduce the originals rather than substituting three's stock nodes.
  Motion blur specifically keeps the two-part reprojection — view-projection delta *plus* an
  explicit `originShift` faded in past 150 m — because this engine keeps the camera at the
  origin and shifts the world; stock velocity blur would read every floating-origin rebase as
  camera motion and smear the whole frame. Both linearize depth with `logarithmicDepthToViewZ`,
  matching the renderer's `logarithmicDepthBuffer` and the originals' `LOG_DEPTH` define.
- **Enforcement — done, plus the boot gate.** `src/render/webgpu-required.ts` is unchanged in
  contract. `src/app/required-webgpu-gate.ts` adds `passRequiredWebGpuStartupGate()`, called as
  the first statement of both `editor-main.ts` and `game-main.ts` — before config,
  authentication, or scene requests. Both `<noscript>` strings now say WebGPU.
- **Three 0.182 upgrade — done.** `three` and `@types/three` are pinned to exactly `0.182.0`.
  This resolves the Stage 4 dependency gate: `OnBeforeObjectUpdate` now exists in `three/tsl`,
  so `@takram/three-atmosphere@0.19.1/webgpu` imports and typechecks. Takram atmosphere,
  geospatial, and clouds versions are unchanged.

  One typing consequence already applied: `type Tsl = ShaderNodeObject<TslBaseNode>` collapsed
  to `type Tsl = TslBaseNode` in `viewport-procedural-sky.ts` and `shell-node-material.ts`.

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
3. `initRequiredWebGpu(renderer)` — strips fallback synchronously before its first `await`,
   then runs the pre-flight and `init()`. That order closes an unmount race in Three's
   pre-init `dispose()` path, which can otherwise call `init()` itself. Availability and
   device failures reject as `WebGpuUnavailableError` with a `reason` of `no-api` |
   `no-adapter` | `software-adapter` | `device-init-failed`; the private-field guard remains
   an intentionally loud plain error.

Reaching into `_getFallback` is a private-field dependency, taken deliberately because there is
no public alternative. It is guarded: if a three upgrade renames the field,
`disableWebGlFallback` **throws** rather than silently restoring the fallback. Failing loudly
beats shipping a WebGL2 build believed to be WebGPU. Re-check it on every three version bump.

### Verified by the owner

Twice, in two configurations — **both against the editor viewport as of `f4881ef`, on Three
0.180.** Nothing in the current uncommitted increment is covered by this, and the Three 0.182
upgrade means even the viewport result needs one confirming re-run.

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
  worked against three 0.180 — **re-confirm on 0.182**)
- `WebGPURenderer` driving a real editor scene with real project content, on Vulkan via Dawn

Two crashes preceded the first result — `LTC_FLOAT_1` on null, then PMREM `reading 'buffers'` —
both found by the owner running the editor and reporting the stack trace. Both are written up
under Gotchas.

### Found by running it — 0.182 runtime failures

These typecheck cleanly and still fail on a real device. Each is a trap the next TSL port will
hit again.

**Vertex attributes must be 4-wide and 4-byte aligned.** WebGPU defines no 3-wide or 1-wide
8/16-bit vertex format — only `x2` and `x4` — and every vertex buffer's `arrayStride` must be a
multiple of 4. Five attributes that were fine under WebGL failed pipeline creation outright:
terrain `color` (`Uint8`×3) and `normal` (`Int16`×3), water `barycentric` and `color`
(`Uint8`×3), and water's three separate `Uint8`×1 scalars. All are now `×4`; the water scalars
share one `waterFactor` attribute. Symptoms were
`Vertex buffer arrayStride (3) is not a multiple of 4` and
`WebGPUAttributeUtils: Vertex format not supported yet`. **This invalidated the terrain disk
cache** — `TERRAIN_CACHE_VERSION` went to `v18`.

**`fragmentNode` is incompatible with an MRT pass.** `NodeMaterial.setup` merges the renderer's
MRT only inside the `fragmentNode === null` branch (`NodeMaterial.js:604-627`); the
`fragmentNode` branch goes straight to `setupOutput` and emits a single color. Against the
gameplay scene pass — which is MRT (color + `normalView`) so GTAO has normals — that fails with
`Color target has no corresponding fragment stage output ... While validating targets[1]`.
**Use `material.outputNode` instead of `material.fragmentNode` for any material that renders
into the main scene.** `outputNode` takes the MRT merge path. Post-processing quad materials are
unaffected — they render outside the MRT pass.

**Post node getters return vec4 — check before using one as a scalar.**
`GTAONode.getTextureNode()` is a vec4 with occlusion in `.r`. Passing it whole as a `mix()`
factor produced a vec4 multiplier that **tinted the entire frame red**, and made the enclosing
`vec4(rgb, a)` a 5-component join. The `vec4()` overflow below and the red frame were one bug.
Take `.r` explicitly.

**`GTAONode` has no denoiser — `n8ao` did.** AO renders at ~half resolution with a low sample
count, so raw GTAO output reads as blotchy rather than soft. Three ships the filter separately
as `DenoiseNode` (`three/addons/tsl/display/DenoiseNode.js`); run the AO target through
`denoise(aoTexture, depth, normal, camera)` before compositing. Not optional for parity.

**MRT `normalView` needs a real `normal` attribute.** Materials that derive normals in the
fragment shader (lake water uses screen-space derivatives) never carried one under WebGL. Under
the MRT scene pass three warns `Vertex attribute "normal" not found on geometry` and the normal
target — which GTAO samples — is garbage. Water now sets its radial direction as `normal`.

**`ToneMappingNode` lies about its type.** It calls `super('vec3')` but its `setup()` returns
`vec4(mapped.rgb, color.a)`. Reading `.a` off the result makes `JoinNode` miscount and log
`Length of parameters exceeds maximum length of function 'vec4()'`, which emits a broken shader
rather than throwing. Take `.rgb` from it and carry alpha from a separate known-`vec4` var.

- **`vec4(vec2, float, float)` is not safe.** Legal GLSL, but `JoinNode` chokes on the shape in
  this stack. The fog node builds its ray-clip vector from four scalars instead.
- **`BloomNode.setSize()` crashes before first compile.** It touches
  `_separableBlurMaterials`, which `setup()` populates. An early Play resize arrives first;
  `resizeBloomNode` guards on the array being non-empty, and Bloom self-sizes in `updateBefore`.
- **`Renderer.contextNode` is missing from `@types/three@0.182`.** It exists at
  `three/src/renderers/common/Renderer.js:232`, and takram 0.19+ reads atmosphere state from it.
  Cast narrowly at the one use site rather than widening the renderer type.

### Statically confirmed during review

Checked against `node_modules/three@0.182`, so these no longer need a runtime pass:

- `_getFallback` still exists (`Renderer.js:296,738,744`) — the fallback-stripping poke survives
  the upgrade.
- `webgpu-capture.ts`'s padding formula matches three's own readback buffer size
  (`WebGPUTextureUtils.js:606`) exactly; three returns the raw padded buffer and never unpads.
  Origin is top-left both sides, so no Y-flip is correct.
- Setting `material.positionNode` **overwrites** `InstanceNode`'s instance transform rather than
  compounding with it (`NodeMaterial.js:842-852`) — the wind material applying the matrix itself
  is right, and instanced normals still come from `InstanceNode`.
- `storage()` self-promotes a plain `InstancedBufferAttribute`
  (`StorageBufferNode.js:152-157`), so the wind material's cast is safe. Note it *mutates* the
  shared attribute, which would matter if the same `InstancedMesh` were also drawn by WebGL.
- `fragmentNode` does not bypass fog — `setupOutput` applies it in both branches.

One real bug was found and fixed: the particle soft-depth path had copied the GLSL
`depth * 2 - 1` remap to OpenGL's `[-1,1]` NDC, which is wrong for WebGPU's `[0,1]`. It was
latent — nothing supplies `depthTexture` — but would have gone live with soft particles.
Separately, `uResolution` in the WebGL original was never written after construction, so soft
particles have never worked on that path either.

### Still not verified

An agent cannot see a render, and static compilation cannot compile a material's actual WGSL
pipeline, so **every item below needs the owner in front of the running engine.**

- **The gameplay flip end to end.** Terrain, lake water, cloud shell, quantum bubble, vegetation
  wind, and station-prefab particles are each meeting a renderer for the first time. Fly a
  surface-to-orbit-to-surface loop, enter a station, trigger quantum travel.
- **The two new parity ports.** Motion blur: does the world stay sharp through a floating-origin
  rebase, and does quantum entry reset cleanly? Fog: does it pool in valleys and thin with
  altitude, matching the pre-migration look?
- **The ship sandbox**, which is a first render on WebGPU for the whole `ship_sandbox` stage.
  Walk the deck, take the pilot seat, fly, use a bed and the entertainment screen, then stop and
  restart the sandbox from the editor a few times — the restart loop is what the dispose path
  exists for, and a leaked device context is the failure it prevents. Watch specifically for AO
  banding on the pad and grid: `GTAONode` + `denoise` replaced `N8AOPostPass`, and its
  `depthAwareUpsampling` has no direct equivalent.
- **SMAA**, now that `renderQuality.useSmaa` is honored again in both the gameplay stack and the
  sandbox. It has never rendered a frame; the failure signature to watch for is a console log
  reading `Length of parameters exceeds maximum length of function 'vec4()'`, which emits a
  broken shader rather than throwing.
- **The other six migrated surfaces.** In rough order of blast radius:
  - *viewport particles* — create or open an authored particle component; exercise billboard,
    stretched, horizontal, vertical, additive, normal, and texture-sheet modes
  - *Planet Preview* — terrain/water, orbit/fly controls, repeated preview refreshes,
    GLTF/KTX2 vegetation and catalog spawns, wind motion (including unlit foliage), and closing
    the panel while content is still loading
  - *Base Character Equipment* — arbitrary equipment prefabs, area lights, attach/detach cycles
  - *thumbnails and item screenshot* — the `webgpu-capture.ts` readback path; confirm the
    256-byte row padding produces un-skewed images at every thumbnail size
  - *Sidekick Preview* — character creation and the inventory avatar, both game-facing
  - *Material Preview* — built-in shapes, checker/studio/dark backdrops, spin/orbit/zoom, and a
    dropped GLB (including a KTX2-backed one when available)
- **Every enforcement failure path**, now including the new boot gate. Nobody has seen
  `WebGpuUnavailableError` fire, or the gate's screen. `no-api`, `no-adapter`,
  `software-adapter`, and `device-init-failed` are all untested. Cheapest way to exercise them:
  temporarily launch the editor *without* the Stage 0 Chromium switches and confirm a clean
  `no-adapter` gate screen instead of a crash or a silent WebGL2 fallback.
- Whether the cloud *pattern* matches the original. The fbm domain-warp matrix was rewritten
  from a column-major GLSL `mat2` literal into explicit `vec2` math; a transposed rotation
  would still look like plausible clouds, just different ones. Low stakes, easy to miss.

### Next action

Everything an agent can do without a screen is done. **The remaining list is owner QA plus two
feature efforts.**

1. **Owner QA**, in blast-radius order: the gameplay flip, the ship sandbox, then the six
   preview surfaces under "Still not verified". That is the whole remaining risk surface.
2. Exercise one enforcement failure path against the boot gate. Cheapest: launch the editor
   without the Stage 0 Chromium switches and confirm a clean `no-adapter` screen.
3. **Stage 5 — volumetric clouds.** The last real feature gap. Deferred by owner decision; the
   post stack already reports `volumetricSkyActive: false` so nothing breaks meanwhile. The
   deleted `@takram/three-clouds` consumer is in git history at
   `src/render/effects/clouds/volumetric.ts` as of `f4881ef` if the old parameterization is
   worth reading.
4. **Compute** — investigated, and the vegetation target does not pay. A validated kernel and
   its gating validator are in the tree; the worker wiring was built, measured, and reverted.
   Read "Correction: the vegetation payoff is not there" before spending more here. Terrain
   compute stays excluded per the mesh-vs-foot-placement invariant. The next candidate needs
   large batches or no readback at all — not another per-tile job.
5. Once QA clears the ports, delete the GLSL originals whose TSL twins now carry the game:
   `particles/material.ts`'s shaders, `vegetation/render/wind.ts`'s `onBeforeCompile` patch, and
   the WebGL branches in `terrain-material.ts`, `shell.ts`, `quantum-bubble.ts`, and
   `lake_water/render/material.ts`. Kept deliberately as reference until then; they are dead for
   the game path and cost nothing but disk.

Done in this increment, for the record: the ship sandbox migrated (item 6 in the previous list),
`n8ao` and `@takram/three-clouds` dropped, seven dead WebGL-only modules deleted — including both
star-field implementations, since `createStarField` and `createWebGpuStarField` each had zero
consumers and the WebGPU path takes stars from takram's `StarsNode` — SMAA re-enabled, and the
release guard added.

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

### Stage 1 — Migrate compatible preview surfaces one at a time — code complete
Thread async initialization through each creation site and port every custom material reachable
from that surface in the same increment. `forceWebGL: true` was useful scaffolding for the first
viewport proof, but the hard-requirement decision means no new surface should add it and it must
never ship.

All seven compatible surfaces are migrated; see the list in Progress. The old count of
"13 composer-free editor files" mixed renderer sites, callers, shared runtime previews, and
game/composer code — ignore it.

The reference material below stays because Stage 6 hits every one of these again when the
gameplay renderer flips.

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

This shapes Stage 3's granularity — each custom material must migrate together with whichever
surface first renders it through `WebGPURenderer`, not according to a misleading global count.

### Stage 2 — Flip editor surfaces to the WebGPU backend — code complete
Drop any temporary `forceWebGL` for editor surfaces and route each through
`initRequiredWebGpu`. Every editor and shared-preview surface went directly to required WebGPU;
`forceWebGL` appears nowhere in the tree. Game runtime stays on WebGL until Stage 6.

### Stage 3 — Port remaining custom shader sites to node materials — code complete
Each is independently verifiable and — once its consumers are all on `WebGPURenderer` — free
to use `wgslFn` / `wgsl` wherever TSL is awkward.

Every site now has a TSL implementation living beside its GLSL original, selected through an
injected factory so the still-WebGL game keeps working. **"Written" is not "verified"** — only
the first two have ever been handed to a renderer.

| GLSL original (retained until Stage 6) | TSL twin | Live consumer |
|---|---|---|
| `particles/material.ts` | `particles/node-material.ts` | editor viewport |
| `vegetation/render/wind.ts` | `vegetation/render/wind-node-material.ts` | Planet Preview |
| `planet_tiles/render/terrain-material.ts` (`onBeforeCompile`) | `createWebGpuTerrainMaterial` in the same file | **none** |
| `effects/lake_water/render/material.ts` | `effects/lake_water/render/node-material.ts` | **none** |
| `effects/clouds/shell.ts` | `effects/clouds/shell-node-material.ts` | **none** |
| `effects/quantum-bubble.ts` | `effects/quantum-bubble-node-material.ts` | **none** |
| `editor/viewport-procedural-sky.ts` | ported in place — no GLSL twin | editor viewport |

`effects/stars/field.ts` was on this list and is now deleted outright. Both halves had zero
consumers: the game takes stars from takram's `StarsNode` inside `webgpu-atmosphere.ts`, so the
TSL twin was a second untested implementation and the GLSL original could not run on the shipped
renderer at all.

### Stage 4 — Rebuild the game post stack on `THREE.PostProcessing` — code complete
`composer-stack.ts` is deleted; `src/render/main/post/webgpu-post-stack.ts` is the only post
stack, built from `PostProcessing`, `GTAONode` + `DenoiseNode`, `BloomNode`, `SMAANode`, AgX, the
hand-ported color-correction / speed-blur / vignette / volumetric-fog nodes, and
takram atmosphere via `webgpu-atmosphere.ts`. `render-spike-frame.ts` drives it through the
neutral `MainPostStack` interface in `post/types.ts`.

`n8ao` has left `package.json`. `postprocessing` is no longer a direct dependency but remains a
required peer of `@takram/three-atmosphere` — see Progress.

The one remaining gap is volumetric clouds (Stage 5).

**Version gate — resolved by upgrading.** `@takram/three-atmosphere@0.19.1/webgpu` imports
`OnBeforeObjectUpdate` from `three/tsl`, which Three r180 did not export. `three` and
`@types/three` are now pinned to exactly `0.182.0`, which does export it; the atmosphere node
typechecks against the installed `0.19.1`. Takram atmosphere, geospatial, and clouds versions
were left alone. The clouds package still has no WebGPU entry — Stage 5.

The compatibility audit that the upgrade was supposed to trigger has **not** been re-run
against a live renderer. That is item 1 under "Next action".

### Stage 5 — Volumetric clouds, own implementation
Replaces `@takram/three-clouds`. Largest single unknown in the migration; sequenced late so
everything else is already stable.

**Stage 5 is not what makes the sky work.** A surface scene rendered with a pure black daytime
sky and it looked like the missing clouds. It was not: `resolveSpaceSkyboxActive` — added during
this migration, with no WebGL predecessor — short-circuited on
`backgroundMode === 'space-skybox'` and painted the star-field equirect at ground level. The
WebGL original never consulted the authored mode, only
`altitudeMeters >= planet.atmosphereHeightMeters`. Fixed by restoring the altitude rule.

The lesson generalizes: `volumetricSkyActive` used to mean "something else owns the sky," and
clouds were merely the thing that set it. On WebGPU the atmosphere's `SkyNode` owns the sky, so
that flag must not reach any background or fog decision. Reporting it `false` is correct — wiring
it into control flow is not.

### Stage 6 — Flip the game runtime, then compute — code complete
`src/render/main/scene/webgpu-renderer.ts` is the game's only renderer factory, routed through
`initRequiredWebGpu` and calling `ensureNodeRectAreaLights()`. `manager.ts` awaits it, builds
`createWebGpuMainPostStack`, and injects every Stage 3 factory. `webgl-renderer.ts` and
`composer-stack.ts` are deleted. `forceWebGL` appears nowhere.

One item from the original flip list is **not** done, deliberately: the GLSL originals whose TSL
twins now carry the game are still on disk. They are dead for the game path but cheap to keep as
reference until QA clears the ports.

Compute is the remaining work here, and it is untouched. Terrain compute stays excluded per the
mesh-vs-foot-placement invariant in AGENTS.md.

### Ship sandbox — code complete (no stage covered it)
`src/app/ship_sandbox/scene.ts` was the last `WebGLRenderer` outside the KTX2 probe.
`createShipSandboxScene` is now `async`, routes through `initRequiredWebGpu`, and calls
`ensureNodeRectAreaLights()` — ship prefabs can carry `area-light` components. Its
`EffectComposer` + `N8AOPostPass` + `SMAAEffect` chain became a `PostProcessing` node graph
behind a small `ShipSandboxPost` interface (`render` / `resize` / `dispose`), so
`ShipSandboxSession` no longer carries `composer` or `n8aoPass`.

Two parity notes: the sandbox's hand-tuned AO settings (0.2 m radius, `intensity * 1.35`,
`distanceFalloff` 1) carried over verbatim, and `GTAONode`'s output runs through `denoise` for
the same reason the gameplay stack does — n8ao had a denoiser, `GTAONode` does not. The MRT
normal target is only attached when AO is enabled.

### Follow-up (not stage-ordered) — user-facing boot gate — implemented, unverified

`src/app/required-webgpu-gate.ts` exports `passRequiredWebGpuStartupGate()`, called as the first
statement of both `src/editor-main.ts` and `src/game-main.ts` — before config, authentication,
or scene requests. It builds on `assertWebGpuAvailable()` and branches on
`WebGpuUnavailableError.reason` so the screen can distinguish "enable these Chrome flags"
(`no-adapter` on Linux) from "your hardware cannot do this" (`no-api`) from "you are on a
software rasterizer" (`software-adapter`). Both `<noscript>` strings were updated to say WebGPU.

**No failure path has ever been triggered**, so the screen itself has never rendered. Exercise
at least one before any external playtest — launching the editor without the Stage 0 Chromium
switches is the cheapest.

## Compute, already measured

`scripts/webgpu_noise_spike.mjs` ported the simplex/fbm climate kernel
(`src/world/terrain-noise.ts`, as called at `climate.ts:181-194`) to WGSL and measured it on
an RTX 3080 Ti:

- Permutation table reproduces the engine's `getNoise3D` **exactly** (max delta 0).
- CPU f64 vs GPU f32 agreement: max |d| ~1e-6, mean ~1e-7 — f32 epsilon.
- 1M samples: CPU 531 ms, GPU kernel 0.19 ms, wall including readback 11 ms.
  2758x kernel-only, 48x with readback. **Readback is 99% of GPU wall time.**

Implications:

- Even the pessimistic hybrid (compute on GPU, read straight back to CPU) is a large win
  **at that batch size**. See the correction below — it does not survive contact with real
  vegetation tiles.
- The kernel being effectively free is the argument for GPU-resident instance data, which
  is what the full migration buys.
- WebGPU is available inside dedicated workers (verified), so the vegetation worker can own
  its own `GPUDevice`. No main-thread detour.

### Correction: the vegetation payoff is not there

Two claims in the paragraph above were wrong, and `scripts/validate_climate_gpu.mjs` — which
drives the production kernel and the production placement path — measures both.

**`CLIMATE_GRID_CELLS = 6` was not costing visual quality.** The earlier revision said the
coarse grid exists *only* because per-instance climate is too expensive, so deleting it is a
quality gain. A per-instance GPU path was built and measured against the grid on three vegetated
tiles. It placed **exactly the same instances** — identical counts, identical variant draws,
matrices agreeing to ~1e-7:

```
  level    span  attempts  placed  variant-mm  max matrix d  coarse6x6   CPU ms   GPU ms
  L17     0.1km     5,859   2,450           0       0.00e+0      2,450     3.80     2.30
  L13     1.9km        48      47           0       1.19e-7         47     0.00     2.30
  L11     7.6km        24       7           0       5.96e-8          7     0.00     2.20
```

The reason is scale. The climate fields run at fbm scale 1.5–3.0 over a *unit sphere*, so
temperature and moisture vary over thousands of kilometres. Vegetation only exists from L17
(0.1 km across) down to L11 (7.6 km). Across any of those, climate is very nearly constant, and
six samples across the tile were already an excellent approximation. The grid was a good
decision, not a compromise.

**And the batch sizes are far too small for the GPU to win.** The 2758x figure came from a
1M-sample dispatch. A real tile asks for 24–5,859 samples, where the fixed ~2.2 ms of dispatch
and readback dominates: at L11 the GPU costs 2.2 ms for work the CPU finishes in microseconds.
Break-even is ~3,400 samples, so only dense L16/L17 grass tiles clear it, and there the whole
prize is ~1.5 ms on a worker thread.

**So the vegetation wiring was reverted.** `vegetation-worker.ts` and `tile-data.ts` are back to
the coarse grid, and `VEGETATION_CACHE_VERSION` stays at `v22` — invalidating every user's
vegetation cache to rebuild identical tiles would have been the change's largest real effect.
The reverted path also carried a standing hazard worth naming: it required a direction pre-pass
that mirrored the placement loop's jitter exactly, and any future drift between the two would
have paired each instance with a different instance's climate, silently.

What survives, because it is worth keeping:

- **The kernel.** `createClimateNoiseGpu` in `src/render/vegetation/gpu/climate-noise-gpu.ts` is
  a working, validated WGSL compute path with reusable buffers. Its only consumer today is the
  validator; it exists as the in-tree reference for the next compute workload, and this section
  is why it has no production caller.
- **The measurement retires a named risk.** The f32 threshold-flip entry under "Known risks" is
  now struck: 1.4M samples across two seeds, with a deliberate elevation sweep so samples
  actually sit on `classifyBiome` thresholds, produced zero flips. `validate_climate_gpu.mjs`
  gates on the rate, so a future kernel change cannot quietly reintroduce it.
- **Single source of truth for the noise tables.** `buildNoiseTable` (terrain-noise.ts) and
  `CLIMATE_NOISE_FIELDS` / `climateValuesFromNoise` / `evaluateClimateNoise` (climate.ts) give
  any non-JS evaluator the engine's own tables and field specs instead of a copied RNG. A second
  copy of the generator would change every planet's biome map with no error anywhere.

The compute win the migration was sold on needs a workload with *large batches* — terrain, or
GPU-resident instance data that never reads back at all. Per-tile vegetation climate is neither.

## Writing TSL against `@types/three`

This project types three via **`@types/three`, pinned to exactly `0.182.0`** (DefinitelyTyped),
*not* three's own bundled JSDoc types. Its TSL typings are accurate but awkward in specific
ways. All four of the following were compile errors on the first attempt at the sky port, and
recurred across the Stage 3 ports.

Written against 0.180 and mostly still true on 0.182 — one item has already changed, noted
inline. Re-check the rest on the next version bump.

1. **`Fn` cannot infer its parameter tuple from a bare destructure.** Writing
   `Fn(([p]) => …)` silently resolves to the *other* overload,
   `Fn(jsFunc: (builder: NodeBuilder) => void)`, and fails with
   `Type 'NodeBuilder' must have a '[Symbol.iterator]()' method`. Name the tuple explicitly:

   ```ts
   import type TslBaseNode from 'three/src/nodes/core/Node.js';
   type Tsl = TslBaseNode;

   const myFn = Fn<[Tsl]>(([p]) => { /* p has the chaining methods */ });
   ```

   **Changed on 0.182:** the alias used to need `ShaderNodeObject<TslBaseNode>` from
   `three/src/nodes/tsl/TSLCore.js`; the bare `Node` now carries the chaining methods, and the
   wrapper import was removed. Declared locally in `viewport-procedural-sky.ts` and
   `shell-node-material.ts` — lift it somewhere shared if a third file needs it.

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

Now extracted as `ensureNodeRectAreaLights()` in `src/render/node-lights.ts` (idempotent) and
called by every migrated surface, including the gameplay and ship-sandbox renderers. **Any
new surface that adopts `WebGPURenderer` while rendering a scene that can contain an
`area-light` prefab component must call it before its first frame.**

Deliberately its own module rather than living next to `ensureRectAreaLightsInitialized`:
`prefab-renderer.ts` is shared with the still-WebGL game runtime, and importing `three/webgpu`
there would pull 1.8 MB into its module graph.

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

- ~~**f32 threshold flips.**~~ **Measured, and it is zero.** `scripts/validate_climate_gpu.mjs`
  compares `classifyBiome` on CPU-f64 and GPU-f32 climate across 1.4M samples on two seeds,
  sweeping normalized height from -0.15 to 1.0 so samples genuinely land on the elevation
  thresholds. Nothing flipped. Field deltas are ~1e-7 mean, ~1e-6 max. No tolerance strategy is
  needed; the validator gates on a flip rate so a future kernel change cannot quietly
  reintroduce the risk.
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
  that `forceWebGL` never reaches a release build. **The guard now exists**:
  `enforceRequiredWebGpu()` in `vite.config.ts` is a build-only plugin that fails the build on a
  `forceWebGL:` option anywhere under `src/`, or a `new WebGLRenderer` outside the KTX2 probe.
  Verified by temporarily clearing the exemption and confirming the build errors.

  Its limit is worth stating: it cannot check that a `new WebGPURenderer` is *followed* by
  `initRequiredWebGpu`, because the eight legitimate creation sites all construct the renderer
  themselves. A new surface that constructs one and skips the init helper ships with three's
  automatic WebGL2 fallback intact, and nothing catches it. Review renderer creation sites by
  hand.
- **`BatchedMesh`.** 36 `InstancedMesh` sites, zero `BatchedMesh`. Independent of this
  migration and available today, but worth folding in during stage 3.

## Working on this

```bash
npm run typecheck                      # tsc --noEmit, must stay at 0 errors
npm run lint                           # scripts/ is eslint-exempt; src/ is not
npm run editor:dev                     # owner runs this — do not start it unprompted
node scripts/webgpu_noise_spike.mjs --samples 1048576 --repeats 3
node scripts/validate_climate_gpu.mjs  # GPU-vs-CPU climate agreement and biome-flip rate
```

`validate_climate_gpu.mjs` exits non-zero when the biome-flip rate exceeds `--max-flip-rate`, so
it is a gate rather than a report. It needs a GPU; there is no CPU-only mode.

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
