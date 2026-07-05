import { Inject, Injectable } from '@nestjs/common';
import { parse as parseCookie } from 'cookie';
import type { IncomingMessage } from 'node:http';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WebSocket } from 'ws';
import { AuthService } from '../auth/auth.service';
import { GameService } from '../game/game.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  canEnterInstance,
  entityFocusPosition,
  lodForViewer,
  shouldSeeEntity,
  shouldSendLod,
  type ViewerState,
} from './world.visibility';
import type {
  ClientEnvelope,
  ClientPresenceUpdate,
  NetworkBodyDto,
  NetworkEntityState,
  NetworkLod,
  ServerEnvelope,
  ShipRigDto,
  SnapshotEntityDto,
  Vec3Dto,
} from './world.types';

interface WorldSession {
  client: WebSocket;
  userId: string;
  playerId: string;
  displayName: string;
  instanceId: string;
  stationRoomId: string | null;
  focusPosition: Vec3Dto | null;
  entity: NetworkEntityState | null;
}

const ENTITY_TTL_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

function readNullableString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

function isVec3(value: unknown): value is Vec3Dto {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number' &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

function sanitizeBody(value: unknown): NetworkBodyDto | null {
  if (!isRecord(value)) return null;
  if (!isVec3(value.position) || !isVec3(value.forward) || !isVec3(value.up)) return null;
  return {
    position: value.position,
    forward: value.forward,
    up: value.up,
  };
}

function sanitizeShipRig(value: unknown): ShipRigDto | null {
  if (!isRecord(value)) return null;
  const doors = isRecord(value.doors) ? value.doors : {};
  const sanitizedDoors: Record<string, number> = {};
  for (const [id, amount] of Object.entries(doors)) {
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      sanitizedDoors[id] = Math.max(0, Math.min(1, amount));
    }
  }
  return {
    gear01: typeof value.gear01 === 'number' ? Math.max(0, Math.min(1, value.gear01)) : 0,
    ramp01: typeof value.ramp01 === 'number' ? Math.max(0, Math.min(1, value.ramp01)) : 0,
    doors: sanitizedDoors,
  };
}

function distance(a: Vec3Dto, b: Vec3Dto): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function compactEntity(entity: NetworkEntityState, lod: NetworkLod): SnapshotEntityDto {
  const markerPosition = entityFocusPosition(entity) ?? { x: 0, y: 0, z: 0 };
  if (lod === 'marker') {
    return {
      id: entity.id,
      playerId: entity.playerId,
      displayName: entity.displayName,
      lod,
      mode: entity.mode,
      markerPosition,
    };
  }
  return {
    id: entity.id,
    playerId: entity.playerId,
    displayName: entity.displayName,
    lod,
    mode: entity.mode,
    character: entity.character,
    ship: entity.ship,
    shipRig: lod === 'full' ? entity.shipRig : null,
    markerPosition,
    stationRoomId: entity.stationRoomId,
    shipZoneId: lod === 'full' ? entity.shipZoneId : null,
  };
}

@Injectable()
export class WorldService {
  private readonly sessions = new Map<WebSocket, WorldSession>();
  private readonly entities = new Map<string, NetworkEntityState>();
  private tick = 0;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(GameService) private readonly game: GameService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @InjectPinoLogger(WorldService.name) private readonly logger: PinoLogger,
  ) {}

  async connect(client: WebSocket, request: IncomingMessage): Promise<void> {
    try {
      const cookies = parseCookie(request.headers.cookie ?? '');
      const accessToken = cookies.cc_at;
      if (!accessToken) throw new Error('Missing access cookie');
      const payload = await this.auth.verifyAccessToken(accessToken);
      const bootstrap = await this.game.bootstrapForUser(payload.sub);
      const session: WorldSession = {
        client,
        userId: payload.sub,
        playerId: bootstrap.player.id,
        displayName: bootstrap.player.displayName,
        instanceId: bootstrap.spawn.instanceId,
        stationRoomId: bootstrap.spawn.stationRoomId,
        focusPosition: null,
        entity: null,
      };
      this.sessions.set(client, session);
      client.on('message', (raw) => void this.handleRawMessage(client, raw.toString()));
      client.on('close', () => this.disconnect(client));
      this.logger.info(
        {
          userId: session.userId,
          playerId: session.playerId,
          displayName: session.displayName,
          instanceId: session.instanceId,
        },
        'World client connected',
      );
      this.send(client, { t: 'world:ready', data: bootstrap });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unauthorized';
      this.logger.warn({ reason }, 'World client connection rejected');
      this.send(client, {
        t: 'world:error',
        data: { message: error instanceof Error ? error.message : 'Unauthorized' },
      });
      client.close(1008, 'Unauthorized');
    }
  }

  disconnect(client: WebSocket): void {
    const session = this.sessions.get(client);
    if (!session) return;
    const entityInstanceId = session.entity?.instanceId ?? session.instanceId;
    const hadEntity = this.entities.delete(session.playerId);
    this.sessions.delete(client);
    this.logger.info(
      { playerId: session.playerId, instanceId: session.instanceId },
      'World client disconnected',
    );
    if (hadEntity) this.broadcastRemove(session.playerId, entityInstanceId);
  }

  broadcastSnapshots(): void {
    this.tick += 1;
    const now = Date.now();
    for (const [playerId, entity] of this.entities) {
      if (now - entity.updatedAt > ENTITY_TTL_MS) {
        this.entities.delete(playerId);
        this.broadcastRemove(playerId, entity.instanceId);
      }
    }

    for (const session of this.sessions.values()) {
      if (session.client.readyState !== WebSocket.OPEN) continue;
      const viewer: ViewerState = {
        playerId: session.playerId,
        instanceId: session.instanceId,
        stationRoomId: session.stationRoomId,
        focusPosition: session.focusPosition,
      };
      const entities: SnapshotEntityDto[] = [];
      for (const entity of this.entities.values()) {
        if (!shouldSeeEntity(viewer, entity)) continue;
        const lod = lodForViewer(viewer, entity);
        if (!shouldSendLod(lod, this.tick)) continue;
        entities.push(compactEntity(entity, lod));
      }
      if (entities.length > 0 || this.tick % 20 === 0) {
        this.send(session.client, { t: 'world:snapshot', data: { now, entities } });
      }
    }
  }

  private async handleRawMessage(client: WebSocket, raw: string): Promise<void> {
    const session = this.sessions.get(client);
    if (!session) return;
    let envelope: ClientEnvelope;
    try {
      envelope = JSON.parse(raw) as ClientEnvelope;
    } catch {
      this.sendError(client, 'Invalid JSON message.');
      return;
    }
    if (!envelope || typeof envelope.t !== 'string') {
      this.sendError(client, 'Invalid message envelope.');
      return;
    }

    switch (envelope.t) {
      case 'world:join':
        await this.handleJoin(session, envelope.data);
        return;
      case 'presence:update':
        this.handlePresenceUpdate(session, envelope.data);
        return;
      case 'presence:leave':
        this.handlePresenceLeave(session);
        return;
      case 'instance:transition':
        await this.handleInstanceTransition(session, envelope.data);
        return;
      case 'ship:rig':
        this.handleShipRig(session, envelope.data);
        return;
      case 'chat:send':
        await this.handleChat(session, envelope.data);
        return;
      default:
        this.sendError(client, `Unknown world message: ${envelope.t}`);
    }
  }

  private async handleJoin(session: WorldSession, data: unknown): Promise<void> {
    if (!isRecord(data)) return;
    const requestedInstanceId = readString(data, 'instanceId') ?? session.instanceId;
    if (!canEnterInstance(session.playerId, requestedInstanceId)) {
      this.sendError(session.client, 'You cannot enter that private instance.');
      return;
    }
    session.instanceId = requestedInstanceId;
    session.stationRoomId = readNullableString(data, 'stationRoomId') ?? session.stationRoomId;
    await this.persistPlayerLocation(session);
    this.send(session.client, {
      t: 'instance:changed',
      data: { instanceId: session.instanceId, stationRoomId: session.stationRoomId },
    });
  }

  private async handleInstanceTransition(session: WorldSession, data: unknown): Promise<void> {
    if (!isRecord(data)) return;
    const instanceId = readString(data, 'instanceId');
    if (!instanceId) return;
    if (!canEnterInstance(session.playerId, instanceId)) {
      this.sendError(session.client, 'You cannot enter that private instance.');
      return;
    }
    session.instanceId = instanceId;
    session.stationRoomId = readNullableString(data, 'stationRoomId');
    if (session.entity) {
      session.entity.instanceId = instanceId;
      session.entity.stationRoomId = session.stationRoomId;
      session.entity.updatedAt = Date.now();
    }
    await this.persistPlayerLocation(session);
    this.send(session.client, {
      t: 'instance:changed',
      data: { instanceId, stationRoomId: session.stationRoomId },
    });
  }

  private handlePresenceUpdate(session: WorldSession, data: unknown): void {
    if (!isRecord(data)) return;
    const update = this.sanitizePresence(data);
    if (!update) {
      this.sendError(session.client, 'Invalid presence update.');
      return;
    }
    const nextFocus =
      update.mode === 'in-ship' && update.ship
        ? update.ship.position
        : update.character?.position ?? update.ship?.position ?? null;
    if (nextFocus) {
      const jumpCheck = this.checkImpossibleJump(session, update.mode, nextFocus);
      if (jumpCheck.rejected) {
        this.logger.warn(
          { playerId: session.playerId, mode: update.mode, speed: jumpCheck.speed },
          'Presence update rejected',
        );
        this.sendError(session.client, 'Presence update rejected.');
        return;
      }
    }

    session.stationRoomId = update.stationRoomId ?? session.stationRoomId;
    session.focusPosition = nextFocus;
    const entity: NetworkEntityState = {
      id: session.playerId,
      playerId: session.playerId,
      displayName: session.displayName,
      instanceId: session.instanceId,
      mode: update.mode,
      character: update.character ?? null,
      ship: update.ship ?? null,
      shipRig: update.shipRig ?? session.entity?.shipRig ?? null,
      stationRoomId: session.stationRoomId,
      shipZoneId: update.shipZoneId ?? null,
      updatedAt: Date.now(),
    };
    session.entity = entity;
    this.entities.set(session.playerId, entity);
  }

  private handlePresenceLeave(session: WorldSession): void {
    const entityInstanceId = session.entity?.instanceId ?? session.instanceId;
    const hadEntity = this.entities.delete(session.playerId);
    session.entity = null;
    session.focusPosition = null;
    if (hadEntity) this.broadcastRemove(session.playerId, entityInstanceId);
  }

  private handleShipRig(session: WorldSession, data: unknown): void {
    const rig = sanitizeShipRig(data);
    if (!rig || !session.entity) return;
    session.entity.shipRig = rig;
    session.entity.updatedAt = Date.now();
  }

  private async handleChat(session: WorldSession, data: unknown): Promise<void> {
    if (!isRecord(data)) return;
    const text = readString(data, 'text')?.trim().slice(0, 240);
    if (!text) return;
    const allowed = await this.redis.rateLimit(`chat:${session.playerId}`, 6, 5);
    if (!allowed) {
      this.logger.debug({ playerId: session.playerId }, 'Chat rate limited');
      this.sendError(session.client, 'You are transmitting too quickly.');
      return;
    }
    const message = {
      id: `${Date.now()}:${session.playerId}`,
      playerId: session.playerId,
      author: session.displayName,
      text,
      instanceId: session.instanceId,
      at: Date.now(),
    };
    for (const target of this.sessions.values()) {
      if (target.instanceId === session.instanceId) {
        this.send(target.client, { t: 'chat:message', data: message });
      }
    }
  }

  private sanitizePresence(data: Record<string, unknown>): ClientPresenceUpdate | null {
    const mode = readString(data, 'mode');
    if (!mode) return null;
    const characterBody = sanitizeBody(data.character);
    const shipBody = sanitizeBody(data.ship);
    const character =
      characterBody && isRecord(data.character)
        ? {
            ...characterBody,
            animation:
              typeof data.character.animation === 'string' ? data.character.animation : 'Idle_Loop',
          }
        : null;
    const ship =
      shipBody && isRecord(data.ship)
        ? {
            ...shipBody,
            grounded: typeof data.ship.grounded === 'boolean' ? data.ship.grounded : undefined,
            velocity: isVec3(data.ship.velocity) ? data.ship.velocity : undefined,
            shipId:
              typeof data.ship.shipId === 'string' ? data.ship.shipId.slice(0, 64) : undefined,
            prefabId:
              typeof data.ship.prefabId === 'string'
                ? data.ship.prefabId.slice(0, 64)
                : undefined,
            hp:
              typeof data.ship.hp === 'number' && Number.isFinite(data.ship.hp)
                ? Math.max(0, data.ship.hp)
                : undefined,
            shields:
              typeof data.ship.shields === 'number' && Number.isFinite(data.ship.shields)
                ? Math.max(0, data.ship.shields)
                : undefined,
            maxHp:
              typeof data.ship.maxHp === 'number' && Number.isFinite(data.ship.maxHp)
                ? Math.max(1, data.ship.maxHp)
                : undefined,
            maxShields:
              typeof data.ship.maxShields === 'number' && Number.isFinite(data.ship.maxShields)
                ? Math.max(0, data.ship.maxShields)
                : undefined,
          }
        : null;
    if (!character && !ship) return null;
    return {
      mode,
      character,
      ship,
      shipRig: sanitizeShipRig(data.shipRig),
      stationRoomId: readNullableString(data, 'stationRoomId'),
      shipZoneId: readNullableString(data, 'shipZoneId'),
    };
  }

  private checkImpossibleJump(
    session: WorldSession,
    mode: string,
    nextFocus: Vec3Dto,
  ): { rejected: boolean; speed?: number } {
    if (!session.entity) return { rejected: false };
    const previous = entityFocusPosition(session.entity);
    if (!previous) return { rejected: false };
    const elapsedSeconds = Math.max(0.05, (Date.now() - session.entity.updatedAt) / 1000);
    const speed = distance(previous, nextFocus) / elapsedSeconds;
    const maxSpeed = mode === 'in-ship' ? 200_000 : 120;
    return { rejected: speed > maxSpeed, speed };
  }

  private async persistPlayerLocation(session: WorldSession): Promise<void> {
    await this.prisma.player.update({
      where: { id: session.playerId },
      data: {
        currentInstanceId: session.instanceId,
        currentRoomId: session.stationRoomId ?? 'hab-room',
      },
    });
  }

  private broadcastRemove(playerId: string, instanceId: string): void {
    for (const session of this.sessions.values()) {
      if (session.instanceId === instanceId) {
        this.send(session.client, { t: 'entity:remove', data: { id: playerId, playerId } });
      }
    }
  }

  private sendError(client: WebSocket, message: string): void {
    this.send(client, { t: 'world:error', data: { message } });
  }

  private send(client: WebSocket, envelope: ServerEnvelope): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify(envelope));
  }
}
