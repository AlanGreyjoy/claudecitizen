import type { Vec3 } from '../../types';
import type { Quat } from '../../math/quat';
import type { StationFloorId, StationSide } from '../station';

/**
 * Prefab documents are the contract between the editor and the game: a tree
 * of entities with transforms, optional visual content (GLB asset url or a
 * simple primitive), and gameplay components (spawn points, elevators, walk
 * volumes, ...). Documents are plain JSON, tracked under
 * src/world/prefabs/data/<id>.prefab.json (metadata only — asset urls may
 * point at gitignored protected files).
 *
 * Coordinate convention: prefab space equals the render group's local space
 * (the same axes you see in the editor viewport). When a station prefab is
 * placed in the world via updateShipPlacement, the group axes map to
 * station-local gameplay axes as: right = -x, up = y, forward = z.
 */

export type PrefabKind = 'station' | 'ship-interior' | 'site';

export const PREFAB_KINDS: PrefabKind[] = ['station', 'ship-interior', 'site'];

/** Horizontal (XZ plane) extent used by walk volumes, in prefab/scene axes. */
export interface PrefabVec2 {
  x: number;
  z: number;
}

export interface PrefabTransform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export interface PrefabAsset {
  /** Absolute dev-server url, e.g. "/assets/protected/synty/.../Wall_01.glb". */
  url: string;
  castShadow?: boolean;
}

export interface PrefabPrimitive {
  shape: 'box';
  size: Vec3;
  /** CSS hex color, e.g. "#4c5663". */
  color?: string;
}

export type PrefabComponent =
  | { type: 'station-frame' }
  | { type: 'spawn-point'; floorId: StationFloorId }
  | { type: 'elevator'; id: string; targetFloor: StationFloorId }
  | { type: 'hangar-pad'; hangarId: string; padIndex: number }
  | { type: 'interaction'; id: string; prompt: string; radius: number }
  | {
      type: 'walk-volume';
      floorId: StationFloorId;
      /** Local XZ offsets from the entity origin (entity rotation is ignored). */
      min: PrefabVec2;
      max: PrefabVec2;
      /** Interior height in meters (default 4). */
      height?: number;
      /** Sides without walls (hangar mouths); station-local side names. */
      open?: StationSide[];
    }
  | { type: 'collider'; shape: 'box'; size: Vec3; offset?: Vec3 };

export type PrefabComponentType = PrefabComponent['type'];

export interface PrefabEntity {
  id: string;
  name: string;
  transform: PrefabTransform;
  asset?: PrefabAsset;
  primitive?: PrefabPrimitive;
  components?: PrefabComponent[];
  children?: PrefabEntity[];
}

export interface PrefabDocument {
  id: string;
  name: string;
  version: 1;
  kind: PrefabKind;
  root: PrefabEntity;
}

export const PREFAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function slugifyPrefabName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const STATION_FLOOR_IDS: StationFloorId[] = ['hab', 'lobby', 'hangar'];
const STATION_SIDES: StationSide[] = ['minRight', 'maxRight', 'minForward', 'maxForward'];

function fail(path: string, message: string): never {
  throw new Error(`Invalid prefab document at ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected finite number');
  return value;
}

function parseString(value: unknown, path: string, maxLength = 256): string {
  if (typeof value !== 'string') fail(path, 'expected string');
  return value.slice(0, maxLength);
}

function parseVec3(value: unknown, path: string): Vec3 {
  if (!isRecord(value)) fail(path, 'expected {x,y,z}');
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    y: parseFiniteNumber(value.y, `${path}.y`),
    z: parseFiniteNumber(value.z, `${path}.z`),
  };
}

function parseVec2(value: unknown, path: string): PrefabVec2 {
  if (!isRecord(value)) fail(path, 'expected {x,z}');
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    z: parseFiniteNumber(value.z, `${path}.z`),
  };
}

function parseQuat(value: unknown, path: string): Quat {
  if (!isRecord(value)) fail(path, 'expected {x,y,z,w}');
  return {
    x: parseFiniteNumber(value.x, `${path}.x`),
    y: parseFiniteNumber(value.y, `${path}.y`),
    z: parseFiniteNumber(value.z, `${path}.z`),
    w: parseFiniteNumber(value.w, `${path}.w`),
  };
}

function parseFloorId(value: unknown, path: string): StationFloorId {
  if (typeof value !== 'string' || !STATION_FLOOR_IDS.includes(value as StationFloorId)) {
    fail(path, `expected one of ${STATION_FLOOR_IDS.join(', ')}`);
  }
  return value as StationFloorId;
}

function parseAssetUrl(value: unknown, path: string): string {
  const url = parseString(value, path, 512);
  if (!url.startsWith('/') || url.includes('..')) {
    fail(path, 'asset url must be an absolute path without ".."');
  }
  return url;
}

function parseComponent(value: unknown, path: string): PrefabComponent | null {
  if (!isRecord(value)) fail(path, 'expected component object');
  const type = value.type;
  switch (type) {
    case 'station-frame':
      return { type };
    case 'spawn-point':
      return { type, floorId: parseFloorId(value.floorId, `${path}.floorId`) };
    case 'elevator':
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        targetFloor: parseFloorId(value.targetFloor, `${path}.targetFloor`),
      };
    case 'hangar-pad':
      return {
        type,
        hangarId: parseString(value.hangarId, `${path}.hangarId`, 64),
        padIndex: Math.max(1, Math.round(parseFiniteNumber(value.padIndex, `${path}.padIndex`))),
      };
    case 'interaction':
      return {
        type,
        id: parseString(value.id, `${path}.id`, 64),
        prompt: parseString(value.prompt, `${path}.prompt`, 200),
        radius: Math.min(50, Math.max(0.5, parseFiniteNumber(value.radius, `${path}.radius`))),
      };
    case 'walk-volume': {
      const open = Array.isArray(value.open)
        ? value.open.filter((side): side is StationSide =>
            STATION_SIDES.includes(side as StationSide),
          )
        : undefined;
      return {
        type,
        floorId: parseFloorId(value.floorId, `${path}.floorId`),
        min: parseVec2(value.min, `${path}.min`),
        max: parseVec2(value.max, `${path}.max`),
        height:
          value.height === undefined
            ? undefined
            : Math.min(100, Math.max(1, parseFiniteNumber(value.height, `${path}.height`))),
        ...(open && open.length > 0 ? { open } : {}),
      };
    }
    case 'collider':
      return {
        type,
        shape: 'box',
        size: parseVec3(value.size, `${path}.size`),
        offset: value.offset === undefined ? undefined : parseVec3(value.offset, `${path}.offset`),
      };
    default:
      // Unknown component types are dropped for forward compatibility.
      console.warn(`Prefab component of unknown type "${String(type)}" at ${path} was ignored.`);
      return null;
  }
}

function parseEntity(value: unknown, path: string, depth: number): PrefabEntity {
  if (depth > 32) fail(path, 'entity tree too deep');
  if (!isRecord(value)) fail(path, 'expected entity object');

  const transformValue = value.transform;
  if (!isRecord(transformValue)) fail(`${path}.transform`, 'expected transform object');
  const transform: PrefabTransform = {
    position: parseVec3(transformValue.position, `${path}.transform.position`),
    rotation: parseQuat(transformValue.rotation, `${path}.transform.rotation`),
    scale: parseVec3(transformValue.scale, `${path}.transform.scale`),
  };

  const entity: PrefabEntity = {
    id: parseString(value.id, `${path}.id`, 64),
    name: parseString(value.name, `${path}.name`, 128),
    transform,
  };

  if (value.asset !== undefined) {
    if (!isRecord(value.asset)) fail(`${path}.asset`, 'expected asset object');
    entity.asset = {
      url: parseAssetUrl(value.asset.url, `${path}.asset.url`),
      ...(value.asset.castShadow !== undefined
        ? { castShadow: Boolean(value.asset.castShadow) }
        : {}),
    };
  }

  if (value.primitive !== undefined) {
    if (!isRecord(value.primitive)) fail(`${path}.primitive`, 'expected primitive object');
    if (value.primitive.shape !== 'box') fail(`${path}.primitive.shape`, 'expected "box"');
    const color = value.primitive.color;
    entity.primitive = {
      shape: 'box',
      size: parseVec3(value.primitive.size, `${path}.primitive.size`),
      ...(typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? { color } : {}),
    };
  }

  if (value.components !== undefined) {
    if (!Array.isArray(value.components)) fail(`${path}.components`, 'expected array');
    const components = value.components
      .map((component, index) => parseComponent(component, `${path}.components[${index}]`))
      .filter((component): component is PrefabComponent => component !== null);
    if (components.length > 0) entity.components = components;
  }

  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) fail(`${path}.children`, 'expected array');
    if (value.children.length > 4096) fail(`${path}.children`, 'too many children');
    entity.children = value.children.map((child, index) =>
      parseEntity(child, `${path}.children[${index}]`, depth + 1),
    );
  }

  return entity;
}

/**
 * Validates untrusted JSON into a PrefabDocument (throws on malformed input).
 * All prefab loading — bundled files, dev API responses — goes through here.
 */
export function parsePrefabDocument(value: unknown): PrefabDocument {
  if (!isRecord(value)) fail('$', 'expected document object');
  const id = parseString(value.id, '$.id', 64);
  if (!PREFAB_ID_PATTERN.test(id)) fail('$.id', 'expected lowercase slug (a-z, 0-9, -)');
  if (value.version !== 1) fail('$.version', 'expected version 1');
  const kind = value.kind;
  if (typeof kind !== 'string' || !PREFAB_KINDS.includes(kind as PrefabKind)) {
    fail('$.kind', `expected one of ${PREFAB_KINDS.join(', ')}`);
  }
  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.slice(0, 128) : id,
    version: 1,
    kind: kind as PrefabKind,
    root: parseEntity(value.root, '$.root', 0),
  };
}
