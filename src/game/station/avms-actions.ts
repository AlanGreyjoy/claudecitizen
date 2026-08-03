import { callShipToHangar } from "../../player/station-interaction";
import {
  getActiveShip,
  PLAYER_SHIP_INSTANCE_ID,
} from "../../player/world-state";
import { getShipInstance } from "../../flight/ship-world";
import {
  resetAssignedHangarBay,
  setAssignedHangarBay,
  type GameBootstrap,
} from "../../net/api";
import {
  getStationHangars,
  type HangarSpec,
  type StationAvmsMarker,
} from "../../world/station";
import {
  getActiveSystemDocument,
  resolveStationFamilyHangarSceneId,
} from "../../world/systems/runtime";
import { loadHangarsFromSceneId } from "../../world/systems/station-source";
import type { LoopContext } from "../loop-context";
import { resolveSceneExitInstanceId } from "./scene-exit";
import type { BuildTool } from "./build-tool";

/** Terminal hangar scene, else System Map family ownership for this station. */
function resolveAvmsHangarSceneId(
  ctx: LoopContext,
  terminal: StationAvmsMarker | null,
): string {
  const fromTerminal = terminal?.hangarSceneId.trim() ?? "";
  if (fromTerminal) return fromTerminal;
  return resolveStationFamilyHangarSceneId(getActiveSystemDocument(), {
    entryId: ctx.activeStationInstanceId,
    sceneId: ctx.sceneId ?? ctx.stationPrefab?.id ?? null,
  });
}

/**
 * Pads for AVMS deliver: family hangar scene first (doc model), else pads on
 * the active layout (legacy co-located station). `parkInWorld` is false when
 * pads live in another scene — hull stays stowed until To Hangar.
 */
export async function resolveDeliverHangars(
  ctx: LoopContext,
  terminal: StationAvmsMarker | null = null,
): Promise<{ hangars: HangarSpec[]; parkInWorld: boolean }> {
  const hangarSceneId = resolveAvmsHangarSceneId(ctx, terminal);
  if (hangarSceneId && ctx.sceneId === hangarSceneId) {
    return { hangars: getStationHangars(), parkInWorld: true };
  }
  if (hangarSceneId) {
    const hangars = await loadHangarsFromSceneId(hangarSceneId);
    if (hangars.length > 0) return { hangars, parkInWorld: false };
  }
  return { hangars: getStationHangars(), parkInWorld: true };
}

function syncBootstrapAssignedHangar(
  ctx: LoopContext,
  assignedHangar: number | null,
): void {
  if (!ctx.bootstrap) return;
  ctx.bootstrap.hangar.assignedHangar = assignedHangar;
}

function shipsForAvms(ctx: LoopContext): GameBootstrap["ships"] {
  if (ctx.bootstrap?.ships.length) return ctx.bootstrap.ships;
  const ship = getActiveShip(ctx.world);
  return [
    {
      id: ship.id,
      shipDefinitionId: null,
      prefabId: ship.prefabId,
      displayName: ship.prefabId,
      hp: ship.vitals.hp,
      shields: ship.vitals.shields,
      maxHp: ship.spec.maxHp,
      maxShields: ship.spec.maxShields,
      shieldRegenPerSec: ship.spec.shieldRegenPerSec,
      maxSpeedMps: ship.spec.maxSpeedMps,
      throttleAccelMps2: ship.spec.throttleAccelMps2,
    },
  ];
}

async function syncHangarAfterAvms(
  buildTool: BuildTool,
  response: Awaited<ReturnType<typeof resetAssignedHangarBay>>,
): Promise<void> {
  const hangarRuntime = buildTool.buildRuntimeForArea("hangar");
  hangarRuntime?.controller.syncBootstrap(response, response.arcBalance);
  if (hangarRuntime) await buildTool.syncBuildPropsVisuals(hangarRuntime);
}

/**
 * Hangar travel goes through `onRequestScene` like any other exit — the panel
 * is a shortcut to an authored destination, not a second way to move a player.
 */
function hangarTravel(
  ctx: LoopContext,
  terminal: StationAvmsMarker | null,
): (() => void) | undefined {
  const sceneId = resolveAvmsHangarSceneId(ctx, terminal);
  if (!sceneId || !ctx.onRequestScene) return undefined;
  const onRequestScene = ctx.onRequestScene;
  const hangarInstanceId = terminal?.hangarInstanceId?.trim() || "@hangar";
  const hangarRoomId = terminal?.hangarRoomId?.trim() || "lobby";
  return () => {
    onRequestScene({
      sceneId,
      instanceId: resolveSceneExitInstanceId(
        hangarInstanceId,
        ctx.bootstrap,
        ctx.systemId,
      ),
      roomId: hangarRoomId,
      arrival: "default",
    });
  };
}

export function openAvmsTerminal(
  ctx: LoopContext,
  buildTool: BuildTool,
  options?: { onClose?: () => void; terminal?: StationAvmsMarker | null },
): void {
  const terminal = options?.terminal ?? null;
  ctx.avmsTerminal?.open({
    ships: shipsForAvms(ctx),
    canStore: ctx.world.assignedHangar !== null,
    onClose: options?.onClose,
    hangarLabel: terminal?.hangarLabel,
    onHangar: hangarTravel(ctx, terminal),
    onStore: async () => {
      const ship = getShipInstance(PLAYER_SHIP_INSTANCE_ID);
      if (ship) {
        ship.instanceId = "stored";
        ship.body.position = { x: 0, y: -100000, z: 0 };
        ship.body.velocity = { x: 0, y: 0, z: 0 };
      }
      ctx.world.assignedHangar = null;
      syncBootstrapAssignedHangar(ctx, null);
      ctx.world.prompt = "Ship stored.";
      if (!ctx.bootstrap) return;
      try {
        const response = await resetAssignedHangarBay();
        await syncHangarAfterAvms(buildTool, response);
      } catch (error) {
        console.warn("Failed to persist hangar store.", error);
      }
    },
    onDeliver: async (ship) => {
      const { hangars, parkInWorld } = await resolveDeliverHangars(ctx, terminal);
      const hangar = await callShipToHangar(ctx.world, ctx.planet, ctx.seed, {
        ownedShip: ship,
        playerId: ctx.bootstrap?.player.id,
        hangarInstanceId: ctx.bootstrap?.spawn.hangarInstanceId,
        hangars,
        parkInWorld,
      });
      if (!hangar) throw new Error("No hangar bays available.");
      syncBootstrapAssignedHangar(ctx, hangar.index);
      ctx.world.prompt = `Ship delivered to Hangar ${hangar.index}`;
      if (!ctx.bootstrap) return;
      getActiveShip(ctx.world).instanceId = ctx.bootstrap.spawn.hangarInstanceId;
      try {
        const response = await setAssignedHangarBay(hangar.index);
        await syncHangarAfterAvms(buildTool, response);
      } catch (error) {
        console.warn("Failed to persist assigned hangar bay.", error);
      }
    },
  });
}
