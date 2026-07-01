import * as THREE from 'three';
import type { Planet } from '../../../types';
import {
  createStarField,
  createVolumetricCloudManager,
  VolumetricFogEffect,
} from '../../effects';
import { SpeedBlurEffect } from '../effects/speed_blur';
import { resolveRenderQuality } from '../domain/render_quality';
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
  atmospherePass: EffectPass;
  volumetricFogPass: EffectPass;
  volumetricFogEffect: VolumetricFogEffect;
  speedBlurEffect: SpeedBlurEffect;
  volumetricClouds: ReturnType<typeof createVolumetricCloudManager>;
  starField: ReturnType<typeof createStarField>;
  resize: (width: number, height: number, pixelRatio: number) => void;
  dispose: () => void;
}

export function createComposerStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  planet: Planet,
  sun: THREE.DirectionalLight,
): ComposerStack {
  const renderQuality = resolveRenderQuality();
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0,
  });

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const normalPass = new NormalPass(scene, camera);
  composer.addPass(normalPass);

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

  const bloomEffect = new BloomEffect({
    intensity: 1.2,
    luminanceThreshold: 0.85,
    mipmapBlur: renderQuality.bloomMipmapBlur,
  });
  const bloomPass = new EffectPass(camera, bloomEffect);
  composer.addPass(bloomPass);

  const speedBlurEffect = new SpeedBlurEffect();
  const speedBlurPass = new EffectPass(camera, speedBlurEffect);
  composer.addPass(speedBlurPass);

  const toneMappingEffect = new ToneMappingEffect({
    mode: ToneMappingMode.ACES_FILMIC,
  });
  const vignetteEffect = new VignetteEffect({
    darkness: 0.45,
    offset: 0.25,
  });
  const lensPass = new EffectPass(camera, toneMappingEffect, vignetteEffect);
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
  }

  function dispose(): void {
    starField.dispose();
    volumetricClouds.dispose();
    composer.dispose();
  }

  return {
    composer,
    normalPass,
    atmospherePass,
    volumetricFogPass,
    volumetricFogEffect,
    speedBlurEffect,
    volumetricClouds,
    starField,
    resize,
    dispose,
  };
}
