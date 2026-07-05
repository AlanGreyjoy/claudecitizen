import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  hydrateOwnedShip,
  sortShipsForBootstrap,
} from './game.catalog.helpers';
import { GameCatalogService } from './game.catalog.service';
import { GameHangarService } from './game.hangar.service';
import type { GameBootstrapDto } from './game.types';

@Injectable()
export class GameService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GameCatalogService) private readonly catalog: GameCatalogService,
    @Inject(GameHangarService) private readonly hangar: GameHangarService,
  ) {}

  async bootstrapForUser(userId: string): Promise<GameBootstrapDto> {
    await this.catalog.grantStarterLoadout(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        player: {
          include: {
            ships: {
              include: { shipDefinition: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    if (!user?.player) throw new UnauthorizedException('Account has no player.');

    const settings = await this.catalog.getSettings();
    const legacyDefinitions = await this.catalog.listDefinitionsByPrefabIds(
      user.player.ships
        .filter((ship) => ship.shipDefinitionId === null)
        .map((ship) => ship.prefabId),
    );
    const definitionByPrefabId = new Map(
      legacyDefinitions.map((definition) => [
        definition.prefabId,
        this.catalog.asShipStatsSource(definition),
      ]),
    );
    const orderedShips = sortShipsForBootstrap(
      user.player.ships,
      settings.starterShipDefinitionIds,
      definitionByPrefabId,
    );

    const apartmentInstanceId = `apartment:${user.player.id}`;
    const hangarInstanceId = `hangar:${user.player.id}`;
    const currentInstanceId = user.player.currentInstanceId || apartmentInstanceId;
    const [hangarState, apartmentState] = await Promise.all([
      this.hangar.getBuildState(user.player.id, 'hangar'),
      this.hangar.getBuildState(user.player.id, 'apartment'),
    ]);

    return {
      player: {
        id: user.player.id,
        handle: user.player.handle,
        displayName: user.player.displayName,
      },
      economy: {
        arcBalance: user.player.arcBalance,
      },
      spawn: {
        instanceId: currentInstanceId,
        apartmentInstanceId,
        hangarInstanceId,
        stationRoomId: user.player.currentRoomId || 'hab-room',
      },
      ships: orderedShips.map((ship) => {
        const authoritative = hydrateOwnedShip({
          ship: ship,
          definition:
            ship.shipDefinition
              ? this.catalog.asShipStatsSource(ship.shipDefinition)
              : definitionByPrefabId.get(ship.prefabId) ?? null,
        });
        return {
          id: ship.id,
          shipDefinitionId: authoritative.shipDefinitionId,
          prefabId: authoritative.prefabId,
          displayName: authoritative.displayName,
          hp: authoritative.hp,
          shields: authoritative.shields,
          maxHp: authoritative.maxHp,
          maxShields: authoritative.maxShields,
          shieldRegenPerSec: authoritative.shieldRegenPerSec,
          maxSpeedMps: authoritative.maxSpeedMps,
          throttleAccelMps2: authoritative.throttleAccelMps2,
        };
      }),
      hangar: {
        area: hangarState.area,
        assignedHangar: hangarState.assignedHangar,
        catalog: hangarState.catalog,
        inventory: hangarState.inventory,
        placements: hangarState.placements,
      },
      apartment: {
        area: apartmentState.area,
        assignedHangar: apartmentState.assignedHangar,
        catalog: apartmentState.catalog,
        inventory: apartmentState.inventory,
        placements: apartmentState.placements,
      },
      featureFlags: {
        nativeWebSocketPresence: true,
        serverAuthoritativePhysics: false,
      },
    };
  }
}
