/**
 * Browser-side half of the gameplay-sky reproduction. Bundled by
 * scripts/validate_gameplay_sky.mjs.
 *
 * Every component test passed — the sky node is bright, the aerial composite
 * with depth 1 is bright, background depth is exactly 1.0, and the post chain
 * turns a bright sky into near-white. So this stops synthesising pieces and
 * drives the *real* `createWebGpuMainPostStack` with a real frame, sweeping the
 * camera over the sphere and the sun over elevation.
 *
 * The scene is deliberately empty: every pixel is then sky, and any black
 * result is unambiguous.
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createWebGpuMainPostStack } from '../src/render/main/post/webgpu-post-stack';
import { buildAtmosphereMesh } from '../src/render/main/scene/atmosphere-mesh';
import type { MainPostEnvironmentFrame } from '../src/render/main/post/types';
import type { Planet } from '../src/types';

const PLANET: Planet = {
  atmosphereHeightMeters: 110_000,
  radiusMeters: 6_371_000,
  terrainAmplitudeMeters: 7_500,
};
const PLANET_RENDER_SCALE = 1 / 500;
const SIZE = 64;

export interface SweepSample {
  place: string;
  sunElevationDegrees: number;
  r: number;
  g: number;
  b: number;
  /** Never measured until now: a sky with alpha 0 composites to black on the canvas. */
  a: number;
  luminance: number;
  black: boolean;
}

export interface GameplaySkyResult {
  ok: boolean;
  error?: string;
  adapter?: string;
  samples?: SweepSample[];
}

/** ECEF positions a player could plausibly spawn at. */
const PLACES: { name: string; direction: THREE.Vector3 }[] = [
  { name: 'north pole', direction: new THREE.Vector3(0, 1, 0) },
  { name: 'equator +X', direction: new THREE.Vector3(1, 0, 0) },
  { name: 'equator +Z', direction: new THREE.Vector3(0, 0, 1) },
  { name: 'mid-lat', direction: new THREE.Vector3(0.6, 0.5, 0.62).normalize() },
];

/** Sun direction at `elevation` above the local horizon at `up`. */
function sunAtElevation(up: THREE.Vector3, elevationDegrees: number): THREE.Vector3 {
  const east = new THREE.Vector3(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
  east.normalize();
  const radians = THREE.MathUtils.degToRad(elevationDegrees);
  return up
    .clone()
    .multiplyScalar(Math.sin(radians))
    .add(east.multiplyScalar(Math.cos(radians)))
    .normalize();
}

function buildFrame(
  camera: THREE.PerspectiveCamera,
  up: THREE.Vector3,
  sunElevationDegrees: number,
): MainPostEnvironmentFrame {
  const focus = up.clone().multiplyScalar(PLANET.radiusMeters);
  return {
    altitudeMeters: 2,
    atmosphereHeightMeters: PLANET.atmosphereHeightMeters,
    backgroundColor: new THREE.Color(0x6ea8d8),
    backgroundMode: 'space-skybox',
    camera,
    daylightFactor: 1,
    dt: 0.016,
    focusPosition: { x: focus.x, y: focus.y, z: focus.z },
    fogColorDay: new THREE.Color(0xb8daf2),
    fogColorNight: new THREE.Color(0x0b1526),
    nowSeconds: 0,
    planetCenter: new THREE.Vector3(0, 0, 0),
    planetFogActive: true,
    planetRadiusMeters: PLANET.radiusMeters,
    renderScale: PLANET_RENDER_SCALE,
    spaceFactor: 0,
    stationInteriorActive: false,
    sunColor: new THREE.Color(0xfff2df),
    sunDirection: sunAtElevation(up, sunElevationDegrees),
    moonDirection: sunAtElevation(up, sunElevationDegrees).negate(),
    moonOrbitNormal: new THREE.Vector3(0, -0.966, 0.259).normalize(),
    atmosphereSkyActive: true,
    volumetricEnabled: false,
  };
}

export async function run(): Promise<GameplaySkyResult> {
  if (!navigator.gpu) return { ok: false, error: 'navigator.gpu undefined' };
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return { ok: false, error: 'requestAdapter() returned null' };
  const info = adapter.info ?? ({} as Record<string, string>);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
  });
  await renderer.init();
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.35;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6ea8d8);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
  scene.add(sun);

  // Empty cloud scene: this harness bisects the atmosphere in isolation, so the
  // deck pass composites nothing and the sky is what it measures.
  const postStack = createWebGpuMainPostStack(
    renderer,
    scene,
    new THREE.Scene(),
    camera,
    PLANET,
    sun,
    PLANET_RENDER_SCALE,
  );
  postStack.resize(SIZE, SIZE, 1);

  const target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  const samples: SweepSample[] = [];

  /** Renders one configuration and records the upper-middle pixel. */
  const sample = async (
    label: string,
    elevation: number,
    frame: MainPostEnvironmentFrame,
  ): Promise<void> => {
    postStack.updateEnvironment(frame);
    renderer.setRenderTarget(target);
    for (let f = 0; f < 8; f += 1) {
      postStack.render(0.016);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const pixels = (await renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      SIZE,
      SIZE,
    )) as unknown as Float32Array;
    renderer.setRenderTarget(null);
    const index = (Math.floor(SIZE * 0.75) * SIZE + Math.floor(SIZE / 2)) * 4;
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const a = pixels[index + 3];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    samples.push({
      a,
      b,
      black: luminance < 1e-3,
      g,
      luminance,
      place: label,
      r,
      sunElevationDegrees: elevation,
    });
  };

  try {
    for (const place of PLACES) {
      for (const elevation of [70, 40, 10]) {
        const up = place.direction.clone().normalize();
        // Camera sits at the floating origin looking at the local horizon.
        const east = new THREE.Vector3(0, 1, 0).cross(up);
        if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
        east.normalize();
        camera.position.set(0, 0, 0);
        camera.up.copy(up);
        camera.lookAt(east);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        const frame = buildFrame(camera, up, elevation);
        postStack.updateEnvironment(frame);

        renderer.setRenderTarget(target);
        for (let f = 0; f < 8; f += 1) {
          postStack.render(0.016);
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        const pixels = (await renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          SIZE,
          SIZE,
        )) as unknown as Float32Array;
        renderer.setRenderTarget(null);

        // Upper-middle pixel: unambiguously above the horizon.
        const index = (Math.floor(SIZE * 0.75) * SIZE + Math.floor(SIZE / 2)) * 4;
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const a = pixels[index + 3];
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        samples.push({
          a,
          b,
          black: luminance < 1e-3,
          g,
          luminance,
          place: place.name,
          r,
          sunElevationDegrees: elevation,
        });
      }
    }

    // Control: what a wrong focusPosition looks like. If the engine ever hands
    // the atmosphere a floating-origin local position instead of the true ECEF
    // one, the camera sits at the planet's centre — this is that signature.
    const up = new THREE.Vector3(0, 1, 0);
    camera.position.set(0, 0, 0);
    camera.up.copy(up);
    camera.lookAt(new THREE.Vector3(1, 0, 0));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const degenerate = buildFrame(camera, up, 40);
    degenerate.focusPosition = { x: 0, y: 0, z: 0 };
    await sample('focus at origin', 40, degenerate);

    // Scene contents are the last systematic difference from gameplay: the
    // atmosphere shell is a BackSide sphere the camera sits inside, so it
    // covers every sky pixel in the scene pass.
    const shell = buildAtmosphereMesh(PLANET, PLANET_RENDER_SCALE);
    scene.add(shell);
    const withShellUp = new THREE.Vector3(0, 1, 0);
    camera.position.set(0, 0, 0);
    camera.up.copy(withShellUp);
    camera.lookAt(new THREE.Vector3(1, 0, 0));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    await sample('+ atmosphere shell mesh', 40, buildFrame(camera, withShellUp, 40));
    scene.remove(shell);

    // The sweep above ran at daylightFactor 1, where resolveStarPresentation
    // returns intensity 0 and StarsNode is inert. The real session logged
    // daylightFactor 0.515, which turns stars ON (intensity ~652) — the one
    // code path none of the harnesses had ever exercised.
    for (const daylight of [0.9, 0.515, 0.3]) {
      const frame = buildFrame(camera, withShellUp, 18.4);
      frame.daylightFactor = daylight;
      await sample(`daylight ${daylight} (stars)`, 18.4, frame);
    }
  } catch (error) {
    return {
      ok: false,
      error: `${(error as Error).message} (completed ${samples.length})`,
      samples,
    };
  } finally {
    target.dispose();
    postStack.dispose();
    renderer.dispose();
  }

  return {
    adapter: `${info.vendor ?? '?'}/${info.architecture ?? '?'}`,
    ok: true,
    samples,
  };
}
