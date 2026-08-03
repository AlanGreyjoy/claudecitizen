/**
 * Authoring guides for the Base Character stage.
 *
 * Weapon alignment is hard to judge from the mesh alone: a rifle can look
 * seated in the hand while its bore is rolled or yawed off the character's
 * facing. These overlays draw the references that matter — the bore ray from
 * the weapon's barrel-end marker, the character aim line at eye height, the
 * body centerline, and the world line the on-screen ADS crosshair sits on —
 * plus a readout of bore-vs-facing and bore-vs-crosshair error.
 *
 * Guides are display-only. They never write to mounts, grips, or prefabs.
 */

import * as THREE from 'three';
import { DEFAULT_CAMERA_ZOOM } from '../../flight/camera-zoom';
import { resolveDeckCameraOrbit } from '../../flight/flight-aim';
import { ORBIT_PITCH_LIMIT, resolveCharacterCameraRig } from '../../player/character-camera';
import {
  PLAY_TEST_STAGE_FORWARD,
  PLAY_TEST_WEAPON_AIM_ZOOM_SCALE,
  PLAY_TEST_WORLD_UP,
} from './base-character-equipment-play-update';

const BORE_LENGTH_METERS = 6;
const AIM_LINE_LENGTH_METERS = 6;
const CENTERLINE_HEIGHT_METERS = 2.1;
const AXES_SIZE_METERS = 0.14;
const GUIDE_RENDER_ORDER = 999;
const HEAD_BONE_NAMES = ['Head', 'head', 'head_01', 'Head_01'] as const;
/** Eye line sits slightly above the head bone origin. */
const EYE_OFFSET_METERS = 0.08;
/** Below this the readout reports "aligned" instead of a signed value. */
const ALIGNED_DEGREES = 0.5;
const ALIGNED_METERS = 0.005;
/** Bore ray from a real barrel-end / muzzle-flash marker. */
const BORE_COLOR = 0xff5a5a;
/** Bore ray falling back to the weapon root because the prefab has no marker. */
const BORE_FALLBACK_COLOR = 0xffb347;
/** Orbit zoom while hard-aiming, matching the play-test ADS camera. */
const ADS_ZOOM_METERS = DEFAULT_CAMERA_ZOOM * PLAY_TEST_WEAPON_AIM_ZOOM_SCALE;
/** Crosshair ray length past the character. */
const CROSSHAIR_RAY_METERS = 25;
/** Range the crosshair miss distance is reported at. */
const CROSSHAIR_RANGE_METERS = 15;
const CROSSHAIR_MARK_METERS = 0.05;

export interface EquipmentGuideAnchors {
  /** Assembled character root; supplies the head bone for the eye line. */
  avatarRoot: THREE.Object3D | null;
  /** barrel-end / muzzle-flash marker object, or the weapon root fallback. */
  boreAnchor: THREE.Object3D | null;
  /** True when the weapon prefab has no barrel-end or muzzle-flash marker. */
  boreIsWeaponRoot: boolean;
  /** Object the transform gizmo is driving, if any. */
  gizmoTarget: THREE.Object3D | null;
}

export interface EquipmentGuides {
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  /** Reparent guides after a preview rebuild or selection change. */
  refresh: (anchors: EquipmentGuideAnchors) => void;
  /** Per-frame readout text, or null when there is nothing to measure. */
  readout: () => string | null;
  dispose: () => void;
}

function guideMaterial(color: number, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity,
  });
}

function guideLine(
  points: readonly THREE.Vector3[],
  material: THREE.LineBasicMaterial,
  name: string,
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([...points]);
  const line = new THREE.Line(geometry, material);
  line.name = name;
  line.renderOrder = GUIDE_RENDER_ORDER;
  line.frustumCulled = false;
  return line;
}

function findHeadBone(avatarRoot: THREE.Object3D | null): THREE.Object3D | null {
  if (!avatarRoot) return null;
  for (const name of HEAD_BONE_NAMES) {
    const bone = avatarRoot.getObjectByName(name);
    if (bone) return bone;
  }
  return null;
}

interface CrosshairRay {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

/** Centre ray of the play-test ADS camera at a given orbit pitch. */
function adsCentreRay(pitchRadians: number): CrosshairRay {
  const orbit = resolveDeckCameraOrbit(
    PLAY_TEST_STAGE_FORWARD,
    PLAY_TEST_WORLD_UP,
    0,
    pitchRadians,
    ORBIT_PITCH_LIMIT,
  );
  const rig = resolveCharacterCameraRig(orbit, ADS_ZOOM_METERS);
  const origin = new THREE.Vector3(
    rig.positionOffset.x,
    rig.positionOffset.y,
    rig.positionOffset.z,
  );
  const direction = new THREE.Vector3(
    rig.targetOffset.x,
    rig.targetOffset.y,
    rig.targetOffset.z,
  ).sub(origin).normalize();
  return { origin, direction };
}

/**
 * The camera sits above its look-at point, so orbit pitch 0 already puts the
 * crosshair in the dirt. An aim pose is authored against a level shot, so the
 * guide solves for the pitch whose centre ray is horizontal.
 */
function levelAimRay(): CrosshairRay {
  let low = -ORBIT_PITCH_LIMIT;
  let high = ORBIT_PITCH_LIMIT;
  for (let index = 0; index < 32; index += 1) {
    const mid = (low + high) / 2;
    if (adsCentreRay(mid).direction.y > 0) high = mid;
    else low = mid;
  }
  return adsCentreRay((low + high) / 2);
}

/** Point on the crosshair ray a given forward distance from the character. */
function crosshairPointAtRange(ray: CrosshairRay, forwardMeters: number): THREE.Vector3 {
  const travel = Math.abs(ray.direction.z) < 1e-6
    ? forwardMeters
    : (forwardMeters - ray.origin.z) / ray.direction.z;
  return ray.origin.clone().addScaledVector(ray.direction, travel);
}

function crossMarker(size: number, material: THREE.LineBasicMaterial, name: string): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-size, 0, 0), new THREE.Vector3(size, 0, 0),
    new THREE.Vector3(0, -size, 0), new THREE.Vector3(0, size, 0),
    new THREE.Vector3(0, 0, -size), new THREE.Vector3(0, 0, size),
  ]);
  const marker = new THREE.LineSegments(geometry, material);
  marker.name = name;
  marker.renderOrder = GUIDE_RENDER_ORDER;
  marker.frustumCulled = false;
  return marker;
}

function degreesLabel(label: string, degrees: number): string {
  if (Math.abs(degrees) < ALIGNED_DEGREES) return `${label} ok`;
  const sign = degrees > 0 ? '+' : '−';
  return `${label} ${sign}${Math.abs(degrees).toFixed(1)}°`;
}

function metersLabel(label: string, meters: number, positive: string, negative: string): string {
  if (Math.abs(meters) < ALIGNED_METERS) return `${label} ok`;
  const direction = meters > 0 ? positive : negative;
  return `${label} ${(Math.abs(meters) * 100).toFixed(1)} cm ${direction}`;
}

export function createEquipmentGuides(previewRoot: THREE.Group): EquipmentGuides {
  const materials = {
    bore: guideMaterial(BORE_COLOR, 0.95),
    aim: guideMaterial(0x63f2a0, 0.7),
    center: guideMaterial(0x6ea8ff, 0.45),
    crosshair: guideMaterial(0xffffff, 0.85),
  };
  const forward = (length: number): THREE.Vector3[] => [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, length),
  ];
  const boreLine = guideLine(forward(BORE_LENGTH_METERS), materials.bore, 'guide:bore');
  // Short cross-bar at the muzzle so roll error is visible head-on.
  const boreRoll = guideLine(
    [new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.05, 0)],
    materials.bore,
    'guide:bore-up',
  );
  boreLine.add(boreRoll);
  const aimLine = guideLine(forward(AIM_LINE_LENGTH_METERS), materials.aim, 'guide:aim');
  const centerLine = guideLine(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, CENTERLINE_HEIGHT_METERS, 0)],
    materials.center,
    'guide:centerline',
  );
  const centerForward = guideLine(
    forward(AIM_LINE_LENGTH_METERS),
    materials.center,
    'guide:centerline-forward',
  );
  const crosshairRay = levelAimRay();
  const crosshairAimPoint = crosshairPointAtRange(crosshairRay, CROSSHAIR_RANGE_METERS);
  const crosshairLine = guideLine(
    [
      crosshairRay.origin.clone(),
      crosshairRay.origin.clone().addScaledVector(crosshairRay.direction, CROSSHAIR_RAY_METERS),
    ],
    materials.crosshair,
    'guide:crosshair',
  );
  const crosshairRangeMark = crossMarker(
    CROSSHAIR_MARK_METERS,
    materials.crosshair,
    'guide:crosshair-range',
  );
  crosshairRangeMark.position.copy(crosshairAimPoint);
  // Where the screen-centre reticle sits alongside the gun — the reading that
  // tells you whether the drawn pose puts the sights on the crosshair.
  const crosshairMuzzleMark = crossMarker(
    CROSSHAIR_MARK_METERS,
    materials.crosshair,
    'guide:crosshair-muzzle',
  );
  const axes = new THREE.AxesHelper(AXES_SIZE_METERS);
  axes.name = 'guide:target-axes';
  axes.renderOrder = GUIDE_RENDER_ORDER;
  axes.frustumCulled = false;
  const axesMaterial = axes.material as THREE.Material;
  axesMaterial.depthTest = false;
  axesMaterial.depthWrite = false;
  axesMaterial.transparent = true;

  let visible = true;
  let headBone: THREE.Object3D | null = null;
  let anchors: EquipmentGuideAnchors = {
    avatarRoot: null,
    boreAnchor: null,
    boreIsWeaponRoot: false,
    gizmoTarget: null,
  };

  const scratch = {
    inverse: new THREE.Quaternion(),
    quaternion: new THREE.Quaternion(),
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    up: new THREE.Vector3(),
    eye: new THREE.Vector3(),
    miss: new THREE.Vector3(),
  };

  const applyVisibility = (): void => {
    boreLine.visible = visible && Boolean(anchors.boreAnchor);
    axes.visible = visible && Boolean(anchors.gizmoTarget);
    aimLine.visible = visible && Boolean(anchors.avatarRoot);
    centerLine.visible = visible;
    centerForward.visible = visible;
    crosshairLine.visible = visible;
    crosshairRangeMark.visible = visible;
    crosshairMuzzleMark.visible = visible && Boolean(anchors.boreAnchor);
  };

  const positionAimLine = (): void => {
    const head = headBone;
    if (!head) {
      aimLine.position.set(0, 1.6, 0);
      return;
    }
    head.updateWorldMatrix(true, false);
    scratch.eye.setFromMatrixPosition(head.matrixWorld);
    previewRoot.worldToLocal(scratch.eye);
    aimLine.position.set(0, scratch.eye.y + EYE_OFFSET_METERS, 0);
  };

  const refresh = (next: EquipmentGuideAnchors): void => {
    anchors = next;
    headBone = findHeadBone(next.avatarRoot);
    materials.bore.color.setHex(next.boreIsWeaponRoot ? BORE_FALLBACK_COLOR : BORE_COLOR);
    if (next.boreAnchor) next.boreAnchor.add(boreLine);
    else boreLine.removeFromParent();
    if (next.gizmoTarget) next.gizmoTarget.add(axes);
    else axes.removeFromParent();
    previewRoot.add(
      aimLine,
      centerLine,
      centerForward,
      crosshairLine,
      crosshairRangeMark,
      crosshairMuzzleMark,
    );
    positionAimLine();
    applyVisibility();
  };

  /**
   * Slide the reticle marker to the crosshair point level with the muzzle, and
   * report how far the bore ray passes from the crosshair at reference range.
   */
  const measureCrosshair = (borePosition: THREE.Vector3, boreDirection: THREE.Vector3): string => {
    const travel = Math.abs(crosshairRay.direction.z) < 1e-6
      ? 0
      : (borePosition.z - crosshairRay.origin.z) / crosshairRay.direction.z;
    crosshairMuzzleMark.position
      .copy(crosshairRay.origin)
      .addScaledVector(crosshairRay.direction, travel);
    const offAxisDegrees = THREE.MathUtils.radToDeg(
      boreDirection.angleTo(crosshairRay.direction),
    );
    scratch.miss.copy(crosshairAimPoint).sub(borePosition);
    const along = scratch.miss.dot(boreDirection);
    const missMeters = scratch.miss
      .addScaledVector(boreDirection, -along)
      .length();
    const missLabel = missMeters < ALIGNED_METERS
      ? 'on the crosshair'
      : `misses by ${(missMeters * 100).toFixed(0)} cm at ${CROSSHAIR_RANGE_METERS} m`;
    return `Crosshair · off ${offAxisDegrees.toFixed(1)}° · ${missLabel}`;
  };

  const readout = (): string | null => {
    const anchor = anchors.boreAnchor;
    if (!visible || !anchor) return null;
    anchor.updateWorldMatrix(true, false);
    previewRoot.updateWorldMatrix(true, false);
    previewRoot.getWorldQuaternion(scratch.quaternion);
    scratch.inverse.copy(scratch.quaternion).invert();
    anchor.getWorldQuaternion(scratch.quaternion);
    scratch.quaternion.premultiply(scratch.inverse);
    // Character-local frame: +Z forward, +Y up, +X the character's left.
    scratch.direction.set(0, 0, 1).applyQuaternion(scratch.quaternion);
    scratch.up.set(0, 1, 0).applyQuaternion(scratch.quaternion);
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(scratch.direction.x, scratch.direction.z));
    const pitch = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(scratch.direction.y, -1, 1)),
    );
    const roll = THREE.MathUtils.radToDeg(Math.atan2(scratch.up.x, scratch.up.y));

    scratch.position.setFromMatrixPosition(anchor.matrixWorld);
    previewRoot.worldToLocal(scratch.position);
    positionAimLine();
    const lateral = scratch.position.x;
    const vertical = scratch.position.y - aimLine.position.y;
    const source = anchors.boreIsWeaponRoot ? 'weapon root (no barrel-end)' : 'barrel';
    const bore = [
      `Bore ${source}`,
      degreesLabel('yaw', yaw),
      degreesLabel('pitch', pitch),
      degreesLabel('roll', roll),
      metersLabel('side', lateral, 'left', 'right'),
      metersLabel('eye', vertical, 'above', 'below'),
    ].join(' · ');
    return `${bore}\n${measureCrosshair(scratch.position, scratch.direction)}`;
  };

  return {
    setVisible: (next: boolean) => {
      visible = next;
      applyVisibility();
    },
    isVisible: () => visible,
    refresh,
    readout,
    dispose: () => {
      const owned = [
        boreLine, boreRoll, aimLine, centerLine, centerForward,
        crosshairLine, crosshairRangeMark, crosshairMuzzleMark, axes,
      ];
      for (const object of owned) {
        object.removeFromParent();
        object.geometry.dispose();
      }
      for (const material of Object.values(materials)) material.dispose();
      axesMaterial.dispose();
    },
  };
}
