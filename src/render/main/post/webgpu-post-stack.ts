import * as THREE from 'three';
import {
  NodeUpdateType,
  PostProcessing,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu';
import {
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
import { createMainColorCorrectionNode } from './color-correction-node';
import { createMainMotionBlurNode } from './motion-blur-node';
import { createMainSpeedBlurNode } from './speed-blur-node';
import { createMainVolumetricFogNode } from './volumetric-fog-node';
import type {
  MainPostBloomSettings,
  MainPostEnvironmentFrame,
  MainPostEnvironmentResult,
  MainPostStack,
} from './types';
import { createMainVignetteNode } from './vignette-node';
import { createWebGpuAtmospherePost } from './webgpu-atmosphere';

interface DisposableNode {
  dispose: () => void;
}

function disposeNode(node: unknown): void {
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

/**
 * The gameplay post stack. Selected by `manager.ts`; there is no WebGL variant.
 *
 * Pass order mirrors the composer this replaced — AO, atmosphere, planet fog,
 * bloom, speed blur, motion blur, then the lens group — because the ordering is
 * load-bearing: fog must precede bloom so fogged sky does not bloom, and both
 * blurs must precede tone mapping so they convolve linear color.
 *
 * One gap remains against the WebGL original, deliberately: volumetric clouds
 * are off, because `@takram/three-clouds` has no WebGPU export (see Stage 5).
 *
 * SMAA follows `renderQuality.useSmaa` again. It previously had to be forced
 * off because composing it here logged "Length of parameters exceeds maximum
 * length of function 'vec4()'" — the same JoinNode miscount the AO `.r` note
 * below describes, not an `SMAANode` defect.
 */
export function createWebGpuMainPostStack(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  planet: Planet,
  _sun: THREE.DirectionalLight,
  renderScale: number,
): MainPostStack {
  const renderQuality = resolveRenderQuality();
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.name = 'main-scene';
  scenePass.setMRT(
    mrt({
      output,
      normal: normalView,
    }),
  );

  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const sceneNormal = scenePass.getTextureNode('normal');
  const ssaoSettings = resolveSsaoSettings(
    renderQuality.ambientOcclusionIntensity,
  );
  let ssaoBaseRadius = ssaoSettings.aoRadius;
  let currentRenderScale = renderScale;
  let stationInteriorActive = false;
  const aoBlend = uniform(renderQuality.ambientOcclusionEnabled ? 1 : 0);
  const aoColor = uniform(new THREE.Color(0, 0, 0));
  const gtaoNode = renderQuality.ambientOcclusionEnabled
    ? ao(sceneDepth, sceneNormal, camera)
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
      sceneDepth,
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
    planet,
  );
  // Pass order mirrors the WebGL composer exactly: AO, atmosphere, planet fog,
  // bloom, speed blur, motion blur, then the lens group.
  const volumetricFog = createMainVolumetricFogNode(
    atmosphere.node,
    sceneDepth,
    planet,
    renderScale,
  );
  const bloomNode = bloom(volumetricFog.node, 0.75, 0.35, 0.7);
  bloomNode.smoothWidth.value = 0.3;
  const colorWithBloom = volumetricFog.node.add(bloomNode);
  const speedBlur = createMainSpeedBlurNode(colorWithBloom);
  const motionBlur = createMainMotionBlurNode(
    speedBlur.node,
    sceneDepth,
    renderScale,
  );

  // Preserve the existing lens ordering: AgX, color correction, vignette,
  // output-color conversion, then display-space SMAA.
  //
  // `ToneMappingNode` declares itself `vec3` (its constructor calls
  // `super('vec3')`) but its setup returns `vec4(mapped.rgb, color.a)`. Asking
  // the result for `.a` therefore makes JoinNode miscount components and log
  // "Length of parameters exceeds maximum length of function 'vec4()'", which
  // emits a broken shader. Take only `.rgb` from it and carry alpha from a
  // known-vec4 var instead.
  const preLens = vec4(motionBlur.node).toVar();
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

  const postProcessing = new PostProcessing(renderer);
  postProcessing.outputColorTransform = false;
  postProcessing.outputNode = smaaNode ?? outputColor;

  const spaceSkybox = createSpaceSkybox();
  let effectsEnabled = true;
  let requestedSpeedBlurStrength = 0;
  let currentPixelRatio = renderer.getPixelRatio();

  function syncAoRadius(): void {
    if (!gtaoNode) return;
    const radius =
      ssaoBaseRadius *
      currentRenderScale *
      (stationInteriorActive ? 0.6 : 1);
    gtaoNode.radius.value = radius;
    gtaoNode.thickness.value = Math.max(radius * 4, 0.001);
  }

  function syncSpeedBlur(): void {
    speedBlur.setStrength(
      effectsEnabled ? requestedSpeedBlurStrength : 0,
    );
  }

  syncAoRadius();

  return {
    render(deltaSeconds) {
      void deltaSeconds;
      postProcessing.render();
    },
    resize(width, height, pixelRatio) {
      currentPixelRatio = pixelRatio;
      scenePass.setPixelRatio(pixelRatio);
      scenePass.setSize(width, height);
      const drawingWidth = Math.max(1, Math.floor(width * pixelRatio));
      const drawingHeight = Math.max(1, Math.floor(height * pixelRatio));
      gtaoNode?.setSize(drawingWidth, drawingHeight);
      resizeBloomNode(bloomNode, drawingWidth, drawingHeight);
      smaaNode?.setSize(drawingWidth, drawingHeight);
      speedBlur.resize(width, height, pixelRatio);
      motionBlur.resize(width, height, pixelRatio);
    },
    setEffectsEnabled(enabled) {
      effectsEnabled = enabled;
      aoBlend.value =
        enabled && renderQuality.ambientOcclusionEnabled ? 1 : 0;
      if (gtaoNode) {
        gtaoNode.updateBeforeType = enabled
          ? NodeUpdateType.FRAME
          : NodeUpdateType.NONE;
      }
      syncSpeedBlur();
    },
    setSpeedBlurStrength(strength) {
      requestedSpeedBlurStrength = Math.max(0, strength);
      syncSpeedBlur();
    },
    updateMotionBlurCamera(nextCamera, focusPosition, nextRenderScale) {
      motionBlur.updateCamera(nextCamera, focusPosition, nextRenderScale);
    },
    resetMotionBlur() {
      motionBlur.reset();
    },
    updateEnvironment(
      frame: MainPostEnvironmentFrame,
    ): MainPostEnvironmentResult {
      currentRenderScale = frame.renderScale;
      stationInteriorActive = frame.stationInteriorActive;
      syncAoRadius();
      atmosphere.update(frame, currentPixelRatio);
      volumetricFog.update(frame, currentRenderScale);

      // @takram/three-clouds has no WebGPU export. Atmosphere, aerial
      // perspective, and StarsNode are active, but the volumetric-cloud mode is
      // deliberately reported inactive until the replacement cloud node lands.
      const volumetricSkyActive = false;
      const spaceSkyboxActive = resolveSpaceSkyboxActive({
        backgroundMode: frame.backgroundMode,
        altitudeMeters: frame.altitudeMeters,
        atmosphereHeightMeters: frame.atmosphereHeightMeters,
        volumetricSkyActive,
      });
      return {
        background: spaceSkyboxActive
          ? spaceSkybox.getBackground(frame.backgroundColor)
          : frame.backgroundColor,
        volumetricSkyActive,
      };
    },
    setFogSettings(settings: FogSettings) {
      volumetricFog.setSettings(settings);
    },
    setColorCorrectionSettings(
      settings: Partial<ColorCorrectionSettings>,
    ) {
      colorCorrection.setSettings(settings);
    },
    setAmbientOcclusionSettings(settings: Partial<SsaoSettings>) {
      if (!gtaoNode) return;
      if (settings.intensity !== undefined) {
        gtaoNode.scale.value = Math.max(0, settings.intensity);
      }
      if (settings.aoRadius !== undefined) {
        ssaoBaseRadius = Math.max(0, settings.aoRadius);
        syncAoRadius();
      }
      if (settings.distanceFalloff !== undefined) {
        gtaoNode.distanceFallOff.value = clamp01(
          settings.distanceFalloff,
        );
      }
    },
    setAmbientOcclusionColor(color) {
      if (color === null) {
        aoColor.value.set(0, 0, 0);
      } else {
        aoColor.value.set(color);
      }
    },
    setBloomSettings(settings: MainPostBloomSettings) {
      if (settings.intensity !== undefined) {
        bloomNode.strength.value = Math.max(0, settings.intensity);
      }
      if (settings.luminanceThreshold !== undefined) {
        bloomNode.threshold.value = Math.max(
          0,
          settings.luminanceThreshold,
        );
      }
      if (settings.luminanceSmoothing !== undefined) {
        bloomNode.smoothWidth.value = Math.max(
          0,
          settings.luminanceSmoothing,
        );
      }
    },
    setExposure(exposure) {
      renderer.toneMappingExposure = exposure;
    },
    dispose() {
      postProcessing.dispose();
      scenePass.dispose();
      disposeNode(gtaoNode);
      disposeNode(bloomNode);
      disposeNode(smaaNode);
      speedBlur.dispose();
      motionBlur.dispose();
      atmosphere.dispose();
      spaceSkybox.dispose();
    },
  };
}
