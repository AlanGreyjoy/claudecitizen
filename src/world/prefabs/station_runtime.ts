import { mulQuat, quatIdentity, rotateVec3ByQuat, type Quat } from '../../math/quat';
import { vec3 } from '../../math/vec3';
import {
  type HangarSpec,
  type StationDir2,
  type StationElevatorMarker,
  type StationFloorId,
  type StationInfoMarker,
  type StationAvmsMarker,
  type StationWeaponShopMarker,
  type StationOutfittersMarker,
  type StationLayoutOverride,
  type StationRoom,
  type StationSpawnPose,
} from '../station';
import type { PrefabDocument, PrefabEntity } from './schema';
import type { Vec3 } from '../../types';
import { buildPrefabColliders } from '../../physics/prefab_colliders';
import {
  type ColliderAnimationBinding,
  type GameplayCollider,
  preloadMeshColliders,
  validateMeshColliders,
} from '../../physics/colliders';
import { buildPrefabSounds } from './sound_runtime';
import {
  type StationNpcPlacementSpec,
  type StationNpcSpawnerSpec,
  type StationNpcWaypointSpec,
  validateStationNpcLayout,
} from '../npc';

/**
 * Derives gameplay layout (spawn, elevators, hangar pads, info prompts) from a
 * station prefab's components. The player now walks on real collider geometry,
 * so this no longer produces walk-volume rooms.
 *
 * Prefab/scene axes map to station-local gameplay axes as right = -x,
 * up = y, forward = z (matching the render group orientation from
 * updateShipPlacement).
 */

const MARKER_RADIUS = 2.5;
const DEFAULT_WEAPON_SHOP_GAZE_RADIUS = 0.4;
const DEFAULT_WEAPON_SHOP_MAX_DISTANCE = 3;
const DEFAULT_WEAPON_SHOP_SCREEN_WIDTH = 0.45;
const DEFAULT_WEAPON_SHOP_SCREEN_HEIGHT = 0.28;
const DEFAULT_OUTFITTERS_GAZE_RADIUS = 0.4;
const DEFAULT_OUTFITTERS_MAX_DISTANCE = 3;
const DEFAULT_OUTFITTERS_SCREEN_WIDTH = 0.45;
const DEFAULT_OUTFITTERS_SCREEN_HEIGHT = 0.28;


interface FlattenedComponents {
  rooms: StationRoom[];
  spawnCandidates: {
    floorId: StationFloorId;
    right: number;
    up: number;
    forward: number;
    face: StationDir2;
  }[];
  elevatorSeeds: {
    pairId: string;
    targetFloor: StationFloorId;
    floorId: StationFloorId;
    right: number;
    up: number;
    forward: number;
    face: StationDir2;
  }[];
  hangarSeeds: {
    hangarId: string;
    padIndex: number;
    floorId: StationFloorId;
    right: number;
    up: number;
    forward: number;
  }[];
  infoSeeds: {
    id: string;
    prompt: string;
    radius: number;
    floorId: StationFloorId;
    right: number;
    up: number;
    forward: number;
    interactionType?: "info" | "animation";
    targetAnimationId?: string;
    keyLabel?: string;
    proximitySoundUrl?: string;
    interactSoundUrl?: string;
  }[];
  avmsSeeds: {
    id: string;
    radius: number;
    floorId: StationFloorId;
    right: number;
    up: number;
    forward: number;
  }[];
  weaponShopSeeds: {
    id: string;
    label: string;
    right: number;
    up: number;
    forward: number;
    rotation: Quat;
    gazeRadius: number;
    maxDistance: number;
    screenWidth: number;
    screenHeight: number;
    itemDefinitionIds: string[];
  }[];
  outfittersSeeds: {
    id: string;
    label: string;
    right: number;
    up: number;
    forward: number;
    rotation: Quat;
    gazeRadius: number;
    maxDistance: number;
    screenWidth: number;
    screenHeight: number;
    itemDefinitionIds: string[];
  }[];
  animationSpecs: {
    id: string;
    motion: "slide" | "hinge";
    axis: "x" | "y" | "z";
    nodes: { name: string; delta: number }[];
  }[];
  npcSpawners: StationNpcSpawnerSpec[];
  npcWaypoints: StationNpcWaypointSpec[];
  npcPlacements: StationNpcPlacementSpec[];
}

function sceneToStationDir2(worldRotation: Quat): StationDir2 {
  const forward = rotateVec3ByQuat(vec3(0, 0, 1), worldRotation);
  const right = -forward.x;
  const fwd = forward.z;
  const len = Math.hypot(right, fwd);
  if (len < 1e-4) return { right: 0, forward: 1 };
  return { right: right / len, forward: fwd / len };
}

function collect(
  entity: PrefabEntity,
  parentPosition: Vec3,
  parentRotation: Quat,
  parentScale: Vec3,
  out: FlattenedComponents,
): void {
  const scaledLocal = vec3(
    entity.transform.position.x * parentScale.x,
    entity.transform.position.y * parentScale.y,
    entity.transform.position.z * parentScale.z,
  );
  const rotated = rotateVec3ByQuat(scaledLocal, parentRotation);
  const position = vec3(
    parentPosition.x + rotated.x,
    parentPosition.y + rotated.y,
    parentPosition.z + rotated.z,
  );
  const rotation = mulQuat(parentRotation, entity.transform.rotation);
  const scale = vec3(
    parentScale.x * entity.transform.scale.x,
    parentScale.y * entity.transform.scale.y,
    parentScale.z * entity.transform.scale.z,
  );

  const right = -position.x;
  const forward = position.z;

  for (const component of entity.components ?? []) {
    switch (component.type) {
      case 'spawn-point':
        out.spawnCandidates.push({
          floorId: component.floorId,
          right,
          up: position.y,
          forward,
          face: sceneToStationDir2(rotation),
        });
        break;
      case 'npc-spawner':
        out.npcSpawners.push({
          id: component.id,
          populationId: component.populationId,
          floorId: component.floorId,
          minAlive: component.minAlive,
          maxAlive: component.maxAlive,
          routeGroup: component.routeGroup,
          radius: component.radius,
          right,
          up: position.y,
          forward,
          face: sceneToStationDir2(rotation),
        });
        break;
      case 'npc-waypoint':
        out.npcWaypoints.push({
          id: component.id,
          floorId: component.floorId,
          routeGroup: component.routeGroup,
          links: component.links,
          waitMinSeconds: component.waitMinSeconds,
          waitMaxSeconds: component.waitMaxSeconds,
          right,
          up: position.y,
          forward,
        });
        break;
      case 'npc-placement':
        out.npcPlacements.push({
          id: component.id,
          npcDefinitionId: component.npcDefinitionId,
          displayName: component.displayName,
          floorId: component.floorId,
          behavior: component.behavior,
          routeGroup: component.routeGroup,
          right,
          up: position.y,
          forward,
          face: sceneToStationDir2(rotation),
        });
        break;
      case 'elevator':
        out.elevatorSeeds.push({
          pairId: component.id,
          targetFloor: component.targetFloor,
          floorId: component.floorId,
          right,
          up: position.y,
          forward,
          face: sceneToStationDir2(rotation),
        });
        break;
      case 'hangar-pad':
        out.hangarSeeds.push({
          hangarId: component.hangarId,
          padIndex: component.padIndex,
          floorId: component.floorId ?? 'hangar',
          right,
          up: position.y,
          forward,
        });
        break;
      case 'interaction':
        out.infoSeeds.push({
          id: component.id,
          prompt: component.prompt,
          radius: component.radius,
          floorId: component.floorId,
          right,
          up: position.y,
          forward,
          interactionType: component.interactionType,
          targetAnimationId: component.targetAnimationId,
          keyLabel: component.keyLabel,
          proximitySoundUrl: component.proximitySoundUrl,
          interactSoundUrl: component.interactSoundUrl,
        });
        break;
      case 'avms-terminal':
        out.avmsSeeds.push({
          id: component.id,
          radius: component.radius,
          floorId: component.floorId,
          right,
          up: position.y,
          forward,
        });
        break;
      case 'weapon-shop':
        out.weaponShopSeeds.push({
          id: component.id || entity.id,
          label: component.label?.trim() || 'Browse weapons',
          right,
          up: position.y,
          forward,
          rotation,
          gazeRadius: component.gazeRadius ?? DEFAULT_WEAPON_SHOP_GAZE_RADIUS,
          maxDistance: component.maxDistance ?? DEFAULT_WEAPON_SHOP_MAX_DISTANCE,
          screenWidth: component.screenWidth ?? DEFAULT_WEAPON_SHOP_SCREEN_WIDTH,
          screenHeight: component.screenHeight ?? DEFAULT_WEAPON_SHOP_SCREEN_HEIGHT,
          itemDefinitionIds: component.itemDefinitionIds ?? [],
        });
        break;
      case 'outfitters':
        out.outfittersSeeds.push({
          id: component.id || entity.id,
          label: component.label?.trim() || 'Browse outfitters',
          right,
          up: position.y,
          forward,
          rotation,
          gazeRadius: component.gazeRadius ?? DEFAULT_OUTFITTERS_GAZE_RADIUS,
          maxDistance: component.maxDistance ?? DEFAULT_OUTFITTERS_MAX_DISTANCE,
          screenWidth: component.screenWidth ?? DEFAULT_OUTFITTERS_SCREEN_WIDTH,
          screenHeight: component.screenHeight ?? DEFAULT_OUTFITTERS_SCREEN_HEIGHT,
          itemDefinitionIds: component.itemDefinitionIds ?? [],
        });
        break;
      case 'animation':
        out.animationSpecs.push({
          id: component.id,
          motion: component.motion,
          axis: component.axis,
          nodes: component.nodes,
        });
        break;
      case 'station-frame':
      case 'collider':
        break;
    }
  }

  for (const child of entity.children ?? []) {
    collect(child, position, rotation, scale, out);
  }
}

/**
 * Attaches an animation binding to each collider whose `node` names an
 * animation-driven GLB node, so the game loop can disable the collider when the
 * door is open. A collider with no matching node is simply a static collider
 * (floors, walls, handrails) — that is the normal case and is not warned about.
 *
 * The real "door won't work" signal is the inverse: an `animation` component
 * with *no* collider bound to it. Such a door animates visually but its collider
 * stays enabled (see `station_physics.ts` `setDoorColliderEnabled` no-op), so the
 * player can't walk through. That case is warned about once per animation.
 */
function bindStationColliderAnimations(
  colliders: GameplayCollider[],
  animations: FlattenedComponents["animationSpecs"],
  prefabId: string,
): GameplayCollider[] {
  if (animations.length === 0) return colliders;
  const boundAnimationIds = new Set<string>();
  const result = colliders.map((collider) => {
    if (!collider.node) return collider;
    for (const anim of animations) {
      const node = anim.nodes.find((entry) => entry.name === collider.node);
      if (node) {
        boundAnimationIds.add(anim.id);
        const animation: ColliderAnimationBinding = {
          kind: "door",
          doorId: anim.id,
          motion: anim.motion,
          axis: anim.axis,
          delta: node.delta,
        };
        return { ...collider, animation };
      }
    }
    return collider;
  });
  for (const anim of animations) {
    if (!boundAnimationIds.has(anim.id)) {
      console.warn(
        `Station prefab "${prefabId}" animation "${anim.id}" has no collider bound to node(s) ${anim.nodes
          .map((n) => `"${n.name}"`)
          .join(", ")}; the door will animate visually but its collider stays enabled (player can't walk through).`,
      );
    }
  }
  return result;
}

/**
 * Builds the gameplay layout override for a station prefab. The player now
 * walks on real collider geometry, so this no longer produces walk-volume rooms.
 *
 * Prefab/scene axes map to station-local gameplay axes as right = -x,
 * up = y, forward = z (matching the render group orientation from
 * updateShipPlacement).
 */
export async function buildStationLayoutFromPrefab(doc: PrefabDocument): Promise<StationLayoutOverride | null> {
  const out: FlattenedComponents = {
    rooms: [],
    spawnCandidates: [],
    elevatorSeeds: [],
    hangarSeeds: [],
    infoSeeds: [],
    avmsSeeds: [],
    weaponShopSeeds: [],
    outfittersSeeds: [],
    animationSpecs: [],
    npcSpawners: [],
    npcWaypoints: [],
    npcPlacements: [],
  };
  collect(doc.root, vec3(0, 0, 0), quatIdentity(), vec3(1, 1, 1), out);
  for (const issue of validateStationNpcLayout({
    spawners: out.npcSpawners,
    waypoints: out.npcWaypoints,
    placements: out.npcPlacements,
  })) {
    console.warn(`Prefab "${doc.id}" NPC authoring: ${issue}`);
  }
  const colliders = bindStationColliderAnimations(
    await buildPrefabColliders(doc),
    out.animationSpecs,
    doc.id,
  );
  await preloadMeshColliders(colliders);
  validateMeshColliders(colliders);

  let spawn: StationSpawnPose | null = null;
  if (out.spawnCandidates.length > 0) {
    const candidate = out.spawnCandidates[0];
    spawn = {
      roomId: candidate.floorId,
      right: candidate.right,
      up: candidate.up,
      forward: candidate.forward,
      face: candidate.face,
    };
  } else {
    spawn = { roomId: 'none', right: 0, up: 0, forward: 0, face: { right: 0, forward: 1 } };
    console.warn(`Prefab "${doc.id}" has no spawn-point; spawning at origin with collider-based floor.`);
  }

  const elevatorMarkers: StationElevatorMarker[] = [];
  for (const seed of out.elevatorSeeds) {
    elevatorMarkers.push({
      pairId: seed.pairId,
      floorId: seed.floorId,
      roomId: seed.floorId,
      right: seed.right,
      up: seed.up,
      forward: seed.forward,
      radius: MARKER_RADIUS,
      targetFloor: seed.targetFloor,
      face: seed.face,
    });
  }

  const hangars: HangarSpec[] = [];
  for (const seed of out.hangarSeeds) {
    // hangar-pad markers are placed at pad surface height; the parked ship's
    // rest offset above it comes from the active ship layout at call time.
    hangars.push({
      index: seed.padIndex,
      roomId: seed.floorId,
      centerRight: seed.right,
      lobbyDoorForward: 0,
      padSurfaceLocal: {
        right: seed.right,
        up: seed.up,
        forward: seed.forward,
      },
    });
  }

  const infoMarkers: StationInfoMarker[] = [];
  for (const seed of out.infoSeeds) {
    infoMarkers.push({
      id: seed.id,
      floorId: seed.floorId,
      right: seed.right,
      up: seed.up,
      forward: seed.forward,
      radius: seed.radius,
      prompt: seed.prompt,
      interactionType: seed.interactionType,
      targetAnimationId: seed.targetAnimationId,
      keyLabel: seed.keyLabel,
    });
  }

  const avmsMarkers: StationAvmsMarker[] = [];
  for (const seed of out.avmsSeeds) {
    avmsMarkers.push({
      id: seed.id,
      floorId: seed.floorId,
      right: seed.right,
      up: seed.up,
      forward: seed.forward,
      radius: seed.radius,
    });
  }

  const weaponShops: StationWeaponShopMarker[] = [];
  for (const seed of out.weaponShopSeeds) {
    if (weaponShops.some((shop) => shop.id === seed.id)) continue;
    weaponShops.push({
      id: seed.id,
      label: seed.label,
      right: seed.right,
      up: seed.up,
      forward: seed.forward,
      rotation: {
        x: seed.rotation.x,
        y: seed.rotation.y,
        z: seed.rotation.z,
        w: seed.rotation.w,
      },
      gazeRadius: seed.gazeRadius,
      maxDistance: seed.maxDistance,
      screenWidth: seed.screenWidth,
      screenHeight: seed.screenHeight,
      itemDefinitionIds: seed.itemDefinitionIds,
    });
  }

  const outfitters: StationOutfittersMarker[] = [];
  for (const seed of out.outfittersSeeds) {
    if (outfitters.some((shop) => shop.id === seed.id)) continue;
    outfitters.push({
      id: seed.id,
      label: seed.label,
      right: seed.right,
      up: seed.up,
      forward: seed.forward,
      rotation: {
        x: seed.rotation.x,
        y: seed.rotation.y,
        z: seed.rotation.z,
        w: seed.rotation.w,
      },
      gazeRadius: seed.gazeRadius,
      maxDistance: seed.maxDistance,
      screenWidth: seed.screenWidth,
      screenHeight: seed.screenHeight,
      itemDefinitionIds: seed.itemDefinitionIds,
    });
  }

  return {
    rooms: out.rooms,
    doorways: [],
    hangars,
    colliders,
    spawn,
    elevatorMarkers,
    infoMarkers,
    avmsMarkers,
    weaponShops,
    outfitters,
    npcSpawners: out.npcSpawners,
    npcWaypoints: out.npcWaypoints,
    npcPlacements: out.npcPlacements,
    sounds: buildPrefabSounds(doc),
  };
}
