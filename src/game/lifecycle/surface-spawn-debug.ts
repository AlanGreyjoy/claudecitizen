import type { LoopContext } from "../loop_context";

function nearestSurfaceSpawnDistance(
  focus: { x: number; y: number; z: number },
  wide: readonly { position: { x: number; y: number; z: number } }[],
): number {
  let minDist = Infinity;
  for (const inst of wide) {
    const dx = inst.position.x - focus.x;
    const dy = inst.position.y - focus.y;
    const dz = inst.position.z - focus.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function summarizeSurfaceLayers(
  layers: NonNullable<
    ReturnType<NonNullable<LoopContext["renderer"]>["getSurfaceSpawnLayers"]>
  >,
) {
  return layers.map((layer) => ({
    id: layer.id,
    enabled: layer.enabled,
    assetUrl: layer.assetUrl,
    biomes: layer.biomes,
    minH: layer.minNormalizedHeight,
    maxH: layer.maxNormalizedHeight,
    density: layer.density,
    weight: layer.weight,
    collider: layer.collider,
  }));
}

export function getSurfaceSpawnDebug(ctx: LoopContext) {
  const focus = ctx.world.character.position;
  const layers = ctx.renderer?.getSurfaceSpawnLayers() ?? [];
  const nearby = ctx.renderer?.getNearbySurfaceSpawns(focus, 120) ?? [];
  const wide = ctx.renderer?.getNearbySurfaceSpawns(focus, 5_000) ?? [];
  const minDist = nearestSurfaceSpawnDistance(focus, wide);
  return {
    layerCount: layers.length,
    layers: summarizeSurfaceLayers(layers),
    nearbyCount: nearby.length,
    activeColliders: ctx.planetPhysics?.getActiveColliderCount() ?? 0,
    meshCollisionAssets: ctx.renderer?.getSurfaceSpawnMeshCollisions()?.size ?? 0,
    within5km: wide.length,
    minDistMeters: Number.isFinite(minDist) ? Math.round(minDist) : null,
    sample: nearby.slice(0, 3),
    stats: ctx.renderer?.getSurfaceSpawnDebugStats() ?? null,
  };
}
