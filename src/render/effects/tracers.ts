import * as THREE from 'three';
import type { Vec3 } from '../../types';
import { alignPlaneAxisToCamera } from './combat-fx-billboard';
import {
  createSoftGlowTexture,
  createTracerStreakTexture,
} from './combat-fx-textures';

const TRACER_POOL_SIZE = 28;
/** Visible streak trailing the round; the round itself is the bright head. */
const TRACER_STREAK_METERS = 16;
const TRACER_WIDTH_METERS = 0.05;
/** Sub-pixel streaks strobe, so widen with distance to hold a stable line. */
const TRACER_WIDTH_PER_METER = 0.0016;
const TRACER_MAX_WIDTH_METERS = 0.9;
const TRACER_HEAD_METERS = 0.22;
const TRACER_MIN_LENGTH_METERS = 0.35;
/** Clamped so slow rounds stay readable and fast ones do not teleport. */
const TRACER_MIN_SPEED_MPS = 180;
const TRACER_MAX_SPEED_MPS = 620;
const TRACER_DEFAULT_SPEED_MPS = 420;
/** Cosmetic cadence: 1 = every shot; 3 ≈ classic tracer belts. */
const TRACER_EVERY_N_SHOTS = 1;

interface TracerEntry {
  active: boolean;
  headMaterial: THREE.MeshBasicMaterial;
  headMesh: THREE.Mesh;
  speedMps: number;
  streakMaterial: THREE.MeshBasicMaterial;
  streakMesh: THREE.Mesh;
  totalLengthMeters: number;
  travelledMeters: number;
  worldDirection: Vec3;
  worldStart: Vec3;
}

export interface TracerSpawn {
  end: Vec3;
  /** Muzzle velocity of the firing weapon; clamped to a readable range. */
  speedMps?: number;
  start: Vec3;
}

export interface TracerRenderer {
  dispose(): void;
  spawn(tracer: TracerSpawn): void;
  update(dt: number, focusPosition: Vec3, visible: boolean): void;
}

function additiveMaterial(map: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color,
    depthWrite: false,
    map,
    opacity: 0,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
  });
}

/**
 * Bullet tracers that actually travel.
 *
 * The previous renderer drew the whole barrel-to-impact line at once for 80ms,
 * which reads as a laser beam rather than a round in flight. Here a fixed
 * streak length chases the round down the path, clipped at the muzzle on the
 * way out and swallowed by the impact point on arrival.
 */
export function createTracerRenderer(
  scene: THREE.Scene,
  renderScale: number,
  camera: THREE.Camera,
): TracerRenderer {
  const streakGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const headGeometry = new THREE.PlaneGeometry(1, 1);
  const streakTexture = createTracerStreakTexture();
  const headTexture = createSoftGlowTexture();
  const axis = new THREE.Vector3();
  const tailPosition = new THREE.Vector3();
  const headPosition = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const entries: TracerEntry[] = [];
  let cursor = 0;
  let shotCounter = 0;

  for (let index = 0; index < TRACER_POOL_SIZE; index += 1) {
    const streakMaterial = additiveMaterial(streakTexture, 0xffc46a);
    const headMaterial = additiveMaterial(headTexture, 0xfff2cc);
    const streakMesh = new THREE.Mesh(streakGeometry, streakMaterial);
    const headMesh = new THREE.Mesh(headGeometry, headMaterial);
    streakMesh.renderOrder = 11;
    headMesh.renderOrder = 12;
    streakMesh.frustumCulled = false;
    headMesh.frustumCulled = false;
    streakMesh.visible = false;
    headMesh.visible = false;
    scene.add(streakMesh);
    scene.add(headMesh);
    entries.push({
      active: false,
      headMaterial,
      headMesh,
      speedMps: TRACER_DEFAULT_SPEED_MPS,
      streakMaterial,
      streakMesh,
      totalLengthMeters: 0,
      travelledMeters: 0,
      worldDirection: { x: 0, y: 0, z: 1 },
      worldStart: { x: 0, y: 0, z: 0 },
    });
  }

  function deactivate(entry: TracerEntry): void {
    entry.active = false;
    entry.streakMesh.visible = false;
    entry.headMesh.visible = false;
  }

  function spawn(tracer: TracerSpawn): void {
    shotCounter += 1;
    if (shotCounter % TRACER_EVERY_N_SHOTS !== 0) return;

    const dx = tracer.end.x - tracer.start.x;
    const dy = tracer.end.y - tracer.start.y;
    const dz = tracer.end.z - tracer.start.z;
    const lengthMeters = Math.hypot(dx, dy, dz);
    if (lengthMeters < TRACER_MIN_LENGTH_METERS) return;

    const entry = entries[cursor]!;
    cursor = (cursor + 1) % entries.length;
    entry.worldStart = { ...tracer.start };
    entry.worldDirection = {
      x: dx / lengthMeters,
      y: dy / lengthMeters,
      z: dz / lengthMeters,
    };
    entry.totalLengthMeters = lengthMeters;
    entry.travelledMeters = 0;
    entry.speedMps = Math.min(
      TRACER_MAX_SPEED_MPS,
      Math.max(TRACER_MIN_SPEED_MPS, tracer.speedMps ?? TRACER_DEFAULT_SPEED_MPS),
    );
    entry.active = true;
    entry.streakMesh.visible = true;
    entry.headMesh.visible = true;
  }

  function widthMetersFor(distanceMeters: number): number {
    return Math.min(
      TRACER_MAX_WIDTH_METERS,
      TRACER_WIDTH_METERS + distanceMeters * TRACER_WIDTH_PER_METER,
    );
  }

  function drawEntry(entry: TracerEntry, focusPosition: Vec3): void {
    const headDistance = Math.min(entry.travelledMeters, entry.totalLengthMeters);
    const tailDistance = Math.max(0, entry.travelledMeters - TRACER_STREAK_METERS);
    const streakLength = headDistance - tailDistance;
    if (streakLength <= 0) {
      // Spawned this frame with no elapsed time yet — wait, do not retire it.
      entry.streakMesh.visible = false;
      entry.headMesh.visible = false;
      return;
    }

    axis.set(entry.worldDirection.x, entry.worldDirection.y, entry.worldDirection.z);
    tailPosition.set(
      (entry.worldStart.x + axis.x * tailDistance - focusPosition.x) * renderScale,
      (entry.worldStart.y + axis.y * tailDistance - focusPosition.y) * renderScale,
      (entry.worldStart.z + axis.z * tailDistance - focusPosition.z) * renderScale,
    );
    headPosition.copy(axis).multiplyScalar(streakLength * renderScale).add(tailPosition);

    const distanceMeters = headPosition.distanceTo(cameraPosition) / renderScale;
    const width = widthMetersFor(distanceMeters);
    entry.streakMesh.position.copy(tailPosition);
    alignPlaneAxisToCamera(entry.streakMesh, axis, tailPosition, cameraPosition);
    entry.streakMesh.scale.set(width * renderScale, streakLength * renderScale, 1);
    // Fade only as the streak is consumed by the impact, so flight stays hot.
    entry.streakMaterial.opacity = Math.min(1, streakLength / (TRACER_STREAK_METERS * 0.5));

    const inFlight = entry.travelledMeters < entry.totalLengthMeters;
    entry.headMesh.visible = inFlight;
    if (!inFlight) return;
    entry.headMesh.position.copy(headPosition);
    entry.headMesh.quaternion.copy(cameraQuaternion);
    const headSize = Math.max(TRACER_HEAD_METERS, width * 3.2) * renderScale;
    entry.headMesh.scale.set(headSize, headSize, 1);
    entry.headMaterial.opacity = 0.9;
  }

  function update(dt: number, focusPosition: Vec3, visible: boolean): void {
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(cameraQuaternion);
    const step = Math.max(0, dt);
    for (const entry of entries) {
      if (!entry.active) continue;
      entry.travelledMeters += entry.speedMps * step;
      if (entry.travelledMeters - TRACER_STREAK_METERS >= entry.totalLengthMeters) {
        deactivate(entry);
        continue;
      }
      if (!visible) {
        entry.streakMesh.visible = false;
        entry.headMesh.visible = false;
        continue;
      }
      entry.streakMesh.visible = true;
      drawEntry(entry, focusPosition);
    }
  }

  return {
    dispose() {
      for (const entry of entries) {
        entry.streakMesh.removeFromParent();
        entry.headMesh.removeFromParent();
        entry.streakMaterial.dispose();
        entry.headMaterial.dispose();
      }
      streakGeometry.dispose();
      headGeometry.dispose();
      streakTexture.dispose();
      headTexture.dispose();
    },
    spawn,
    update,
  };
}
