import type { ReactElement } from 'react';
import { PlanetNumberField } from './Fields';
import type { PlanetAuthoringSectionProps } from './section-types';

export function PhysicsSection({ doc, onMarkDirty }: PlanetAuthoringSectionProps): ReactElement {
  return (
    <>
      <PlanetNumberField
        label="Radius (m)"
        value={doc.radiusMeters}
        step={1000}
        onChange={(value) => {
          doc.radiusMeters = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Amplitude (m)"
        value={doc.terrainAmplitudeMeters}
        step={10}
        onChange={(value) => {
          doc.terrainAmplitudeMeters = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Atmosphere (m)"
        value={doc.atmosphereHeightMeters}
        step={100}
        onChange={(value) => {
          doc.atmosphereHeightMeters = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Gravity"
        value={doc.gravityMetersPerSecond2}
        onChange={(value) => {
          doc.gravityMetersPerSecond2 = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Drag sea level"
        value={doc.dragSeaLevel}
        step={0.001}
        onChange={(value) => {
          doc.dragSeaLevel = value;
          onMarkDirty();
        }}
      />
    </>
  );
}

export function HeightRecipeSection({
  doc,
  onMarkDirty,
}: PlanetAuthoringSectionProps): ReactElement {
  return (
    <>
      <PlanetNumberField
        label="Continent scale"
        value={doc.height.continentScale}
        onChange={(value) => {
          doc.height.continentScale = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Continent weight"
        value={doc.height.continentWeight}
        onChange={(value) => {
          doc.height.continentWeight = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Ridge scale"
        value={doc.height.ridgeScale}
        onChange={(value) => {
          doc.height.ridgeScale = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Ridge weight"
        value={doc.height.ridgeWeight}
        onChange={(value) => {
          doc.height.ridgeWeight = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Hill scale"
        value={doc.height.hillScale}
        onChange={(value) => {
          doc.height.hillScale = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Detail scale"
        value={doc.height.detailScale}
        onChange={(value) => {
          doc.height.detailScale = value;
          onMarkDirty();
        }}
      />
    </>
  );
}

export function RegionsSection({ doc, onMarkDirty }: PlanetAuthoringSectionProps): ReactElement {
  return (
    <>
      <PlanetNumberField
        label="Mountain start"
        value={doc.regions.mountainRegionStart}
        onChange={(value) => {
          doc.regions.mountainRegionStart = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Mountain full"
        value={doc.regions.mountainRegionFull}
        onChange={(value) => {
          doc.regions.mountainRegionFull = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Hill start"
        value={doc.regions.hillRegionStart}
        onChange={(value) => {
          doc.regions.hillRegionStart = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Hill full"
        value={doc.regions.hillRegionFull}
        onChange={(value) => {
          doc.regions.hillRegionFull = value;
          onMarkDirty();
        }}
      />
    </>
  );
}

export function HydrologySection({ doc, onMarkDirty }: PlanetAuthoringSectionProps): ReactElement {
  return (
    <>
      <PlanetNumberField
        label="Lake threshold"
        value={doc.hydrology.lakeMaskThreshold}
        onChange={(value) => {
          doc.hydrology.lakeMaskThreshold = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Lake carve"
        value={doc.hydrology.lakeMaxCarveNormalized}
        onChange={(value) => {
          doc.hydrology.lakeMaxCarveNormalized = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Lake water level"
        value={doc.hydrology.inlandLakeWaterLevelNormalized}
        step={0.001}
        onChange={(value) => {
          doc.hydrology.inlandLakeWaterLevelNormalized = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="River half-width"
        value={doc.hydrology.riverHalfWidth}
        step={0.001}
        onChange={(value) => {
          doc.hydrology.riverHalfWidth = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="River carve"
        value={doc.hydrology.riverMaxCarveNormalized}
        onChange={(value) => {
          doc.hydrology.riverMaxCarveNormalized = value;
          onMarkDirty();
        }}
      />
    </>
  );
}
