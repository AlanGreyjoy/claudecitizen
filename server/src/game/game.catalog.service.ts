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

export const ITEM_TYPES = [
  'consumable',
  'weapon',
  'backpack',
  'armor',
  'clothing',
  'material',
  'misc',
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

export const WEAPON_SLOT_TYPES = ['sword', 'handgun', 'rifle'] as const;
export type WeaponSlotType = (typeof WEAPON_SLOT_TYPES)[number];

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
    starterPropDefinitionIds: string[];
    starterItemDefinitionIds: string[];
  }) {
    if (input.starterShipDefinitionIds.length === 0) {
      throw new BadRequestException('Choose at least one starter ship.');
    }
    const shipCount = await this.prisma.shipDefinition.count({
      where: { id: { in: input.starterShipDefinitionIds } },
    });
    if (shipCount !== input.starterShipDefinitionIds.length) {
      throw new BadRequestException('Game settings reference unknown ship definitions.');
    }
    if (input.starterPropDefinitionIds.length > 0) {
      const propCount = await this.prisma.propDefinition.count({
        where: { id: { in: input.starterPropDefinitionIds } },
      });
      if (propCount !== input.starterPropDefinitionIds.length) {
        throw new BadRequestException('Game settings reference unknown prop definitions.');
      }
    }
    if (input.starterItemDefinitionIds.length > 0) {
      const itemCount = await this.prisma.itemDefinition.count({
        where: { id: { in: input.starterItemDefinitionIds } },
      });
      if (itemCount !== input.starterItemDefinitionIds.length) {
        throw new BadRequestException('Game settings reference unknown item definitions.');
      }
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

      const starterPropDefinitions = await tx.propDefinition.findMany({
        where: { id: { in: settings.starterPropDefinitionIds } },
      });
      for (const definition of starterPropDefinitions) {
        await tx.playerProp.upsert({
          where: {
            playerId_propDefinitionId: {
              playerId: user.player!.id,
              propDefinitionId: definition.id,
            },
          },
          create: {
            playerId: user.player!.id,
            propDefinitionId: definition.id,
            quantity: 3,
          },
          update: {},
        });
      }

      const starterItemDefinitions = await tx.itemDefinition.findMany({
        where: { id: { in: settings.starterItemDefinitionIds } },
      });
      for (const definition of starterItemDefinitions) {
        await tx.playerItem.upsert({
          where: {
            playerId_itemDefinitionId: {
              playerId: user.player!.id,
              itemDefinitionId: definition.id,
            },
          },
          create: {
            playerId: user.player!.id,
            itemDefinitionId: definition.id,
            quantity: 1,
          },
          update: {},
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

  async listPropDefinitions() {
    return this.prisma.propDefinition.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createPropDefinition(input: {
    name: string;
    description: string;
    prefabId: string;
    costArc: number;
    category: string;
    maxPerHangar: number | null;
    allowRotateY: boolean;
    snapGridM: number | null;
  }) {
    return this.prisma.propDefinition.create({ data: input });
  }

  async updatePropDefinition(
    id: string,
    input: {
      name?: string;
      description?: string;
      prefabId?: string;
      costArc?: number;
      category?: string;
      maxPerHangar?: number | null;
      allowRotateY?: boolean;
      snapGridM?: number | null;
    },
  ) {
    try {
      return await this.prisma.propDefinition.update({ where: { id }, data: input });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Prop definition "${id}" not found.`);
      }
      throw error;
    }
  }

  async listItemDefinitions() {
    return this.prisma.itemDefinition.findMany({
      orderBy: [{ itemType: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listWeaponDefinitions() {
    const entries = await this.prisma.weaponDefinition.findMany({
      include: { itemDefinition: true },
      orderBy: [
        { weaponSlotType: 'asc' },
        { itemDefinition: { name: 'asc' } },
      ],
    });
    return entries.map((entry) => ({
      ...entry.itemDefinition,
      weaponSlotType: entry.weaponSlotType,
    }));
  }

  async createWeaponDefinition(input: {
    name: string;
    description: string;
    subType: string;
    prefabId: string;
    iconUrl: string | null;
    costArc: number;
    rarity: string;
    weaponSlotType: WeaponSlotType;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.itemDefinition.create({
        data: {
          name: input.name,
          description: input.description,
          itemType: 'weapon',
          subType: input.subType,
          prefabId: input.prefabId,
          iconUrl: input.iconUrl,
          stackMax: 1,
          costArc: input.costArc,
          rarity: input.rarity,
        },
      });
      await tx.weaponDefinition.create({
        data: {
          itemDefinitionId: item.id,
          weaponSlotType: input.weaponSlotType,
        },
      });
      return { ...item, weaponSlotType: input.weaponSlotType };
    });
  }

  async updateWeaponDefinition(
    id: string,
    input: Partial<{
      name: string;
      description: string;
      subType: string;
      prefabId: string;
      iconUrl: string | null;
      costArc: number;
      rarity: string;
      weaponSlotType: WeaponSlotType;
    }>,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.itemDefinition.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description,
            subType: input.subType,
            prefabId: input.prefabId,
            iconUrl: input.iconUrl,
            costArc: input.costArc,
            rarity: input.rarity,
          },
        });
        const weapon = await tx.weaponDefinition.update({
          where: { itemDefinitionId: id },
          data: { weaponSlotType: input.weaponSlotType },
        });
        return { ...item, weaponSlotType: weapon.weaponSlotType };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`Weapon definition "${id}" not found.`);
      }
      throw error;
    }
  }

  async deleteWeaponDefinition(id: string): Promise<void> {
    await this.deleteItemDefinition(id);
  }

  async listBackpackDefinitions() {
    const entries = await this.prisma.backpackDefinition.findMany({
      include: { itemDefinition: true },
      orderBy: { itemDefinition: { name: 'asc' } },
    });
    return entries.map((entry) => ({
      ...entry.itemDefinition,
      capacityLiters: entry.capacityLiters,
      emptyMassKg: entry.emptyMassKg,
    }));
  }

  async createBackpackDefinition(input: {
    name: string;
    description: string;
    subType: string;
    prefabId: string;
    iconUrl: string | null;
    costArc: number;
    rarity: string;
    capacityLiters: number;
    emptyMassKg: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.itemDefinition.create({
        data: {
          name: input.name,
          description: input.description,
          itemType: 'backpack',
          subType: input.subType,
          prefabId: input.prefabId,
          iconUrl: input.iconUrl,
          stackMax: 1,
          costArc: input.costArc,
          rarity: input.rarity,
        },
      });
      await tx.backpackDefinition.create({
        data: {
          itemDefinitionId: item.id,
          capacityLiters: input.capacityLiters,
          emptyMassKg: input.emptyMassKg,
        },
      });
      return {
        ...item,
        capacityLiters: input.capacityLiters,
        emptyMassKg: input.emptyMassKg,
      };
    });
  }

  async updateBackpackDefinition(
    id: string,
    input: Partial<{
      name: string;
      description: string;
      subType: string;
      prefabId: string;
      iconUrl: string | null;
      costArc: number;
      rarity: string;
      capacityLiters: number;
      emptyMassKg: number;
    }>,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.itemDefinition.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description,
            subType: input.subType,
            prefabId: input.prefabId,
            iconUrl: input.iconUrl,
            costArc: input.costArc,
            rarity: input.rarity,
          },
        });
        const backpack = await tx.backpackDefinition.update({
          where: { itemDefinitionId: id },
          data: {
            capacityLiters: input.capacityLiters,
            emptyMassKg: input.emptyMassKg,
          },
        });
        return {
          ...item,
          capacityLiters: backpack.capacityLiters,
          emptyMassKg: backpack.emptyMassKg,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`Backpack definition "${id}" not found.`);
      }
      throw error;
    }
  }

  async deleteBackpackDefinition(id: string): Promise<void> {
    await this.deleteItemDefinition(id);
  }

  asItemDefinitionDto(entry: {
    id: string;
    name: string;
    description: string;
    itemType: string;
    subType: string;
    prefabId: string | null;
    iconUrl: string | null;
    stackMax: number;
    costArc: number;
    rarity: string;
  }) {
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      itemType: entry.itemType,
      subType: entry.subType,
      prefabId: entry.prefabId,
      iconUrl: entry.iconUrl,
      stackMax: entry.stackMax,
      costArc: entry.costArc,
      rarity: entry.rarity,
    };
  }

  async createItemDefinition(input: {
    name: string;
    description: string;
    itemType: ItemType;
    subType: string;
    prefabId: string | null;
    iconUrl: string | null;
    stackMax: number;
    costArc: number;
    rarity: string;
  }) {
    if (input.itemType === 'weapon' || input.itemType === 'backpack') {
      throw new BadRequestException('Use the specialized weapon or backpack catalog.');
    }
    return this.prisma.itemDefinition.create({ data: input });
  }

  async updateItemDefinition(
    id: string,
    input: {
      name?: string;
      description?: string;
      itemType?: ItemType;
      subType?: string;
      prefabId?: string | null;
      iconUrl?: string | null;
      stackMax?: number;
      costArc?: number;
      rarity?: string;
    },
  ) {
    const current = await this.prisma.itemDefinition.findUnique({
      where: { id },
      include: { weapon: true, backpack: true },
    });
    if (!current) throw new NotFoundException(`Item definition "${id}" not found.`);
    if (current.weapon || current.backpack || input.itemType === 'weapon' || input.itemType === 'backpack') {
      throw new BadRequestException('Use the specialized weapon or backpack catalog.');
    }
    try {
      return await this.prisma.itemDefinition.update({ where: { id }, data: input });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Item definition "${id}" not found.`);
      }
      throw error;
    }
  }

  async deleteItemDefinition(id: string): Promise<void> {
    const owned = await this.prisma.playerItem.count({
      where: { itemDefinitionId: id, quantity: { gt: 0 } },
    });
    if (owned > 0) {
      throw new BadRequestException(
        'Cannot delete an item definition while players still hold copies.',
      );
    }
    try {
      await this.prisma.$transaction([
        this.prisma.playerItem.deleteMany({ where: { itemDefinitionId: id } }),
        this.prisma.itemDefinition.delete({ where: { id } }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Item definition "${id}" not found.`);
      }
      throw error;
    }
  }
}
