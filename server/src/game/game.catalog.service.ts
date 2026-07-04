import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeStarterLoadoutPlan,
  DEFAULT_SHIP_TUNING,
  type ShipStatsSource,
} from './game.catalog.helpers';

const GAME_SETTINGS_ID = 'singleton';
const DEFAULT_STARTING_ARC_BALANCE = 25_000;
const DEFAULT_STARTER_PREFAB_ID = 'phobos-starhopper';

type CatalogDb = Prisma.TransactionClient | PrismaService;

@Injectable()
export class GameCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listShipDefinitions() {
    return this.prisma.shipDefinition.findMany({
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createShipDefinition(input: {
    name: string;
    description: string;
    prefabId: string;
    costArc: number;
    maxHp: number;
    maxShields: number;
    shieldRegenPerSec: number;
    maxSpeedMps: number;
    throttleAccelMps2: number;
  }) {
    return this.prisma.shipDefinition.create({ data: input });
  }

  async updateShipDefinition(
    id: string,
    input: {
      name?: string;
      description?: string;
      prefabId?: string;
      costArc?: number;
      maxHp?: number;
      maxShields?: number;
      shieldRegenPerSec?: number;
      maxSpeedMps?: number;
      throttleAccelMps2?: number;
    },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const definition = await tx.shipDefinition.update({
          where: { id },
          data: input,
        });
        await tx.ship.updateMany({
          where: { shipDefinitionId: id },
          data: {
            prefabId: definition.prefabId,
            displayName: definition.name,
            maxHp: definition.maxHp,
            maxShields: definition.maxShields,
          },
        });
        return definition;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Ship definition "${id}" not found.`);
      }
      throw error;
    }
  }

  async getSettings() {
    return this.getOrCreateSettings(this.prisma);
  }

  async updateSettings(input: {
    startingArcBalance: number;
    starterShipDefinitionIds: string[];
  }) {
    if (input.starterShipDefinitionIds.length === 0) {
      throw new BadRequestException('Choose at least one starter ship.');
    }
    const count = await this.prisma.shipDefinition.count({
      where: { id: { in: input.starterShipDefinitionIds } },
    });
    if (count !== input.starterShipDefinitionIds.length) {
      throw new BadRequestException('Game settings reference unknown ship definitions.');
    }
    return this.prisma.gameSettings.upsert({
      where: { id: GAME_SETTINGS_ID },
      update: input,
      create: {
        id: GAME_SETTINGS_ID,
        ...input,
      },
    });
  }

  async grantStarterLoadout(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          player: {
            include: {
              ships: {
                orderBy: { createdAt: 'asc' },
                select: {
                  shipDefinitionId: true,
                  prefabId: true,
                },
              },
            },
          },
        },
      });
      if (!user?.player) throw new UnauthorizedException('Account has no player.');

      const settings = await this.getOrCreateSettings(tx);
      const starterDefinitions = await tx.shipDefinition.findMany({
        where: { id: { in: settings.starterShipDefinitionIds } },
      });
      const definitionsById = new Map(starterDefinitions.map((definition) => [definition.id, definition]));
      const orderedStarterDefinitions = settings.starterShipDefinitionIds.map((id) => {
        const definition = definitionsById.get(id);
        if (!definition) {
          throw new InternalServerErrorException(
            `Starter ship definition "${id}" is missing from the catalog.`,
          );
        }
        return definition;
      });

      const plan = computeStarterLoadoutPlan({
        alreadyGrantedAt: user.player.starterLoadoutGrantedAt,
        existingShips: user.player.ships,
        settings,
        starterDefinitions: orderedStarterDefinitions,
      });
      if (!plan.shouldGrant) return;

      if (plan.shipsToCreate.length > 0) {
        await tx.ship.createMany({
          data: plan.shipsToCreate.map((ship) => ({
            ...ship,
            playerId: user.player!.id,
            currentInstanceId: `hangar:${user.player!.id}`,
          })),
        });
      }

      await tx.player.update({
        where: { id: user.player.id },
        data: {
          arcBalance: { increment: plan.arcToGrant },
          starterLoadoutGrantedAt: new Date(),
        },
      });
    });
  }

  async listDefinitionsByPrefabIds(prefabIds: string[]) {
    if (prefabIds.length === 0) return [];
    return this.prisma.shipDefinition.findMany({
      where: { prefabId: { in: prefabIds } },
      orderBy: { createdAt: 'asc' },
    });
  }

  asShipStatsSource(definition: {
    id: string;
    name: string;
    prefabId: string;
    maxHp: number;
    maxShields: number;
    shieldRegenPerSec: number;
    maxSpeedMps: number;
    throttleAccelMps2: number;
  }): ShipStatsSource {
    return {
      id: definition.id,
      name: definition.name,
      prefabId: definition.prefabId,
      maxHp: definition.maxHp,
      maxShields: definition.maxShields,
      shieldRegenPerSec: definition.shieldRegenPerSec,
      maxSpeedMps: definition.maxSpeedMps,
      throttleAccelMps2: definition.throttleAccelMps2,
    };
  }

  private async getOrCreateSettings(db: CatalogDb) {
    const fallbackStarter = await db.shipDefinition.findFirst({
      where: { prefabId: DEFAULT_STARTER_PREFAB_ID },
      orderBy: { createdAt: 'asc' },
    });
    return db.gameSettings.upsert({
      where: { id: GAME_SETTINGS_ID },
      update: {},
      create: {
        id: GAME_SETTINGS_ID,
        startingArcBalance: DEFAULT_STARTING_ARC_BALANCE,
        starterShipDefinitionIds: fallbackStarter ? [fallbackStarter.id] : [],
      },
    });
  }

  defaultShipStats(): ShipStatsSource {
    return {
      id: 'default-ship-stats',
      name: 'Star Hopper',
      prefabId: DEFAULT_STARTER_PREFAB_ID,
      maxHp: DEFAULT_SHIP_TUNING.maxHp,
      maxShields: DEFAULT_SHIP_TUNING.maxShields,
      shieldRegenPerSec: DEFAULT_SHIP_TUNING.shieldRegenPerSec,
      maxSpeedMps: DEFAULT_SHIP_TUNING.maxSpeedMps,
      throttleAccelMps2: DEFAULT_SHIP_TUNING.throttleAccelMps2,
    };
  }
}
