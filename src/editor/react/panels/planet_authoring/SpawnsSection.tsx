import type { ReactElement } from 'react';
import { createDefaultSpawnEntry } from '../../../../world/planets/schema';
import { EmptyNote } from '../InspectorForm';
import { PlanetNumberField } from './Fields';
import { SpawnLayerEditor } from './SpawnLayerEditor';
import { nextSpawnLayerId } from './utils';
import type { PlanetAuthoringSpawnSectionProps } from './section-types';

export function SpawnsSection({
  doc,
  onMarkSpawnCatalogDirty,
  onRebuildForm,
}: PlanetAuthoringSpawnSectionProps): ReactElement {
  const catalog = doc.spawning;
  const entries = catalog?.entries ?? [];

  return (
    <>
      <EmptyNote>
        Shared samples place all entries from one probe set. Weights compete among acceptors. Prefer
        reusing a few GLBs — draw calls scale with unique assets × mesh parts, not entry count. Use
        Test Play for FPS.
      </EmptyNote>
      <PlanetNumberField
        label="Samples per tile"
        value={catalog.samplesPerTile}
        step={1}
        onChange={(value) => {
          catalog.samplesPerTile = Math.max(0, Math.round(value));
          onMarkSpawnCatalogDirty();
        }}
      />
      <PlanetNumberField
        label="Catalog density"
        value={catalog.density}
        onChange={(value) => {
          catalog.density = Math.max(0, value);
          onMarkSpawnCatalogDirty();
        }}
      />
      <EmptyNote>
        Drag .glb props from Project. Height is normalized 0–1 (sea→peak). Props target land biomes;
        coast, lake, and river are derived hydrology rather than biomes. Colliders: box/capsule only.
        Preview shows catalog props on the heightfield.
      </EmptyNote>
      {entries.length > 50 ? (
        <div className="ed-spawn-catalog-warning">
          {`Catalog has ${entries.length} entries (>50). Prefer fewer unique GLBs and tune weights — large catalogs can hurt FPS.`}
        </div>
      ) : null}
      {entries.filter((e) => e.enabled).length > 50 ? (
        <div className="ed-spawn-catalog-warning">
          {`${entries.filter((e) => e.enabled).length} enabled entries. Soft target is ~50 enabled props; disable unused entries.`}
        </div>
      ) : null}
      {entries.map((layer, index) => (
        <SpawnLayerEditor
          key={layer.id}
          layer={layer}
          onChange={onMarkSpawnCatalogDirty}
          onRemove={() => {
            entries.splice(index, 1);
            onMarkSpawnCatalogDirty();
            onRebuildForm();
          }}
          onRebuild={onRebuildForm}
        />
      ))}
      <button
        type="button"
        className="ed-btn"
        onClick={() => {
          const id = nextSpawnLayerId(entries);
          entries.push(createDefaultSpawnEntry(id, `Spawn ${entries.length + 1}`));
          onMarkSpawnCatalogDirty();
          onRebuildForm();
        }}
      >
        Add catalog entry
      </button>
    </>
  );
}
