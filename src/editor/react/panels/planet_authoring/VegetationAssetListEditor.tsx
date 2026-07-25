import type { ReactElement } from 'react';
import type { VegetationLayerSettings } from '../../../../types';
import { PlanetDropAssetField } from './Fields';
import { ensureVegetationLayer, isGrassImageAssetUrl, isModelAssetUrl } from './utils';

export function VegetationAssetListEditor({
  layer,
  label,
  kind,
  onChange,
  onRebuild,
}: {
  layer: VegetationLayerSettings;
  label: string;
  kind: 'grass' | 'tree';
  onChange: () => void;
  onRebuild: () => void;
}): ReactElement {
  ensureVegetationLayer(layer);
  const assetField = kind === 'grass' ? 'grass' : 'tree';
  return (
    <div className="ed-planet-veg-assets">
      <div className="ed-planet-spawn-layer-title">{label}</div>
      {layer.assetUrls.map((url, index) => (
        <div key={index} className="ed-planet-veg-asset-row">
          {assetField === 'grass' ? (
            <PlanetDropAssetField
              label={`Asset ${index + 1}`}
              value={url}
              placeholder="Drop .png from Project…"
              accept={isGrassImageAssetUrl}
              onChange={(value) => {
                layer.assetUrls[index] = value;
                onChange();
              }}
            />
          ) : (
            <PlanetDropAssetField
              label={`Asset ${index + 1}`}
              value={url}
              placeholder="Drop .glb / .gltf from Project…"
              accept={isModelAssetUrl}
              onChange={(value) => {
                layer.assetUrls[index] = value;
                onChange();
              }}
            />
          )}
          <button
            type="button"
            className="ed-btn ed-planet-remove-layer"
            onClick={() => {
              layer.assetUrls.splice(index, 1);
              onChange();
              onRebuild();
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ed-btn"
        onClick={() => {
          layer.assetUrls.push('');
          onChange();
          onRebuild();
        }}
      >
        Add asset
      </button>
    </div>
  );
}
