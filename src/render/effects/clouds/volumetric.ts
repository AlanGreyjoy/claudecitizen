import * as THREE from 'three';
import type { Planet } from '../../../types';
import { AerialPerspectiveEffect, AtmosphereParameters, PrecomputedTexturesGenerator } from '@takram/three-atmosphere';
import {
  CloudShape,
  CloudShapeDetail,
  CloudsEffect,
  LocalWeather,
  Turbulence,
} from '@takram/three-clouds';
import { DEFAULT_STBN_URL, Ellipsoid, STBNLoader } from '@takram/three-geospatial';
import type { NormalPass } from 'postprocessing';
import { resolveRenderQuality } from '../../main/domain/render_quality';

const GROUND_ALBEDO = new THREE.Color(0x56704b);
const STBN_LOCAL_URL = new URL('../../../assets/clouds/stbn.bin', import.meta.url).href;
const MIN_VOLUMETRIC_ALTITUDE_METERS = 250;

interface CloudDebugState {
  active: boolean;
  failed: boolean;
  ready: boolean;
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
  update: (deltaSeconds: number, altitudeMeters: number, enabled?: boolean) => void;
  resize: (width: number, height: number) => void;
}

function loadStbnTexture(_renderer: THREE.WebGLRenderer): Promise<THREE.Data3DTexture> {
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
): VolumetricCloudManager {
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

  const debugState: CloudDebugState = {
    active: false,
    failed: false,
    ready: false,
  };
  if (typeof window !== 'undefined') {
    (window as Window & { __claudeCitizenCloudDebug?: CloudDebugState }).__claudeCitizenCloudDebug = debugState;
  }

  const renderQuality = resolveRenderQuality();
  const cloudsEffect = new CloudsEffect(
    camera,
    { resolutionScale: renderQuality.cloudResolutionScale },
    atmosphere,
  );
  cloudsEffect.ellipsoid = ellipsoid;
  cloudsEffect.worldToECEFMatrix.identity();
  cloudsEffect.correctAltitude = true;
  cloudsEffect.qualityPreset = renderQuality.cloudQualityPreset;
  cloudsEffect.coverage = 0.62;
  cloudsEffect.temporalUpscale = true;
  cloudsEffect.localWeatherTexture = new LocalWeather();
  cloudsEffect.shapeTexture = new CloudShape();
  cloudsEffect.shapeDetailTexture = new CloudShapeDetail();
  cloudsEffect.turbulenceTexture = new Turbulence();
  cloudsEffect.localWeatherRepeat.setScalar(24);
  cloudsEffect.localWeatherOffset.set(2.8, 1.4);
  cloudsEffect.shapeRepeat.setScalar(0.00024);
  cloudsEffect.shapeDetailRepeat.setScalar(0.004);
  cloudsEffect.localWeatherVelocity.set(0.0015, 0.0008);
  cloudsEffect.shapeVelocity.set(8, 0, 2);
  cloudsEffect.shapeDetailVelocity.set(14, 0, 4);
  cloudsEffect.cloudLayers[0].set({
    altitude: 500,
    coverageFilterWidth: 0.42,
    densityScale: 0.34,
    height: 900,
    shadow: renderQuality.cloudShadowCascades > 0,
  });
  cloudsEffect.cloudLayers[1].set({
    altitude: 1200,
    coverageFilterWidth: 0.48,
    densityScale: 0.28,
    height: 1800,
    shadow: renderQuality.cloudShadowCascades > 0,
  });
  cloudsEffect.cloudLayers[2].set({
    altitude: 5200,
    coverageFilterWidth: 0.55,
    densityScale: 0.08,
    height: 1400,
    shapeAmount: 0.6,
    shapeDetailAmount: 0.2,
    shadow: false,
  });
  cloudsEffect.cloudLayers[3].set({
    densityScale: 0,
    height: 0,
  });
  cloudsEffect.shadow.cascadeCount = Math.max(1, renderQuality.cloudShadowCascades);
  cloudsEffect.shadow.mapSize.setScalar(renderQuality.cloudShadowMapSize);
  cloudsEffect.shadow.farScale = 0.32;
  cloudsEffect.shadow.maxFar = 90_000;
  cloudsEffect.clouds.maxRayDistance = 160_000;

  const aerialPerspectiveEffect = new AerialPerspectiveEffect(
    camera,
    {
      ellipsoid,
      ground: false,
      inscatter: true,
      normalBuffer: _normalPass.texture,
      sky: true,
      skyLight: true,
      sun: true,
      sunLight: true,
      transmittance: true,
    },
    atmosphere,
  );
  aerialPerspectiveEffect.worldToECEFMatrix.identity();
  aerialPerspectiveEffect.correctAltitude = true;
  aerialPerspectiveEffect.correctGeometricError = false;
  aerialPerspectiveEffect.moon = false;
  aerialPerspectiveEffect.shadowSampleCount = renderQuality.aerialPerspectiveShadowSamples;

  function syncAtmosphereComposition(): void {
    aerialPerspectiveEffect.overlay = cloudsEffect.atmosphereOverlay;
    aerialPerspectiveEffect.shadow = cloudsEffect.atmosphereShadow;
    aerialPerspectiveEffect.shadowLength = cloudsEffect.atmosphereShadowLength;
  }

  cloudsEffect.events.addEventListener('change', syncAtmosphereComposition);
  syncAtmosphereComposition();

  const texturesGenerator = new PrecomputedTexturesGenerator(renderer, {
    combinedScattering: false,
    higherOrderScattering: true,
  });

  let ready = false;
  let failed = false;
  let cachedTextures: PrecomputedTextures | null = null;
  const initPromise = Promise.all([
    texturesGenerator.update(atmosphere),
    loadStbnTexture(renderer),
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

  function resize(_width: number, _height: number): void {
    // Resize operations are now managed by the central composer in render/main
  }

  function updateSharedState(altitudeMeters: number, enabled = true): void {
    sunDirection.copy(sunLight.position).normalize();
    cloudsEffect.sunDirection.copy(sunDirection);
    aerialPerspectiveEffect.sunDirection.copy(sunDirection);

    const active =
      enabled &&
      ready &&
      !failed &&
      altitudeMeters >= MIN_VOLUMETRIC_ALTITUDE_METERS &&
      altitudeMeters <= 72_000;

    cloudsEffect.skipRendering = !active;
    debugState.active = active;
  }

  function dispose(): void {
    cloudsEffect.events.removeEventListener('change', syncAtmosphereComposition);
    texturesGenerator.dispose();
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
      return (
        enabled &&
        ready &&
        !failed &&
        altitudeMeters >= MIN_VOLUMETRIC_ALTITUDE_METERS &&
        altitudeMeters <= 72_000
      );
    },
    update(_deltaSeconds, altitudeMeters, enabled = true) {
      updateSharedState(altitudeMeters, enabled);
    },
    resize,
  };
}
