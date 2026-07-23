import {
  MODE_IN_BED,
  MODE_IN_SHIP,
  MODE_IN_STATION,
} from "../../player/modes";
import { getShipLayout } from "../../player/ship_layout";
import {
  getBedEyeLocal,
  localOffsetToWorld,
} from "../../player/ship_interaction";
import { resolveAimForward, resolveSeatLookForward } from "../../flight/flight_aim";
import {
  entertainmentSystemLabel,
  resolveEntertainmentGazeTarget,
} from "../../player/entertainment_gaze";
import {
  cockpitControlLabel,
  projectWorldPointToScreenOffset,
  resolveCockpitGazeTarget,
} from "../../player/cockpit_gaze";
import { resolveVisibleCockpitSpeedInstruments } from "../../player/cockpit_stats";
import { getStationLayoutOverride } from "../../world/station";
import {
  resolveStationWalkView,
  resolveWeaponShopGazeTarget,
  stationWalkAimOriginWorld,
  weaponShopLabel,
} from "../../player/weapon_shop_gaze";
import { outfittersLabel, resolveOutfittersGazeTarget } from "../../player/outfitters_gaze";
import { foodShopLabel, resolveFoodShopGazeTarget } from "../../player/food_shop_gaze";
import { projectDirectionToReticleOffset } from "../../render/effects/hud/flight_reticle";
import { resolveBoostMaxSpeedMps } from "../../flight/flight_config";
import { type getActiveShipBody, getActiveShipRig } from "../../player/world_state";
import { cross, length, normalize } from "../../math/vec3";
import type { HudUpdateParams } from "../../render/effects";
import type { CameraState } from "../types";
import type { LoopContext } from "../loop_context";

type ShipBody = ReturnType<typeof getActiveShipBody>;

export interface FrameHud {
  flightDual: HudUpdateParams["flightDual"];
  cockpitGaze: HudUpdateParams["cockpitGaze"];
  cockpitSpeed: HudUpdateParams["cockpitSpeed"];
}

function bedCockpitGaze(
  ctx: LoopContext,
  activeShip: ShipBody,
): HudUpdateParams["cockpitGaze"] {
  const layout = getShipLayout();
  const eyeLocal = getBedEyeLocal(ctx.world.activeBedId) ?? layout.pilotEye;
  const eye = localOffsetToWorld(activeShip, eyeLocal);
  const seat = ctx.controls.getSeatLook();
  const view = resolveSeatLookForward(
    activeShip.forward,
    activeShip.up,
    seat.yawRadians,
    seat.pitchRadians,
  );
  const hit = resolveEntertainmentGazeTarget(
    layout.entertainmentSystems,
    activeShip,
    eye,
    view.forward,
  );
  if (!hit) return undefined;
  const fovY = (60 * Math.PI) / 180;
  const viewportH = window.innerHeight;
  const offset = projectWorldPointToScreenOffset(
    hit.worldPosition,
    eye,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  if (offset.behind) return undefined;
  return {
    visible: true,
    label: entertainmentSystemLabel(hit.system),
    offsetPx: { x: offset.x, y: offset.y },
  };
}

function stationCockpitGaze(ctx: LoopContext): HudUpdateParams["cockpitGaze"] {
  const shops = getStationLayoutOverride()?.weaponShops ?? [];
  const outfittersShops = getStationLayoutOverride()?.outfitters ?? [];
  const foodShops = getStationLayoutOverride()?.foodShops ?? [];
  const walkView = resolveStationWalkView(
    ctx.stationFrame.forward,
    ctx.stationFrame.up,
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
  );
  const eye = stationWalkAimOriginWorld(
    ctx.world.character.position,
    ctx.stationFrame.up,
    walkView.forward,
  );
  const hit = resolveWeaponShopGazeTarget(shops, ctx.stationFrame, eye, walkView.forward);
  const outfittersHit = resolveOutfittersGazeTarget(
    outfittersShops,
    ctx.stationFrame,
    eye,
    walkView.forward,
  );
  const foodShopHit = resolveFoodShopGazeTarget(
    foodShops,
    ctx.stationFrame,
    eye,
    walkView.forward,
  );
  const gazeHit = hit
    ? { worldPosition: hit.worldPosition, label: weaponShopLabel(hit.shop) }
    : outfittersHit
      ? {
          worldPosition: outfittersHit.worldPosition,
          label: outfittersLabel(outfittersHit.shop),
        }
      : foodShopHit
        ? {
            worldPosition: foodShopHit.worldPosition,
            label: foodShopLabel(foodShopHit.shop),
          }
        : null;
  if (!gazeHit) return undefined;
  const fovY = (60 * Math.PI) / 180;
  const viewportH = window.innerHeight;
  const offset = projectWorldPointToScreenOffset(
    gazeHit.worldPosition,
    eye,
    walkView.forward,
    walkView.right,
    walkView.up,
    fovY,
    viewportH,
  );
  if (offset.behind) return undefined;
  return {
    visible: true,
    label: gazeHit.label,
    offsetPx: { x: offset.x, y: offset.y },
  };
}

function shipHud(
  ctx: LoopContext,
  camera: CameraState,
  activeShip: ShipBody,
): FrameHud {
  const aim = ctx.controls.getFlightAim();
  const aimDir = resolveAimForward(activeShip, aim);
  // Project vs actual view: during Hold-F free look the reticle stays
  // world-locked on ship aim/nose (moves on screen as you look around).
  const seat = camera.seatLook;
  const seatLooking = ctx.controls.isSeatLookActive();
  const freeLooking =
    seatLooking ||
    (seat &&
      (Math.abs(seat.yawRadians) > 1e-6 ||
        Math.abs(seat.pitchRadians) > 1e-6));
  const view = freeLooking
    ? resolveSeatLookForward(
        activeShip.forward,
        activeShip.up,
        seat.yawRadians,
        seat.pitchRadians,
      )
    : {
        forward: activeShip.forward,
        up: activeShip.up,
        right: normalize(cross(activeShip.forward, activeShip.up)),
      };
  const fovY =
    ((72 + (ctx.flightCameraFeelFrame?.fovDeltaDeg ?? 0)) * Math.PI) / 180;
  const viewportH = window.innerHeight;
  const aimOff = projectDirectionToReticleOffset(
    aimDir,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  const noseOff = projectDirectionToReticleOffset(
    activeShip.forward,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  const flightDual: HudUpdateParams["flightDual"] = {
    aimOffsetPx: { x: aimOff.x, y: aimOff.y },
    noseOffsetPx: { x: noseOff.x, y: noseOff.y },
    coupled: ctx.controls.isCoupledMode(),
  };

  let cockpitGaze: HudUpdateParams["cockpitGaze"];
  let cockpitSpeed: HudUpdateParams["cockpitSpeed"];

  const layout = getShipLayout();
  const eye = localOffsetToWorld(activeShip, layout.pilotEye);
  const boost01 = ctx.flightCameraFeelFrame?.boost01 ?? 0;
  const scmMax = layout.spec.maxSpeedMps;
  const boostMax = resolveBoostMaxSpeedMps(scmMax);
  const speedViews = resolveVisibleCockpitSpeedInstruments(
    layout.cockpitStats,
    activeShip,
    eye,
    view.forward,
    view.right,
    view.up,
    fovY,
    viewportH,
  );
  if (speedViews.length > 0) {
    const speedMps = length(activeShip.velocity);
    cockpitSpeed = {
      visible: true,
      instruments: speedViews.map((viewStat) => ({
        id: viewStat.id,
        offsetPx: viewStat.offsetPx,
        speedMps,
        scmMaxMps: scmMax,
        boostMaxMps: boostMax,
        boosting: boost01 > 0.05,
        boost01,
        ...(viewStat.label ? { label: viewStat.label } : {}),
      })),
    };
  }

  if (seatLooking) {
    const hit = resolveCockpitGazeTarget(
      layout.cockpitControls,
      activeShip,
      eye,
      view.forward,
    );
    if (hit) {
      const offset = projectWorldPointToScreenOffset(
        hit.worldPosition,
        eye,
        view.forward,
        view.right,
        view.up,
        fovY,
        viewportH,
      );
      if (!offset.behind) {
        const rig = getActiveShipRig(ctx.world);
        cockpitGaze = {
          visible: true,
          label: cockpitControlLabel(
            hit.control.action,
            { gearDown: rig.gearDown, rampDown: rig.rampDown },
            hit.control.label,
          ),
          offsetPx: { x: offset.x, y: offset.y },
        };
      }
    }
  }

  return { flightDual, cockpitGaze, cockpitSpeed };
}

/** Builds the per-frame flight reticle / cockpit gaze / cockpit speed HUD state. */
export function buildFrameHud(
  ctx: LoopContext,
  deps: { camera: CameraState; activeShip: ShipBody },
): FrameHud {
  const { camera, activeShip } = deps;
  let flightDual: HudUpdateParams["flightDual"];
  let cockpitGaze: HudUpdateParams["cockpitGaze"];
  let cockpitSpeed: HudUpdateParams["cockpitSpeed"];

  if (ctx.world.mode === MODE_IN_BED && !ctx.entertainmentSystem?.isOpen()) {
    cockpitGaze = bedCockpitGaze(ctx, activeShip);
  }

  if (
    ctx.world.mode === MODE_IN_STATION &&
    !ctx.weaponShop?.isOpen() &&
    !ctx.outfitters?.isOpen() &&
    !ctx.foodShop?.isOpen()
  ) {
    cockpitGaze = stationCockpitGaze(ctx);
  }

  if (ctx.world.mode === MODE_IN_SHIP) {
    const ship = shipHud(ctx, camera, activeShip);
    flightDual = ship.flightDual;
    cockpitGaze = ship.cockpitGaze;
    cockpitSpeed = ship.cockpitSpeed;
  }

  return { flightDual, cockpitGaze, cockpitSpeed };
}
