// Side-effect first: remap requestIdleCallback before takram captures it.
import './atmosphere-idle-bypass';

import * as THREE from 'three';
import {
  NodeUpdateType,
  type Node,
  type NodeFrame,
  type WebGPURenderer,
} from 'three/webgpu';
import { Fn, float, texture as textureNode } from 'three/tsl';
import {
  AerialPerspectiveNode,
  AtmosphereContext,
  AtmosphereParameters,
  StarsNode,
  sky,
} from '@takram/three-atmosphere/webgpu';
import { Ellipsoid } from '@takram/three-geospatial';
import type { Planet } from '../../../types';
import type { PlanetSkyRecipe } from '../../../world/planets/sky-schema';
import { resolveSkyPalette, resolveSkyRecipe } from '../domain/sky-recipe';
import { createMoonSurfaceTexture } from '../scene/moon-texture';
import type { MainPostEnvironmentFrame } from './types';
// Vite rewrites `?url` to a fetchable asset path under both editor HMR and
// Build Web. `new URL(..., import.meta.url)` alone has failed under
// `cceditor://` and poisoned the catalog with an empty buffer.
import starsDataUrl from '../../../assets/stars.bin?url';

interface AtmosphereLutNodeSync {
  textures?: object;
  version: number;
  currentVersion?: number;
  updating: boolean;
  updateBeforeType: string;
  updateBefore: (frame: NodeFrame) => void;
  updateTextures: (renderer: WebGPURenderer) => Promise<void>;
}

/** AgX + sparse point samples need more punch than takram's default 1000. */
const STAR_INTENSITY_SCALE = 4_000;
/** AgX post stack: Bruneton default luminanceScale reads near-black in daylight. */
const AGX_SKY_LUMINANCE_CALIBRATION = 6;

let starsCatalog: ArrayBuffer | null = null;
let starsCatalogPromise: Promise<ArrayBuffer> | null = null;

/**
 * StarsNode's URL path loads inside `setup()` and can leave the material
 * unbound for the first frames — that has blacked out the whole SkyNode
 * luminance. Prefetch the catalog and construct with an ArrayBuffer instead.
 */
export function ensureStarsCatalog(): Promise<ArrayBuffer> {
  if (starsCatalog && starsCatalog.byteLength > 0) {
    return Promise.resolve(starsCatalog);
  }
  starsCatalogPromise ??= fetch(starsDataUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`stars.bin HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((data) => {
      if (data.byteLength < 10) {
        throw new Error('stars.bin is empty');
      }
      starsCatalog = data;
      return data;
    })
    .catch((error: unknown) => {
      starsCatalogPromise = null;
      console.error('[atmosphere] Failed to load stars.bin.', error);
      throw error;
    });
  return starsCatalogPromise;
}

// Kick the fetch off at import so Play usually finds it already warm.
void ensureStarsCatalog().catch(() => {
  /* logged above; createWebGpuMainPostStack awaits a retry */
});

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
  recipe: PlanetSkyRecipe,
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
      ? (0.55 + strength * 0.65 + orbit * 0.9) *
        STAR_INTENSITY_SCALE *
        recipe.stars.intensity
      : 0,
    pointSize: recipe.stars.pointSize * (1 + strength * 0.45 + orbit * 0.6),
  };
}

/**
 * Builds the scattering model from the planet's authored `sky.atmosphere`.
 *
 * Bruneton's solver derives the entire sky — daytime blue, the sunset gradient,
 * aerial perspective on distant terrain, and the twilight wedge — from these
 * coefficients, so this is where a world stops looking like Earth. Tinting
 * Rayleigh moves the daytime hue; Mie density and anisotropy own the haze and
 * the glow around the sun.
 */
function createAtmosphereContext(
  planet: Planet,
  recipe: PlanetSkyRecipe,
): AtmosphereContext {
  const palette = resolveSkyPalette(recipe);
  const parameters = new AtmosphereParameters();
  parameters.bottomRadius = planet.radiusMeters;
  parameters.topRadius = planet.radiusMeters + planet.atmosphereHeightMeters;
  parameters.groundAlbedo.set(
    palette.groundAlbedo.r,
    palette.groundAlbedo.g,
    palette.groundAlbedo.b,
  );
  parameters.rayleighScattering.copy(palette.rayleighScattering);
  parameters.mieScattering.copy(palette.mieScattering);
  parameters.mieExtinction.copy(palette.mieExtinction);
  parameters.miePhaseFunctionG = recipe.atmosphere.mieAnisotropy;
  parameters.sunAngularRadius = palette.sunAngularRadius;
  const spectrum = palette.sunSpectrum;
  if (
    Number.isFinite(spectrum.x)
    && Number.isFinite(spectrum.y)
    && Number.isFinite(spectrum.z)
    && spectrum.x + spectrum.y + spectrum.z > 1e-6
  ) {
    parameters.solarIrradiance.multiply(spectrum);
  }
  parameters.update();
  const brightness = recipe.atmosphere.skyBrightness;
  if (Number.isFinite(brightness) && brightness > 0) {
    parameters.luminanceScale *= brightness;
  }
  // Bruneton's luminanceScale targets a filmic display path. AgX in our post
  // stack compresses that range to near-black daylight; this keeps daytime sky
  // readable without changing authored skyBrightness semantics (still a trim).
  parameters.luminanceScale *= AGX_SKY_LUMINANCE_CALIBRATION;
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
 * Orients the moon's texture so the same face always points at the planet.
 *
 * `MoonNode` samples its color map at `equirectUV((M^T · n).xzy)`, which puts
 * the texture's center at moon-fixed `(-1, 0, 0)` and its pole on moon-fixed
 * `+Z`. Tidal locking is therefore just: first basis column = the direction to
 * the moon, third column = the orbit normal. Without this the moon spins
 * through its own texture as it crosses the sky.
 */
function updateMoonFixedFrame(
  matrix: THREE.Matrix4,
  moonDirection: THREE.Vector3,
  orbitNormal: THREE.Vector3,
  scratchX: THREE.Vector3,
  scratchY: THREE.Vector3,
  scratchZ: THREE.Vector3,
): void {
  scratchX.copy(moonDirection).normalize();
  scratchZ.copy(orbitNormal).normalize();
  scratchY.crossVectors(scratchZ, scratchX).normalize();
  // Re-orthogonalize: the authored orbit normal and direction are exact here,
  // but a degenerate pair would otherwise leave a skewed basis.
  scratchZ.crossVectors(scratchX, scratchY).normalize();
  matrix.makeBasis(scratchX, scratchY, scratchZ);
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
 * compute, StarsNode, SunNode, MoonNode, and SkyNode all build outside the
 * aerial node subtree.
 *
 * The sky's sun and moon are drawn by `SkyNode`, not by scene meshes: only the
 * sky pass has the transmittance LUT needed to redden the disc at the horizon,
 * and `MoonNode` shades its texture with a real Oren–Nayar phase term. The
 * scene-space bodies in `scene-lighting.ts` cover the orbital view, where this
 * sky is suppressed.
 *
 * LUT fill: takram idle-slices via `requestIdleCallback` (captured inside the
 * Vite prebundle). Play's RAF never idles, so we replace `lutNode.updateBefore`
 * with a synchronous four-pass compute that still calls `dispatchUpdate` so
 * SkyNode's storage texture nodes see the fill. `atmosphere-idle-bypass.ts`
 * remains as belt-and-braces for any other idle-sliced path.
 *
 * Depth: WebGPU empty-depth texels read ~0 here while AerialPerspective's sky
 * gate expects conventional far = 1 (`renderer.reversedDepthBuffer` is unset
 * on WebGPURenderer). Remap cleared texels to 1 before the aerial node.
 */
export function createWebGpuAtmospherePost(
  renderer: WebGPURenderer,
  inputColor: Node,
  depth: Node,
  normal: Node,
  cloudColor: Node,
  planet: Planet,
): WebGpuAtmospherePost {
  const skyRecipe = resolveSkyRecipe();
  const skyPalette = resolveSkyPalette(skyRecipe);
  const atmosphereContext = createAtmosphereContext(planet, skyRecipe);
  const atmosphereCamera = new THREE.PerspectiveCamera();
  atmosphereContext.camera = atmosphereCamera;

  const lutNode = atmosphereContext.lutNode as unknown as AtmosphereLutNodeSync;
  // Play RAF never idles; Vite may also close over native requestIdleCallback
  // before our window shim. Drive the official updateTextures path ourselves
  // (it resets renderer state per pass) and rely on atmosphere-idle-bypass for
  // the internal timeSlice waits.
  lutNode.updateBeforeType = NodeUpdateType.FRAME;
  lutNode.updateBefore = (frame: NodeFrame): void => {
    const gpu = frame.renderer as WebGPURenderer | null | undefined;
    if (gpu == null || lutNode.version === lutNode.currentVersion) return;
    if (lutNode.textures == null || lutNode.updating) return;
    lutNode.currentVersion = lutNode.version;
    void lutNode.updateTextures(gpu).catch((error: unknown) => {
      lutNode.currentVersion = undefined;
      console.error('[atmosphere] LUT fill failed.', error);
    });
  };

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

  if (!starsCatalog || starsCatalog.byteLength < 10) {
    throw new Error('[atmosphere] stars catalog missing; call ensureStarsCatalog() first');
  }
  const starsNode = new StarsNode(starsCatalog);
  starsNode.intensity.value = 0;
  starsNode.pointSize.value = skyRecipe.stars.pointSize;
  starsNode.magnitudeRange.value.set(
    skyRecipe.stars.magnitudeMin,
    skyRecipe.stars.magnitudeMax,
  );

  const moonTexture = createMoonSurfaceTexture(skyRecipe.moon);

  const skyNode = sky();
  skyNode.showSun = true;
  skyNode.showMoon = skyRecipe.moon.enabled;
  skyNode.showStars = true;
  skyNode.moonScattering = skyRecipe.moon.enabled;
  skyNode.starsNode = starsNode;
  skyNode.sunNode.angularRadius.value = skyPalette.sunAngularRadius;
  skyNode.sunNode.intensity.value = skyRecipe.sun.discBrightness;
  skyNode.moonNode.angularRadius.value = skyPalette.moonAngularRadius;
  skyNode.moonNode.intensity.value = skyRecipe.moon.brightness;
  skyNode.moonNode.colorNode = textureNode(moonTexture);

  // Cloud deck used to composite here (`sky*(1-a)+cloud`). Cloud-pass clear
  // alpha still reads fully covered on empty air, which zeros the sky. Keep
  // bare SkyNode until that clear is fixed.
  void cloudColor;

  const skyAwareDepth = Fn(() => {
    const d = float(depth).r.toVar();
    return d.lessThanEqual(0.001).select(float(1), d);
  })();
  const aerialNode = new AerialPerspectiveNode(
    inputColor,
    skyAwareDepth,
    normal,
  );
  aerialNode.skyNode = skyNode;
  // Three's scene lights already shade the beauty pass. The atmosphere should
  // add transmittance/inscattering without applying a second Lambert response.
  aerialNode.lighting = false;
  aerialNode.transmittance = true;
  aerialNode.inscattering = true;
  aerialNode.correctGeometricError = true;

  const cameraWorldPosition = new THREE.Vector3();
  const cameraWorldQuaternion = new THREE.Quaternion();
  const moonBasisX = new THREE.Vector3();
  const moonBasisY = new THREE.Vector3();
  const moonBasisZ = new THREE.Vector3();

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
      .copy(frame.moonDirection)
      .normalize();
    updateMoonFixedFrame(
      atmosphereContext.matrixMoonFixedToECEF.value,
      atmosphereContext.moonDirectionECEF.value,
      frame.moonOrbitNormal,
      moonBasisX,
      moonBasisY,
      moonBasisZ,
    );

    const stars = resolveStarPresentation(
      frame.daylightFactor,
      frame.spaceFactor,
      skyRecipe,
    );
    starsNode.intensity.value = stars.intensity;
    // Sub-pixel points disappear under AgX; keep a visible floor on the surface.
    starsNode.pointSize.value = Math.max(stars.pointSize * pixelRatio, 2.5);

    // Fill the star RT before the post graph samples it. StarsNode.updateBefore
    // can miss the atmosphere camera when the NodeFrame only carries the game
    // camera, leaving a black atlas and a starless night.
    if (stars.intensity > 0) {
      starsNode.updateBefore({
        renderer,
        camera: atmosphereCamera,
      } as NodeFrame);
    }

    // Lunar inscattering is multiplied by the same AgX day calibration (×6) as
    // the sun, so a full moon washes the whole dome lavender. Deep night keeps
    // the moon disc (`showMoon`) but hands sky fill to the authored night-sky
    // layer, which we can keep dark.
    skyNode.moonScattering =
      skyRecipe.moon.enabled && frame.daylightFactor > 0.12;

    // Nebula / solid backgrounds own far pixels. Leaving SkyNode plugged in
    // replaces scene.background (the equirect) with atmosphere luminance — so
    // authored `space-skybox` stations looked fine in the editor (no aerial
    // pass) and empty in Play.
    aerialNode.skyNode = frame.atmosphereSkyActive ? skyNode : null;
  }

  return {
    node: aerialNode,
    dispose() {
      if (previousGetAtmosphere) {
        rendererContext.getAtmosphere = previousGetAtmosphere;
      } else {
        delete rendererContext.getAtmosphere;
      }
      // `AerialPerspectiveNode.dispose` forwards to whatever is in `skyNode`,
      // which is the composite wrapper — the SkyNode it wraps has to be
      // released here or it leaks its LUT bindings.
      aerialNode.dispose();
      skyNode.dispose();
      starsNode.dispose();
      moonTexture.dispose();
      atmosphereContext.dispose();
    },
    update,
  };
}
