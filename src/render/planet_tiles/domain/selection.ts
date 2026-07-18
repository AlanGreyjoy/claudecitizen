import type { CubeFace, Planet, TileInfo, Vec3 } from '../../../types';
import { CUBE_FACES, faceUvFromDirection } from '../../../world/cube_sphere';
import { radialUp } from '../../../world/coordinates';
import { MIN_LEVEL } from './constants';
import {
  shouldCullTile,
  shouldSplitTile,
  type TileSelectionView,
} from './lod';
import { makeTileInfo, tileKey } from './tile_info';
import { clamp } from './tile_key';

export type { TileSelectionView };

export interface TileSelectionLodState {
  nextSplitKeys: Set<string>;
  previousSplitKeys: ReadonlySet<string>;
}

export function visitSelectedTiles(
  planet: Planet,
  bodyPosition: Vec3,
  altitudeMeters: number,
  visitTile: (info: TileInfo) => void,
  view?: TileSelectionView | null,
  lodState?: TileSelectionLodState,
): void {
  const cameraUp = radialUp(bodyPosition);
  const cameraFace = faceUvFromDirection(cameraUp);
  const faceOrder: CubeFace[] = [
    cameraFace.face,
    ...CUBE_FACES.filter((face) => face !== cameraFace.face),
  ];

  function cameraChildIndex(level: number) {
    const tileCount = 2 ** level;
    return {
      x: clamp(Math.floor(((cameraFace.u + 1) * 0.5) * tileCount), 0, tileCount - 1),
      y: clamp(Math.floor(((cameraFace.v + 1) * 0.5) * tileCount), 0, tileCount - 1),
    };
  }

  function orderedChildren(face: CubeFace, level: number, x: number, y: number) {
    const childLevel = level + 1;
    const children = [
      { x: x * 2, y: y * 2 },
      { x: x * 2 + 1, y: y * 2 },
      { x: x * 2, y: y * 2 + 1 },
      { x: x * 2 + 1, y: y * 2 + 1 },
    ];

    if (face !== cameraFace.face) return children;

    const cameraChild = cameraChildIndex(childLevel);
    children.sort((a, b) => {
      const aDistance = Math.abs(a.x - cameraChild.x) + Math.abs(a.y - cameraChild.y);
      const bDistance = Math.abs(b.x - cameraChild.x) + Math.abs(b.y - cameraChild.y);
      return aDistance - bDistance;
    });
    return children;
  }

  function traverse(face: CubeFace, level: number, x: number, y: number): boolean {
    const info = makeTileInfo(face, level, x, y, planet);
    if (level <= 1 && face !== cameraFace.face && level < MIN_LEVEL) {
      let any = false;
      for (const child of orderedChildren(face, level, x, y)) {
        if (traverse(face, level + 1, child.x, child.y)) any = true;
      }
      return any;
    }
    if (shouldCullTile(info, planet, cameraUp, altitudeMeters, bodyPosition, view)) {
      return false;
    }
    const key = tileKey(info.face, info.level, info.x, info.y);
    const wasSplit = lodState?.previousSplitKeys.has(key) ?? false;
    if (shouldSplitTile(info, planet, bodyPosition, cameraUp, altitudeMeters, wasSplit)) {
      lodState?.nextSplitKeys.add(key);
      let anyChild = false;
      for (const child of orderedChildren(face, level, x, y)) {
        if (traverse(face, level + 1, child.x, child.y)) anyChild = true;
      }
      // If every child was culled, keep the parent so we never show a hole.
      if (!anyChild) {
        visitTile(info);
        return true;
      }
      return true;
    }
    visitTile(info);
    return true;
  }

  for (const face of faceOrder) {
    traverse(face, 0, 0, 0);
  }
}
