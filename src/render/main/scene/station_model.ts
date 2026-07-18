import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import {
  HANGAR_PAD_HEIGHT,
  HANGARS,
  STATION_DOORWAYS,
  STATION_ROOMS,
  STATION_WINDOWS,
  type StationDoorway,
  type StationRoom,
  type StationSide,
  type StationWindow,
} from '../../../world/station';
import { applyDefaultFrustumCulling } from '../../frustum_policy';

/**
 * Procedural station interior/hull built from the shared layout in
 * world/station.ts. Geometry is authored in station-local meters
 * (right/up/forward) and mapped into the group's local axes to match
 * updateShipPlacement's lookAt orientation: x = -right, y = up, z = forward.
 */

const WALL_THICKNESS = 0.4;
const WALL_LENGTH_PAD = 0.2;
const WALL_SINK_BELOW_FLOOR = 0.15;
const WALL_RISE_INTO_CEILING = 0.25;
const CEILING_THICKNESS = 0.5;
const CEILING_MARGIN = 0.2;

type MaterialId =
  | 'hull'
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'trim'
  | 'dark'
  | 'accent'
  | 'warn'
  | 'panel'
  | 'screen'
  | 'bed'
  | 'linen';

interface BoxSpec {
  material: MaterialId;
  right: number;
  up: number;
  forward: number;
  sizeRight: number;
  sizeUp: number;
  sizeForward: number;
  /** Rotation around the station right axis (tilting panels). */
  tiltRadians?: number;
}

interface WallHole {
  alongCenter: number;
  width: number;
  /** Above the room floor. */
  bottom: number;
  top: number;
}

function createMaterials(): Record<MaterialId, THREE.MeshStandardMaterial> {
  const make = (options: THREE.MeshStandardMaterialParameters) =>
    new THREE.MeshStandardMaterial(options);
  return {
    hull: make({ color: 0x39424e, metalness: 0.55, roughness: 0.52 }),
    wall: make({ color: 0x4c5663, metalness: 0.35, roughness: 0.62 }),
    floor: make({ color: 0x2c333d, metalness: 0.3, roughness: 0.8 }),
    ceiling: make({ color: 0x39414c, metalness: 0.3, roughness: 0.7 }),
    trim: make({ color: 0x99a5b5, metalness: 0.75, roughness: 0.32 }),
    dark: make({ color: 0x141a22, metalness: 0.5, roughness: 0.55 }),
    accent: make({ color: 0x0b1018, emissive: 0x3fc6ff, emissiveIntensity: 1.7 }),
    warn: make({ color: 0x241a08, emissive: 0xffb54d, emissiveIntensity: 1.25 }),
    panel: make({ color: 0xffffff, emissive: 0xe9f2ff, emissiveIntensity: 2.6 }),
    screen: make({ color: 0x06131c, emissive: 0x4fdfff, emissiveIntensity: 2.2 }),
    bed: make({ color: 0x7c3540, metalness: 0, roughness: 0.9 }),
    linen: make({ color: 0xe8e9ee, metalness: 0, roughness: 0.95 }),
  };
}

interface WallRun {
  /** 'right' walls have constant right coordinate; along axis is forward. */
  plane: 'right' | 'forward';
  cross: number;
  alongMin: number;
  alongMax: number;
  floorUp: number;
  height: number;
  holes: WallHole[];
}

function sideOfRoom(room: StationRoom, side: StationSide): { plane: 'right' | 'forward'; cross: number; alongMin: number; alongMax: number } {
  if (side === 'minRight' || side === 'maxRight') {
    return {
      plane: 'right',
      cross: side === 'minRight' ? room.minRight : room.maxRight,
      alongMin: room.minForward,
      alongMax: room.maxForward,
    };
  }
  return {
    plane: 'forward',
    cross: side === 'minForward' ? room.minForward : room.maxForward,
    alongMin: room.minRight,
    alongMax: room.maxRight,
  };
}

function doorwayHolesForSide(room: StationRoom, side: StationSide): WallHole[] {
  const { plane, cross, alongMin, alongMax } = sideOfRoom(room, side);
  const holes: WallHole[] = [];
  for (const doorway of STATION_DOORWAYS) {
    if (doorway.floorId !== room.floorId) continue;
    if (doorway.crossAxis !== plane) continue;
    const touches =
      Math.abs(doorway.crossFrom - cross) < 0.05 || Math.abs(doorway.crossTo - cross) < 0.05;
    if (!touches) continue;
    if (doorway.alongCenter < alongMin || doorway.alongCenter > alongMax) continue;
    holes.push({
      alongCenter: doorway.alongCenter,
      width: doorway.width,
      bottom: 0,
      top: doorway.height,
    });
  }
  return holes;
}

function windowHolesForSide(room: StationRoom, side: StationSide): WallHole[] {
  return STATION_WINDOWS.filter(
    (window) => window.roomId === room.id && window.side === side,
  ).map((window) => ({
    alongCenter: window.alongCenter,
    width: window.width,
    bottom: window.bottom,
    top: window.top,
  }));
}

function wallRunsForRoom(room: StationRoom): WallRun[] {
  const sides: StationSide[] = ['minRight', 'maxRight', 'minForward', 'maxForward'];
  const runs: WallRun[] = [];
  for (const side of sides) {
    if (room.openSides?.includes(side)) continue;
    const { plane, cross, alongMin, alongMax } = sideOfRoom(room, side);
    runs.push({
      plane,
      cross,
      alongMin: alongMin - WALL_LENGTH_PAD,
      alongMax: alongMax + WALL_LENGTH_PAD,
      floorUp: room.floorUp,
      height: room.height,
      holes: [...doorwayHolesForSide(room, side), ...windowHolesForSide(room, side)].sort(
        (a, b) => a.alongCenter - b.alongCenter,
      ),
    });
  }
  return runs;
}

function wallBox(
  run: WallRun,
  alongMin: number,
  alongMax: number,
  upMin: number,
  upMax: number,
): BoxSpec {
  const alongCenter = (alongMin + alongMax) / 2;
  const alongSize = alongMax - alongMin;
  const upCenter = (upMin + upMax) / 2;
  const upSize = upMax - upMin;
  if (run.plane === 'right') {
    return {
      material: 'wall',
      right: run.cross,
      up: upCenter,
      forward: alongCenter,
      sizeRight: WALL_THICKNESS,
      sizeUp: upSize,
      sizeForward: alongSize,
    };
  }
  return {
    material: 'wall',
    right: alongCenter,
    up: upCenter,
    forward: run.cross,
    sizeRight: alongSize,
    sizeUp: upSize,
    sizeForward: WALL_THICKNESS,
  };
}

function buildWallRun(run: WallRun, boxes: BoxSpec[]): void {
  const wallBottom = run.floorUp - WALL_SINK_BELOW_FLOOR;
  const wallTop = run.floorUp + run.height + WALL_RISE_INTO_CEILING;
  let cursor = run.alongMin;
  for (const hole of run.holes) {
    const holeMin = hole.alongCenter - hole.width / 2;
    const holeMax = hole.alongCenter + hole.width / 2;
    if (holeMin - cursor > 0.02) {
      boxes.push(wallBox(run, cursor, holeMin, wallBottom, wallTop));
    }
    const holeBottom = run.floorUp + hole.bottom;
    const holeTop = run.floorUp + hole.top;
    if (holeBottom - wallBottom > 0.16) {
      boxes.push(wallBox(run, holeMin, holeMax, wallBottom, holeBottom));
    }
    if (wallTop - holeTop > 0.02) {
      boxes.push(wallBox(run, holeMin, holeMax, holeTop, wallTop));
    }
    cursor = holeMax;
  }
  if (run.alongMax - cursor > 0.02) {
    boxes.push(wallBox(run, cursor, run.alongMax, wallBottom, wallTop));
  }
}

interface FrameSpec {
  plane: 'right' | 'forward';
  crossCenter: number;
  depth: number;
  alongCenter: number;
  width: number;
  bottomUp: number;
  topUp: number;
  material: MaterialId;
}

/** Jambs on both sides plus a lintel spanning the opening. */
function buildOpeningFrame(spec: FrameSpec, boxes: BoxSpec[]): void {
  const jambThickness = 0.14;
  const place = (along: number, up: number, sizeAlong: number, sizeUp: number): BoxSpec => {
    if (spec.plane === 'right') {
      return {
        material: spec.material,
        right: spec.crossCenter,
        up,
        forward: along,
        sizeRight: spec.depth,
        sizeUp,
        sizeForward: sizeAlong,
      };
    }
    return {
      material: spec.material,
      right: along,
      up,
      forward: spec.crossCenter,
      sizeRight: sizeAlong,
      sizeUp,
      sizeForward: spec.depth,
    };
  };

  const openHeight = spec.topUp - spec.bottomUp;
  const jambCenterUp = spec.bottomUp + openHeight / 2;
  boxes.push(
    place(spec.alongCenter - spec.width / 2 - jambThickness / 2, jambCenterUp, jambThickness, openHeight),
    place(spec.alongCenter + spec.width / 2 + jambThickness / 2, jambCenterUp, jambThickness, openHeight),
    place(spec.alongCenter, spec.topUp + jambThickness / 2, spec.width + jambThickness * 2, jambThickness),
  );
}

function buildDoorwayFrames(doorway: StationDoorway, boxes: BoxSpec[]): void {
  const crossCenter = (doorway.crossFrom + doorway.crossTo) / 2;
  const depth = Math.abs(doorway.crossTo - doorway.crossFrom) + WALL_THICKNESS * 2 + 0.08;
  buildOpeningFrame(
    {
      plane: doorway.crossAxis,
      crossCenter,
      depth,
      alongCenter: doorway.alongCenter,
      width: doorway.width,
      bottomUp: doorway.floorUp,
      topUp: doorway.floorUp + doorway.height,
      material: 'trim',
    },
    boxes,
  );
}

function buildWindow(window: StationWindow, boxes: BoxSpec[], glassBoxes: BoxSpec[]): void {
  const room = STATION_ROOMS.find((entry) => entry.id === window.roomId);
  if (!room) return;
  const { plane, cross } = sideOfRoom(room, window.side);
  buildOpeningFrame(
    {
      plane,
      crossCenter: cross,
      depth: WALL_THICKNESS + 0.12,
      alongCenter: window.alongCenter,
      width: window.width,
      bottomUp: room.floorUp + window.bottom,
      topUp: room.floorUp + window.top,
      material: 'trim',
    },
    boxes,
  );

  const upCenter = room.floorUp + (window.bottom + window.top) / 2;
  const upSize = window.top - window.bottom;
  glassBoxes.push(
    plane === 'right'
      ? {
          material: 'trim',
          right: cross,
          up: upCenter,
          forward: window.alongCenter,
          sizeRight: 0.06,
          sizeUp: upSize,
          sizeForward: window.width,
        }
      : {
          material: 'trim',
          right: window.alongCenter,
          up: upCenter,
          forward: cross,
          sizeRight: window.width,
          sizeUp: upSize,
          sizeForward: 0.06,
        },
  );
}

interface ElevatorDoorSpec {
  plane: 'right' | 'forward';
  /** Wall inner-face coordinate the door sits proud of. */
  face: number;
  /** Direction (in the cross axis) pointing into the room. */
  inward: number;
  alongCenter: number;
  floorUp: number;
  /** Marker bars drawn above the door (hangar number), 0 for none. */
  bars: number;
}

function buildElevatorDoor(spec: ElevatorDoorSpec, boxes: BoxSpec[]): void {
  const doorWidth = 2.0;
  const doorHeight = 2.6;
  const leafWidth = doorWidth / 2 - 0.02;
  const slabCross = spec.face + spec.inward * 0.07;
  const place = (
    material: MaterialId,
    along: number,
    up: number,
    sizeAlong: number,
    sizeUp: number,
    cross: number,
    depth: number,
  ): BoxSpec =>
    spec.plane === 'right'
      ? {
          material,
          right: cross,
          up,
          forward: along,
          sizeRight: depth,
          sizeUp,
          sizeForward: sizeAlong,
        }
      : {
          material,
          right: along,
          up,
          forward: cross,
          sizeRight: sizeAlong,
          sizeUp,
          sizeForward: depth,
        };

  const centerUp = spec.floorUp + doorHeight / 2;
  boxes.push(
    place('dark', spec.alongCenter - leafWidth / 2 - 0.01, centerUp, leafWidth, doorHeight, slabCross, 0.12),
    place('dark', spec.alongCenter + leafWidth / 2 + 0.01, centerUp, leafWidth, doorHeight, slabCross, 0.12),
  );

  const frameCross = spec.face + spec.inward * 0.09;
  const jamb = 0.16;
  boxes.push(
    place('trim', spec.alongCenter - doorWidth / 2 - jamb / 2, centerUp, jamb, doorHeight, frameCross, 0.18),
    place('trim', spec.alongCenter + doorWidth / 2 + jamb / 2, centerUp, jamb, doorHeight, frameCross, 0.18),
    place('trim', spec.alongCenter, spec.floorUp + doorHeight + jamb / 2, doorWidth + jamb * 2, jamb, frameCross, 0.18),
    place('accent', spec.alongCenter, spec.floorUp + doorHeight + jamb + 0.07, doorWidth + jamb * 2, 0.08, frameCross, 0.1),
  );

  const barWidth = 0.34;
  const barGap = 0.16;
  const totalWidth = spec.bars * barWidth + (spec.bars - 1) * barGap;
  for (let i = 0; i < spec.bars; i += 1) {
    const along = spec.alongCenter - totalWidth / 2 + barWidth / 2 + i * (barWidth + barGap);
    boxes.push(place('warn', along, spec.floorUp + doorHeight + 0.55, barWidth, 0.12, frameCross, 0.1));
  }
}

function buildFloorSlabs(boxes: BoxSpec[]): void {
  const slab = (
    minRight: number,
    maxRight: number,
    minForward: number,
    maxForward: number,
    topUp: number,
    thickness: number,
  ) => {
    boxes.push({
      material: 'floor',
      right: (minRight + maxRight) / 2,
      up: topUp - thickness / 2,
      forward: (minForward + maxForward) / 2,
      sizeRight: maxRight - minRight,
      sizeUp: thickness,
      sizeForward: maxForward - minForward,
    });
  };
  slab(-7.5, 2.1, -14, 8.6, 14, 1.2);
  slab(-14.6, 14.6, -12.6, 12.6, 0, 1.2);
  slab(-56.6, 56.6, -22.6, 22.6, -22, 1.6);

  // Hull cores filling the vertical gaps between decks so the station reads
  // as one structure from outside instead of floating slabs.
  boxes.push(
    {
      material: 'hull',
      right: 0,
      up: -4.1,
      forward: 0,
      sizeRight: 29.2,
      sizeUp: 8.0,
      sizeForward: 25.2,
    },
    {
      material: 'hull',
      right: -2.7,
      up: 9.2,
      forward: -2.7,
      sizeRight: 9.6,
      sizeUp: 7.4,
      sizeForward: 22.6,
    },
  );
}

function buildCeilings(boxes: BoxSpec[]): void {
  for (const room of STATION_ROOMS) {
    boxes.push({
      material: 'ceiling',
      right: (room.minRight + room.maxRight) / 2,
      up: room.floorUp + room.height + CEILING_THICKNESS / 2,
      forward: (room.minForward + room.maxForward) / 2,
      sizeRight: room.maxRight - room.minRight + CEILING_MARGIN * 2,
      sizeUp: CEILING_THICKNESS,
      sizeForward: room.maxForward - room.minForward + CEILING_MARGIN * 2,
    });
  }
}

function buildLightPanels(boxes: BoxSpec[]): void {
  const panel = (right: number, up: number, forward: number, sizeRight: number, sizeForward: number) => {
    boxes.push({
      material: 'panel',
      right,
      up,
      forward,
      sizeRight,
      sizeUp: 0.06,
      sizeForward,
    });
  };
  panel(-4.4, 16.92, 5.2, 2.4, 1.2);
  for (const forward of [-7, -1, 5]) panel(0, 17.12, forward, 1.8, 1.0);
  panel(0, 16.62, -11.9, 1.6, 1.6);
  for (const right of [-8, 0, 8]) {
    for (const forward of [-6, 6]) panel(right, 4.94, forward, 3.0, 1.6);
  }
  for (const hangar of HANGARS) {
    for (const offset of [-10, 0, 10]) {
      for (const forward of [-10, 4]) {
        boxes.push({
          material: 'panel',
          right: hangar.centerRight + offset,
          up: -8.1,
          forward,
          sizeRight: 4,
          sizeUp: 0.1,
          sizeForward: 2.5,
        });
      }
    }
  }
}

function buildAccentStrips(boxes: BoxSpec[]): void {
  boxes.push(
    { material: 'accent', right: -1.27, up: 15.0, forward: -1, sizeRight: 0.06, sizeUp: 0.08, sizeForward: 17.6 },
    { material: 'accent', right: 1.27, up: 15.0, forward: -1, sizeRight: 0.06, sizeUp: 0.08, sizeForward: 17.6 },
    { material: 'accent', right: 0, up: 3.4, forward: -11.76, sizeRight: 27.4, sizeUp: 0.1, sizeForward: 0.06 },
    { material: 'accent', right: 0, up: 3.4, forward: 11.76, sizeRight: 27.4, sizeUp: 0.1, sizeForward: 0.06 },
    { material: 'accent', right: -13.76, up: 3.4, forward: 0, sizeRight: 0.06, sizeUp: 0.1, sizeForward: 23.4 },
    { material: 'accent', right: 13.76, up: 3.4, forward: 0, sizeRight: 0.06, sizeUp: 0.1, sizeForward: 23.4 },
  );

  for (const hangar of HANGARS) {
    const room = STATION_ROOMS.find((entry) => entry.id === hangar.roomId)!;
    const stripeUp = room.floorUp + 1.2;
    boxes.push(
      {
        material: 'warn',
        right: room.minRight + 0.24,
        up: stripeUp,
        forward: 0,
        sizeRight: 0.06,
        sizeUp: 0.3,
        sizeForward: room.maxForward - room.minForward - 0.8,
      },
      {
        material: 'warn',
        right: room.maxRight - 0.24,
        up: stripeUp,
        forward: 0,
        sizeRight: 0.06,
        sizeUp: 0.3,
        sizeForward: room.maxForward - room.minForward - 0.8,
      },
      {
        material: 'warn',
        right: hangar.centerRight,
        up: stripeUp,
        forward: room.minForward + 0.24,
        sizeRight: room.maxRight - room.minRight - 0.8,
        sizeUp: 0.3,
        sizeForward: 0.06,
      },
    );

    // Mouth framing so the opening reads from inside and out.
    boxes.push(
      {
        material: 'warn',
        right: room.minRight + 0.3,
        up: room.floorUp + room.height / 2,
        forward: room.maxForward - 0.1,
        sizeRight: 0.5,
        sizeUp: room.height,
        sizeForward: 0.6,
      },
      {
        material: 'warn',
        right: room.maxRight - 0.3,
        up: room.floorUp + room.height / 2,
        forward: room.maxForward - 0.1,
        sizeRight: 0.5,
        sizeUp: room.height,
        sizeForward: 0.6,
      },
      {
        material: 'warn',
        right: hangar.centerRight,
        up: room.floorUp + room.height - 0.3,
        forward: room.maxForward - 0.1,
        sizeRight: room.maxRight - room.minRight,
        sizeUp: 0.5,
        sizeForward: 0.6,
      },
    );
  }
}

function buildHangarPads(boxes: BoxSpec[]): void {
  for (const hangar of HANGARS) {
    const padUp = -22 + HANGAR_PAD_HEIGHT / 2;
    boxes.push({
      material: 'dark',
      right: hangar.centerRight,
      up: padUp,
      forward: 1.0,
      sizeRight: 16,
      sizeUp: HANGAR_PAD_HEIGHT,
      sizeForward: 16,
    });
    const edgeUp = -22 + HANGAR_PAD_HEIGHT + 0.03;
    boxes.push(
      { material: 'warn', right: hangar.centerRight - 7.85, up: edgeUp, forward: 1.0, sizeRight: 0.3, sizeUp: 0.06, sizeForward: 16 },
      { material: 'warn', right: hangar.centerRight + 7.85, up: edgeUp, forward: 1.0, sizeRight: 0.3, sizeUp: 0.06, sizeForward: 16 },
      { material: 'warn', right: hangar.centerRight, up: edgeUp, forward: 1.0 - 7.85, sizeRight: 16, sizeUp: 0.06, sizeForward: 0.3 },
      { material: 'warn', right: hangar.centerRight, up: edgeUp, forward: 1.0 + 7.85, sizeRight: 16, sizeUp: 0.06, sizeForward: 0.3 },
    );
  }
}

function buildTerminalKiosk(boxes: BoxSpec[]): void {
  boxes.push(
    { material: 'dark', right: 0, up: 0.53, forward: 8.5, sizeRight: 1.0, sizeUp: 1.06, sizeForward: 0.5 },
    { material: 'trim', right: 0, up: 0.04, forward: 8.5, sizeRight: 1.3, sizeUp: 0.08, sizeForward: 0.8 },
    { material: 'accent', right: -0.52, up: 0.53, forward: 8.5, sizeRight: 0.05, sizeUp: 0.9, sizeForward: 0.4 },
    { material: 'accent', right: 0.52, up: 0.53, forward: 8.5, sizeRight: 0.05, sizeUp: 0.9, sizeForward: 0.4 },
    {
      material: 'screen',
      right: 0,
      up: 1.32,
      forward: 8.36,
      sizeRight: 1.1,
      sizeUp: 0.66,
      sizeForward: 0.08,
      tiltRadians: 0.32,
    },
  );
}

function buildHabFurniture(boxes: BoxSpec[]): void {
  boxes.push(
    { material: 'dark', right: -6.15, up: 14.25, forward: 6.5, sizeRight: 1.1, sizeUp: 0.5, sizeForward: 2.1 },
    { material: 'bed', right: -6.15, up: 14.56, forward: 6.5, sizeRight: 1.1, sizeUp: 0.14, sizeForward: 2.1 },
    { material: 'linen', right: -6.15, up: 14.69, forward: 7.2, sizeRight: 0.9, sizeUp: 0.12, sizeForward: 0.5 },
    { material: 'dark', right: -5.6, up: 14.92, forward: 3.15, sizeRight: 1.5, sizeUp: 0.07, sizeForward: 0.7 },
    { material: 'screen', right: -5.6, up: 15.45, forward: 2.95, sizeRight: 0.8, sizeUp: 0.5, sizeForward: 0.05 },
    { material: 'trim', right: -5.6, up: 14.45, forward: 3.15, sizeRight: 0.12, sizeUp: 0.9, sizeForward: 0.5 },
  );
}

function buildElevatorDoors(boxes: BoxSpec[]): void {
  // Lobby back wall: hab elevator (wall at forward -12, inner face -11.8).
  buildElevatorDoor(
    { plane: 'forward', face: -11.8, inward: 1, alongCenter: 0, floorUp: 0, bars: 0 },
    boxes,
  );
  // Lobby right wall: hangar elevator bank (wall at right 14, inner face 13.8).
  for (const hangar of HANGARS) {
    buildElevatorDoor(
      {
        plane: 'right',
        face: 13.8,
        inward: -1,
        alongCenter: hangar.lobbyDoorForward,
        floorUp: 0,
        bars: hangar.index,
      },
      boxes,
    );
  }
  // Hangar back walls (wall at forward -22, inner face -21.8).
  for (const hangar of HANGARS) {
    buildElevatorDoor(
      {
        plane: 'forward',
        face: -21.8,
        inward: 1,
        alongCenter: hangar.centerRight,
        floorUp: -22,
        bars: hangar.index,
      },
      boxes,
    );
  }
  // Hab elevator cab: accent strip inside the cab rear wall.
  boxes.push({
    material: 'accent',
    right: 0,
    up: 15.1,
    forward: -13.14,
    sizeRight: 2.2,
    sizeUp: 0.1,
    sizeForward: 0.06,
  });
}

function boxGeometry(spec: BoxSpec): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(spec.sizeRight, spec.sizeUp, spec.sizeForward);
  if (spec.tiltRadians) geometry.rotateX(spec.tiltRadians);
  // Group axes from updateShipPlacement's lookAt: x = -right, y = up, z = forward.
  geometry.translate(-spec.right, spec.up, spec.forward);
  return geometry;
}

function addPointLight(
  group: THREE.Group,
  renderScale: number,
  right: number,
  up: number,
  forward: number,
  rangeMeters: number,
  irradiance: number,
  referenceMeters: number,
): void {
  const light = new THREE.PointLight(
    0xdfeaff,
    irradiance * (referenceMeters * renderScale) ** 2,
    rangeMeters * renderScale,
    2,
  );
  light.position.set(-right, up, forward);
  light.castShadow = false;
  group.add(light);
}

export function createStationModel(renderScale: number): THREE.Group {
  const group = new THREE.Group();
  const boxes: BoxSpec[] = [];
  const glassBoxes: BoxSpec[] = [];

  for (const room of STATION_ROOMS) {
    for (const run of wallRunsForRoom(room)) buildWallRun(run, boxes);
  }
  for (const doorway of STATION_DOORWAYS) buildDoorwayFrames(doorway, boxes);
  for (const window of STATION_WINDOWS) buildWindow(window, boxes, glassBoxes);
  buildFloorSlabs(boxes);
  buildCeilings(boxes);
  buildLightPanels(boxes);
  buildAccentStrips(boxes);
  buildHangarPads(boxes);
  buildTerminalKiosk(boxes);
  buildHabFurniture(boxes);
  buildElevatorDoors(boxes);

  const materials = createMaterials();
  const byMaterial = new Map<MaterialId, THREE.BoxGeometry[]>();
  for (const spec of boxes) {
    const list = byMaterial.get(spec.material) ?? [];
    list.push(boxGeometry(spec));
    byMaterial.set(spec.material, list);
  }

  for (const [materialId, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[materialId]);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    merged.computeBoundingSphere();
    group.add(mesh);
    for (const geometry of geometries) geometry.dispose();
  }

  if (glassBoxes.length > 0) {
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x9bc9f5,
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const merged = mergeGeometries(glassBoxes.map(boxGeometry));
    if (merged) {
      const mesh = new THREE.Mesh(merged, glassMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      merged.computeBoundingSphere();
      group.add(mesh);
    }
  }

  addPointLight(group, renderScale, -4.4, 16.4, 5.2, 14, 3.5, 2.5);
  addPointLight(group, renderScale, 0, 16.6, -2, 18, 3.0, 2.8);
  addPointLight(group, renderScale, 0, 16.2, -11.9, 10, 3.0, 2.2);
  addPointLight(group, renderScale, -7, 4.2, 0, 26, 3.5, 4.5);
  addPointLight(group, renderScale, 7, 4.2, 0, 26, 3.5, 4.5);
  for (const hangar of HANGARS) {
    addPointLight(group, renderScale, hangar.centerRight, -10, 0, 46, 4.0, 9);
  }

  group.scale.setScalar(renderScale);
  applyDefaultFrustumCulling(group);
  return group;
}
