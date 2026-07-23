import {
  MODE_IN_STATION,
  MODE_ON_FOOT,
  MODE_ON_SHIP_DECK,
} from "../../player/modes";
import {
  getActiveShipBody,
  getActiveShipRig,
} from "../../player/world_state";
import { listShipInstances } from "../../flight/ship_world";
import { doorBlends } from "../../player/ship_rig";
import type { EntertainmentCameraFeel } from "../../player/entertainment_camera";
import type { LoopContext } from "../loop_context";
import type { CameraState } from "../types";
import type { CameraOcclusion } from "../camera/occlusion";
import { characterVisibleInMode } from "./entertainment_camera_frame";

function isWeaponWalkMode(mode: string): boolean {
  return (
    mode === MODE_ON_FOOT ||
    mode === MODE_ON_SHIP_DECK ||
    mode === MODE_IN_STATION
  );
}

function buildShipRenderList() {
  return listShipInstances().map((instance) => ({
    id: instance.id,
    prefabId: instance.prefabId,
    body: instance.body,
    rig: {
      gear01: instance.rig.gear01,
      ramp01: instance.rig.ramp01,
      doors: doorBlends(instance.rig),
    },
    vitals: { ...instance.vitals },
    spec: {
      maxHp: instance.spec.maxHp,
      maxShields: instance.spec.maxShields,
    },
  }));
}

export function buildRendererFrameArgs(
  ctx: LoopContext,
  deps: {
    occlusion: CameraOcclusion;
    camera: CameraState;
    weaponPoseAiming: boolean;
    entertainmentCameraFeel: EntertainmentCameraFeel | null;
    nowMs: number;
    remoteEntities: NonNullable<
      ReturnType<NonNullable<LoopContext["network"]>["getRemoteEntities"]>
    >;
    stationNpcRenderStates: ReturnType<
      LoopContext["stationNpcPopulation"]["getRenderStates"]
    >;
  },
) {
  const activeShip = getActiveShipBody(ctx.world);
  const activeRig = getActiveShipRig(ctx.world);
  return {
    activeShip,
    args: {
      cameraOrbit: ctx.world.cameraOrbit,
      shipCameraView: ctx.world.shipCameraView,
      shipCameraZoom: ctx.world.shipCameraZoom,
      seatLook: deps.camera.seatLook,
      flightCameraFeel: ctx.flightCameraFeelFrame ?? undefined,
      entertainmentCameraFeel: deps.entertainmentCameraFeel ?? undefined,
      activeBedId: ctx.world.activeBedId,
      character: characterVisibleInMode(ctx.world.mode)
        ? {
            animation: ctx.world.character.animation,
            upperBodyAnimation: ctx.world.character.upperBodyAnimation ?? null,
            forward: ctx.world.character.forward,
            position: ctx.world.character.position,
            up: ctx.world.character.up,
          }
        : null,
      weaponAimActive: deps.weaponPoseAiming && isWeaponWalkMode(ctx.world.mode),
      characterHeadLook: ctx.stationScreenHeadLook,
      mode: ctx.world.mode,
      shipExteriorWalk: ctx.world.shipExteriorWalk,
      prompt: ctx.world.prompt,
      ship: activeShip,
      activeShipId: ctx.world.activeShipId,
      ships: buildShipRenderList(),
      shipRig: {
        gear01: activeRig.gear01,
        ramp01: activeRig.ramp01,
        doors: doorBlends(activeRig),
      },
      networkEntities: deps.remoteEntities,
      stationNpcs: deps.stationNpcRenderStates,
      shipZoneId: ctx.world.character.deckZone ?? null,
      stationRoomId: ctx.world.character.stationRoomId ?? null,
      cameraOcclusion: deps.occlusion.resolveCameraOcclusion,
      timeSeconds: deps.nowMs / 1000,
      flightMode: ctx.world.flightMode,
      quantum: ctx.world.quantum,
    },
  };
}

export { isWeaponWalkMode };
