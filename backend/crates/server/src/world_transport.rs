use std::time::Duration;

use anyhow::{Context, Result};
use axum::{Json, extract::State};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use cc_protocol::{
    MAX_DATAGRAM_BYTES, MAX_STREAM_FRAME_BYTES, PROTOCOL_VERSION, SIMULATION_VERSION,
    decode_datagram, encode_message, encode_stream_frame,
    world::{
        ClientEnvelope, NetworkLod, Ready, ServerEnvelope, Snapshot, Vec3, client_envelope,
        server_envelope,
    },
};
use prost::Message;
use rand::RngCore;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use tokio::sync::mpsc;
use url::Url;
use wtransport::{Endpoint, Identity, ServerConfig, endpoint::IncomingSession};

use crate::{
    auth::{AccessUser, rate_limit, require_player_id},
    cell::{CellSubscription, RoutedCommand, cell_id_for, cell_id_for_position},
    error::{ApiError, ApiResult},
    state::AppState,
};

const TICKET_TTL_SECONDS: u64 = 30;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTicket {
    player_id: String,
    display_name: String,
    appearance_json_base64: String,
    instance_id: String,
    station_room_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSessionResponse {
    url: String,
    ticket: String,
    certificate_hash_base64: Option<String>,
    protocol_version: u32,
    simulation_version: u32,
    expires_in_ms: u64,
}

pub async fn create_session(
    State(state): State<AppState>,
    access: AccessUser,
) -> ApiResult<Json<WorldSessionResponse>> {
    let player_id = require_player_id(&state, &access.user_id).await?;
    rate_limit(&state, &format!("world-ticket:{player_id}"), 30, 60).await?;
    let row = sqlx::query(
        r#"SELECT "displayName", "characterAppearance", "currentInstanceId", "currentRoomId"
           FROM "Player" WHERE "id" = $1"#,
    )
    .bind(&player_id)
    .fetch_one(&state.db)
    .await?;
    let appearance: Option<serde_json::Value> = row.try_get("characterAppearance")?;
    let ticket_value = SessionTicket {
        player_id,
        display_name: row.try_get("displayName")?,
        appearance_json_base64: appearance
            .map(|value| STANDARD.encode(serde_json::to_vec(&value).unwrap_or_default()))
            .unwrap_or_default(),
        instance_id: row.try_get("currentInstanceId")?,
        station_room_id: row.try_get("currentRoomId")?,
    };
    let ticket = random_ticket();
    let mut redis = state.redis.clone();
    let _: () = redis
        .set_ex(
            format!("cc:world:ticket:{ticket}"),
            serde_json::to_vec(&ticket_value).map_err(anyhow::Error::from)?,
            TICKET_TTL_SECONDS,
        )
        .await?;
    let info = state.transport.read().await.clone();
    if !info.listening {
        return Err(ApiError::Unavailable);
    }
    Ok(Json(WorldSessionResponse {
        url: info.url,
        ticket,
        certificate_hash_base64: info.certificate_hash_base64,
        protocol_version: PROTOCOL_VERSION,
        simulation_version: SIMULATION_VERSION,
        expires_in_ms: TICKET_TTL_SECONDS * 1_000,
    }))
}

pub async fn run(state: AppState) -> Result<()> {
    let (identity, certificate_hash_base64) = load_identity(&state).await?;
    let config = ServerConfig::builder()
        .with_bind_address(state.config.webtransport_bind)
        .with_identity(identity)
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();
    let endpoint = Endpoint::server(config).context("create WebTransport endpoint")?;
    {
        let mut info = state.transport.write().await;
        info.certificate_hash_base64 = certificate_hash_base64;
        info.listening = true;
    }
    tracing::info!(bind = %state.config.webtransport_bind, "WebTransport endpoint listening");
    loop {
        let incoming = endpoint.accept().await;
        let session_state = state.clone();
        tokio::spawn(async move {
            if let Err(error) = accept_session(session_state, incoming).await {
                tracing::warn!(error = ?error, "WebTransport session closed with error");
            }
        });
    }
}

async fn accept_session(state: AppState, incoming: IncomingSession) -> Result<()> {
    let request = incoming
        .await
        .context("read WebTransport session request")?;
    if request.origin() != Some(state.config.client_origin.as_str()) {
        request.forbidden().await;
        anyhow::bail!("WebTransport origin rejected");
    }
    let ticket_key = ticket_from_path(request.path()).context("world ticket is missing")?;
    let Some(ticket) = consume_ticket(&state, &ticket_key).await? else {
        request.forbidden().await;
        anyhow::bail!("world ticket is invalid or expired");
    };
    let connection = request
        .accept()
        .await
        .context("accept WebTransport session")?;
    let (mut send_stream, recv_stream) = connection
        .accept_bi()
        .await
        .context("accept control stream")?;
    let mut instance_id = ticket.instance_id.clone();
    let mut station_room_id = ticket.station_room_id.clone();
    let mut cell_id = cell_id_for(&instance_id, &station_room_id);
    let mut subscription = state.cells.subscribe(&cell_id).await?;
    let join = ClientEnvelope {
        protocol_version: PROTOCOL_VERSION,
        payload: Some(client_envelope::Payload::Join(cc_protocol::world::Join {
            instance_id: ticket.instance_id.clone(),
            station_room_id: ticket.station_room_id.clone(),
        })),
    };
    submit(&state, &cell_id, &ticket, &join).await?;
    let ready = ServerEnvelope {
        protocol_version: PROTOCOL_VERSION,
        payload: Some(server_envelope::Payload::Ready(Ready {
            player_id: ticket.player_id.clone(),
            node_id: state.config.node_id.clone(),
            simulation_version: SIMULATION_VERSION,
        })),
    };
    write_control(&mut send_stream, &ready).await?;
    let (control_sender, mut control_receiver) = mpsc::channel(64);
    tokio::spawn(read_control(recv_stream, control_sender));

    loop {
        tokio::select! {
            maybe_envelope = control_receiver.recv() => {
                let Some(envelope) = maybe_envelope else { break; };
                if let Some(client_envelope::Payload::Transition(transition)) = envelope.payload.as_ref() {
                    authorize_instance(&ticket.player_id, &transition.instance_id)?;
                    leave_cell(&state, &cell_id, &ticket).await?;
                    instance_id = transition.instance_id.clone();
                    station_room_id = transition.station_room_id.clone();
                    cell_id = cell_id_for(&instance_id, &station_room_id);
                    subscription = state.cells.subscribe(&cell_id).await?;
                    sqlx::query(r#"UPDATE "Player" SET "currentInstanceId"=$2,"currentRoomId"=$3,"updatedAt"=NOW() WHERE "id"=$1"#)
                        .bind(&ticket.player_id).bind(&transition.instance_id).bind(&transition.station_room_id).execute(&state.db).await?;
                    let join = ClientEnvelope { protocol_version: PROTOCOL_VERSION, payload: Some(client_envelope::Payload::Join(cc_protocol::world::Join { instance_id: transition.instance_id.clone(), station_room_id: transition.station_room_id.clone() })) };
                    submit(&state, &cell_id, &ticket, &join).await?;
                } else {
                    route_envelope(&state, &ticket, &instance_id, &station_room_id, &mut cell_id, &mut subscription, &envelope).await?;
                }
            }
            datagram = connection.receive_datagram() => {
                let payload = datagram.context("receive WebTransport datagram")?;
                let envelope: ClientEnvelope = decode_datagram(&payload)?;
                if envelope.protocol_version != PROTOCOL_VERSION { anyhow::bail!("protocol version mismatch"); }
                route_envelope(&state, &ticket, &instance_id, &station_room_id, &mut cell_id, &mut subscription, &envelope).await?;
            }
            maybe_payload = subscription.receiver.recv() => {
                let Some(payload) = maybe_payload else {
                    subscription = state.cells.subscribe(&cell_id).await?;
                    continue;
                };
                let Some(filtered) = filter_server_message(&payload, &ticket.player_id)? else { continue; };
                let envelope = ServerEnvelope::decode(filtered.as_slice())?;
                match envelope.payload {
                    Some(server_envelope::Payload::Snapshot(_)) | Some(server_envelope::Payload::Reconcile(_)) => {
                        if filtered.len() <= MAX_DATAGRAM_BYTES {
                            let _ = connection.send_datagram(filtered);
                        }
                    }
                    _ => write_raw_control(&mut send_stream, &filtered).await?,
                }
            }
        }
    }
    leave_cell(&state, &cell_id, &ticket).await?;
    Ok(())
}

async fn route_envelope(
    state: &AppState,
    ticket: &SessionTicket,
    instance_id: &str,
    station_room_id: &str,
    cell_id: &mut String,
    subscription: &mut CellSubscription,
    envelope: &ClientEnvelope,
) -> Result<()> {
    if matches!(
        envelope.payload.as_ref(),
        Some(client_envelope::Payload::ChatSend(_))
    ) {
        rate_limit(state, &format!("world-chat:{}", ticket.player_id), 20, 10).await?;
    }
    let target = presence_position(envelope)
        .map(|position| cell_id_for_position(instance_id, station_room_id, Some(position)));
    if let Some(target) = target.filter(|target| target.as_str() != cell_id.as_str()) {
        leave_cell(state, cell_id, ticket).await?;
        *cell_id = target;
        *subscription = state.cells.subscribe(cell_id).await?;
        let join = ClientEnvelope {
            protocol_version: PROTOCOL_VERSION,
            payload: Some(client_envelope::Payload::Join(cc_protocol::world::Join {
                instance_id: instance_id.to_owned(),
                station_room_id: station_room_id.to_owned(),
            })),
        };
        submit(state, cell_id, ticket, &join).await?;
    }
    submit(state, cell_id, ticket, envelope).await?;
    Ok(())
}

fn presence_position(envelope: &ClientEnvelope) -> Option<&Vec3> {
    let Some(client_envelope::Payload::PresenceIntent(intent)) = envelope.payload.as_ref() else {
        return None;
    };
    if intent.mode == "in-ship" {
        intent
            .ship
            .as_ref()
            .and_then(|ship| ship.body.as_ref())
            .and_then(|body| body.position.as_ref())
    } else {
        intent
            .character
            .as_ref()
            .and_then(|body| body.position.as_ref())
    }
}

async fn read_control(mut stream: wtransport::RecvStream, sender: mpsc::Sender<ClientEnvelope>) {
    let mut pending = Vec::<u8>::new();
    let mut chunk = vec![0_u8; 16 * 1024];
    loop {
        let read = match stream.read(&mut chunk).await {
            Ok(Some(read)) => read,
            _ => return,
        };
        pending.extend_from_slice(&chunk[..read]);
        loop {
            if pending.len() < 4 {
                break;
            }
            let len = u32::from_be_bytes(pending[..4].try_into().unwrap_or_default()) as usize;
            if len > MAX_STREAM_FRAME_BYTES {
                return;
            }
            if pending.len() < len + 4 {
                break;
            }
            let frame = pending[4..4 + len].to_vec();
            pending.drain(..4 + len);
            let Ok(envelope) = ClientEnvelope::decode(frame.as_slice()) else {
                return;
            };
            if envelope.protocol_version != PROTOCOL_VERSION || sender.send(envelope).await.is_err()
            {
                return;
            }
        }
    }
}

async fn write_control(
    stream: &mut wtransport::SendStream,
    envelope: &ServerEnvelope,
) -> Result<()> {
    let frame = encode_stream_frame(envelope)?;
    stream.write_all(&frame).await?;
    Ok(())
}

async fn write_raw_control(stream: &mut wtransport::SendStream, payload: &[u8]) -> Result<()> {
    if payload.len() > MAX_STREAM_FRAME_BYTES {
        anyhow::bail!("control frame too large");
    }
    stream
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await?;
    stream.write_all(payload).await?;
    Ok(())
}

async fn submit(
    state: &AppState,
    cell_id: &str,
    ticket: &SessionTicket,
    envelope: &ClientEnvelope,
) -> ApiResult<()> {
    state
        .cells
        .submit(
            cell_id,
            RoutedCommand {
                player_id: ticket.player_id.clone(),
                display_name: ticket.display_name.clone(),
                appearance_json_base64: ticket.appearance_json_base64.clone(),
                envelope_base64: STANDARD.encode(encode_message(envelope)),
            },
        )
        .await
}

async fn leave_cell(state: &AppState, cell_id: &str, ticket: &SessionTicket) -> ApiResult<()> {
    let leave = ClientEnvelope {
        protocol_version: PROTOCOL_VERSION,
        payload: Some(client_envelope::Payload::Leave(
            cc_protocol::world::Leave {},
        )),
    };
    submit(state, cell_id, ticket, &leave).await
}

fn filter_server_message(payload: &[u8], player_id: &str) -> Result<Option<Vec<u8>>> {
    let mut envelope = ServerEnvelope::decode(payload)?;
    match envelope.payload.as_mut() {
        Some(server_envelope::Payload::Reconcile(reconcile))
            if reconcile.player_id != player_id =>
        {
            return Ok(None);
        }
        Some(server_envelope::Payload::Snapshot(snapshot)) => filter_snapshot(snapshot, player_id),
        _ => {}
    }
    Ok(Some(envelope.encode_to_vec()))
}

fn filter_snapshot(snapshot: &mut Snapshot, player_id: &str) {
    let viewer = snapshot
        .entities
        .iter()
        .find(|entity| entity.player_id == player_id)
        .and_then(entity_position)
        .cloned();
    let is_planet = snapshot.cell_id.starts_with("planet:");
    let is_space = snapshot.cell_id.starts_with("space:");
    let tick = snapshot.tick;
    snapshot.entities.retain_mut(|entity| {
        if entity.player_id == player_id {
            return false;
        }
        let entity_point = entity_position(entity).cloned();
        let distance = viewer
            .as_ref()
            .zip(entity_point.as_ref())
            .map(|(a, b)| distance(a, b));
        if let Some(distance) = distance {
            if is_planet && distance > 50_000.0 {
                return false;
            }
            if is_space && distance > 500_000.0 {
                return false;
            }
            let lod = if distance <= 250.0 {
                NetworkLod::Full
            } else if distance <= 2_500.0 {
                NetworkLod::Medium
            } else {
                NetworkLod::Marker
            };
            if (lod == NetworkLod::Medium && !tick.is_multiple_of(2))
                || (lod == NetworkLod::Marker && !tick.is_multiple_of(10))
            {
                return false;
            }
            entity.lod = lod as i32;
            if lod == NetworkLod::Marker {
                entity.character = None;
                entity.ship = None;
                entity.ship_rig = None;
                entity.character_appearance_json.clear();
            } else if lod == NetworkLod::Medium {
                entity.ship_rig = None;
            }
        }
        true
    });
}

fn entity_position(entity: &cc_protocol::world::SnapshotEntity) -> Option<&Vec3> {
    entity
        .ship
        .as_ref()
        .and_then(|ship| ship.body.as_ref())
        .and_then(|body| body.position.as_ref())
        .or_else(|| {
            entity
                .character
                .as_ref()
                .and_then(|body| body.position.as_ref())
        })
        .or(entity.marker_position.as_ref())
}

fn distance(left: &Vec3, right: &Vec3) -> f64 {
    ((left.x - right.x).powi(2) + (left.y - right.y).powi(2) + (left.z - right.z).powi(2)).sqrt()
}

fn authorize_instance(player_id: &str, instance_id: &str) -> ApiResult<()> {
    for prefix in ["apartment:", "hangar:"] {
        if let Some(owner) = instance_id.strip_prefix(prefix)
            && owner != player_id
        {
            return Err(ApiError::Forbidden(
                "Private instance access denied.".to_owned(),
            ));
        }
    }
    Ok(())
}

async fn consume_ticket(state: &AppState, ticket: &str) -> Result<Option<SessionTicket>> {
    let mut redis = state.redis.clone();
    let value: Option<Vec<u8>> = redis::cmd("GETDEL")
        .arg(format!("cc:world:ticket:{ticket}"))
        .query_async(&mut redis)
        .await?;
    value
        .map(|value| serde_json::from_slice(&value).map_err(anyhow::Error::from))
        .transpose()
}

fn ticket_from_path(path: &str) -> Option<String> {
    let url = Url::parse(&format!("https://localhost{path}")).ok()?;
    if url.path() != "/world" {
        return None;
    }
    url.query_pairs()
        .find(|(key, _)| key == "ticket")
        .map(|(_, value)| value.into_owned())
}

async fn load_identity(state: &AppState) -> Result<(Identity, Option<String>)> {
    if let (Some(cert), Some(key)) = (
        &state.config.webtransport_cert_path,
        &state.config.webtransport_key_path,
    ) {
        return Ok((Identity::load_pemfiles(cert, key).await?, None));
    }
    let identity = Identity::self_signed(["localhost", "127.0.0.1", "::1"])?;
    let certificate = identity
        .certificate_chain()
        .as_slice()
        .first()
        .context("self-signed certificate chain is empty")?;
    let digest = Sha256::digest(certificate.der());
    Ok((identity, Some(STANDARD.encode(digest))))
}

fn random_ticket() -> String {
    let mut value = [0_u8; 32];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}
