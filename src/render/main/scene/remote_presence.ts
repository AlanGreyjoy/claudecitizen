import * as THREE from 'three';
import { getShipLayoutForPrefab } from '../../../player/ship_layout';
import type { NetworkRenderEntity, NetworkShipRig, Vec3 } from '../../../types';
import {
  createCharacterAvatarInstance,
  type CharacterAvatarInstance,
} from './character_avatar_model';
import { createShipModel, type ShipModelHandle } from './ship_model';

interface RemotePresenceHandle {
  dispose: () => void;
  update: (entities: NetworkRenderEntity[], focusPosition: Vec3, nowSeconds: number) => void;
}

interface RemoteObject {
  root: THREE.Group;
  avatar: CharacterAvatarInstance;
  shipHandle: ShipModelHandle | null;
  shipPrefabId: string | null;
  marker: THREE.Mesh;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
}

const DEFAULT_REMOTE_SHIP_PREFAB_ID = 'phobos-starhopper';

const DEFAULT_REMOTE_SHIP_RIG: NetworkShipRig = {
  gear01: 0,
  ramp01: 0,
  doors: {},
};

const labelCanvasSize = { width: 256, height: 64 };

function createLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = labelCanvasSize.width;
  canvas.height = labelCanvasSize.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(6, 12, 26, 0.72)';
    ctx.fillRect(0, 12, canvas.width, 36);
    ctx.strokeStyle = 'rgba(139, 216, 255, 0.65)';
    ctx.strokeRect(1, 13, canvas.width - 2, 34);
    ctx.font = '700 24px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8efff';
    ctx.fillText(text.slice(0, 18).toUpperCase(), canvas.width / 2, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function resolveRemoteShipPrefabId(entity: NetworkRenderEntity): string {
  return entity.ship?.prefabId?.trim() || DEFAULT_REMOTE_SHIP_PREFAB_ID;
}

function createRemoteShipHandle(prefabId: string, renderScale: number): ShipModelHandle {
  const layout = getShipLayoutForPrefab(prefabId);
  const handle = createShipModel(renderScale, {
    hullUrl: layout.hullUrl,
    hullNodeOverrides: layout.hullNodeOverrides,
    doors: layout.doors.map((door) => ({
      id: door.id,
      motion: door.motion,
      axis: door.axis,
      nodes: door.nodes,
    })),
    gearHinges: layout.spec.gearHinges,
    rampHinge: layout.spec.rampHinge,
  });
  handle.group.frustumCulled = false;
  return handle;
}

function ensureRemoteShip(
  remote: RemoteObject,
  prefabId: string,
  renderScale: number,
): ShipModelHandle {
  if (remote.shipHandle && remote.shipPrefabId === prefabId) {
    return remote.shipHandle;
  }
  if (remote.shipHandle) {
    remote.root.remove(remote.shipHandle.group);
    remote.shipHandle = null;
    remote.shipPrefabId = null;
  }
  const handle = createRemoteShipHandle(prefabId, renderScale);
  remote.root.add(handle.group);
  remote.shipHandle = handle;
  remote.shipPrefabId = prefabId;
  return handle;
}

function createRemoteObject(displayName: string, renderScale: number): RemoteObject {
  const root = new THREE.Group();
  root.frustumCulled = false;

  const avatar = createCharacterAvatarInstance(renderScale);

  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.7 * renderScale),
    new THREE.MeshBasicMaterial({
      color: 0xffce6f,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );

  const labelTexture = createLabelTexture(displayName);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    }),
  );
  label.scale.set(3.6 * renderScale, 0.9 * renderScale, 1);
  label.position.y = 2.15 * renderScale;

  root.add(avatar.root, marker, label);
  return {
    root,
    avatar,
    shipHandle: null,
    shipPrefabId: null,
    marker,
    label,
    labelTexture,
  };
}

function disposeRemoteObject(object: RemoteObject): void {
  object.avatar.dispose();
  if (object.shipHandle) {
    object.root.remove(object.shipHandle.group);
    object.shipHandle = null;
    object.shipPrefabId = null;
  }
  object.marker.geometry.dispose();
  if (Array.isArray(object.marker.material)) {
    object.marker.material.forEach((material) => material.dispose());
  } else {
    object.marker.material.dispose();
  }
  object.labelTexture.dispose();
  object.label.material.dispose();
}

function setRootPose(
  root: THREE.Group,
  body: { position: Vec3; forward: Vec3; up: Vec3 },
  focusPosition: Vec3,
  renderScale: number,
): void {
  root.position.set(
    (body.position.x - focusPosition.x) * renderScale,
    (body.position.y - focusPosition.y) * renderScale,
    (body.position.z - focusPosition.z) * renderScale,
  );
  root.up.set(body.up.x, body.up.y, body.up.z);
  root.lookAt(
    root.position.x + body.forward.x * 8 * renderScale,
    root.position.y + body.forward.y * 8 * renderScale,
    root.position.z + body.forward.z * 8 * renderScale,
  );
}

function setMarkerPose(
  root: THREE.Group,
  markerPosition: Vec3,
  focusPosition: Vec3,
  renderScale: number,
): void {
  root.position.set(
    (markerPosition.x - focusPosition.x) * renderScale,
    (markerPosition.y - focusPosition.y) * renderScale,
    (markerPosition.z - focusPosition.z) * renderScale,
  );
}

export function createRemotePresenceRenderer(
  scene: THREE.Scene,
  renderScale: number,
): RemotePresenceHandle {
  const remotes = new Map<string, RemoteObject>();

  function getRemote(entity: NetworkRenderEntity): RemoteObject {
    const existing = remotes.get(entity.id);
    if (existing) return existing;
    const created = createRemoteObject(entity.displayName, renderScale);
    remotes.set(entity.id, created);
    scene.add(created.root);
    return created;
  }

  function update(
    entities: NetworkRenderEntity[],
    focusPosition: Vec3,
    nowSeconds: number,
  ): void {
    const live = new Set<string>();
    for (const entity of entities) {
      live.add(entity.id);
      const remote = getRemote(entity);
      const isMarker = entity.lod === 'marker';
      const body = entity.mode === 'in-ship' ? entity.ship : entity.character;
      const shipVisible = !isMarker && entity.mode === 'in-ship' && entity.ship !== null;
      const avatarVisible = !isMarker && !shipVisible && entity.character !== null;

      remote.avatar.root.visible = avatarVisible;
      if (remote.shipHandle) {
        remote.shipHandle.group.visible = shipVisible;
      }
      remote.marker.visible = isMarker;
      remote.label.visible = !isMarker;

      if (avatarVisible && entity.character) {
        remote.avatar.setAnimation(entity.character.animation);
        remote.avatar.updateMixer(nowSeconds);
      }

      if (shipVisible && entity.ship) {
        const handle = ensureRemoteShip(remote, resolveRemoteShipPrefabId(entity), renderScale);
        handle.setArticulation(entity.shipRig ?? DEFAULT_REMOTE_SHIP_RIG);
      }

      if (isMarker || !body) {
        setMarkerPose(remote.root, entity.markerPosition, focusPosition, renderScale);
      } else {
        setRootPose(remote.root, body, focusPosition, renderScale);
      }
      remote.root.visible = true;
    }

    for (const [id, remote] of remotes) {
      if (live.has(id)) continue;
      scene.remove(remote.root);
      disposeRemoteObject(remote);
      remotes.delete(id);
    }
  }

  function dispose(): void {
    for (const remote of remotes.values()) {
      scene.remove(remote.root);
      disposeRemoteObject(remote);
    }
    remotes.clear();
  }

  return { dispose, update };
}
