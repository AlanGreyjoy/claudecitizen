import * as THREE from 'three';
import type { TerrainTileBuffers, TileInfo } from '../../../types';
import { TILE_GRID_INDICES } from '../domain/grid_indices';

export function createTileGeometry(buffers: TerrainTileBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(TILE_GRID_INDICES, 1));
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
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.receiveShadow = true;
  tileGroup.add(mesh);
  return mesh;
}
