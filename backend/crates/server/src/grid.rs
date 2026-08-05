//! Cell geometry and interest radii.
//!
//! Two concepts used to be the same number here, and conflating them is what
//! made players standing next to each other invisible: an **authority cell** is
//! the sharding unit for simulation, and an **interest radius** is how far one
//! viewer can see. Presence only ever crossed the cell channel, so the effective
//! view distance was "same bucket" — two players ten metres apart but either
//! side of a bucket edge shared nothing, with a healthy connection throughout.
//!
//! They are separate now, tied by one invariant:
//!
//! > `interest <= size`
//!
//! which guarantees a viewer's interest sphere is always covered by the 3x3x3
//! neighbourhood of the cell they stand in. The edge subscribes to that
//! neighbourhood, so cell edges stop being visibility walls, and the bound on
//! how many cells one connection can ever hold stays at 27.

use cc_protocol::world::Vec3;

/// Fraction of a cell's edge length a viewer must travel *past* a boundary
/// before authority migrates. Without it, standing on a boundary re-subscribes
/// and re-baselines every frame.
const HYSTERESIS_FRACTION: f64 = 0.02;

#[derive(Clone, Copy, Debug)]
pub struct CellGrid {
    /// Edge length of one authority cell in metres, or `None` for instances
    /// that are a single unpartitioned cell (interiors: apartments, hangars,
    /// station rooms, shared scenes).
    pub size: Option<f64>,
    /// Furthest an entity can be replicated at all. Never exceeds `size`.
    pub interest: f64,
    /// Inside this radius an on-foot entity replicates without its ship rig.
    pub medium: f64,
    /// Inside this radius an on-foot entity replicates in full.
    pub full: f64,
    /// `medium` for an entity flying a ship.
    pub ship_medium: f64,
    /// `full` for an entity flying a ship.
    pub ship_full: f64,
}

impl CellGrid {
    /// LOD bands for one entity, chosen by whether it is a character or a ship.
    ///
    /// One set of radii for both is what made a peer's ship vanish: a hull is
    /// two orders of magnitude larger than a person and is flown at speeds that
    /// cross a character's whole `full` band in a second, so a station instance
    /// tuned for walking (250 m / 2.5 km) stripped every ship overhead down to a
    /// marker. Bands are per-entity, not per-instance, because a station cell
    /// legitimately holds both.
    fn bands(&self, in_ship: bool) -> (f64, f64) {
        if in_ship {
            (self.ship_full, self.ship_medium)
        } else {
            (self.full, self.medium)
        }
    }

    /// Ticks between sends for an entity at this distance. Distant entities
    /// still move, they just cost a fraction of the bandwidth to watch.
    pub fn send_interval(&self, distance: f64, in_ship: bool) -> u64 {
        let (full, medium) = self.bands(in_ship);
        if distance <= full {
            1
        } else if distance <= medium {
            2
        } else {
            10
        }
    }

    pub fn lod(&self, distance: f64, in_ship: bool) -> cc_protocol::world::NetworkLod {
        use cc_protocol::world::NetworkLod;
        let (full, medium) = self.bands(in_ship);
        if distance <= full {
            NetworkLod::Full
        } else if distance <= medium {
            NetworkLod::Medium
        } else {
            NetworkLod::Marker
        }
    }

    fn hysteresis(&self) -> f64 {
        self.size.unwrap_or(0.0) * HYSTERESIS_FRACTION
    }
}

/// Interiors are one cell: a hab module or a shared scene is small enough that
/// everyone in it is mutually interesting, and partitioning it would only
/// reintroduce interior walls that block sight.
/// Ship bands are deliberately generous next to the character ones. A station
/// instance is not only its rooms — it is the volume ships fly through to reach
/// them, and `interest` is unbounded here precisely because everyone in the
/// instance is mutually interesting. Capping the ship bands below `interest`
/// would put the old vanishing act back, just further out.
const INTERIOR: CellGrid = CellGrid {
    size: None,
    interest: f64::INFINITY,
    medium: 2_500.0,
    full: 250.0,
    ship_medium: 50_000.0,
    ship_full: 5_000.0,
};

pub fn grid_for(instance_id: &str) -> CellGrid {
    if instance_id.starts_with("planet:") {
        return CellGrid {
            size: Some(50_000.0),
            interest: 50_000.0,
            medium: 2_500.0,
            full: 250.0,
            // Clamped by `interest`: a band past the cut is unreachable, and a
            // radius that reads as reachable but never fires is worse than none.
            ship_medium: 50_000.0,
            ship_full: 5_000.0,
        };
    }
    if instance_id.starts_with("space:") {
        return CellGrid {
            size: Some(500_000.0),
            interest: 500_000.0,
            medium: 25_000.0,
            full: 2_500.0,
            ship_medium: 250_000.0,
            ship_full: 25_000.0,
        };
    }
    INTERIOR
}

/// A cell identity that keeps its grid coordinates, so neighbours can be
/// enumerated without parsing them back out of the string id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellAddress {
    base: String,
    coords: Option<[i64; 3]>,
}

impl CellAddress {
    /// The cell a player lands in when only their instance is known — on
    /// connect, and for every interior.
    pub fn base(instance_id: &str, station_room_id: &str) -> Self {
        let base = if instance_id == "station:public" && !station_room_id.is_empty() {
            format!("{instance_id}:{station_room_id}")
        } else {
            instance_id.to_owned()
        };
        Self { base, coords: None }
    }

    /// Where authority should sit given a new position.
    ///
    /// A session starts with no coordinates at all — a ticket says which
    /// instance a player is in, never where in it — so the first position fix
    /// resolves the cell outright. After that the viewer keeps their current
    /// cell until they are clearly inside the next one, because a boundary
    /// without hysteresis re-subscribes and re-baselines every frame you stand
    /// on it.
    pub fn advance(&self, grid: &CellGrid, position: Option<&Vec3>) -> Self {
        let (Some(size), Some(position)) = (grid.size, position.filter(|value| finite(value)))
        else {
            return self.clone();
        };
        let next = coords_of(position, size);
        if self
            .coords
            .is_some_and(|current| next == current || within(position, current, size, grid.hysteresis()))
        {
            return self.clone();
        }
        Self {
            base: self.base.clone(),
            coords: Some(next),
        }
    }

    /// Every cell a viewer standing in this one could possibly need.
    ///
    /// Deliberately a function of the cell and not of the exact position: the
    /// `interest <= size` invariant means the 3x3x3 neighbourhood always covers
    /// the interest sphere from anywhere inside the middle cell, so this set
    /// only changes when authority migrates. Filtering it by live position
    /// would shave a few channels off and buy a resubscribe every time the
    /// viewer walked across their own cell.
    ///
    /// Empty cells cost nothing to hold: nobody claims them, so nobody
    /// publishes on them.
    pub fn neighbourhood(&self) -> Vec<String> {
        let Some(coords) = self.coords else {
            return vec![self.id()];
        };
        let mut out = Vec::with_capacity(27);
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    out.push(self.with_coords([
                        coords[0] + dx,
                        coords[1] + dy,
                        coords[2] + dz,
                    ]));
                }
            }
        }
        out
    }

    pub fn id(&self) -> String {
        match self.coords {
            Some(coords) => self.with_coords(coords),
            None => self.base.clone(),
        }
    }

    fn with_coords(&self, coords: [i64; 3]) -> String {
        format!(
            "{}:{}:{}:{}",
            self.base, coords[0], coords[1], coords[2]
        )
    }
}

fn coords_of(position: &Vec3, size: f64) -> [i64; 3] {
    [
        coordinate(position.x, size),
        coordinate(position.y, size),
        coordinate(position.z, size),
    ]
}

fn coordinate(value: f64, size: f64) -> i64 {
    (value / size).floor().clamp(-1_000_000.0, 1_000_000.0) as i64
}

/// Is the position still inside `cell` grown by `margin` on every face?
fn within(position: &Vec3, cell: [i64; 3], size: f64, margin: f64) -> bool {
    let axes = [position.x, position.y, position.z];
    axes.iter().enumerate().all(|(index, value)| {
        let low = cell[index] as f64 * size - margin;
        let high = low + size + margin * 2.0;
        *value >= low && *value <= high
    })
}

pub fn finite(value: &Vec3) -> bool {
    value.x.is_finite() && value.y.is_finite() && value.z.is_finite()
}

pub fn distance(left: &Vec3, right: &Vec3) -> f64 {
    ((left.x - right.x).powi(2) + (left.y - right.y).powi(2) + (left.z - right.z).powi(2)).sqrt()
}
