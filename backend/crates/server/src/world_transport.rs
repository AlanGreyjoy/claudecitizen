//! The edge: one WebTransport session per player.
//!
//! An edge session is not a relay. It claims authority for the cell its viewer
//! stands in, observes the whole neighbourhood around it, and runs a
//! `Replicator` that decides what *this* viewer needs to know. Cells publish
//! world state; edges publish viewer state.

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
    world::{ClientEnvelope, Ready, ServerEnvelope, Vec3, client_envelope, server_envelope},
};
use prost::Message;
use rand::RngCore;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use tokio::{
    sync::mpsc,
    time::{MissedTickBehavior, interval},
};
use url::Url;
use wtransport::{Connection, Endpoint, Identity, ServerConfig, endpoint::IncomingSession};

use crate::{
    auth::{AccessUser, rate_limit, require_player_id},
    cell::{CellSubscription, RoutedCommand},
    error::{ApiError, ApiResult},
    grid::{CellAddress, CellGrid, grid_for},
    replication::Replicator,
    state::AppState,
};

const TICKET_TTL_SECONDS: u64 = 30;
/// Viewer frames are produced on the edge's own clock, not on cell arrivals: a
/// viewer holding nine cells would otherwise get nine frames per cell tick.
const EMIT_INTERVAL_MS: u64 = 50;
/// A cell whose owner died leaves an expired lease behind. Re-claiming on a
/// timer is what turns that into a two-second gap instead of a dead cell.
const CLAIM_INTERVAL_SECONDS: u64 = 5;
/// Headroom under the negotiated datagram size for the QUIC framing the
/// application does not control.
const DATAGRAM_HEADROOM_BYTES: usize = 64;

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

/// Everything about where a viewer is and what they can see.
struct Session {
    state: AppState,
    ticket: SessionTicket,
    instance_id: String,
    station_room_id: String,
    grid: CellGrid,
    address: CellAddress,
    position: Option<Vec3>,
    replicator: Replicator,
}

impl Session {
    fn new(state: AppState, ticket: SessionTicket) -> Self {
        let grid = grid_for(&ticket.instance_id);
        let address = CellAddress::base(&ticket.instance_id, &ticket.station_room_id);
        Self {
            replicator: Replicator::new(ticket.player_id.clone(), grid),
            instance_id: ticket.instance_id.clone(),
            station_room_id: ticket.station_room_id.clone(),
            grid,
            address,
            position: None,
            state,
            ticket,
        }
    }

    fn cell_id(&self) -> String {
        self.address.id()
    }

    /// Take authority for the current cell and start listening to everything
    /// around it.
    async fn attach(&self) -> ApiResult<CellSubscription> {
        let neighbourhood = self.address.neighbourhood();
        self.state.cells.claim(&self.cell_id()).await?;
        self.state.cells.observe(&neighbourhood).await
    }

    async fn join(&self) -> ApiResult<()> {
        let join = ClientEnvelope {
            protocol_version: PROTOCOL_VERSION,
            payload: Some(client_envelope::Payload::Join(cc_protocol::world::Join {
                instance_id: self.instance_id.clone(),
                station_room_id: self.station_room_id.clone(),
            })),
        };
        submit(&self.state, &self.cell_id(), &self.ticket, &join).await
    }

    async fn leave(&self) -> ApiResult<()> {
        let leave = ClientEnvelope {
            protocol_version: PROTOCOL_VERSION,
            payload: Some(client_envelope::Payload::Leave(
                cc_protocol::world::Leave {},
            )),
        };
        submit(&self.state, &self.cell_id(), &self.ticket, &leave).await
    }

    /// Move the viewer to a different instance. Everything they could see
    /// belongs to the place they left, so the replicator starts over.
    async fn transition(
        &mut self,
        instance_id: String,
        station_room_id: String,
    ) -> ApiResult<CellSubscription> {
        authorize_instance(&self.ticket.player_id, &instance_id)?;
        self.leave().await?;
        self.instance_id = instance_id;
        self.station_room_id = station_room_id;
        self.grid = grid_for(&self.instance_id);
        self.address = CellAddress::base(&self.instance_id, &self.station_room_id);
        self.position = None;
        self.replicator.reset(self.grid);
        sqlx::query(
            r#"UPDATE "Player" SET "currentInstanceId"=$2,"currentRoomId"=$3,"updatedAt"=NOW() WHERE "id"=$1"#,
        )
        .bind(&self.ticket.player_id)
        .bind(&self.instance_id)
        .bind(&self.station_room_id)
        .execute(&self.state.db)
        .await?;
        let subscription = self.attach().await?;
        self.join().await?;
        Ok(subscription)
    }

    /// Follow the viewer across a cell boundary. Unlike a transition this keeps
    /// the replicator's state: the neighbourhoods overlap, so most of what the
    /// viewer can see is the same on both sides of the line.
    async fn migrate(&mut self) -> ApiResult<Option<CellSubscription>> {
        let next = self.address.advance(&self.grid, self.position.as_ref());
        if next == self.address {
            return Ok(None);
        }
        self.leave().await?;
        self.address = next;
        let subscription = self.attach().await?;
        self.replicator.retain_cells(&self.address.neighbourhood());
        self.join().await?;
        Ok(Some(subscription))
    }

    /// Fold one message published by a cell into this viewer's world.
    /// Returns anything that must be forwarded to the client verbatim.
    fn absorb(&mut self, envelope: ServerEnvelope) -> Option<ServerEnvelope> {
        match envelope.payload {
            Some(server_envelope::Payload::Snapshot(snapshot)) => {
                self.replicator.apply_cell_snapshot(snapshot);
                None
            }
            Some(server_envelope::Payload::EntityProfiles(profiles)) => {
                self.replicator.apply_profiles(profiles);
                None
            }
            Some(server_envelope::Payload::EntityRemove(remove)) => {
                self.replicator.apply_removal(&remove.id);
                None
            }
            // A reconcile is addressed to exactly one player and corrects their
            // own prediction; everyone else's is none of this viewer's business.
            Some(server_envelope::Payload::Reconcile(reconcile))
                if reconcile.player_id != self.ticket.player_id =>
            {
                None
            }
            payload => Some(ServerEnvelope {
                protocol_version: PROTOCOL_VERSION,
                payload,
            }),
        }
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

    let mut session = Session::new(state, ticket);
    let mut subscription = session.attach().await?;
    session.join().await?;

    let ready = ServerEnvelope {
        protocol_version: PROTOCOL_VERSION,
        payload: Some(server_envelope::Payload::Ready(Ready {
            player_id: session.ticket.player_id.clone(),
            node_id: session.state.config.node_id.clone(),
            simulation_version: SIMULATION_VERSION,
        })),
    };
    write_control(&mut send_stream, &ready).await?;

    let (control_sender, mut control_receiver) = mpsc::channel(64);
    tokio::spawn(read_control(recv_stream, control_sender));
    let mut emit = interval(Duration::from_millis(EMIT_INTERVAL_MS));
    emit.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut claim = interval(Duration::from_secs(CLAIM_INTERVAL_SECONDS));
    claim.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            maybe_envelope = control_receiver.recv() => {
                let Some(envelope) = maybe_envelope else { break };
                if let Some(next) = handle_client(&mut session, &envelope).await? {
                    subscription = next;
                }
            }
            datagram = connection.receive_datagram() => {
                let payload = datagram.context("receive WebTransport datagram")?;
                let envelope: ClientEnvelope = decode_datagram(&payload)?;
                if envelope.protocol_version != PROTOCOL_VERSION {
                    anyhow::bail!("protocol version mismatch");
                }
                if let Some(next) = handle_client(&mut session, &envelope).await? {
                    subscription = next;
                }
            }
            maybe_payload = subscription.receiver.recv() => {
                let Some(payload) = maybe_payload else {
                    subscription = session.attach().await?;
                    continue;
                };
                let Ok(envelope) = ServerEnvelope::decode(payload.as_slice()) else { continue };
                if let Some(forward) = session.absorb(envelope) {
                    write_control(&mut send_stream, &forward).await?;
                }
            }
            _ = emit.tick() => {
                publish_frame(&mut session, &connection, &mut send_stream).await?;
            }
            _ = claim.tick() => {
                session.state.cells.claim(&session.cell_id()).await?;
            }
        }
    }
    session.leave().await?;
    Ok(())
}

/// Route one client message, returning a new subscription when the message
/// moved the viewer to a different cell.
async fn handle_client(
    session: &mut Session,
    envelope: &ClientEnvelope,
) -> Result<Option<CellSubscription>> {
    if let Some(client_envelope::Payload::Transition(transition)) = envelope.payload.as_ref() {
        let subscription = session
            .transition(
                transition.instance_id.clone(),
                transition.station_room_id.clone(),
            )
            .await?;
        return Ok(Some(subscription));
    }
    if matches!(
        envelope.payload.as_ref(),
        Some(client_envelope::Payload::ChatSend(_))
    ) {
        rate_limit(
            &session.state,
            &format!("world-chat:{}", session.ticket.player_id),
            20,
            10,
        )
        .await?;
    }
    if let Some(position) = presence_position(envelope) {
        session.position = Some(*position);
    }
    let migrated = session.migrate().await?;
    submit(
        &session.state,
        &session.cell_id(),
        &session.ticket,
        envelope,
    )
    .await?;
    Ok(migrated)
}

async fn publish_frame(
    session: &mut Session,
    connection: &Connection,
    send_stream: &mut wtransport::SendStream,
) -> Result<()> {
    let budget = connection
        .max_datagram_size()
        .unwrap_or(0)
        .min(MAX_DATAGRAM_BYTES)
        .saturating_sub(DATAGRAM_HEADROOM_BYTES);
    let position = session.position;
    let Some(frame) = session.replicator.emit(position.as_ref(), budget) else {
        return Ok(());
    };
    let envelope = ServerEnvelope {
        protocol_version: PROTOCOL_VERSION,
        payload: Some(server_envelope::Payload::Snapshot(frame.snapshot)),
    };
    let payload = encode_message(&envelope);
    // Structural frames, and anything the path will not carry, take the
    // reliable stream. Everything else is state churn: losing one costs 50 ms.
    if frame.reliable || payload.len() > budget {
        return write_raw_control(send_stream, &payload).await;
    }
    if let Err(error) = connection.send_datagram(&payload) {
        tracing::debug!(error = ?error, len = payload.len(), "snapshot datagram refused; using the control stream");
        return write_raw_control(send_stream, &payload).await;
    }
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
