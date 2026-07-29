//! Authoritative cells.
//!
//! A cell simulates every entity inside it and publishes its full state to one
//! Redis channel. It has no idea who is watching: interest management, per-viewer
//! deltas and appearance caching all live at the edge (`replication.rs`), because
//! a cell is shared by every viewer and a viewer's interest set is not.
//!
//! There is exactly one delivery path — cell publishes to Redis, edges subscribe
//! to Redis — including for cells this same node owns. The local-broadcast
//! shortcut that used to exist made same-node and cross-node delivery behave
//! differently, which is precisely the kind of split that hides bugs until a
//! second node appears.

use std::{collections::HashMap, sync::Arc, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use cc_protocol::{
    PROTOCOL_VERSION, SIMULATION_VERSION, encode_message,
    world::{
        BodyState, CellCheckpoint, ChatMessage, CheckpointEntity, ClientEnvelope, EntityProfile,
        EntityProfiles, EntityRemove, PresenceIntent, Reconcile, ReplicatedBody, ReplicatedEntity,
        ReplicatedShip, ServerEnvelope, ShipState, Snapshot, Vec3, Vec3f, client_envelope,
        server_envelope,
    },
};
use cc_sim_core::{
    DEFAULT_CHARACTER_ACCEL_MPS2, DEFAULT_CHARACTER_MAX_SPEED_MPS, DEFAULT_SHIP_ACCEL_MPS2,
    DEFAULT_SHIP_MAX_SPEED_MPS, FIXED_DT_SECONDS, PredictionParams,
    authority::{AuthorityWorld, KinematicState, Vector3},
};
use chrono::Utc;
use futures_util::StreamExt;
use prost::Message;
use redis::{
    AsyncCommands,
    streams::{StreamReadOptions, StreamReadReply},
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use tokio::{
    sync::{RwLock, mpsc},
    task::JoinHandle,
    time::{MissedTickBehavior, interval},
};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    grid::finite,
};

const CELL_LEASE_MS: u64 = 10_000;
const CELL_LEASE_RENEW_MS: u64 = 3_000;
const CELL_CHECKPOINT_TICKS: u64 = 150;
const ENTITY_TIMEOUT_TICKS: u64 = 30 * 30;
const INPUT_TIMEOUT_TICKS: u64 = 6;
/// Identity and appearance are republished on this cadence so an edge that
/// attached mid-flight, or lost a pub/sub message, converges within a second
/// instead of holding an entity out of view forever.
const PROFILE_HEARTBEAT_TICKS: u64 = 30;
/// Deep enough that a healthy Redis never backs up at 20 Hz, shallow enough
/// that a sick one sheds load instead of growing without bound.
const FANOUT_CAPACITY: usize = 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutedCommand {
    pub player_id: String,
    pub display_name: String,
    pub appearance_json_base64: String,
    pub envelope_base64: String,
}

#[derive(Clone)]
struct CellHandle {
    commands: mpsc::Sender<RoutedCommand>,
    task: Arc<JoinHandle<()>>,
}

impl CellHandle {
    fn alive(&self) -> bool {
        !self.task.is_finished() && !self.commands.is_closed()
    }
}

pub struct CellSubscription {
    pub receiver: mpsc::Receiver<Vec<u8>>,
    /// Dropping the subscription must drop the pub/sub connection with it.
    _task: DropGuard,
}

pub struct DropGuard(JoinHandle<()>);

impl Drop for DropGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[derive(Clone)]
pub struct CellCoordinator {
    node_id: String,
    db: PgPool,
    redis: redis::aio::ConnectionManager,
    redis_client: redis::Client,
    cells: Arc<RwLock<HashMap<String, CellHandle>>>,
}

impl CellCoordinator {
    pub fn new(
        node_id: String,
        db: PgPool,
        redis: redis::aio::ConnectionManager,
        redis_client: redis::Client,
    ) -> Self {
        Self {
            node_id,
            db,
            redis,
            redis_client,
            cells: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Make sure *someone* is simulating this cell. Idempotent, and safe to
    /// call on a timer: if the previous owner died its lease has expired and
    /// this call picks the cell back up.
    ///
    /// Only a viewer's own authority cell is ever claimed. Neighbour cells are
    /// observed, never claimed — otherwise walking near a boundary would spawn
    /// an authority task and bump a Postgres epoch for empty space.
    pub async fn claim(&self, cell_id: &str) -> ApiResult<()> {
        if self
            .cells
            .read()
            .await
            .get(cell_id)
            .is_some_and(CellHandle::alive)
        {
            return Ok(());
        }
        self.cells.write().await.remove(cell_id);
        if let Some(handle) = self.try_claim(cell_id).await? {
            self.cells.write().await.insert(cell_id.to_owned(), handle);
        }
        Ok(())
    }

    /// Stream every cell in an interest set over a single pub/sub connection.
    ///
    /// One connection per session, not per cell: a viewer near a corner holds
    /// up to 27 cells, and a Redis connection each would be a connection leak
    /// with extra steps. The set only changes when a viewer crosses a cell
    /// boundary — which hysteresis already makes rare — so rebuilding the
    /// connection on change is cheaper than tracking incremental subscribes.
    pub async fn observe(&self, cell_ids: &[String]) -> ApiResult<CellSubscription> {
        let mut pubsub = self.redis_client.get_async_pubsub().await?;
        for cell_id in cell_ids {
            pubsub.subscribe(snapshot_channel(cell_id)).await?;
        }
        let (sender, receiver) = mpsc::channel(256);
        let task = tokio::spawn(async move {
            let mut messages = pubsub.on_message();
            while let Some(message) = messages.next().await {
                let Ok(payload) = message.get_payload::<Vec<u8>>() else {
                    continue;
                };
                if sender.send(payload).await.is_err() {
                    break;
                }
            }
        });
        Ok(CellSubscription {
            receiver,
            _task: DropGuard(task),
        })
    }

    pub async fn submit(&self, cell_id: &str, command: RoutedCommand) -> ApiResult<()> {
        let existing = self.cells.read().await.get(cell_id).cloned();
        if let Some(handle) = existing {
            if handle.alive() {
                handle
                    .commands
                    .send(command)
                    .await
                    .map_err(|_| ApiError::Unavailable)?;
                return Ok(());
            }
            self.cells.write().await.remove(cell_id);
        }
        let payload = serde_json::to_vec(&command).map_err(anyhow::Error::from)?;
        let mut redis = self.redis.clone();
        let _: String = redis::cmd("XADD")
            .arg(command_stream_key(cell_id))
            .arg("MAXLEN")
            .arg("~")
            .arg(4096)
            .arg("*")
            .arg("payload")
            .arg(payload)
            .query_async(&mut redis)
            .await?;
        Ok(())
    }

    async fn try_claim(&self, cell_id: &str) -> ApiResult<Option<CellHandle>> {
        let token = format!("{}:{}", self.node_id, Uuid::new_v4());
        let mut redis = self.redis.clone();
        let claimed: Option<String> = redis::cmd("SET")
            .arg(lease_key(cell_id))
            .arg(&token)
            .arg("NX")
            .arg("PX")
            .arg(CELL_LEASE_MS)
            .query_async(&mut redis)
            .await?;
        if claimed.is_none() {
            return Ok(None);
        }
        let epoch: i64 = sqlx::query_scalar(
            r#"INSERT INTO "SimulationCellEpoch" ("cellId", "epoch", "ownerNodeId", "updatedAt")
               VALUES ($1, 1, $2, NOW()) ON CONFLICT ("cellId") DO UPDATE
               SET "epoch" = "SimulationCellEpoch"."epoch" + 1,
                   "ownerNodeId" = EXCLUDED."ownerNodeId", "updatedAt" = NOW()
               RETURNING "epoch""#,
        )
        .bind(cell_id)
        .bind(&self.node_id)
        .fetch_one(&self.db)
        .await?;
        let handle = spawn_cell(CellSpawn {
            cell_id: cell_id.to_owned(),
            epoch: epoch as u64,
            lease_token: token,
            db: self.db.clone(),
            redis: self.redis.clone(),
            redis_client: self.redis_client.clone(),
        })
        .await?;
        Ok(Some(handle))
    }
}

struct CellSpawn {
    cell_id: String,
    epoch: u64,
    lease_token: String,
    db: PgPool,
    redis: redis::aio::ConnectionManager,
    redis_client: redis::Client,
}

#[derive(Clone)]
struct Entity {
    player_id: String,
    display_name: String,
    appearance_json: Vec<u8>,
    mode: String,
    character: Option<BodyState>,
    ship: Option<ShipState>,
    ship_rig: Option<cc_protocol::world::ShipRigState>,
    station_room_id: String,
    ship_zone_id: String,
    accepted_sequence: u64,
    last_reconciled_sequence: u64,
    last_reconcile_tick: u64,
    last_seen_tick: u64,
    desired_velocity: Vector3,
}

async fn spawn_cell(spawn: CellSpawn) -> ApiResult<CellHandle> {
    let (commands, receiver) = mpsc::channel(512);
    let (authority, entities, initial_tick) =
        restore_cell(&spawn.db, &spawn.cell_id, spawn.epoch).await?;
    let task = tokio::spawn(run_cell(spawn, receiver, authority, entities, initial_tick));
    Ok(CellHandle {
        commands,
        task: Arc::new(task),
    })
}

async fn run_cell(
    spawn: CellSpawn,
    mut receiver: mpsc::Receiver<RoutedCommand>,
    mut authority: AuthorityWorld,
    mut entities: HashMap<String, Entity>,
    mut tick: u64,
) {
    let (remote_sender, mut remote_receiver) = mpsc::channel(512);
    let stream_task = spawn_command_stream_reader(
        spawn.redis_client.clone(),
        spawn.cell_id.clone(),
        remote_sender,
    );
    let (fanout, mut fanout_receiver) = mpsc::channel::<Vec<u8>>(FANOUT_CAPACITY);
    let mut fanout_redis = spawn.redis.clone();
    let fanout_channel = snapshot_channel(&spawn.cell_id);
    let fanout_task = tokio::spawn(async move {
        while let Some(payload) = fanout_receiver.recv().await {
            let result: Result<i64, _> = fanout_redis.publish(&fanout_channel, payload).await;
            if let Err(error) = result {
                tracing::warn!(error = ?error, "snapshot fan-out failed");
            }
        }
    });
    let mut ticker = interval(Duration::from_secs_f32(FIXED_DT_SECONDS));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut lease_ticker = interval(Duration::from_millis(CELL_LEASE_RENEW_MS));
    let mut lease_valid = true;

    while lease_valid {
        tokio::select! {
            _ = ticker.tick() => {
                let mut joined = false;
                while let Ok(command) = receiver.try_recv() {
                    joined |= handle_command(&spawn, &fanout, &mut authority, &mut entities, tick, command);
                }
                while let Ok(command) = remote_receiver.try_recv() {
                    joined |= handle_command(&spawn, &fanout, &mut authority, &mut entities, tick, command);
                }
                simulate_entities(&mut authority, &mut entities, tick);
                authority.step();
                tick = tick.saturating_add(1);
                if tick.is_multiple_of(30) {
                    remove_stale_entities(&fanout, &mut authority, &mut entities, tick);
                }
                // A join means at least one edge has an empty profile cache, so
                // republish immediately rather than making it wait a heartbeat.
                if joined || tick.is_multiple_of(PROFILE_HEARTBEAT_TICKS) {
                    publish_profiles(&spawn, &fanout, &entities);
                }
                // Two snapshots every three 30 Hz ticks = 20 Hz.
                if !tick.is_multiple_of(3) {
                    publish_snapshot(&spawn, &fanout, &entities, tick);
                    publish_reconciles(&spawn, &fanout, &mut entities, tick);
                }
                if tick.is_multiple_of(CELL_CHECKPOINT_TICKS) {
                    spawn_checkpoint(&spawn, &entities, tick);
                }
            }
            _ = lease_ticker.tick() => {
                lease_valid = renew_lease(&spawn).await.unwrap_or(false);
            }
        }
    }
    stream_task.abort();
    fanout_task.abort();
    let _ = checkpoint(&spawn, &entities, tick).await;
    tracing::warn!(
        cell_id = spawn.cell_id,
        epoch = spawn.epoch,
        "cell lease lost; authority stopped"
    );
}

/// Returns true when the command was a join, so the caller can republish
/// profiles on the same tick.
fn handle_command(
    spawn: &CellSpawn,
    fanout: &mpsc::Sender<Vec<u8>>,
    authority: &mut AuthorityWorld,
    entities: &mut HashMap<String, Entity>,
    tick: u64,
    command: RoutedCommand,
) -> bool {
    let Ok(payload) = STANDARD.decode(&command.envelope_base64) else {
        return false;
    };
    let Ok(envelope) = ClientEnvelope::decode(payload.as_slice()) else {
        return false;
    };
    if envelope.protocol_version != PROTOCOL_VERSION {
        return false;
    }
    match envelope.payload {
        Some(client_envelope::Payload::Join(join)) => {
            entities
                .entry(command.player_id.clone())
                .and_modify(|entity| {
                    entity.display_name.clone_from(&command.display_name);
                    entity.station_room_id.clone_from(&join.station_room_id);
                    entity.last_seen_tick = tick;
                })
                .or_insert_with(|| Entity {
                    player_id: command.player_id,
                    display_name: command.display_name,
                    appearance_json: STANDARD
                        .decode(command.appearance_json_base64)
                        .unwrap_or_default(),
                    mode: "on-foot".to_owned(),
                    character: None,
                    ship: None,
                    ship_rig: None,
                    station_room_id: join.station_room_id,
                    ship_zone_id: String::new(),
                    accepted_sequence: 0,
                    last_reconciled_sequence: 0,
                    last_reconcile_tick: tick,
                    last_seen_tick: tick,
                    desired_velocity: Vector3::default(),
                });
            return true;
        }
        Some(client_envelope::Payload::PresenceIntent(intent)) => {
            apply_presence(entities, command, *intent, tick);
        }
        Some(client_envelope::Payload::Leave(_)) => {
            authority.remove(&command.player_id);
            if entities.remove(&command.player_id).is_some() {
                let message = ServerEnvelope {
                    protocol_version: PROTOCOL_VERSION,
                    payload: Some(server_envelope::Payload::EntityRemove(EntityRemove {
                        id: command.player_id,
                    })),
                };
                publish(fanout, encode_message(&message));
            }
        }
        Some(client_envelope::Payload::ChatSend(chat)) => {
            if let Some(entity) = entities.get_mut(&command.player_id) {
                entity.last_seen_tick = tick;
            }
            let text: String = chat.text.trim().chars().take(500).collect();
            if text.is_empty() {
                return false;
            }
            let message = ServerEnvelope {
                protocol_version: PROTOCOL_VERSION,
                payload: Some(server_envelope::Payload::ChatMessage(ChatMessage {
                    id: Uuid::new_v4().to_string(),
                    player_id: command.player_id,
                    author: command.display_name,
                    text,
                    instance_id: spawn.cell_id.clone(),
                    at_ms: Utc::now().timestamp_millis().max(0) as u64,
                })),
            };
            publish(fanout, encode_message(&message));
        }
        _ => {}
    }
    false
}

fn apply_presence(
    entities: &mut HashMap<String, Entity>,
    command: RoutedCommand,
    intent: PresenceIntent,
    tick: u64,
) {
    let in_ship = intent.mode == "in-ship";
    // A player standing on a ship deck walks at character speed but *moves* at
    // the ship's: presence positions are world-space, so the deck carries them.
    // Judging that motion by the on-foot limits rejects every intent a
    // passenger sends, which is its own "player cannot see player".
    let carried = !intent.ship_zone_id.is_empty();
    let desired_body = if in_ship {
        intent.ship.as_ref().and_then(|ship| ship.body.as_ref())
    } else {
        intent.character.as_ref()
    };
    let Some(desired_body) = desired_body.cloned() else {
        return;
    };
    if !valid_body(&desired_body) {
        return;
    }
    let desired_velocity = intent
        .desired_velocity
        .as_ref()
        .map(vector)
        .unwrap_or_default();
    if !finite_velocity(desired_velocity, in_ship || carried) {
        return;
    }
    let entity = entities
        .entry(command.player_id.clone())
        .or_insert_with(|| Entity {
            player_id: command.player_id.clone(),
            display_name: command.display_name.clone(),
            appearance_json: STANDARD
                .decode(&command.appearance_json_base64)
                .unwrap_or_default(),
            mode: intent.mode.clone(),
            character: None,
            ship: None,
            ship_rig: None,
            station_room_id: intent.station_room_id.clone(),
            ship_zone_id: intent.ship_zone_id.clone(),
            accepted_sequence: 0,
            last_reconciled_sequence: 0,
            last_reconcile_tick: tick,
            last_seen_tick: tick,
            desired_velocity: Vector3::default(),
        });
    if intent.sequence <= entity.accepted_sequence {
        return;
    }
    let idle_ticks = tick.saturating_sub(entity.last_seen_tick);
    entity.accepted_sequence = intent.sequence;
    entity.last_seen_tick = tick;
    entity.mode = intent.mode.clone();
    entity.station_room_id = intent.station_room_id;
    entity.ship_zone_id = intent.ship_zone_id;
    entity.ship_rig = intent.ship_rig;
    entity.desired_velocity = desired_velocity;
    let current_body = if in_ship {
        entity.ship.as_ref().and_then(|ship| ship.body.as_ref())
    } else {
        entity.character.as_ref()
    };
    let initial_position = desired_body
        .position
        .as_ref()
        .map(vector)
        .unwrap_or_default();
    let server_position = current_body
        .and_then(|body| body.position.as_ref())
        .map(vector)
        .unwrap_or(initial_position);
    // On foot the client owns collision: this authority world holds player
    // capsules and nothing else — no station geometry, no terrain, no gravity —
    // so its dead reckoning walks through walls and never converges on the
    // client's Rapier result. Follow the reported position instead, but no
    // faster than a character can move, so the clamp still rejects a teleport.
    let current_position = if in_ship {
        server_position
    } else {
        let reach = if carried {
            DEFAULT_SHIP_MAX_SPEED_MPS
        } else {
            DEFAULT_CHARACTER_MAX_SPEED_MPS
        };
        anchor_on_foot(server_position, initial_position, idle_ticks, reach)
    };
    let current_velocity = current_body
        .and_then(|body| body.velocity.as_ref())
        .map(vector)
        .unwrap_or_default();
    let accepted_body = sanitize_body(
        desired_body,
        KinematicState {
            position: current_position,
            velocity: current_velocity,
        },
    );
    if in_ship {
        let mut ship = intent.ship.unwrap_or_default();
        ship.body = Some(accepted_body);
        entity.ship = Some(ship);
        entity.character = None;
    } else {
        entity.character = Some(accepted_body);
        entity.ship = None;
    }
}

fn simulate_entities(
    authority: &mut AuthorityWorld,
    entities: &mut HashMap<String, Entity>,
    tick: u64,
) {
    for entity in entities.values_mut() {
        let in_ship = entity.mode == "in-ship";
        let body = if in_ship {
            entity.ship.as_ref().and_then(|ship| ship.body.as_ref())
        } else {
            entity.character.as_ref()
        };
        let Some(body) = body.cloned() else { continue };
        let position = body.position.as_ref().map(vector).unwrap_or_default();
        let velocity = body.velocity.as_ref().map(vector).unwrap_or_default();
        let desired_velocity = if tick.saturating_sub(entity.last_seen_tick) > INPUT_TIMEOUT_TICKS {
            Vector3::default()
        } else {
            entity.desired_velocity
        };
        let params = if in_ship {
            PredictionParams {
                max_speed: DEFAULT_SHIP_MAX_SPEED_MPS,
                acceleration: DEFAULT_SHIP_ACCEL_MPS2,
            }
        } else {
            PredictionParams {
                max_speed: DEFAULT_CHARACTER_MAX_SPEED_MPS,
                acceleration: DEFAULT_CHARACTER_ACCEL_MPS2,
            }
        };
        let accepted = authority.apply_intent(
            &entity.player_id,
            KinematicState { position, velocity },
            desired_velocity,
            FIXED_DT_SECONDS,
            params,
        );
        let accepted_body = sanitize_body(body, accepted);
        if in_ship {
            if let Some(ship) = entity.ship.as_mut() {
                ship.body = Some(accepted_body);
            }
        } else {
            entity.character = Some(accepted_body);
        }
    }
}

fn publish_reconciles(
    spawn: &CellSpawn,
    fanout: &mpsc::Sender<Vec<u8>>,
    entities: &mut HashMap<String, Entity>,
    tick: u64,
) {
    for entity in entities.values_mut() {
        if entity.accepted_sequence == 0
            || (entity.accepted_sequence == entity.last_reconciled_sequence
                && tick.saturating_sub(entity.last_reconcile_tick) < 10)
        {
            continue;
        }
        entity.last_reconciled_sequence = entity.accepted_sequence;
        entity.last_reconcile_tick = tick;
        let reconcile = ServerEnvelope {
            protocol_version: PROTOCOL_VERSION,
            payload: Some(server_envelope::Payload::Reconcile(Box::new(Reconcile {
                accepted_sequence: entity.accepted_sequence,
                tick,
                epoch: spawn.epoch,
                cell_id: spawn.cell_id.clone(),
                character: entity.character.clone(),
                ship: entity.ship.clone(),
                player_id: entity.player_id.clone(),
            }))),
        };
        publish(fanout, encode_message(&reconcile));
    }
}

/// The cell's own view of the world: every entity, full state, no interest
/// filtering. `baseline` is always set — an edge receiving this holds the
/// complete truth for the cell and diffs it per viewer itself.
fn publish_snapshot(
    spawn: &CellSpawn,
    fanout: &mpsc::Sender<Vec<u8>>,
    entities: &HashMap<String, Entity>,
    tick: u64,
) {
    let snapshot = Snapshot {
        now_ms: Utc::now().timestamp_millis().max(0) as u64,
        tick,
        epoch: spawn.epoch,
        cell_id: spawn.cell_id.clone(),
        entities: entities.values().map(replicated_entity).collect(),
        profiles: Vec::new(),
        removed_handles: Vec::new(),
        baseline: true,
    };
    let envelope = ServerEnvelope {
        protocol_version: PROTOCOL_VERSION,
        payload: Some(server_envelope::Payload::Snapshot(snapshot)),
    };
    publish(fanout, encode_message(&envelope));
}

fn publish_profiles(
    spawn: &CellSpawn,
    fanout: &mpsc::Sender<Vec<u8>>,
    entities: &HashMap<String, Entity>,
) {
    if entities.is_empty() {
        return;
    }
    let message = ServerEnvelope {
        protocol_version: PROTOCOL_VERSION,
        payload: Some(server_envelope::Payload::EntityProfiles(EntityProfiles {
            cell_id: spawn.cell_id.clone(),
            profiles: entities
                .values()
                .map(|entity| EntityProfile {
                    handle: 0,
                    id: entity.player_id.clone(),
                    player_id: entity.player_id.clone(),
                    display_name: entity.display_name.clone(),
                    character_appearance_json: entity.appearance_json.clone(),
                })
                .collect(),
        })),
    };
    publish(fanout, encode_message(&message));
}

fn publish(fanout: &mpsc::Sender<Vec<u8>>, payload: Vec<u8>) {
    if fanout.try_send(payload).is_err() {
        tracing::warn!("cell fan-out queue is full; dropped a frame");
    }
}

fn replicated_entity(entity: &Entity) -> ReplicatedEntity {
    let marker = entity
        .ship
        .as_ref()
        .and_then(|ship| ship.body.as_ref())
        .and_then(|body| body.position)
        .or_else(|| entity.character.as_ref().and_then(|body| body.position))
        .unwrap_or_default();
    ReplicatedEntity {
        handle: 0,
        id: entity.player_id.clone(),
        // The edge assigns LOD: it is a function of the viewer, which a cell
        // has no knowledge of.
        lod: 0,
        mode: entity.mode.clone(),
        character: entity.character.as_ref().map(replicated_body),
        ship: entity.ship.as_ref().map(replicated_ship),
        ship_rig: entity.ship_rig.clone(),
        marker_position: Some(marker),
        station_room_id: entity.station_room_id.clone(),
        ship_zone_id: entity.ship_zone_id.clone(),
    }
}

fn replicated_body(body: &BodyState) -> ReplicatedBody {
    ReplicatedBody {
        position: body.position,
        forward: body.forward.map(narrow),
        up: body.up.map(narrow),
        animation: body.animation.clone(),
        grounded: body.grounded,
    }
}

fn replicated_ship(ship: &ShipState) -> ReplicatedShip {
    ReplicatedShip {
        body: ship.body.as_ref().map(replicated_body),
        ship_id: ship.ship_id.clone(),
        prefab_id: ship.prefab_id.clone(),
        hp: ship.hp as f32,
        shields: ship.shields as f32,
        max_hp: ship.max_hp as f32,
        max_shields: ship.max_shields as f32,
    }
}

fn narrow(value: Vec3) -> Vec3f {
    Vec3f {
        x: value.x as f32,
        y: value.y as f32,
        z: value.z as f32,
    }
}

fn vector(value: &Vec3) -> Vector3 {
    Vector3 {
        x: value.x as f32,
        y: value.y as f32,
        z: value.z as f32,
    }
}

fn proto_vector(value: Vector3) -> Vec3 {
    Vec3 {
        x: value.x as f64,
        y: value.y as f64,
        z: value.z as f64,
    }
}

/// Moves the authoritative on-foot anchor towards the position the client
/// reports, by at most what that player could have covered since the last
/// accepted intent — `reach` is their top speed, which is the ship's when a
/// deck is carrying them. A correction inside that budget is taken verbatim; a
/// larger one is truncated, so a client that lies about where it stands
/// converges at walking pace rather than jumping.
fn anchor_on_foot(server: Vector3, reported: Vector3, idle_ticks: u64, reach: f32) -> Vector3 {
    // One tick of slack covers the usual case where an intent arrives in the
    // same tick as the last one, and absorbs float noise in a standing player.
    let elapsed = (idle_ticks.max(1) as f32 * FIXED_DT_SECONDS).min(1.0);
    let budget = reach * elapsed;
    let dx = reported.x - server.x;
    let dy = reported.y - server.y;
    let dz = reported.z - server.z;
    let distance = (dx * dx + dy * dy + dz * dz).sqrt();
    if !distance.is_finite() {
        return server;
    }
    if distance <= budget {
        return reported;
    }
    let scale = budget / distance;
    Vector3 {
        x: server.x + dx * scale,
        y: server.y + dy * scale,
        z: server.z + dz * scale,
    }
}

fn sanitize_body(mut body: BodyState, state: KinematicState) -> BodyState {
    body.position = Some(proto_vector(state.position));
    body.velocity = Some(proto_vector(state.velocity));
    body.forward = body.forward.filter(finite).or(Some(Vec3 {
        x: 0.0,
        y: 0.0,
        z: -1.0,
    }));
    body.up = body.up.filter(finite).or(Some(Vec3 {
        x: 0.0,
        y: 1.0,
        z: 0.0,
    }));
    body
}

fn valid_body(body: &BodyState) -> bool {
    body.position.as_ref().is_some_and(|value| {
        finite(value)
            && value.x.abs() <= 100_000_000.0
            && value.y.abs() <= 100_000_000.0
            && value.z.abs() <= 100_000_000.0
    }) && body.forward.as_ref().is_none_or(finite)
        && body.up.as_ref().is_none_or(finite)
        && body.velocity.as_ref().is_none_or(finite)
}

fn finite_velocity(value: Vector3, in_ship: bool) -> bool {
    let limit = if in_ship {
        DEFAULT_SHIP_MAX_SPEED_MPS * 2.0
    } else {
        DEFAULT_CHARACTER_MAX_SPEED_MPS * 2.0
    };
    value.x.is_finite()
        && value.y.is_finite()
        && value.z.is_finite()
        && value.x.abs() <= limit
        && value.y.abs() <= limit
        && value.z.abs() <= limit
}

fn cell_checkpoint(spawn: &CellSpawn, entities: &HashMap<String, Entity>, tick: u64) -> Vec<u8> {
    CellCheckpoint {
        tick,
        epoch: spawn.epoch,
        cell_id: spawn.cell_id.clone(),
        entities: entities
            .values()
            .map(|entity| CheckpointEntity {
                id: entity.player_id.clone(),
                display_name: entity.display_name.clone(),
                character_appearance_json: entity.appearance_json.clone(),
                mode: entity.mode.clone(),
                character: entity.character.clone(),
                ship: entity.ship.clone(),
                ship_rig: entity.ship_rig.clone(),
                station_room_id: entity.station_room_id.clone(),
                ship_zone_id: entity.ship_zone_id.clone(),
            })
            .collect(),
    }
    .encode_to_vec()
}

async fn checkpoint(
    spawn: &CellSpawn,
    entities: &HashMap<String, Entity>,
    tick: u64,
) -> ApiResult<()> {
    let payload = cell_checkpoint(spawn, entities, tick);
    save_checkpoint(&spawn.db, &spawn.cell_id, spawn.epoch, tick, payload).await
}

fn spawn_checkpoint(spawn: &CellSpawn, entities: &HashMap<String, Entity>, tick: u64) {
    let payload = cell_checkpoint(spawn, entities, tick);
    let db = spawn.db.clone();
    let cell_id = spawn.cell_id.clone();
    let epoch = spawn.epoch;
    tokio::spawn(async move {
        let result = save_checkpoint(&db, &cell_id, epoch, tick, payload).await;
        if let Err(error) = result {
            tracing::error!(cell_id, error = ?error, "cell checkpoint failed");
        }
    });
}

async fn save_checkpoint(
    db: &PgPool,
    cell_id: &str,
    epoch: u64,
    tick: u64,
    payload: Vec<u8>,
) -> ApiResult<()> {
    sqlx::query(r#"INSERT INTO "SimulationCellSnapshot" ("cellId","epoch","tick","protocolVersion","simulationVersion","payload","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT ("cellId") DO UPDATE SET "epoch"=EXCLUDED."epoch","tick"=EXCLUDED."tick","protocolVersion"=EXCLUDED."protocolVersion","simulationVersion"=EXCLUDED."simulationVersion","payload"=EXCLUDED."payload","updatedAt"=NOW() WHERE "SimulationCellSnapshot"."epoch" <= EXCLUDED."epoch""#).bind(cell_id).bind(epoch as i64).bind(tick as i64).bind(PROTOCOL_VERSION as i32).bind(SIMULATION_VERSION as i32).bind(payload).execute(db).await?;
    Ok(())
}

async fn restore_cell(
    db: &PgPool,
    cell_id: &str,
    epoch: u64,
) -> ApiResult<(AuthorityWorld, HashMap<String, Entity>, u64)> {
    let mut authority = AuthorityWorld::new(FIXED_DT_SECONDS);
    let Some(row)=sqlx::query(r#"SELECT "tick","protocolVersion","simulationVersion","payload" FROM "SimulationCellSnapshot" WHERE "cellId"=$1"#).bind(cell_id).fetch_optional(db).await? else{return Ok((authority,HashMap::new(),0))};
    if row.try_get::<i32, _>("protocolVersion")? != PROTOCOL_VERSION as i32
        || row.try_get::<i32, _>("simulationVersion")? != SIMULATION_VERSION as i32
    {
        return Ok((authority, HashMap::new(), 0));
    }
    let checkpoint = CellCheckpoint::decode(row.try_get::<Vec<u8>, _>("payload")?.as_slice())
        .map_err(anyhow::Error::from)?;
    let mut entities = HashMap::new();
    for item in checkpoint.entities {
        let state = item
            .ship
            .as_ref()
            .and_then(|ship| ship.body.as_ref())
            .or(item.character.as_ref())
            .and_then(|body| body.position.as_ref())
            .map(vector)
            .unwrap_or_default();
        authority.ensure_character(
            &item.id,
            KinematicState {
                position: state,
                velocity: Vector3::default(),
            },
        );
        entities.insert(
            item.id.clone(),
            Entity {
                player_id: item.id,
                display_name: item.display_name,
                appearance_json: item.character_appearance_json,
                mode: item.mode,
                character: item.character,
                ship: item.ship,
                ship_rig: item.ship_rig,
                station_room_id: item.station_room_id,
                ship_zone_id: item.ship_zone_id,
                accepted_sequence: 0,
                last_reconciled_sequence: 0,
                last_reconcile_tick: checkpoint.tick,
                last_seen_tick: checkpoint.tick,
                desired_velocity: Vector3::default(),
            },
        );
    }
    tracing::info!(
        cell_id,
        epoch,
        restored_tick = checkpoint.tick,
        "restored authoritative cell"
    );
    Ok((authority, entities, checkpoint.tick))
}

fn remove_stale_entities(
    fanout: &mpsc::Sender<Vec<u8>>,
    authority: &mut AuthorityWorld,
    entities: &mut HashMap<String, Entity>,
    tick: u64,
) {
    let stale: Vec<String> = entities
        .iter()
        .filter(|(_, entity)| tick.saturating_sub(entity.last_seen_tick) > ENTITY_TIMEOUT_TICKS)
        .map(|(id, _)| id.clone())
        .collect();
    for id in stale {
        authority.remove(&id);
        entities.remove(&id);
        let message = ServerEnvelope {
            protocol_version: PROTOCOL_VERSION,
            payload: Some(server_envelope::Payload::EntityRemove(EntityRemove { id })),
        };
        publish(fanout, encode_message(&message));
    }
}

async fn renew_lease(spawn: &CellSpawn) -> Result<bool, redis::RedisError> {
    let script = redis::Script::new(
        r#"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end"#,
    );
    let mut redis = spawn.redis.clone();
    let renewed: i32 = script
        .key(lease_key(&spawn.cell_id))
        .arg(&spawn.lease_token)
        .arg(CELL_LEASE_MS)
        .invoke_async(&mut redis)
        .await?;
    Ok(renewed == 1)
}

fn spawn_command_stream_reader(
    client: redis::Client,
    cell_id: String,
    sender: mpsc::Sender<RoutedCommand>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let Ok(mut connection) = client.get_multiplexed_async_connection().await else {
            return;
        };
        let key = command_stream_key(&cell_id);
        let mut last_id = "$".to_owned();
        loop {
            let options = StreamReadOptions::default().block(500).count(128);
            let reply: Result<Option<StreamReadReply>, _> = connection
                .xread_options(&[&key], &[&last_id], &options)
                .await;
            let Ok(Some(reply)) = reply else { continue };
            for stream in reply.keys {
                for item in stream.ids {
                    last_id = item.id;
                    let Some(value) = item.map.get("payload") else {
                        continue;
                    };
                    let Ok(payload) = redis::from_redis_value::<Vec<u8>>(value.clone()) else {
                        continue;
                    };
                    let Ok(command) = serde_json::from_slice::<RoutedCommand>(&payload) else {
                        continue;
                    };
                    if sender.send(command).await.is_err() {
                        return;
                    }
                }
            }
        }
    })
}

fn lease_key(cell_id: &str) -> String {
    format!("cc:cell:lease:{cell_id}")
}

fn command_stream_key(cell_id: &str) -> String {
    format!("cc:cell:commands:{cell_id}")
}

fn snapshot_channel(cell_id: &str) -> String {
    format!("cc:cell:snapshots:{cell_id}")
}
