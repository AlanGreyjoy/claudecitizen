import * as THREE from 'three';
import type { Vec3 } from '../../types';
import type { WeaponMarkerWorldPose } from '../main/domain/types';
import { alignPlaneAxisToCamera } from './combat-fx-billboard';
import {
  createMuzzleFlashTexture,
  createSoftGlowTexture,
} from './combat-fx-textures';

const MUZZLE_FLASH_POOL_SIZE = 5;
const MUZZLE_FLASH_LIFETIME_MIN_SECONDS = 0.042;
const MUZZLE_FLASH_LIFETIME_MAX_SECONDS = 0.072;
/** Flame quad measured from the barrel forward, before per-shot jitter. */
const FLAME_LENGTH_METERS = 0.44;
const FLAME_WIDTH_METERS = 0.3;
const GLOW_SIZE_METERS = 0.62;
/** Fraction of the lifetime spent at full punch before the decay starts. */
const FLASH_HOLD_FRACTION = 0.28;

interface MuzzleFlashEntry {
  elapsedSeconds: number;
  flameMaterial: THREE.MeshBasicMaterial;
  flameMesh: THREE.Mesh;
  flip: number;
  glowMaterial: THREE.MeshBasicMaterial;
  glowMesh: THREE.Mesh;
  lengthMeters: number;
  lifetimeSeconds: number;
  widthMeters: number;
  worldForward: Vec3;
  worldPosition: Vec3;
}

export interface MuzzleFlashRenderer {
  dispose(): void;
  spawn(pose: WeaponMarkerWorldPose): void;
  update(dt: number, focusPosition: Vec3, visible: boolean): void;
}

function additiveMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    map,
    opacity: 0,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
  });
}

/**
 * Muzzle flash: a base-anchored flame quad plus a camera-facing bloom.
 *
 * The flame is anchored at the barrel rather than centred on it — a centred
 * quad buries half the flash inside the weapon — and is billboarded around
 * the fire axis so it never presents edge-on. Brightness holds for a couple
 * of frames and then falls off fast, which reads as a punch instead of a fade.
 */
export function createMuzzleFlashRenderer(
  scene: THREE.Scene,
  renderScale: number,
  camera: THREE.Camera,
): MuzzleFlashRenderer {
  const flameGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const glowGeometry = new THREE.PlaneGeometry(1, 1);
  const flameTexture = createMuzzleFlashTexture();
  const glowTexture = createSoftGlowTexture();
  const forwardAxis = new THREE.Vector3();
  const meshPosition = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const entries: MuzzleFlashEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < MUZZLE_FLASH_POOL_SIZE; index += 1) {
    const flameMaterial = additiveMaterial(flameTexture);
    const glowMaterial = additiveMaterial(glowTexture);
    const flameMesh = new THREE.Mesh(flameGeometry, flameMaterial);
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    flameMesh.renderOrder = 14;
    glowMesh.renderOrder = 13;
    flameMesh.frustumCulled = false;
    glowMesh.frustumCulled = false;
    flameMesh.visible = false;
    glowMesh.visible = false;
    scene.add(flameMesh);
    scene.add(glowMesh);
    entries.push({
      elapsedSeconds: 0,
      flameMaterial,
      flameMesh,
      flip: 1,
      glowMaterial,
      glowMesh,
      lengthMeters: FLAME_LENGTH_METERS,
      lifetimeSeconds: 0,
      widthMeters: FLAME_WIDTH_METERS,
      worldForward: { x: 0, y: 0, z: 1 },
      worldPosition: { x: 0, y: 0, z: 0 },
    });
  }

  function spawn(pose: WeaponMarkerWorldPose): void {
    const entry = entries[cursor]!;
    cursor = (cursor + 1) % entries.length;
    entry.worldPosition = { ...pose.position };
    entry.worldForward = { ...pose.forward };
    entry.elapsedSeconds = 0;
    entry.lifetimeSeconds =
      MUZZLE_FLASH_LIFETIME_MIN_SECONDS +
      Math.random() * (MUZZLE_FLASH_LIFETIME_MAX_SECONDS - MUZZLE_FLASH_LIFETIME_MIN_SECONDS);
    // Mirroring the flame is a free second silhouette out of one texture.
    entry.flip = Math.random() < 0.5 ? -1 : 1;
    entry.lengthMeters = FLAME_LENGTH_METERS * (0.82 + Math.random() * 0.42);
    entry.widthMeters = FLAME_WIDTH_METERS * (0.85 + Math.random() * 0.34);
    // Warm white through to orange, so consecutive shots never twin exactly.
    const heat = Math.random();
    entry.flameMaterial.color.setHSL(0.108 - heat * 0.03, 0.62 + heat * 0.2, 0.72);
    entry.glowMaterial.color.setHSL(0.1 - heat * 0.02, 0.75, 0.62);
    entry.flameMesh.visible = true;
    entry.glowMesh.visible = true;
  }

  function place(entry: MuzzleFlashEntry, focusPosition: Vec3): void {
    meshPosition.set(
      (entry.worldPosition.x - focusPosition.x) * renderScale,
      (entry.worldPosition.y - focusPosition.y) * renderScale,
      (entry.worldPosition.z - focusPosition.z) * renderScale,
    );
    entry.flameMesh.position.copy(meshPosition);
    entry.glowMesh.position.copy(meshPosition);
    forwardAxis
      .set(entry.worldForward.x, entry.worldForward.y, entry.worldForward.z)
      .normalize();
    alignPlaneAxisToCamera(entry.flameMesh, forwardAxis, meshPosition, cameraPosition);
    entry.glowMesh.quaternion.copy(cameraQuaternion);
  }

  function update(dt: number, focusPosition: Vec3, visible: boolean): void {
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(cameraQuaternion);
    for (const entry of entries) {
      if (entry.lifetimeSeconds <= 0) continue;
      entry.elapsedSeconds += Math.max(0, dt);
      const life = entry.elapsedSeconds / entry.lifetimeSeconds;
      if (life >= 1) {
        entry.lifetimeSeconds = 0;
        entry.flameMesh.visible = false;
        entry.glowMesh.visible = false;
        continue;
      }
      entry.flameMesh.visible = visible;
      entry.glowMesh.visible = visible;
      if (!visible) continue;

      place(entry, focusPosition);
      const decay = Math.max(
        0,
        (1 - life - FLASH_HOLD_FRACTION) / (1 - FLASH_HOLD_FRACTION),
      );
      const flameAlpha = life < FLASH_HOLD_FRACTION ? 1 : decay ** 1.4;
      // Snap open over the first frames, then hold the silhouette.
      const grow = 0.7 + 0.3 * Math.min(1, life / 0.3);
      entry.flameMaterial.opacity = flameAlpha;
      entry.flameMesh.scale.set(
        entry.widthMeters * grow * renderScale * entry.flip,
        entry.lengthMeters * grow * renderScale,
        1,
      );
      entry.glowMaterial.opacity = flameAlpha * 0.7;
      const glowSize = GLOW_SIZE_METERS * (0.85 + life * 0.6) * renderScale;
      entry.glowMesh.scale.set(glowSize, glowSize, 1);
    }
  }

  return {
    dispose() {
      for (const entry of entries) {
        entry.flameMesh.removeFromParent();
        entry.glowMesh.removeFromParent();
        entry.flameMaterial.dispose();
        entry.glowMaterial.dispose();
      }
      flameGeometry.dispose();
      glowGeometry.dispose();
      flameTexture.dispose();
      glowTexture.dispose();
    },
    spawn,
    update,
  };
}
