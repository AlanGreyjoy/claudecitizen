import * as THREE from 'three';
import {
  DEFAULT_FOG_COLOR,
  DEFAULT_FOG_FAR,
  DEFAULT_FOG_NEAR,
  MOON_MESH_RADIUS,
  SKY_HIGH_COLOR,
  SUN_MESH_RADIUS,
} from '../domain/constants';
import { resolveRenderQuality } from '../domain/render-quality';

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

  // The space-view bodies. On the surface the atmosphere's SkyNode draws a
  // scattered sun and a phase-shaded moon instead, and `updateEnvironment`
  // hides these two so the sky never shows both.
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_MESH_RADIUS, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff1d2, fog: false }),
  );
  scene.add(sunMesh);

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_MESH_RADIUS, 32, 32),
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

/**
 * Repoints the sun/moon shadow maps at a new size without rebuilding the scene.
 *
 * Three allocates `shadow.map` lazily at the size recorded when it was first
 * rendered, so changing `mapSize` alone does nothing — the existing target has
 * to be disposed and dropped so the next frame reallocates. `castShadow` itself
 * is owned per-frame by `updateSunSystem`, which gates on
 * `sun.userData.shadowsEnabled`; setting that here is what makes 'off' stick.
 */
export function applyShadowQuality(
  lighting: SceneLighting,
  shadowMapSize: number,
): void {
  const enabled = shadowMapSize > 0;
  lighting.sun.userData.shadowsEnabled = enabled;
  for (const light of [lighting.sun, lighting.moonLight]) {
    if (light.shadow.mapSize.width === shadowMapSize && light.castShadow === enabled) {
      continue;
    }
    light.shadow.mapSize.width = shadowMapSize;
    light.shadow.mapSize.height = shadowMapSize;
    light.shadow.map?.dispose();
    light.shadow.map = null;
    light.castShadow = enabled;
  }
}

/**
 * Stops a light's shadow pass without disposing its ShadowNode.
 *
 * Clearing `castShadow` looks like the obvious way to switch shadows off, and
 * it is the one thing that must never be done per frame. Three's
 * AnalyticLightNode disposes the ShadowNode along with it, while the command
 * buffer being encoded this frame still references the ShadowMap and
 * ShadowDepthTexture that just went away. WebGPU rejects that submit —
 * `Destroyed texture [Texture "ShadowMap"] used in a submit` — and goes on
 * rejecting every submit after it, so the window keeps its last image and stops
 * responding to anything the renderer does. From outside that is a hard freeze.
 *
 * `shadow.intensity` alone is not enough either: it only scales the shader
 * contribution, and ShadowNode still rasterises the whole scene into the depth
 * map. `autoUpdate` is what actually stops the pass. Same rule `updateSunSystem`
 * follows for the sun/moon hand-off, here as something callers can reuse.
 */
export function muteLightShadow(light: THREE.DirectionalLight): void {
  light.shadow.intensity = 0;
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = false;
}

export function createMainScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = SKY_HIGH_COLOR.clone();
  scene.fog = new THREE.Fog(DEFAULT_FOG_COLOR, DEFAULT_FOG_NEAR, DEFAULT_FOG_FAR);
  return scene;
}

/** Default / floor far plane in render units (world meters × renderScale). */
export const MIN_GAMEPLAY_CAMERA_FAR = 500_000;

export function createMainCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(72, 1, 0.0001, MIN_GAMEPLAY_CAMERA_FAR);
}

/**
 * Keep the planet (and its far limb) inside the clip range when the focus is
 * at System Map distances. Camera is floating-origin / render-scaled, so far
 * is in render units.
 */
export function updateGameplayCameraFar(
  camera: THREE.PerspectiveCamera,
  focusPositionMeters: { x: number; y: number; z: number },
  planetRadiusMeters: number,
  atmosphereHeightMeters: number,
  renderScale: number,
): void {
  const rangeMeters = Math.hypot(
    focusPositionMeters.x,
    focusPositionMeters.y,
    focusPositionMeters.z,
  );
  const worldFarMeters =
    rangeMeters
    + planetRadiusMeters
    + Math.max(0, atmosphereHeightMeters)
    + planetRadiusMeters * 0.25;
  const nextFar = Math.max(MIN_GAMEPLAY_CAMERA_FAR, worldFarMeters * renderScale * 1.25);
  if (Math.abs(camera.far - nextFar) < 1) return;
  camera.far = nextFar;
  camera.updateProjectionMatrix();
}
