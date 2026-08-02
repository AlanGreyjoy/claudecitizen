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
import type { StationAvmsMarker } from "../../world/station";
import type { LoopContext } from "../loop-context";
import { resolveSceneExitInstanceId } from "./scene-exit";
import type { BuildTool } from "./build-tool";

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
  const sceneId = terminal?.hangarSceneId.trim();
  if (!terminal || !sceneId || !ctx.onRequestScene) return undefined;
  const onRequestScene = ctx.onRequestScene;
  return () => {
    onRequestScene({
      sceneId,
      instanceId: resolveSceneExitInstanceId(
        terminal.hangarInstanceId,
        ctx.bootstrap,
        ctx.systemId,
      ),
      roomId: terminal.hangarRoomId,
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
      const hangar = await callShipToHangar(ctx.world, ctx.planet, ctx.seed, {
        ownedShip: ship,
        playerId: ctx.bootstrap?.player.id,
        hangarInstanceId: ctx.bootstrap?.spawn.hangarInstanceId,
      });
      if (!hangar) throw new Error("No hangar bays available.");
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
