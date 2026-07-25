import { createWorldSession, type GameBootstrap } from './api';
import type { WorldState } from '../player/world_state';
import { getActiveShip, getActiveShipBody, getActiveShipRig } from '../player/world_state';
import { getShipInstance } from '../flight/ship_world';
import { MODE_IN_SHIP } from '../player/modes';
import type {
  CharacterRenderState,
  NetworkRenderEntity,
  NetworkShipBody,
  Vec3,
} from '../types';
import { resolveSnapshotCharacterAppearance } from './remote_appearance';
import { loadPredictionEngine, type PredictionEngine, type PredictionFrame } from './prediction_wasm';
import {
  WORLD_PROTOCOL_VERSION,
  WORLD_SIMULATION_VERSION,
  decodeServerWorldMessage,
  encodeChat,
  encodeJoin,
  encodeLeave,
  encodePresenceIntent,
  encodeTransition,
  readStreamFrames,
  streamFrame,
  type SnapshotEntityMessage,
  type SnapshotMessage,
} from './world_protocol';

export interface NetworkChatMessage {
  id: string;
  playerId: string;
  author: string;
  text: string;
  instanceId: string;
  at: number;
}

interface EntitySample {
  at: number;
  entity: NetworkRenderEntity;
}

interface PendingPrediction {
  sequence: number;
  desiredVelocity: Vec3;
  profile: 'character' | 'ship';
}

export interface WorldClientOptions {
  bootstrap: GameBootstrap;
  onChatMessage?: (message: NetworkChatMessage) => void;
  onStatus?: (status: string) => void;
}

function toRenderEntity(wire: SnapshotEntityMessage): NetworkRenderEntity {
  return {
    id: wire.id,
    playerId: wire.playerId,
    displayName: wire.displayName,
    characterAppearance: wire.characterAppearance ?? null,
    lod: wire.lod,
    mode: wire.mode,
    character: wire.character,
    ship: wire.ship,
    shipRig: wire.shipRig,
    markerPosition: wire.markerPosition,
    stationRoomId: wire.stationRoomId,
    shipZoneId: wire.shipZoneId,
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

function interpolateBody<T extends CharacterRenderState | NetworkShipBody>(a: T, b: T, t: number): T {
  return {
    ...b,
    position: lerpVec(a.position, b.position, t),
    forward: lerpVec(a.forward, b.forward, t),
    up: lerpVec(a.up, b.up, t),
  };
}

class RemoteEntityStore {
  private readonly samples = new Map<string, EntitySample[]>();
  private epochByCell = new Map<string, number>();

  applySnapshot(snapshot: SnapshotMessage, receivedAt: number): void {
    const previousEpoch = this.epochByCell.get(snapshot.cellId) ?? 0;
    if (snapshot.epoch < previousEpoch) return;
    if (snapshot.epoch > previousEpoch) {
      this.epochByCell.set(snapshot.cellId, snapshot.epoch);
    }
    const liveIds = new Set<string>();
    for (const wire of snapshot.entities) {
      liveIds.add(wire.id);
      const list = this.samples.get(wire.id) ?? [];
      const next = toRenderEntity(wire);
      next.characterAppearance = resolveSnapshotCharacterAppearance(
        wire.lod,
        wire.characterAppearance,
        list[list.length - 1]?.entity.characterAppearance ?? null,
      );
      list.push({ at: receivedAt, entity: next });
      while (list.length > 3) list.shift();
      this.samples.set(wire.id, list);
    }
    for (const id of this.samples.keys()) {
      if (liveIds.has(id)) continue;
      const list = this.samples.get(id);
      if (list && receivedAt - list[list.length - 1]!.at > 15_000) this.samples.delete(id);
    }
  }

  remove(id: string): void {
    this.samples.delete(id);
  }

  clear(): void {
    this.samples.clear();
    this.epochByCell.clear();
  }

  entities(nowMs: number): NetworkRenderEntity[] {
    const renderAt = nowMs - 100;
    const out: NetworkRenderEntity[] = [];
    for (const [id, list] of this.samples) {
      if (list.length === 0) continue;
      if (nowMs - list[list.length - 1]!.at > 15_000) {
        this.samples.delete(id);
        continue;
      }
      const previous = [...list].reverse().find((sample) => sample.at <= renderAt) ?? list[0]!;
      const next = list.find((sample) => sample.at >= renderAt) ?? list[list.length - 1]!;
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
  leave: () => void;
  publishPresence: (world: WorldState) => void;
  sendChat: (text: string) => void;
  transition: (instanceId: string, stationRoomId?: string | null) => void;
}

export function createWorldClient(options: WorldClientOptions): WorldClient {
  const store = new RemoteEntityStore();
  let transport: WebTransport | null = null;
  let controlWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let prediction: PredictionEngine | null = null;
  let predictionFrame: PredictionFrame | null = null;
  let previousCharacterPosition: Vec3 | null = null;
  let pendingPredictions: PendingPrediction[] = [];
  let predictionKind: 'character' | 'ship' | null = null;
  let lastAcceptedSequence = 0;
  const reconcileEpochByCell = new Map<string, number>();
  let lastPresenceAt = 0;
  let sequence = 0;
  let leftPresence = false;

  function sendReliable(payload: Uint8Array): void {
    if (!controlWriter) return;
    void controlWriter.write(streamFrame(payload)).catch(() => undefined);
  }

  function sendDatagram(payload: Uint8Array): void {
    if (!datagramWriter) return;
    void datagramWriter.write(payload).catch(() => undefined);
  }

  function leavePresence(): void {
    if (leftPresence) return;
    leftPresence = true;
    sendReliable(encodeLeave());
  }

  function ensurePredictionKind(nextPredictionKind: 'character' | 'ship'): void {
    if (predictionKind === nextPredictionKind) return;
    predictionKind = nextPredictionKind;
    predictionFrame = null;
    pendingPredictions = [];
  }

  function buildPresenceShipPayload(
    world: WorldState,
    activeShipBody: NonNullable<ReturnType<typeof getActiveShipBody>>,
    predicted: PredictionFrame,
  ) {
    const activeShip = getActiveShip(world);
    return {
      ...activeShipBody,
      position: predicted.position,
      velocity: predicted.velocity,
      shipId: world.activeShipId,
      prefabId: activeShip.prefabId,
      hp: activeShip.vitals.hp,
      shields: activeShip.vitals.shields,
      maxHp: activeShip.spec.maxHp,
      maxShields: activeShip.spec.maxShields,
    };
  }

  function buildPresenceShipRig(world: WorldState) {
    const rig = getActiveShipRig(world);
    return {
      gear01: rig.gear01,
      ramp01: rig.ramp01,
      doors: Object.fromEntries(
        Object.entries(rig.doors).map(([id, door]) => [id, door.open01]),
      ),
    };
  }

  function handlePayload(payload: Uint8Array): void {
    const message = decodeServerWorldMessage(payload);
    switch (message.kind) {
      case 'ready':
        if (message.simulationVersion !== WORLD_SIMULATION_VERSION) {
          throw new Error(
            `Simulation version mismatch (server ${message.simulationVersion}, client ${WORLD_SIMULATION_VERSION}).`,
          );
        }
        options.onStatus?.('Connected to authoritative Stanton simulation.');
        break;
      case 'snapshot':
        store.applySnapshot(message.snapshot, performance.now());
        break;
      case 'reconcile': {
        if (message.playerId !== options.bootstrap.player.id) break;
        const currentEpoch = reconcileEpochByCell.get(message.cellId) ?? 0;
        if (message.epoch < currentEpoch || message.acceptedSequence < lastAcceptedSequence) break;
        reconcileEpochByCell.set(message.cellId, message.epoch);
        lastAcceptedSequence = message.acceptedSequence;
        const body = message.ship ?? message.character;
        if (body && prediction) {
          let replayed: PredictionFrame = {
            position: { ...body.position },
            velocity: { ...body.velocity },
          };
          pendingPredictions = pendingPredictions.filter(
            (input) => input.sequence > message.acceptedSequence,
          );
          for (const input of pendingPredictions) {
            replayed = prediction.advance(
              replayed.position,
              replayed.velocity,
              input.desiredVelocity,
              input.profile,
            );
          }
          predictionFrame = replayed;
        }
        break;
      }
      case 'entity-remove':
        store.remove(message.id);
        break;
      case 'chat-message':
        options.onChatMessage?.(message.message);
        break;
      case 'error':
        options.onStatus?.(message.message);
        break;
      case 'pong':
        break;
    }
  }

  async function readControl(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    let pending: Uint8Array = new Uint8Array();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        pending = concatBytes(pending, result.value);
        const parsed = readStreamFrames(pending);
        pending = parsed.remaining;
        for (const frame of parsed.frames) handlePayload(frame);
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function readDatagrams(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        handlePayload(result.value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  return {
    close() {
      leavePresence();
      controlWriter?.releaseLock();
      datagramWriter?.releaseLock();
      controlWriter = null;
      datagramWriter = null;
      transport?.close({ closeCode: 0, reason: 'client closed' });
      transport = null;
    },
    async connect() {
      if (typeof WebTransport === 'undefined') {
        throw new Error('This browser does not support the required WebTransport API.');
      }
      const [session, predictor] = await Promise.all([createWorldSession(), loadPredictionEngine()]);
      if (session.protocolVersion !== WORLD_PROTOCOL_VERSION) {
        throw new Error(
          `World protocol mismatch (server ${session.protocolVersion}, client ${WORLD_PROTOCOL_VERSION}).`,
        );
      }
      if (session.simulationVersion !== WORLD_SIMULATION_VERSION) {
        throw new Error(
          `Simulation version mismatch (server ${session.simulationVersion}, client ${WORLD_SIMULATION_VERSION}).`,
        );
      }
      prediction = predictor;
      pendingPredictions = [];
      predictionFrame = null;
      predictionKind = null;
      lastAcceptedSequence = 0;
      const sessionUrl = new URL(session.url);
      sessionUrl.searchParams.set('ticket', session.ticket);
      const certificateHashes = session.certificateHashBase64
        ? [
            {
              algorithm: 'sha-256',
              value: base64Bytes(session.certificateHashBase64),
            },
          ]
        : undefined;
      transport = new WebTransport(sessionUrl.toString(), {
        ...(certificateHashes ? { serverCertificateHashes: certificateHashes } : {}),
      });
      await transport.ready;
      const control = await transport.createBidirectionalStream();
      controlWriter = control.writable.getWriter();
      datagramWriter = transport.datagrams.writable.getWriter();
      leftPresence = false;
      void readControl(control.readable).catch((error: unknown) => {
        options.onStatus?.(error instanceof Error ? error.message : 'World control stream failed.');
      });
      void readDatagrams(transport!.datagrams.readable).catch((error: unknown) => {
        options.onStatus?.(error instanceof Error ? error.message : 'World datagram stream failed.');
      });
      void transport.closed.then(
        () => options.onStatus?.('Disconnected from authoritative simulation.'),
        () => options.onStatus?.('Authoritative simulation connection failed.'),
      );
      sendReliable(
        encodeJoin(options.bootstrap.spawn.instanceId, options.bootstrap.spawn.stationRoomId),
      );
    },
    getRemoteEntities(nowMs: number) {
      return store.entities(nowMs);
    },
    join(instanceId: string, stationRoomId?: string | null) {
      store.clear();
      sendReliable(encodeJoin(instanceId, stationRoomId ?? null));
    },
    leave() {
      store.clear();
      leavePresence();
    },
    publishPresence(world: WorldState) {
      if (leftPresence || !prediction) return;
      const now = performance.now();
      if (now - lastPresenceAt < 33) return;
      const dtSeconds = Math.max(1 / 120, Math.min(0.1, (now - lastPresenceAt) / 1000 || 1 / 30));
      lastPresenceAt = now;
      sequence += 1;
      const shipInstance = getShipInstance(world.activeShipId);
      const activeShipBody = shipInstance ? getActiveShipBody(world) : null;
      const nextPredictionKind = activeShipBody ? 'ship' : 'character';
      ensurePredictionKind(nextPredictionKind);
      const rawPosition = activeShipBody?.position ?? world.character.position;
      const desiredVelocity = activeShipBody?.velocity ?? characterVelocity(
        previousCharacterPosition,
        world.character.position,
        dtSeconds,
      );
      previousCharacterPosition = { ...world.character.position };
      const current = predictionFrame ?? { position: { ...rawPosition }, velocity: { ...desiredVelocity } };
      const predicted = prediction.advance(
        current.position,
        current.velocity,
        desiredVelocity,
        nextPredictionKind,
      );
      predictionFrame = predicted;
      pendingPredictions.push({
        sequence,
        desiredVelocity: { ...desiredVelocity },
        profile: nextPredictionKind,
      });
      if (pendingPredictions.length > 240) pendingPredictions.shift();
      const character =
        world.mode === MODE_IN_SHIP
          ? null
          : {
              animation: world.character.animation,
              upperBodyAnimation: world.character.upperBodyAnimation ?? null,
              forward: world.character.forward,
              position: predicted.position,
              up: world.character.up,
            };
      const ship = shipInstance && activeShipBody
        ? buildPresenceShipPayload(world, activeShipBody, predicted)
        : null;
      sendDatagram(
        encodePresenceIntent({
          sequence,
          mode: world.mode,
          character,
          ship,
          shipRig: shipInstance ? buildPresenceShipRig(world) : null,
          stationRoomId: world.character.stationRoomId ?? null,
          shipZoneId: world.character.deckZone ?? null,
          clientTimeMs: now,
          desiredVelocity,
        }),
      );
    },
    sendChat(text: string) {
      sendReliable(encodeChat(text));
    },
    transition(instanceId: string, stationRoomId?: string | null) {
      predictionFrame = null;
      pendingPredictions = [];
      predictionKind = null;
      store.clear();
      sendReliable(encodeTransition(instanceId, stationRoomId ?? null));
    },
  };
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const value = new Uint8Array(left.length + right.length);
  value.set(left);
  value.set(right, left.length);
  return value;
}

function characterVelocity(previous: Vec3 | null, current: Vec3, dtSeconds: number): Vec3 {
  if (!previous) return { x: 0, y: 0, z: 0 };
  return {
    x: (current.x - previous.x) / dtSeconds,
    y: (current.y - previous.y) / dtSeconds,
    z: (current.z - previous.z) / dtSeconds,
  };
}
