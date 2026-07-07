import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameCatalogService } from './game.catalog.service';
import {
  type BuildArea,
  validatePlacementTransform,
  type PlacementTransform,
} from './game.hangar.validation';

export interface PropDefinitionDto {
  id: string;
  name: string;
  description: string;
  prefabId: string;
  costArc: number;
  category: string;
  maxPerHangar: number | null;
  allowRotateY: boolean;
  snapGridM: number | null;
}

export interface PlayerPropInventoryDto {
  propDefinitionId: string;
  quantity: number;
}

export interface HangarPlacementDto {
  id: string;
  area: BuildArea;
  propDefinitionId: string;
  prefabId: string;
  right: number;
  up: number;
  forward: number;
  rotationY: number;
}

export interface HangarBuildStateDto {
  area: BuildArea;
  assignedHangar: number | null;
  arcBalance: number;
  catalog: PropDefinitionDto[];
  inventory: PlayerPropInventoryDto[];
  placements: HangarPlacementDto[];
}

@Injectable()
export class GameHangarService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GameCatalogService) private readonly catalog: GameCatalogService,
  ) {}

  async getBuildState(playerId: string, area: BuildArea = 'hangar'): Promise<HangarBuildStateDto> {
    const player = await this.requirePlayer(playerId);
    const [catalog, inventoryRows, placementRows] = await Promise.all([
      this.catalog.listPropDefinitions(),
      this.prisma.playerProp.findMany({
        where: { playerId },
        orderBy: { propDefinitionId: 'asc' },
      }),
      this.prisma.hangarPlacement.findMany({
        where: { playerId, area },
        include: { propDefinition: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      area,
      assignedHangar: player.assignedHangar ?? null,
      arcBalance: player.arcBalance,
      catalog: catalog.map((entry) => this.asPropDefinitionDto(entry)),
      inventory: inventoryRows.map((entry) => ({
        propDefinitionId: entry.propDefinitionId,
        quantity: entry.quantity,
      })),
      placements: placementRows.map((entry) => ({
        id: entry.id,
        area,
        propDefinitionId: entry.propDefinitionId,
        prefabId: entry.propDefinition.prefabId,
        right: entry.right,
        up: entry.up,
        forward: entry.forward,
        rotationY: entry.rotationY,
      })),
    };
  }

  async purchaseProp(
    playerId: string,
    propDefinitionId: string,
    area: BuildArea = 'hangar',
  ): Promise<HangarBuildStateDto> {
    await this.prisma.$transaction(async (tx) => {
      const player = await tx.player.findUnique({ where: { id: playerId } });
      if (!player) throw new NotFoundException('Player not found.');

      const definition = await tx.propDefinition.findUnique({
        where: { id: propDefinitionId },
      });
      if (!definition) throw new NotFoundException('Prop definition not found.');
      if (player.arcBalance < definition.costArc) {
        throw new BadRequestException('Insufficient ARC balance.');
      }

      await tx.player.update({
        where: { id: playerId },
        data: { arcBalance: { decrement: definition.costArc } },
      });

      await tx.playerProp.upsert({
        where: {
          playerId_propDefinitionId: { playerId, propDefinitionId },
        },
        create: { playerId, propDefinitionId, quantity: 1 },
        update: { quantity: { increment: 1 } },
      });
    });

    return this.getBuildState(playerId, area);
  }

  async createPlacement(
    playerId: string,
    area: BuildArea,
    propDefinitionId: string,
    transform: PlacementTransform,
  ): Promise<HangarBuildStateDto> {
    await this.prisma.$transaction(async (tx) => {
      const player = await tx.player.findUnique({ where: { id: playerId } });
      if (!player) throw new NotFoundException('Player not found.');
      if (area === 'hangar' && player.assignedHangar === null) {
        throw new BadRequestException('Deliver your ship to a hangar bay before placing props.');
      }

      const definition = await tx.propDefinition.findUnique({
        where: { id: propDefinitionId },
      });
      if (!definition) throw new NotFoundException('Prop definition not found.');

      const inventory = await tx.playerProp.findUnique({
        where: {
          playerId_propDefinitionId: { playerId, propDefinitionId },
        },
      });
      if (!inventory || inventory.quantity <= 0) {
        throw new BadRequestException('You do not own this prop.');
      }

      const existing = await tx.hangarPlacement.findMany({
        where: { playerId, area, propDefinitionId },
      });
      const allPlacements = await tx.hangarPlacement.findMany({ where: { playerId, area } });

      const perTypeCount = existing.length;
      if (definition.maxPerHangar !== null && perTypeCount >= definition.maxPerHangar) {
        throw new BadRequestException(
          `You can only place ${definition.maxPerHangar} of this prop in your ${
            area === 'apartment' ? 'apartment' : 'hangar'
          }.`,
        );
      }

      const validation = validatePlacementTransform({
        area,
        transform,
        hangarIndex: player.assignedHangar ?? 2,
        definition,
        existingPlacements: allPlacements.map((entry) => ({
          right: entry.right,
          up: entry.up,
          forward: entry.forward,
          rotationY: entry.rotationY,
        })),
      });
      if (!validation.ok) throw new BadRequestException(validation.message);

      await tx.hangarPlacement.create({
        data: {
          playerId,
          propDefinitionId,
          area,
          ...validation.transform,
        },
      });

      await tx.playerProp.update({
        where: {
          playerId_propDefinitionId: { playerId, propDefinitionId },
        },
        data: { quantity: { decrement: 1 } },
      });
    });

    return this.getBuildState(playerId, area);
  }

  async updatePlacement(
    playerId: string,
    area: BuildArea,
    placementId: string,
    transform: PlacementTransform,
  ): Promise<HangarBuildStateDto> {
    await this.prisma.$transaction(async (tx) => {
      const player = await tx.player.findUnique({ where: { id: playerId } });
      if (!player) throw new NotFoundException('Player not found.');
      if (area === 'hangar' && player.assignedHangar === null) {
        throw new BadRequestException('Deliver your ship to a hangar bay before moving props.');
      }

      const placement = await tx.hangarPlacement.findFirst({
        where: { id: placementId, playerId, area },
        include: { propDefinition: true },
      });
      if (!placement) throw new NotFoundException('Placement not found.');

      const allPlacements = await tx.hangarPlacement.findMany({ where: { playerId, area } });
      const validation = validatePlacementTransform({
        area,
        transform,
        hangarIndex: player.assignedHangar ?? 2,
        definition: placement.propDefinition,
        existingPlacements: allPlacements
          .filter((entry) => entry.id !== placementId)
          .map((entry) => ({
            right: entry.right,
            up: entry.up,
            forward: entry.forward,
            rotationY: entry.rotationY,
          })),
      });
      if (!validation.ok) throw new BadRequestException(validation.message);

      await tx.hangarPlacement.update({
        where: { id: placementId },
        data: validation.transform,
      });
    });

    return this.getBuildState(playerId, area);
  }

  async deletePlacement(
    playerId: string,
    area: BuildArea,
    placementId: string,
  ): Promise<HangarBuildStateDto> {
    await this.prisma.$transaction(async (tx) => {
      const placement = await tx.hangarPlacement.findFirst({
        where: { id: placementId, playerId, area },
      });
      if (!placement) throw new NotFoundException('Placement not found.');

      await tx.hangarPlacement.delete({ where: { id: placementId } });
      await tx.playerProp.upsert({
        where: {
          playerId_propDefinitionId: {
            playerId,
            propDefinitionId: placement.propDefinitionId,
          },
        },
        create: {
          playerId,
          propDefinitionId: placement.propDefinitionId,
          quantity: 1,
        },
        update: { quantity: { increment: 1 } },
      });
    });

    return this.getBuildState(playerId, area);
  }

  async setAssignedHangar(playerId: string, hangarIndex: number): Promise<void> {
    if (hangarIndex !== 1 && hangarIndex !== 2 && hangarIndex !== 3) {
      throw new BadRequestException('Hangar index must be 1, 2, or 3.');
    }
    await this.prisma.player.update({
      where: { id: playerId },
      data: { assignedHangar: hangarIndex },
    });
  }

  async resetAssignedHangar(playerId: string): Promise<void> {
    await this.prisma.player.update({
      where: { id: playerId },
      data: { assignedHangar: null },
    });
  }

  private async requirePlayer(playerId: string) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found.');
    return player;
  }

  private asPropDefinitionDto(entry: {
    id: string;
    name: string;
    description: string;
    prefabId: string;
    costArc: number;
    category: string;
    maxPerHangar: number | null;
    allowRotateY: boolean;
    snapGridM: number | null;
  }): PropDefinitionDto {
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      prefabId: entry.prefabId,
      costArc: entry.costArc,
      category: entry.category,
      maxPerHangar: entry.maxPerHangar,
      allowRotateY: entry.allowRotateY,
      snapGridM: entry.snapGridM,
    };
  }
}
