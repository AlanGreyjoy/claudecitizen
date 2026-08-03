// LUT idle bind before `webgpu-atmosphere` pulls `@takram/three-atmosphere`.
import './atmosphere-idle-bypass';

import * as THREE from 'three';
import {
  NodeUpdateType,
  PostProcessing,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  float,
  mix,
  mrt,
  normalView,
  output,
  pass,
  toneMapping,
  toneMappingExposure,
  uniform,
  vec3,
  vec4,
  workingToColorSpace,
} from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';
import type {
  ColorCorrectionSettings,
  FogSettings,
  Planet,
  SsaoSettings,
} from '../../../types';
import { resolveRenderQuality } from '../domain/render-quality';
import { resolveSsaoSettings } from '../domain/ssao-settings';
import { createSpaceSkybox } from '../scene/space-skybox';
import { resolveSpaceSkyboxActive } from '../scene/scene-environment-apply';
import { resolveSkyRecipe } from '../domain/sky-recipe';
import { createMainColorCorrectionNode } from './color-correction-node';
import { createMainNightSkyNode } from './night-sky-node';
import { createMainSpeedBlurNode } from './speed-blur-node';
import { createMainVolumetricFogNode } from './volumetric-fog-node';
import type {
  MainPostBloomSettings,
  MainPostEnvironmentFrame,
  MainPostEnvironmentResult,
  MainPostStack,
} from './types';
import { createMainVignetteNode } from './vignette-node';
import {
  createWebGpuAtmospherePost,
  ensureStarsCatalog,
} from './webgpu-atmosphere';

interface DisposableNode {
  dispose: () => void;
}

function disposeNode(node: unknown): void {
  if (node == null) return;
  (node as Partial<DisposableNode>).dispose?.();
}

/**
 * BloomNode.setSize touches `_separableBlurMaterials`, which `setup()` fills
 * on first compile. Early Play resize runs before that; Bloom self-sizes in
 * `updateBefore` once materials exist.
 */
function resizeBloomNode(
  bloomNode: { setSize: (width: number, height: number) => void },
  width: number,
  height: number,
): void {
  const materials = (
    bloomNode as { _separableBlurMaterials?: unknown[] }
  )._separableBlurMaterials;
  if (!materials || materials.length === 0) return;
  bloomNode.setSize(width, height);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface PostGraph {
  scenePass: ReturnType<typeof pass>;
  cloudPass: ReturnType<typeof pass>;
  gtaoNode: ReturnType<typeof ao> | null;
  bloomNode: ReturnType<typeof bloom>;
  smaaNode: ReturnType<typeof smaa> | null;
  speedBlur: ReturnType<typeof createMainSpeedBlurNode>;
  atmosphere: ReturnType<typeof createWebGpuAtmospherePost>;
  nightSky: ReturnType<typeof createMainNightSkyNode>;
  volumetricFog: ReturnType<typeof createMainVolumetricFogNode>;
  colorCorrection: ReturnType<typeof createMainColorCorrectionNode>;
  // Narrowed to what the stack writes: `uniform()`'s return type is generic and
  // widens `.value` to `unknown` once it is named in an interface.
  aoBlend: { value: number };
  aoColor: { value: THREE.Color };
  postProcessing: PostProcessing;
  ambientOcclusionEnabled: boolean;
  defaultSsaoRadius: number;
}

/**
 * Builds one instance of the TSL graph for the active quality settings.
 *
 * Two of the quality knobs change the *shape* of this graph rather than a
 * uniform: AO adds a GTAO + denoise branch, and SMAA adds a display-space pass.
 * Neither can be toggled on a live `PostProcessing`, which is why the stack is
 * rebuilt wholesale instead — see `rebuild` below.
 *
 * Pass order mirrors the composer this replaced — AO, atmosphere, planet fog,
 * bloom, speed blur, then the lens group — because the ordering is load-bearing:
 * fog must precede bloom so fogged sky does not bloom, and the blur must precede
 * tone mapping so it convolves linear colour.
 */
function buildPostGraph(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  cloudScene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  planet: Planet,
  renderScale: number,
): PostGraph {
  const renderQuality = resolveRenderQuality();
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.name = 'main-scene';
  scenePass.setMRT(
    mrt({
      output,
      normal: normalView,
    }),
  );

  // The cloud deck gets its own pass rather than an extra MRT target on the
  // scene pass, because three only attaches a blend state to colour attachment
  // 0 (`WebGPUPipelineUtils._getColorTargets`) — a second target would have the
  // upper deck overwrite the lower one instead of compositing over it. This
  // scene holds nothing but the deck, clears to transparent black, and is empty
  // (so effectively free) anywhere there is no planet.
  const cloudPass = pass(cloudScene, camera, { samples: 0 });
  cloudPass.name = 'cloud-deck';

  const sceneColor = scenePass.getTextureNode('output');
  // TextureNode — GTAO / Denoise call `.sample(uv)` on this. Do not wrap it in
  // Fn first; a float node has no `.sample` and black-screens the whole post
  // stack (THREE.TSL: this.depthNode.sample is not a function).
  const rawSceneDepth = scenePass.getTextureNode('depth');
  // Empty WebGPU depth texels read ~0; atmosphere / night / fog sky gates
  // expect conventional far = 1 (see webgpu-atmosphere skyAwareDepth).
  const sceneDepth = Fn(() => {
    const d = float(rawSceneDepth).r.toVar();
    return d.lessThanEqual(0.001).select(float(1), d);
  })();
  const sceneNormal = scenePass.getTextureNode('normal');
  const ssaoSettings = resolveSsaoSettings(
    renderQuality.ambientOcclusionIntensity,
  );
  const aoBlend = uniform(renderQuality.ambientOcclusionEnabled ? 1 : 0);
  const aoColor = uniform(new THREE.Color(0, 0, 0));
  const gtaoNode = renderQuality.ambientOcclusionEnabled
    ? ao(rawSceneDepth, sceneNormal, camera)
    : null;

  let colorAfterAo: Node = sceneColor;
  if (gtaoNode) {
    gtaoNode.resolutionScale =
      renderQuality.ambientOcclusionResolutionScale;
    gtaoNode.samples.value = renderQuality.ambientOcclusionSamples;
    gtaoNode.scale.value = ssaoSettings.intensity;
    gtaoNode.distanceFallOff.value = clamp01(ssaoSettings.distanceFalloff);
    // GTAO renders at ~half resolution with a low sample count, and unlike the
    // n8ao pass it replaces it has no built-in denoiser — raw output reads as
    // blotchy rather than soft. Three ships the filter separately, so run the
    // AO target through it before compositing.
    const denoisedAo = denoise(
      gtaoNode.getTextureNode(),
      rawSceneDepth,
      sceneNormal,
      camera,
    );
    // `.r`, not the whole texture node. Occlusion lives in the red channel and
    // these nodes are vec4, so using one directly as the mix factor produced a
    // vec4 multiplier — which tinted the entire frame red and made the
    // enclosing `vec4(vec4, float)` a 5-component join, logged as
    // "TSL: Length of parameters exceeds maximum length of function 'vec4()'".
    const occlusion = denoisedAo.r;
    const occlusionMultiplier = mix(
      vec3(1),
      mix(aoColor, vec3(1), occlusion),
      aoBlend,
    );
    colorAfterAo = vec4(
      sceneColor.rgb.mul(occlusionMultiplier),
      sceneColor.a,
    );
  }

  const atmosphere = createWebGpuAtmospherePost(
    renderer,
    colorAfterAo,
    sceneDepth,
    sceneNormal,
    cloudPass.getTextureNode('output'),
    planet,
  );
  // Airglow / galaxy go in between: after the physical sky so they lift a black
  // night, before the fog raymarch and bloom so they are fogged and bloomed
  // like any other sky luminance.
  const nightSky = createMainNightSkyNode(
    atmosphere.node,
    sceneDepth,
    resolveSkyRecipe(),
  );
  const volumetricFog = createMainVolumetricFogNode(
    nightSky.node,
    sceneDepth,
    planet,
    renderScale,
  );
  const bloomNode = bloom(volumetricFog.node, 0.75, 0.35, 0.7);
  bloomNode.smoothWidth.value = 0.3;
  const colorWithBloom = volumetricFog.node.add(bloomNode);
  const speedBlur = createMainSpeedBlurNode(colorWithBloom);

  // Preserve the existing lens ordering: AgX, color correction, vignette,
  // output-color conversion, then display-space SMAA.
  //
  // `ToneMappingNode` declares itself `vec3` (its constructor calls
  // `super('vec3')`) but its setup returns `vec4(mapped.rgb, color.a)`. Asking
  // the result for `.a` therefore makes JoinNode miscount components and log
  // "Length of parameters exceeds maximum length of function 'vec4()'", which
  // emits a broken shader. Take only `.rgb` from it and carry alpha from a
  // known-vec4 var instead.
  const preLens = vec4(speedBlur.node).toVar();
  const toneMapped = toneMapping(
    THREE.AgXToneMapping,
    toneMappingExposure,
    preLens,
  );
  const colorCorrection = createMainColorCorrectionNode(
    vec4(toneMapped.rgb, preLens.a),
  );
  const vignette = createMainVignetteNode(colorCorrection.node, {
    darkness: 0.28,
    offset: 0.3,
  });
  const outputColor = workingToColorSpace(
    vignette.node,
    renderer.outputColorSpace,
  );
  const smaaNode = renderQuality.useSmaa ? smaa(outputColor) : null;
  // Force opaque alpha on the final composite. With the default transparent
  // canvas (`alpha: true`) sky pixels kept clear-alpha 0 after SkyNode wrote
  // only RGB, and Electron composited them to black over the play host while
  // opaque terrain stayed lit. Even on an opaque canvas, bloom can push A > 1.
  const displayColor = smaaNode ?? outputColor;
  const opaqueOutput = vec4(displayColor.rgb, 1);

  const postProcessing = new PostProcessing(renderer);
  postProcessing.outputColorTransform = false;
  postProcessing.outputNode = opaqueOutput;


  return {
    scenePass,
    cloudPass,
    gtaoNode,
    bloomNode,
    smaaNode,
    speedBlur,
    atmosphere,
    nightSky,
    volumetricFog,
    colorCorrection,
    aoBlend,
    aoColor,
    postProcessing,
    ambientOcclusionEnabled: renderQuality.ambientOcclusionEnabled,
    defaultSsaoRadius: ssaoSettings.aoRadius,
  };
}

function disposePostGraph(graph: PostGraph): void {
  graph.postProcessing.dispose();
  graph.scenePass.dispose();
  graph.cloudPass.dispose();
  disposeNode(graph.gtaoNode);
  disposeNode(graph.bloomNode);
  disposeNode(graph.smaaNode);
  graph.speedBlur.dispose();
  graph.atmosphere.dispose();
}

/**
 * The gameplay post stack. Selected by `manager.ts`; there is no WebGL variant.
 *
 * Motion blur was removed outright (owner call, 2026-07-30) rather than left
 * behind a setting.
 *
 * One gap remains against the WebGL original, deliberately: volumetric clouds
 * are off, because `@takram/three-clouds` has no WebGPU export (see Stage 5).
 *
 * SMAA follows `renderQuality.useSmaa` again. It previously had to be forced
 * off because composing it here logged "Length of parameters exceeds maximum
 * length of function 'vec4()'" — the same JoinNode miscount the AO `.r` note in
 * `buildPostGraph` describes, not an `SMAANode` defect.
 *
 * The returned object's identity is stable across `rebuild()`, so callers may
 * hold the reference indefinitely; only the graph behind it is swapped.
 */
export async function createWebGpuMainPostStack(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  cloudScene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  planet: Planet,
  _sun: THREE.DirectionalLight,
  renderScale: number,
): Promise<MainPostStack> {
  // Stars catalog must be an ArrayBuffer before StarsNode.setup — URL load
  // races the first sky frames and has zeroed the whole SkyNode luminance.
  await ensureStarsCatalog();
  let graph = buildPostGraph(
    renderer,
    scene,
    cloudScene,
    camera,
    planet,
    renderScale,
  );

  const spaceSkybox = createSpaceSkybox();
  let effectsEnabled = true;
  let requestedSpeedBlurStrength = 0;
  let currentPixelRatio = renderer.getPixelRatio();
  let currentRenderScale = renderScale;
  let stationInteriorActive = false;
  let ssaoBaseRadius = graph.defaultSsaoRadius;

  // Sticky presentation state pushed in by callers. A rebuilt graph starts from
  // the stored defaults, so anything set imperatively since boot has to be
  // replayed onto it or the frame visibly reverts on a quality change.
  let lastFogSettings: FogSettings | null = null;
  const lastColorCorrection: Partial<ColorCorrectionSettings> = {};
  let lastAoColor: string | null = null;
  const lastBloomSettings: MainPostBloomSettings = {};
  let lastWidth = 0;
  let lastHeight = 0;

  function syncAoRadius(): void {
    if (!graph.gtaoNode) return;
    const radius =
      ssaoBaseRadius *
      currentRenderScale *
      (stationInteriorActive ? 0.6 : 1);
    graph.gtaoNode.radius.value = radius;
    graph.gtaoNode.thickness.value = Math.max(radius * 4, 0.001);
  }

  function syncSpeedBlur(): void {
    graph.speedBlur.setStrength(
      effectsEnabled ? requestedSpeedBlurStrength : 0,
    );
  }

  function syncEffectsEnabled(): void {
    graph.aoBlend.value =
      effectsEnabled && graph.ambientOcclusionEnabled ? 1 : 0;
    if (graph.gtaoNode) {
      graph.gtaoNode.updateBeforeType = effectsEnabled
        ? NodeUpdateType.FRAME
        : NodeUpdateType.NONE;
    }
    syncSpeedBlur();
  }

  function applyBloomSettings(settings: MainPostBloomSettings): void {
    if (settings.intensity !== undefined) {
      graph.bloomNode.strength.value = Math.max(0, settings.intensity);
    }
    if (settings.luminanceThreshold !== undefined) {
      graph.bloomNode.threshold.value = Math.max(
        0,
        settings.luminanceThreshold,
      );
    }
    if (settings.luminanceSmoothing !== undefined) {
      graph.bloomNode.smoothWidth.value = Math.max(
        0,
        settings.luminanceSmoothing,
      );
    }
  }

  function applyResize(width: number, height: number, pixelRatio: number): void {
    currentPixelRatio = pixelRatio;
    lastWidth = width;
    lastHeight = height;
    graph.scenePass.setPixelRatio(pixelRatio);
    graph.scenePass.setSize(width, height);
    graph.cloudPass.setPixelRatio(pixelRatio);
    graph.cloudPass.setSize(width, height);
    const drawingWidth = Math.max(1, Math.floor(width * pixelRatio));
    const drawingHeight = Math.max(1, Math.floor(height * pixelRatio));
    graph.gtaoNode?.setSize(drawingWidth, drawingHeight);
    resizeBloomNode(graph.bloomNode, drawingWidth, drawingHeight);
    graph.smaaNode?.setSize(drawingWidth, drawingHeight);
    graph.speedBlur.resize(width, height, pixelRatio);
  }

  syncAoRadius();

  return {
    rebuild() {
      // Dispose before building, never the other way round. The atmosphere post
      // swaps `renderer.contextNode.value.getAtmosphere` and restores the getter
      // it displaced on dispose — a save/restore pair that only survives strict
      // LIFO. Building first would have the new graph install its getter, then
      // the old graph's dispose immediately overwrite it with the original.
      disposePostGraph(graph);
      graph = buildPostGraph(
        renderer,
        scene,
        cloudScene,
        camera,
        planet,
        renderScale,
      );

      // The new graph re-resolves SSAO tuning and quality defaults from storage;
      // everything below came in through a setter and would otherwise be lost.
      ssaoBaseRadius = graph.defaultSsaoRadius;
      if (lastFogSettings) graph.volumetricFog.setSettings(lastFogSettings);
      graph.colorCorrection.setSettings(lastColorCorrection);
      if (lastAoColor !== null) graph.aoColor.value.set(lastAoColor);
      applyBloomSettings(lastBloomSettings);
      syncEffectsEnabled();
      syncAoRadius();
      if (lastWidth > 0 && lastHeight > 0) {
        applyResize(lastWidth, lastHeight, currentPixelRatio);
      }
    },
    render(deltaSeconds) {
      void deltaSeconds;
      // Cloud-deck pass clears with the renderer's clear color. Its alpha is
      // coverage for the sky composite (`sky * (1-a) + cloud`). Opaque clear
      // (Three's default when `alpha: false`) makes every sky pixel a=1 and
      // kills day sky + night lift — pitch black over lit terrain. Keep a=0.
      renderer.setClearColor(0x000000, 0);
      graph.postProcessing.render();
    },
    resize(width, height, pixelRatio) {
      applyResize(width, height, pixelRatio);
    },
    setEffectsEnabled(enabled) {
      effectsEnabled = enabled;
      syncEffectsEnabled();
    },
    setSpeedBlurStrength(strength) {
      requestedSpeedBlurStrength = Math.max(0, strength);
      syncSpeedBlur();
    },
    updateEnvironment(
      frame: MainPostEnvironmentFrame,
    ): MainPostEnvironmentResult {
      currentRenderScale = frame.renderScale;
      stationInteriorActive = frame.stationInteriorActive;
      syncAoRadius();
      graph.atmosphere.update(frame, currentPixelRatio);
      graph.nightSky.update(frame);
      graph.volumetricFog.update(frame, currentRenderScale);

      // @takram/three-clouds has no WebGPU export, so the volumetric-cloud mode
      // is deliberately reported inactive until the replacement cloud node
      // lands. Atmosphere, aerial perspective, and StarsNode are active, and it
      // is the atmosphere's SkyNode — not clouds — that owns the sky here, so
      // this flag must not reach the background decision.
      const volumetricSkyActive = false;
      const spaceSkyboxActive = resolveSpaceSkyboxActive({
        backgroundMode: frame.backgroundMode,
        altitudeMeters: frame.altitudeMeters,
        atmosphereHeightMeters: frame.atmosphereHeightMeters,
      });
      return {
        background: spaceSkyboxActive
          ? spaceSkybox.getBackground(frame.backgroundColor)
          : frame.backgroundColor,
        volumetricSkyActive,
      };
    },
    setFogSettings(settings: FogSettings) {
      lastFogSettings = { ...settings };
      graph.volumetricFog.setSettings(settings);
    },
    setColorCorrectionSettings(
      settings: Partial<ColorCorrectionSettings>,
    ) {
      Object.assign(lastColorCorrection, settings);
      graph.colorCorrection.setSettings(settings);
    },
    setAmbientOcclusionSettings(settings: Partial<SsaoSettings>) {
      if (!graph.gtaoNode) return;
      if (settings.intensity !== undefined) {
        graph.gtaoNode.scale.value = Math.max(0, settings.intensity);
      }
      if (settings.aoRadius !== undefined) {
        ssaoBaseRadius = Math.max(0, settings.aoRadius);
        syncAoRadius();
      }
      if (settings.distanceFalloff !== undefined) {
        graph.gtaoNode.distanceFallOff.value = clamp01(
          settings.distanceFalloff,
        );
      }
    },
    setAmbientOcclusionColor(color) {
      lastAoColor = color;
      if (color === null) {
        graph.aoColor.value.set(0, 0, 0);
      } else {
        graph.aoColor.value.set(color);
      }
    },
    setBloomSettings(settings: MainPostBloomSettings) {
      Object.assign(lastBloomSettings, settings);
      applyBloomSettings(settings);
    },
    setExposure(exposure) {
      renderer.toneMappingExposure = exposure;
    },
    dispose() {
      disposePostGraph(graph);
      spaceSkybox.dispose();
    },
  };
}
