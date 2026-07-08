import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameCatalogService } from './game.catalog.service';
import type { InventoryStateDto } from './game.types';

@Injectable()
export class GameInventoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GameCatalogService) private readonly catalog: GameCatalogService,
  ) {}

  async getInventoryState(playerId: string): Promise<InventoryStateDto> {
    const [catalog, inventoryRows] = await Promise.all([
      this.catalog.listItemDefinitions(),
      this.prisma.playerItem.findMany({
        where: { playerId, quantity: { gt: 0 } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      catalog: catalog.map((entry) => this.catalog.asItemDefinitionDto(entry)),
      items: inventoryRows.map((entry) => ({
        itemDefinitionId: entry.itemDefinitionId,
        quantity: entry.quantity,
      })),
    };
  }
}
