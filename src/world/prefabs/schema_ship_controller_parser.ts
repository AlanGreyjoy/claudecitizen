import type { PrefabComponent, ShipSeatRole } from "./schema";
import { SHIP_SEAT_ROLES } from "./schema";
import {
  fail,
  isRecord,
  parseAssetUrl,
  parseFiniteNumber,
  parseShipDoorTrigger,
  parseString,
  parseVec2,
  parseVec3,
} from "./schema_parse_common";

function parseShipControllerHingeAxis(
  raw: unknown,
  path: string,
): "x" | "y" | "z" | undefined {
  if (raw === undefined) return undefined;
  if (raw === "x" || raw === "y" || raw === "z") return raw;
  fail(path, 'expected "x", "y", or "z"');
}

function parseShipControllerGearNodes(raw: unknown, path: string) {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(path, "expected non-empty array of gear hinges");
  }
  if (raw.length > 16) fail(path, "too many gear nodes (max 16)");
  return raw.map((node, index) => {
    if (!isRecord(node)) fail(`${path}[${index}]`, "expected {name, deployRadians}");
    const under =
      node.under === undefined
        ? undefined
        : parseString(node.under, `${path}[${index}].under`, 128);
    return {
      name: parseString(node.name, `${path}[${index}].name`, 128),
      ...(under ? { under } : {}),
      deployRadians: Math.min(
        10,
        Math.max(-10, parseFiniteNumber(node.deployRadians, `${path}[${index}].deployRadians`)),
      ),
      axis: parseShipControllerHingeAxis(node.axis, `${path}[${index}].axis`),
    };
  });
}

function parseShipControllerDoorNodes(raw: unknown, path: string) {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(path, "expected non-empty array of {name, delta}");
  }
  if (raw.length > 8) fail(path, "too many door nodes (max 8)");
  return raw.map((node, index) => {
    if (!isRecord(node)) fail(`${path}[${index}]`, "expected {name, delta}");
    const under =
      node.under === undefined
        ? undefined
        : parseString(node.under, `${path}[${index}].under`, 128);
    return {
      name: parseString(node.name, `${path}[${index}].name`, 128),
      delta: Math.min(
        20,
        Math.max(-20, parseFiniteNumber(node.delta, `${path}[${index}].delta`)),
      ),
      ...(under ? { under } : {}),
    };
  });
}

function optionalClamped(
  raw: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined) return undefined;
  return Math.min(max, Math.max(min, parseFiniteNumber(raw, path)));
}


function parseShipControllerDoors(value: Record<string, unknown>, path: string) {
  return value.doors === undefined
            ? undefined
            : (Array.isArray(value.doors) ? value.doors : fail(`${path}.doors`, "expected array")).map(
                (door, index) => {
                  if (!isRecord(door))
                    fail(`${path}.doors[${index}]`, "expected door object");
                  const motion = door.motion;
                  if (motion !== "slide" && motion !== "hinge") {
                    fail(`${path}.doors[${index}].motion`, 'expected "slide" or "hinge"');
                  }
                  const axis = door.axis;
                  if (axis !== "x" && axis !== "y" && axis !== "z") {
                    fail(`${path}.doors[${index}].axis`, 'expected "x", "y", or "z"');
                  }
                  return {
                    id: parseString(door.id, `${path}.doors[${index}].id`, 64),
                    label: parseString(door.label, `${path}.doors[${index}].label`, 64),
                    motion: motion as "slide" | "hinge",
                    axis: axis as "x" | "y" | "z",
                    nodes: parseShipControllerDoorNodes(door.nodes, `${path}.doors[${index}].nodes`),
                    interactEntityId: parseString(
                      door.interactEntityId,
                      `${path}.doors[${index}].interactEntityId`,
                      128,
                    ),
                    trigger: parseShipDoorTrigger(
                      door.trigger,
                      `${path}.doors[${index}].trigger`,
                    ),
                    radius:
                      door.radius === undefined
                        ? undefined
                        : Math.min(
                            20,
                            Math.max(
                              0.5,
                              parseFiniteNumber(
                                door.radius,
                                `${path}.doors[${index}].radius`,
                              ),
                            ),
                          ),
                    aimRadius:
                      door.aimRadius === undefined
                        ? undefined
                        : Math.min(
                            5,
                            Math.max(
                              0.05,
                              parseFiniteNumber(
                                door.aimRadius,
                                `${path}.doors[${index}].aimRadius`,
                              ),
                            ),
                          ),
                    defaultOpen:
                      door.defaultOpen === undefined
                        ? undefined
                        : Boolean(door.defaultOpen),
                    ...(door.openSoundUrl === undefined
                      ? {}
                      : {
                          openSoundUrl: parseAssetUrl(
                            door.openSoundUrl,
                            `${path}.doors[${index}].openSoundUrl`,
                          ),
                        }),
                    ...(door.closeSoundUrl === undefined
                      ? {}
                      : {
                          closeSoundUrl: parseAssetUrl(
                            door.closeSoundUrl,
                            `${path}.doors[${index}].closeSoundUrl`,
                          ),
                        }),
                  };
                },
              );
}

function parseShipControllerSeats(value: Record<string, unknown>, path: string) {
  return value.seats === undefined
            ? undefined
            : (Array.isArray(value.seats) ? value.seats : fail(`${path}.seats`, "expected array")).map(
                (seat, index) => {
                  if (!isRecord(seat))
                    fail(`${path}.seats[${index}]`, "expected seat object");
                  const roleRaw = seat.role;
                  const role =
                    roleRaw === undefined
                      ? undefined
                      : SHIP_SEAT_ROLES.includes(roleRaw as ShipSeatRole)
                        ? (roleRaw as ShipSeatRole)
                        : fail(
                            `${path}.seats[${index}].role`,
                            `expected one of: ${SHIP_SEAT_ROLES.join(", ")}`,
                          );
                  return {
                    role,
                    entityId: parseString(
                      seat.entityId,
                      `${path}.seats[${index}].entityId`,
                      128,
                    ),
                    eye:
                      seat.eye === undefined
                        ? undefined
                        : parseVec3(seat.eye, `${path}.seats[${index}].eye`),
                    stand:
                      seat.stand === undefined
                        ? undefined
                        : parseVec2(seat.stand, `${path}.seats[${index}].stand`),
                    interactRadius:
                      seat.interactRadius === undefined
                        ? undefined
                        : Math.min(
                            10,
                            Math.max(
                              0.5,
                              parseFiniteNumber(
                                seat.interactRadius,
                                `${path}.seats[${index}].interactRadius`,
                              ),
                            ),
                          ),
                  };
                },
              );
}

function parseShipControllerCameraBounds(value: Record<string, unknown>, path: string) {
  return value.cameraBounds === undefined
            ? undefined
            : (Array.isArray(value.cameraBounds)
                ? value.cameraBounds
                : fail(`${path}.cameraBounds`, "expected array")
              ).map((bound, index) => {
                if (!isRecord(bound))
                  fail(`${path}.cameraBounds[${index}]`, "expected bounds object");
                return {
                  id:
                    bound.id === undefined
                      ? undefined
                      : parseString(bound.id, `${path}.cameraBounds[${index}].id`, 64),
                  min: parseVec2(bound.min, `${path}.cameraBounds[${index}].min`),
                  max: parseVec2(bound.max, `${path}.cameraBounds[${index}].max`),
                  floorUp: Math.min(
                    20,
                    Math.max(
                      -20,
                      parseFiniteNumber(
                        bound.floorUp,
                        `${path}.cameraBounds[${index}].floorUp`,
                      ),
                    ),
                  ),
                  slopeMinUp:
                    bound.slopeMinUp === undefined
                      ? undefined
                      : Math.min(
                          20,
                          Math.max(
                            -20,
                            parseFiniteNumber(
                              bound.slopeMinUp,
                              `${path}.cameraBounds[${index}].slopeMinUp`,
                            ),
                          ),
                        ),
                  ceilingUp: Math.min(
                    20,
                    Math.max(
                      -20,
                      parseFiniteNumber(
                        bound.ceilingUp,
                        `${path}.cameraBounds[${index}].ceilingUp`,
                      ),
                    ),
                  ),
                  openToOutside:
                    bound.openToOutside === undefined
                      ? undefined
                      : Boolean(bound.openToOutside),
                };
              });
}

function parseShipControllerRamp(value: Record<string, unknown>, path: string) {
  let ramp:
          | {
              hinge: {
                node: string;
                lowerRadians: number;
                axis?: "x" | "y" | "z";
              };
              outsideInteractId?: string;
              outsideRadius?: number;
              deckInteractId?: string;
              deckRadius?: number;
              openSoundUrl?: string;
              closeSoundUrl?: string;
            }
          | undefined;
        if (value.ramp !== undefined) {
          if (!isRecord(value.ramp)) fail(`${path}.ramp`, "expected ramp object");
          if (!isRecord(value.ramp.hinge))
            fail(`${path}.ramp.hinge`, "expected hinge object");
          ramp = {
            hinge: {
              node: parseString(value.ramp.hinge.node, `${path}.ramp.hinge.node`, 128),
              lowerRadians: Math.min(
                10,
                Math.max(
                  -10,
                  parseFiniteNumber(
                    value.ramp.hinge.lowerRadians,
                    `${path}.ramp.hinge.lowerRadians`,
                  ),
                ),
              ),
              axis: parseShipControllerHingeAxis(value.ramp.hinge.axis, `${path}.ramp.hinge.axis`),
            },
            outsideInteractId:
              value.ramp.outsideInteractId === undefined
                ? undefined
                : parseString(
                    value.ramp.outsideInteractId,
                    `${path}.ramp.outsideInteractId`,
                    128,
                  ),
            outsideRadius:
              value.ramp.outsideRadius === undefined
                ? undefined
                : Math.min(
                    20,
                    Math.max(
                      0.5,
                      parseFiniteNumber(
                        value.ramp.outsideRadius,
                        `${path}.ramp.outsideRadius`,
                      ),
                    ),
                  ),
            deckInteractId:
              value.ramp.deckInteractId === undefined
                ? undefined
                : parseString(
                    value.ramp.deckInteractId,
                    `${path}.ramp.deckInteractId`,
                    128,
                  ),
            deckRadius:
              value.ramp.deckRadius === undefined
                ? undefined
                : Math.min(
                    20,
                    Math.max(
                      0.5,
                      parseFiniteNumber(
                        value.ramp.deckRadius,
                        `${path}.ramp.deckRadius`,
                      ),
                    ),
                  ),
            ...(value.ramp.openSoundUrl === undefined
              ? {}
              : {
                  openSoundUrl: parseAssetUrl(
                    value.ramp.openSoundUrl,
                    `${path}.ramp.openSoundUrl`,
                  ),
                }),
            ...(value.ramp.closeSoundUrl === undefined
              ? {}
              : {
                  closeSoundUrl: parseAssetUrl(
                    value.ramp.closeSoundUrl,
                    `${path}.ramp.closeSoundUrl`,
                  ),
                }),
          };
        }
  return ramp;
}

function parseShipControllerStats(value: Record<string, unknown>, path: string) {
  return {
    maxSpeedMps: optionalClamped(value.maxSpeedMps, `${path}.maxSpeedMps`, 5, 500),
    maxHp: optionalClamped(value.maxHp, `${path}.maxHp`, 1, 100_000),
    maxShields: optionalClamped(value.maxShields, `${path}.maxShields`, 0, 100_000),
    shieldRegenPerSec: optionalClamped(value.shieldRegenPerSec, `${path}.shieldRegenPerSec`, 0, 10_000),
    massKg: optionalClamped(value.massKg, `${path}.massKg`, 100, 50_000_000),
    maxAngularRateRadps: optionalClamped(value.maxAngularRateRadps, `${path}.maxAngularRateRadps`, 0.05, 10),
    forwardThrustN: optionalClamped(value.forwardThrustN, `${path}.forwardThrustN`, 1, 1e12),
    backwardThrustN: optionalClamped(value.backwardThrustN, `${path}.backwardThrustN`, 1, 1e12),
    verticalThrustN: optionalClamped(value.verticalThrustN, `${path}.verticalThrustN`, 1, 1e12),
    lateralThrustN: optionalClamped(value.lateralThrustN, `${path}.lateralThrustN`, 1, 1e12),
    pitchTorqueNm: optionalClamped(value.pitchTorqueNm, `${path}.pitchTorqueNm`, 1, 1e12),
    yawTorqueNm: optionalClamped(value.yawTorqueNm, `${path}.yawTorqueNm`, 1, 1e12),
    rollTorqueNm: optionalClamped(value.rollTorqueNm, `${path}.rollTorqueNm`, 1, 1e12),
    thrustFovForwardDeg: optionalClamped(value.thrustFovForwardDeg, `${path}.thrustFovForwardDeg`, 0, 30),
    thrustFovBackwardDeg: optionalClamped(value.thrustFovBackwardDeg, `${path}.thrustFovBackwardDeg`, 0, 30),
    thrustFovBlendPerSec: optionalClamped(value.thrustFovBlendPerSec, `${path}.thrustFovBlendPerSec`, 0.5, 40),
    boostShakeAmplitudeM: optionalClamped(value.boostShakeAmplitudeM, `${path}.boostShakeAmplitudeM`, 0, 0.2),
    boostShakeHz: optionalClamped(value.boostShakeHz, `${path}.boostShakeHz`, 1, 60),
    boostBlendPerSec: optionalClamped(value.boostBlendPerSec, `${path}.boostBlendPerSec`, 0.5, 40),
    ...(value.boostSoundUrl === undefined
      ? {}
      : { boostSoundUrl: parseAssetUrl(value.boostSoundUrl, `${path}.boostSoundUrl`) }),
    boostSoundVolume: optionalClamped(value.boostSoundVolume, `${path}.boostSoundVolume`, 0, 1),
    ...(value.thrustSoundUrl === undefined
      ? {}
      : { thrustSoundUrl: parseAssetUrl(value.thrustSoundUrl, `${path}.thrustSoundUrl`) }),
    thrustSoundVolume: optionalClamped(value.thrustSoundVolume, `${path}.thrustSoundVolume`, 0, 1),
  };
}

function parseShipControllerGear(value: Record<string, unknown>, path: string) {
  return {
    nodes: parseShipControllerGearNodes(value.nodes, `${path}.nodes`),
    ...(value.deploySoundUrl === undefined
      ? {}
      : { deploySoundUrl: parseAssetUrl(value.deploySoundUrl, `${path}.deploySoundUrl`) }),
    ...(value.retractSoundUrl === undefined
      ? {}
      : { retractSoundUrl: parseAssetUrl(value.retractSoundUrl, `${path}.retractSoundUrl`) }),
  };
}

export function parseShipControllerComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "ship-controller" as const;
  return {
    type,
    restHeight:
      value.restHeight === undefined
        ? undefined
        : Math.min(50, Math.max(0.2, parseFiniteNumber(value.restHeight, `${path}.restHeight`))),
    stats:
      value.stats === undefined || !isRecord(value.stats)
        ? undefined
        : parseShipControllerStats(value.stats, `${path}.stats`),
    gear:
      value.gear === undefined || !isRecord(value.gear)
        ? undefined
        : parseShipControllerGear(value.gear, `${path}.gear`),
    ramp: parseShipControllerRamp(value, path),
    doors: parseShipControllerDoors(value, path),
    seats: parseShipControllerSeats(value, path),
    deckSpawnEntityId:
      value.deckSpawnEntityId === undefined
        ? undefined
        : parseString(value.deckSpawnEntityId, `${path}.deckSpawnEntityId`, 128),
    cameraBounds: parseShipControllerCameraBounds(value, path),
  };
}