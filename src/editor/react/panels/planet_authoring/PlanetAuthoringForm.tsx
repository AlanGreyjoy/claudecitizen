import { useCallback, type ReactElement } from 'react';
import type { PlanetDocument } from '../../../../world/planets/schema';
import { PlanetSection } from './Fields';
import { BiomeSection } from './BiomeSection';
import { CloudsSection } from './CloudsSection';
import { IdentitySection } from './IdentitySection';
import { PaletteSection } from './PaletteSection';
import {
  MoonSection,
  NightSection,
  SkyAtmosphereSection,
  StarsSection,
  SunSection,
} from './SkySection';
import { SpawnsSection } from './SpawnsSection';
import {
  HeightRecipeSection,
  HydrologySection,
  PhysicsSection,
  RegionsSection,
} from './TerrainSection';
import { VegetationSection } from './VegetationSection';

export type PlanetAuthoringFormProps = {
  doc: PlanetDocument;
  expandedSections: Set<string>;
  onToggleSection: (title: string) => void;
  onMarkDirty: () => void;
  onMarkBiomeDirty: () => void;
  onMarkVegetationDirty: () => void;
  onMarkSpawnCatalogDirty: () => void;
  onStatusError: (message: string) => void;
  onRebuildForm: () => void;
};

export function PlanetAuthoringForm({
  doc,
  expandedSections,
  onToggleSection,
  onMarkDirty,
  onMarkBiomeDirty,
  onMarkVegetationDirty,
  onMarkSpawnCatalogDirty,
  onStatusError,
  onRebuildForm,
}: PlanetAuthoringFormProps): ReactElement {
  const section = useCallback(
    (title: string, children: ReactElement | ReactElement[]) => (
      <PlanetSection
        key={title}
        title={title}
        expanded={expandedSections.has(title)}
        onToggle={() => onToggleSection(title)}
      >
        {children}
      </PlanetSection>
    ),
    [expandedSections, onToggleSection],
  );

  return (
    <>
      {section('Identity', <IdentitySection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section('Physics', <PhysicsSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section('Height recipe', <HeightRecipeSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section('Regions', <RegionsSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section('Hydrology', <HydrologySection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section(
        'Biome recipe',
        <BiomeSection
          doc={doc}
          onMarkDirty={onMarkDirty}
          onMarkBiomeDirty={onMarkBiomeDirty}
          onStatusError={onStatusError}
          onRebuildForm={onRebuildForm}
        />,
      )}
      {section(
        'Vegetation',
        <VegetationSection
          doc={doc}
          onMarkDirty={onMarkDirty}
          onMarkVegetationDirty={onMarkVegetationDirty}
          onRebuildForm={onRebuildForm}
        />,
      )}
      {section('Surface Palette', <PaletteSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section(
        'Sky & Atmosphere',
        <SkyAtmosphereSection doc={doc} onMarkDirty={onMarkDirty} />,
      )}
      {section('Sun', <SunSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section('Moon', <MoonSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section(
        'Clouds',
        <CloudsSection
          doc={doc}
          onMarkDirty={onMarkDirty}
          onRebuildForm={onRebuildForm}
        />,
      )}
      {section('Stars', <StarsSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section('Night', <NightSection doc={doc} onMarkDirty={onMarkDirty} />)}
      {section(
        'Spawn Catalog',
        <SpawnsSection
          doc={doc}
          onMarkDirty={onMarkDirty}
          onMarkSpawnCatalogDirty={onMarkSpawnCatalogDirty}
          onRebuildForm={onRebuildForm}
        />,
      )}
    </>
  );
}
