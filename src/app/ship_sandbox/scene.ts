import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from 'postprocessing';
import { resolveRenderQuality } from '../../render/main/domain/render_quality';
import { PAD_RADIUS_METERS } from './types';

export interface ShipSandboxScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraTarget: THREE.Vector3;
  composer: EffectComposer;
  n8aoPass: N8AOPostPass | null;
}

function resolveN8aoQualityMode(samples: number): 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra' {
  if (samples <= 8) return 'Performance';
  if (samples <= 16) return 'Low';
  if (samples <= 32) return 'Medium';
  if (samples <= 64) return 'High';
  return 'Ultra';
}

export function createShipSandboxScene(canvas: HTMLCanvasElement): ShipSandboxScene {
  const renderQuality = resolveRenderQuality();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a121f);
  scene.fog = new THREE.Fog(0x0a121f, 160, 420);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2_000);
  camera.position.set(14, 8, 14);
  camera.userData.baseFovDeg = 60;
  const cameraTarget = new THREE.Vector3();

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0,
  });
  composer.addPass(new RenderPass(scene, camera));
  let n8aoPass: N8AOPostPass | null = null;
  if (renderQuality.ambientOcclusionEnabled) {
    n8aoPass = new N8AOPostPass(scene, camera, 1, 1);
    n8aoPass.configuration.aoRadius = 0.2;
    n8aoPass.configuration.intensity = renderQuality.ambientOcclusionIntensity * 1.35;
    n8aoPass.configuration.distanceFalloff = 1.0;
    n8aoPass.configuration.gammaCorrection = false;
    n8aoPass.configuration.colorMultiply = true;
    n8aoPass.configuration.halfRes = renderQuality.ambientOcclusionResolutionScale <= 0.5;
    n8aoPass.configuration.depthAwareUpsampling = true;
    n8aoPass.configuration.transparencyAware = false;
    n8aoPass.setQualityMode(resolveN8aoQualityMode(renderQuality.ambientOcclusionSamples));
    composer.addPass(n8aoPass);
  }
  if (renderQuality.useSmaa) {
    composer.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2030, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(PAD_RADIUS_METERS, PAD_RADIUS_METERS, 0.5, 64),
    new THREE.MeshStandardMaterial({
      color: 0x2a3242,
      metalness: 0.15,
      roughness: 0.85,
    }),
  );
  pad.position.y = -0.25;
  pad.receiveShadow = true;
  scene.add(pad);
  const grid = new THREE.GridHelper(PAD_RADIUS_METERS * 2, 42, 0x33507a, 0x18243c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 0.01;
  scene.add(grid);

  return { renderer, scene, camera, cameraTarget, composer, n8aoPass };
}

export function resizeShipSandboxScene(scene: ShipSandboxScene): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  scene.renderer.setSize(width, height, false);
  scene.camera.aspect = width / height;
  scene.camera.updateProjectionMatrix();
  scene.composer.setSize(width, height);
  scene.n8aoPass?.setSize(
    width * scene.renderer.getPixelRatio(),
    height * scene.renderer.getPixelRatio(),
  );
}
