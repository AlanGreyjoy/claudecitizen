import * as THREE from 'three';
import {
  DEFAULT_FOG_COLOR,
  DEFAULT_FOG_FAR,
  DEFAULT_FOG_NEAR,
  SKY_HIGH_COLOR,
} from '../domain/constants';
import { resolveRenderQuality } from '../domain/render_quality';

export interface SceneLighting {
  ambient: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sunMesh: THREE.Mesh;
  moonMesh: THREE.Mesh;
  moonLight: THREE.DirectionalLight;
}

function createMoonGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, 'rgba(214, 226, 252, 0.5)');
  gradient.addColorStop(0.2, 'rgba(186, 203, 240, 0.2)');
  gradient.addColorStop(0.55, 'rgba(150, 172, 218, 0.06)');
  gradient.addColorStop(1, 'rgba(130, 155, 205, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createSceneLighting(scene: THREE.Scene): SceneLighting {
  const renderQuality = resolveRenderQuality();
  // Warmer, lighter ground bounce so shadowed undersides aren't pitch brown.
  const ambient = new THREE.HemisphereLight(0xc4e2ff, 0x473b28, 1.05);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d2, 1.8);
  sun.castShadow = renderQuality.shadowMapSize > 0;
  sun.shadow.mapSize.width = renderQuality.shadowMapSize;
  sun.shadow.mapSize.height = renderQuality.shadowMapSize;
  sun.shadow.bias = -0.0003;
  // Partial shadow opacity: shadowed areas keep a hint of direct light, which
  // reads much softer than fully-occluded black shadows.
  sun.shadow.intensity = 0.82;
  scene.add(sun);
  scene.add(sun.target);

  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(12000, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff1d2, fog: false }),
  );
  scene.add(sunMesh);

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xdfe6f2, fog: false, toneMapped: false }),
  );
  scene.add(moonMesh);

  // Soft additive halo so the moon reads as a light source in the night sky.
  const moonGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createMoonGlowTexture(),
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      transparent: true,
    }),
  );
  moonGlow.scale.setScalar(58_000);
  moonMesh.add(moonGlow);

  // The moon casts shadows too; updateSunSystem toggles castShadow so only
  // whichever body is above the horizon renders a shadow map each frame.
  const moonLight = new THREE.DirectionalLight(0x8ba3d9, 0);
  moonLight.castShadow = renderQuality.shadowMapSize > 0;
  moonLight.shadow.mapSize.width = renderQuality.shadowMapSize;
  moonLight.shadow.mapSize.height = renderQuality.shadowMapSize;
  moonLight.shadow.bias = -0.0003;
  moonLight.shadow.intensity = 0.85;
  scene.add(moonLight);
  scene.add(moonLight.target);

  sun.userData.shadowsEnabled = renderQuality.shadowMapSize > 0;

  return { ambient, sun, sunMesh, moonMesh, moonLight };
}

export function createMainScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = SKY_HIGH_COLOR.clone();
  scene.fog = new THREE.Fog(DEFAULT_FOG_COLOR, DEFAULT_FOG_NEAR, DEFAULT_FOG_FAR);
  return scene;
}

export function createMainCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(72, 1, 0.0001, 500_000);
}
