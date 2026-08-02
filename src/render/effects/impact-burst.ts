import * as THREE from 'three';
import type { WeaponSurfaceKind } from '../../player/weapon-ballistics';
import type { Vec3 } from '../../types';
import {
  createSmokePuffTexture,
  createSparkBurstTexture,
} from './combat-fx-textures';

const IMPACT_POOL_SIZE = 14;
const SPARK_LIFETIME_SECONDS = 0.12;
const PUFF_LIFETIME_SECONDS = 0.55;
/** Lifts the puff off the surface as it expands so it does not z-fight. */
const PUFF_DRIFT_METERS = 0.22;
const SURFACE_OFFSET_METERS = 0.02;

interface ImpactProfile {
  puffColor: number;
  puffEndMeters: number;
  puffOpacity: number;
  puffStartMeters: number;
  sparkColor: number;
  sparkEndMeters: number;
  sparkOpacity: number;
  sparkStartMeters: number;
}

/** Hard surfaces throw sparks; dirt throws dust. */
const IMPACT_PROFILES: Record<WeaponSurfaceKind, ImpactProfile> = {
  other: {
    puffColor: 0xb9bec4,
    puffEndMeters: 0.6,
    puffOpacity: 0.4,
    puffStartMeters: 0.14,
    sparkColor: 0xfff0cf,
    sparkEndMeters: 0.42,
    sparkOpacity: 0.85,
    sparkStartMeters: 0.09,
  },
  ship: {
    puffColor: 0x9aa4ad,
    puffEndMeters: 0.5,
    puffOpacity: 0.3,
    puffStartMeters: 0.1,
    sparkColor: 0xfff4dd,
    sparkEndMeters: 0.5,
    sparkOpacity: 1,
    sparkStartMeters: 0.08,
  },
  station: {
    puffColor: 0x9aa4ad,
    puffEndMeters: 0.5,
    puffOpacity: 0.3,
    puffStartMeters: 0.1,
    sparkColor: 0xfff4dd,
    sparkEndMeters: 0.5,
    sparkOpacity: 1,
    sparkStartMeters: 0.08,
  },
  terrain: {
    puffColor: 0xc2ad8c,
    puffEndMeters: 0.95,
    puffOpacity: 0.62,
    puffStartMeters: 0.2,
    sparkColor: 0xffcf92,
    sparkEndMeters: 0.3,
    sparkOpacity: 0.5,
    sparkStartMeters: 0.08,
  },
};

interface ImpactEntry {
  active: boolean;
  elapsedSeconds: number;
  profile: ImpactProfile;
  puffMaterial: THREE.MeshBasicMaterial;
  puffMesh: THREE.Mesh;
  sparkMaterial: THREE.MeshBasicMaterial;
  sparkMesh: THREE.Mesh;
  worldNormal: Vec3;
  worldPosition: Vec3;
}

export interface ImpactBurstSpawn {
  normal: Vec3;
  point: Vec3;
  surfaceKind: WeaponSurfaceKind;
}

export interface ImpactBurstRenderer {
  dispose(): void;
  spawn(impact: ImpactBurstSpawn): void;
  update(dt: number, focusPosition: Vec3, visible: boolean): void;
}

/**
 * Impact sparks and debris.
 *
 * Rounds previously vanished into a decal — and only when the weapon happened
 * to declare a decal texture, so unconfigured weapons had no impact feedback
 * at all. This is decal-independent: every hit gets a spark flash plus a
 * surface-tinted dust puff.
 */
export function createImpactBurstRenderer(
  scene: THREE.Scene,
  renderScale: number,
  camera: THREE.Camera,
): ImpactBurstRenderer {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const sparkTexture = createSparkBurstTexture();
  const puffTexture = createSmokePuffTexture();
  const planeNormal = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3();
  const basePosition = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const entries: ImpactEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < IMPACT_POOL_SIZE; index += 1) {
    const sparkMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: sparkTexture,
      opacity: 0,
      side: THREE.DoubleSide,
      toneMapped: false,
      transparent: true,
    });
    const puffMaterial = new THREE.MeshBasicMaterial({
      depthWrite: false,
      map: puffTexture,
      opacity: 0,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const sparkMesh = new THREE.Mesh(geometry, sparkMaterial);
    const puffMesh = new THREE.Mesh(geometry, puffMaterial);
    sparkMesh.renderOrder = 13;
    puffMesh.renderOrder = 11;
    sparkMesh.frustumCulled = false;
    puffMesh.frustumCulled = false;
    sparkMesh.visible = false;
    puffMesh.visible = false;
    scene.add(sparkMesh);
    scene.add(puffMesh);
    entries.push({
      active: false,
      elapsedSeconds: 0,
      profile: IMPACT_PROFILES.other,
      puffMaterial,
      puffMesh,
      sparkMaterial,
      sparkMesh,
      worldNormal: { x: 0, y: 1, z: 0 },
      worldPosition: { x: 0, y: 0, z: 0 },
    });
  }

  function spawn(impact: ImpactBurstSpawn): void {
    const entry = entries[cursor]!;
    cursor = (cursor + 1) % entries.length;
    const profile = IMPACT_PROFILES[impact.surfaceKind] ?? IMPACT_PROFILES.other;
    entry.profile = profile;
    entry.active = true;
    entry.elapsedSeconds = 0;
    entry.worldPosition = { ...impact.point };
    normal.set(impact.normal.x, impact.normal.y, impact.normal.z);
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    normal.normalize();
    entry.worldNormal = { x: normal.x, y: normal.y, z: normal.z };
    entry.sparkMaterial.color.setHex(profile.sparkColor);
    entry.puffMaterial.color.setHex(profile.puffColor);
    entry.puffMesh.quaternion.setFromUnitVectors(planeNormal, normal);
    entry.puffMesh.rotateOnAxis(planeNormal, Math.random() * Math.PI * 2);
    entry.sparkMesh.visible = true;
    entry.puffMesh.visible = true;
  }

  function drawSpark(entry: ImpactEntry, life01: number): void {
    const visible = life01 < 1;
    entry.sparkMesh.visible = visible;
    if (!visible) return;
    const size =
      (entry.profile.sparkStartMeters +
        (entry.profile.sparkEndMeters - entry.profile.sparkStartMeters) * life01 ** 0.5) *
      renderScale;
    entry.sparkMesh.position.copy(basePosition);
    entry.sparkMesh.quaternion.copy(cameraQuaternion);
    entry.sparkMesh.scale.set(size, size, 1);
    entry.sparkMaterial.opacity = entry.profile.sparkOpacity * (1 - life01) ** 1.6;
  }

  function drawPuff(entry: ImpactEntry, life01: number): void {
    const size =
      (entry.profile.puffStartMeters +
        (entry.profile.puffEndMeters - entry.profile.puffStartMeters) * life01 ** 0.6) *
      renderScale;
    const drift = PUFF_DRIFT_METERS * life01 * renderScale;
    entry.puffMesh.position.set(
      basePosition.x + entry.worldNormal.x * drift,
      basePosition.y + entry.worldNormal.y * drift,
      basePosition.z + entry.worldNormal.z * drift,
    );
    entry.puffMesh.scale.set(size, size, 1);
    entry.puffMaterial.opacity = entry.profile.puffOpacity * (1 - life01) ** 1.3;
  }

  function update(dt: number, focusPosition: Vec3, visible: boolean): void {
    camera.getWorldQuaternion(cameraQuaternion);
    const step = Math.max(0, dt);
    for (const entry of entries) {
      if (!entry.active) continue;
      entry.elapsedSeconds += step;
      if (entry.elapsedSeconds >= PUFF_LIFETIME_SECONDS) {
        entry.active = false;
        entry.sparkMesh.visible = false;
        entry.puffMesh.visible = false;
        continue;
      }
      if (!visible) {
        entry.sparkMesh.visible = false;
        entry.puffMesh.visible = false;
        continue;
      }
      entry.puffMesh.visible = true;
      basePosition.set(
        (entry.worldPosition.x + entry.worldNormal.x * SURFACE_OFFSET_METERS - focusPosition.x) *
          renderScale,
        (entry.worldPosition.y + entry.worldNormal.y * SURFACE_OFFSET_METERS - focusPosition.y) *
          renderScale,
        (entry.worldPosition.z + entry.worldNormal.z * SURFACE_OFFSET_METERS - focusPosition.z) *
          renderScale,
      );
      drawSpark(entry, Math.min(1, entry.elapsedSeconds / SPARK_LIFETIME_SECONDS));
      drawPuff(entry, entry.elapsedSeconds / PUFF_LIFETIME_SECONDS);
    }
  }

  return {
    dispose() {
      for (const entry of entries) {
        entry.sparkMesh.removeFromParent();
        entry.puffMesh.removeFromParent();
        entry.sparkMaterial.dispose();
        entry.puffMaterial.dispose();
      }
      geometry.dispose();
      sparkTexture.dispose();
      puffTexture.dispose();
    },
    spawn,
    update,
  };
}
