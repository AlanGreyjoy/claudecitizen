/**
 * Alternating cell diagonals avoid the long directional ridges produced when
 * every terrain quad leans the same way. Global grid coordinates keep the
 * pattern deterministic across tile boundaries.
 */
export function terrainCellUsesNorthwestSoutheastDiagonal(
  gridX: number,
  gridY: number,
): boolean {
  return (gridX + gridY) % 2 === 0;
}
