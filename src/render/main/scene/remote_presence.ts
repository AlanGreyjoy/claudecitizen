import * as THREE from 'three';
import type { NetworkRenderEntity, Vec3 } from '../../../types';

interface RemotePresenceHandle {
  dispose: () => void;
  update: (entities: NetworkRenderEntity[], focusPosition: Vec3) => void;
}

interface RemoteObject {
  root: THREE.Group;
  avatar: THREE.Mesh;
  ship: THREE.Mesh;
  marker: THREE.Mesh;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
}

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

function createRemoteObject(displayName: string, renderScale: number): RemoteObject {
  const root = new THREE.Group();
  root.frustumCulled = false;

  const avatar = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34 * renderScale, 1.15 * renderScale, 4, 10),
    new THREE.MeshStandardMaterial({
      color: 0x8bd8ff,
      emissive: 0x143044,
      emissiveIntensity: 0.35,
      roughness: 0.65,
      metalness: 0.1,
    }),
  );
  avatar.castShadow = true;
  avatar.receiveShadow = true;

  const ship = new THREE.Mesh(
    new THREE.ConeGeometry(1.25 * renderScale, 3.4 * renderScale, 4),
    new THREE.MeshStandardMaterial({
      color: 0xffce6f,
      emissive: 0x3a2505,
      emissiveIntensity: 0.3,
      roughness: 0.48,
      metalness: 0.35,
    }),
  );
  ship.rotation.x = Math.PI / 2;
  ship.castShadow = true;
  ship.receiveShadow = true;

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

  root.add(avatar, ship, marker, label);
  return { root, avatar, ship, marker, label, labelTexture };
}

function disposeRemoteObject(object: RemoteObject): void {
  object.avatar.geometry.dispose();
  if (Array.isArray(object.avatar.material)) {
    object.avatar.material.forEach((material) => material.dispose());
  } else {
    object.avatar.material.dispose();
  }
  object.ship.geometry.dispose();
  if (Array.isArray(object.ship.material)) {
    object.ship.material.forEach((material) => material.dispose());
  } else {
    object.ship.material.dispose();
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

  function update(entities: NetworkRenderEntity[], focusPosition: Vec3): void {
    const live = new Set<string>();
    for (const entity of entities) {
      live.add(entity.id);
      const remote = getRemote(entity);
      const isMarker = entity.lod === 'marker';
      const body = entity.mode === 'in-ship' ? entity.ship : entity.character;
      const shipVisible = !isMarker && entity.mode === 'in-ship' && entity.ship !== null;
      const avatarVisible = !isMarker && !shipVisible && entity.character !== null;

      remote.avatar.visible = avatarVisible;
      remote.ship.visible = shipVisible;
      remote.marker.visible = isMarker;
      remote.label.visible = !isMarker;

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
