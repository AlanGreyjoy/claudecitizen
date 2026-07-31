import * as THREE from 'three';
import type { Node, WebGPURenderer } from 'three/webgpu';
import {
  AerialPerspectiveNode,
  AtmosphereContext,
  AtmosphereParameters,
  StarsNode,
  sky,
} from '@takram/three-atmosphere/webgpu';
import { Ellipsoid } from '@takram/three-geospatial';
import type { Planet } from '../../../types';
import type { MainPostEnvironmentFrame } from './types';

const STARS_LOCAL_URL = new URL('../../../assets/stars.bin', import.meta.url).href;
const GROUND_ALBEDO = new THREE.Color(0x56704b);
const STAR_INTENSITY_SCALE = 1_000;

export interface WebGpuAtmospherePost {
  node: Node;
  dispose: () => void;
  update: (frame: MainPostEnvironmentFrame, pixelRatio: number) => void;
}

interface StarPresentation {
  intensity: number;
  pointSize: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolveStarPresentation(
  daylightFactor: number,
  spaceFactor: number,
): StarPresentation {
  const nightFactor = 1 - daylightFactor;
  const surfaceFactor = 1 - clamp01(spaceFactor);
  const daylightSuppression =
    1 - clamp01((daylightFactor - 0.38) / 0.2) * surfaceFactor;
  const nightSurface = nightFactor * (1 - spaceFactor * 0.25);
  const orbit = spaceFactor;
  const strength =
    clamp01(Math.max(nightSurface, orbit * 0.85)) * daylightSuppression;
  const visible = strength > 0.04;

  return {
    // StarsNode is physically scaled and defaults to 1000. Preserve the
    // existing star field's relative day/night curve in that unit range.
    intensity: visible
      ? (0.55 + strength * 0.65 + orbit * 0.9) * STAR_INTENSITY_SCALE
      : 0,
    pointSize: 1.5 + strength * 0.7 + orbit * 0.9,
  };
}

function createAtmosphereContext(planet: Planet): AtmosphereContext {
  const parameters = new AtmosphereParameters();
  parameters.bottomRadius = planet.radiusMeters;
  parameters.topRadius = planet.radiusMeters + planet.atmosphereHeightMeters;
  parameters.groundAlbedo.set(
    GROUND_ALBEDO.r,
    GROUND_ALBEDO.g,
    GROUND_ALBEDO.b,
  );
  parameters.update();

  const context = new AtmosphereContext(parameters);
  context.ellipsoid = new Ellipsoid(
    planet.radiusMeters,
    planet.radiusMeters,
    planet.radiusMeters,
  );
  context.correctAltitude = true;
  context.showGround = false;
  context.accurateShadowScattering = false;
  context.raymarchScattering = true;
  return context;
}

/**
 * Creates Takram's WebGPU atmosphere graph around the scene pass.
 *
 * Depth was rendered from the floating-origin, render-scaled game camera.
 * A proportional meter-space surrogate preserves the same normalized depth
 * while `matrixWorldToECEF` restores the simulation focus translation.
 *
 * Takram 0.19+ reads atmosphere state from the renderer's global
 * `contextNode` (`getAtmosphere`), not from a local `.context()` wrap — LUT
 * compute, StarsNode, and SkyNode all build outside the aerial node subtree.
 */
export function createWebGpuAtmospherePost(
  renderer: WebGPURenderer,
  inputColor: Node,
  depth: Node,
  normal: Node,
  planet: Planet,
): WebGpuAtmospherePost {
  const atmosphereContext = createAtmosphereContext(planet);
  const atmosphereCamera = new THREE.PerspectiveCamera();
  atmosphereContext.camera = atmosphereCamera;

  // `Renderer.contextNode` exists in three 0.182 (`Renderer.js:232`) but is
  // absent from @types/three 0.182. Cast narrowly rather than widening the
  // renderer type, so a real signature change still surfaces here.
  const rendererContext = (
    renderer as unknown as {
      contextNode: { value: { getAtmosphere?: () => AtmosphereContext } };
    }
  ).contextNode.value;
  const previousGetAtmosphere = rendererContext.getAtmosphere;
  rendererContext.getAtmosphere = () => atmosphereContext;

  const starsNode = new StarsNode(STARS_LOCAL_URL);
  starsNode.intensity.value = 0;
  starsNode.pointSize.value = 1.5;
  starsNode.magnitudeRange.value.set(-1.5, 6.5);

  const skyNode = sky();
  skyNode.showSun = false;
  skyNode.showMoon = false;
  skyNode.showStars = true;
  skyNode.starsNode = starsNode;

  const aerialNode = new AerialPerspectiveNode(inputColor, depth, normal);
  aerialNode.skyNode = skyNode;
  // Three's scene lights already shade the beauty pass. The atmosphere should
  // add transmittance/inscattering without applying a second Lambert response.
  aerialNode.lighting = false;
  aerialNode.transmittance = true;
  aerialNode.inscattering = true;
  aerialNode.correctGeometricError = true;

  const cameraWorldPosition = new THREE.Vector3();
  const cameraWorldQuaternion = new THREE.Quaternion();

  let lutComputeRequested = false;

  /**
   * Dispatches the atmosphere LUT compute once, as soon as the node graph
   * exists.
   *
   * Those tables multiply every transmittance and scattering lookup, so until
   * they are filled the sky is black however correct the camera, sun and depth
   * are. `AtmosphereLUTNode` normally dispatches them from its own
   * `updateBefore`, inside the frame's node traversal several render targets
   * deep — and that did not happen in Planet Authoring Test Play, which keeps
   * the editor viewport *and* the planet preview rendering alongside the game.
   * The same planet played from the Scene tab, with one less renderer live, was
   * fine. Sampling the transmittance LUT directly confirmed it: a smooth ramp
   * from the Scene tab, pure black from Test Play.
   *
   * `updateTextures` asserts `textures != null`, and `textures` is created in
   * `setup()` — so this cannot run at construction (it throws "Invariant
   * failed") and must wait for the first build. Hence the poll: `update()` runs
   * every frame, and the first one after the graph compiles wins.
   */
  function ensureLutCompute(): void {
    if (lutComputeRequested) return;
    // `textures` is private; there is no public "has it been built" signal, and
    // calling before setup() throws rather than returning a rejected promise.
    const built =
      (atmosphereContext.lutNode as unknown as { textures?: unknown })
        .textures != null;
    if (!built) return;
    lutComputeRequested = true;
    void atmosphereContext.lutNode
      .updateTextures(renderer)
      .catch((error: unknown) => {
        console.error('ClaudeCitizen atmosphere LUT compute failed.', error);
      });
  }

  function update(
    frame: MainPostEnvironmentFrame,
    pixelRatio: number,
  ): void {
    const inverseRenderScale = 1 / Math.max(frame.renderScale, 0.000001);
    frame.camera.getWorldPosition(cameraWorldPosition);
    frame.camera.getWorldQuaternion(cameraWorldQuaternion);

    atmosphereCamera.position
      .copy(cameraWorldPosition)
      .multiplyScalar(inverseRenderScale);
    atmosphereCamera.quaternion.copy(cameraWorldQuaternion);
    atmosphereCamera.fov = frame.camera.fov;
    atmosphereCamera.aspect = frame.camera.aspect;
    atmosphereCamera.near = Math.max(
      frame.camera.near * inverseRenderScale,
      0.5,
    );
    atmosphereCamera.far = Math.max(
      frame.camera.far * inverseRenderScale,
      200_000,
    );
    atmosphereCamera.updateProjectionMatrix();
    atmosphereCamera.updateMatrixWorld(true);

    atmosphereContext.matrixWorldToECEF.value.makeTranslation(
      frame.focusPosition.x,
      frame.focusPosition.y,
      frame.focusPosition.z,
    );
    atmosphereContext.sunDirectionECEF.value
      .copy(frame.sunDirection)
      .normalize();
    atmosphereContext.moonDirectionECEF.value
      .copy(frame.sunDirection)
      .negate()
      .normalize();

    const stars = resolveStarPresentation(
      frame.daylightFactor,
      frame.spaceFactor,
    );
    starsNode.intensity.value = stars.intensity;
    starsNode.pointSize.value = stars.pointSize * pixelRatio;

    ensureLutCompute();
  }

  return {
    node: aerialNode,
    dispose() {
      if (previousGetAtmosphere) {
        rendererContext.getAtmosphere = previousGetAtmosphere;
      } else {
        delete rendererContext.getAtmosphere;
      }
      aerialNode.dispose();
      starsNode.dispose();
      atmosphereContext.dispose();
    },
    update,
  };
}
