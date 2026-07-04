import type { GameBootstrap } from './api';
import { worldSocketUrl } from './api';
import type { WorldState } from '../player/world_state';
import { getActiveShip, getActiveShipBody, getActiveShipRig } from '../player/world_state';
import { MODE_IN_SHIP } from '../player/modes';
import type { CharacterRenderState, FlightBody, NetworkLod, NetworkRenderEntity, NetworkShipRig, Vec3 } from '../types';

export interface NetworkChatMessage {
  id: string;
  playerId: string;
  author: string;
  text: string;
  instanceId: string;
  at: number;
}

interface ServerEnvelope {
  t: string;
  data?: unknown;
}

interface SnapshotEntityWire {
  id: string;
  playerId: string;
  displayName: string;
  lod: NetworkLod;
  mode: string;
  character?: CharacterRenderState | null;
  ship?: FlightBody | null;
  shipRig?: NetworkShipRig | null;
  markerPosition: Vec3;
  stationRoomId?: string | null;
  shipZoneId?: string | null;
}

interface SnapshotWire {
  now: number;
  entities: SnapshotEntityWire[];
}

interface EntitySample {
  at: number;
  entity: NetworkRenderEntity;
}

export interface WorldClientOptions {
  bootstrap: GameBootstrap;
  onChatMessage?: (message: NetworkChatMessage) => void;
  onStatus?: (status: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRenderEntity(wire: SnapshotEntityWire): NetworkRenderEntity {
  return {
    id: wire.id,
    playerId: wire.playerId,
    displayName: wire.displayName,
    lod: wire.lod,
    mode: wire.mode,
    character: wire.character ?? null,
    ship: wire.ship ?? null,
    shipRig: wire.shipRig ?? null,
    markerPosition: wire.markerPosition,
    stationRoomId: wire.stationRoomId ?? null,
    shipZoneId: wire.shipZoneId ?? null,
  };
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerpNumber(a.x, b.x, t),
    y: lerpNumber(a.y, b.y, t),
    z: lerpNumber(a.z, b.z, t),
  };
}

function interpolateBody<T extends CharacterRenderState | FlightBody>(a: T, b: T, t: number): T {
  return {
    ...b,
    position: lerpVec(a.position, b.position, t),
    forward: lerpVec(a.forward, b.forward, t),
    up: lerpVec(a.up, b.up, t),
  };
}

class RemoteEntityStore {
  private readonly samples = new Map<string, EntitySample[]>();

  applySnapshot(snapshot: SnapshotWire, receivedAt: number): void {
    const liveIds = new Set<string>();
    for (const wire of snapshot.entities) {
      liveIds.add(wire.id);
      const next = toRenderEntity(wire);
      const list = this.samples.get(wire.id) ?? [];
      list.push({ at: receivedAt, entity: next });
      while (list.length > 3) list.shift();
      this.samples.set(wire.id, list);
    }
    if (snapshot.entities.length === 0) return;
    for (const id of this.samples.keys()) {
      if (!liveIds.has(id)) continue;
      const list = this.samples.get(id);
      if (list && receivedAt - list[list.length - 1].at > 15_000) this.samples.delete(id);
    }
  }

  remove(id: string): void {
    this.samples.delete(id);
  }

  entities(nowMs: number): NetworkRenderEntity[] {
    const renderAt = nowMs - 100;
    const out: NetworkRenderEntity[] = [];
    for (const [id, list] of this.samples) {
      if (list.length === 0) continue;
      if (nowMs - list[list.length - 1].at > 15_000) {
        this.samples.delete(id);
        continue;
      }
      const previous = [...list].reverse().find((sample) => sample.at <= renderAt) ?? list[0];
      const next = list.find((sample) => sample.at >= renderAt) ?? list[list.length - 1];
      if (previous === next || next.at === previous.at) {
        out.push(next.entity);
        continue;
      }
      const t = Math.max(0, Math.min(1, (renderAt - previous.at) / (next.at - previous.at)));
      out.push({
        ...next.entity,
        markerPosition: lerpVec(previous.entity.markerPosition, next.entity.markerPosition, t),
        character:
          previous.entity.character && next.entity.character
            ? interpolateBody(previous.entity.character, next.entity.character, t)
            : next.entity.character,
        ship:
          previous.entity.ship && next.entity.ship
            ? interpolateBody(previous.entity.ship, next.entity.ship, t)
            : next.entity.ship,
      });
    }
    return out;
  }
}

export interface WorldClient {
  close: () => void;
  connect: () => Promise<void>;
  getRemoteEntities: (nowMs: number) => NetworkRenderEntity[];
  join: (instanceId: string, stationRoomId?: string | null) => void;
  publishPresence: (world: WorldState) => void;
  sendChat: (text: string) => void;
  transition: (instanceId: string, stationRoomId?: string | null) => void;
}

export function createWorldClient(options: WorldClientOptions): WorldClient {
  const store = new RemoteEntityStore();
  let socket: WebSocket | null = null;
  let lastPresenceAt = 0;

  function send(t: string, data?: unknown): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ t, data }));
  }

  function handleMessage(event: MessageEvent<string>): void {
    let envelope: ServerEnvelope;
    try {
      envelope = JSON.parse(event.data) as ServerEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope.t !== 'string') return;
    switch (envelope.t) {
      case 'world:ready':
        options.onStatus?.('Connected to Stanton relay.');
        break;
      case 'world:snapshot':
        if (isRecord(envelope.data) && Array.isArray(envelope.data.entities)) {
          store.applySnapshot(envelope.data as unknown as SnapshotWire, performance.now());
        }
        break;
      case 'entity:remove':
        if (isRecord(envelope.data) && typeof envelope.data.id === 'string') {
          store.remove(envelope.data.id);
        }
        break;
      case 'chat:message':
        if (isRecord(envelope.data)) {
          options.onChatMessage?.(envelope.data as unknown as NetworkChatMessage);
        }
        break;
      case 'world:error':
        if (isRecord(envelope.data) && typeof envelope.data.message === 'string') {
          options.onStatus?.(envelope.data.message);
        }
        break;
      default:
        break;
    }
  }

  return {
    close() {
      socket?.close();
      socket = null;
    },
    connect() {
      return new Promise<void>((resolve, reject) => {
        socket = new WebSocket(worldSocketUrl());
        socket.addEventListener('message', handleMessage);
        socket.addEventListener('open', () => {
          send('world:join', {
            instanceId: options.bootstrap.spawn.instanceId,
            stationRoomId: options.bootstrap.spawn.stationRoomId,
          });
          resolve();
        });
        socket.addEventListener('close', () => options.onStatus?.('Disconnected from relay.'));
        socket.addEventListener('error', () => reject(new Error('World WebSocket failed to connect.')), {
          once: true,
        });
      });
    },
    getRemoteEntities(nowMs: number) {
      return store.entities(nowMs);
    },
    join(instanceId: string, stationRoomId?: string | null) {
      send('world:join', { instanceId, stationRoomId: stationRoomId ?? null });
    },
    publishPresence(world: WorldState) {
      const now = performance.now();
      if (now - lastPresenceAt < 50) return;
      lastPresenceAt = now;
      send('presence:update', {
        mode: world.mode,
        character:
          world.mode === MODE_IN_SHIP
            ? null
            : {
                animation: world.character.animation,
                forward: world.character.forward,
                position: world.character.position,
                up: world.character.up,
              },
        ship: {
          ...getActiveShipBody(world),
          shipId: world.activeShipId,
          prefabId: getActiveShip(world).prefabId,
          hp: getActiveShip(world).vitals.hp,
          shields: getActiveShip(world).vitals.shields,
          maxHp: getActiveShip(world).spec.maxHp,
          maxShields: getActiveShip(world).spec.maxShields,
        },
        shipRig: {
          gear01: getActiveShipRig(world).gear01,
          ramp01: getActiveShipRig(world).ramp01,
          doors: Object.fromEntries(
            Object.entries(getActiveShipRig(world).doors).map(([id, door]) => [
              id,
              door.open01,
            ]),
          ),
        },
        stationRoomId: world.character.stationRoomId ?? null,
        shipZoneId: world.character.deckZone ?? null,
      });
    },
    sendChat(text: string) {
      send('chat:send', { text });
    },
    transition(instanceId: string, stationRoomId?: string | null) {
      send('instance:transition', { instanceId, stationRoomId: stationRoomId ?? null });
    },
  };
}
