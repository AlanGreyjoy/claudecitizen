export const DEFAULT_SHIP_TUNING = {
  maxHp: 1000,
  maxShields: 500,
  shieldRegenPerSec: 25,
  maxSpeedMps: 100,
  throttleAccelMps2: 308,
} as const;

export interface StarterLoadoutShipDefinition {
  id: string;
  name: string;
  prefabId: string;
  maxHp: number;
  maxShields: number;
}

export interface StarterLoadoutExistingShip {
  shipDefinitionId: string | null;
  prefabId: string;
}

export interface StarterLoadoutSettings {
  startingArcBalance: number;
  starterShipDefinitionIds: string[];
}

export interface StarterLoadoutPlan {
  arcToGrant: number;
  shouldGrant: boolean;
  shipsToCreate: Array<{
    shipDefinitionId: string;
    prefabId: string;
    displayName: string;
    hp: number;
    shields: number;
    maxHp: number;
    maxShields: number;
  }>;
}

export interface ShipStatsSource {
  id: string;
  name: string;
  prefabId: string;
  maxHp: number;
  maxShields: number;
  shieldRegenPerSec: number;
  maxSpeedMps: number;
  throttleAccelMps2: number;
}

export interface HydratedOwnedShip {
  shipDefinitionId: string | null;
  prefabId: string;
  displayName: string;
  hp: number;
  shields: number;
  maxHp: number;
  maxShields: number;
  shieldRegenPerSec: number;
  maxSpeedMps: number;
  throttleAccelMps2: number;
}

export function computeStarterLoadoutPlan(params: {
  alreadyGrantedAt: Date | null;
  existingShips: StarterLoadoutExistingShip[];
  settings: StarterLoadoutSettings;
  starterDefinitions: StarterLoadoutShipDefinition[];
}): StarterLoadoutPlan {
  if (params.alreadyGrantedAt) {
    return { arcToGrant: 0, shouldGrant: false, shipsToCreate: [] };
  }

  const existingDefinitionIds = new Set(
    params.existingShips
      .map((ship) => ship.shipDefinitionId)
      .filter((shipDefinitionId): shipDefinitionId is string => typeof shipDefinitionId === 'string'),
  );
  const existingPrefabIds = new Set(params.existingShips.map((ship) => ship.prefabId));

  const shipsToCreate = params.starterDefinitions.flatMap((definition) => {
    if (existingDefinitionIds.has(definition.id) || existingPrefabIds.has(definition.prefabId)) {
      existingDefinitionIds.add(definition.id);
      existingPrefabIds.add(definition.prefabId);
      return [];
    }

    existingDefinitionIds.add(definition.id);
    existingPrefabIds.add(definition.prefabId);
    return [
      {
        shipDefinitionId: definition.id,
        prefabId: definition.prefabId,
        displayName: definition.name,
        hp: definition.maxHp,
        shields: definition.maxShields,
        maxHp: definition.maxHp,
        maxShields: definition.maxShields,
      },
    ];
  });

  return {
    arcToGrant: Math.max(0, Math.floor(params.settings.startingArcBalance)),
    shouldGrant: true,
    shipsToCreate,
  };
}

export function hydrateOwnedShip(params: {
  ship: {
    shipDefinitionId: string | null;
    prefabId: string;
    displayName: string;
    hp: number;
    shields: number;
    maxHp: number;
    maxShields: number;
  };
  definition: ShipStatsSource | null;
}): HydratedOwnedShip {
  const source = params.definition;
  const maxHp = source?.maxHp ?? params.ship.maxHp ?? DEFAULT_SHIP_TUNING.maxHp;
  const maxShields =
    source?.maxShields ?? params.ship.maxShields ?? DEFAULT_SHIP_TUNING.maxShields;
  return {
    shipDefinitionId: source?.id ?? params.ship.shipDefinitionId ?? null,
    prefabId: source?.prefabId ?? params.ship.prefabId,
    displayName: source?.name ?? params.ship.displayName,
    hp: Math.min(maxHp, Math.max(0, params.ship.hp)),
    shields: Math.min(maxShields, Math.max(0, params.ship.shields)),
    maxHp,
    maxShields,
    shieldRegenPerSec: source?.shieldRegenPerSec ?? DEFAULT_SHIP_TUNING.shieldRegenPerSec,
    maxSpeedMps: source?.maxSpeedMps ?? DEFAULT_SHIP_TUNING.maxSpeedMps,
    throttleAccelMps2:
      source?.throttleAccelMps2 ?? DEFAULT_SHIP_TUNING.throttleAccelMps2,
  };
}

export function sortShipsForBootstrap<T extends { createdAt: Date; shipDefinitionId: string | null; prefabId: string }>(
  ships: T[],
  starterShipDefinitionIds: string[],
  definitionByPrefabId: ReadonlyMap<string, ShipStatsSource>,
): T[] {
  const starterPriority = new Map(starterShipDefinitionIds.map((id, index) => [id, index]));
  return [...ships].sort((left, right) => {
    const leftStarterId =
      left.shipDefinitionId ?? definitionByPrefabId.get(left.prefabId)?.id ?? null;
    const rightStarterId =
      right.shipDefinitionId ?? definitionByPrefabId.get(right.prefabId)?.id ?? null;
    const leftPriority = leftStarterId ? starterPriority.get(leftStarterId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const rightPriority = rightStarterId ? starterPriority.get(rightStarterId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}
