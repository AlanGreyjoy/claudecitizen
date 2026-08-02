import type { ReactElement } from 'react';
import { NEUTRAL_RAYLEIGH_COLOR } from '../../../../world/planets/sky-schema';
import {
  PlanetCheckboxField,
  PlanetColorField,
  PlanetNumberField,
} from './Fields';
import type { PlanetAuthoringSectionProps } from './section-types';

/**
 * Sky authoring.
 *
 * The engine defaults are Earth's, which is why an untouched planet looks
 * familiar; every field here is a way off that. The scattering fields are the
 * expensive-looking ones — they rebuild the atmosphere LUTs — so they are
 * grouped away from the cheap per-frame knobs like sun intensity.
 */

export function SkyAtmosphereSection({
  doc,
  onMarkDirty,
}: PlanetAuthoringSectionProps): ReactElement {
  const { atmosphere } = doc.sky;
  return (
    <>
      <PlanetNumberField
        label="Day length (s)"
        value={doc.sky.dayLengthSeconds}
        step={60}
        onChange={(value) => {
          doc.sky.dayLengthSeconds = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label={`Sky tint (${NEUTRAL_RAYLEIGH_COLOR} = Earth)`}
        value={atmosphere.rayleighColor}
        onChange={(value) => {
          atmosphere.rayleighColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Air density"
        value={atmosphere.rayleighStrength}
        step={0.05}
        onChange={(value) => {
          atmosphere.rayleighStrength = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Haze tint"
        value={atmosphere.mieColor}
        onChange={(value) => {
          atmosphere.mieColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Haze density"
        value={atmosphere.mieStrength}
        step={0.05}
        onChange={(value) => {
          atmosphere.mieStrength = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Sun halo spread"
        value={atmosphere.mieAnisotropy}
        step={0.01}
        onChange={(value) => {
          atmosphere.mieAnisotropy = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Ground bounce"
        value={atmosphere.groundAlbedo}
        onChange={(value) => {
          atmosphere.groundAlbedo = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Sky brightness"
        value={atmosphere.skyBrightness}
        step={0.05}
        onChange={(value) => {
          atmosphere.skyBrightness = value;
          onMarkDirty();
        }}
      />
    </>
  );
}

export function SunSection({
  doc,
  onMarkDirty,
}: PlanetAuthoringSectionProps): ReactElement {
  const { sun } = doc.sky;
  return (
    <>
      <PlanetColorField
        label="Star color"
        value={sun.color}
        onChange={(value) => {
          sun.color = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Light intensity"
        value={sun.intensity}
        step={0.05}
        onChange={(value) => {
          sun.intensity = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Angular size (deg)"
        value={sun.angularDiameterDegrees}
        step={0.05}
        onChange={(value) => {
          sun.angularDiameterDegrees = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Disc brightness"
        value={sun.discBrightness}
        step={0.05}
        onChange={(value) => {
          sun.discBrightness = value;
          onMarkDirty();
        }}
      />
    </>
  );
}

export function MoonSection({
  doc,
  onMarkDirty,
}: PlanetAuthoringSectionProps): ReactElement {
  const { moon } = doc.sky;
  return (
    <>
      <PlanetCheckboxField
        label="Enabled"
        checked={moon.enabled}
        onChange={(value) => {
          moon.enabled = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Angular size (deg)"
        value={moon.angularDiameterDegrees}
        step={0.1}
        onChange={(value) => {
          moon.angularDiameterDegrees = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Highlands"
        value={moon.color}
        onChange={(value) => {
          moon.color = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Maria (dark)"
        value={moon.mariaColor}
        onChange={(value) => {
          moon.mariaColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Maria coverage"
        value={moon.mariaCoverage}
        step={0.05}
        onChange={(value) => {
          moon.mariaCoverage = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Craters"
        value={moon.crateredness}
        step={0.05}
        onChange={(value) => {
          moon.crateredness = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Surface seed"
        value={moon.surfaceSeed}
        step={1}
        onChange={(value) => {
          moon.surfaceSeed = Math.round(value);
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Disc brightness"
        value={moon.brightness}
        step={0.05}
        onChange={(value) => {
          moon.brightness = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Phase cycle (days)"
        value={moon.synodicPeriodDays}
        step={0.5}
        onChange={(value) => {
          moon.synodicPeriodDays = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Phase at t=0 (deg)"
        value={moon.phaseOffsetDegrees}
        step={5}
        onChange={(value) => {
          moon.phaseOffsetDegrees = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Orbit tilt (deg)"
        value={moon.orbitTiltDegrees}
        step={1}
        onChange={(value) => {
          moon.orbitTiltDegrees = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Moonlight"
        value={moon.lightColor}
        onChange={(value) => {
          moon.lightColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Moonlight intensity"
        value={moon.lightIntensity}
        step={0.05}
        onChange={(value) => {
          moon.lightIntensity = value;
          onMarkDirty();
        }}
      />
    </>
  );
}

export function StarsSection({
  doc,
  onMarkDirty,
}: PlanetAuthoringSectionProps): ReactElement {
  const { stars } = doc.sky;
  return (
    <>
      <PlanetNumberField
        label="Brightness"
        value={stars.intensity}
        step={0.05}
        onChange={(value) => {
          stars.intensity = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Point size"
        value={stars.pointSize}
        step={0.1}
        onChange={(value) => {
          stars.pointSize = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Brightest magnitude"
        value={stars.magnitudeMin}
        step={0.5}
        onChange={(value) => {
          stars.magnitudeMin = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Faintest magnitude"
        value={stars.magnitudeMax}
        step={0.5}
        onChange={(value) => {
          stars.magnitudeMax = value;
          onMarkDirty();
        }}
      />
    </>
  );
}

export function NightSection({
  doc,
  onMarkDirty,
}: PlanetAuthoringSectionProps): ReactElement {
  const { night } = doc.sky;
  return (
    <>
      <PlanetColorField
        label="Airglow"
        value={night.airglowColor}
        onChange={(value) => {
          night.airglowColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Airglow strength"
        value={night.airglowStrength}
        step={0.05}
        onChange={(value) => {
          night.airglowStrength = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Horizon glow"
        value={night.horizonColor}
        onChange={(value) => {
          night.horizonColor = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Nebula band"
        value={night.nebulaColor}
        onChange={(value) => {
          night.nebulaColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Nebula strength"
        value={night.nebulaStrength}
        step={0.05}
        onChange={(value) => {
          night.nebulaStrength = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Nebula tilt (deg)"
        value={night.nebulaTiltDegrees}
        step={1}
        onChange={(value) => {
          night.nebulaTiltDegrees = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Ambient sky"
        value={night.ambientSkyColor}
        onChange={(value) => {
          night.ambientSkyColor = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Ambient ground"
        value={night.ambientGroundColor}
        onChange={(value) => {
          night.ambientGroundColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Ambient floor"
        value={night.ambientIntensity}
        step={0.01}
        onChange={(value) => {
          night.ambientIntensity = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Night fog"
        value={night.fogColor}
        onChange={(value) => {
          night.fogColor = value;
          onMarkDirty();
        }}
      />
    </>
  );
}
