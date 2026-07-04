import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { GameBootstrapDto } from './game.types';

const STARTER_SHIP_PREFAB_ID = 'phobos-starhopper';
const STARTER_SHIP_NAME = 'Star Hopper';

@Injectable()
export class GameService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async bootstrapForUser(userId: string): Promise<GameBootstrapDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        player: {
          include: { ships: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!user?.player) throw new UnauthorizedException('Account has no player.');

    let ships = user.player.ships;
    if (!ships.some((ship) => ship.prefabId === STARTER_SHIP_PREFAB_ID)) {
      const starter = await this.prisma.ship.create({
        data: {
          playerId: user.player.id,
          prefabId: STARTER_SHIP_PREFAB_ID,
          displayName: STARTER_SHIP_NAME,
          currentInstanceId: `hangar:${user.player.id}`,
        },
      });
      ships = [...ships, starter];
    }

    const apartmentInstanceId = `apartment:${user.player.id}`;
    const hangarInstanceId = `hangar:${user.player.id}`;
    const currentInstanceId = user.player.currentInstanceId || apartmentInstanceId;

    return {
      player: {
        id: user.player.id,
        handle: user.player.handle,
        displayName: user.player.displayName,
      },
      spawn: {
        instanceId: currentInstanceId,
        apartmentInstanceId,
        hangarInstanceId,
        stationRoomId: user.player.currentRoomId || 'hab-room',
      },
      ships: ships.map((ship) => ({
        id: ship.id,
        prefabId: ship.prefabId,
        displayName: ship.displayName,
        hp: ship.hp,
        shields: ship.shields,
        maxHp: ship.maxHp,
        maxShields: ship.maxShields,
      })),
      featureFlags: {
        nativeWebSocketPresence: true,
        serverAuthoritativePhysics: false,
      },
    };
  }
}
