import { DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD } from "../../physics/colliders";
import type { PrefabEntity } from "../../world/prefabs/schema";
import type { LoopContext } from "../loop_context";

export interface StationAnimations {
  toggleStationAnimation: (id: string) => void;
  updateStationAnimations: (dt: number) => void;
}

/**
 * Owns per-animation blend values seeded from the station prefab's `animation`
 * components, plus the Rapier door-collider enable/disable on threshold cross.
 */
export function createStationAnimations(ctx: LoopContext): StationAnimations {
  // Scan station prefab for animation components.
  if (ctx.stationPrefab) {
    const visit = (entity: PrefabEntity) => {
      for (const comp of entity.components ?? []) {
        if (comp.type === 'animation') {
          const duration = comp.duration ?? 1.0;
          const rate = duration > 0 ? 1 / duration : 1.5;
          const isOpen = comp.defaultOpen ?? false;
          ctx.stationAnimationStates[comp.id] = {
            value: isOpen ? 1 : 0,
            target: isOpen ? 1 : 0,
            rate,
          };
        }
      }
      for (const child of entity.children ?? []) {
        visit(child);
      }
    };
    visit(ctx.stationPrefab.root);
  }

  function toggleStationAnimation(id: string): void {
    const anim = ctx.stationAnimationStates[id];
    if (anim) {
      anim.target = anim.target === 1 ? 0 : 1;
    }
  }

  function updateStationAnimations(dt: number): void {
    let changed = false;
    for (const anim of Object.values(ctx.stationAnimationStates)) {
      if (anim.value !== anim.target) {
        if (anim.value < anim.target) {
          anim.value = Math.min(anim.target, anim.value + anim.rate * dt);
        } else {
          anim.value = Math.max(anim.target, anim.value - anim.rate * dt);
        }
        changed = true;
      }
    }
    if (changed || dt === 0) {
      const blends: Record<string, number> = {};
      for (const [id, anim] of Object.entries(ctx.stationAnimationStates)) {
        blends[id] = anim.value;
      }
      ctx.renderer?.getStationRoot()?.userData.updateAnimations?.(blends);
    }
    // Toggle Rapier colliders on/off as doors cross the open threshold.
    if (ctx.physics) {
      for (const [id, anim] of Object.entries(ctx.stationAnimationStates)) {
        const shouldEnable = anim.value < DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD;
        if (ctx.doorColliderEnabled[id] !== shouldEnable) {
          ctx.doorColliderEnabled[id] = shouldEnable;
          ctx.physics.setDoorColliderEnabled(id, shouldEnable);
        }
      }
    }
  }

  return { toggleStationAnimation, updateStationAnimations };
}
