import {
  findSurfaceDestination,
  type SurfaceDestination,
} from "../../world/biome_teleport";
import { cartesianFromLatLonAlt, surfacePointFromPosition } from "../../world/coordinates";
import { warmRenderableHeightRing } from "../../world/spawn_warm";
import { sampleFootPlanetSurface } from "../../world/planet_surface";
import {
  CHARACTER_GROUND_OFFSET_METERS,
  createCharacterState,
} from "../../player/character_controller";
import { initialCameraYaw } from "../../player/spawn";
import { createQuantumTravelState } from "../../flight/quantum_travel";
import { MODE_ON_FOOT } from "../../player/modes";
import type { LoopContext } from "../loop_context";

export function teleportToSurface(
  ctx: LoopContext,
  destination: SurfaceDestination,
): boolean {
  const location = findSurfaceDestination(ctx.planet, ctx.seed, destination);
  if (!location) return false;

  const probe = cartesianFromLatLonAlt(
    location.latRadians,
    location.lonRadians,
    0,
    ctx.planet.radiusMeters,
  );
  if (![probe.x, probe.y, probe.z].every(Number.isFinite)) return false;
  warmRenderableHeightRing(ctx.planet, ctx.seed, probe, 450, 18);
  const surface = sampleFootPlanetSurface(ctx.planet, ctx.seed, probe);
  if (
    !Number.isFinite(surface.surfaceRadiusMeters) ||
    !Number.isFinite(surface.heightMeters)
  ) {
    return false;
  }
  const groundPosition = surfacePointFromPosition(
    probe,
    surface.surfaceRadiusMeters + CHARACTER_GROUND_OFFSET_METERS,
  );
  if (![groundPosition.x, groundPosition.y, groundPosition.z].every(Number.isFinite)) {
    return false;
  }
  const character = createCharacterState(groundPosition);
  ctx.world.character = character;
  ctx.world.mode = MODE_ON_FOOT;
  ctx.world.shipExteriorWalk = false;
  ctx.world.activeBedId = null;
  ctx.world.transition = null;
  ctx.world.stationElevator = null;
  ctx.world.screenFade = 0;
  ctx.world.flightMode = "traverse";
  ctx.world.quantum = createQuantumTravelState();
  ctx.world.cameraOrbit = {
    pitchRadians: -0.12,
    yawRadians: initialCameraYaw(character),
    zoomDistance: 5.2,
  };
  ctx.controls.setMode(MODE_ON_FOOT);
  ctx.controls.setOrbitFacing(
    ctx.world.cameraOrbit.yawRadians,
    ctx.world.cameraOrbit.pitchRadians,
  );
  ctx.planetPhysics?.dispose();
  ctx.planetPhysics = null;
  return true;
}
