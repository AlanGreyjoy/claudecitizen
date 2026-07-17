pub const FIXED_DT_SECONDS: f32 = 1.0 / 30.0;
pub const DEFAULT_CHARACTER_MAX_SPEED_MPS: f32 = 12.0;
pub const DEFAULT_CHARACTER_ACCEL_MPS2: f32 = 48.0;
pub const DEFAULT_SHIP_MAX_SPEED_MPS: f32 = 1_200.0;
pub const DEFAULT_SHIP_ACCEL_MPS2: f32 = 600.0;

#[unsafe(no_mangle)]
pub extern "C" fn cc_fixed_dt_seconds() -> f32 {
    FIXED_DT_SECONDS
}

#[unsafe(no_mangle)]
pub extern "C" fn cc_character_max_speed_mps() -> f32 {
    DEFAULT_CHARACTER_MAX_SPEED_MPS
}

#[unsafe(no_mangle)]
pub extern "C" fn cc_character_accel_mps2() -> f32 {
    DEFAULT_CHARACTER_ACCEL_MPS2
}

#[unsafe(no_mangle)]
pub extern "C" fn cc_ship_max_speed_mps() -> f32 {
    DEFAULT_SHIP_MAX_SPEED_MPS
}

#[unsafe(no_mangle)]
pub extern "C" fn cc_ship_accel_mps2() -> f32 {
    DEFAULT_SHIP_ACCEL_MPS2
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AxisState {
    pub position: f32,
    pub velocity: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PredictionParams {
    pub max_speed: f32,
    pub acceleration: f32,
}

impl Default for PredictionParams {
    fn default() -> Self {
        Self {
            max_speed: DEFAULT_CHARACTER_MAX_SPEED_MPS,
            acceleration: DEFAULT_CHARACTER_ACCEL_MPS2,
        }
    }
}

pub fn finite_or_zero(value: f32) -> f32 {
    if value.is_finite() { value } else { 0.0 }
}

pub fn predict_axis(
    state: AxisState,
    desired_velocity: f32,
    dt_seconds: f32,
    params: PredictionParams,
) -> AxisState {
    let dt = finite_or_zero(dt_seconds).clamp(0.0, 0.1);
    let max_speed = finite_or_zero(params.max_speed).abs().max(0.01);
    let acceleration = finite_or_zero(params.acceleration).abs().max(0.01);
    let target = finite_or_zero(desired_velocity).clamp(-max_speed, max_speed);
    let velocity_delta =
        (target - finite_or_zero(state.velocity)).clamp(-acceleration * dt, acceleration * dt);
    let velocity = (finite_or_zero(state.velocity) + velocity_delta).clamp(-max_speed, max_speed);
    AxisState {
        position: finite_or_zero(state.position) + velocity * dt,
        velocity,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn cc_predict_position_axis(
    position: f32,
    velocity: f32,
    desired_velocity: f32,
    dt_seconds: f32,
    max_speed: f32,
    acceleration: f32,
) -> f32 {
    predict_axis(
        AxisState { position, velocity },
        desired_velocity,
        dt_seconds,
        PredictionParams {
            max_speed,
            acceleration,
        },
    )
    .position
}

#[unsafe(no_mangle)]
pub extern "C" fn cc_predict_velocity_axis(
    position: f32,
    velocity: f32,
    desired_velocity: f32,
    dt_seconds: f32,
    max_speed: f32,
    acceleration: f32,
) -> f32 {
    predict_axis(
        AxisState { position, velocity },
        desired_velocity,
        dt_seconds,
        PredictionParams {
            max_speed,
            acceleration,
        },
    )
    .velocity
}

#[cfg(feature = "native")]
pub mod authority;
