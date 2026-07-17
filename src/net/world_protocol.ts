import type {
  CharacterRenderState,
  NetworkLod,
  NetworkShipBody,
  NetworkShipRig,
  Vec3,
} from '../types';
import type { PlayerCharacterAppearanceV1 } from '../player/character_creator/player_character_appearance';

export const WORLD_PROTOCOL_VERSION = 1;
export const WORLD_SIMULATION_VERSION = 1;

export interface PresenceIntentMessage {
  sequence: number;
  mode: string;
  character: CharacterRenderState | null;
  ship: NetworkShipBody | null;
  shipRig: NetworkShipRig | null;
  stationRoomId: string | null;
  shipZoneId: string | null;
  clientTimeMs: number;
  desiredVelocity: Vec3;
}

export interface SnapshotEntityMessage {
  id: string;
  playerId: string;
  displayName: string;
  characterAppearance?: PlayerCharacterAppearanceV1 | null;
  lod: NetworkLod;
  mode: string;
  character: CharacterRenderState | null;
  ship: NetworkShipBody | null;
  shipRig: NetworkShipRig | null;
  markerPosition: Vec3;
  stationRoomId: string | null;
  shipZoneId: string | null;
}

export interface SnapshotMessage {
  now: number;
  tick: number;
  epoch: number;
  cellId: string;
  entities: SnapshotEntityMessage[];
}

export interface ReconcileCharacterBody extends CharacterRenderState {
  velocity: Vec3;
}

export type ServerWorldMessage =
  | { kind: 'ready'; playerId: string; nodeId: string; simulationVersion: number }
  | { kind: 'snapshot'; snapshot: SnapshotMessage }
  | {
      kind: 'reconcile';
      acceptedSequence: number;
      tick: number;
      epoch: number;
      cellId: string;
      playerId: string;
      character: ReconcileCharacterBody | null;
      ship: NetworkShipBody | null;
    }
  | { kind: 'entity-remove'; id: string }
  | {
      kind: 'chat-message';
      message: {
        id: string;
        playerId: string;
        author: string;
        text: string;
        instanceId: string;
        at: number;
      };
    }
  | { kind: 'error'; code: string; message: string; retryable: boolean }
  | { kind: 'pong'; nonce: number; clientTimeMs: number; serverTimeMs: number };

class ProtoWriter {
  private readonly output: number[] = [];

  finish(): Uint8Array {
    return Uint8Array.from(this.output);
  }

  uintField(field: number, value: number): void {
    if (value === 0) return;
    this.tag(field, 0);
    this.varint(value);
  }

  boolField(field: number, value: boolean): void {
    if (!value) return;
    this.tag(field, 0);
    this.varint(1);
  }

  doubleField(field: number, value: number): void {
    if (value === 0 || !Number.isFinite(value)) return;
    this.tag(field, 1);
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    this.output.push(...bytes);
  }

  stringField(field: number, value: string | null | undefined): void {
    if (!value) return;
    this.bytesField(field, new TextEncoder().encode(value));
  }

  bytesField(field: number, value: Uint8Array): void {
    if (value.length === 0) return;
    this.tag(field, 2);
    this.varint(value.length);
    this.output.push(...value);
  }

  messageField(field: number, write: (writer: ProtoWriter) => void): void {
    const nested = new ProtoWriter();
    write(nested);
    this.bytesField(field, nested.finish());
  }

  private tag(field: number, wire: number): void {
    this.varint(field * 8 + wire);
  }

  private varint(value: number): void {
    let remaining = BigInt(Math.max(0, Math.floor(value)));
    while (remaining >= 0x80n) {
      this.output.push(Number((remaining & 0x7fn) | 0x80n));
      remaining >>= 7n;
    }
    this.output.push(Number(remaining));
  }
}

class ProtoReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly input: Uint8Array) {
    this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  }

  get done(): boolean {
    return this.offset >= this.input.length;
  }

  tag(): { field: number; wire: number } {
    const value = this.uint();
    return { field: Math.floor(value / 8), wire: value % 8 };
  }

  uint(): number {
    let value = 0n;
    let shift = 0n;
    while (this.offset < this.input.length && shift <= 63n) {
      const byte = this.input[this.offset++]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return Number(value);
      shift += 7n;
    }
    throw new Error('Malformed Protobuf varint.');
  }

  bool(): boolean {
    return this.uint() !== 0;
  }

  double(): number {
    this.require(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  bytes(): Uint8Array {
    const length = this.uint();
    this.require(length);
    const value = this.input.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string(): string {
    return new TextDecoder().decode(this.bytes());
  }

  message(): ProtoReader {
    return new ProtoReader(this.bytes());
  }

  skip(wire: number): void {
    if (wire === 0) this.uint();
    else if (wire === 1) this.advance(8);
    else if (wire === 2) this.advance(this.uint());
    else if (wire === 5) this.advance(4);
    else throw new Error(`Unsupported Protobuf wire type ${wire}.`);
  }

  private advance(length: number): void {
    this.require(length);
    this.offset += length;
  }

  private require(length: number): void {
    if (length < 0 || this.offset + length > this.input.length) {
      throw new Error('Truncated Protobuf message.');
    }
  }
}

function writeVec(writer: ProtoWriter, field: number, value: Vec3 | null | undefined): void {
  if (!value) return;
  writer.messageField(field, (nested) => {
    nested.doubleField(1, value.x);
    nested.doubleField(2, value.y);
    nested.doubleField(3, value.z);
  });
}

function writeBody(
  writer: ProtoWriter,
  field: number,
  value: (CharacterRenderState | NetworkShipBody) | null,
): void {
  if (!value) return;
  writer.messageField(field, (nested) => {
    writeVec(nested, 1, value.position);
    writeVec(nested, 2, value.forward);
    writeVec(nested, 3, value.up);
    writeVec(nested, 4, 'velocity' in value ? value.velocity : null);
    nested.stringField(5, 'animation' in value ? value.animation : '');
    nested.boolField(6, 'grounded' in value && value.grounded);
  });
}

function writeShip(writer: ProtoWriter, field: number, value: NetworkShipBody | null): void {
  if (!value) return;
  writer.messageField(field, (nested) => {
    writeBody(nested, 1, value);
    nested.stringField(2, value.shipId);
    nested.stringField(3, value.prefabId);
    nested.doubleField(4, value.hp ?? 0);
    nested.doubleField(5, value.shields ?? 0);
    nested.doubleField(6, value.maxHp ?? 0);
    nested.doubleField(7, value.maxShields ?? 0);
  });
}

function writeShipRig(writer: ProtoWriter, field: number, value: NetworkShipRig | null): void {
  if (!value) return;
  writer.messageField(field, (nested) => {
    nested.doubleField(1, value.gear01);
    nested.doubleField(2, value.ramp01);
    for (const [id, open01] of Object.entries(value.doors)) {
      nested.messageField(3, (entry) => {
        entry.stringField(1, id);
        entry.doubleField(2, open01);
      });
    }
  });
}

function clientEnvelope(field: number, write: (writer: ProtoWriter) => void): Uint8Array {
  const writer = new ProtoWriter();
  writer.uintField(1, WORLD_PROTOCOL_VERSION);
  writer.messageField(field, write);
  return writer.finish();
}

export function encodeJoin(instanceId: string, stationRoomId: string | null): Uint8Array {
  return clientEnvelope(10, (writer) => {
    writer.stringField(1, instanceId);
    writer.stringField(2, stationRoomId);
  });
}

export function encodePresenceIntent(intent: PresenceIntentMessage): Uint8Array {
  return clientEnvelope(11, (writer) => {
    writer.uintField(1, intent.sequence);
    writer.stringField(2, intent.mode);
    writeBody(writer, 3, intent.character);
    writeShip(writer, 4, intent.ship);
    writeShipRig(writer, 5, intent.shipRig);
    writer.stringField(6, intent.stationRoomId);
    writer.stringField(7, intent.shipZoneId);
    writer.doubleField(8, intent.clientTimeMs);
    writeVec(writer, 9, intent.desiredVelocity);
  });
}

export function encodeLeave(): Uint8Array {
  return clientEnvelope(12, () => undefined);
}

export function encodeChat(text: string): Uint8Array {
  return clientEnvelope(13, (writer) => writer.stringField(1, text));
}

export function encodeTransition(instanceId: string, stationRoomId: string | null): Uint8Array {
  return clientEnvelope(14, (writer) => {
    writer.stringField(1, instanceId);
    writer.stringField(2, stationRoomId);
  });
}

export function streamFrame(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + payload.length);
  new DataView(frame.buffer).setUint32(0, payload.length, false);
  frame.set(payload, 4);
  return frame;
}

export function readStreamFrames(pending: Uint8Array): {
  frames: Uint8Array[];
  remaining: Uint8Array;
} {
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (pending.length - offset >= 4) {
    const length = new DataView(
      pending.buffer,
      pending.byteOffset + offset,
      4,
    ).getUint32(0, false);
    if (length > 256 * 1024) throw new Error('World control frame is too large.');
    if (pending.length - offset < 4 + length) break;
    frames.push(pending.slice(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  return { frames, remaining: pending.slice(offset) };
}

export function decodeServerWorldMessage(payload: Uint8Array): ServerWorldMessage {
  const reader = new ProtoReader(payload);
  let protocolVersion = 0;
  let message: ServerWorldMessage | null = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) protocolVersion = reader.uint();
    else if (field === 10) message = readReady(reader.message());
    else if (field === 11) message = { kind: 'snapshot', snapshot: readSnapshot(reader.message()) };
    else if (field === 12) message = readReconcile(reader.message());
    else if (field === 13) message = readEntityRemove(reader.message());
    else if (field === 14) message = readChatMessage(reader.message());
    else if (field === 15) message = readError(reader.message());
    else if (field === 16) message = readPong(reader.message());
    else reader.skip(wire);
  }
  if (protocolVersion !== WORLD_PROTOCOL_VERSION) {
    throw new Error(
      `World protocol mismatch (server ${protocolVersion}, client ${WORLD_PROTOCOL_VERSION}).`,
    );
  }
  if (!message) throw new Error('World message did not contain a payload.');
  return message;
}

function readReady(reader: ProtoReader): ServerWorldMessage {
  let playerId = '';
  let nodeId = '';
  let simulationVersion = 0;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) playerId = reader.string();
    else if (field === 2) nodeId = reader.string();
    else if (field === 3) simulationVersion = reader.uint();
    else reader.skip(wire);
  }
  return { kind: 'ready', playerId, nodeId, simulationVersion };
}

function readSnapshot(reader: ProtoReader): SnapshotMessage {
  const snapshot: SnapshotMessage = { now: 0, tick: 0, epoch: 0, cellId: '', entities: [] };
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) snapshot.now = reader.uint();
    else if (field === 2) snapshot.tick = reader.uint();
    else if (field === 3) snapshot.epoch = reader.uint();
    else if (field === 4) snapshot.cellId = reader.string();
    else if (field === 5) snapshot.entities.push(readSnapshotEntity(reader.message()));
    else reader.skip(wire);
  }
  return snapshot;
}

function readSnapshotEntity(reader: ProtoReader): SnapshotEntityMessage {
  const entity: SnapshotEntityMessage = {
    id: '',
    playerId: '',
    displayName: '',
    lod: 'full',
    mode: '',
    character: null,
    ship: null,
    shipRig: null,
    markerPosition: { x: 0, y: 0, z: 0 },
    stationRoomId: null,
    shipZoneId: null,
  };
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) entity.id = reader.string();
    else if (field === 2) entity.playerId = reader.string();
    else if (field === 3) entity.displayName = reader.string();
    else if (field === 4) entity.lod = readLod(reader.uint());
    else if (field === 5) entity.mode = reader.string();
    else if (field === 6) entity.characterAppearance = readAppearance(reader.bytes());
    else if (field === 7) entity.character = readCharacterBody(reader.message());
    else if (field === 8) entity.ship = readShip(reader.message());
    else if (field === 9) entity.shipRig = readShipRig(reader.message());
    else if (field === 10) entity.markerPosition = readVec(reader.message());
    else if (field === 11) entity.stationRoomId = reader.string() || null;
    else if (field === 12) entity.shipZoneId = reader.string() || null;
    else reader.skip(wire);
  }
  return entity;
}

interface DecodedBody extends ReconcileCharacterBody {
  velocity: Vec3;
  grounded: boolean;
}

function readBody(reader: ProtoReader): DecodedBody {
  const body: DecodedBody = {
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    animation: 'idle',
    grounded: false,
  };
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) body.position = readVec(reader.message());
    else if (field === 2) body.forward = readVec(reader.message());
    else if (field === 3) body.up = readVec(reader.message());
    else if (field === 4) body.velocity = readVec(reader.message());
    else if (field === 5) body.animation = reader.string();
    else if (field === 6) body.grounded = reader.bool();
    else reader.skip(wire);
  }
  return body;
}

function readCharacterBody(reader: ProtoReader): CharacterRenderState {
  const body = readBody(reader);
  return {
    animation: body.animation,
    forward: body.forward,
    position: body.position,
    up: body.up,
  };
}

function readShip(reader: ProtoReader): NetworkShipBody {
  let body: DecodedBody = readBody(new ProtoReader(new Uint8Array()));
  const ship: Partial<NetworkShipBody> = {};
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) body = readBody(reader.message());
    else if (field === 2) ship.shipId = reader.string();
    else if (field === 3) ship.prefabId = reader.string();
    else if (field === 4) ship.hp = reader.double();
    else if (field === 5) ship.shields = reader.double();
    else if (field === 6) ship.maxHp = reader.double();
    else if (field === 7) ship.maxShields = reader.double();
    else reader.skip(wire);
  }
  return { ...body, ...ship };
}

function readShipRig(reader: ProtoReader): NetworkShipRig {
  const rig: NetworkShipRig = { gear01: 0, ramp01: 0, doors: {} };
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) rig.gear01 = reader.double();
    else if (field === 2) rig.ramp01 = reader.double();
    else if (field === 3) {
      const entry = reader.message();
      let id = '';
      let open01 = 0;
      while (!entry.done) {
        const tag = entry.tag();
        if (tag.field === 1) id = entry.string();
        else if (tag.field === 2) open01 = entry.double();
        else entry.skip(tag.wire);
      }
      if (id) rig.doors[id] = open01;
    } else reader.skip(wire);
  }
  return rig;
}

function readVec(reader: ProtoReader): Vec3 {
  const value = { x: 0, y: 0, z: 0 };
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) value.x = reader.double();
    else if (field === 2) value.y = reader.double();
    else if (field === 3) value.z = reader.double();
    else reader.skip(wire);
  }
  return value;
}

function readReconcile(reader: ProtoReader): ServerWorldMessage {
  let acceptedSequence = 0;
  let tick = 0;
  let epoch = 0;
  let cellId = '';
  let playerId = '';
  let character: ReconcileCharacterBody | null = null;
  let ship: NetworkShipBody | null = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) acceptedSequence = reader.uint();
    else if (field === 2) tick = reader.uint();
    else if (field === 3) epoch = reader.uint();
    else if (field === 4) cellId = reader.string();
    else if (field === 5) character = readBody(reader.message());
    else if (field === 6) ship = readShip(reader.message());
    else if (field === 7) playerId = reader.string();
    else reader.skip(wire);
  }
  return { kind: 'reconcile', acceptedSequence, tick, epoch, cellId, playerId, character, ship };
}

function readEntityRemove(reader: ProtoReader): ServerWorldMessage {
  let id = '';
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) id = reader.string();
    else reader.skip(tag.wire);
  }
  return { kind: 'entity-remove', id };
}

function readChatMessage(reader: ProtoReader): ServerWorldMessage {
  const message = { id: '', playerId: '', author: '', text: '', instanceId: '', at: 0 };
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) message.id = reader.string();
    else if (tag.field === 2) message.playerId = reader.string();
    else if (tag.field === 3) message.author = reader.string();
    else if (tag.field === 4) message.text = reader.string();
    else if (tag.field === 5) message.instanceId = reader.string();
    else if (tag.field === 6) message.at = reader.uint();
    else reader.skip(tag.wire);
  }
  return { kind: 'chat-message', message };
}

function readError(reader: ProtoReader): ServerWorldMessage {
  let code = '';
  let message = '';
  let retryable = false;
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) code = reader.string();
    else if (tag.field === 2) message = reader.string();
    else if (tag.field === 3) retryable = reader.bool();
    else reader.skip(tag.wire);
  }
  return { kind: 'error', code, message, retryable };
}

function readPong(reader: ProtoReader): ServerWorldMessage {
  let nonce = 0;
  let clientTimeMs = 0;
  let serverTimeMs = 0;
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) nonce = reader.uint();
    else if (tag.field === 2) clientTimeMs = reader.double();
    else if (tag.field === 3) serverTimeMs = reader.uint();
    else reader.skip(tag.wire);
  }
  return { kind: 'pong', nonce, clientTimeMs, serverTimeMs };
}

function readAppearance(bytes: Uint8Array): PlayerCharacterAppearanceV1 | undefined {
  if (bytes.length === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as PlayerCharacterAppearanceV1;
  } catch {
    return undefined;
  }
}

function readLod(value: number): NetworkLod {
  if (value === 2) return 'medium';
  if (value === 3) return 'marker';
  return 'full';
}
