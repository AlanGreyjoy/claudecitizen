import { DOOR_OPEN_COLLIDER_DISABLE_THRESHOLD } from "../../physics/colliders";
import type { PrefabEntity } from "../../world/prefabs/schema";
import { getStationLayoutOverride } from "../../world/station";
import type { LoopContext } from "../loop-context";

export interface StationAnimations {
  toggleStationAnimation: (id: string) => void;
  updateStationAnimations: (dt: number) => void;
}

function seedAnimationState(
  ctx: LoopContext,
  id: string,
  duration: number,
  defaultOpen: boolean,
): void {
  if (ctx.stationAnimationStates[id]) return;
  const rate = duration > 0 ? 1 / duration : 1.5;
  const isOpen = defaultOpen;
  ctx.stationAnimationStates[id] = {
    value: isOpen ? 1 : 0,
    target: isOpen ? 1 : 0,
    rate,
  };
}

/**
 * Owns per-animation / door blend values seeded from the station prefab's
 * `animation` and `door` components, plus the Rapier door-collider enable /
 * disable on threshold cross.
 */
export function createStationAnimations(ctx: LoopContext): StationAnimations {
  if (ctx.stationPrefab) {
    const visit = (entity: PrefabEntity) => {
      for (const comp of entity.components ?? []) {
        if (comp.type === "animation") {
          seedAnimationState(
            ctx,
            comp.id,
            comp.duration ?? 1.0,
            comp.defaultOpen ?? false,
          );
        }
        if (comp.type === "door") {
          seedAnimationState(
            ctx,
            comp.id,
            comp.duration ?? 1.0,
            comp.defaultOpen ?? false,
          );
        }
      }
      for (const child of entity.children ?? []) {
        visit(child);
      }
    };
    visit(ctx.stationPrefab.root);
  }

  // Layout bake is authoritative for doors when the prefab scan missed one.
  for (const door of getStationLayoutOverride()?.doors ?? []) {
    seedAnimationState(ctx, door.id, door.duration, door.defaultOpen);
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
