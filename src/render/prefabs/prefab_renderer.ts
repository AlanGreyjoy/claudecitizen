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
import {
  attachParticleSystemToEntity,
  setupUpdateParticles,
} from '../particles';
import {
  bindObjectAnimationComponent,
  setupUpdateObjectAnimations,
} from './object_animation';
import { applyDefaultFrustumCulling } from '../frustum_policy';
import { deduplicateObjectTextures } from '../assets/texture_dedup';

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
  rootGroup?: THREE.Group;
}

interface BoundAnimationNode {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  delta: number;
}

interface BoundAnimation {
  id: string;
  motion: "slide" | "hinge";
  axis: "x" | "y" | "z";
  nodes: BoundAnimationNode[];
}

type AnimationPrefabComponent = PrefabComponent & {
  type: "animation";
  _bindAttempts?: number;
};

const animationBindAttempts = new WeakMap<AnimationPrefabComponent, number>();

function setupUpdateAnimations(group: THREE.Group): void {
  group.userData.boundAnimations = [] as BoundAnimation[];
  group.userData.pendingAnimations = [] as AnimationPrefabComponent[];

  const AXIS_VECTORS = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
  } as const;

  const rotationScratch = new THREE.Quaternion();
  const axisScratch = new THREE.Vector3();

  group.userData.updateAnimations = (blends: Record<string, number>) => {
    // Try to bind any pending animations that are waiting for models to finish loading
    const pending = group.userData.pendingAnimations as AnimationPrefabComponent[] | undefined;
    if (pending && pending.length > 0) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const component = pending[i];
        bindAnimationComponent(group, group, component);
      }
    }

    const bound = group.userData.boundAnimations as BoundAnimation[] | undefined;
    if (!bound) return;
    for (const anim of bound) {
      const open01 = blends[anim.id] ?? 0;
      for (const node of anim.nodes) {
        if (anim.motion === "slide") {
          axisScratch.copy(AXIS_VECTORS[anim.axis]).multiplyScalar(node.delta * open01);
          node.object.position.copy(node.basePosition).add(axisScratch);
        } else {
          rotationScratch.setFromAxisAngle(AXIS_VECTORS[anim.axis], node.delta * open01);
          node.object.quaternion.copy(node.baseQuaternion).multiply(rotationScratch);
        }
      }
    }
  };
}

function bindAnimationComponent(
  rootGroup: THREE.Group | undefined,
  targetObject: THREE.Object3D,
  component: AnimationPrefabComponent,
): void {
  if (!rootGroup) return;

  // Prevent duplicate bindings if already bound
  const bound = rootGroup.userData.boundAnimations as BoundAnimation[] | undefined;
  if (bound && bound.some((b) => b.id === component.id)) {
    return;
  }

  const boundNodes: BoundAnimationNode[] = [];
  let allFound = true;
  for (const nodeSpec of component.nodes) {
    const safeName = sanitizeNodeName(nodeSpec.name);
    let object = targetObject.getObjectByName(safeName);
    if (!object) {
      object = rootGroup.getObjectByName(safeName);
    }
    if (object) {
      boundNodes.push({
        object,
        basePosition: object.position.clone(),
        baseQuaternion: object.quaternion.clone(),
        delta: nodeSpec.delta,
      });
    } else {
      allFound = false;
    }
  }

  if (allFound && boundNodes.length > 0) {
    if (bound) {
      bound.push({
        id: component.id,
        motion: component.motion,
        axis: component.axis,
        nodes: boundNodes,
      });
    }
    // Successfully bound! Remove from pending queue if present
    const pending = rootGroup.userData.pendingAnimations as AnimationPrefabComponent[] | undefined;
    if (pending) {
      const idx = pending.indexOf(component);
      if (idx !== -1) {
        pending.splice(idx, 1);
      }
    }
  } else {
    // If not all nodes are found, queue in pendingAnimations to retry as models load
    const pending = rootGroup.userData.pendingAnimations as AnimationPrefabComponent[] | undefined;
    if (pending) {
      const attempts = (animationBindAttempts.get(component) ?? 0) + 1;
      animationBindAttempts.set(component, attempts);

      if (!pending.includes(component)) {
        pending.push(component);
      }

      // Log warning only if it remains unbound after a reasonable delay (e.g. 300 frames)
      if (attempts === 300) {
        console.warn(`Animation node not found after 300 attempts: ${component.nodes.map(n => n.name).join(', ')} under ${targetObject.name} or rootGroup`);
        const allNames: string[] = [];
        rootGroup.traverse((child) => {
          if (child.name) allNames.push(child.name);
        });
        console.warn(`Available node names under rootGroup (${rootGroup.name}):`, allNames);
        
        // Remove from pending to stop retrying indefinitely
        const idx = pending.indexOf(component);
        if (idx !== -1) {
          pending.splice(idx, 1);
        }
      }
    }
  }
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
  { type: 'point-light' | 'area-light' | 'spot-light' }
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
      localLightShadowMapSize: 256,
      localLightShadowsEnabled: true,
    };
  }
  return {
    lightScale: options.lightScale ?? 1,
    localLightShadowMapSize: options.localLightShadowMapSize ?? 256,
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

function configureSpotLightShadow(
  light: THREE.SpotLight,
  scaledDistance: number,
  lightScale: number,
  mapSize: number,
): void {
  const shadowDistance = scaledDistance > 0 ? scaledDistance : 500 * lightScale;
  const near = Math.max(0.001 * lightScale, shadowDistance * 0.01);
  light.shadow.camera.near = Math.min(near, shadowDistance * 0.5);
  light.shadow.camera.far = Math.max(shadowDistance, light.shadow.camera.near * 2);
  light.shadow.camera.fov = THREE.MathUtils.radToDeg(light.angle);
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = -0.00035;
  light.shadow.radius = 2;
}

function prepareModelMaterials(root: THREE.Object3D): void {
  applyDefaultFrustumCulling(root);
  root.traverse((object) => {
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
      deduplicateObjectTextures(gltf.scene);
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
  geometry.computeBoundingSphere();
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
    component.color ?? (component.type === 'area-light' ? '#cfe8ff' : '#dfeaff');
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
    light.userData.prefabCastShadow = component.castShadow === true;
    return light;
  }

  if (component.type === 'spot-light') {
    const decay = component.decay ?? 2;
    const intensityScale = lightScale < 1
      ? Math.max(
          Math.pow(lightScale, decay),
          lightScale * SCALED_POINT_LIGHT_INTENSITY_MULTIPLIER,
        )
      : 1;
    const scaledDistance = component.distance * lightScale;
    const angle = THREE.MathUtils.degToRad(component.angle ?? 45);
    const light = new THREE.SpotLight(
      color,
      component.intensity * intensityScale,
      scaledDistance,
      angle,
      component.penumbra ?? 0,
      decay,
    );
    // Tie the target to the light so entity rotation aims the beam along -Z.
    light.target.position.set(0, 0, -1);
    light.add(light.target);
    light.castShadow =
      (component.castShadow ?? false) &&
      localLightShadowsEnabled &&
      localLightShadowMapSize > 0;
    if (light.castShadow) {
      configureSpotLightShadow(
        light,
        scaledDistance,
        lightScale,
        localLightShadowMapSize,
      );
    }
    light.userData.prefabCastShadow = component.castShadow === true;
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

function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, '_');
}

/** Keeps one named GLB subtree and moves its authored transform onto the prefab entity. */
export function isolatePrefabModelNode(
  root: THREE.Object3D,
  nodeName: string,
): boolean {
  const target = root.getObjectByName(sanitizeNodeName(nodeName));
  if (!target) return false;
  if (target === root) {
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    return true;
  }
  target.removeFromParent();
  target.position.set(0, 0, 0);
  target.quaternion.identity();
  target.scale.set(1, 1, 1);
  root.clear();
  root.add(target);
  return true;
}

function isIdentityPrefabTransform(transform: {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
}): boolean {
  const eps = 1e-6;
  const { position: p, rotation: r, scale: s } = transform;
  return (
    Math.abs(p.x) < eps &&
    Math.abs(p.y) < eps &&
    Math.abs(p.z) < eps &&
    Math.abs(r.x) < eps &&
    Math.abs(r.y) < eps &&
    Math.abs(r.z) < eps &&
    Math.abs(r.w - 1) < eps &&
    Math.abs(s.x - 1) < eps &&
    Math.abs(s.y - 1) < eps &&
    Math.abs(s.z - 1) < eps
  );
}

function applyNodeOverrides(
  root: THREE.Object3D,
  overrides: readonly PrefabNodeOverride[] | undefined,
): void {
  if (!overrides || overrides.length === 0) return;
  for (const override of overrides) {
    if (!override.transform || isIdentityPrefabTransform(override.transform)) continue;
    const object = root.getObjectByName(sanitizeNodeName(override.node));
    if (!object) continue;
    const { position, rotation, scale } = override.transform;
    object.position.set(position.x, position.y, position.z);
    object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    object.scale.set(scale.x, scale.y, scale.z);
  }
}

function applyHiddenNodes(
  root: THREE.Object3D,
  hiddenNodes: readonly string[] | undefined,
): void {
  if (!hiddenNodes || hiddenNodes.length === 0) return;
  for (const nodeName of hiddenNodes) {
    const object = root.getObjectByName(sanitizeNodeName(nodeName));
    if (object) object.visible = false;
  }
}

interface BuiltEntity {
  group: THREE.Group;
  /** Resolves once all GLB assets for this subtree are attached (or failed). */
  ready: Promise<void>;
}

function attachLoadedAsset(
  group: THREE.Group,
  model: THREE.Object3D,
  entity: PrefabEntity,
  options: BuildEntityOptions,
): void {
  const asset = entity.asset;
  if (!asset) return;
  if (asset.node && !isolatePrefabModelNode(model, asset.node)) {
    console.warn(
      `Prefab asset node "${asset.node}" not found in ${asset.url}.`,
    );
    return;
  }
  if (!(asset.castShadow ?? true)) {
    model.traverse((object) => {
      object.castShadow = false;
    });
  }
  applyPrefabMaterialOverrides(model, entity.materialOverrides);
  applyNodeOverrides(model, entity.nodeOverrides);
  applyHiddenNodes(model, entity.hiddenNodes);
  group.add(model);

  const bindAllDescendantAnimations = (curr: PrefabEntity) => {
    for (const component of curr.components ?? []) {
      if (component.type === 'animation') {
        bindAnimationComponent(options.rootGroup, model, component);
      }
      if (
        component.type === 'object-animation' &&
        (component.nodes?.length ?? 0) > 0
      ) {
        bindObjectAnimationComponent(options.rootGroup, model, component);
      }
    }
    for (const child of curr.children ?? []) {
      bindAllDescendantAnimations(child);
    }
  };
  bindAllDescendantAnimations(entity);
}

function buildEntity(
  entity: PrefabEntity,
  options: BuildEntityOptions,
): BuiltEntity {
  const group = new THREE.Group();
  group.name = entity.name;
  group.userData.entityId = entity.id;
  applyEntityTransform(group, entity);
  const pending: Promise<void>[] = [];

  if (entity.primitive) {
    group.add(createPrimitiveMesh(entity.primitive, entity.materialOverrides));
  }
  if (entity.asset) {
    const asset = entity.asset;
    pending.push(
      loadPrefabModel(asset.url)
        .then((model) => {
          attachLoadedAsset(group, model, entity, options);
        })
        .catch((error) => {
          console.warn(`Prefab asset failed to load: ${asset.url}`, error);
        }),
    );
  } else {
    for (const component of entity.components ?? []) {
      if (component.type === 'animation') {
        bindAnimationComponent(options.rootGroup, group, component);
      }
      if (component.type === 'object-animation') {
        bindObjectAnimationComponent(options.rootGroup, group, component);
      }
    }
  }

  for (const component of entity.components ?? []) {
    if (
      component.type === 'point-light' ||
      component.type === 'area-light' ||
      component.type === 'spot-light'
    ) {
      group.add(createPrefabLightObject(component, {
        lightScale: options.lightScale,
        localLightShadowMapSize: options.localLightShadowMapSize,
        localLightShadowsEnabled: options.localLightShadowsEnabled,
      }));
    }
    if (component.type === 'particle-system') {
      attachParticleSystemToEntity(options.rootGroup, group, component);
    }
    if (component.type === 'object-animation' && entity.asset) {
      // Asset entities bind after the GLB loads (see above). Empty-node hover
      // can also start immediately on the entity group.
      if ((component.nodes?.length ?? 0) === 0) {
        bindObjectAnimationComponent(options.rootGroup, group, component);
      }
    }
  }

  for (const child of entity.children ?? []) {
    const built = buildEntity(child, options);
    group.add(built.group);
    pending.push(built.ready);
  }
  return {
    group,
    ready: Promise.all(pending).then(() => undefined),
  };
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
  setupUpdateAnimations(group);
  setupUpdateParticles(group);
  setupUpdateObjectAnimations(group);
  group.add(buildEntity(doc.root, {
    lightScale: renderScale,
    localLightShadowMapSize: options.localLightShadowMapSize ?? 0,
    localLightShadowsEnabled: options.localLightShadowsEnabled ?? false,
    rootGroup: group,
  }).group);
  group.scale.setScalar(renderScale);
  applyDefaultFrustumCulling(group);
  return group;
}

/** Builds a single prop prefab instance (not scaled — caller sets transform). */
export function createPropInstanceGroup(doc: PrefabDocument): THREE.Group {
  const group = new THREE.Group();
  group.name = `prop:${doc.id}`;
  setupUpdateAnimations(group);
  setupUpdateParticles(group);
  setupUpdateObjectAnimations(group);
  group.add(buildEntity(doc.root, {
    lightScale: 1,
    localLightShadowMapSize: 256,
    localLightShadowsEnabled: true,
    rootGroup: group,
  }).group);
  applyDefaultFrustumCulling(group);
  return group;
}

/**
 * Like {@link createPropInstanceGroup}, but waits until every GLB asset in the
 * tree is attached. Used for one-shot captures (admin icon screenshots).
 */
export async function createPropInstanceGroupAsync(
  doc: PrefabDocument,
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = `prop:${doc.id}`;
  setupUpdateAnimations(group);
  setupUpdateParticles(group);
  setupUpdateObjectAnimations(group);
  const built = buildEntity(doc.root, {
    lightScale: 1,
    localLightShadowMapSize: 256,
    localLightShadowsEnabled: true,
    rootGroup: group,
  });
  group.add(built.group);
  await built.ready;
  applyDefaultFrustumCulling(group);
  return group;
}

/** Collects point and spot lights that were authored with shadow casting enabled. */
export function collectLocalShadowLights(root: THREE.Object3D): THREE.Light[] {
  const lights: THREE.Light[] = [];
  root.traverse((object) => {
    if (
      (object instanceof THREE.PointLight || object instanceof THREE.SpotLight) &&
      object.userData.prefabCastShadow === true
    ) {
      lights.push(object);
    }
  });
  return lights;
}

/**
 * Distance-based shadow culling for local prefab lights. Only the closest
 * `maxLights` lights within `maxDistance` keep shadows; the rest are toggled
 * off to save the per-light shadow map cost.
 */
export function updateLocalLightShadowCull(
  root: THREE.Object3D,
  cameraPosition: THREE.Vector3,
  maxDistance: number,
  maxLights: number,
): void {
  let lights = root.userData.localShadowLights as THREE.Light[] | undefined;
  if (!lights) {
    lights = collectLocalShadowLights(root);
    root.userData.localShadowLights = lights;
  }
  if (lights.length === 0) return;

  const worldPosition = new THREE.Vector3();
  const scored = lights
    .map((light) => {
      light.getWorldPosition(worldPosition);
      return { light, distance: worldPosition.distanceTo(cameraPosition) };
    })
    .sort((a, b) => a.distance - b.distance);

  for (let i = 0; i < scored.length; i++) {
    const { light, distance } = scored[i];
    const wantsShadow = distance <= maxDistance && i < maxLights;
    if (light.castShadow !== wantsShadow) {
      light.castShadow = wantsShadow;
    }
  }
}
