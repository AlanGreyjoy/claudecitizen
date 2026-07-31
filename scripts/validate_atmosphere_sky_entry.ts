/**
 * Browser-side half of the atmosphere-sky bisect. Bundled by
 * scripts/validate_atmosphere_sky.mjs and inlined into a page Electron loads.
 *
 * Why this exists: the gameplay sky renders pure black in daylight, takram
 * throws nothing, and no amount of reading `webgpu-atmosphere.ts` settles which
 * assumption is wrong. So instead of guessing, this starts from takram's own
 * defaults — the configuration their examples ship — and adds one piece of our
 * integration per stage. The first stage that goes black names the culprit.
 *
 * Each stage renders `sky()` alone through a full-screen quad and reports the
 * mean RGB of the upper half of the frame (the part that must be sky, never
 * ground). No scene, no depth, no aerial perspective: if the sky is black here,
 * nothing downstream can save it.
 */
import * as THREE from 'three';
import { NodeMaterial, PostProcessing, WebGPURenderer } from 'three/webgpu';
import { float, mrt, normalView, output, pass, vec3, vec4 } from 'three/tsl';
import {
  AerialPerspectiveNode,
  AtmosphereContext,
  AtmosphereParameters,
  sky,
} from '@takram/three-atmosphere/webgpu';
import { Ellipsoid } from '@takram/three-geospatial';

/** Matches the project's asteron.planet.json. */
const PLANET_RADIUS_METERS = 6_371_000;
const PLANET_ATMOSPHERE_METERS = 110_000;
const GROUND_ALBEDO = new THREE.Color(0x56704b);
/** src/render/planet_tiles/domain/constants.ts */
const PLANET_RENDER_SCALE = 1 / 500;

const SIZE = 64;

export interface StageResult {
  name: string;
  detail: string;
  meanR: number;
  meanG: number;
  meanB: number;
  luminance: number;
  black: boolean;
}

export interface SkyValidateResult {
  ok: boolean;
  error?: string;
  adapter?: string;
  stages?: StageResult[];
}

interface StageConfig {
  name: string;
  detail: string;
  /** Applied to the context before rendering. */
  configure: (context: AtmosphereContext, camera: THREE.PerspectiveCamera) => void;
  parameters: () => AtmosphereParameters;
  /**
   * Wrap the sky in the same `AerialPerspectiveNode` the gameplay stack uses,
   * fed a synthetic far-plane depth. Isolates the composite from the sky.
   */
  throughAerial?: boolean;
}

/** takram's own defaults: Earth, no overrides at all. */
function defaultParameters(): AtmosphereParameters {
  return new AtmosphereParameters();
}

/** What `createAtmosphereContext` in webgpu-atmosphere.ts builds. */
function projectParameters(): AtmosphereParameters {
  const parameters = new AtmosphereParameters();
  parameters.bottomRadius = PLANET_RADIUS_METERS;
  parameters.topRadius = PLANET_RADIUS_METERS + PLANET_ATMOSPHERE_METERS;
  parameters.groundAlbedo.set(GROUND_ALBEDO.r, GROUND_ALBEDO.g, GROUND_ALBEDO.b);
  parameters.update();
  return parameters;
}

/**
 * Camera standing on the surface looking at the horizon, sun high behind it.
 * `positionScale` mimics our floating-origin surrogate: the gameplay camera
 * lives near the origin in render units and is multiplied back up to meters.
 */
function placeCamera(
  camera: THREE.PerspectiveCamera,
  positionMeters: THREE.Vector3,
): void {
  camera.fov = 60;
  camera.aspect = 1;
  camera.near = 0.5;
  camera.far = 1_000_000;
  camera.position.copy(positionMeters);
  // Look along +X at the horizon, so the upper half of the frame is sky.
  camera.up.set(0, 1, 0);
  camera.lookAt(
    positionMeters.x + 1_000,
    positionMeters.y,
    positionMeters.z,
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/** Sun 40 degrees above the horizon — unambiguous daylight. */
const SUN_DIRECTION = new THREE.Vector3(
  Math.cos(THREE.MathUtils.degToRad(40)),
  Math.sin(THREE.MathUtils.degToRad(40)),
  0,
).normalize();

function buildStages(): StageConfig[] {
  return [
    {
      name: 'takram defaults',
      detail: 'their AtmosphereParameters, camera in ECEF metres, identity world->ECEF',
      parameters: defaultParameters,
      configure(context, camera) {
        // Stand on the surface of takram's default Earth, in true ECEF.
        placeCamera(
          camera,
          new THREE.Vector3(0, context.parameters.bottomRadius + 2, 0),
        );
        context.sunDirectionECEF.value.copy(SUN_DIRECTION);
      },
    },
    {
      name: '+ our planet parameters',
      detail: `bottomRadius ${PLANET_RADIUS_METERS}, topRadius +${PLANET_ATMOSPHERE_METERS}, groundAlbedo`,
      parameters: projectParameters,
      configure(context, camera) {
        placeCamera(
          camera,
          new THREE.Vector3(0, context.parameters.bottomRadius + 2, 0),
        );
        context.sunDirectionECEF.value.copy(SUN_DIRECTION);
      },
    },
    {
      name: '+ our context flags',
      detail: 'sphere Ellipsoid, correctAltitude, showGround=false, raymarchScattering',
      parameters: projectParameters,
      configure(context, camera) {
        context.ellipsoid = new Ellipsoid(
          PLANET_RADIUS_METERS,
          PLANET_RADIUS_METERS,
          PLANET_RADIUS_METERS,
        );
        context.correctAltitude = true;
        context.showGround = false;
        context.accurateShadowScattering = false;
        context.raymarchScattering = true;
        placeCamera(
          camera,
          new THREE.Vector3(0, context.parameters.bottomRadius + 2, 0),
        );
        context.sunDirectionECEF.value.copy(SUN_DIRECTION);
      },
    },
    {
      name: '+ floating-origin ECEF translation',
      detail: 'camera near origin, matrixWorldToECEF = translate(focus), scale 1/500',
      parameters: projectParameters,
      configure(context, camera) {
        context.ellipsoid = new Ellipsoid(
          PLANET_RADIUS_METERS,
          PLANET_RADIUS_METERS,
          PLANET_RADIUS_METERS,
        );
        context.correctAltitude = true;
        context.showGround = false;
        context.accurateShadowScattering = false;
        context.raymarchScattering = true;

        // The gameplay arrangement: the real camera sits a few render units
        // above the origin, the planet's surface point is the focus, and
        // webgpu-atmosphere.ts multiplies the camera back up by 1/renderScale.
        const focus = new THREE.Vector3(0, PLANET_RADIUS_METERS, 0);
        const cameraRenderUnits = new THREE.Vector3(0, 2 * PLANET_RENDER_SCALE, 0);
        placeCamera(
          camera,
          cameraRenderUnits.clone().multiplyScalar(1 / PLANET_RENDER_SCALE),
        );
        context.matrixWorldToECEF.value.makeTranslation(focus.x, focus.y, focus.z);
        context.sunDirectionECEF.value.copy(SUN_DIRECTION);
      },
    },
    {
      name: '+ through AerialPerspectiveNode',
      detail: 'same config, sky reached via aerialNode.skyNode with depth = 1.0 (far plane)',
      parameters: projectParameters,
      throughAerial: true,
      configure(context, camera) {
        context.ellipsoid = new Ellipsoid(
          PLANET_RADIUS_METERS,
          PLANET_RADIUS_METERS,
          PLANET_RADIUS_METERS,
        );
        context.correctAltitude = true;
        context.showGround = false;
        context.accurateShadowScattering = false;
        context.raymarchScattering = true;
        const focus = new THREE.Vector3(0, PLANET_RADIUS_METERS, 0);
        const cameraRenderUnits = new THREE.Vector3(0, 2 * PLANET_RENDER_SCALE, 0);
        placeCamera(
          camera,
          cameraRenderUnits.clone().multiplyScalar(1 / PLANET_RENDER_SCALE),
        );
        context.matrixWorldToECEF.value.makeTranslation(focus.x, focus.y, focus.z);
        context.sunDirectionECEF.value.copy(SUN_DIRECTION);
      },
    },
  ];
}

async function renderStage(
  renderer: WebGPURenderer,
  target: THREE.RenderTarget,
  stage: StageConfig,
): Promise<StageResult> {
  const context = new AtmosphereContext(stage.parameters());
  const camera = new THREE.PerspectiveCamera();
  context.camera = camera;
  stage.configure(context, camera);

  const rendererContext = (
    renderer as unknown as {
      contextNode: { value: { getAtmosphere?: () => AtmosphereContext } };
    }
  ).contextNode.value;
  rendererContext.getAtmosphere = () => context;

  const skyNode = sky();
  skyNode.showSun = false;
  skyNode.showMoon = false;
  skyNode.showStars = false;

  const postProcessing = new PostProcessing(renderer);
  postProcessing.outputColorTransform = false;
  if (stage.throughAerial) {
    // Black input, depth pinned at the far plane, flat normal: every pixel is
    // sky as far as the composite is concerned. Anything black out of this is
    // the composite's doing, not the sky's.
    const aerialNode = new AerialPerspectiveNode(
      vec4(0, 0, 0, 1),
      float(1),
      vec3(0, 1, 0),
    );
    aerialNode.skyNode = skyNode;
    aerialNode.lighting = false;
    aerialNode.transmittance = true;
    aerialNode.inscattering = true;
    aerialNode.correctGeometricError = true;
    postProcessing.outputNode = aerialNode;
  } else {
    postProcessing.outputNode = vec4(skyNode, 1);
  }

  renderer.setRenderTarget(target);
  // Several frames: the LUT compute is dispatched from updateBefore and its
  // texture upload resolves asynchronously, so the first frame is legitimately
  // empty and would fail every stage identically.
  for (let frame = 0; frame < 12; frame += 1) {
    postProcessing.render();
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  const pixels = await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    SIZE,
    SIZE,
  );
  renderer.setRenderTarget(null);

  // Upper half only. The lower half can legitimately be ground or below the
  // horizon; a mean over the whole frame would hide a working sky.
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const data = pixels as unknown as Float32Array | Uint8Array;
  const scale = data instanceof Uint8Array ? 1 / 255 : 1;
  for (let y = Math.floor(SIZE / 2); y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const index = (y * SIZE + x) * 4;
      r += data[index] * scale;
      g += data[index + 1] * scale;
      b += data[index + 2] * scale;
      count += 1;
    }
  }
  r /= count;
  g /= count;
  b /= count;

  postProcessing.dispose();
  skyNode.dispose();
  context.dispose();

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    black: luminance < 1e-4,
    detail: stage.detail,
    luminance,
    meanB: b,
    meanG: g,
    meanR: r,
    name: stage.name,
  };
}

/**
 * Measures what the gameplay scene pass actually writes to depth at pixels with
 * no geometry — the value `AerialPerspectiveNode` tests with `>= 1` to decide
 * "this is sky". Reproduces the two things that could perturb it: a
 * `logarithmicDepthBuffer` renderer and an MRT scene pass.
 */
async function measureBackgroundDepth(): Promise<StageResult> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    logarithmicDepthBuffer: true,
  });
  await renderer.init();
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x224466);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const depthNode = scenePass.getTextureNode('depth');

  const postProcessing = new PostProcessing(renderer);
  postProcessing.outputColorTransform = false;
  // Depth straight out as red, so the readback is the raw stored value.
  postProcessing.outputNode = vec4(depthNode, depthNode, depthNode, 1);

  const target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  renderer.setRenderTarget(target);
  for (let frame = 0; frame < 4; frame += 1) {
    postProcessing.render();
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE);
  renderer.setRenderTarget(null);
  const data = pixels as unknown as Float32Array;
  const centre = data[(Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2)) * 4];

  target.dispose();
  postProcessing.dispose();
  renderer.dispose();

  return {
    black: centre < 1,
    detail:
      'logarithmicDepthBuffer + MRT scene pass, empty scene. AerialPerspectiveNode needs >= 1 here.',
    luminance: centre,
    meanB: centre,
    meanG: centre,
    meanR: centre,
    name: 'background depth value',
  };
}

export async function run(): Promise<SkyValidateResult> {
  if (!navigator.gpu) return { ok: false, error: 'navigator.gpu undefined' };
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return { ok: false, error: 'requestAdapter() returned null' };
  const info = adapter.info ?? ({} as Record<string, string>);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.NoToneMapping;

  const target = new THREE.RenderTarget(SIZE, SIZE, {
    type: THREE.HalfFloatType,
  });

  const stages: StageResult[] = [];
  try {
    for (const stage of buildStages()) {
      stages.push(await renderStage(renderer, target, stage));
    }
  } catch (error) {
    return {
      ok: false,
      error: `${(error as Error).message} (completed ${stages.length} stages)`,
      stages,
    };
  } finally {
    target.dispose();
    renderer.dispose();
  }

  try {
    stages.push(await measureBackgroundDepth());
  } catch (error) {
    return { ok: false, error: `depth probe: ${(error as Error).message}`, stages };
  }

  return {
    adapter: `${info.vendor ?? '?'}/${info.architecture ?? '?'}`,
    ok: true,
    stages,
  };
}

// Referenced so an unused-import lint cannot drop the material import that
// keeps `three/webgpu` node materials registered in the bundle.
void NodeMaterial;
