import type { FlightBody } from "../types";
import type { ShipLayout, ShipSpec } from "../player/ship_layout";
import {
  createShipRigState,
  type ShipRigOptions,
  type ShipRigState,
} from "../player/ship_rig";

export interface ShipVitals {
  hp: number;
  shields: number;
}

export interface ShipInstance {
  id: string;
  prefabId: string;
  spec: ShipSpec;
  body: FlightBody;
  rig: ShipRigState;
  vitals: ShipVitals;
  ownerPlayerId: string | null;
  /** planet: / hangar: / space: — matches multiplayer instance ids. */
  instanceId: string;
}

export interface CreateShipInstanceOptions {
  id: string;
  prefabId: string;
  layout: ShipLayout;
  body: FlightBody;
  ownerPlayerId?: string | null;
  instanceId: string;
  rig?: ShipRigOptions;
  vitals?: Partial<ShipVitals>;
}

export function createShipInstance(
  options: CreateShipInstanceOptions,
): ShipInstance {
  const spec = options.layout.spec;
  return {
    id: options.id,
    prefabId: options.prefabId,
    spec,
    body: options.body,
    rig: createShipRigState(options.rig, options.layout.doors),
    vitals: {
      hp: options.vitals?.hp ?? spec.maxHp,
      shields: options.vitals?.shields ?? spec.maxShields,
    },
    ownerPlayerId: options.ownerPlayerId ?? null,
    instanceId: options.instanceId,
  };
}

/** Applies damage to shields first, then hull. Returns remaining damage absorbed. */
export function applyDamageToShip(
  instance: ShipInstance,
  amount: number,
): number {
  if (amount <= 0) return 0;
  let remaining = amount;
  if (instance.vitals.shields > 0) {
    const absorbed = Math.min(instance.vitals.shields, remaining);
    instance.vitals.shields -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    instance.vitals.hp = Math.max(0, instance.vitals.hp - remaining);
  }
  return remaining;
}

export function regenerateShipShields(
  instance: ShipInstance,
  dt: number,
): void {
  const rate = instance.spec.shieldRegenPerSec;
  if (rate <= 0 || instance.vitals.shields >= instance.spec.maxShields) return;
  instance.vitals.shields = Math.min(
    instance.spec.maxShields,
    instance.vitals.shields + rate * dt,
  );
}

export function isShipDestroyed(instance: ShipInstance): boolean {
  return instance.vitals.hp <= 0;
}
