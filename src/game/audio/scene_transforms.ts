import type { getActiveShipBody } from "../../player/world_state";
import { getShipRight, worldToShipLocal } from "../../player/ship_interaction";
import { worldToStationLocal } from "../../world/station";
import { dot, normalize } from "../../math/vec3";
import type { Vec3 } from "../../types";
import type { LoopContext } from "../loop_context";

type ShipBody = ReturnType<typeof getActiveShipBody>;

export function sceneVectorFromStation(ctx: LoopContext, vector: Vec3): Vec3 {
  return {
    x: -dot(vector, ctx.stationFrame.right),
    y: dot(vector, ctx.stationFrame.up),
    z: dot(vector, ctx.stationFrame.forward),
  };
}

export function scenePointFromStation(ctx: LoopContext, point: Vec3): Vec3 {
  const local = worldToStationLocal(ctx.stationFrame, point);
  return { x: -local.right, y: local.up, z: local.forward };
}

export function sceneVectorFromShip(vector: Vec3, ship: ShipBody): Vec3 {
  const shipForward = normalize(ship.forward);
  return {
    x: -dot(vector, getShipRight(ship)),
    y: dot(vector, ship.up),
    z: dot(vector, shipForward),
  };
}

export function scenePointFromShip(point: Vec3, ship: ShipBody): Vec3 {
  const local = worldToShipLocal(ship, point);
  return { x: -local.right, y: local.up, z: local.forward };
}
