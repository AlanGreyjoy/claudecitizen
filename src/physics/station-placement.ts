import * as RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';
import {
  loadMeshAsset,
  type GameplayCollider,
  type MeshGameplayCollider,
} from './colliders';
import {
  QUERY_GROUPS_EXCLUDE_NPCS,
} from './rapier-world';
import type { StationPhysics } from './station-physics';

/**
 * Lift the probe off the floor so flush floor contact is not treated as a
 * blocked placement. Same trap as NPC path probes / camera occlusion: a shape
 * already touching geometry reports an immediate intersection.
 */
const FLOOR_CLEARANCE_METERS = 0.03;

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _boundsCenter = new THREE.Vector3();
const _boundsSize = new THREE.Vector3();
const _probeMatrix = new THREE.Matrix4();

interface ProbeShape {
  translation: RAPIER.Vector3;
  rotation: RAPIER.Quaternion;
  shape: RAPIER.Shape;
}

function decomposeProbeMatrix(matrix: THREE.Matrix4): {
  translation: RAPIER.Vector3;
  rotation: RAPIER.Quaternion;
  scale: THREE.Vector3;
} {
  matrix.decompose(_position, _quaternion, _scale);
  return {
    translation: new RAPIER.Vector3(
      _position.x,
      _position.y + FLOOR_CLEARANCE_METERS,
      _position.z,
    ),
    rotation: new RAPIER.Quaternion(
      _quaternion.x,
      _quaternion.y,
      _quaternion.z,
      _quaternion.w,
    ),
    scale: _scale.clone(),
  };
}

function boxProbeShape(collider: Extract<GameplayCollider, { kind: 'box' }>): ProbeShape {
  const { translation, rotation, scale } = decomposeProbeMatrix(collider.baseLocalToSpace);
  return {
    translation,
    rotation,
    shape: new RAPIER.Cuboid(
      Math.max(0.001, collider.halfSize.x * Math.abs(scale.x)),
      Math.max(0.001, collider.halfSize.y * Math.abs(scale.y)),
      Math.max(0.001, collider.halfSize.z * Math.abs(scale.z)),
    ),
  };
}

function meshBoundsProbeShape(
  collider: MeshGameplayCollider,
  bounds: THREE.Box3,
): ProbeShape {
  bounds.getCenter(_boundsCenter);
  bounds.getSize(_boundsSize);
  _probeMatrix
    .copy(collider.baseLocalToSpace)
    .multiply(new THREE.Matrix4().makeTranslation(_boundsCenter.x, _boundsCenter.y, _boundsCenter.z));
  const { translation, rotation, scale } = decomposeProbeMatrix(_probeMatrix);
  return {
    translation,
    rotation,
    shape: new RAPIER.Cuboid(
      Math.max(0.001, (_boundsSize.x * 0.5) * Math.abs(scale.x)),
      Math.max(0.001, (_boundsSize.y * 0.5) * Math.abs(scale.y)),
      Math.max(0.001, (_boundsSize.z * 0.5) * Math.abs(scale.z)),
    ),
  };
}

async function probeShapesForColliders(
  colliders: readonly GameplayCollider[],
): Promise<ProbeShape[]> {
  const shapes: ProbeShape[] = [];
  for (const collider of colliders) {
    if (collider.kind === 'box') {
      shapes.push(boxProbeShape(collider));
      continue;
    }
    const asset = await loadMeshAsset(collider);
    if (!asset) continue;
    shapes.push(meshBoundsProbeShape(collider, asset.bounds));
  }
  return shapes;
}

function excludeHandles(
  physics: StationPhysics,
  excludePlacementId: string | undefined,
): Set<number> {
  const excluded = new Set<number>([physics.player.playerCollider.handle]);
  if (!excludePlacementId) return excluded;
  const prefix = `${excludePlacementId}:`;
  for (let index = 0; index < physics.dynamicColliders.length; index += 1) {
    const id = physics.dynamicColliderIds[index];
    if (!id?.startsWith(prefix)) continue;
    excluded.add(physics.dynamicColliders[index]!.handle);
  }
  return excluded;
}

/**
 * Returns true when any of the proposed prop colliders intersect station
 * statics or other placed prop dynamics (player + NPCs ignored; floor contact
 * cleared by a small upward lift).
 */
export async function stationPlacementBlocked(
  physics: StationPhysics,
  colliders: readonly GameplayCollider[],
  options: { excludePlacementId?: string } = {},
): Promise<boolean> {
  if (colliders.length === 0) return false;
  const shapes = await probeShapesForColliders(colliders);
  // Authored colliders that failed to bake must not silently allow a clip.
  if (shapes.length === 0) return true;

  const excluded = excludeHandles(physics, options.excludePlacementId);
  for (const probe of shapes) {
    const hit = physics.world.intersectionWithShape(
      probe.translation,
      probe.rotation,
      probe.shape,
      undefined,
      QUERY_GROUPS_EXCLUDE_NPCS,
      physics.player.playerCollider,
      undefined,
      (collider) => !excluded.has(collider.handle),
    );
    if (hit) return true;
  }
  return false;
}
