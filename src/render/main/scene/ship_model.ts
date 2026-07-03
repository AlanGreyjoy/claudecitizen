import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const PROTECTED_SHIP_URL = '/assets/protected/ships/Phobos_Starhopper_Basic.glb';
const FALLBACK_SHIP_URL = new URL('../../../assets/ships/Ship_Large.gltf', import.meta.url).href;
const SHIP_FORWARD_ALIGNMENT_RADIANS = 0;

function normalizeMaterialName(name: string): string {
  return name.replace(/_URP$/, '');
}

function configureShipMaterial(material: THREE.Material | THREE.Material[] | null | undefined): void {
  if (Array.isArray(material)) {
    material.forEach(configureShipMaterial);
    return;
  }
  if (!material) return;

  const meshMaterial = material as THREE.MeshStandardMaterial & {
    emissive?: THREE.Color;
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
  };
  if (meshMaterial.map) meshMaterial.map.colorSpace = THREE.SRGBColorSpace;
  if (meshMaterial.emissiveMap) meshMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  switch (normalizeMaterialName(material.name)) {
    // VA_Trimsheet_* materials carry baked textures (see scripts/bake_ship_textures.py)
    // and must not be overridden here.
    case 'VA_Glass2':
    case 'VA_Glass4':
      meshMaterial.color?.setHex(0x9bc9f5);
      meshMaterial.metalness = 0;
      meshMaterial.roughness = 0.08;
      meshMaterial.opacity = Math.min(meshMaterial.opacity ?? 1, 0.2);
      meshMaterial.transparent = true;
      break;
    case 'VA_Mirror':
      meshMaterial.color?.setHex(0xc5d1dc);
      meshMaterial.metalness = 0.86;
      meshMaterial.roughness = 0.06;
      break;
    case 'Light_White_Bright':
      meshMaterial.color?.setHex(0xffffff);
      meshMaterial.emissive?.setHex(0xd9e5ff);
      meshMaterial.emissiveIntensity = 1.2;
      break;
    case 'Light_Yellow_Med':
      meshMaterial.color?.setHex(0xffd5a0);
      meshMaterial.emissive?.setHex(0xffc27d);
      meshMaterial.emissiveIntensity = 1.1;
      break;
    case 'Light_Blue_Med':
      meshMaterial.color?.setHex(0x7bb6ff);
      meshMaterial.emissive?.setHex(0x67b6ff);
      meshMaterial.emissiveIntensity = 1.1;
      break;
    case 'VA_ScreenOff':
      meshMaterial.color?.setHex(0x09101a);
      meshMaterial.emissive?.setHex(0x000000);
      meshMaterial.metalness = 0.02;
      meshMaterial.roughness = 0.92;
      break;
    default:
      break;
  }
}

export interface ShipArticulation {
  /** 0 retracted .. 1 deployed. */
  gear01: number;
  /** 0 raised .. 1 lowered. */
  ramp01: number;
  /** 0 closed .. 1 open. */
  cockpit01: number;
}

export interface ShipModelHandle {
  group: THREE.Group;
  setArticulation: (articulation: ShipArticulation) => void;
  /**
   * Dev helper: reports named node bounds in ship-local meters
   * (right/up/forward) for tuning gameplay anchors against the rig.
   */
  measure: () => Record<string, unknown> | null;
}

interface ArticulatedNode {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
}

/**
 * Swing angles/slides measured against the Phobos Starhopper rig so that all
 * three gear feet rest on one plane ~3.16 m below the ship origin and the
 * lowered ramp tip meets that same ground plane at the tail.
 */
const GEAR_BACK_DEPLOY_RADIANS = -0.55;
const GEAR_FRONT_DEPLOY_RADIANS = 1.4;
const RAMP_LOWER_RADIANS = -0.62;
const COCKPIT_DOOR_SLIDE_METERS = 1.0;

function captureNode(root: THREE.Object3D, name: string): ArticulatedNode | null {
  const object = root.getObjectByName(name);
  if (!object) {
    console.warn(`ClaudeCitizen ship rig node missing: ${name}`);
    return null;
  }
  return {
    object,
    basePosition: object.position.clone(),
    baseQuaternion: object.quaternion.clone(),
  };
}

const rotationScratch = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

function applyHingeRotation(node: ArticulatedNode | null, radians: number): void {
  if (!node) return;
  rotationScratch.setFromAxisAngle(X_AXIS, radians);
  node.object.quaternion.copy(node.baseQuaternion).multiply(rotationScratch);
}

function applySlide(node: ArticulatedNode | null, offsetX: number): void {
  if (!node) return;
  node.object.position.set(
    node.basePosition.x + offsetX,
    node.basePosition.y,
    node.basePosition.z,
  );
}

export function createShipModel(renderScale: number): ShipModelHandle {
  const group = new THREE.Group();

  const loader = new GLTFLoader();
  const bbox = new THREE.Box3();
  const center = new THREE.Vector3();

  let gearBackLeft: ArticulatedNode | null = null;
  let gearBackRight: ArticulatedNode | null = null;
  let gearFront: ArticulatedNode | null = null;
  let ramp: ArticulatedNode | null = null;
  let doorLeft: ArticulatedNode | null = null;
  let doorRight: ArticulatedNode | null = null;
  let pending: ShipArticulation = { gear01: 1, ramp01: 0, cockpit01: 0 };

  function applyArticulation(articulation: ShipArticulation): void {
    applyHingeRotation(gearBackLeft, GEAR_BACK_DEPLOY_RADIANS * articulation.gear01);
    applyHingeRotation(gearBackRight, GEAR_BACK_DEPLOY_RADIANS * articulation.gear01);
    applyHingeRotation(gearFront, GEAR_FRONT_DEPLOY_RADIANS * articulation.gear01);
    applyHingeRotation(ramp, RAMP_LOWER_RADIANS * articulation.ramp01);
    applySlide(doorLeft, -COCKPIT_DOOR_SLIDE_METERS * articulation.cockpit01);
    applySlide(doorRight, COCKPIT_DOOR_SLIDE_METERS * articulation.cockpit01);
  }

  function loadShip(url: string, allowFallback: boolean): void {
    loader.load(
      url,
      (gltf) => {
        const sceneRoot = gltf.scene;
        sceneRoot.rotation.y = SHIP_FORWARD_ALIGNMENT_RADIANS;
        sceneRoot.scale.setScalar(renderScale);
        sceneRoot.traverse((object) => {
          object.frustumCulled = false;
          if (object instanceof THREE.Mesh) {
            configureShipMaterial(object.material);
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        bbox.setFromObject(sceneRoot);
        bbox.getCenter(center);
        sceneRoot.position.sub(center);
        group.add(sceneRoot);

        gearBackLeft = captureNode(sceneRoot, 'LandingGear_BackLeft');
        gearBackRight = captureNode(sceneRoot, 'LandingGear_BackRight');
        gearFront = captureNode(sceneRoot, 'LandingLeg_Front');
        ramp = captureNode(sceneRoot, 'RampParent');
        doorLeft = captureNode(sceneRoot, 'CockpitDoor_L');
        doorRight = captureNode(sceneRoot, 'CockpitDoor_R');
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

  loadShip(PROTECTED_SHIP_URL, true);

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

  return {
    group,
    setArticulation(articulation: ShipArticulation) {
      pending = articulation;
      applyArticulation(articulation);
    },
    measure,
  };
}
