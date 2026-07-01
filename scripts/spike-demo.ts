import { dot, length } from '../src/math/vec3';
import { createFlightBody, integrateFlightBody } from '../src/flight/flight_body';
import { CLAUDECITIZEN_PLANET } from '../src/world/planet';
import { cartesianFromLatLonAlt, eastVector, radialUp } from '../src/world/coordinates';
import { sampleRenderablePlanetSurface } from '../src/world/planet_surface';
import type { FlightBody, FlightInput } from '../src/types';

const seed = 20061;
const planet = CLAUDECITIZEN_PLANET;
const spawnLatRadians = 0.24;
const spawnLonRadians = 1.54;
const spawnProbe = cartesianFromLatLonAlt(spawnLatRadians, spawnLonRadians, 0, planet.radiusMeters);
const spawnSurface = sampleRenderablePlanetSurface(planet, seed, spawnProbe);
const padPosition = cartesianFromLatLonAlt(
  spawnLatRadians,
  spawnLonRadians,
  spawnSurface.heightMeters + 30,
  planet.radiusMeters,
);
const bodyAtPad = createFlightBody(padPosition, eastVector(padPosition));

let body: FlightBody = bodyAtPad;
let maxAltitude = -Infinity;
let landed = false;
let missionStage = 'ascent' as 'ascent' | 'coast' | 'descent';
let coastTicks = 0;

function altitude(bodyState: FlightBody): number {
  return sampleRenderablePlanetSurface(planet, seed, bodyState.position).altitudeMeters;
}

function chooseAutopilotInput(bodyState: FlightBody): FlightInput {
  const currentAltitude = altitude(bodyState);
  const verticalSpeed = dot(bodyState.velocity, radialUp(bodyState.position));

  if (missionStage === 'ascent') {
    if (currentAltitude >= 120_000) {
      missionStage = 'coast';
    }
  }
  if (missionStage === 'coast') {
    coastTicks += 1;
    if (coastTicks >= 180) {
      missionStage = 'descent';
    }
  }

  if (missionStage === 'ascent') {
    if (currentAltitude < 8_000) {
      return { brake01: 0.12, lift01: 0.72, throttle01: 0.14, pitch01: 0.01 };
    }
    return { brake01: 0.08, lift01: 0.58, throttle01: 0.28, pitch01: -0.01 };
  }
  if (missionStage === 'coast') {
    return { brake01: 0.4, lift01: 0.04, throttle01: 0.08, yaw01: 0.01 };
  }
  if (currentAltitude > 10_000) {
    return { brake01: 1, lift01: -1, throttle01: -0.45, pitch01: 0.03 };
  }
  if (currentAltitude > 1_500) {
    return { brake01: 1, lift01: -0.5, throttle01: -0.5, pitch01: 0.02 };
  }
  if (currentAltitude > 150) {
    return { brake01: 0.85, lift01: -0.12, throttle01: -0.08, pitch01: 0.01 };
  }
  if (verticalSpeed < -12) {
    return { brake01: 0.55, lift01: 0.2, throttle01: -0.02, pitch01: 0.01 };
  }
  return { brake01: 0.4, lift01: -0.03, throttle01: -0.05 };
}

for (let elapsedSeconds = 0; elapsedSeconds < 5_000; elapsedSeconds += 1) {
  const input = chooseAutopilotInput(body);
  body = integrateFlightBody(body, input, 1, planet, seed);
  maxAltitude = Math.max(maxAltitude, altitude(body));
  landed =
    missionStage === 'descent' &&
    altitude(body) < 10 &&
    length(body.velocity) < 160;
  if (landed) break;
}

const finalAltitude = altitude(body);
console.log(
  JSON.stringify(
    {
      finalAltitudeMeters: Math.round(finalAltitude),
      finalSpeedMetersPerSecond: Math.round(length(body.velocity)),
      landed,
      maxAltitudeMeters: Math.round(maxAltitude),
      planet: planet.name,
    },
    null,
    2,
  ),
);
