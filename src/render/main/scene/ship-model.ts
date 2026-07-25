import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { prepareShipHullGltf } from '../../../physics/colliders';
import { configureShipMaterial } from '../../materials/ship_material';
import {
  DEFAULT_STARHOPPER_GEAR_HINGES,
  DEFAULT_STARHOPPER_RAMP_HINGE,
  type ShipGearHingeSpec,
  type ShipRampHingeSpec,
} from '../../../player/ship_layout';
import type { PrefabNodeOverride } from '../../../world/prefabs/schema';
import { applyDefaultFrustumCulling } from '../../frustum_policy';
import { deduplicateObjectTextures } from '../../assets/texture_dedup';

const PROTECTED_SHIP_URL =
  '/editor/assets/protected/ships/Phobos_Starhopper_Basic.glb?v=starhopper-20260703';
const FALLBACK_SHIP_URL = new URL('../../../assets/ships/Ship_Large.gltf', import.meta.url).href;
const SHIP_FORWARD_ALIGNMENT_RADIANS = 0;

export interface ShipArticulation {
  /** 0 retracted .. 1 deployed. */
  gear01: number;
  /** 0 raised .. 1 lowered. */
  ramp01: number;
  /** 0 closed .. 1 open per layout door id. */
  doors: Record<string, number>;
}

/** Render-side door binding: which GLB nodes move, how, and by how much. */
export interface ShipDoorBinding {
  id: string;
  motion: 'slide' | 'hinge';
  axis: 'x' | 'y' | 'z';
  nodes: { name: string; delta: number; under?: string }[];
}

export interface ShipModelOptions {
  /** Prefab hull GLB url; defaults to the built-in Phobos Starhopper. */
  hullUrl?: string | null;
  /** Prefab hull node overrides — must match collider bake. */
  hullNodeOverrides?: PrefabNodeOverride[];
  /** Prefab-authored doors; defaults to the Starhopper cockpit slide pair. */
  doors?: ShipDoorBinding[];
  /** Prefab-authored landing gear hinges. */
  gearHinges?: ShipGearHingeSpec[];
  /** Prefab-authored boarding ramp hinge. */
  rampHinge?: ShipRampHingeSpec | null;
}

export interface ShipModelHandle {
  group: THREE.Group;
  setArticulation: (articulation: ShipArticulation) => void;
  /**
   * Dev helper: reports named node bounds in ship-local meters
   * (right/up/forward) for tuning gameplay anchors against the rig.
   */
  measure: () => Record<string, unknown> | null;
  /** Dev helper: lists articulable node names for authoring ship-door components. */
  listNodeNames: () => string[];
}

interface ArticulatedNode {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
}

interface BoundDoorNode extends ArticulatedNode {
  delta: number;
}

interface BoundDoor {
  binding: ShipDoorBinding;
  nodes: BoundDoorNode[];
}

interface BoundGearHinge extends ArticulatedNode {
  deployRadians: number;
  axis: 'x' | 'y' | 'z';
}

interface BoundRampHinge extends ArticulatedNode {
  lowerRadians: number;
  axis: 'x' | 'y' | 'z';
}

/** Built-in gear/ramp hinges (Starhopper rig) shared with the editor preview. */
export const BUILTIN_GEAR_HINGES = DEFAULT_STARHOPPER_GEAR_HINGES;
export const BUILTIN_RAMP_HINGE = DEFAULT_STARHOPPER_RAMP_HINGE;

/** Starhopper cockpit doors — used when no prefab doors are provided. */
export const DEFAULT_SHIP_DOOR_BINDINGS: ShipDoorBinding[] = [
  {
    id: 'cockpit',
    motion: 'slide',
    axis: 'x',
    nodes: [
      { name: 'CockpitDoor_L', delta: 1 },
      { name: 'CockpitDoor_R', delta: -1 },
    ],
  },
];

function captureNode(
  root: THREE.Object3D,
  name: string,
  under?: string,
): ArticulatedNode | null {
  const scope = under ? root.getObjectByName(under) : root;
  if (!scope) {
    console.warn(`ClaudeCitizen ship rig ancestor missing: ${under}`);
    return null;
  }
  const object = under && scope.name === name ? scope : scope.getObjectByName(name);
  if (!object) {
    console.warn(
      `ClaudeCitizen ship rig node missing: ${under ? `${under}/` : ""}${name}`,
    );
    return null;
  }
  return {
    object,
    basePosition: object.position.clone(),
    baseQuaternion: object.quaternion.clone(),
  };
}

const rotationScratch = new THREE.Quaternion();
const axisScratch = new THREE.Vector3();
const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

function applyHingeRotation(
  node: ArticulatedNode | null,
  radians: number,
  axis: 'x' | 'y' | 'z' = 'x',
): void {
  if (!node) return;
  rotationScratch.setFromAxisAngle(AXIS_VECTORS[axis], radians);
  node.object.quaternion.copy(node.baseQuaternion).multiply(rotationScratch);
}

function applySlide(node: ArticulatedNode | null, offset: number, axis: 'x' | 'y' | 'z'): void {
  if (!node) return;
  axisScratch.copy(AXIS_VECTORS[axis]).multiplyScalar(offset);
  node.object.position.copy(node.basePosition).add(axisScratch);
}

export function createShipModel(
  renderScale: number,
  options?: ShipModelOptions,
): ShipModelHandle {
  const group = new THREE.Group();

  const loader = new GLTFLoader();
  const hullNodeOverrides = options?.hullNodeOverrides;
  const doorBindings = options?.doors ?? DEFAULT_SHIP_DOOR_BINDINGS;
  const gearSpecs = options?.gearHinges ?? DEFAULT_STARHOPPER_GEAR_HINGES;
  const rampSpec = options?.rampHinge ?? DEFAULT_STARHOPPER_RAMP_HINGE;

  let boundGear: BoundGearHinge[] = [];
  let boundRamp: BoundRampHinge | null = null;
  let boundDoors: BoundDoor[] = [];
  let pending: ShipArticulation = { gear01: 1, ramp01: 0, doors: {} };

  function applyArticulation(articulation: ShipArticulation): void {
    for (const hinge of boundGear) {
      applyHingeRotation(
        hinge,
        hinge.deployRadians * articulation.gear01,
        hinge.axis,
      );
    }
    if (boundRamp) {
      applyHingeRotation(
        boundRamp,
        boundRamp.lowerRadians * articulation.ramp01,
        boundRamp.axis,
      );
    }
    for (const door of boundDoors) {
      const open01 = articulation.doors[door.binding.id] ?? 0;
      for (const node of door.nodes) {
        if (door.binding.motion === 'slide') {
          applySlide(node, node.delta * open01, door.binding.axis);
        } else {
          applyHingeRotation(node, node.delta * open01, door.binding.axis);
        }
      }
    }
  }

  function bindArticulation(sceneRoot: THREE.Object3D): void {
    boundGear = gearSpecs
      .map((spec) => {
        const captured = captureNode(sceneRoot, spec.name, spec.under);
        return captured
          ? {
              ...captured,
              deployRadians: spec.deployRadians,
              axis: spec.axis ?? 'x',
            }
          : null;
      })
      .filter((hinge): hinge is BoundGearHinge => hinge !== null);

    if (rampSpec) {
      const captured = captureNode(sceneRoot, rampSpec.name);
      boundRamp = captured
        ? {
            ...captured,
            lowerRadians: rampSpec.lowerRadians,
            axis: rampSpec.axis ?? 'x',
          }
        : null;
    }

    boundDoors = doorBindings.map((binding) => ({
      binding,
      nodes: binding.nodes
        .map((node) => {
          const captured = captureNode(sceneRoot, node.name, node.under);
          return captured ? { ...captured, delta: node.delta } : null;
        })
        .filter((node): node is BoundDoorNode => node !== null),
    }));
  }

  function loadShip(url: string, allowFallback: boolean): void {
    loader.load(
      url,
      (gltf) => {
        const sceneRoot = gltf.scene;
        sceneRoot.rotation.y = SHIP_FORWARD_ALIGNMENT_RADIANS;
        sceneRoot.scale.setScalar(renderScale);
        applyDefaultFrustumCulling(sceneRoot);
        sceneRoot.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            configureShipMaterial(object.material);
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        deduplicateObjectTextures(sceneRoot);
        prepareShipHullGltf(sceneRoot, hullNodeOverrides, true);
        group.add(sceneRoot);

        bindArticulation(sceneRoot);
        applyArticulation(pending);
      },
      undefined,
      (error) => {
        if (allowFallback) {
          console.warn('ClaudeCitizen protected ship asset missing; using tracked fallback ship.', error);
          loadShip(FALLBACK_SHIP_URL, false);
          return;
        }
        console.warn('ClaudeCitizen fallback ship failed to load.', error);
      },
    );
  }

  loadShip(options?.hullUrl ?? PROTECTED_SHIP_URL, true);

  function measure(): Record<string, unknown> | null {
    const sceneRoot = group.children[0];
    if (!sceneRoot) return null;
    group.updateMatrixWorld(true);
    const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const corner = new THREE.Vector3();

    // Group local axes are x = -right, y = up, z = forward (per lookAt placement).
    // Boxes are accumulated per mesh in group space (not via world AABBs, which
    // inflate when the group is rotated relative to world axes).
    const meshToGroup = new THREE.Matrix4();
    const boxInShipMeters = (object: THREE.Object3D) => {
      const min = { right: Infinity, up: Infinity, forward: Infinity };
      const max = { right: -Infinity, up: -Infinity, forward: -Infinity };
      let any = false;
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry as THREE.BufferGeometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (!box || box.isEmpty()) return;
        any = true;
        meshToGroup.multiplyMatrices(toGroup, child.matrixWorld);
        for (let i = 0; i < 8; i += 1) {
          corner.set(
            (i & 1) === 0 ? box.min.x : box.max.x,
            (i & 2) === 0 ? box.min.y : box.max.y,
            (i & 4) === 0 ? box.min.z : box.max.z,
          );
          corner.applyMatrix4(meshToGroup).divideScalar(renderScale);
          const right = -corner.x;
          const up = corner.y;
          const forward = corner.z;
          min.right = Math.min(min.right, right);
          max.right = Math.max(max.right, right);
          min.up = Math.min(min.up, up);
          max.up = Math.max(max.up, up);
          min.forward = Math.min(min.forward, forward);
          max.forward = Math.max(max.forward, forward);
        }
      });
      if (!any) return null;
      const round = (v: number) => Math.round(v * 1000) / 1000;
      return {
        min: { right: round(min.right), up: round(min.up), forward: round(min.forward) },
        max: { right: round(max.right), up: round(max.up), forward: round(max.forward) },
      };
    };

    const named = (name: string) => {
      const object = group.getObjectByName(name);
      return object ? boxInShipMeters(object) : null;
    };

    return {
      ship: boxInShipMeters(group),
      ramp: named('RampParent'),
      cockpitDoorL: named('CockpitDoor_L'),
      cockpitDoorR: named('CockpitDoor_R'),
      seat: named('SeatBase'),
      gearBackLeft: named('LandingGear_BackLeft'),
      gearFront: named('LandingLeg_Front'),
      interiorWalls: named('Int_Walls'),
    };
  }

  function listNodeNames(): string[] {
    const names: string[] = [];
    group.traverse((object) => {
      if (object.name) names.push(object.name);
    });
    return names.sort();
  }

  return {
    group,
    setArticulation(articulation: ShipArticulation) {
      pending = articulation;
      applyArticulation(articulation);
    },
    measure,
    listNodeNames,
  };
}
