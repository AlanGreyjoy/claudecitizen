use std::collections::HashMap;

use rapier3d::{control::KinematicCharacterController, prelude::*};
use serde::{Deserialize, Serialize};

use crate::{AxisState, PredictionParams, predict_axis};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct Vector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct KinematicState {
    pub position: Vector3,
    pub velocity: Vector3,
}

pub struct AuthorityWorld {
    physics: PhysicsWorld,
    bodies: HashMap<String, BodyHandles>,
    controller: KinematicCharacterController,
}

#[derive(Clone, Copy)]
struct BodyHandles {
    body: RigidBodyHandle,
    collider: ColliderHandle,
}

impl AuthorityWorld {
    pub fn new(fixed_dt_seconds: f32) -> Self {
        let mut physics = PhysicsWorld::new();
        physics.gravity = Vector::ZERO;
        physics.integration_parameters.dt = fixed_dt_seconds;
        Self {
            physics,
            bodies: HashMap::new(),
            controller: KinematicCharacterController::default(),
        }
    }

    pub fn ensure_character(&mut self, entity_id: &str, state: KinematicState) {
        if self.bodies.contains_key(entity_id) {
            return;
        }
        let (body, collider) = self.physics.insert(
            RigidBodyBuilder::kinematic_position_based().translation(Vector::new(
                state.position.x,
                state.position.y,
                state.position.z,
            )),
            ColliderBuilder::capsule_y(0.9, 0.35),
        );
        self.bodies
            .insert(entity_id.to_owned(), BodyHandles { body, collider });
    }

    pub fn remove(&mut self, entity_id: &str) {
        let Some(handles) = self.bodies.remove(entity_id) else {
            return;
        };
        self.physics.remove_body(handles.body);
    }

    pub fn apply_intent(
        &mut self,
        entity_id: &str,
        current: KinematicState,
        desired_velocity: Vector3,
        dt_seconds: f32,
        params: PredictionParams,
    ) -> KinematicState {
        self.ensure_character(entity_id, current);
        let x = predict_axis(
            AxisState {
                position: current.position.x,
                velocity: current.velocity.x,
            },
            desired_velocity.x,
            dt_seconds,
            params,
        );
        let y = predict_axis(
            AxisState {
                position: current.position.y,
                velocity: current.velocity.y,
            },
            desired_velocity.y,
            dt_seconds,
            params,
        );
        let z = predict_axis(
            AxisState {
                position: current.position.z,
                velocity: current.velocity.z,
            },
            desired_velocity.z,
            dt_seconds,
            params,
        );
        let predicted = KinematicState {
            position: Vector3 {
                x: x.position,
                y: y.position,
                z: z.position,
            },
            velocity: Vector3 {
                x: x.velocity,
                y: y.velocity,
                z: z.velocity,
            },
        };
        let Some(handles) = self.bodies.get(entity_id).copied() else {
            return predicted;
        };
        let desired_translation = Vector::new(
            predicted.position.x - current.position.x,
            predicted.position.y - current.position.y,
            predicted.position.z - current.position.z,
        );
        let movement = {
            let queries = self.physics.query_pipeline_with_filter(
                QueryFilter::default().exclude_rigid_body(handles.body),
            );
            let shape = self.physics.colliders[handles.collider].shape();
            let position = self.physics.bodies[handles.body].position();
            self.controller.move_shape(
                dt_seconds,
                &queries,
                shape,
                position,
                desired_translation,
                |_| {},
            )
        };
        let accepted = KinematicState {
            position: Vector3 {
                x: current.position.x + movement.translation.x,
                y: current.position.y + movement.translation.y,
                z: current.position.z + movement.translation.z,
            },
            velocity: predicted.velocity,
        };
        if let Some(body) = self.physics.bodies.get_mut(handles.body) {
            body.set_translation(
                Vector::new(
                    accepted.position.x,
                    accepted.position.y,
                    accepted.position.z,
                ),
                true,
            );
        }
        accepted
    }

    pub fn step(&mut self) {
        self.physics.step();
    }

    pub fn position(&self, entity_id: &str) -> Option<Vector3> {
        let handle = self.bodies.get(entity_id)?;
        let value = self.physics.bodies.get(handle.body)?.translation();
        Some(Vector3 {
            x: value.x,
            y: value.y,
            z: value.z,
        })
    }
}
