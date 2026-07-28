import * as THREE from 'three';

/**
 * Unreal-style procedural sky for the editor viewport.
 *
 * Deliberately *not* a physical model. Unreal's BP_Sky_Sphere is an authored
 * gradient — zenith/horizon colors driven by sun height, a flat ground half,
 * an oversized readable sun disk, and a drifting cloud layer. Preetham/Hosek
 * output unbounded radiance that AgX flattens into a white haze, which is what
 * the old dome looked like. Authoring the colors in display range keeps the
 * saturated blue zenith and the warm dusk that people recognize as "Unreal".
 *
 * The dome is a small sphere pinned to the camera with depth off, so it costs
 * no depth precision and needs no far-plane stretch.
 */
export interface ViewportProceduralSky {
  setEnabled: (enabled: boolean) => void;
  /** Re-grade sky + sun disk after the env directional light moves. */
  syncSunFromLight: (sunLight: THREE.DirectionalLight) => void;
  /** Drift the cloud layer. No-op while disabled. */
  update: (dt: number) => void;
  dispose: () => void;
}

const SKY_RADIUS = 10;
const DEFAULT_BACKGROUND = 0x0a101d;
const DEFAULT_FOG_NEAR = 260;
const DEFAULT_FOG_FAR = 620;
/** Haze density tuned so the 400-unit editor grid dissolves into the horizon. */
const SKY_FOG_DENSITY = 0.0035;
/** Unreal's default cloud speed reads as barely-moving; match that. */
const CLOUD_SPEED = 0.004;

interface SkyPalette {
  zenith: number;
  horizon: number;
  ground: number;
  cloudLit: number;
  cloudShadow: number;
}

const DAY: SkyPalette = {
  zenith: 0x1e5fbd,
  horizon: 0xbcd7f2,
  ground: 0x3c4047,
  cloudLit: 0xf6f9ff,
  cloudShadow: 0x8ea6c4,
};

const DUSK: SkyPalette = {
  zenith: 0x15315f,
  horizon: 0xef9a55,
  ground: 0x2a2622,
  cloudLit: 0xffd3a4,
  cloudShadow: 0x7c6076,
};

const NIGHT: SkyPalette = {
  zenith: 0x03070f,
  horizon: 0x0b1728,
  ground: 0x07090d,
  cloudLit: 0x1b2436,
  cloudShadow: 0x0a111c,
};

const SUN_TINT_DAY = 0xfff4e0;
const SUN_TINT_DUSK = 0xff8a3c;

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 sunDirection;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunColor;
uniform vec3 cloudLitColor;
uniform vec3 cloudShadowColor;
uniform float horizonFalloff;
uniform float sunIntensity;
uniform float sunGlowIntensity;
uniform float sunAngularCos;
uniform float cloudCoverage;
uniform float cloudOpacity;
uniform float cloudTime;
uniform float saturation;

varying vec3 vWorldPosition;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * valueNoise(p);
    p = rot * p * 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  vec2 flatDir = normalize(dir.xz + 1e-5);
  vec2 flatSun = normalize(sunDirection.xz + 1e-5);
  float cosSun = dot(dir, sunDirection);

  // Unreal's gradient: pow(1 - saturate(height), HorizonFalloff), zenith -> horizon.
  float gradient = pow(1.0 - clamp(dir.y, 0.0, 1.0), horizonFalloff);
  vec3 color = mix(zenithColor, horizonColor, gradient);

  // Horizon warms toward the sun's azimuth, strongest at low sun.
  color += sunColor * gradient * pow(max(dot(flatDir, flatSun), 0.0), 3.0) * 0.22 * sunGlowIntensity;

  // Two-lobe Mie halo, then the disk itself. Both sit under the cloud layer.
  float towardSun = max(cosSun, 0.0);
  color += sunColor * (pow(towardSun, 20.0) * 0.5 + pow(towardSun, 400.0) * 1.6) * sunGlowIntensity;
  float disk = smoothstep(sunAngularCos, mix(sunAngularCos, 1.0, 0.4), cosSun);
  color += sunColor * disk * sunIntensity;

  if (cloudOpacity > 0.001 && dir.y > 0.005) {
    // Project onto a flat cloud deck so layers converge at the horizon.
    vec2 deck = dir.xz / max(dir.y, 0.02) * 0.55 + vec2(cloudTime, cloudTime * 0.4);
    float density = fbm(deck);
    float cover = smoothstep(cloudCoverage, cloudCoverage + 0.28, density);
    // Cheap self-shadowing: compare against a sample stepped toward the sun.
    float lit = fbm(deck + flatSun * 0.35);
    float shade = clamp((density - lit) * 2.2 + 0.55, 0.0, 1.0);
    vec3 cloud = mix(cloudShadowColor, cloudLitColor, shade);
    cloud += sunColor * pow(towardSun, 8.0) * (1.0 - shade) * 0.35 * sunGlowIntensity;
    color = mix(color, cloud, cover * cloudOpacity * smoothstep(0.02, 0.22, dir.y));
  }

  // Flat ground half with a short blend so the horizon line stays crisp.
  // (GLSL smoothstep is undefined when edge0 > edge1, so invert rather than flip.)
  vec3 ground = mix(horizonColor * 0.55, groundColor, 1.0 - smoothstep(-0.25, 0.0, dir.y));
  color = mix(color, ground, 1.0 - smoothstep(-0.04, 0.0, dir.y));

  // AgX pulls a lot of chroma out of the blues; pre-compensate before grading.
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(mix(vec3(luminance), color, saturation), 0.0);

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function createViewportProceduralSky(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  sunLight: THREE.DirectionalLight,
): ViewportProceduralSky {
  const uniforms = {
    sunDirection: { value: new THREE.Vector3(0.4, 0.85, 0.3).normalize() },
    zenithColor: { value: new THREE.Color() },
    horizonColor: { value: new THREE.Color() },
    groundColor: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color() },
    cloudLitColor: { value: new THREE.Color() },
    cloudShadowColor: { value: new THREE.Color() },
    horizonFalloff: { value: 3 },
    sunIntensity: { value: 14 },
    sunGlowIntensity: { value: 1 },
    // ~1.2 deg angular radius: physically fat, but readable like Unreal's.
    sunAngularCos: { value: Math.cos(THREE.MathUtils.degToRad(1.2)) },
    cloudCoverage: { value: 0.52 },
    cloudOpacity: { value: 0.85 },
    cloudTime: { value: 0 },
    saturation: { value: 1.45 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 32), material);
  sky.name = 'editor-procedural-sky';
  sky.frustumCulled = false;
  // Backdrop: always first, never in the depth buffer, always centred on the
  // viewer (including each PMREM cube face, which sits at the origin).
  sky.renderOrder = -1000;
  sky.onBeforeRender = (_r, _s, renderCamera) => {
    renderCamera.getWorldPosition(sky.position);
    // Scene matrices were already flushed for this frame; re-derive ours or the
    // dome renders one frame behind the camera (and off-centre during the bake).
    sky.updateMatrixWorld(true);
  };

  const pmrem = new THREE.PMREMGenerator(renderer);
  const bakeScene = new THREE.Scene();
  const hazeColor = new THREE.Color();
  const scratch = new THREE.Color();

  let enabled = false;
  let envTarget: THREE.WebGLRenderTarget | null = null;
  const savedBackground = new THREE.Color(DEFAULT_BACKGROUND);
  let savedFog: THREE.Fog | THREE.FogExp2 | null = null;

  function setSrgb(target: THREE.Color, hex: number): THREE.Color {
    return target.setHex(hex, THREE.SRGBColorSpace);
  }

  function blend(target: THREE.Color, from: number, to: number, t: number): void {
    setSrgb(target, from).lerp(setSrgb(scratch, to), t);
  }

  /** Grade the whole palette off sun height, the way BP_Sky_Sphere does. */
  function applySunHeight(height: number): void {
    const dayMix = smoothstep(-0.02, 0.22, height);
    const nightMix = smoothstep(0.02, -0.16, height);

    const grade = (key: keyof SkyPalette, target: THREE.Color): void => {
      blend(target, DUSK[key], DAY[key], dayMix);
      target.lerp(setSrgb(scratch, NIGHT[key]), nightMix);
    };

    grade('zenith', uniforms.zenithColor.value);
    grade('horizon', uniforms.horizonColor.value);
    grade('ground', uniforms.groundColor.value);
    grade('cloudLit', uniforms.cloudLitColor.value);
    grade('cloudShadow', uniforms.cloudShadowColor.value);

    blend(uniforms.sunColor.value, SUN_TINT_DUSK, SUN_TINT_DAY, dayMix);

    const above = smoothstep(-0.09, 0.06, height);
    uniforms.sunIntensity.value = 14 * above;
    uniforms.sunGlowIntensity.value = above;

    // Aerial perspective: distant geometry should dissolve into the horizon,
    // not into a leftover navy backdrop color.
    hazeColor.copy(uniforms.horizonColor.value).multiplyScalar(0.9);
  }

  function syncSun(light: THREE.DirectionalLight): void {
    const dir = uniforms.sunDirection.value;
    dir.copy(light.position);
    if (dir.lengthSq() < 1e-8) dir.set(0.4, 0.85, 0.3);
    dir.normalize();
    applySunHeight(dir.y);
    if (scene.fog instanceof THREE.FogExp2) scene.fog.color.copy(hazeColor);
  }

  function bakeEnvironment(): void {
    envTarget?.dispose();
    // fromScene needs a Scene of its own; park the dome there for the cube pass.
    bakeScene.add(sky);
    envTarget = pmrem.fromScene(bakeScene, 0.04, 0.1, SKY_RADIUS * 4);
    scene.add(sky);
    scene.environment = envTarget.texture;
  }

  function setEnabled(next: boolean): void {
    if (next === enabled) return;
    enabled = next;

    if (next) {
      if (scene.background instanceof THREE.Color) savedBackground.copy(scene.background);
      savedFog = scene.fog;

      syncSun(sunLight);
      bakeEnvironment();
      // The dome is the backdrop; a solid clear color would just occlude it.
      scene.background = null;
      const haze = new THREE.FogExp2(0x000000, SKY_FOG_DENSITY);
      haze.color.copy(hazeColor);
      scene.fog = haze;
    } else {
      sky.removeFromParent();
      scene.background = savedBackground.clone();
      scene.fog =
        savedFog ?? new THREE.Fog(DEFAULT_BACKGROUND, DEFAULT_FOG_NEAR, DEFAULT_FOG_FAR);
      savedFog = null;
      scene.environment = null;
      envTarget?.dispose();
      envTarget = null;
    }
  }

  return {
    setEnabled,
    syncSunFromLight(light) {
      syncSun(light);
      if (enabled) bakeEnvironment();
    },
    update(dt) {
      if (!enabled) return;
      uniforms.cloudTime.value += dt * CLOUD_SPEED;
    },
    dispose() {
      setEnabled(false);
      pmrem.dispose();
      sky.geometry.dispose();
      material.dispose();
      envTarget?.dispose();
      envTarget = null;
    },
  };
}
