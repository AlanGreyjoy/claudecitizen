import * as THREE from 'three';
import type { Planet } from '../../../types';
import {
  createStarField,
  createVolumetricCloudManager,
  VolumetricFogEffect,
} from '../../effects';
import { SpeedBlurEffect } from '../effects/speed_blur';
import { resolveRenderQuality } from '../domain/render_quality';
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
  atmospherePass: EffectPass;
  volumetricFogPass: EffectPass;
  volumetricFogEffect: VolumetricFogEffect;
  speedBlurEffect: SpeedBlurEffect;
  spaceSkybox: SpaceSkybox;
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

  // Normals only feed the aerial-perspective effect; half resolution halves the
  // cost of what is otherwise a full second render of the entire scene.
  const normalPass = new NormalPass(scene, camera, { resolutionScale: 0.5 });
  composer.addPass(normalPass);

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

  // AgX has a much softer shoulder than ACES: shadows keep detail instead of
  // crushing to black and highlights desaturate gently. Exposure compensation
  // lives on renderer.toneMappingExposure (see webgl_renderer.ts).
  const toneMappingEffect = new ToneMappingEffect({
    mode: ToneMappingMode.AGX,
  });
  const vignetteEffect = new VignetteEffect({
    darkness: 0.28,
    offset: 0.3,
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
    spaceSkybox.dispose();
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
    spaceSkybox,
    volumetricClouds,
    starField,
    resize,
    dispose,
  };
}
