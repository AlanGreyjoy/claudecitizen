import type { Planet, Vec3 } from '../types';
import { cross, dot, normalize } from '../math/vec3';
import { samplePreRiverHeightDetails } from './base_elevation';
import { faceUvFromDirection } from './cube_sphere';
import { radialUp } from './coordinates';
import { getActivePlanetConfig, type PlanetRuntimeConfig } from './planets/runtime';
import { clamp01, getNoise3D } from './terrain_noise';

interface RiverRoutePoint {
  direction: Vec3;
  waterLevelNormalized: number;
}

interface RiverSegment {
  end: Vec3;
  endWaterLevelNormalized: number;
  flow: number;
  next: number | null;
  start: Vec3;
  startWaterLevelNormalized: number;
}

interface RiverNetwork {
  binResolution: number;
  bins: Map<string, number[]>;
  confluences: number;
  routes: number;
  segments: RiverSegment[];
}

interface NearestRiverSegment {
  distanceRadians: number;
  index: number;
  t: number;
}

export interface RiverFieldSample {
  riverStrength: number;
  riverWaterLevelNormalized: number | null;
}

export interface RiverNetworkDiagnostics {
  centerlineSamplesBeyondCarveDepth: number;
  confluences: number;
  indexedBins: number;
  indexedReferences: number;
  maximumFlow: number;
  maximumTerrainAboveWaterNormalized: number;
  maximumWaterRiseNormalized: number;
  routes: number;
  segments: number;
}

export interface RiverSurfaceResult {
  riverDepth: number;
  riverStrength: number;
  riverWaterLevelMeters: number | null;
}

export interface RiverSurfaceInput {
  heightMeters: number;
  normalizedHeight: number;
  planet: Planet;
  position: Vec3;
  preRiverElevationNormalized?: number;
  riverStrength?: number;
  riverWaterLevelNormalized?: number | null;
  seed: number;
}

const NETWORK_BIN_RESOLUTION = 64;
const RIVER_SOURCE_CANDIDATES = 512;
const BASE_RIVER_SOURCE_COUNT = 96;
const RIVER_SOURCE_SEPARATION_RADIANS = 0.002;
const RIVER_SOURCE_CLUSTER_ANGLE_RADIANS = 0.008;
const RIVER_ROUTE_STEP_METERS = 25_000;
const RIVER_ROUTE_MAX_STEPS = 200;
const RIVER_CONFLUENCE_RADIUS_RADIANS = 0.012;
const RIVER_ROUTING_SAMPLE_SPACING_METERS = 2_000;
const RIVER_WIDTH_TO_ANGULAR_SCALE = 0.07;
const RIVER_CARVE_SAFETY_MULTIPLIER = 1.15;
const RIVER_TURN_ANGLES = [
  -Math.PI,
  -Math.PI * 0.5,
  0,
  Math.PI * 0.5,
] as const;
const networkCache = new Map<string, RiverNetwork>();
const EMPTY_SEGMENT_INDICES: readonly number[] = [];
/** Scratch for edge-bin queries; valid only until the next nearbySegmentIndices call. */
const edgeSegmentScratch: number[] = [];
let cachedRuntimeConfig: PlanetRuntimeConfig | null = null;
let cachedRuntimeRecipeKey = '';
let mostRecentNetwork: RiverNetwork | null = null;
let mostRecentNetworkKey = '';

function sampleRoutingHeightDetails(planet: Planet, seed: number, direction: Vec3) {
  return samplePreRiverHeightDetails(planet, seed, direction, {
    sampleSpacingMeters: RIVER_ROUTING_SAMPLE_SPACING_METERS,
  });
}

function riverNetworkKey(planet: Planet, seed: number): string {
  const config = getActivePlanetConfig();
  if (config !== cachedRuntimeConfig) {
    cachedRuntimeConfig = config;
    cachedRuntimeRecipeKey = [
      config.planetId,
      JSON.stringify(config.height),
      JSON.stringify(config.regions),
      JSON.stringify(config.hydrology),
    ].join(':');
  }
  return [
    cachedRuntimeRecipeKey,
    planet.radiusMeters,
    planet.terrainAmplitudeMeters,
    seed,
  ].join(':');
}

function riverHalfWidthRadians(): number {
  return Math.max(
    1e-6,
    getActivePlanetConfig().hydrology.riverHalfWidth * RIVER_WIDTH_TO_ANGULAR_SCALE,
  );
}

function sourceDirections(planet: Planet, seed: number): Vec3[] {
  const { hydrology } = getActivePlanetConfig();
  const sourceCount = Math.max(
    12,
    Math.min(
      192,
      Math.round(BASE_RIVER_SOURCE_COUNT * (hydrology.riverFieldScale / 7)),
    ),
  );
  const clusterSamples = Math.max(
    3,
    Math.min(12, Math.round(hydrology.riverFieldOctaves * 2)),
  );
  const sourceNoise = getNoise3D(seed + hydrology.riverNoiseSeedOffset);
  const candidates: Array<{ direction: Vec3; score: number }> = [];
  const phase = ((seed + hydrology.riverNoiseSeedOffset) >>> 0) / 4_294_967_296;

  for (let index = 0; index < RIVER_SOURCE_CANDIDATES; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / RIVER_SOURCE_CANDIDATES;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const longitude = (index + phase) * 2.399963229728653;
    const direction = {
      x: Math.cos(longitude) * ringRadius,
      y,
      z: Math.sin(longitude) * ringRadius,
    };
    const details = sampleRoutingHeightDetails(planet, seed, direction);
    const elevation = details.preRiverElevationNormalized;
    if (
      elevation <= hydrology.riverMinLandElevation + 0.035 ||
      elevation >= hydrology.riverMaxLandElevation ||
      details.lakeMask >= hydrology.lakeMaskThreshold
    ) {
      continue;
    }
    const variation = sourceNoise(direction.x * 5, direction.y * 5, direction.z * 5);
    candidates.push({ direction, score: elevation + variation * 0.055 });
  }

  const anchors = [...candidates]
    .sort((left, right) => right.score - left.score)
    .slice(0, 48);
  for (const anchor of anchors) {
    const basis = tangentBasis(anchor.direction);
    for (let ringIndex = 0; ringIndex < clusterSamples; ringIndex += 1) {
      const tangent = rotateTangent(
        basis,
        anchor.direction,
        (ringIndex / clusterSamples) * Math.PI * 2,
      );
      const direction = advanceOnSphere(
        anchor.direction,
        tangent,
        RIVER_SOURCE_CLUSTER_ANGLE_RADIANS,
      );
      const details = sampleRoutingHeightDetails(planet, seed, direction);
      const elevation = details.preRiverElevationNormalized;
      if (
        elevation <= hydrology.riverMinLandElevation + 0.035 ||
        elevation >= hydrology.riverMaxLandElevation ||
        details.lakeMask >= hydrology.lakeMaskThreshold
      ) {
        continue;
      }
      const variation = sourceNoise(direction.x * 5, direction.y * 5, direction.z * 5);
      candidates.push({ direction, score: elevation + variation * 0.055 });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const chosen: Vec3[] = [];
  const maximumDot = Math.cos(RIVER_SOURCE_SEPARATION_RADIANS);
  for (const candidate of candidates) {
    if (chosen.some((direction) => dot(direction, candidate.direction) > maximumDot)) continue;
    chosen.push(candidate.direction);
    if (chosen.length >= sourceCount) break;
  }
  return chosen;
}

function tangentBasis(direction: Vec3): Vec3 {
  const reference = Math.abs(direction.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(reference, direction));
}

function advanceOnSphere(direction: Vec3, tangent: Vec3, angleRadians: number): Vec3 {
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  return normalize({
    x: direction.x * cosine + tangent.x * sine,
    y: direction.y * cosine + tangent.y * sine,
    z: direction.z * cosine + tangent.z * sine,
  });
}

function rotateTangent(tangent: Vec3, radial: Vec3, angleRadians: number): Vec3 {
  const side = cross(radial, tangent);
  return normalize({
    x: tangent.x * Math.cos(angleRadians) + side.x * Math.sin(angleRadians),
    y: tangent.y * Math.cos(angleRadians) + side.y * Math.sin(angleRadians),
    z: tangent.z * Math.cos(angleRadians) + side.z * Math.sin(angleRadians),
  });
}

function projectedTravelTangent(from: Vec3, to: Vec3): Vec3 {
  const along = dot(from, to);
  return normalize({
    x: to.x - from.x * along,
    y: to.y - from.y * along,
    z: to.z - from.z * along,
  });
}

function binCoordinates(direction: Vec3, resolution: number) {
  const { face, u, v } = faceUvFromDirection(direction);
  return {
    face,
    x: Math.max(0, Math.min(resolution - 1, Math.floor(((u + 1) * 0.5) * resolution))),
    y: Math.max(0, Math.min(resolution - 1, Math.floor(((v + 1) * 0.5) * resolution))),
  };
}

function binKey(face: string, x: number, y: number): string {
  return `${face}:${x}:${y}`;
}

function addSegmentReference(network: RiverNetwork, key: string, segmentIndex: number): void {
  const indices = network.bins.get(key);
  if (!indices) {
    network.bins.set(key, [segmentIndex]);
    return;
  }
  if (indices[indices.length - 1] !== segmentIndex) indices.push(segmentIndex);
}

function addSegmentBinNeighborhood(
  network: RiverNetwork,
  bin: ReturnType<typeof binCoordinates>,
  segmentIndex: number,
): void {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = bin.x + dx;
      const y = bin.y + dy;
      if (x < 0 || y < 0 || x >= network.binResolution || y >= network.binResolution) continue;
      addSegmentReference(network, binKey(bin.face, x, y), segmentIndex);
    }
  }
}

function addSegmentNeighborhood(
  network: RiverNetwork,
  direction: Vec3,
  segmentIndex: number,
): void {
  const bin = binCoordinates(direction, network.binResolution);
  addSegmentBinNeighborhood(network, bin, segmentIndex);
  const edgeBin =
    bin.x <= 1 ||
    bin.y <= 1 ||
    bin.x >= network.binResolution - 2 ||
    bin.y >= network.binResolution - 2;
  if (!edgeBin) return;

  // A river can cross a cube-face boundary while the two nearby queries map
  // to different faces. Index small tangent offsets on both sides so the
  // geometric field remains continuous across that atlas boundary.
  const basis = tangentBasis(direction);
  const side = cross(direction, basis);
  const paddingRadians = 3 / network.binResolution;
  for (const tangent of [
    basis,
    { x: -basis.x, y: -basis.y, z: -basis.z },
    side,
    { x: -side.x, y: -side.y, z: -side.z },
  ]) {
    const offset = advanceOnSphere(direction, tangent, paddingRadians);
    addSegmentBinNeighborhood(
      network,
      binCoordinates(offset, network.binResolution),
      segmentIndex,
    );
  }
}

function addSegmentToIndex(network: RiverNetwork, segmentIndex: number): void {
  const segment = network.segments[segmentIndex];
  for (const t of [0, 0.5, 1]) {
    addSegmentNeighborhood(
      network,
      normalize({
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
        z: segment.start.z + (segment.end.z - segment.start.z) * t,
      }),
      segmentIndex,
    );
  }
}

function closestPointOnSegment(direction: Vec3, segment: RiverSegment): NearestRiverSegment {
  const ab = {
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y,
    z: segment.end.z - segment.start.z,
  };
  const denominator = Math.max(dot(ab, ab), 1e-12);
  const t = clamp01(
    dot(
      {
        x: direction.x - segment.start.x,
        y: direction.y - segment.start.y,
        z: direction.z - segment.start.z,
      },
      ab,
    ) / denominator,
  );
  const nearest = normalize({
    x: segment.start.x + ab.x * t,
    y: segment.start.y + ab.y * t,
    z: segment.start.z + ab.z * t,
  });
  return {
    distanceRadians: Math.acos(Math.max(-1, Math.min(1, dot(direction, nearest)))),
    index: -1,
    t,
  };
}

function appendUniqueSegmentIndex(index: number): void {
  for (let i = 0; i < edgeSegmentScratch.length; i += 1) {
    if (edgeSegmentScratch[i] === index) return;
  }
  edgeSegmentScratch.push(index);
}

function nearbySegmentIndices(network: RiverNetwork, direction: Vec3): readonly number[] {
  const bin = binCoordinates(direction, network.binResolution);
  const primary = network.bins.get(binKey(bin.face, bin.x, bin.y));
  const edgeBin =
    bin.x <= 1 ||
    bin.y <= 1 ||
    bin.x >= network.binResolution - 2 ||
    bin.y >= network.binResolution - 2;
  if (!edgeBin) {
    if (!primary || primary.length === 0) return EMPTY_SEGMENT_INDICES;
    return primary;
  }

  edgeSegmentScratch.length = 0;
  if (primary) {
    for (let i = 0; i < primary.length; i += 1) {
      edgeSegmentScratch.push(primary[i]);
    }
  }

  const basis = tangentBasis(direction);
  const side = cross(direction, basis);
  const paddingRadians = 3 / network.binResolution;
  for (const tangent of [
    basis,
    { x: -basis.x, y: -basis.y, z: -basis.z },
    side,
    { x: -side.x, y: -side.y, z: -side.z },
  ]) {
    const offset = advanceOnSphere(direction, tangent, paddingRadians);
    const offsetBin = binCoordinates(offset, network.binResolution);
    const offsetIndices = network.bins.get(
      binKey(offsetBin.face, offsetBin.x, offsetBin.y),
    );
    if (!offsetIndices || offsetIndices.length === 0) continue;
    for (let i = 0; i < offsetIndices.length; i += 1) {
      appendUniqueSegmentIndex(offsetIndices[i]);
    }
  }

  return edgeSegmentScratch.length === 0 ? EMPTY_SEGMENT_INDICES : edgeSegmentScratch;
}

function nearbySegmentIndicesWithin(
  network: RiverNetwork,
  direction: Vec3,
  maximumDistanceRadians: number,
): Set<number> {
  const center = binCoordinates(direction, network.binResolution);
  const radius = Math.max(
    1,
    Math.ceil(maximumDistanceRadians * network.binResolution) + 1,
  );
  const indices = new Set<number>();
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= network.binResolution || y >= network.binResolution) continue;
      const binIndices = network.bins.get(binKey(center.face, x, y));
      if (!binIndices) continue;
      for (const index of binIndices) indices.add(index);
    }
  }
  return indices;
}

function nearestRiverSegment(
  network: RiverNetwork,
  direction: Vec3,
  maximumDistanceRadians: number,
  maximumWaterLevelNormalized = Number.POSITIVE_INFINITY,
): NearestRiverSegment | null {
  let nearest: NearestRiverSegment | null = null;
  for (const index of nearbySegmentIndicesWithin(
    network,
    direction,
    maximumDistanceRadians,
  )) {
    const segment = network.segments[index];
    const candidate = closestPointOnSegment(direction, segment);
    candidate.index = index;
    if (candidate.distanceRadians > maximumDistanceRadians) continue;
    const waterLevel =
      segment.startWaterLevelNormalized +
      (segment.endWaterLevelNormalized - segment.startWaterLevelNormalized) * candidate.t;
    if (waterLevel >= maximumWaterLevelNormalized) continue;
    if (!nearest || candidate.distanceRadians < nearest.distanceRadians) nearest = candidate;
  }
  return nearest;
}

function riverElevationFade(elevation: number): number {
  const { hydrology } = getActivePlanetConfig();
  const coastFade = clamp01((elevation - hydrology.riverMinLandElevation) / 0.03);
  const mountainFade = clamp01((hydrology.riverMaxLandElevation - elevation) / 0.1);
  return coastFade * mountainFade;
}

function waterLevelForBank(bankElevation: number): number {
  const { hydrology } = getActivePlanetConfig();
  return (
    bankElevation -
    hydrology.riverMaxCarveNormalized * riverElevationFade(bankElevation) * 0.5
  );
}

function bestDownhillStep(
  planet: Planet,
  seed: number,
  current: RiverRoutePoint,
  incomingTangent: Vec3,
  stepRadians: number,
): { direction: Vec3; elevation: number; lakeMask: number; tangent: Vec3 } | null {
  const candidates: Array<{
    direction: Vec3;
    lakeMask: number;
    score: number;
    tangent: Vec3;
  }> = [];
  for (const turn of RIVER_TURN_ANGLES) {
    const tangent = rotateTangent(incomingTangent, current.direction, turn);
    const direction = advanceOnSphere(current.direction, tangent, stepRadians);
    const details = sampleRoutingHeightDetails(planet, seed, direction);
    candidates.push({
      direction,
      lakeMask: details.lakeMask,
      score: details.preRiverElevationNormalized + Math.abs(turn) * 0.0015,
      tangent,
    });
  }
  candidates.sort((left, right) => left.score - right.score);

  for (const candidate of candidates) {
    const exactEnd = samplePreRiverHeightDetails(
      planet,
      seed,
      candidate.direction,
    );
    const endWaterLevel = Math.min(
      current.waterLevelNormalized,
      waterLevelForBank(exactEnd.preRiverElevationNormalized),
    );
    let routeFitsCarve = true;
    for (const t of [0.25, 0.5, 0.75]) {
      const routePoint = normalize({
        x: current.direction.x + (candidate.direction.x - current.direction.x) * t,
        y: current.direction.y + (candidate.direction.y - current.direction.y) * t,
        z: current.direction.z + (candidate.direction.z - current.direction.z) * t,
      });
      const routeElevation = samplePreRiverHeightDetails(
        planet,
        seed,
        routePoint,
      ).preRiverElevationNormalized;
      const routeWaterLevel =
        current.waterLevelNormalized +
        (endWaterLevel - current.waterLevelNormalized) * t;
      const routeCarve =
        getActivePlanetConfig().hydrology.riverMaxCarveNormalized *
        riverElevationFade(routeElevation);
      if (routeElevation - routeWaterLevel >= routeCarve * 0.9) {
        routeFitsCarve = false;
        break;
      }
    }
    if (!routeFitsCarve) continue;
    return {
      direction: candidate.direction,
      elevation: exactEnd.preRiverElevationNormalized,
      lakeMask: exactEnd.lakeMask,
      tangent: candidate.tangent,
    };
  }
  return null;
}

interface ConfluenceRouteInput {
  endDirection: Vec3;
  endWaterLevelNormalized: number;
  planet: Planet;
  seed: number;
  start: RiverRoutePoint;
  stepRadians: number;
}

function confluenceRoutePoints(input: ConfluenceRouteInput): RiverRoutePoint[] | null {
  const {
    endDirection,
    endWaterLevelNormalized,
    planet,
    seed,
    start,
    stepRadians,
  } = input;
  const { hydrology } = getActivePlanetConfig();
  const angularDistance = Math.acos(
    Math.max(-1, Math.min(1, dot(start.direction, endDirection))),
  );
  const subdivisions = Math.max(1, Math.ceil(angularDistance / (stepRadians * 0.25)));
  const points: RiverRoutePoint[] = [];
  for (let index = 1; index <= subdivisions; index += 1) {
    const t = index / subdivisions;
    const direction = normalize({
      x: start.direction.x + (endDirection.x - start.direction.x) * t,
      y: start.direction.y + (endDirection.y - start.direction.y) * t,
      z: start.direction.z + (endDirection.z - start.direction.z) * t,
    });
    const waterLevelNormalized =
      start.waterLevelNormalized +
      (endWaterLevelNormalized - start.waterLevelNormalized) * t;
    const elevation = samplePreRiverHeightDetails(
      planet,
      seed,
      direction,
    ).preRiverElevationNormalized;
    const naturalWaterLevel = waterLevelForBank(elevation);
    if (index < subdivisions) {
      if (
        elevation - waterLevelNormalized >
        hydrology.riverMaxCarveNormalized * riverElevationFade(elevation) * 0.9
      ) {
        return null;
      }
    }
    points.push({
      direction,
      waterLevelNormalized:
        index === subdivisions
          ? endWaterLevelNormalized
          : Math.max(waterLevelNormalized, naturalWaterLevel),
    });
  }
  return points;
}

function enforceDownhillWaterLevels(points: RiverRoutePoint[]): void {
  for (let index = points.length - 2; index >= 0; index -= 1) {
    points[index].waterLevelNormalized = Math.max(
      points[index].waterLevelNormalized,
      points[index + 1].waterLevelNormalized,
    );
  }
}

interface JoiningRiverInput {
  current: RiverRoutePoint;
  network: RiverNetwork;
  nextDirection: Vec3;
  planet: Planet;
  seed: number;
  stepRadians: number;
}

function joiningRiverRoute(
  input: JoiningRiverInput,
): { mergeSegment: number; points: RiverRoutePoint[] } | null {
  const { current, network, nextDirection, planet, seed, stepRadians } = input;
  const confluence = nearestRiverSegment(
    network,
    nextDirection,
    RIVER_CONFLUENCE_RADIUS_RADIANS,
    current.waterLevelNormalized,
  );
  if (!confluence) return null;
  const segment = network.segments[confluence.index];
  const confluenceWater =
    segment.startWaterLevelNormalized +
    (segment.endWaterLevelNormalized - segment.startWaterLevelNormalized) * confluence.t;
  const confluenceDirection = normalize({
    x: segment.start.x + (segment.end.x - segment.start.x) * confluence.t,
    y: segment.start.y + (segment.end.y - segment.start.y) * confluence.t,
    z: segment.start.z + (segment.end.z - segment.start.z) * confluence.t,
  });
  const joiningPoints = confluenceRoutePoints({
    endDirection: confluenceDirection,
    endWaterLevelNormalized: confluenceWater,
    planet,
    seed,
    start: current,
    stepRadians,
  });
  return joiningPoints
    ? { mergeSegment: confluence.index, points: joiningPoints }
    : null;
}

function routeRiver(
  network: RiverNetwork,
  planet: Planet,
  seed: number,
  source: Vec3,
): { mergeSegment: number | null; points: RiverRoutePoint[] } {
  const { hydrology } = getActivePlanetConfig();
  const sourceDetails = samplePreRiverHeightDetails(planet, seed, source);
  const points: RiverRoutePoint[] = [
    {
      direction: source,
      waterLevelNormalized: waterLevelForBank(sourceDetails.preRiverElevationNormalized),
    },
  ];
  const stepRadians = RIVER_ROUTE_STEP_METERS / planet.radiusMeters;
  let incomingTangent = tangentBasis(source);

  for (let step = 0; step < RIVER_ROUTE_MAX_STEPS; step += 1) {
    const current = points[points.length - 1];
    const next = bestDownhillStep(planet, seed, current, incomingTangent, stepRadians);
    if (!next) break;
    const nextNaturalWater = waterLevelForBank(next.elevation);
    if (
      next.elevation - current.waterLevelNormalized >
      hydrology.riverMaxCarveNormalized * 0.55
    ) {
      break;
    }

    // Snap a descending route into an older, lower channel when they enter the
    // same drainage neighborhood. New routes can only join older routes, so
    // the graph stays acyclic while producing real tributaries.
    const joiningRoute = joiningRiverRoute({
      current,
      network,
      nextDirection: next.direction,
      planet,
      seed,
      stepRadians,
    });
    if (joiningRoute) {
      points.push(...joiningRoute.points);
      enforceDownhillWaterLevels(points);
      return { mergeSegment: joiningRoute.mergeSegment, points };
    }

    points.push({
      direction: next.direction,
      waterLevelNormalized: nextNaturalWater,
    });
    incomingTangent = projectedTravelTangent(current.direction, next.direction);
    if (
      next.elevation <= hydrology.riverMinLandElevation ||
      next.lakeMask >= hydrology.lakeMaskThreshold
    ) {
      break;
    }
  }

  enforceDownhillWaterLevels(points);
  return { mergeSegment: null, points };
}

function appendRoute(
  network: RiverNetwork,
  points: RiverRoutePoint[],
  mergeSegment: number | null,
): void {
  if (points.length < 2) return;
  const firstSegment = network.segments.length;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const isLast = index === points.length - 2;
    network.segments.push({
      end: end.direction,
      endWaterLevelNormalized: end.waterLevelNormalized,
      flow: 0,
      next: isLast ? mergeSegment : firstSegment + index + 1,
      start: start.direction,
      startWaterLevelNormalized: start.waterLevelNormalized,
    });
    addSegmentToIndex(network, firstSegment + index);
  }

  let segmentIndex: number | null = firstSegment;
  const visited = new Set<number>();
  while (segmentIndex != null && !visited.has(segmentIndex)) {
    visited.add(segmentIndex);
    const segment: RiverSegment = network.segments[segmentIndex];
    segment.flow += 1;
    segmentIndex = segment.next;
  }
}

function buildRiverNetwork(planet: Planet, seed: number): RiverNetwork {
  const network: RiverNetwork = {
    binResolution: NETWORK_BIN_RESOLUTION,
    bins: new Map(),
    confluences: 0,
    routes: 0,
    segments: [],
  };
  for (const source of sourceDirections(planet, seed)) {
    const route = routeRiver(network, planet, seed, source);
    appendRoute(network, route.points, route.mergeSegment);
    if (route.points.length > 1) network.routes += 1;
    if (route.mergeSegment != null) network.confluences += 1;
  }
  return network;
}

export function getRiverNetworkDiagnostics(
  planet: Planet,
  seed: number,
): RiverNetworkDiagnostics {
  const network = getRiverNetwork(planet, seed);
  let maximumFlow = 0;
  let maximumTerrainAboveWaterNormalized = 0;
  let maximumWaterRiseNormalized = 0;
  let centerlineSamplesBeyondCarveDepth = 0;
  let indexedReferences = 0;
  for (const segment of network.segments) {
    maximumFlow = Math.max(maximumFlow, segment.flow);
    maximumWaterRiseNormalized = Math.max(
      maximumWaterRiseNormalized,
      segment.endWaterLevelNormalized - segment.startWaterLevelNormalized,
    );
    for (const t of [0.25, 0.5, 0.75]) {
      const direction = normalize({
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
        z: segment.start.z + (segment.end.z - segment.start.z) * t,
      });
      const elevation = samplePreRiverHeightDetails(
        planet,
        seed,
        direction,
      ).preRiverElevationNormalized;
      const waterLevel =
        segment.startWaterLevelNormalized +
        (segment.endWaterLevelNormalized - segment.startWaterLevelNormalized) * t;
      const terrainAboveWater = elevation - waterLevel;
      maximumTerrainAboveWaterNormalized = Math.max(
        maximumTerrainAboveWaterNormalized,
        terrainAboveWater,
      );
      const maximumCarve =
        getActivePlanetConfig().hydrology.riverMaxCarveNormalized *
        riverElevationFade(elevation) *
        RIVER_CARVE_SAFETY_MULTIPLIER;
      if (terrainAboveWater >= maximumCarve) centerlineSamplesBeyondCarveDepth += 1;
    }
  }
  for (const indices of network.bins.values()) indexedReferences += indices.length;
  return {
    centerlineSamplesBeyondCarveDepth,
    confluences: network.confluences,
    indexedBins: network.bins.size,
    indexedReferences,
    maximumFlow,
    maximumTerrainAboveWaterNormalized,
    maximumWaterRiseNormalized,
    routes: network.routes,
    segments: network.segments.length,
  };
}

function getRiverNetwork(planet: Planet, seed: number): RiverNetwork {
  const key = riverNetworkKey(planet, seed);
  if (key === mostRecentNetworkKey && mostRecentNetwork) return mostRecentNetwork;
  const cached = networkCache.get(key);
  if (cached) {
    mostRecentNetworkKey = key;
    mostRecentNetwork = cached;
    return cached;
  }
  const network = buildRiverNetwork(planet, seed);
  networkCache.set(key, network);
  mostRecentNetworkKey = key;
  mostRecentNetwork = network;
  while (networkCache.size > 4) networkCache.delete(networkCache.keys().next().value!);
  return network;
}

/** Build (or touch) the cached drainage graph during loading — not on first footstep. */
export function warmRiverNetwork(planet: Planet, seed: number): void {
  getRiverNetwork(planet, seed);
}

export function sampleRiverField(
  planet: Planet,
  seed: number,
  directionInput: Vec3,
  sampleSpacingMeters?: number,
): RiverFieldSample {
  const network = getRiverNetwork(planet, seed);
  const direction = normalize(directionInput);
  const baseWidthRadians = riverHalfWidthRadians();
  let bestStrength = 0;
  let riverWaterLevelNormalized: number | null = null;

  for (const index of nearbySegmentIndices(network, direction)) {
    const segment = network.segments[index];
    const nearest = closestPointOnSegment(direction, segment);
    const flowWidth = Math.min(2.2, 0.75 + Math.sqrt(Math.max(segment.flow, 1)) * 0.32);
    const widthRadians = baseWidthRadians * flowWidth;
    if (nearest.distanceRadians >= widthRadians) continue;
    const proximity = clamp01(1 - nearest.distanceRadians / widthRadians);
    let strength = proximity * proximity * (3 - 2 * proximity);
    if (sampleSpacingMeters != null) {
      const widthMeters = widthRadians * planet.radiusMeters;
      strength *= clamp01((widthMeters * 2) / Math.max(sampleSpacingMeters, 1));
    }
    if (strength <= bestStrength) continue;
    bestStrength = strength;
    riverWaterLevelNormalized =
      segment.startWaterLevelNormalized +
      (segment.endWaterLevelNormalized - segment.startWaterLevelNormalized) * nearest.t;
  }

  return { riverStrength: bestStrength, riverWaterLevelNormalized };
}

export function carveRiverElevationFromField(
  elevation: number,
  field: RiverFieldSample,
): number {
  const { hydrology } = getActivePlanetConfig();
  if (
    elevation < hydrology.riverMinLandElevation ||
    field.riverStrength < hydrology.riverMinStrength ||
    field.riverWaterLevelNormalized == null
  ) {
    return elevation;
  }
  const fade = riverElevationFade(elevation);
  const channelBottom =
    field.riverWaterLevelNormalized - hydrology.riverMaxCarveNormalized * fade * 0.5;
  const carved = Math.min(
    elevation,
    elevation + (channelBottom - elevation) * field.riverStrength,
  );
  return Math.max(
    elevation -
      hydrology.riverMaxCarveNormalized * fade * RIVER_CARVE_SAFETY_MULTIPLIER,
    carved,
  );
}

export function sampleRiverSurface(input: RiverSurfaceInput): RiverSurfaceResult {
  const {
    heightMeters,
    normalizedHeight,
    planet,
    position,
    preRiverElevationNormalized,
    riverStrength: cachedRiverStrength,
    riverWaterLevelNormalized: cachedWaterLevel,
    seed,
  } = input;
  const unit = radialUp(position);
  const field =
    cachedRiverStrength == null || cachedWaterLevel === undefined
      ? sampleRiverField(planet, seed, unit)
      : {
          riverStrength: cachedRiverStrength,
          riverWaterLevelNormalized: cachedWaterLevel,
        };
  if (field.riverStrength < 0.15 || field.riverWaterLevelNormalized == null) {
    return { riverDepth: 0, riverStrength: 0, riverWaterLevelMeters: null };
  }

  const preCarve = preRiverElevationNormalized ?? normalizedHeight;
  const fade = riverElevationFade(preCarve);
  if (preCarve < getActivePlanetConfig().hydrology.riverMinLandElevation || fade <= 0) {
    return { riverDepth: 0, riverStrength: 0, riverWaterLevelMeters: null };
  }

  const riverWaterLevelMeters = field.riverWaterLevelNormalized * planet.terrainAmplitudeMeters;
  const channelDepthMeters =
    field.riverStrength *
    getActivePlanetConfig().hydrology.riverMaxCarveNormalized *
    fade *
    planet.terrainAmplitudeMeters;
  const riverDepth = clamp01(
    (riverWaterLevelMeters - heightMeters) / Math.max(channelDepthMeters, 30),
  );

  return {
    riverDepth,
    riverStrength: field.riverStrength,
    riverWaterLevelMeters,
  };
}
