import type { ReactElement } from 'react';
import {
  MAX_CLOUD_LAYERS,
  type PlanetCloudLayerRecipe,
} from '../../../../world/planets/sky-schema';
import { EmptyNote } from '../InspectorForm';
import {
  PlanetCheckboxField,
  PlanetColorField,
  PlanetNumberField,
} from './Fields';
import type { PlanetAuthoringCloudSectionProps } from './section-types';

function CloudLayerEditor({
  layer,
  index,
  onChange,
  onRemove,
}: {
  layer: PlanetCloudLayerRecipe;
  index: number;
  onChange: () => void;
  onRemove: () => void;
}): ReactElement {
  return (
    <div className="ed-planet-spawn-layer">
      <div className="ed-planet-spawn-layer-title">{`Layer ${index + 1}`}</div>
      <PlanetNumberField
        label="Altitude (m)"
        value={layer.altitudeMeters}
        step={100}
        onChange={(value) => {
          layer.altitudeMeters = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Coverage"
        value={layer.coverage}
        step={0.02}
        onChange={(value) => {
          layer.coverage = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Opacity"
        value={layer.opacity}
        step={0.05}
        onChange={(value) => {
          layer.opacity = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Cell scale"
        value={layer.scale}
        step={0.1}
        onChange={(value) => {
          layer.scale = value;
          onChange();
        }}
      />
      <PlanetNumberField
        label="Wind (m/s)"
        value={layer.windMetersPerSecond}
        step={1}
        onChange={(value) => {
          layer.windMetersPerSecond = value;
          onChange();
        }}
      />
      <button
        type="button"
        className="ed-btn ed-planet-remove-layer"
        onClick={onRemove}
      >
        Remove layer
      </button>
    </div>
  );
}

export function CloudsSection({
  doc,
  onMarkDirty,
  onRebuildForm,
}: PlanetAuthoringCloudSectionProps): ReactElement {
  const { clouds } = doc.sky;
  return (
    <>
      <EmptyNote>
        Each layer is a full-sky transparent pass, so cost scales with layer
        count — two is the tuned default. Coverage is the fraction of sky
        filled. Sharpness is the density ramp: <b>low is crisp cumulus, high is
        soft haze</b>, and above ~0.3 the sky loses its clear air entirely.
        Cell scale sets cloud size against the layer altitude, so a low deck
        needs a higher scale than a high one to look the same. Colors are lit by
        the sun, so a warm sunset tint only shows at dawn and dusk.
        Everything here tunes live except adding/removing a layer and detail
        octaves, which recompile the shader on the next Play.
      </EmptyNote>
      <PlanetCheckboxField
        label="Enabled"
        checked={clouds.enabled}
        onChange={(value) => {
          clouds.enabled = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Edge sharpness"
        value={clouds.sharpness}
        step={0.02}
        onChange={(value) => {
          clouds.sharpness = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Detail octaves"
        value={clouds.detail}
        step={1}
        onChange={(value) => {
          clouds.detail = Math.round(value);
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Sunlit"
        value={clouds.litColor}
        onChange={(value) => {
          clouds.litColor = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Shadowed"
        value={clouds.shadowColor}
        onChange={(value) => {
          clouds.shadowColor = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Sunset tint"
        value={clouds.sunsetColor}
        onChange={(value) => {
          clouds.sunsetColor = value;
          onMarkDirty();
        }}
      />
      <PlanetColorField
        label="Night"
        value={clouds.nightColor}
        onChange={(value) => {
          clouds.nightColor = value;
          onMarkDirty();
        }}
      />
      <PlanetNumberField
        label="Silver lining"
        value={clouds.silverLining}
        step={0.05}
        onChange={(value) => {
          clouds.silverLining = value;
          onMarkDirty();
        }}
      />
      {clouds.layers.map((layer, index) => (
        <CloudLayerEditor
          // Layers have no stable id; the array is the identity, and the form
          // is rebuilt wholesale on add/remove.
          key={`cloud-layer-${index}`}
          layer={layer}
          index={index}
          onChange={onMarkDirty}
          onRemove={() => {
            clouds.layers.splice(index, 1);
            onMarkDirty();
            onRebuildForm();
          }}
        />
      ))}
      {clouds.layers.length < MAX_CLOUD_LAYERS ? (
        <button
          type="button"
          className="ed-btn"
          onClick={() => {
            const previous = clouds.layers[clouds.layers.length - 1];
            clouds.layers.push({
              altitudeMeters: (previous?.altitudeMeters ?? 1_400) * 2.5,
              coverage: Math.max(0.12, (previous?.coverage ?? 0.4) * 0.7),
              opacity: Math.max(0.15, (previous?.opacity ?? 0.8) * 0.55),
              scale: (previous?.scale ?? 1) * 2,
              // Higher decks run faster and shear against the one below.
              windMetersPerSecond:
                -(previous?.windMetersPerSecond ?? 11) * 1.6,
            });
            onMarkDirty();
            onRebuildForm();
          }}
        >
          Add cloud layer
        </button>
      ) : null}
    </>
  );
}
