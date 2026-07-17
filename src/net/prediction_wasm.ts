import type { Vec3 } from '../types';

interface SimCoreExports extends WebAssembly.Exports {
  cc_fixed_dt_seconds: () => number;
  cc_character_max_speed_mps: () => number;
  cc_character_accel_mps2: () => number;
  cc_ship_max_speed_mps: () => number;
  cc_ship_accel_mps2: () => number;
  cc_predict_position_axis: (
    position: number,
    velocity: number,
    desiredVelocity: number,
    dtSeconds: number,
    maxSpeed: number,
    acceleration: number,
  ) => number;
  cc_predict_velocity_axis: (
    position: number,
    velocity: number,
    desiredVelocity: number,
    dtSeconds: number,
    maxSpeed: number,
    acceleration: number,
  ) => number;
}

export interface PredictionFrame {
  position: Vec3;
  velocity: Vec3;
}

export interface PredictionEngine {
  advance: (
    position: Vec3,
    velocity: Vec3,
    desiredVelocity: Vec3,
    profile: 'character' | 'ship',
  ) => PredictionFrame;
}

export async function loadPredictionEngine(): Promise<PredictionEngine> {
  const response = await fetch('/wasm/cc_sim_core.wasm');
  if (!response.ok) {
    throw new Error(`Shared prediction WASM failed to load (${response.status}).`);
  }
  const result = await WebAssembly.instantiateStreaming(response, {});
  const exports = result.instance.exports as SimCoreExports;
  if (
    typeof exports.cc_predict_position_axis !== 'function' ||
    typeof exports.cc_predict_velocity_axis !== 'function' ||
    typeof exports.cc_fixed_dt_seconds !== 'function' ||
    typeof exports.cc_character_max_speed_mps !== 'function' ||
    typeof exports.cc_character_accel_mps2 !== 'function' ||
    typeof exports.cc_ship_max_speed_mps !== 'function' ||
    typeof exports.cc_ship_accel_mps2 !== 'function'
  ) {
    throw new Error('Shared prediction WASM exports are incompatible.');
  }
  const axis = (
    position: number,
    velocity: number,
    desiredVelocity: number,
    dtSeconds: number,
    maxSpeed: number,
    acceleration: number,
  ) => ({
    position: exports.cc_predict_position_axis(
      position,
      velocity,
      desiredVelocity,
      dtSeconds,
      maxSpeed,
      acceleration,
    ),
    velocity: exports.cc_predict_velocity_axis(
      position,
      velocity,
      desiredVelocity,
      dtSeconds,
      maxSpeed,
      acceleration,
    ),
  });
  return {
    advance(position, velocity, desiredVelocity, profile) {
      const dtSeconds = exports.cc_fixed_dt_seconds();
      const maxSpeed =
        profile === 'ship'
          ? exports.cc_ship_max_speed_mps()
          : exports.cc_character_max_speed_mps();
      const acceleration =
        profile === 'ship' ? exports.cc_ship_accel_mps2() : exports.cc_character_accel_mps2();
      const x = axis(position.x, velocity.x, desiredVelocity.x, dtSeconds, maxSpeed, acceleration);
      const y = axis(position.y, velocity.y, desiredVelocity.y, dtSeconds, maxSpeed, acceleration);
      const z = axis(position.z, velocity.z, desiredVelocity.z, dtSeconds, maxSpeed, acceleration);
      return {
        position: { x: x.position, y: y.position, z: z.position },
        velocity: { x: x.velocity, y: y.velocity, z: z.velocity },
      };
    },
  };
}
