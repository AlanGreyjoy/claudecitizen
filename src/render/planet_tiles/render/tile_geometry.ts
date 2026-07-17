import * as THREE from 'three';
import type { TerrainTileBuffers, TileInfo } from '../../../types';

export function createTileGeometry(buffers: TerrainTileBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3, true));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3, true));
  return geometry;
}

export function createReadyMesh(
  info: TileInfo,
  buffers: TerrainTileBuffers,
  material: THREE.MeshStandardMaterial,
  tileGroup: THREE.Group,
): THREE.Mesh {
  const mesh = new THREE.Mesh(createTileGeometry(buffers), material);
  mesh.position.set(info.centerPosition.x, info.centerPosition.y, info.centerPosition.z);
  // Vertex positions are tile-center relative, so the geometry bounding sphere
  // is tight and frustum culling is safe (and skips most of the planet).
  mesh.geometry.computeBoundingSphere();
  mesh.visible = false;
  mesh.receiveShadow = true;
  tileGroup.add(mesh);
  return mesh;
}
