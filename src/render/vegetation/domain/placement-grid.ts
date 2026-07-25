import type { Vec3 } from '../../../types';

export interface PlacementGrid {
  cellSize: number;
  cells: Map<string, Vec3[]>;
  minDistanceSquared: number;
}

export function createPlacementGrid(minimumGapMeters: number): PlacementGrid | null {
  if (!(minimumGapMeters > 0)) return null;
  return {
    cellSize: minimumGapMeters,
    cells: new Map(),
    minDistanceSquared: minimumGapMeters * minimumGapMeters,
  };
}

function placementCellKey(cellX: number, cellY: number, cellZ: number): string {
  return `${cellX}:${cellY}:${cellZ}`;
}

export function canPlaceWithGap(grid: PlacementGrid | null, position: Vec3): boolean {
  if (!grid) return true;

  const cellX = Math.floor(position.x / grid.cellSize);
  const cellY = Math.floor(position.y / grid.cellSize);
  const cellZ = Math.floor(position.z / grid.cellSize);

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const placements = grid.cells.get(
          placementCellKey(cellX + dx, cellY + dy, cellZ + dz),
        );
        if (!placements) continue;
        for (const placed of placements) {
          const dxPos = position.x - placed.x;
          const dyPos = position.y - placed.y;
          const dzPos = position.z - placed.z;
          if (
            dxPos * dxPos + dyPos * dyPos + dzPos * dzPos <
            grid.minDistanceSquared
          ) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

export function registerPlacement(grid: PlacementGrid | null, position: Vec3): void {
  if (!grid) return;

  const cellX = Math.floor(position.x / grid.cellSize);
  const cellY = Math.floor(position.y / grid.cellSize);
  const cellZ = Math.floor(position.z / grid.cellSize);
  const key = placementCellKey(cellX, cellY, cellZ);
  const placements = grid.cells.get(key) ?? [];
  placements.push({ x: position.x, y: position.y, z: position.z });
  if (!grid.cells.has(key)) grid.cells.set(key, placements);
}
