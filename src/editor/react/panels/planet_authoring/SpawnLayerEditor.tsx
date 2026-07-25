import type { ReactElement } from 'react';
import type { PlanetSpawnLayer } from '../../../../types';
import {
  PlanetCheckboxField,
  PlanetDropAssetField,
  PlanetField,
  PlanetNumberField,
  PlanetTextField,
} from './Fields';
import { isModelAssetUrl } from './utils';
import { BiomeMultiSelect } from './BiomeMultiSelect';

export type SpawnLayerEditorProps = {
  layer: PlanetSpawnLayer;
  onChange: () => void;
  onRemove: () => void;
  onRebuild: () => void;
};

export function SpawnLayerEditor({
  layer,
  onChange,
  onRemove,
  onRebuild,
}: SpawnLayerEditorProps): ReactElement {
  if (typeof layer.weight !== 'number' || !Number.isFinite(layer.weight)) {
    layer.weight = 1;
  }
  if (
    typeof layer.terrainInsetMeters !== 'number' ||
    !Number.isFinite(layer.terrainInsetMeters)
  ) {
    layer.terrainInsetMeters = 0;
  }
  const half = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];

  return (
    <div className="ed-planet-spawn-layer">
      <div className="ed-planet-spawn-layer-title">{layer.name || layer.id}</div>
      <PlanetCheckboxField
        label="Enabled"
        checked={layer.enabled}
        onChange={(value) => {
          layer.enabled = value;
          onChange();
        }}
      />
      <PlanetTextField
        label="Name"
        value={layer.name}
        onChange={(value) => {
          layer.name = value;
          onChange();
        }}
      />
      <PlanetDropAssetField
        label="Asset"
        value={layer.assetUrl}
        placeholder="Drop .glb / .gltf from Project…"
        accept={isModelAssetUrl}
        onChange={(value) => {
          layer.assetUrl = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Weight"
        value={layer.weight}
        step={0.01}
        onChange={(value) => {
          layer.weight = Math.max(0, value);
          onChange();
        }}
      />
      <PlanetNumberField
        label="Density"
        value={layer.density}
        onChange={(value) => {
          layer.density = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Gap (m)"
        value={layer.gapMeters}
        onChange={(value) => {
          layer.gapMeters = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Min scale"
        value={layer.minScale}
        onChange={(value) => {
          layer.minScale = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Max scale"
        value={layer.maxScale}
        onChange={(value) => {
          layer.maxScale = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Min height 0–1"
        value={layer.minNormalizedHeight}
        step={0.001}
        onChange={(value) => {
          layer.minNormalizedHeight = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Max height 0–1"
        value={layer.maxNormalizedHeight}
        step={0.001}
        onChange={(value) => {
          layer.maxNormalizedHeight = value;
          onChange();
        }}
      />
      <PlanetCheckboxField
        label="Align to normal"
        checked={layer.alignToNormal}
        onChange={(value) => {
          layer.alignToNormal = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Terrain inset (m)"
        value={layer.terrainInsetMeters}
        step={0.01}
        onChange={(value) => {
          layer.terrainInsetMeters = value;
          onChange();
        }}
      />
      <BiomeMultiSelect
        selected={layer.biomes}
        onChange={(biomes) => {
          layer.biomes = biomes;
          onChange();
          onRebuild();
        }}
      />
      <PlanetField label="Collider">
        <select
          className="ed-input"
          value={layer.collider.shape}
          onChange={(event) => {
            const shape = event.currentTarget.value === 'capsule' ? 'capsule' : 'box';
            if (shape === 'capsule') {
              layer.collider = {
                shape: 'capsule',
                radius: layer.collider.radius ?? 0.4,
                halfHeight: layer.collider.halfHeight ?? 0.5,
              };
            } else {
              layer.collider = {
                shape: 'box',
                halfExtents: layer.collider.halfExtents ?? [0.5, 0.5, 0.5],
              };
            }
            onChange();
            onRebuild();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <option value="box">box</option>
          <option value="capsule">capsule</option>
        </select>
      </PlanetField>
      {layer.collider.shape === 'capsule' ? (
        <>
          <PlanetNumberField
            label="Radius"
            value={layer.collider.radius ?? 0.4}
            onChange={(value) => {
              layer.collider.radius = value;
              onChange();
            }}
          />
          <PlanetNumberField
            label="Half height"
            value={layer.collider.halfHeight ?? 0.5}
            onChange={(value) => {
              layer.collider.halfHeight = value;
              onChange();
            }}
          />
        </>
      ) : (
        <>
          <PlanetNumberField
            label="Half X"
            value={half[0]}
            onChange={(value) => {
              const next = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
              layer.collider.halfExtents = [value, next[1], next[2]];
              onChange();
            }}
          />
          <PlanetNumberField
            label="Half Y"
            value={half[1]}
            onChange={(value) => {
              const next = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
              layer.collider.halfExtents = [next[0], value, next[2]];
              onChange();
            }}
          />
          <PlanetNumberField
            label="Half Z"
            value={half[2]}
            onChange={(value) => {
              const next = layer.collider.halfExtents ?? [0.5, 0.5, 0.5];
              layer.collider.halfExtents = [next[0], next[1], value];
              onChange();
            }}
          />
        </>
      )}
      <button type="button" className="ed-btn ed-planet-remove-layer" onClick={onRemove}>
        Remove entry
      </button>
    </div>
  );
}
