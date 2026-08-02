import type { PlanetDocument } from '../../../../world/planets/schema';

export type PlanetAuthoringSectionProps = {
  doc: PlanetDocument;
  onMarkDirty: () => void;
};

export type PlanetAuthoringBiomeSectionProps = PlanetAuthoringSectionProps & {
  onMarkBiomeDirty: () => void;
  onStatusError: (message: string) => void;
  onRebuildForm: () => void;
};

export type PlanetAuthoringVegetationSectionProps = PlanetAuthoringSectionProps & {
  onMarkVegetationDirty: () => void;
  onRebuildForm: () => void;
};

export type PlanetAuthoringSpawnSectionProps = PlanetAuthoringSectionProps & {
  onMarkSpawnCatalogDirty: () => void;
  onRebuildForm: () => void;
};

/** Cloud decks add and remove layers, so the form has to rebuild. */
export type PlanetAuthoringCloudSectionProps = PlanetAuthoringSectionProps & {
  onRebuildForm: () => void;
};
