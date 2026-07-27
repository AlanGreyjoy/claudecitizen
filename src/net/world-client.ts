import { createWorldSession, type GameBootstrap } from './api';
import type { WorldState } from '../player/world-state';
import { getActiveShip, getActiveShipBody, getActiveShipRig } from '../player/world-state';
import { getShipInstance } from '../flight/ship-world';
import { MODE_IN_SHIP } from '../player/modes';
import type {
  CharacterRenderState,
  NetworkRenderEntity,
  NetworkShipBody,
  Vec3,
} from '../types';
import { loadPredictionEngine, type PredictionEngine, type PredictionFrame } from './prediction-wasm';
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
  type EntityProfileMessage,
  type SnapshotEntityMessage,
  type SnapshotMessage,
} from './world-protocol';

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

function toRenderEntity(
  wire: SnapshotEntityMessage,
  profile: EntityProfileMessage,
): NetworkRenderEntity {
  return {
    id: profile.id,
    playerId: profile.playerId,
    displayName: profile.displayName,
    // Appearance arrives once, with the profile, and is stable for the life of
    // the handle — including at marker range, where the body is not sent at all.
    characterAppearance: profile.characterAppearance,
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

/**
 * Mirrors the server's per-connection replication state.
 *
 * Entities are keyed by the handle the edge assigned, identity comes from the
 * profile sent when that handle entered the interest set, and state arrives
 * only when it changed. An entity that stops moving simply stops being
 * mentioned, so nothing here may expire an entity on silence — lifecycle is
 * driven exclusively by `removedHandles` and `baseline`, both of which arrive
 * on the reliable stream and therefore cannot be lost.
 */
class RemoteEntityStore {
  private readonly profiles = new Map<number, EntityProfileMessage>();
  private readonly samples = new Map<number, EntitySample[]>();

  applySnapshot(snapshot: SnapshotMessage, receivedAt: number): void {
    for (const profile of snapshot.profiles) this.profiles.set(profile.handle, profile);
    for (const handle of snapshot.removedHandles) {
      this.profiles.delete(handle);
      this.samples.delete(handle);
    }
    for (const wire of snapshot.entities) {
      const profile = this.profiles.get(wire.handle);
      // A handle with no profile means the introducing frame was lost. It
      // cannot be rendered — and guessing an identity is how a player ends up
      // wearing someone else's face — so wait for the next baseline.
      if (!profile) continue;
      const list = this.samples.get(wire.handle) ?? [];
      list.push({ at: receivedAt, entity: toRenderEntity(wire, profile) });
      while (list.length > 3) list.shift();
      this.samples.set(wire.handle, list);
    }
    if (snapshot.baseline) {
      const live = new Set(snapshot.entities.map((wire) => wire.handle));
      for (const handle of [...this.samples.keys()]) {
        if (!live.has(handle)) this.samples.delete(handle);
      }
      for (const handle of [...this.profiles.keys()]) {
        if (!live.has(handle)) this.profiles.delete(handle);
      }
    }
  }

  clear(): void {
    this.samples.clear();
    this.profiles.clear();
  }

  entities(nowMs: number): NetworkRenderEntity[] {
    const renderAt = nowMs - 100;
    const out: NetworkRenderEntity[] = [];
    for (const list of this.samples.values()) {
      if (list.length === 0) continue;
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

interface WorldClientState {
  options: WorldClientOptions;
  store: RemoteEntityStore;
  transport: WebTransport | null;
  controlWriter: WritableStreamDefaultWriter<Uint8Array> | null;
  datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null;
  prediction: PredictionEngine | null;
  predictionFrame: PredictionFrame | null;
  previousCharacterPosition: Vec3 | null;
  pendingPredictions: PendingPrediction[];
  predictionKind: 'character' | 'ship' | null;
  lastAcceptedSequence: number;
  reconcileEpochByCell: Map<string, number>;
  lastPresenceAt: number;
  sequence: number;
  leftPresence: boolean;
}

function sendReliable(state: WorldClientState, payload: Uint8Array): void {
  if (!state.controlWriter) return;
  void state.controlWriter.write(streamFrame(payload)).catch(() => undefined);
}

function sendDatagram(state: WorldClientState, payload: Uint8Array): void {
  if (!state.datagramWriter) return;
  void state.datagramWriter.write(payload).catch(() => undefined);
}

function leavePresence(state: WorldClientState): void {
  if (state.leftPresence) return;
  state.leftPresence = true;
  sendReliable(state, encodeLeave());
}

function ensurePredictionKind(state: WorldClientState, nextPredictionKind: 'character' | 'ship'): void {
  if (state.predictionKind === nextPredictionKind) return;
  state.predictionKind = nextPredictionKind;
  state.predictionFrame = null;
  state.pendingPredictions = [];
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
    canopy01: rig.canopy01,
    doors: Object.fromEntries(
      Object.entries(rig.doors).map(([id, door]) => [id, door.open01]),
    ),
  };
}

function handleReconcile(
  state: WorldClientState,
  message: Extract<ReturnType<typeof decodeServerWorldMessage>, { kind: 'reconcile' }>,
): void {
  if (message.playerId !== state.options.bootstrap.player.id) return;
  const currentEpoch = state.reconcileEpochByCell.get(message.cellId) ?? 0;
  if (message.epoch < currentEpoch || message.acceptedSequence < state.lastAcceptedSequence) return;
  state.reconcileEpochByCell.set(message.cellId, message.epoch);
  state.lastAcceptedSequence = message.acceptedSequence;
  const body = message.ship ?? message.character;
  if (!body || !state.prediction) return;
  let replayed: PredictionFrame = {
    position: { ...body.position },
    velocity: { ...body.velocity },
  };
  state.pendingPredictions = state.pendingPredictions.filter(
    (input) => input.sequence > message.acceptedSequence,
  );
  for (const input of state.pendingPredictions) {
    replayed = state.prediction.advance(
      replayed.position,
      replayed.velocity,
      input.desiredVelocity,
      input.profile,
    );
  }
  state.predictionFrame = replayed;
}

function handlePayload(state: WorldClientState, payload: Uint8Array): void {
  const message = decodeServerWorldMessage(payload);
  switch (message.kind) {
    case 'ready':
      if (message.simulationVersion !== WORLD_SIMULATION_VERSION) {
        throw new Error(
          `Simulation version mismatch (server ${message.simulationVersion}, client ${WORLD_SIMULATION_VERSION}).`,
        );
      }
      state.options.onStatus?.('Connected to authoritative Stanton simulation.');
      break;
    case 'snapshot':
      state.store.applySnapshot(message.snapshot, performance.now());
      break;
    case 'reconcile':
      handleReconcile(state, message);
      break;
    case 'chat-message':
      state.options.onChatMessage?.(message.message);
      break;
    case 'error':
      state.options.onStatus?.(message.message);
      break;
    case 'pong':
      break;
  }
}

async function readControl(state: WorldClientState, readable: ReadableStream<Uint8Array>): Promise<void> {
  const reader = readable.getReader();
  let pending: Uint8Array = new Uint8Array();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      pending = concatBytes(pending, result.value);
      const parsed = readStreamFrames(pending);
      pending = parsed.remaining;
      for (const frame of parsed.frames) handlePayload(state, frame);
    }
  } finally {
    reader.releaseLock();
  }
}

async function readDatagrams(state: WorldClientState, readable: ReadableStream<Uint8Array>): Promise<void> {
  const reader = readable.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      handlePayload(state, result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function closeClient(state: WorldClientState): void {
  leavePresence(state);
  state.controlWriter?.releaseLock();
  state.datagramWriter?.releaseLock();
  state.controlWriter = null;
  state.datagramWriter = null;
  state.transport?.close({ closeCode: 0, reason: 'client closed' });
  state.transport = null;
}

async function connectClient(state: WorldClientState): Promise<void> {
  const { options } = state;
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
  state.prediction = predictor;
  state.pendingPredictions = [];
  state.predictionFrame = null;
  state.predictionKind = null;
  state.lastAcceptedSequence = 0;
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
  const transport = new WebTransport(sessionUrl.toString(), {
    ...(certificateHashes ? { serverCertificateHashes: certificateHashes } : {}),
  });
  state.transport = transport;
  await transport.ready;
  const control = await transport.createBidirectionalStream();
  state.controlWriter = control.writable.getWriter();
  state.datagramWriter = transport.datagrams.writable.getWriter();
  state.leftPresence = false;
  void readControl(state, control.readable).catch((error: unknown) => {
    options.onStatus?.(error instanceof Error ? error.message : 'World control stream failed.');
  });
  void readDatagrams(state, transport.datagrams.readable).catch((error: unknown) => {
    options.onStatus?.(error instanceof Error ? error.message : 'World datagram stream failed.');
  });
  void transport.closed.then(
    () => options.onStatus?.('Disconnected from authoritative simulation.'),
    () => options.onStatus?.('Authoritative simulation connection failed.'),
  );
  sendReliable(
    state,
    encodeJoin(options.bootstrap.spawn.instanceId, options.bootstrap.spawn.stationRoomId),
  );
}

function publishPresence(state: WorldClientState, world: WorldState): void {
  if (state.leftPresence || !state.prediction) return;
  const now = performance.now();
  if (now - state.lastPresenceAt < 33) return;
  const dtSeconds = Math.max(1 / 120, Math.min(0.1, (now - state.lastPresenceAt) / 1000 || 1 / 30));
  state.lastPresenceAt = now;
  state.sequence += 1;
  const shipInstance = getShipInstance(world.activeShipId);
  const activeShipBody = shipInstance ? getActiveShipBody(world) : null;
  const nextPredictionKind = activeShipBody ? 'ship' : 'character';
  ensurePredictionKind(state, nextPredictionKind);
  const rawPosition = activeShipBody?.position ?? world.character.position;
  const desiredVelocity = activeShipBody?.velocity ?? characterVelocity(
    state.previousCharacterPosition,
    world.character.position,
    dtSeconds,
  );
  state.previousCharacterPosition = { ...world.character.position };
  const current = state.predictionFrame ?? {
    position: { ...rawPosition },
    velocity: { ...desiredVelocity },
  };
  const predicted = state.prediction.advance(
    current.position,
    current.velocity,
    desiredVelocity,
    nextPredictionKind,
  );
  state.predictionFrame = predicted;
  state.pendingPredictions.push({
    sequence: state.sequence,
    desiredVelocity: { ...desiredVelocity },
    profile: nextPredictionKind,
  });
  if (state.pendingPredictions.length > 240) state.pendingPredictions.shift();
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
    state,
    encodePresenceIntent({
      sequence: state.sequence,
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
}

function transitionClient(
  state: WorldClientState,
  instanceId: string,
  stationRoomId?: string | null,
): void {
  state.predictionFrame = null;
  state.pendingPredictions = [];
  state.predictionKind = null;
  state.store.clear();
  sendReliable(state, encodeTransition(instanceId, stationRoomId ?? null));
}

export function createWorldClient(options: WorldClientOptions): WorldClient {
  const state: WorldClientState = {
    options,
    store: new RemoteEntityStore(),
    transport: null,
    controlWriter: null,
    datagramWriter: null,
    prediction: null,
    predictionFrame: null,
    previousCharacterPosition: null,
    pendingPredictions: [],
    predictionKind: null,
    lastAcceptedSequence: 0,
    reconcileEpochByCell: new Map<string, number>(),
    lastPresenceAt: 0,
    sequence: 0,
    leftPresence: false,
  };

  return {
    close: () => closeClient(state),
    connect: () => connectClient(state),
    getRemoteEntities: (nowMs: number) => state.store.entities(nowMs),
    join(instanceId: string, stationRoomId?: string | null) {
      state.store.clear();
      sendReliable(state, encodeJoin(instanceId, stationRoomId ?? null));
    },
    leave() {
      state.store.clear();
      leavePresence(state);
    },
    publishPresence: (world: WorldState) => publishPresence(state, world),
    sendChat: (text: string) => sendReliable(state, encodeChat(text)),
    transition: (instanceId: string, stationRoomId?: string | null) =>
      transitionClient(state, instanceId, stationRoomId),
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
