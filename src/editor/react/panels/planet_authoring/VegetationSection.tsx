import type { ReactElement } from 'react';
import { EmptyNote } from '../InspectorForm';
import { PlanetColorField, PlanetNumberField } from './Fields';
import { ensureGrassColor, ensureVegetationLayer } from './utils';
import { VegetationAssetListEditor } from './VegetationAssetListEditor';
import type { PlanetAuthoringVegetationSectionProps } from './section-types';

export function VegetationSection({
  doc,
  onMarkVegetationDirty,
  onRebuildForm,
}: PlanetAuthoringVegetationSectionProps): ReactElement {
  ensureVegetationLayer(doc.vegetation.grass);
  ensureVegetationLayer(doc.vegetation.tree);
  ensureGrassColor(doc.vegetation.grass);

  return (
    <>
      <EmptyNote>
        Grass assets are PNG billboards (empty → procedural). Trees need at least one GLB/GLTF from
        Project.
      </EmptyNote>
      <div className="ed-planet-spawn-layer-title">Grass</div>
      <PlanetColorField
        label="Grass color"
        value={doc.vegetation.grass.color ?? '#7a9f42'}
        onChange={(value) => {
          doc.vegetation.grass.color = value;
          onMarkVegetationDirty();
        }}
      />
      <PlanetNumberField
        label="Grass density"
        value={doc.vegetation.grass.density}
        onChange={(value) => {
          doc.vegetation.grass.density = value;
          onMarkVegetationDirty();
        }}
      />
      <PlanetNumberField
        label="Grass gap (m)"
        value={doc.vegetation.grass.gapMeters}
        onChange={(value) => {
          doc.vegetation.grass.gapMeters = value;
          onMarkVegetationDirty();
        }}
      />
      <PlanetNumberField
        label="Grass min scale"
        value={doc.vegetation.grass.minScale}
        onChange={(value) => {
          doc.vegetation.grass.minScale = value;
          onMarkVegetationDirty();
        }}
      />
      <PlanetNumberField
        label="Grass max scale"
        value={doc.vegetation.grass.maxScale}
        onChange={(value) => {
          doc.vegetation.grass.maxScale = value;
          onMarkVegetationDirty();
        }}
      />
      <VegetationAssetListEditor
        layer={doc.vegetation.grass}
        label="Grass assets"
        kind="grass"
        onChange={onMarkVegetationDirty}
        onRebuild={onRebuildForm}
      />
      <div className="ed-planet-spawn-layer-title">Trees</div>
      <PlanetNumberField
        label="Tree density"
        value={doc.vegetation.tree.density}
        onChange={(value) => {
          doc.vegetation.tree.density = value;
          onMarkVegetationDirty();
        }}
      />
      <PlanetNumberField
        label="Tree gap (m)"
        value={doc.vegetation.tree.gapMeters}
        onChange={(value) => {
          doc.vegetation.tree.gapMeters = value;
          onMarkVegetationDirty();
        }}
      />
      <PlanetNumberField
        label="Tree min scale"
        value={doc.vegetation.tree.minScale}
        onChange={(value) => {
          doc.vegetation.tree.minScale = value;
          onMarkVegetationDirty();
        }}
      />
      <PlanetNumberField
        label="Tree max scale"
        value={doc.vegetation.tree.maxScale}
        onChange={(value) => {
          doc.vegetation.tree.maxScale = value;
          onMarkVegetationDirty();
        }}
      />
      <VegetationAssetListEditor
        layer={doc.vegetation.tree}
        label="Tree assets"
        kind="tree"
        onChange={onMarkVegetationDirty}
        onRebuild={onRebuildForm}
      />
    </>
  );
}
