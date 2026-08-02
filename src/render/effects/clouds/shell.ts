import * as THREE from 'three';
import type { Vec3 } from '../../../types';
import type {
  PlanetCloudLayerRecipe,
  PlanetCloudsRecipe,
} from '../../../world/planets/sky-schema';
import { cloudDriftAngle, phaseFromSeed } from '../../../world/clouds';

interface CloudLayer {
  material: CloudShellMaterialHandle;
  mesh: THREE.Mesh;
  recipe: PlanetCloudLayerRecipe;
}

export interface CloudShellMaterialParameters {
  cameraSimPosition: THREE.Vector3;
  invRenderScale: number;
  phase: number;
  /** Authored shape of this layer. */
  layer: PlanetCloudLayerRecipe;
  /** Shared appearance for every layer on this planet. */
  clouds: PlanetCloudsRecipe;
  /**
   * Converts the authored cloud colors into the atmosphere's luminance units.
   * See `SkyPalette.cloudLuminanceScale` — the deck composites onto `SkyNode`'s
   * output, not into the beauty pass.
   */
  luminanceScale: number;
  /**
   * Broadband extinction per meter used for the deck's own aerial perspective.
   * See `SkyPalette.hazeExtinctionPerMeter`.
   */
  hazeExtinctionPerMeter: number;
  /** Sea-level radius; the deck sits at `radius + layer.altitudeMeters`. */
  planetRadiusMeters: number;
}

/** Per-frame lighting handed to every cloud layer. All directions are scene-space. */
export interface CloudShellLighting {
  sunDirection: THREE.Vector3;
  moonDirection: THREE.Vector3;
  /** 0 at night, 1 at midday. */
  daylightFactor: number;
  /** Combined moon elevation and phase, 0..1. */
  moonlight: number;
}

/**
 * Renderer-neutral controls used by the shell.
 *
 * The material is injected rather than owned here: the deck's lifecycle,
 * drift, and altitude fade are plain math, and only the shading is
 * backend-specific. `manager.ts` supplies the TSL implementation — there is no
 * GLSL fallback, because `WebGPURenderer` silently draws a raw ShaderMaterial
 * as a blank node material and this project ships no WebGL renderer.
 */
export interface CloudShellMaterialHandle {
  material: THREE.Material;
  setDriftAngle: (value: number) => void;
  setOpacity: (value: number) => void;
  setLighting: (lighting: CloudShellLighting) => void;
  /**
   * Re-reads the authored shape and palette into uniforms.
   *
   * Pushed every frame so Planet Authoring edits to coverage, sharpness, cell
   * scale, and the four colors land without leaving Play. Layer *count* and
   * `detail` still need a restart — both change the compiled graph.
   */
  setShape: (layer: PlanetCloudLayerRecipe, clouds: PlanetCloudsRecipe) => void;
  dispose: () => void;
}

export type CloudShellMaterialFactory = (
  parameters: CloudShellMaterialParameters,
) => CloudShellMaterialHandle;

export interface CloudShellOptions {
  materialFactory: CloudShellMaterialFactory;
  clouds: PlanetCloudsRecipe;
  /** See `CloudShellMaterialParameters.luminanceScale`. */
  luminanceScale: number;
  /** See `CloudShellMaterialParameters.hazeExtinctionPerMeter`. */
  hazeExtinctionPerMeter: number;
  planetRadiusMeters: number;
}

export interface CloudShellUpdate {
  bodyPosition: Vec3;
  nowSeconds: number;
  spaceFactor: number;
  altitudeMeters: number;
  cameraPosition: Vec3;
  lighting: CloudShellLighting;
}

export interface CloudShell {
  dispose: () => void;
  setVisible: (visible: boolean) => void;
  update: (input: CloudShellUpdate) => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number, edge0: number, edge1: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.000001));
  return t * t * (3 - 2 * t);
}

/**
 * Camera-centered cloud decks, one sphere per authored layer.
 *
 * The sphere carries directions only — the vertex stage projects each vertex
 * onto the layer's real altitude shell, so a deck is near overhead and far at
 * the horizon. Coverage is sampled against planet-fixed directions, so banks
 * stay over their geography as the player travels.
 */
export function createCloudShell(
  scene: THREE.Scene,
  seed: number,
  renderScale: number,
  options: CloudShellOptions,
): CloudShell {
  const group = new THREE.Group();
  const layers: CloudLayer[] = [];
  const invRenderScale = 1 / renderScale;
  const cameraSimPos = new THREE.Vector3();
  const {
    clouds,
    hazeExtinctionPerMeter,
    luminanceScale,
    materialFactory,
    planetRadiusMeters,
  } = options;

  clouds.layers.forEach((layerRecipe, layerIndex) => {
    const material = materialFactory({
      cameraSimPosition: cameraSimPos,
      invRenderScale,
      phase: phaseFromSeed(seed, layerIndex),
      layer: layerRecipe,
      clouds,
      luminanceScale,
      hazeExtinctionPerMeter,
      planetRadiusMeters,
    });
    const mesh = new THREE.Mesh(
      // Unit sphere: the radius is meaningless once the vertex stage
      // reprojects, but the tessellation carries the interpolated sample
      // direction, so it still has to be dense enough not to facet the horizon
      // ring. 64x32 is that floor.
      new THREE.SphereGeometry(1, 64, 32),
      material.material,
    );
    mesh.frustumCulled = false;
    // Highest deck first. Nothing depth-tests in the cloud pass, so an
    // over-blend is only correct back-to-front; drawing the 1.4 km layer before
    // the 5.2 km one would put cirrus in front of the cumulus below it.
    mesh.renderOrder = -layerRecipe.altitudeMeters;
    group.add(mesh);
    layers.push({ material, mesh, recipe: layerRecipe });
  });

  scene.add(group);

  function update(input: CloudShellUpdate): void {
    const { bodyPosition, cameraPosition, nowSeconds } = input;
    group.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    // Scene space = (sim - focus) * renderScale, so the camera's sim position
    // is the focus body position plus the scaled scene offset.
    cameraSimPos.set(
      bodyPosition.x + cameraPosition.x * invRenderScale,
      bodyPosition.y + cameraPosition.y * invRenderScale,
      bodyPosition.z + cameraPosition.z * invRenderScale,
    );

    // Decks stay visible from above — the vertex stage solves both sides of the
    // shell, so flying over the weather shows the tops rather than nothing.
    // They only thin out on the way to orbit, where a camera-centred dome stops
    // being a good stand-in for a whole planet's cloud cover.
    const planetShellStrength = 1 - smoothstep01(input.spaceFactor, 0.55, 0.95);
    const altitudeStrength =
      1 - smoothstep01(input.altitudeMeters, 30_000, 90_000);
    const strength = clamp01(planetShellStrength * altitudeStrength);
    for (const layer of layers) {
      layer.material.setShape(layer.recipe, clouds);
      layer.material.setDriftAngle(
        cloudDriftAngle(
          layer.recipe,
          planetRadiusMeters + layer.recipe.altitudeMeters,
          nowSeconds,
        ),
      );
      layer.material.setOpacity(
        Math.min(1, layer.recipe.opacity) * strength,
      );
      layer.material.setLighting(input.lighting);
    }
  }

  function dispose(): void {
    for (const layer of layers) {
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
    scene.remove(group);
  }

  return {
    dispose,
    setVisible(visible) {
      group.visible = visible;
    },
    update,
  };
}
