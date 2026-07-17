import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EnvService } from '../shared/env.service';
import {
  GameCatalogService,
  type ItemType,
  type WeaponSlotType,
} from '../game/game.catalog.service';
import type { AdminSessionDto, AdminSessionPayload } from './admin.types';

const ADMIN_COOKIE_MS = 12 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function secureStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(GameCatalogService) private readonly catalog: GameCatalogService,
  ) {}

  readonly sessionCookieMs = ADMIN_COOKIE_MS;

  async login(email: string, password: string): Promise<{
    session: AdminSessionDto;
    token: string;
  }> {
    if (!this.env.adminPassword) {
      throw new BadRequestException('Admin password is not configured.');
    }

    const cleanEmail = normalizeEmail(email);
    const expectedEmail = normalizeEmail(this.env.adminEmail);
    if (
      cleanEmail !== expectedEmail ||
      !secureStringEquals(password, this.env.adminPassword)
    ) {
      throw new UnauthorizedException('Invalid admin credentials.');
    }

    const token = await this.jwt.signAsync(
      { sub: expectedEmail, typ: 'admin' } satisfies AdminSessionPayload,
      { expiresIn: '12h', secret: this.env.adminSessionSecret },
    );
    return {
      session: { email: this.env.adminEmail },
      token,
    };
  }

  async verifySessionToken(token: string): Promise<AdminSessionPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AdminSessionPayload>(token, {
        secret: this.env.adminSessionSecret,
      });
      if (payload.typ !== 'admin' || payload.sub !== normalizeEmail(this.env.adminEmail)) {
        throw new Error('wrong token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Admin session is invalid.');
    }
  }

  session(): AdminSessionDto {
    return { email: this.env.adminEmail };
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        createdAt: true,
        updatedAt: true,
        player: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            currentInstanceId: true,
            currentRoomId: true,
            arcBalance: true,
            starterLoadoutGrantedAt: true,
            createdAt: true,
            updatedAt: true,
            ships: {
              select: { id: true },
            },
          },
        },
      },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      player: user.player
        ? {
            id: user.player.id,
            handle: user.player.handle,
            displayName: user.player.displayName,
            currentInstanceId: user.player.currentInstanceId,
            currentRoomId: user.player.currentRoomId,
            arcBalance: user.player.arcBalance,
            starterLoadoutGrantedAt: user.player.starterLoadoutGrantedAt,
            createdAt: user.player.createdAt,
            updatedAt: user.player.updatedAt,
            shipCount: user.player.ships.length,
          }
        : null,
    }));
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        createdAt: true,
        updatedAt: true,
        player: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            currentInstanceId: true,
            currentRoomId: true,
            arcBalance: true,
            starterLoadoutGrantedAt: true,
            createdAt: true,
            updatedAt: true,
            ships: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                shipDefinitionId: true,
                prefabId: true,
                displayName: true,
                currentInstanceId: true,
                hp: true,
                shields: true,
                maxHp: true,
                maxShields: true,
                createdAt: true,
                updatedAt: true,
                shipDefinition: {
                  select: {
                    id: true,
                    name: true,
                    prefabId: true,
                    costArc: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException(`User "${userId}" not found.`);
    return user;
  }

  async listShipDefinitions() {
    return this.catalog.listShipDefinitions();
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
    return this.catalog.createShipDefinition(input);
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
    return this.catalog.updateShipDefinition(id, input);
  }

  async getSettings() {
    return this.catalog.getSettings();
  }

  async updateSettings(input: {
    startingArcBalance: number;
    starterShipDefinitionIds: string[];
    starterPropDefinitionIds: string[];
    starterItemDefinitionIds: string[];
  }) {
    return this.catalog.updateSettings(input);
  }

  async listPropDefinitions() {
    return this.catalog.listPropDefinitions();
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
    return this.catalog.createPropDefinition(input);
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
    return this.catalog.updatePropDefinition(id, input);
  }

  async listItemDefinitions() {
    return this.catalog.listItemDefinitions();
  }

  async createItemDefinition(input: {
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
    return this.catalog.createItemDefinition({
      ...input,
      itemType: input.itemType as ItemType,
    });
  }

  async updateItemDefinition(
    id: string,
    input: {
      name?: string;
      description?: string;
      itemType?: string;
      subType?: string;
      prefabId?: string | null;
      iconUrl?: string | null;
      stackMax?: number;
      costArc?: number;
      rarity?: string;
    },
  ) {
    return this.catalog.updateItemDefinition(id, {
      ...input,
      itemType: input.itemType as ItemType | undefined,
    });
  }

  async deleteItemDefinition(id: string) {
    return this.catalog.deleteItemDefinition(id);
  }

  async listWeaponDefinitions() {
    return this.catalog.listWeaponDefinitions();
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
    return this.catalog.createWeaponDefinition(input);
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
    return this.catalog.updateWeaponDefinition(id, input);
  }

  async deleteWeaponDefinition(id: string) {
    return this.catalog.deleteWeaponDefinition(id);
  }

  async listBackpackDefinitions() {
    return this.catalog.listBackpackDefinitions();
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
    return this.catalog.createBackpackDefinition(input);
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
    return this.catalog.updateBackpackDefinition(id, input);
  }

  async deleteBackpackDefinition(id: string) {
    return this.catalog.deleteBackpackDefinition(id);
  }
}
