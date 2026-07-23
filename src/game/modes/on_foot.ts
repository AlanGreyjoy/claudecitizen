import { updateCharacterState } from "../../player/character_controller";
import {
  createPlanetPhysics,
  planetPhysicsColliderRadiusMeters,
} from "../../physics/planet_physics";
import type { WalkModeInput } from "../types";
import type { LoopContext } from "../loop_context";
import type { WeaponCombat } from "../combat/weapon_combat";
import type { PadInterest } from "../station/pad_interest";
import type { ShipSystems } from "../ship/systems";

export interface OnFootMode {
  updateOnFootMode: (input: WalkModeInput, weaponPoseAiming: boolean) => void;
}

/** Planet-surface walking: lazy surface-spawn collider sync + locomotion. */
export function createOnFootMode(
  ctx: LoopContext,
  deps: {
    combat: WeaponCombat;
    padInterest: PadInterest;
    shipSystems: ShipSystems;
  },
): OnFootMode {
  function updateOnFootMode(input: WalkModeInput, weaponPoseAiming: boolean): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    if (!ctx.planetPhysics && ctx.renderer) {
      ctx.planetPhysics = createPlanetPhysics(ctx.world.character.position);
    }
    if (ctx.planetPhysics && ctx.renderer) {
      const radius = planetPhysicsColliderRadiusMeters();
      const catalog = ctx.renderer.getSurfaceSpawnCatalog();
      const entries = catalog.entries;
      ctx.planetPhysics.syncNearby(
        ctx.world.character.position,
        ctx.renderer.getNearbySurfaceSpawns(ctx.world.character.position, radius),
        entries,
        {
          meshByAssetUrl: ctx.renderer.getSurfaceSpawnMeshCollisions(),
        },
      );
    }
    ctx.world.character = updateCharacterState(
      ctx.world.character,
      {
        ...input.characterInput,
        jumpPressed: input.actions.jumpPressed,
      },
      input.dt,
      ctx.planet,
      ctx.seed,
      ctx.planetPhysics,
      deps.combat.currentAnimStance(),
      weaponPoseAiming,
    );
    if (!deps.padInterest.tryEnterShipPadInterest()) {
      ctx.world.prompt = deps.shipSystems.handleRampOutside(input.actions.interactPressed) ?? "";
    }
  }

  return { updateOnFootMode };
}
