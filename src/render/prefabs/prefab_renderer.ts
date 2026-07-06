import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import {
  MAIN_SURFACE_MATERIAL,
  PREFAB_PRIMITIVE_MATERIAL_NAME,
  applyMaterialOverride,
  configureShipMaterial,
} from '../materials/ship_material';
import type {
  PrefabComponent,
  PrefabDocument,
  PrefabEntity,
  PrefabMaterialOverride,
  PrefabNodeOverride,
  PrefabPrimitive,
} from '../../world/prefabs/schema';

/**
 * Builds Three.js scene graphs from prefab documents. Shared by the runtime
 * station renderer (attached to the main scene via updateShipPlacement) and
 * the editor viewport (per-entity instancing).
 */

const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, Promise<THREE.Group>>();
let rectAreaLightsInitialized = false;
const SCALED_POINT_LIGHT_INTENSITY_MULTIPLIER = 0.22;

interface BuildEntityOptions {
  lightScale: number;
  localLightShadowMapSize: number;
  localLightShadowsEnabled: boolean;
}

export interface PrefabLightRenderOptions {
  lightScale?: number;
  localLightShadowMapSize?: number;
  localLightShadowsEnabled?: boolean;
}

export interface PrefabStationRenderOptions {
  localLightShadowMapSize?: number;
  localLightShadowsEnabled?: boolean;
}

type PrefabLightComponent = Extract<
  PrefabComponent,
  { type: 'point-light' | 'area-light' }
>;

function ensureRectAreaLightsInitialized(): void {
  if (rectAreaLightsInitialized) return;
  RectAreaLightUniformsLib.init();
  rectAreaLightsInitialized = true;
}

function normalizeLightOptions(
  options: PrefabLightRenderOptions | number = {},
): Required<PrefabLightRenderOptions> {
  if (typeof options === 'number') {
    return {
      lightScale: options,
      localLightShadowMapSize: 512,
      localLightShadowsEnabled: true,
    };
  }
  return {
    lightScale: options.lightScale ?? 1,
    localLightShadowMapSize: options.localLightShadowMapSize ?? 512,
    localLightShadowsEnabled: options.localLightShadowsEnabled ?? true,
  };
}

function configurePointLightShadow(
  light: THREE.PointLight,
  scaledDistance: number,
  lightScale: number,
  mapSize: number,
): void {
  // Runtime stations are scaled to planet render units. Three's default
  // point-shadow near plane is much larger than those local-light ranges.
  const shadowDistance = scaledDistance > 0 ? scaledDistance : 500 * lightScale;
  const near = Math.max(0.001 * lightScale, shadowDistance * 0.01);
  light.shadow.camera.near = Math.min(near, shadowDistance * 0.5);
  light.shadow.camera.far = Math.max(shadowDistance, light.shadow.camera.near * 2);
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = -0.00035;
  light.shadow.radius = 2;
}

function prepareModelMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.frustumCulled = false;
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    configureShipMaterial(object.material);
  });
}

export function cloneObjectMaterials(root: THREE.Object3D): THREE.Material[] {
  const cloned: THREE.Material[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => {
        const copy = material.clone();
        cloned.push(copy);
        return copy;
      });
      return;
    }
    const copy = object.material.clone();
    object.material = copy;
    cloned.push(copy);
  });
  return cloned;
}

export function applyPrefabMaterialOverrides(
  root: THREE.Object3D,
  overrides: readonly PrefabMaterialOverride[] | undefined,
): THREE.Material[] {
  if (!overrides || overrides.length === 0) return [];
  const byName = new Map(overrides.map((override) => [override.material, override]));
  const cloned: THREE.Material[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const applyToMaterial = (material: THREE.Material) => {
      const override = byName.get(material.name);
      if (!override) return material;
      const copy = material.clone();
      applyMaterialOverride(copy, override);
      cloned.push(copy);
      return copy;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(applyToMaterial)
      : applyToMaterial(object.material);
  });
  return cloned;
}

/** Loads a GLB/GLTF once per url and hands out clones (shared geometry/materials). */
export async function loadPrefabModel(url: string): Promise<THREE.Object3D> {
  let pending = modelCache.get(url);
  if (!pending) {
    pending = gltfLoader.loadAsync(url).then((gltf) => {
      prepareModelMaterials(gltf.scene);
      return gltf.scene;
    });
    pending.catch(() => modelCache.delete(url));
    modelCache.set(url, pending);
  }
  const template = await pending;
  return template.clone(true);
}

export function createPrimitiveMesh(
  primitive: PrefabPrimitive,
  materialOverrides: readonly PrefabMaterialOverride[] = [],
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(primitive.size.x, primitive.size.y, primitive.size.z);
  const material = new THREE.MeshStandardMaterial({
    color: primitive.color ?? '#4c5663',
    ...MAIN_SURFACE_MATERIAL,
  });
  material.name = PREFAB_PRIMITIVE_MATERIAL_NAME;
  const override = materialOverrides.find(
    (entry) => entry.material === PREFAB_PRIMITIVE_MATERIAL_NAME,
  );
  if (override) applyMaterialOverride(material, override);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function createPrefabLightObject(
  component: PrefabLightComponent,
  options: PrefabLightRenderOptions | number = {},
): THREE.Light {
  const {
    lightScale,
    localLightShadowMapSize,
    localLightShadowsEnabled,
  } = normalizeLightOptions(options);
  const color =
    component.color ?? (component.type === 'point-light' ? '#dfeaff' : '#cfe8ff');
  if (component.type === 'point-light') {
    const decay = component.decay ?? 2;
    // Three clamps inverse-square attenuation at tiny render-unit distances.
    // Pure scale^2 makes station lights vanish; no scaling makes them explode.
    const intensityScale = lightScale < 1
      ? Math.max(
          Math.pow(lightScale, decay),
          lightScale * SCALED_POINT_LIGHT_INTENSITY_MULTIPLIER,
        )
      : 1;
    const scaledDistance = component.distance * lightScale;
    const light = new THREE.PointLight(
      color,
      component.intensity * intensityScale,
      scaledDistance,
      decay,
    );
    light.castShadow =
      (component.castShadow ?? false) &&
      localLightShadowsEnabled &&
      localLightShadowMapSize > 0;
    if (light.castShadow) {
      configurePointLightShadow(
        light,
        scaledDistance,
        lightScale,
        localLightShadowMapSize,
      );
    }
    return light;
  }

  ensureRectAreaLightsInitialized();
  return new THREE.RectAreaLight(
    color,
    component.intensity,
    component.width * lightScale,
    component.height * lightScale,
  );
}

function applyEntityTransform(object: THREE.Object3D, entity: PrefabEntity): void {
  const { position, rotation, scale } = entity.transform;
  object.position.set(position.x, position.y, position.z);
  object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  object.scale.set(scale.x, scale.y, scale.z);
}

function applyNodeOverrides(
  root: THREE.Object3D,
  overrides: readonly PrefabNodeOverride[] | undefined,
): void {
  if (!overrides || overrides.length === 0) return;
  for (const override of overrides) {
    const object = root.getObjectByName(override.node);
    if (!object) continue;
    const { position, rotation, scale } = override.transform;
    object.position.set(position.x, position.y, position.z);
    object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    object.scale.set(scale.x, scale.y, scale.z);
  }
}

function buildEntity(
  entity: PrefabEntity,
  options: BuildEntityOptions,
): THREE.Group {
  const group = new THREE.Group();
  group.name = entity.name;
  group.userData.entityId = entity.id;
  group.frustumCulled = false;
  applyEntityTransform(group, entity);

  if (entity.primitive) {
    group.add(createPrimitiveMesh(entity.primitive, entity.materialOverrides));
  }
  if (entity.asset) {
    const castShadow = entity.asset.castShadow ?? true;
    void loadPrefabModel(entity.asset.url)
      .then((model) => {
        if (!castShadow) {
          model.traverse((object) => {
            object.castShadow = false;
          });
        }
        applyPrefabMaterialOverrides(model, entity.materialOverrides);
        applyNodeOverrides(model, entity.nodeOverrides);
        group.add(model);
      })
      .catch((error) => {
        console.warn(`Prefab asset failed to load: ${entity.asset?.url}`, error);
      });
  }

  for (const component of entity.components ?? []) {
    if (component.type === 'point-light' || component.type === 'area-light') {
      group.add(createPrefabLightObject(component, {
        lightScale: options.lightScale,
        localLightShadowMapSize: options.localLightShadowMapSize,
        localLightShadowsEnabled: options.localLightShadowsEnabled,
      }));
    }
  }

  for (const child of entity.children ?? []) {
    group.add(buildEntity(child, options));
  }
  return group;
}

/**
 * Builds a station prefab as a placeable group. The group's local axes match
 * updateShipPlacement's orientation (x = -right, y = up, z = forward), same
 * as the procedural station model, so the caller can place it identically.
 */
export function createPrefabStationGroup(
  doc: PrefabDocument,
  renderScale: number,
  options: PrefabStationRenderOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = `prefab:${doc.id}`;
  group.add(buildEntity(doc.root, {
    lightScale: renderScale,
    localLightShadowMapSize: options.localLightShadowMapSize ?? 0,
    localLightShadowsEnabled: options.localLightShadowsEnabled ?? false,
  }));
  group.scale.setScalar(renderScale);
  group.frustumCulled = false;
  return group;
}

/** Builds a single prop prefab instance (not scaled — caller sets transform). */
export function createPropInstanceGroup(doc: PrefabDocument): THREE.Group {
  const group = new THREE.Group();
  group.name = `prop:${doc.id}`;
  group.add(buildEntity(doc.root, {
    lightScale: 1,
    localLightShadowMapSize: 512,
    localLightShadowsEnabled: true,
  }));
  group.frustumCulled = false;
  return group;
}
