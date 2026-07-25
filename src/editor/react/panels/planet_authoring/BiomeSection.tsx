import type { ReactElement } from 'react';
import { biomeDisplayName } from '../../../../world/climate';
import type { PlanetBiomeRecipe } from '../../../../world/planets/schema';
import type { Biome } from '../../../../types';
import { EmptyNote } from '../InspectorForm';
import { PlanetField, PlanetNumberField } from './Fields';
import { BiomeMultiSelect } from './BiomeMultiSelect';
import type { PlanetAuthoringBiomeSectionProps } from './section-types';

function FallbackBiomeField({
  recipe,
  onChange,
}: {
  recipe: PlanetBiomeRecipe;
  onChange: (biome: Biome) => void;
}): ReactElement {
  return (
    <PlanetField label="Fallback biome">
      <select
        className="ed-input"
        value={recipe.fallbackBiome}
        onChange={(event) => onChange(event.currentTarget.value as Biome)}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {recipe.enabled.map((biome) => (
          <option key={biome} value={biome}>
            {biomeDisplayName(biome)}
          </option>
        ))}
      </select>
    </PlanetField>
  );
}

export function BiomeSection({
  doc,
  onMarkBiomeDirty,
  onStatusError,
  onRebuildForm,
}: PlanetAuthoringBiomeSectionProps): ReactElement {
  return (
    <>
      <EmptyNote>
        Enabled land biomes are classified by the shared runtime recipe. Ocean, coast, lakes, and
        rivers are generated geography, not biomes.
      </EmptyNote>
      <BiomeMultiSelect
        label="Enabled"
        selected={doc.biomes.enabled}
        onChange={(biomes) => {
          if (biomes.length === 0) {
            onStatusError('A planet needs at least one enabled land biome.');
            return;
          }
          doc.biomes.enabled = biomes;
          if (!biomes.includes(doc.biomes.fallbackBiome)) {
            doc.biomes.fallbackBiome = biomes[0]!;
          }
          onMarkBiomeDirty();
          onRebuildForm();
        }}
      />
      <FallbackBiomeField
        recipe={doc.biomes}
        onChange={(biome) => {
          doc.biomes.fallbackBiome = biome;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Forest moisture min"
        value={doc.biomes.forestMoistureMin}
        step={0.01}
        onChange={(value) => {
          doc.biomes.forestMoistureMin = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Plains moisture min"
        value={doc.biomes.plainsMoistureMin}
        step={0.01}
        onChange={(value) => {
          doc.biomes.plainsMoistureMin = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Arctic latitude 0–1"
        value={doc.biomes.arcticLatitudeStart}
        step={0.01}
        onChange={(value) => {
          doc.biomes.arcticLatitudeStart = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Arctic temperature max"
        value={doc.biomes.arcticTemperatureMax}
        step={0.01}
        onChange={(value) => {
          doc.biomes.arcticTemperatureMax = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Mountain region gate"
        value={doc.biomes.mountainRegionThreshold}
        step={0.01}
        onChange={(value) => {
          doc.biomes.mountainRegionThreshold = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Highland height 0–1"
        value={doc.biomes.highlandNormalizedHeight}
        step={0.01}
        onChange={(value) => {
          doc.biomes.highlandNormalizedHeight = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Extreme highland 0–1"
        value={doc.biomes.extremeHighlandNormalizedHeight}
        step={0.01}
        onChange={(value) => {
          doc.biomes.extremeHighlandNormalizedHeight = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Peak temperature max"
        value={doc.biomes.peakTemperatureMax}
        step={0.01}
        onChange={(value) => {
          doc.biomes.peakTemperatureMax = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Ocean level (m)"
        value={doc.biomes.oceanWaterLevelMeters}
        step={1}
        onChange={(value) => {
          doc.biomes.oceanWaterLevelMeters = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Coast max height (m)"
        value={doc.biomes.coastMaxHeightMeters}
        step={1}
        onChange={(value) => {
          doc.biomes.coastMaxHeightMeters = value;
          onMarkBiomeDirty();
        }}
      />
      <PlanetNumberField
        label="Shelf half-width 0–1"
        value={doc.biomes.coastalShelfHalfWidthNormalized}
        step={0.001}
        onChange={(value) => {
          doc.biomes.coastalShelfHalfWidthNormalized = value;
          onMarkBiomeDirty();
        }}
      />
    </>
  );
}
