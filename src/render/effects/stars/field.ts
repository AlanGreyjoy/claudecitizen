import * as THREE from 'three';
import { DEFAULT_STARS_DATA_URL, StarsGeometry } from '@takram/three-atmosphere';
import { ArrayBufferLoader } from '@takram/three-geospatial';

const STARS_LOCAL_URL = new URL('../../../assets/stars.bin', import.meta.url).href;

// NOTE: ShaderMaterial auto-injects declarations for position, projectionMatrix
// and viewMatrix; redeclaring them here breaks shader compilation.
const STAR_VERTEX_SHADER = /* glsl */ `
attribute float magnitude;
attribute vec3 color;

uniform vec3 cameraPos;
uniform float cameraFar;
uniform float pointSize;
uniform float intensity;
uniform float time;
uniform vec2 magnitudeRange;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 direction = normalize(position);
  float m = mix(magnitudeRange.x, magnitudeRange.y, magnitude);
  float rel = clamp((magnitudeRange.y - m) / (magnitudeRange.y - magnitudeRange.x), 0.0, 1.0);
  // Steep falloff: most stars stay faint pinpricks, only a handful stand out.
  float brightness = pow(rel, 1.4);

  // Slow per-star twinkle; faint stars shimmer more than bright ones.
  float phase = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.28318;
  float amplitude = mix(0.28, 0.08, brightness);
  float twinkle = 1.0 - amplitude * (0.5 + 0.5 * sin(time * (0.7 + phase * 0.3) + phase));

  vColor = color * intensity * twinkle;
  vAlpha = mix(0.08, 1.0, brightness);

  vec3 worldPos = cameraPos + direction * cameraFar * 0.999;
  vec4 viewPos = viewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * viewPos;
  gl_PointSize = pointSize * mix(0.7, 2.1, brightness);
}
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float dist = dot(uv, uv);
  if (dist > 1.0) {
    discard;
  }
  float core = exp(-dist * 5.0);
  float halo = exp(-dist * 1.8) * 0.15;
  float alpha = (core + halo) * vAlpha;
  vec3 rgb = vColor * (core + halo);
  gl_FragColor = vec4(rgb, alpha);
}
`;

interface StarFieldState {
  intensity: number;
  pointSize: number;
  visible: boolean;
}

export interface StarFieldUpdateParams {
  camera: THREE.Camera;
  daylightFactor?: number;
  spaceFactor?: number;
  nowSeconds?: number;
}

export interface StarField {
  dispose: () => void;
  initPromise: Promise<void>;
  isReady: () => boolean;
  points: THREE.Object3D;
  update: (params: StarFieldUpdateParams) => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function loadStarsData(): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const loader = new ArrayBufferLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      STARS_LOCAL_URL,
      resolve,
      undefined,
      async () => {
        try {
          loader.load(DEFAULT_STARS_DATA_URL, resolve, undefined, reject);
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function resolveStarState(daylightFactor: number, spaceFactor: number): StarFieldState {
  const nightFactor = 1 - daylightFactor;
  const surfaceFactor = 1 - clamp01(spaceFactor);
  const daylightSuppression = 1 - clamp01((daylightFactor - 0.38) / 0.2) * surfaceFactor;
  const nightSurface = nightFactor * (1 - spaceFactor * 0.25);
  const orbit = spaceFactor;
  const strength = clamp01(Math.max(nightSurface, orbit * 0.85)) * daylightSuppression;
  const visible = strength > 0.04;
  // Kept deliberately restrained: stars should read as delicate pinpricks
  // from the surface, only gaining presence out in orbit.
  const intensity = visible ? 0.55 + strength * 0.65 + orbit * 0.9 : 0;
  const pointSize = 1.5 + strength * 0.7 + orbit * 0.9;
  return { intensity, pointSize, visible };
}

export function createStarField(scene: THREE.Scene): StarField {
  const material = new THREE.ShaderMaterial({
    blending: THREE.AdditiveBlending,
    // Stars sit just inside the far plane; depth testing lets terrain occlude them.
    depthTest: true,
    depthWrite: false,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    toneMapped: false,
    uniforms: {
      cameraFar: { value: 500_000 },
      cameraPos: { value: new THREE.Vector3() },
      intensity: { value: 0 },
      magnitudeRange: { value: new THREE.Vector2(-1.5, 6.5) },
      pointSize: { value: 1.5 },
      time: { value: 0 },
    },
    vertexShader: STAR_VERTEX_SHADER,
  });

  const points = new THREE.Points(undefined, material);
  // Celestial field is camera-relative / sky-scale — never frustum-cull.
  points.frustumCulled = false;
  points.renderOrder = 100;
  scene.add(points);

  let ready = false;
  let failed = false;
  let geometry: StarsGeometry | null = null;

  const initPromise = loadStarsData()
    .then((data) => {
      geometry = new StarsGeometry(data);
      points.geometry = geometry;
      ready = true;
    })
    .catch((error) => {
      failed = true;
      console.error('ClaudeCitizen star field init failed.', error);
    });

  function update({
    camera,
    daylightFactor = 1,
    spaceFactor = 0,
    nowSeconds = 0,
  }: StarFieldUpdateParams): void {
    if (!ready || failed || !camera) {
      points.visible = false;
      return;
    }

    const { intensity, pointSize, visible } = resolveStarState(daylightFactor, spaceFactor);
    points.visible = visible;
    if (!visible) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    material.uniforms.cameraPos.value.copy(camera.position);
    material.uniforms.cameraFar.value = (camera as THREE.PerspectiveCamera).far;
    material.uniforms.intensity.value = intensity;
    material.uniforms.pointSize.value = pointSize * pixelRatio;
    material.uniforms.time.value = nowSeconds;
  }

  function dispose(): void {
    geometry?.dispose();
    material.dispose();
    scene.remove(points);
  }

  return {
    dispose,
    initPromise,
    isReady() {
      return ready && !failed;
    },
    points,
    update,
  };
}
