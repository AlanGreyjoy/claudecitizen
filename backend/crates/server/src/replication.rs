//! Per-viewer interest management and delta encoding.
//!
//! One of these lives per WebTransport connection. It consumes the raw
//! authoritative state of every cell in the viewer's interest set and produces
//! the smallest frame that keeps *that* viewer correct:
//!
//! * identity and appearance are sent **once**, when an entity enters the
//!   interest set, and never again — repeating a kilobyte of appearance JSON in
//!   every snapshot is what used to push a two-player cell past the datagram
//!   MTU and silently blank out everyone;
//! * entity state is sent only when it actually changed, at a cadence that
//!   drops off with distance;
//! * entities are addressed by a small per-connection handle rather than a
//!   36-byte UUID repeated per entity per tick.
//!
//! Frames split across the two QUIC paths by *kind*, not by size: anything
//! structural (a baseline, an entity entering, an entity leaving) goes on the
//! reliable stream where it cannot be lost, and pure state churn goes in a
//! datagram where losing one is harmless because another follows in 50 ms.

use std::collections::HashMap;

use cc_protocol::world::{
    EntityProfile, EntityProfiles, NetworkLod, ReplicatedEntity, Snapshot, Vec3,
};
use prost::Message;

use crate::grid::{CellGrid, distance, finite};

/// Positions below this differ only by integrator noise. Without it "has this
/// entity changed?" is always true for a standing character and the delta
/// encoding does nothing.
const POSITION_EPSILON: f64 = 0.001;
/// Header, cell id and the repeated-field tags around the entity list.
const FRAME_OVERHEAD_BYTES: usize = 64;

#[derive(Default)]
struct CellView {
    epoch: u64,
    entities: HashMap<String, ReplicatedEntity>,
}

struct Tracked {
    handle: u32,
    last_sent_tick: u64,
    last_state: ReplicatedEntity,
}

pub struct Replicator {
    viewer_id: String,
    grid: CellGrid,
    cells: HashMap<String, CellView>,
    profiles: HashMap<String, EntityProfile>,
    tracked: HashMap<String, Tracked>,
    next_handle: u32,
    tick: u64,
    pending_baseline: bool,
}

/// A frame ready to go out, and the path it must take.
pub struct Frame {
    pub snapshot: Snapshot,
    /// Structural frames cannot be dropped: an entity that entered or left is
    /// not restated by the next tick the way a position is.
    pub reliable: bool,
}

impl Replicator {
    pub fn new(viewer_id: String, grid: CellGrid) -> Self {
        Self {
            viewer_id,
            grid,
            cells: HashMap::new(),
            profiles: HashMap::new(),
            tracked: HashMap::new(),
            next_handle: 1,
            tick: 0,
            pending_baseline: true,
        }
    }

    /// A transition rebuilds the world from scratch: different cells, and a
    /// viewer who must not keep rendering anyone from the place they left.
    pub fn reset(&mut self, grid: CellGrid) {
        self.grid = grid;
        self.cells.clear();
        self.profiles.clear();
        self.tracked.clear();
        self.pending_baseline = true;
    }

    pub fn apply_cell_snapshot(&mut self, snapshot: Snapshot) {
        let view = self.cells.entry(snapshot.cell_id.clone()).or_default();
        if snapshot.epoch < view.epoch {
            return;
        }
        view.epoch = snapshot.epoch;
        view.entities = snapshot
            .entities
            .into_iter()
            .map(|entity| (entity.id.clone(), entity))
            .collect();
    }

    pub fn apply_profiles(&mut self, profiles: EntityProfiles) {
        for profile in profiles.profiles {
            self.profiles.insert(profile.id.clone(), profile);
        }
    }

    pub fn apply_removal(&mut self, id: &str) {
        for view in self.cells.values_mut() {
            view.entities.remove(id);
        }
        self.profiles.remove(id);
    }

    /// Forget cells that fell out of the interest set, so a viewer walking away
    /// stops holding their entities alive.
    pub fn retain_cells(&mut self, keep: &[String]) {
        self.cells.retain(|id, _| keep.iter().any(|k| k == id));
    }

    /// Build the next frame for this viewer, or `None` when nothing changed.
    ///
    /// `budget` is the number of bytes a datagram can actually carry on this
    /// connection right now — not a protocol constant.
    pub fn emit(&mut self, viewer: Option<&Vec3>, budget: usize) -> Option<Frame> {
        self.tick = self.tick.saturating_add(1);
        let baseline = std::mem::take(&mut self.pending_baseline);
        let candidates = self.candidates(viewer);
        let live: Vec<String> = candidates.iter().map(|(id, _, _)| id.clone()).collect();

        let removed = self.retire(&live);
        let mut profiles = Vec::new();
        let mut entities = Vec::new();
        let mut used = FRAME_OVERHEAD_BYTES;

        for (id, state, range) in candidates {
            let known = self
                .tracked
                .get(&id)
                .map(|tracked| (tracked.handle, tracked.last_sent_tick, tracked.last_state.clone()));
            let handle = known.as_ref().map_or(self.next_handle, |known| known.0);
            // Normalise before comparing: what is stored is what was sent, so
            // the handle must be set and the internal id cleared on both sides.
            let mut state = state;
            state.handle = handle;
            state.id = String::new();

            let due = match &known {
                None => true,
                Some((_, last_sent_tick, last_state)) => {
                    baseline
                        || (changed(last_state, &state)
                            && self.tick.saturating_sub(*last_sent_tick)
                                >= self.grid.send_interval(range))
                }
            };
            if !due {
                continue;
            }

            let profile = known.is_none().then(|| self.profile_for(&id, handle));
            let cost = state.encoded_len()
                + 4
                + profile
                    .as_ref()
                    .map_or(0, |profile| profile.encoded_len() + 4);
            // A baseline is complete by definition, so it is never trimmed; it
            // rides the reliable stream where size is not the constraint.
            if !baseline && used + cost > budget && !entities.is_empty() {
                continue;
            }
            used += cost;
            if let Some(profile) = profile {
                self.next_handle = self.next_handle.saturating_add(1);
                profiles.push(profile);
            }
            self.tracked.insert(
                id,
                Tracked {
                    handle,
                    last_sent_tick: self.tick,
                    last_state: state.clone(),
                },
            );
            entities.push(state);
        }

        if entities.is_empty() && profiles.is_empty() && removed.is_empty() && !baseline {
            return None;
        }
        let reliable = baseline || !profiles.is_empty() || !removed.is_empty();
        Some(Frame {
            snapshot: Snapshot {
                now_ms: chrono::Utc::now().timestamp_millis().max(0) as u64,
                tick: self.tick,
                epoch: self.cells.values().map(|view| view.epoch).max().unwrap_or(0),
                cell_id: String::new(),
                entities,
                profiles,
                removed_handles: removed,
                baseline,
            },
            reliable,
        })
    }

    /// Everything in the interest set right now, nearest first so that when a
    /// frame has to be trimmed it is the far-away entities that wait.
    fn candidates(&self, viewer: Option<&Vec3>) -> Vec<(String, ReplicatedEntity, f64)> {
        let viewer = viewer.filter(|value| finite(value));
        // Keyed by id: during a cell migration the same entity can briefly
        // appear in two of the cells this viewer holds, and replicating it
        // twice would burn a handle and a slot on a duplicate.
        let mut nearest: HashMap<String, (ReplicatedEntity, f64)> = HashMap::new();
        for view in self.cells.values() {
            for (id, entity) in &view.entities {
                if id == &self.viewer_id {
                    continue;
                }
                // Hold an entity back until its identity arrives — a body with
                // no appearance renders as an invisible mannequin, which looks
                // exactly like the bug this replaces. The cell republishes
                // profiles every second, so the wait is bounded.
                if !self.profiles.contains_key(id) {
                    continue;
                }
                let range = viewer
                    .zip(position_of(entity))
                    .map(|(viewer, point)| distance(viewer, point))
                    .unwrap_or(0.0);
                if range > self.grid.interest {
                    continue;
                }
                let candidate = (detail(entity.clone(), self.grid.lod(range)), range);
                nearest
                    .entry(id.clone())
                    .and_modify(|held| {
                        if range < held.1 {
                            *held = candidate.clone();
                        }
                    })
                    .or_insert(candidate);
            }
        }
        let mut out: Vec<(String, ReplicatedEntity, f64)> = nearest
            .into_iter()
            .map(|(id, (entity, range))| (id, entity, range))
            .collect();
        out.sort_by(|left, right| left.2.total_cmp(&right.2));
        out
    }

    /// Drop everyone who left the interest set and hand back their handles for
    /// the viewer to forget. Handles are never reissued inside a session: a
    /// recycled handle plus one lost frame is a player wearing someone else's
    /// body.
    fn retire(&mut self, live: &[String]) -> Vec<u32> {
        let gone: Vec<String> = self
            .tracked
            .keys()
            .filter(|id| !live.iter().any(|live| live == *id))
            .cloned()
            .collect();
        gone.iter()
            .filter_map(|id| self.tracked.remove(id).map(|tracked| tracked.handle))
            .collect()
    }

    fn profile_for(&self, id: &str, handle: u32) -> EntityProfile {
        let known = self.profiles.get(id);
        EntityProfile {
            handle,
            id: id.to_owned(),
            player_id: known.map_or_else(|| id.to_owned(), |profile| profile.player_id.clone()),
            display_name: known.map(|profile| profile.display_name.clone()).unwrap_or_default(),
            character_appearance_json: known
                .map(|profile| profile.character_appearance_json.clone())
                .unwrap_or_default(),
        }
    }
}

/// Strip what the viewer cannot resolve at this distance.
fn detail(mut entity: ReplicatedEntity, lod: NetworkLod) -> ReplicatedEntity {
    entity.lod = lod as i32;
    match lod {
        NetworkLod::Marker => {
            entity.character = None;
            entity.ship = None;
            entity.ship_rig = None;
        }
        NetworkLod::Medium => entity.ship_rig = None,
        _ => {}
    }
    entity
}

fn position_of(entity: &ReplicatedEntity) -> Option<&Vec3> {
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

/// Everything except position compares exactly; position gets an epsilon so a
/// standing character does not look like it changed every single tick and
/// defeat the whole point of a delta.
fn changed(previous: &ReplicatedEntity, next: &ReplicatedEntity) -> bool {
    let moved = moved_further_than(position_of(previous), position_of(next), POSITION_EPSILON);
    if moved {
        return true;
    }
    let (mut a, mut b) = (previous.clone(), next.clone());
    blank_positions(&mut a);
    blank_positions(&mut b);
    a != b
}

fn moved_further_than(previous: Option<&Vec3>, next: Option<&Vec3>, epsilon: f64) -> bool {
    match (previous, next) {
        (Some(previous), Some(next)) => distance(previous, next) > epsilon,
        (None, None) => false,
        _ => true,
    }
}

/// Clears every field the epsilon comparison already covered — including the
/// marker, which tracks the body and would otherwise re-report every entity the
/// epsilon just decided had not moved.
fn blank_positions(entity: &mut ReplicatedEntity) {
    entity.marker_position = None;
    if let Some(character) = entity.character.as_mut() {
        character.position = None;
    }
    if let Some(body) = entity.ship.as_mut().and_then(|ship| ship.body.as_mut()) {
        body.position = None;
    }
}
