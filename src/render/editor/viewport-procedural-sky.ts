import * as THREE from 'three';
import { NodeMaterial, PMREMGenerator, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  dot,
  float,
  floor,
  fract,
  mix,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
  cameraPosition,
  positionWorld,
} from 'three/tsl';
import type TslBaseNode from 'three/src/nodes/core/Node.js';

/**
 * A TSL value with the operator-chaining methods attached.
 *
 * `Fn`'s tuple overload cannot infer its parameter types from a bare destructure
 * — without an explicit generic TypeScript picks the `(builder: NodeBuilder)`
 * overload instead and the destructure fails to compile. So every `Fn` below
 * names its parameter tuple.
 */
type Tsl = TslBaseNode;

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
 *
 * Written in TSL rather than GLSL because `WebGPURenderer` only consumes node
 * materials. Two notes on the port from the previous `ShaderMaterial`:
 *
 * - The old fragment shader ended with `#include <tonemapping_fragment>` and
 *   `#include <colorspace_fragment>`. Those are `WebGLRenderer` chunks. Under
 *   `WebGPURenderer` tone mapping and color space conversion run as a separate
 *   output pass, so re-applying them here would double-grade the sky.
 * - Base `NodeMaterial` with `fragmentNode` rather than `MeshBasicNodeMaterial`:
 *   it bypasses the lighting and environment pipeline outright. That matches the
 *   old unlit `ShaderMaterial`, and it matters here specifically because this
 *   module writes `scene.environment` from its own PMREM bake of this very dome —
 *   an env-sampling sky material would feed back into itself.
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

/** Rec. 709 luma weights, for the pre-AgX chroma compensation. */
const LUMA = vec3(0.2126, 0.7152, 0.0722);

const hash21 = Fn<[Tsl]>(([source]) => {
  const p = fract(source.mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
});

const valueNoise = Fn<[Tsl]>(([p]) => {
  const cell = floor(p).toVar();
  const f = fract(p).toVar();
  // Smoothstep weights: f * f * (3 - 2f).
  const u = f.mul(f).mul(float(3).sub(f.mul(2))).toVar();
  const a = hash21(cell);
  const b = hash21(cell.add(vec2(1, 0)));
  const c = hash21(cell.add(vec2(0, 1)));
  const d = hash21(cell.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

const fbm = Fn<[Tsl]>(([source]) => {
  const p = source.toVar();
  const value = float(0).toVar();
  const amplitude = float(0.5).toVar();
  Loop(4, () => {
    value.addAssign(amplitude.mul(valueNoise(p)));
    // GLSL was `p = mat2(0.80, 0.60, -0.60, 0.80) * p * 2.03`. That literal is
    // column-major, so the rows are (0.80, -0.60) and (0.60, 0.80). Written out
    // by hand because TSL's `mat2()` accepts a Matrix2 or a Node, never four
    // scalars — and spelling it out removes any doubt about which way it rotates.
    p.assign(
      vec2(
        p.x.mul(0.8).sub(p.y.mul(0.6)),
        p.x.mul(0.6).add(p.y.mul(0.8)),
      ).mul(2.03),
    );
    amplitude.mulAssign(0.5);
  });
  return value;
});

function smoothstepScalar(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function createViewportProceduralSky(
  scene: THREE.Scene,
  renderer: WebGPURenderer,
  sunLight: THREE.DirectionalLight,
): ViewportProceduralSky {
  // Same shape and property names as the old `ShaderMaterial` uniforms object, so
  // the grading code below is unchanged — TSL uniform nodes also expose `.value`.
  const uniforms = {
    sunDirection: uniform(new THREE.Vector3(0.4, 0.85, 0.3).normalize()),
    zenithColor: uniform(new THREE.Color()),
    horizonColor: uniform(new THREE.Color()),
    groundColor: uniform(new THREE.Color()),
    sunColor: uniform(new THREE.Color()),
    cloudLitColor: uniform(new THREE.Color()),
    cloudShadowColor: uniform(new THREE.Color()),
    horizonFalloff: uniform(3),
    sunIntensity: uniform(14),
    sunGlowIntensity: uniform(1),
    // ~1.2 deg angular radius: physically fat, but readable like Unreal's.
    sunAngularCos: uniform(Math.cos(THREE.MathUtils.degToRad(1.2))),
    cloudCoverage: uniform(0.52),
    cloudOpacity: uniform(0.85),
    cloudTime: uniform(0),
    skySaturation: uniform(1.45),
  };

  const skyColor = Fn(() => {
    const dir = positionWorld.sub(cameraPosition).normalize().toVar();
    const flatDir = dir.xz.add(1e-5).normalize().toVar();
    const flatSun = uniforms.sunDirection.xz.add(1e-5).normalize().toVar();
    const cosSun = dot(dir, uniforms.sunDirection).toVar();

    // Unreal's gradient: pow(1 - saturate(height), HorizonFalloff), zenith -> horizon.
    const gradient = dir.y.saturate().oneMinus().pow(uniforms.horizonFalloff).toVar();
    const color = mix(uniforms.zenithColor, uniforms.horizonColor, gradient).toVar();

    // Horizon warms toward the sun's azimuth, strongest at low sun.
    color.addAssign(
      uniforms.sunColor
        .mul(gradient)
        .mul(dot(flatDir, flatSun).max(0).pow(3))
        .mul(0.22)
        .mul(uniforms.sunGlowIntensity),
    );

    // Two-lobe Mie halo, then the disk itself. Both sit under the cloud layer.
    const towardSun = cosSun.max(0).toVar();
    color.addAssign(
      uniforms.sunColor
        .mul(towardSun.pow(20).mul(0.5).add(towardSun.pow(400).mul(1.6)))
        .mul(uniforms.sunGlowIntensity),
    );
    const disk = smoothstep(
      uniforms.sunAngularCos,
      mix(uniforms.sunAngularCos, 1.0, 0.4),
      cosSun,
    ).toVar();
    color.addAssign(uniforms.sunColor.mul(disk).mul(uniforms.sunIntensity));

    If(uniforms.cloudOpacity.greaterThan(0.001).and(dir.y.greaterThan(0.005)), () => {
      // Project onto a flat cloud deck so layers converge at the horizon.
      const deck = dir.xz
        .div(dir.y.max(0.02))
        .mul(0.55)
        .add(vec2(uniforms.cloudTime, uniforms.cloudTime.mul(0.4)))
        .toVar();
      const density = fbm(deck).toVar();
      const cover = smoothstep(
        uniforms.cloudCoverage,
        uniforms.cloudCoverage.add(0.28),
        density,
      ).toVar();
      // Cheap self-shadowing: compare against a sample stepped toward the sun.
      const lit = fbm(deck.add(flatSun.mul(0.35))).toVar();
      const shade = density.sub(lit).mul(2.2).add(0.55).saturate().toVar();
      const cloud = mix(uniforms.cloudShadowColor, uniforms.cloudLitColor, shade).toVar();
      cloud.addAssign(
        uniforms.sunColor
          .mul(towardSun.pow(8))
          .mul(shade.oneMinus())
          .mul(0.35)
          .mul(uniforms.sunGlowIntensity),
      );
      color.assign(
        mix(
          color,
          cloud,
          cover.mul(uniforms.cloudOpacity).mul(smoothstep(0.02, 0.22, dir.y)),
        ),
      );
    });

    // Flat ground half with a short blend so the horizon line stays crisp.
    const ground = mix(
      uniforms.horizonColor.mul(0.55),
      uniforms.groundColor,
      smoothstep(-0.25, 0.0, dir.y).oneMinus(),
    ).toVar();
    color.assign(mix(color, ground, smoothstep(-0.04, 0.0, dir.y).oneMinus()));

    // AgX pulls a lot of chroma out of the blues; pre-compensate before grading.
    const luma = dot(color, LUMA).toVar();
    color.assign(mix(vec3(luma), color, uniforms.skySaturation).max(0));

    return vec4(color, 1.0);
  });

  const material = new NodeMaterial();
  material.fragmentNode = skyColor();
  material.side = THREE.BackSide;
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;

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

  // `three/webgpu`'s PMREMGenerator, not `three`'s. They are different classes:
  // the one on the THREE namespace reaches into `renderer.state.buffers` and
  // throws "Cannot read properties of undefined (reading 'buffers')" the moment
  // it is handed a WebGPURenderer. This one takes a `Renderer` directly, so it
  // also needs no cast, and exposes the same fromScene() signature.
  const pmrem = new PMREMGenerator(renderer);
  const bakeScene = new THREE.Scene();
  const hazeColor = new THREE.Color();
  const scratch = new THREE.Color();

  let enabled = false;
  let envTarget: THREE.RenderTarget | null = null;
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
    const dayMix = smoothstepScalar(-0.02, 0.22, height);
    const nightMix = smoothstepScalar(0.02, -0.16, height);

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

    const above = smoothstepScalar(-0.09, 0.06, height);
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
