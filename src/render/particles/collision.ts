import type { PrefabParticleCollision } from "../../world/prefabs/schema";

export interface CollisionParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  lifetime: number;
  alive: boolean;
}

function reflect(
  vx: number,
  vy: number,
  vz: number,
  nx: number,
  ny: number,
  nz: number,
  bounce: number,
  dampen: number,
): { vx: number; vy: number; vz: number } {
  const len = Math.hypot(nx, ny, nz) || 1;
  const nnx = nx / len;
  const nny = ny / len;
  const nnz = nz / len;
  const dot = vx * nnx + vy * nny + vz * nnz;
  if (dot >= 0) return { vx, vy, vz };
  const keep = Math.max(0, 1 - dampen);
  return {
    vx: (vx - 2 * dot * nnx) * bounce * keep,
    vy: (vy - 2 * dot * nny) * bounce * keep,
    vz: (vz - 2 * dot * nnz) * bounce * keep,
  };
}

/**
 * Plane-only particle collision. Never queries Rapier / mesh colliders.
 * Positions are in the particle simulation space (local or world).
 */
export function resolveParticlePlaneCollisions(
  particle: CollisionParticle,
  collision: PrefabParticleCollision,
  worldYOffset = 0,
): void {
  if (!collision.enabled || !particle.alive) return;

  const speed = Math.hypot(particle.vx, particle.vy, particle.vz);
  if (speed > collision.maxKillSpeed) {
    particle.alive = false;
    return;
  }

  const planes: { px: number; py: number; pz: number; nx: number; ny: number; nz: number }[] =
    [];
  if (collision.groundPlane) {
    planes.push({ px: 0, py: worldYOffset, pz: 0, nx: 0, ny: 1, nz: 0 });
  }
  for (const plane of collision.planes) {
    planes.push({
      px: plane.point.x,
      py: plane.point.y,
      pz: plane.point.z,
      nx: plane.normal.x,
      ny: plane.normal.y,
      nz: plane.normal.z,
    });
  }

  for (const plane of planes) {
    const dist =
      (particle.x - plane.px) * plane.nx +
      (particle.y - plane.py) * plane.ny +
      (particle.z - plane.pz) * plane.nz;
    if (dist >= 0) continue;
    particle.x -= dist * plane.nx;
    particle.y -= dist * plane.ny;
    particle.z -= dist * plane.nz;
    const reflected = reflect(
      particle.vx,
      particle.vy,
      particle.vz,
      plane.nx,
      plane.ny,
      plane.nz,
      collision.bounce,
      collision.dampen,
    );
    particle.vx = reflected.vx;
    particle.vy = reflected.vy;
    particle.vz = reflected.vz;
    particle.age += particle.lifetime * collision.lifetimeLoss;
    if (particle.age >= particle.lifetime) particle.alive = false;
  }
}
