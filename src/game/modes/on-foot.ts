import { updateCharacterState } from "../../player/character-controller";
import {
  createPlanetPhysics,
  planetPhysicsColliderRadiusMeters,
} from "../../physics/planet-physics";
import { distance } from "../../math/vec3";
import type { Vec3 } from "../../types";
import type { WalkModeInput } from "../types";
import type { LoopContext } from "../loop-context";
import type { WeaponCombat } from "../combat/weapon-combat";
import type { PadInterest } from "../station/pad-interest";
import type { ShipSystems } from "../ship/systems";

export interface OnFootMode {
  updateOnFootMode: (input: WalkModeInput, weaponPoseAiming: boolean) => void;
}

/**
 * Player travel that justifies rebuilding the prop collider set.
 *
 * Colliders cover a 36 m radius and the physics origin rebases at 32 m, so a
 * prop crossing into range while the player has moved less than this is still
 * over 30 m away and cannot be touched before the next sync. Re-running the
 * sync every frame is not free: it walks every resident spawn instance,
 * allocates two arrays, and builds a `toFixed`-based string key per nearby
 * instance — hundreds of allocations a frame to usually rediscover the same
 * collider set.
 */
const COLLIDER_RESYNC_METERS = 2;

/** Planet-surface walking: lazy surface-spawn collider sync + locomotion. */
export function createOnFootMode(
  ctx: LoopContext,
  deps: {
    combat: WeaponCombat;
    padInterest: PadInterest;
    shipSystems: ShipSystems;
  },
): OnFootMode {
  let lastSyncPosition: Vec3 | null = null;
  let lastSyncRevision = -1;

  function syncNearbyPropColliders(position: Vec3): void {
    if (!ctx.planetPhysics || !ctx.renderer) return;
    const revision = ctx.renderer.getSurfaceSpawnRevision();
    const moved =
      lastSyncPosition === null ||
      distance(position, lastSyncPosition) >= COLLIDER_RESYNC_METERS;
    if (!moved && revision === lastSyncRevision) return;
    lastSyncPosition = position;
    lastSyncRevision = revision;

    const radius = planetPhysicsColliderRadiusMeters();
    ctx.planetPhysics.syncNearby(
      position,
      ctx.renderer.getNearbySurfaceSpawns(position, radius),
      ctx.renderer.getSurfaceSpawnCatalog().entries,
      { meshByAssetUrl: ctx.renderer.getSurfaceSpawnMeshCollisions() },
    );
  }

  function updateOnFootMode(input: WalkModeInput, weaponPoseAiming: boolean): void {
    ctx.flightCameraFeelFrame = null;
    ctx.boostSfx.stop();
    ctx.thrustSfx.stop();
    if (!ctx.planetPhysics && ctx.renderer) {
      ctx.planetPhysics = createPlanetPhysics(ctx.world.character.position);
      // A fresh physics world has no colliders, so the memo must not be able to
      // decide nothing changed and leave it empty.
      lastSyncPosition = null;
      lastSyncRevision = -1;
    }
    syncNearbyPropColliders(ctx.world.character.position);
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
    if (deps.padInterest.tryEnterShipPadInterest()) return;
    const boardPrompt = deps.shipSystems.handleBoardExterior(
      input.actions.interactPressed,
    );
    ctx.world.prompt =
      boardPrompt ??
      deps.shipSystems.handleRampOutside(input.actions.interactPressed) ??
      "";
  }

  return { updateOnFootMode };
}
