/**
 * Articulation state for the Phobos Starhopper: landing gear, rear boarding
 * ramp, and cockpit doors. The sim owns target booleans and animates the 0..1
 * blend values; render reads the blends verbatim.
 */

export interface ShipRigState {
  /** 0 retracted .. 1 deployed. */
  gear01: number;
  /** 0 raised .. 1 lowered. */
  ramp01: number;
  /** 0 closed .. 1 open. */
  cockpit01: number;
  gearDown: boolean;
  rampDown: boolean;
  cockpitOpen: boolean;
}

/** Ship origin height above the ground plane when resting on deployed gear. */
export const GEAR_REST_HEIGHT_METERS = 3.16;

const GEAR_RATE_PER_SECOND = 0.7;
const RAMP_RATE_PER_SECOND = 0.65;
const COCKPIT_RATE_PER_SECOND = 1.5;

export function createShipRigState(options?: Partial<ShipRigState>): ShipRigState {
  const gearDown = options?.gearDown ?? true;
  const rampDown = options?.rampDown ?? false;
  const cockpitOpen = options?.cockpitOpen ?? false;
  return {
    gear01: gearDown ? 1 : 0,
    ramp01: rampDown ? 1 : 0,
    cockpit01: cockpitOpen ? 1 : 0,
    gearDown,
    rampDown,
    cockpitOpen,
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
  rig.cockpit01 = moveToward(rig.cockpit01, rig.cockpitOpen ? 1 : 0, COCKPIT_RATE_PER_SECOND * dt);
}

export function isRampUsable(rig: ShipRigState): boolean {
  return rig.ramp01 >= 0.98;
}

export function isCockpitPassable(rig: ShipRigState): boolean {
  return rig.cockpit01 >= 0.85;
}
