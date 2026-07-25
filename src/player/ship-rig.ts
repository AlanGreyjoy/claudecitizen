import { getShipLayout, type ShipDoorSpec } from './ship_layout';

/**
 * Articulation state for the active ship: landing gear, rear boarding ramp,
 * and any prefab-authored doors. The sim owns target booleans and animates
 * the 0..1 blend values; render reads the blends verbatim.
 */

export interface ShipDoorRigState {
  /** 0 closed .. 1 open. */
  open01: number;
  isOpen: boolean;
}

export interface ShipRigState {
  /** 0 retracted .. 1 deployed. */
  gear01: number;
  /** 0 raised .. 1 lowered. */
  ramp01: number;
  gearDown: boolean;
  rampDown: boolean;
  /** Keyed by ship-door id from the layout. */
  doors: Record<string, ShipDoorRigState>;
}

const GEAR_RATE_PER_SECOND = 1 / 2.333;
/** Full raise/lower matches Phobos Ramp1.wav (~4.66s). */
const RAMP_RATE_PER_SECOND = 1 / 4.661;
const DOOR_RATE_PER_SECOND = 1.5;

export interface ShipRigOptions {
  gearDown?: boolean;
  rampDown?: boolean;
  /** Overrides the layout's defaultOpen per door id. */
  doorsOpen?: Record<string, boolean>;
}

export function createShipRigState(
  options?: ShipRigOptions,
  doors?: readonly ShipDoorSpec[],
): ShipRigState {
  const gearDown = options?.gearDown ?? true;
  const rampDown = options?.rampDown ?? false;
  const doorList = doors ?? getShipLayout().doors;
  const doorStates: Record<string, ShipDoorRigState> = {};
  for (const door of doorList) {
    const isOpen = options?.doorsOpen?.[door.id] ?? door.defaultOpen;
    doorStates[door.id] = { open01: isOpen ? 1 : 0, isOpen };
  }
  return {
    gear01: gearDown ? 1 : 0,
    ramp01: rampDown ? 1 : 0,
    gearDown,
    rampDown,
    doors: doorStates,
  };
}

function moveToward(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(target, value + maxDelta);
  if (value > target) return Math.max(target, value - maxDelta);
  return value;
}

export function updateShipRig(rig: ShipRigState, dt: number): void {
  rig.gear01 = moveToward(rig.gear01, rig.gearDown ? 1 : 0, GEAR_RATE_PER_SECOND * dt);
  rig.ramp01 = moveToward(rig.ramp01, rig.rampDown ? 1 : 0, RAMP_RATE_PER_SECOND * dt);
  for (const door of Object.values(rig.doors)) {
    door.open01 = moveToward(door.open01, door.isOpen ? 1 : 0, DOOR_RATE_PER_SECOND * dt);
  }
}

export function isRampUsable(rig: ShipRigState): boolean {
  return rig.ramp01 >= 0.98;
}

/** Doors are passable (and their colliders disable) when mostly open; unknown ids stay shut. */
export function isDoorPassable(rig: ShipRigState, doorId: string): boolean {
  const door = rig.doors[doorId];
  return door !== undefined && door.open01 >= 0.85;
}

/** Blend values for the renderer, keyed by door id. */
export function doorBlends(rig: ShipRigState): Record<string, number> {
  const blends: Record<string, number> = {};
  for (const [id, door] of Object.entries(rig.doors)) blends[id] = door.open01;
  return blends;
}
