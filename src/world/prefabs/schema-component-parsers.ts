import { isWeaponSlotType } from "../../types/equipment";
import type { PrefabComponent, PrefabSoundZone, ShipSeatRole } from "./schema";
import {
  COCKPIT_CONTROL_ACTIONS,
  COCKPIT_STAT_KINDS,
  SHIP_SEAT_ROLES,
} from "./schema";
import {
  assertOnlyFields,
  fail,
  isRecord,
  parseAssetUrl,
  parseColor,
  parseFiniteNumber,
  parseFloorId,
  parseNullableAssetUrl,
  parseShipDoorTrigger,
  parseString,
  parseUnitValue,
  parseVec2,
  parseVec3,
} from "./schema_parse_common";
import { parseParticleSystemComponent } from "./schema_particle_parser";
import { parseShipControllerComponent } from "./schema_ship_controller_parser";

function parseTypeOnlyComponent<T extends PrefabComponent["type"]>(
  type: T,
): PrefabComponent & { type: T } {
  return { type } as PrefabComponent & { type: T };
}

function parseStationFrameComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  void value;
  void path;
  return parseTypeOnlyComponent("station-frame");
}

function parsePropFrameComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  void value;
  void path;
  return parseTypeOnlyComponent("prop-frame");
}

function parseItemFrameComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  void value;
  void path;
  return parseTypeOnlyComponent("item-frame");
}

function parseEquipmentSocketComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "equipment-socket" as const;
  if (!isWeaponSlotType(value.accepts)) {
          fail(`${path}.accepts`, "expected sword, handgun, or rifle");
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          accepts: value.accepts,
        };
}

function parseDrawnGripComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  void value;
  void path;
  return parseTypeOnlyComponent("drawn-grip");
}

function parseMuzzleFlashBarrelEndComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = value.type as "muzzle-flash" | "barrel-end";
  assertOnlyFields(value, path, ["type"]);
        return { type };
}

function parseWeaponCombatComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "weapon-combat" as const;
  assertOnlyFields(value, path, [
          "type",
          "fireSoundUrl",
          "dryFireSoundUrl",
          "reloadSoundUrl",
          "hitDecalUrl",
        ]);
        return {
          type,
          fireSoundUrl: parseNullableAssetUrl(
            value.fireSoundUrl,
            `${path}.fireSoundUrl`,
          ),
          dryFireSoundUrl: parseNullableAssetUrl(
            value.dryFireSoundUrl,
            `${path}.dryFireSoundUrl`,
          ),
          reloadSoundUrl: parseNullableAssetUrl(
            value.reloadSoundUrl,
            `${path}.reloadSoundUrl`,
          ),
          hitDecalUrl: parseNullableAssetUrl(
            value.hitDecalUrl,
            `${path}.hitDecalUrl`,
          ),
        };
}

function parseSpawnPointComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "spawn-point" as const;
  return { type, floorId: parseFloorId(value.floorId, `${path}.floorId`) };
}

function parseNpcSpawnerComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "npc-spawner" as const;
  const minAlive = Math.min(
          32,
          Math.max(0, Math.round(parseFiniteNumber(value.minAlive, `${path}.minAlive`))),
        );
        const maxAlive = Math.min(
          32,
          Math.max(minAlive, Math.round(parseFiniteNumber(value.maxAlive, `${path}.maxAlive`))),
        );
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          populationId: parseString(value.populationId, `${path}.populationId`, 64),
          floorId: parseFloorId(value.floorId, `${path}.floorId`),
          minAlive,
          maxAlive,
          routeGroup: parseString(value.routeGroup, `${path}.routeGroup`, 64),
          radius: Math.min(
            20,
            Math.max(0, parseFiniteNumber(value.radius, `${path}.radius`)),
          ),
        };
}

function parseNpcWaypointComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "npc-waypoint" as const;
  if (!Array.isArray(value.links)) {
          fail(`${path}.links`, "expected array of waypoint ids");
        }
        if (value.links.length > 16) {
          fail(`${path}.links`, "too many waypoint links (max 16)");
        }
        const links = value.links
          .map((link, index) => parseString(link, `${path}.links[${index}]`, 64))
          .filter((link, index, all) => link.length > 0 && all.indexOf(link) === index);
        const waitMinSeconds = Math.min(
          120,
          Math.max(0, parseFiniteNumber(value.waitMinSeconds, `${path}.waitMinSeconds`)),
        );
        const waitMaxSeconds = Math.min(
          120,
          Math.max(
            waitMinSeconds,
            parseFiniteNumber(value.waitMaxSeconds, `${path}.waitMaxSeconds`),
          ),
        );
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          floorId: parseFloorId(value.floorId, `${path}.floorId`),
          routeGroup: parseString(value.routeGroup, `${path}.routeGroup`, 64),
          links,
          waitMinSeconds,
          waitMaxSeconds,
        };
}

function parseNpcPlacementComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "npc-placement" as const;
  const behavior = value.behavior;
        if (behavior !== "stationary" && behavior !== "wander" && behavior !== "patrol") {
          fail(`${path}.behavior`, 'expected "stationary", "wander", or "patrol"');
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          npcDefinitionId: parseString(value.npcDefinitionId, `${path}.npcDefinitionId`, 64),
          ...(value.displayName === undefined
            ? {}
            : { displayName: parseString(value.displayName, `${path}.displayName`, 64) }),
          floorId: parseFloorId(value.floorId, `${path}.floorId`),
          behavior,
          ...(value.routeGroup === undefined
            ? {}
            : { routeGroup: parseString(value.routeGroup, `${path}.routeGroup`, 64) }),
        };
}

function parseElevatorComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "elevator" as const;
  return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          targetFloor: parseFloorId(value.targetFloor, `${path}.targetFloor`),
          floorId: parseFloorId(value.floorId, `${path}.floorId`),
        };
}

function parseHangarPadComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "hangar-pad" as const;
  return {
          type,
          hangarId: parseString(value.hangarId, `${path}.hangarId`, 64),
          padIndex: Math.max(
            1,
            Math.round(parseFiniteNumber(value.padIndex, `${path}.padIndex`)),
          ),
          floorId:
            value.floorId === undefined
              ? "hangar"
              : parseFloorId(value.floorId, `${path}.floorId`),
        };
}

function parseInteractionComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "interaction" as const;
  const interactionType = value.interactionType;
        if (interactionType !== undefined && interactionType !== "info" && interactionType !== "animation") {
          fail(`${path}.interactionType`, 'expected "info" or "animation"');
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          prompt: parseString(value.prompt, `${path}.prompt`, 200),
          radius: Math.min(
            50,
            Math.max(0.5, parseFiniteNumber(value.radius, `${path}.radius`)),
          ),
          floorId: parseFloorId(value.floorId, `${path}.floorId`),
          ...(interactionType !== undefined ? { interactionType } : {}),
          ...(value.targetAnimationId !== undefined
            ? { targetAnimationId: parseString(value.targetAnimationId, `${path}.targetAnimationId`, 64) }
            : {}),
          ...(value.keyLabel !== undefined
            ? { keyLabel: parseString(value.keyLabel, `${path}.keyLabel`, 10) }
            : {}),
          ...(value.proximitySoundUrl !== undefined
            ? { proximitySoundUrl: parseAssetUrl(value.proximitySoundUrl, `${path}.proximitySoundUrl`) }
            : {}),
          ...(value.interactSoundUrl !== undefined
            ? { interactSoundUrl: parseAssetUrl(value.interactSoundUrl, `${path}.interactSoundUrl`) }
            : {}),
        };
}

function parseAnimationComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "animation" as const;
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
          fail(`${path}.nodes`, "expected non-empty array of {name, delta}");
        }
        if (value.nodes.length > 8)
          fail(`${path}.nodes`, "too many animation nodes (max 8)");
        const motion = value.motion;
        if (motion !== "slide" && motion !== "hinge") {
          fail(`${path}.motion`, 'expected "slide" or "hinge"');
        }
        const axis = value.axis;
        if (axis !== "x" && axis !== "y" && axis !== "z") {
          fail(`${path}.axis`, 'expected "x", "y", or "z"');
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          name: parseString(value.name, `${path}.name`, 64),
          motion,
          axis,
          nodes: value.nodes.map((node, index) => {
            if (!isRecord(node))
              fail(`${path}.nodes[${index}]`, "expected {name, delta}");
            return {
              name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
              delta: Math.min(
                20,
                Math.max(
                  -20,
                  parseFiniteNumber(node.delta, `${path}.nodes[${index}].delta`),
                ),
              ),
            };
          }),
          defaultOpen:
            value.defaultOpen === undefined
              ? undefined
              : Boolean(value.defaultOpen),
          duration:
            value.duration === undefined
              ? undefined
              : Math.min(
                  60,
                  Math.max(
                    0.01,
                    parseFiniteNumber(value.duration, `${path}.duration`),
                  ),
                ),
        };
}

function parseObjectAnimationComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "object-animation" as const;
  const mode = value.mode;
        if (mode !== "spin" && mode !== "hover") {
          fail(`${path}.mode`, 'expected "spin" or "hover"');
        }
        const axis = value.axis;
        if (axis !== "x" && axis !== "y" && axis !== "z") {
          fail(`${path}.axis`, 'expected "x", "y", or "z"');
        }
        let nodes: { name: string }[] | undefined;
        if (value.nodes !== undefined) {
          if (!Array.isArray(value.nodes)) {
            fail(`${path}.nodes`, "expected array of {name}");
          }
          if (value.nodes.length > 8) {
            fail(`${path}.nodes`, "too many object-animation nodes (max 8)");
          }
          nodes = value.nodes.map((node, index) => {
            if (!isRecord(node)) {
              fail(`${path}.nodes[${index}]`, "expected {name}");
            }
            return {
              name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
            };
          });
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          mode,
          axis,
          ...(nodes !== undefined ? { nodes } : {}),
          speed:
            value.speed === undefined
              ? undefined
              : Math.min(
                  100,
                  Math.max(0, parseFiniteNumber(value.speed, `${path}.speed`)),
                ),
          amplitude:
            value.amplitude === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0,
                    parseFiniteNumber(value.amplitude, `${path}.amplitude`),
                  ),
                ),
          phase:
            value.phase === undefined
              ? undefined
              : parseFiniteNumber(value.phase, `${path}.phase`),
          reverse:
            value.reverse === undefined ? undefined : Boolean(value.reverse),
        };
}

function parseAvmsTerminalComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "avms-terminal" as const;
  return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          radius: Math.min(
            50,
            Math.max(0.5, parseFiniteNumber(value.radius, `${path}.radius`)),
          ),
          floorId: parseFloorId(value.floorId, `${path}.floorId`),
        };
}

function parseWeaponShopComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "weapon-shop" as const;
  const idsRaw = value.itemDefinitionIds;
        let itemDefinitionIds: string[] | undefined;
        if (idsRaw !== undefined) {
          if (!Array.isArray(idsRaw)) {
            fail(`${path}.itemDefinitionIds`, "expected array of strings");
          }
          itemDefinitionIds = idsRaw
            .map((id, index) =>
              parseString(id, `${path}.itemDefinitionIds[${index}]`, 64),
            )
            .filter((id) => id.length > 0);
          if (itemDefinitionIds.length === 0) itemDefinitionIds = undefined;
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          label:
            value.label === undefined
              ? undefined
              : parseString(value.label, `${path}.label`, 64),
          gazeRadius:
            value.gazeRadius === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                  ),
                ),
          maxDistance:
            value.maxDistance === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                  ),
                ),
          screenWidth:
            value.screenWidth === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.2,
                    parseFiniteNumber(value.screenWidth, `${path}.screenWidth`),
                  ),
                ),
          screenHeight:
            value.screenHeight === undefined
              ? undefined
              : Math.min(
                  1.5,
                  Math.max(
                    0.15,
                    parseFiniteNumber(value.screenHeight, `${path}.screenHeight`),
                  ),
                ),
          itemDefinitionIds,
        };
}

function parseOutfittersComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "outfitters" as const;
  const idsRaw = value.itemDefinitionIds;
        let itemDefinitionIds: string[] | undefined;
        if (idsRaw !== undefined) {
          if (!Array.isArray(idsRaw)) {
            fail(`${path}.itemDefinitionIds`, "expected array of strings");
          }
          itemDefinitionIds = idsRaw
            .map((id, index) =>
              parseString(id, `${path}.itemDefinitionIds[${index}]`, 64),
            )
            .filter((id) => id.length > 0);
          if (itemDefinitionIds.length === 0) itemDefinitionIds = undefined;
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          label:
            value.label === undefined
              ? undefined
              : parseString(value.label, `${path}.label`, 64),
          gazeRadius:
            value.gazeRadius === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                  ),
                ),
          maxDistance:
            value.maxDistance === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                  ),
                ),
          screenWidth:
            value.screenWidth === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.2,
                    parseFiniteNumber(value.screenWidth, `${path}.screenWidth`),
                  ),
                ),
          screenHeight:
            value.screenHeight === undefined
              ? undefined
              : Math.min(
                  1.5,
                  Math.max(
                    0.15,
                    parseFiniteNumber(value.screenHeight, `${path}.screenHeight`),
                  ),
                ),
          itemDefinitionIds,
        };
}

function parseFoodShopDrinksShopCanteenComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = value.type as "food-shop" | "drinks-shop" | "canteen";
  const idsRaw = value.itemDefinitionIds;
        let itemDefinitionIds: string[] | undefined;
        if (idsRaw !== undefined) {
          if (!Array.isArray(idsRaw)) {
            fail(`${path}.itemDefinitionIds`, "expected array of strings");
          }
          itemDefinitionIds = idsRaw
            .map((id, index) =>
              parseString(id, `${path}.itemDefinitionIds[${index}]`, 64),
            )
            .filter((id) => id.length > 0);
          if (itemDefinitionIds.length === 0) itemDefinitionIds = undefined;
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          label:
            value.label === undefined
              ? undefined
              : parseString(value.label, `${path}.label`, 64),
          gazeRadius:
            value.gazeRadius === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                  ),
                ),
          maxDistance:
            value.maxDistance === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                  ),
                ),
          screenWidth:
            value.screenWidth === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.2,
                    parseFiniteNumber(value.screenWidth, `${path}.screenWidth`),
                  ),
                ),
          screenHeight:
            value.screenHeight === undefined
              ? undefined
              : Math.min(
                  1.5,
                  Math.max(
                    0.15,
                    parseFiniteNumber(value.screenHeight, `${path}.screenHeight`),
                  ),
                ),
          itemDefinitionIds,
        };
}

function parsePointLightComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "point-light" as const;
  return {
          type,
          color:
            value.color === undefined
              ? undefined
              : parseColor(value.color, `${path}.color`),
          intensity: Math.min(
            5_000,
            Math.max(0, parseFiniteNumber(value.intensity, `${path}.intensity`)),
          ),
          distance: Math.min(
            500,
            Math.max(0, parseFiniteNumber(value.distance, `${path}.distance`)),
          ),
          decay:
            value.decay === undefined
              ? undefined
              : Math.min(
                  4,
                  Math.max(0, parseFiniteNumber(value.decay, `${path}.decay`)),
                ),
          castShadow:
            value.castShadow === undefined ? undefined : Boolean(value.castShadow),
        };
}

function parseAreaLightComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "area-light" as const;
  return {
          type,
          color:
            value.color === undefined
              ? undefined
              : parseColor(value.color, `${path}.color`),
          intensity: Math.min(
            500,
            Math.max(0, parseFiniteNumber(value.intensity, `${path}.intensity`)),
          ),
          width: Math.min(
            100,
            Math.max(0.05, parseFiniteNumber(value.width, `${path}.width`)),
          ),
          height: Math.min(
            100,
            Math.max(0.05, parseFiniteNumber(value.height, `${path}.height`)),
          ),
        };
}

function parseSpotLightComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "spot-light" as const;
  return {
          type,
          color:
            value.color === undefined
              ? undefined
              : parseColor(value.color, `${path}.color`),
          intensity: Math.min(
            5_000,
            Math.max(0, parseFiniteNumber(value.intensity, `${path}.intensity`)),
          ),
          distance: Math.min(
            500,
            Math.max(0, parseFiniteNumber(value.distance, `${path}.distance`)),
          ),
          decay:
            value.decay === undefined
              ? undefined
              : Math.min(
                  4,
                  Math.max(0, parseFiniteNumber(value.decay, `${path}.decay`)),
                ),
          angle:
            value.angle === undefined
              ? undefined
              : Math.min(
                  90,
                  Math.max(0, parseFiniteNumber(value.angle, `${path}.angle`)),
                ),
          penumbra:
            value.penumbra === undefined
              ? undefined
              : Math.min(
                  1,
                  Math.max(0, parseFiniteNumber(value.penumbra, `${path}.penumbra`)),
                ),
          castShadow:
            value.castShadow === undefined ? undefined : Boolean(value.castShadow),
        };
}

function parseSoundComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "sound" as const;
  const mode = value.mode;
        if (mode !== "ambient" && mode !== "spatial") {
          fail(`${path}.mode`, 'expected "ambient" or "spatial"');
        }
        const playback = value.playback;
        if (playback !== "loop" && playback !== "enter") {
          fail(`${path}.playback`, 'expected "loop" or "enter"');
        }
        if (!isRecord(value.zone)) fail(`${path}.zone`, "expected zone object");
        const shape = value.zone.shape;
        const zone: PrefabSoundZone =
          shape === "sphere"
            ? {
                shape,
                radius: Math.min(
                  500,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.zone.radius, `${path}.zone.radius`),
                  ),
                ),
              }
            : shape === "box"
              ? {
                  shape,
                  size: (() => {
                    const size = parseVec3(value.zone.size, `${path}.zone.size`);
                    return {
                      x: Math.min(1_000, Math.max(0.05, size.x)),
                      y: Math.min(1_000, Math.max(0.05, size.y)),
                      z: Math.min(1_000, Math.max(0.05, size.z)),
                    };
                  })(),
                }
              : fail(`${path}.zone.shape`, 'expected "sphere" or "box"');
        const maxBlend =
          zone.shape === "sphere"
            ? zone.radius
            : Math.min(zone.size.x, zone.size.y, zone.size.z) / 2;
        return {
          type,
          soundUrl:
            value.soundUrl === undefined
              ? undefined
              : parseAssetUrl(value.soundUrl, `${path}.soundUrl`),
          mode,
          playback,
          volume: parseUnitValue(value.volume, `${path}.volume`),
          blendDistance: Math.min(
            maxBlend,
            Math.max(
              0,
              parseFiniteNumber(value.blendDistance, `${path}.blendDistance`),
            ),
          ),
          zone,
        };
}

function parseColliderComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "collider" as const;
  const shape = value.shape === "mesh" ? "mesh" : "box";
        const offset =
          value.offset === undefined
            ? undefined
            : parseVec3(value.offset, `${path}.offset`);
        const node =
          value.node === undefined
            ? undefined
            : parseString(value.node, `${path}.node`, 128);
        if (shape === "mesh") {
          return {
            type,
            shape,
            assetUrl:
              value.assetUrl === undefined
                ? undefined
                : parseAssetUrl(value.assetUrl, `${path}.assetUrl`),
            convex: value.convex === undefined ? undefined : Boolean(value.convex),
            offset,
            node,
          };
        }
        return {
          type,
          shape,
          size: parseVec3(value.size, `${path}.size`),
          offset,
          node,
        };
}

function parseShipFrameComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  void value;
  void path;
  return parseTypeOnlyComponent("ship-frame");
}

function parseShipStatsComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "ship-stats" as const;
  return {
          type,
          maxSpeedMps:
            value.maxSpeedMps === undefined
              ? undefined
              : Math.min(
                  500,
                  Math.max(
                    5,
                    parseFiniteNumber(value.maxSpeedMps, `${path}.maxSpeedMps`),
                  ),
                ),
          maxHp:
            value.maxHp === undefined
              ? undefined
              : Math.min(
                  100_000,
                  Math.max(1, parseFiniteNumber(value.maxHp, `${path}.maxHp`)),
                ),
          maxShields:
            value.maxShields === undefined
              ? undefined
              : Math.min(
                  100_000,
                  Math.max(
                    0,
                    parseFiniteNumber(value.maxShields, `${path}.maxShields`),
                  ),
                ),
          shieldRegenPerSec:
            value.shieldRegenPerSec === undefined
              ? undefined
              : Math.min(
                  10_000,
                  Math.max(
                    0,
                    parseFiniteNumber(
                      value.shieldRegenPerSec,
                      `${path}.shieldRegenPerSec`,
                    ),
                  ),
                ),
        };
}

function parseShipGearComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "ship-gear" as const;
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
          fail(`${path}.nodes`, "expected non-empty array of gear hinges");
        }
        if (value.nodes.length > 16)
          fail(`${path}.nodes`, "too many gear nodes (max 16)");
        return {
          type,
          nodes: value.nodes.map((node, index) => {
            if (!isRecord(node))
              fail(`${path}.nodes[${index}]`, "expected {name, deployRadians}");
            const axisRaw = node.axis;
            const axis =
              axisRaw === undefined
                ? undefined
                : axisRaw === "x" || axisRaw === "y" || axisRaw === "z"
                  ? axisRaw
                  : fail(`${path}.nodes[${index}].axis`, 'expected "x", "y", or "z"');
            const under =
              node.under === undefined
                ? undefined
                : parseString(node.under, `${path}.nodes[${index}].under`, 128);
            return {
              name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
              ...(under ? { under } : {}),
              deployRadians: Math.min(
                10,
                Math.max(
                  -10,
                  parseFiniteNumber(
                    node.deployRadians,
                    `${path}.nodes[${index}].deployRadians`,
                  ),
                ),
              ),
              axis,
            };
          }),
        };
}

function parseShipRampComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "ship-ramp" as const;
  const axisRaw = value.axis;
        const axis =
          axisRaw === undefined
            ? undefined
            : axisRaw === "x" || axisRaw === "y" || axisRaw === "z"
              ? axisRaw
              : fail(`${path}.axis`, 'expected "x", "y", or "z"');
        return {
          type,
          node: parseString(value.node, `${path}.node`, 128),
          lowerRadians: Math.min(
            10,
            Math.max(
              -10,
              parseFiniteNumber(value.lowerRadians, `${path}.lowerRadians`),
            ),
          ),
          axis,
        };
}

function parseShipHullComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "ship-hull" as const;
  return {
          type,
          restHeight:
            value.restHeight === undefined
              ? undefined
              : Math.min(
                  50,
                  Math.max(
                    0.2,
                    parseFiniteNumber(value.restHeight, `${path}.restHeight`),
                  ),
                ),
        };
}

function parseShipDoorComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "ship-door" as const;
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
          fail(`${path}.nodes`, "expected non-empty array of {name, delta}");
        }
        if (value.nodes.length > 8)
          fail(`${path}.nodes`, "too many door nodes (max 8)");
        const motion = value.motion;
        if (motion !== "slide" && motion !== "hinge") {
          fail(`${path}.motion`, 'expected "slide" or "hinge"');
        }
        const axis = value.axis;
        if (axis !== "x" && axis !== "y" && axis !== "z") {
          fail(`${path}.axis`, 'expected "x", "y", or "z"');
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          label: parseString(value.label, `${path}.label`, 64),
          motion,
          axis,
          nodes: value.nodes.map((node, index) => {
            if (!isRecord(node))
              fail(`${path}.nodes[${index}]`, "expected {name, delta}");
            const under =
              node.under === undefined
                ? undefined
                : parseString(node.under, `${path}.nodes[${index}].under`, 128);
            return {
              name: parseString(node.name, `${path}.nodes[${index}].name`, 128),
              delta: Math.min(
                20,
                Math.max(
                  -20,
                  parseFiniteNumber(node.delta, `${path}.nodes[${index}].delta`),
                ),
              ),
              ...(under ? { under } : {}),
            };
          }),
          trigger: parseShipDoorTrigger(value.trigger, `${path}.trigger`),
          radius:
            value.radius === undefined
              ? undefined
              : Math.min(
                  20,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.radius, `${path}.radius`),
                  ),
                ),
          aimRadius:
            value.aimRadius === undefined
              ? undefined
              : Math.min(
                  5,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.aimRadius, `${path}.aimRadius`),
                  ),
                ),
          defaultOpen:
            value.defaultOpen === undefined
              ? undefined
              : Boolean(value.defaultOpen),
          ...(value.openSoundUrl === undefined
            ? {}
            : {
                openSoundUrl: parseAssetUrl(
                  value.openSoundUrl,
                  `${path}.openSoundUrl`,
                ),
              }),
          ...(value.closeSoundUrl === undefined
            ? {}
            : {
                closeSoundUrl: parseAssetUrl(
                  value.closeSoundUrl,
                  `${path}.closeSoundUrl`,
                ),
              }),
        };
}

function parsePilotSeatComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "pilot-seat" as const;
  const roleRaw = value.role;
        const role =
          roleRaw === undefined
            ? undefined
            : SHIP_SEAT_ROLES.includes(roleRaw as ShipSeatRole)
              ? (roleRaw as ShipSeatRole)
              : fail(
                  `${path}.role`,
                  `expected one of: ${SHIP_SEAT_ROLES.join(", ")}`,
                );
        return {
          type,
          role,
          eye:
            value.eye === undefined
              ? undefined
              : parseVec3(value.eye, `${path}.eye`),
          stand:
            value.stand === undefined
              ? undefined
              : parseVec2(value.stand, `${path}.stand`),
          interactRadius:
            value.interactRadius === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0.5,
                    parseFiniteNumber(
                      value.interactRadius,
                      `${path}.interactRadius`,
                    ),
                  ),
                ),
        };
}

function parseBedComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "bed" as const;
  return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          label:
            value.label === undefined
              ? undefined
              : parseString(value.label, `${path}.label`, 64),
          trigger: parseShipDoorTrigger(value.trigger, `${path}.trigger`),
          radius:
            value.radius === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(0.5, parseFiniteNumber(value.radius, `${path}.radius`)),
                ),
          aimRadius:
            value.aimRadius === undefined
              ? undefined
              : Math.min(
                  5,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.aimRadius, `${path}.aimRadius`),
                  ),
                ),
          eye:
            value.eye === undefined
              ? undefined
              : parseVec3(value.eye, `${path}.eye`),
          stand:
            value.stand === undefined
              ? undefined
              : parseVec2(value.stand, `${path}.stand`),
        };
}

function parseRampInteractComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "ramp-interact" as const;
  const placement = value.placement;
        if (placement !== "outside" && placement !== "deck") {
          fail(`${path}.placement`, 'expected "outside" or "deck"');
        }
        return {
          type,
          placement,
          radius:
            value.radius === undefined
              ? undefined
              : Math.min(
                  20,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.radius, `${path}.radius`),
                  ),
                ),
        };
}

function parseCockpitControlComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "cockpit-control" as const;
  const actionRaw = value.action;
        if (
          actionRaw !== "landing-gear" &&
          actionRaw !== "cargo-ramp"
        ) {
          fail(
            `${path}.action`,
            `expected one of: ${COCKPIT_CONTROL_ACTIONS.join(", ")}`,
          );
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          action: actionRaw,
          label:
            value.label === undefined
              ? undefined
              : parseString(value.label, `${path}.label`, 64),
          gazeRadius:
            value.gazeRadius === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                  ),
                ),
          maxDistance:
            value.maxDistance === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                  ),
                ),
        };
}

function parseCockpitStatComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "cockpit-stat" as const;
  const kindRaw = value.kind;
        if (kindRaw !== "speed") {
          fail(
            `${path}.kind`,
            `expected one of: ${COCKPIT_STAT_KINDS.join(", ")}`,
          );
        }
        return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          kind: kindRaw,
          label:
            value.label === undefined
              ? undefined
              : parseString(value.label, `${path}.label`, 64),
          maxDistance:
            value.maxDistance === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                  ),
                ),
        };
}

function parseEntertainmentSystemComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const type = "entertainment-system" as const;
  return {
          type,
          id: parseString(value.id, `${path}.id`, 64),
          label:
            value.label === undefined
              ? undefined
              : parseString(value.label, `${path}.label`, 64),
          gazeRadius:
            value.gazeRadius === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.05,
                    parseFiniteNumber(value.gazeRadius, `${path}.gazeRadius`),
                  ),
                ),
          maxDistance:
            value.maxDistance === undefined
              ? undefined
              : Math.min(
                  10,
                  Math.max(
                    0.5,
                    parseFiniteNumber(value.maxDistance, `${path}.maxDistance`),
                  ),
                ),
          screenWidth:
            value.screenWidth === undefined
              ? undefined
              : Math.min(
                  2,
                  Math.max(
                    0.2,
                    parseFiniteNumber(value.screenWidth, `${path}.screenWidth`),
                  ),
                ),
          screenHeight:
            value.screenHeight === undefined
              ? undefined
              : Math.min(
                  1.5,
                  Math.max(
                    0.15,
                    parseFiniteNumber(value.screenHeight, `${path}.screenHeight`),
                  ),
                ),
        };
}

function parseGameManagerComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  return {
    type: "game-manager",
    systemId: parseString(value.systemId ?? "default", `${path}.systemId`, 64),
    planetId: parseString(value.planetId ?? "asteron", `${path}.planetId`, 64),
    spawn: value.spawn === "surface" ? "surface" : "station",
  };
}

function parsePlanetComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  return {
    type: "planet",
    planetId: parseString(value.planetId ?? "asteron", `${path}.planetId`, 64),
  };
}

function parsePlayerStartComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  void path;
  return {
    type: "player-start",
    spawn: value.spawn === "surface" ? "surface" : "station",
  };
}

function parsePrefabInstanceComponent(
  value: Record<string, unknown>,
  path: string,
): PrefabComponent {
  const kind = value.prefabKind;
  const prefabKind =
    kind === "station"
    || kind === "ship"
    || kind === "site"
    || kind === "prop"
    || kind === "item"
      ? kind
      : undefined;
  return {
    type: "prefab-instance",
    prefabId: parseString(value.prefabId, `${path}.prefabId`, 64),
    ...(prefabKind ? { prefabKind } : {}),
  };
}

export const COMPONENT_PARSER_BY_TYPE: Record<
  string,
  (value: Record<string, unknown>, path: string) => PrefabComponent
> = {
  "station-frame": parseStationFrameComponent,
  "prop-frame": parsePropFrameComponent,
  "item-frame": parseItemFrameComponent,
  "equipment-socket": parseEquipmentSocketComponent,
  "drawn-grip": parseDrawnGripComponent,
  "muzzle-flash": parseMuzzleFlashBarrelEndComponent,
  "barrel-end": parseMuzzleFlashBarrelEndComponent,
  "weapon-combat": parseWeaponCombatComponent,
  "spawn-point": parseSpawnPointComponent,
  "npc-spawner": parseNpcSpawnerComponent,
  "npc-waypoint": parseNpcWaypointComponent,
  "npc-placement": parseNpcPlacementComponent,
  "elevator": parseElevatorComponent,
  "hangar-pad": parseHangarPadComponent,
  "interaction": parseInteractionComponent,
  "animation": parseAnimationComponent,
  "object-animation": parseObjectAnimationComponent,
  "avms-terminal": parseAvmsTerminalComponent,
  "weapon-shop": parseWeaponShopComponent,
  "outfitters": parseOutfittersComponent,
  "food-shop": parseFoodShopDrinksShopCanteenComponent,
  "drinks-shop": parseFoodShopDrinksShopCanteenComponent,
  "canteen": parseFoodShopDrinksShopCanteenComponent,
  "point-light": parsePointLightComponent,
  "area-light": parseAreaLightComponent,
  "spot-light": parseSpotLightComponent,
  "sound": parseSoundComponent,
  "particle-system": parseParticleSystemComponent,
  "collider": parseColliderComponent,
  "ship-frame": parseShipFrameComponent,
  "ship-controller": parseShipControllerComponent,
  "ship-stats": parseShipStatsComponent,
  "ship-gear": parseShipGearComponent,
  "ship-ramp": parseShipRampComponent,
  "ship-hull": parseShipHullComponent,
  "ship-door": parseShipDoorComponent,
  "pilot-seat": parsePilotSeatComponent,
  "bed": parseBedComponent,
  "ramp-interact": parseRampInteractComponent,
  "cockpit-control": parseCockpitControlComponent,
  "cockpit-stat": parseCockpitStatComponent,
  "entertainment-system": parseEntertainmentSystemComponent,
  "game-manager": parseGameManagerComponent,
  "planet": parsePlanetComponent,
  "player-start": parsePlayerStartComponent,
  "prefab-instance": parsePrefabInstanceComponent,
};

export function parseUnknownComponent(type: unknown, path: string): null {
  console.warn(
    `Prefab component of unknown type "${String(type)}" at ${path} was ignored.`,
  );
  return null;
}
