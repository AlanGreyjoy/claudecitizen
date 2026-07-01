import * as THREE from 'three';
import { DEFAULT_STARS_DATA_URL, StarsGeometry } from '@takram/three-atmosphere';
import { ArrayBufferLoader } from '@takram/three-geospatial';

const STARS_LOCAL_URL = new URL('../assets/stars.bin', import.meta.url).href;

const STAR_VERTEX_SHADER = /* glsl */ `
attribute vec3 position;
attribute float magnitude;
attribute vec3 color;

uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPos;
uniform float cameraFar;
uniform float pointSize;
uniform float intensity;
uniform vec2 magnitudeRange;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 direction = normalize(position);
  float m = mix(magnitudeRange.x, magnitudeRange.y, magnitude);
  float rel = clamp((magnitudeRange.y - m) / (magnitudeRange.y - magnitudeRange.x), 0.0, 1.0);
  float brightness = pow(rel, 0.55);
  vColor = color * intensity;
  vAlpha = mix(0.35, 1.0, brightness);

  vec3 worldPos = cameraPos + direction * cameraFar * 0.999;
  vec4 viewPos = viewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * viewPos;
  gl_PointSize = pointSize * mix(0.85, 2.4, brightness);
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
  float core = exp(-dist * 3.6);
  float halo = exp(-dist * 1.1) * 0.35;
  float alpha = (core + halo) * vAlpha;
  vec3 rgb = vColor * (core + halo * 0.8);
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
  const daylightSuppression = 1 - clamp01((daylightFactor - 0.38) / 0.2);
  const nightSurface = nightFactor * (1 - spaceFactor * 0.25);
  const orbit = spaceFactor;
  const strength = clamp01(Math.max(nightSurface, orbit * 0.85)) * daylightSuppression;
  const visible = strength > 0.04;
  const intensity = visible ? 1.4 + strength * 1.8 + orbit * 0.8 : 0;
  const pointSize = 2.2 + strength * 1.6 + orbit * 0.8;
  return { intensity, pointSize, visible };
}

export function createStarField(scene: THREE.Scene): StarField {
  const material = new THREE.ShaderMaterial({
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    toneMapped: false,
    uniforms: {
      cameraFar: { value: 500_000 },
      cameraPos: { value: new THREE.Vector3() },
      intensity: { value: 0 },
      magnitudeRange: { value: new THREE.Vector2(-1.5, 6.5) },
      pointSize: { value: 2.2 },
    },
    vertexShader: STAR_VERTEX_SHADER,
  });

  const points = new THREE.Points(undefined, material);
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

  function update({ camera, daylightFactor = 1, spaceFactor = 0 }: StarFieldUpdateParams): void {
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
