import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import type { Planet } from '../../../types';
import {
  createStarField,
  createVolumetricCloudManager,
  VolumetricFogEffect,
} from '../../effects';
import { SpeedBlurEffect } from '../effects/speed_blur';
import { MotionBlurEffect } from '../effects/motion_blur';
import { ColorCorrectionEffect } from '../effects/color_correction';
import { resolveRenderQuality } from '../domain/render_quality';
import { resolveSsaoSettings } from '../domain/ssao_settings';
import { createSpaceSkybox, type SpaceSkybox } from './space_skybox';
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  NormalPass,
  BloomEffect,
  ToneMappingEffect,
  VignetteEffect,
  SMAAEffect,
  ToneMappingMode,
} from 'postprocessing';

export interface ComposerStack {
  composer: EffectComposer;
  normalPass: NormalPass;
  n8aoPass: N8AOPostPass | null;
  ssaoBaseIntensity: number;
  ssaoBaseRadius: number;
  atmospherePass: EffectPass;
  volumetricFogPass: EffectPass;
  volumetricFogEffect: VolumetricFogEffect;
  speedBlurEffect: SpeedBlurEffect;
  speedBlurPass: EffectPass;
  motionBlurEffect: MotionBlurEffect;
  motionBlurPass: EffectPass;
  motionBlurEnabledByQuality: boolean;
  colorCorrectionEffect: ColorCorrectionEffect;
  spaceSkybox: SpaceSkybox;
  volumetricClouds: ReturnType<typeof createVolumetricCloudManager>;
  starField: ReturnType<typeof createStarField>;
  ambientOcclusionEnabled: boolean;
  resize: (width: number, height: number, pixelRatio: number) => void;
  dispose: () => void;
}

function resolveN8AOQualityMode(samples: number): 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra' {
  if (samples <= 8) return 'Performance';
  if (samples <= 16) return 'Low';
  if (samples <= 32) return 'Medium';
  if (samples <= 64) return 'High';
  return 'Ultra';
}

function disposeN8AOPass(pass: N8AOPostPass | null): void {
  if (!pass) return;
  // N8AOPostPass does not expose a dispose method, so release its
  // render targets and full-screen triangle materials explicitly.
  pass.writeTargetInternal?.dispose();
  pass.readTargetInternal?.dispose();
  pass.outputTargetInternal?.dispose();
  pass.accumulationRenderTarget?.dispose();
  pass.depthDownsampleTarget?.dispose();
  pass.transparencyRenderTargetDWFalse?.dispose();
  pass.transparencyRenderTargetDWTrue?.dispose();
  pass.effectShaderQuad?.dispose();
  pass.poissonBlurQuad?.dispose();
  pass.effectCompositerQuad?.dispose();
  pass.copyQuad?.dispose();
  pass.accumulationQuad?.dispose();
  pass.depthCopyPass?.dispose();
}

export function createComposerStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  planet: Planet,
  sun: THREE.DirectionalLight,
  renderScale: number,
): ComposerStack {
  const renderQuality = resolveRenderQuality();
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0,
  });

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Normals feed aerial perspective; N8AO reconstructs normals from depth itself.
  const normalPass = new NormalPass(scene, camera, {
    resolutionScale: 0.5,
  });
  composer.addPass(normalPass);

  const ssaoSettings = resolveSsaoSettings(renderQuality.ambientOcclusionIntensity);
  const ssaoBaseRadius = ssaoSettings.aoRadius;
  const ssaoBaseIntensity = ssaoSettings.intensity;
  let n8aoPass: N8AOPostPass | null = null;
  if (renderQuality.ambientOcclusionEnabled) {
    n8aoPass = new N8AOPostPass(scene, camera, 1, 1);
    n8aoPass.configuration.aoRadius = ssaoBaseRadius * renderScale;
    n8aoPass.configuration.intensity = ssaoBaseIntensity;
    n8aoPass.configuration.distanceFalloff = ssaoSettings.distanceFalloff;
    n8aoPass.configuration.gammaCorrection = false;
    n8aoPass.configuration.colorMultiply = true;
    n8aoPass.configuration.halfRes = renderQuality.ambientOcclusionResolutionScale <= 0.5;
    n8aoPass.configuration.depthAwareUpsampling = true;
    n8aoPass.configuration.transparencyAware = false;
    n8aoPass.setQualityMode(resolveN8AOQualityMode(renderQuality.ambientOcclusionSamples));
    composer.addPass(n8aoPass);
  }

  const spaceSkybox = createSpaceSkybox();
  const volumetricClouds = createVolumetricCloudManager(renderer, scene, camera, planet, sun, normalPass);
  const starField = createStarField(scene);

  const atmospherePass = new EffectPass(
    camera,
    volumetricClouds.cloudsEffect,
    volumetricClouds.aerialPerspectiveEffect,
  );
  composer.addPass(atmospherePass);

  const volumetricFogEffect = new VolumetricFogEffect(camera, {
    useLogarithmicDepth: renderer.capabilities.logarithmicDepthBuffer,
    raySteps: renderQuality.fogRaySteps,
  });
  const volumetricFogPass = new EffectPass(camera, volumetricFogEffect);
  composer.addPass(volumetricFogPass);

  // Lower threshold + gentler intensity gives a soft glow on bright surfaces
  // instead of only blooming near-white highlights.
  const bloomEffect = new BloomEffect({
    intensity: 0.75,
    luminanceThreshold: 0.7,
    luminanceSmoothing: 0.3,
    mipmapBlur: renderQuality.bloomMipmapBlur,
  });
  const bloomPass = new EffectPass(camera, bloomEffect);
  composer.addPass(bloomPass);

  const speedBlurEffect = new SpeedBlurEffect();
  const speedBlurPass = new EffectPass(camera, speedBlurEffect);
  composer.addPass(speedBlurPass);

  const motionBlurEffect = new MotionBlurEffect(camera, renderScale, {
    useLogarithmicDepth: renderer.capabilities.logarithmicDepthBuffer,
    samples: renderQuality.motionBlurSamples,
  });
  const motionBlurPass = new EffectPass(camera, motionBlurEffect);
  motionBlurPass.setEnabled(renderQuality.motionBlurEnabled);
  composer.addPass(motionBlurPass);

  // AgX has a much softer shoulder than ACES: shadows keep detail instead of
  // crushing to black and highlights desaturate gently. Exposure compensation
  // lives on renderer.toneMappingExposure (see webgl_renderer.ts).
  const toneMappingEffect = new ToneMappingEffect({
    mode: ToneMappingMode.AGX,
  });
  const colorCorrectionEffect = new ColorCorrectionEffect();
  const vignetteEffect = new VignetteEffect({
    darkness: 0.28,
    offset: 0.3,
  });
  const lensPass = new EffectPass(
    camera,
    toneMappingEffect,
    colorCorrectionEffect,
    vignetteEffect,
  );
  composer.addPass(lensPass);

  if (renderQuality.useSmaa) {
    const smaaEffect = new SMAAEffect();
    const smaaPass = new EffectPass(camera, smaaEffect);
    smaaPass.renderToScreen = true;
    composer.addPass(smaaPass);
  } else {
    lensPass.renderToScreen = true;
  }

  function resize(width: number, height: number, pixelRatio: number): void {
    composer.setSize(width, height);
    normalPass.setSize(width * pixelRatio, height * pixelRatio);
    n8aoPass?.setSize(width * pixelRatio, height * pixelRatio);
  }

  function dispose(): void {
    spaceSkybox.dispose();
    starField.dispose();
    volumetricClouds.dispose();
    disposeN8AOPass(n8aoPass);
    composer.dispose();
  }

  return {
    composer,
    normalPass,
    n8aoPass,
    ssaoBaseIntensity,
    ssaoBaseRadius,
    atmospherePass,
    volumetricFogPass,
    volumetricFogEffect,
    speedBlurEffect,
    speedBlurPass,
    motionBlurEffect,
    motionBlurPass,
    motionBlurEnabledByQuality: renderQuality.motionBlurEnabled,
    colorCorrectionEffect,
    spaceSkybox,
    volumetricClouds,
    starField,
    ambientOcclusionEnabled: renderQuality.ambientOcclusionEnabled,
    resize,
    dispose,
  };
}
