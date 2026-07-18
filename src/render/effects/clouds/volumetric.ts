import * as THREE from 'three';
import type { Planet, Vec3 } from '../../../types';
import {
  AerialPerspectiveEffect,
  AtmosphereParameters,
  DEFAULT_PRECOMPUTED_TEXTURES_URL,
  PrecomputedTexturesLoader,
} from '@takram/three-atmosphere';
import {
  CloudShape,
  CloudShapeDetail,
  CloudsEffect,
  LocalWeather,
  Turbulence,
} from '@takram/three-clouds';
import { DEFAULT_STBN_URL, Ellipsoid, STBNLoader } from '@takram/three-geospatial';
import { BlendFunction, type NormalPass } from 'postprocessing';
import { resolveRenderQuality } from '../../main/domain/render_quality';

const GROUND_ALBEDO = new THREE.Color(0x56704b);
const STBN_LOCAL_URL = new URL('../../../assets/clouds/stbn.bin', import.meta.url).href;
const PRECOMPUTED_TEXTURES_URL = new URL(
  '../../../assets/atmosphere/transmittance.exr',
  import.meta.url,
).href.replace(/transmittance\.exr$/, '');
const MIN_VOLUMETRIC_ALTITUDE_METERS = 0;

interface CloudDebugState {
  active: boolean;
  failed: boolean;
  ready: boolean;
  coverage?: number;
  skipRendering?: boolean;
  cameraAltitudeMeters?: number;
  cameraHeightUniform?: number;
  materialCameraHeight?: number;
  setCoverage?: (value: number) => void;
  setDensityScale?: (layerIndex: number, value: number) => void;
  /** When true, skipRendering stays true so the 2D shell can be inspected. */
  forceSkipComposite?: boolean;
}

interface PrecomputedTextureTarget {
  irradianceTexture?: THREE.Texture;
  scatteringTexture?: THREE.Texture;
  transmittanceTexture?: THREE.Texture;
  singleMieScatteringTexture?: THREE.Texture;
  higherOrderScatteringTexture?: THREE.Texture;
  stbnTexture?: THREE.Data3DTexture;
  applyPrecomputedTextures?: (textures: PrecomputedTextures) => void;
}

interface PrecomputedTextures {
  irradianceTexture: THREE.Texture;
  scatteringTexture: THREE.Texture;
  transmittanceTexture: THREE.Texture;
  singleMieScatteringTexture?: THREE.Texture;
  higherOrderScatteringTexture?: THREE.Texture;
}

export interface VolumetricCloudManager {
  atmosphere: AtmosphereParameters;
  applySharedTextures: (target: PrecomputedTextureTarget) => void;
  dispose: () => void;
  ellipsoid: Ellipsoid;
  initPromise: Promise<void>;
  cloudsEffect: CloudsEffect;
  aerialPerspectiveEffect: AerialPerspectiveEffect;
  worldToECEFMatrix: THREE.Matrix4;
  isActive: (altitudeMeters: number, enabled?: boolean) => boolean;
  update: (
    deltaSeconds: number,
    altitudeMeters: number,
    focusPosition: Vec3,
    enabled?: boolean,
  ) => void;
  resize: (width: number, height: number) => void;
}

function loadStbnTexture(): Promise<THREE.Data3DTexture> {
  return new Promise((resolve, reject) => {
    const loader = new STBNLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      STBN_LOCAL_URL,
      resolve,
      undefined,
      async () => {
        try {
          loader.load(DEFAULT_STBN_URL, resolve, undefined, reject);
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function loadPrecomputedTextures(renderer: THREE.WebGLRenderer): Promise<PrecomputedTextures> {
  return new Promise((resolve, reject) => {
    const loader = new PrecomputedTexturesLoader({
      combinedScattering: true,
      format: 'exr',
      higherOrderScattering: true,
    });
    loader.setType(renderer);
    loader.setCrossOrigin('anonymous');
    loader.load(
      PRECOMPUTED_TEXTURES_URL,
      resolve,
      undefined,
      () => {
        try {
          loader.load(DEFAULT_PRECOMPUTED_TEXTURES_URL, resolve, undefined, reject);
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function applyPrecomputedTextures(effect: PrecomputedTextureTarget, textures: PrecomputedTextures): void {
  effect.irradianceTexture = textures.irradianceTexture;
  effect.scatteringTexture = textures.scatteringTexture;
  effect.transmittanceTexture = textures.transmittanceTexture;
  if (textures.singleMieScatteringTexture) {
    effect.singleMieScatteringTexture = textures.singleMieScatteringTexture;
  }
  if (textures.higherOrderScatteringTexture) {
    effect.higherOrderScatteringTexture = textures.higherOrderScatteringTexture;
  }
}

export function createVolumetricCloudManager(
  renderer: THREE.WebGLRenderer,
  _scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  planet: Planet,
  sunLight: THREE.DirectionalLight,
  _normalPass: NormalPass,
  renderScale: number,
): VolumetricCloudManager {
  // Takram's CloudsMaterial projects camera ECEF through Geodetic/WGS84 to get
  // cameraHeight. That only works in real meters — our scene is floating-origin
  // * renderScale. Drive clouds from a meter-space surrogate camera and a
  // translation-only worldToECEF (focus in meters). Sky pixels ignore depth, so
  // the scaled depth buffer does not block cloud rays looking up.
  const invS = 1 / renderScale;

  const atmosphere = new AtmosphereParameters({
    bottomRadius: planet.radiusMeters,
    groundAlbedo: GROUND_ALBEDO.clone(),
    topRadius: planet.radiusMeters + planet.atmosphereHeightMeters,
  });
  const ellipsoid = new Ellipsoid(
    planet.radiusMeters,
    planet.radiusMeters,
    planet.radiusMeters,
  );

  const renderQuality = resolveRenderQuality();
  const cloudsEffect = new CloudsEffect(
    camera,
    { resolutionScale: Math.max(0.5, renderQuality.cloudResolutionScale) },
    atmosphere,
  );
  cloudsEffect.ellipsoid = ellipsoid;
  cloudsEffect.worldToECEFMatrix.identity();
  // Sphere planet ≠ WGS84 — altitude correction against WGS84 shifts lighting
  // samples into the ground and paints the sky black.
  cloudsEffect.correctAltitude = false;
  cloudsEffect.qualityPreset = renderQuality.cloudQualityPreset;
  cloudsEffect.coverage = 0.85;
  cloudsEffect.temporalUpscale = true;
  cloudsEffect.skyLightScale = 3;
  cloudsEffect.groundBounceScale = 1.2;
  cloudsEffect.localWeatherTexture = new LocalWeather();
  cloudsEffect.shapeTexture = new CloudShape();
  cloudsEffect.shapeDetailTexture = new CloudShapeDetail();
  cloudsEffect.turbulenceTexture = new Turbulence();
  cloudsEffect.localWeatherRepeat.setScalar(18);
  cloudsEffect.localWeatherOffset.set(2.8, 1.4);
  cloudsEffect.shapeRepeat.setScalar(0.00024);
  cloudsEffect.shapeDetailRepeat.setScalar(0.004);
  cloudsEffect.localWeatherVelocity.set(0.0015, 0.0008);
  cloudsEffect.shapeVelocity.set(8, 0, 2);
  cloudsEffect.shapeDetailVelocity.set(14, 0, 4);
  cloudsEffect.cloudLayers[0].set({
    altitude: 600,
    coverageFilterWidth: 0.35,
    densityScale: 0.55,
    height: 1_200,
    weatherExponent: 0.7,
    shadow: false,
  });
  cloudsEffect.cloudLayers[1].set({
    altitude: 1_400,
    coverageFilterWidth: 0.4,
    densityScale: 0.4,
    height: 1_800,
    weatherExponent: 0.8,
    shadow: false,
  });
  cloudsEffect.cloudLayers[2].set({
    altitude: 5_000,
    coverageFilterWidth: 0.5,
    densityScale: 0.15,
    height: 1_600,
    shapeAmount: 0.6,
    shapeDetailAmount: 0.25,
    shadow: false,
  });
  cloudsEffect.cloudLayers[3].set({
    densityScale: 0,
    height: 0,
  });
  cloudsEffect.shadow.cascadeCount = 1;
  cloudsEffect.shadow.mapSize.setScalar(256);
  cloudsEffect.shadow.farScale = 0.32;
  cloudsEffect.shadow.maxFar = 90_000;
  cloudsEffect.clouds.maxRayDistance = 200_000;

  // Keep aerial soft of the sky fill for now — wrong WGS84 height was painting
  // the whole frame black. Clouds composite over the Three.js sky background.
  const aerialPerspectiveEffect = new AerialPerspectiveEffect(
    camera,
    {
      ellipsoid,
      ground: false,
      inscatter: false,
      normalBuffer: _normalPass.texture,
      sky: false,
      skyLight: false,
      sun: false,
      sunLight: false,
      transmittance: false,
    },
    atmosphere,
  );
  aerialPerspectiveEffect.worldToECEFMatrix.identity();
  aerialPerspectiveEffect.correctAltitude = true;
  aerialPerspectiveEffect.correctGeometricError = false;
  aerialPerspectiveEffect.moon = false;
  aerialPerspectiveEffect.shadowSampleCount = 0;
  // postprocessing v6 has no per-effect `enabled`; SKIP keeps this effect from
  // rendering inside the shared atmosphere EffectPass (clouds still composite).
  aerialPerspectiveEffect.blendMode.setBlendFunction(BlendFunction.SKIP);

  const atmosphereCamera = new THREE.PerspectiveCamera(
    camera.fov,
    camera.aspect,
    Math.max(camera.near * invS, 0.5),
    Math.max(camera.far * invS, 200_000),
  );
  cloudsEffect.mainCamera = atmosphereCamera;
  aerialPerspectiveEffect.mainCamera = atmosphereCamera;

  // CloudsMaterial always derives cameraHeight via Geodetic+WGS84. Our planet is
  // a sphere at planet.radiusMeters, so WGS84 height can be ~8 km off and the
  // shader thinks we are above every cloud deck (no march looking up). Force the
  // true radial altitude after Takram's copyCameraSettings each frame.
  let latestAltitudeMeters = 0;
  const patchCameraHeight = (material: {
    copyCameraSettings?: (camera: THREE.Camera) => void;
    uniforms?: Record<string, { value: unknown }>;
  }): void => {
    if (typeof material.copyCameraSettings !== 'function' || !material.uniforms) {
      return;
    }
    const original = material.copyCameraSettings.bind(material);
    material.copyCameraSettings = (cam: THREE.Camera) => {
      original(cam);
      if (material.uniforms?.cameraHeight) {
        material.uniforms.cameraHeight.value = latestAltitudeMeters;
      }
    };
  };
  patchCameraHeight(cloudsEffect.cloudsPass.currentMaterial as never);
  patchCameraHeight(cloudsEffect.shadowPass.currentMaterial as never);

  const debugState: CloudDebugState = {
    active: false,
    failed: false,
    ready: false,
    setCoverage(value) {
      cloudsEffect.coverage = value;
      debugState.coverage = value;
    },
    setDensityScale(layerIndex, value) {
      const layer = cloudsEffect.cloudLayers[layerIndex];
      if (!layer) return;
      layer.densityScale = value;
    },
    // Dev override only — the 'shell' cloud mode already keeps the composite
    // skipped via enabled=false; 'volumetric' mode lets it draw once textures
    // are ready. Lighting parity with the sphere planet is still unverified,
    // which is why 'shell' remains the default. Flip this at runtime via
    // window.__claudeCitizenCloudDebug.forceSkipComposite to compare paths.
    forceSkipComposite: false,
  };
  if (typeof window !== 'undefined') {
    (window as Window & { __claudeCitizenCloudDebug?: CloudDebugState }).__claudeCitizenCloudDebug =
      debugState;
  }

  function syncAtmosphereComposition(): void {
    aerialPerspectiveEffect.overlay = cloudsEffect.atmosphereOverlay;
    aerialPerspectiveEffect.shadow = cloudsEffect.atmosphereShadow;
    aerialPerspectiveEffect.shadowLength = cloudsEffect.atmosphereShadowLength;
  }

  cloudsEffect.events.addEventListener('change', syncAtmosphereComposition);
  syncAtmosphereComposition();

  let ready = false;
  let failed = false;
  let cachedTextures: PrecomputedTextures | null = null;
  const initPromise = Promise.all([
    loadPrecomputedTextures(renderer),
    loadStbnTexture(),
  ])
    .then(([textures, stbnTexture]) => {
      cachedTextures = textures;
      applyPrecomputedTextures(cloudsEffect as unknown as PrecomputedTextureTarget, textures);
      applyPrecomputedTextures(aerialPerspectiveEffect as unknown as PrecomputedTextureTarget, textures);
      cloudsEffect.stbnTexture = stbnTexture;
      aerialPerspectiveEffect.stbnTexture = stbnTexture;
      ready = true;
      debugState.ready = true;
    })
    .catch((error) => {
      failed = true;
      debugState.failed = true;
      console.error('ClaudeCitizen volumetric cloud init failed.', error);
    });

  const sunDirection = new THREE.Vector3();
  const cameraWorldScaled = new THREE.Vector3();

  function resize(width: number, height: number): void {
    void width;
    void height;
  }

  function syncAtmosphereCamera(focusPosition: Vec3, altitudeMeters: number): void {
    camera.getWorldPosition(cameraWorldScaled);
    atmosphereCamera.position.copy(cameraWorldScaled).multiplyScalar(invS);
    atmosphereCamera.quaternion.copy(camera.quaternion);
    atmosphereCamera.fov = camera.fov;
    atmosphereCamera.aspect = camera.aspect;
    atmosphereCamera.near = Math.max(camera.near * invS, 0.5);
    atmosphereCamera.far = Math.max(camera.far * invS, 200_000);
    atmosphereCamera.updateProjectionMatrix();
    atmosphereCamera.updateMatrixWorld(true);

    cloudsEffect.worldToECEFMatrix.makeTranslation(
      focusPosition.x,
      focusPosition.y,
      focusPosition.z,
    );
    aerialPerspectiveEffect.worldToECEFMatrix.copy(cloudsEffect.worldToECEFMatrix);

    const radialAltitude =
      Math.hypot(
        atmosphereCamera.position.x + focusPosition.x,
        atmosphereCamera.position.y + focusPosition.y,
        atmosphereCamera.position.z + focusPosition.z,
      ) - planet.radiusMeters;
    // Prefer radial camera height (third-person eye), fall back to feet altitude.
    latestAltitudeMeters = Number.isFinite(radialAltitude)
      ? Math.max(0, radialAltitude)
      : Math.max(0, altitudeMeters);
    debugState.cameraAltitudeMeters = latestAltitudeMeters;
    debugState.cameraHeightUniform = latestAltitudeMeters;
  }

  function updateSharedState(
    altitudeMeters: number,
    focusPosition: Vec3,
    enabled = true,
  ): void {
    syncAtmosphereCamera(focusPosition, altitudeMeters);
    sunLight.getWorldDirection(sunDirection);
    sunDirection.multiplyScalar(-1).normalize();
    cloudsEffect.sunDirection.copy(sunDirection);
    aerialPerspectiveEffect.sunDirection.copy(sunDirection);

    const active =
      enabled &&
      ready &&
      !failed &&
      altitudeMeters >= MIN_VOLUMETRIC_ALTITUDE_METERS &&
      altitudeMeters <= 72_000;

    // Must stay false while active — this toggles a shader #define that
    // otherwise pass-throughs the whole clouds composite.
    cloudsEffect.skipRendering = debugState.forceSkipComposite ? true : !active;
    debugState.active = active && !cloudsEffect.skipRendering;
    debugState.skipRendering = cloudsEffect.skipRendering;
    debugState.coverage = cloudsEffect.coverage;
    const heightUniform = cloudsEffect.cloudsPass.currentMaterial.uniforms.cameraHeight
      ?.value as number | undefined;
    if (typeof heightUniform === 'number') {
      debugState.materialCameraHeight = heightUniform;
    }
  }

  function dispose(): void {
    cloudsEffect.events.removeEventListener('change', syncAtmosphereComposition);
    cachedTextures?.irradianceTexture?.dispose?.();
    cachedTextures?.scatteringTexture?.dispose?.();
    cachedTextures?.transmittanceTexture?.dispose?.();
    cachedTextures?.singleMieScatteringTexture?.dispose?.();
    cachedTextures?.higherOrderScatteringTexture?.dispose?.();
    cloudsEffect.localWeatherTexture?.dispose?.();
    cloudsEffect.shapeTexture?.dispose?.();
    cloudsEffect.shapeDetailTexture?.dispose?.();
    cloudsEffect.turbulenceTexture?.dispose?.();
  }

  return {
    atmosphere,
    applySharedTextures(target) {
      if (!cachedTextures) {
        return;
      }
      if (typeof target.applyPrecomputedTextures === 'function') {
        target.applyPrecomputedTextures(cachedTextures);
        return;
      }
      applyPrecomputedTextures(target, cachedTextures);
    },
    dispose,
    ellipsoid,
    initPromise,
    cloudsEffect,
    aerialPerspectiveEffect,
    worldToECEFMatrix: cloudsEffect.worldToECEFMatrix,
    isActive(altitudeMeters, enabled = true) {
      // Only report active while the composite is actually drawing. When
      // skipRendering/forceSkipComposite is on, environment must keep the
      // normal blue sky + planet fog — otherwise the EffectPass clears to black.
      const compositing =
        enabled &&
        ready &&
        !failed &&
        !cloudsEffect.skipRendering &&
        !debugState.forceSkipComposite &&
        altitudeMeters >= MIN_VOLUMETRIC_ALTITUDE_METERS &&
        altitudeMeters <= 72_000;
      return compositing;
    },
    update(_deltaSeconds, altitudeMeters, focusPosition, enabled = true) {
      updateSharedState(altitudeMeters, focusPosition, enabled);
    },
    resize,
  };
}
