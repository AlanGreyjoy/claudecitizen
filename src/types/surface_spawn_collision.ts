/** Mesh-derived box collider for a surface-spawn GLB at scale = 1. */
export interface SurfaceSpawnMeshCollision {
  halfExtents: [number, number, number];
  /** Center offset in instance-local space (Y = up) with body on the surface. */
  center: [number, number, number];
}
