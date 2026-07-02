import * as THREE from 'three';
import type { FogSettings } from '../../../types';
import { Effect, EffectAttribute } from 'postprocessing';

const VolumetricFogShader = `
uniform mat4 uProjectionMatrixInverse;
uniform mat4 uCameraMatrixWorld;
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform float uRenderScale;
uniform vec3 uSunDirection;
uniform vec3 uFogColorDay;
uniform vec3 uFogColorNight;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uDaylightFactor;
uniform float uFogDensity;
uniform float uFogMaxHeight;
uniform float uFogHeightFalloff;
uniform float uNoiseStrength;
uniform float uSpaceFactor;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

vec3 viewPosFromDepth(vec2 uv, float d) {
  float viewZ = getViewZ(d);
  vec4 rayClip = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 rayEye = uProjectionMatrixInverse * rayClip;
  rayEye.xyz /= max(abs(rayEye.w), 0.00001);
  return rayEye.xyz * (-viewZ / rayEye.z);
}

vec3 worldPosFromView(vec3 viewPos) {
  return (uCameraMatrixWorld * vec4(viewPos, 1.0)).xyz;
}

float planetAltitudeMeters(vec3 worldPos) {
  return (length(worldPos - uPlanetCenter) - uPlanetRadius) / max(uRenderScale, 0.000001);
}

float fogDensityAt(vec3 worldPos) {
  float altitude = planetAltitudeMeters(worldPos);
  if (altitude < -200.0 || altitude > uFogMaxHeight) {
    return 0.0;
  }
  float heightTerm = exp(-max(altitude, 0.0) / max(uFogHeightFalloff, 1.0));
  heightTerm *= 1.0 - smoothstep(uFogMaxHeight * 0.65, uFogMaxHeight, altitude);
  vec3 noisePos =
    worldPos / max(uRenderScale, 0.000001) * 0.00008 +
    vec3(uTime * 0.004, uTime * 0.003, uTime * 0.002);
  float n = noise3(noisePos);
  float noiseTerm = mix(1.0, 0.35 + n * 0.65, uNoiseStrength);
  return uFogDensity * heightTerm * noiseTerm;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float planetMask = 1.0 - smoothstep(0.2, 0.85, uSpaceFactor);
  if (planetMask <= 0.001) {
    outputColor = inputColor;
    return;
  }

  if (depth >= 1.0) {
    outputColor = inputColor;
    return;
  }

  vec3 cameraWorld = uCameraMatrixWorld[3].xyz;
  vec3 surfaceView = viewPosFromDepth(uv, depth);
  vec3 surfaceWorld = worldPosFromView(surfaceView);
  vec3 rayDir = normalize(surfaceWorld - cameraWorld);
  float maxDist = length(surfaceWorld - cameraWorld);

  vec3 fogColor = mix(uFogColorNight, uFogColorDay, uDaylightFactor);

  const int STEPS = 20;
  float stepSizeMeters = (maxDist / max(uRenderScale, 0.000001)) / float(STEPS);
  float transmittance = 1.0;
  vec3 scattered = vec3(0.0);

  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) * (maxDist / float(STEPS));
    vec3 samplePos = cameraWorld + rayDir * t;
    float density = fogDensityAt(samplePos) * planetMask;
    if (density <= 0.0) {
      continue;
    }

    vec3 sampleColor = fogColor;

    float absorb = exp(-density * stepSizeMeters * 0.65);
    scattered += transmittance * (1.0 - absorb) * sampleColor;
    transmittance *= absorb;
    if (transmittance < 0.02) {
      break;
    }
  }

  outputColor = vec4(inputColor.rgb * transmittance + scattered, inputColor.a);
}
`;

const DEFAULT_FOG_SETTINGS: FogSettings = {
  density: 0.006,
  maxHeight: 4000,
  heightFalloff: 350,
  noiseStrength: 0.4,
};

interface VolumetricFogOptions {
  useLogarithmicDepth?: boolean;
  raySteps?: number;
}

export class VolumetricFogEffect extends Effect {
  constructor(camera: THREE.PerspectiveCamera | null | undefined, options: VolumetricFogOptions = {}) {
    const raySteps = Math.max(4, Math.min(32, options.raySteps ?? 20));
    const defines = new Map<string, string>();
    if (options.useLogarithmicDepth) {
      defines.set('LOG_DEPTH', '1');
    }

    const shader = VolumetricFogShader.replace('const int STEPS = 20;', `const int STEPS = ${raySteps};`);

    super('VolumetricFogEffect', shader, {
      attributes: EffectAttribute.DEPTH,
      defines,
      uniforms: new Map<string, THREE.Uniform>([
        ['uProjectionMatrixInverse', new THREE.Uniform(new THREE.Matrix4())],
        ['uCameraMatrixWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uPlanetCenter', new THREE.Uniform(new THREE.Vector3())],
        ['uPlanetRadius', new THREE.Uniform(6_371_000)],
        ['uRenderScale', new THREE.Uniform(0.001)],
        ['uSunDirection', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uFogColorDay', new THREE.Uniform(new THREE.Color(0xb8daf2))],
        ['uFogColorNight', new THREE.Uniform(new THREE.Color(0x0b1526))],
        ['uSunColor', new THREE.Uniform(new THREE.Color(0xfff1d2))],
        ['uTime', new THREE.Uniform(0)],
        ['uCameraNear', new THREE.Uniform(0.0001)],
        ['uCameraFar', new THREE.Uniform(500_000)],
        ['uDaylightFactor', new THREE.Uniform(1)],
        ['uFogDensity', new THREE.Uniform(DEFAULT_FOG_SETTINGS.density)],
        ['uFogMaxHeight', new THREE.Uniform(DEFAULT_FOG_SETTINGS.maxHeight)],
        ['uFogHeightFalloff', new THREE.Uniform(DEFAULT_FOG_SETTINGS.heightFalloff)],
        ['uNoiseStrength', new THREE.Uniform(DEFAULT_FOG_SETTINGS.noiseStrength)],
        ['uSpaceFactor', new THREE.Uniform(0)],
      ]),
    });

    if (camera) {
      this.uniforms.get('uProjectionMatrixInverse')!.value.copy(camera.projectionMatrixInverse);
      this.uniforms.get('uCameraNear')!.value = camera.near;
      this.uniforms.get('uCameraFar')!.value = camera.far;
    }
  }
}
