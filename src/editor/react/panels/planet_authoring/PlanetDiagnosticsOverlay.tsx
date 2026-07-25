import type { ReactElement } from 'react';
import { biomeDisplayName } from '../../../../world/climate';
import {
  surfaceDestinationDisplayName,
  type SurfaceDestination,
} from '../../../../world/biome-teleport';
import type { LandingSiteHint } from '../../../../types';
import type { PreviewDiagnostics } from '../../../panels/planet-preview-controller';

export type PlanetDiagnosticsOverlayProps = {
  diagnosticTargets: readonly SurfaceDestination[];
  activePreviewDestination: SurfaceDestination | null;
  activePreviewVariant: number;
  activePreviewLocation: LandingSiteHint;
  destinationAvailability: ReadonlyMap<SurfaceDestination, boolean>;
  previewDiagnostics: PreviewDiagnostics | null;
  onSelectDestination: (destination: SurfaceDestination, variant: number) => void;
  onSetSpawn: () => void;
  onTestPlay: () => void;
};

export function PlanetDiagnosticsOverlay({
  diagnosticTargets,
  activePreviewDestination,
  activePreviewVariant,
  activePreviewLocation,
  destinationAvailability,
  previewDiagnostics,
  onSelectDestination,
  onSetSpawn,
  onTestPlay,
}: PlanetDiagnosticsOverlayProps): ReactElement {
  const variantEnabled = activePreviewDestination != null;
  const latDegrees = (activePreviewLocation.latRadians * 180) / Math.PI;
  const lonDegrees = (activePreviewLocation.lonRadians * 180) / Math.PI;

  const metrics: readonly [string, string][] = previewDiagnostics
    ? [
        ['Location', `${latDegrees.toFixed(4)}°, ${lonDegrees.toFixed(4)}°`],
        [
          'Center',
          previewDiagnostics.centerWater === 'dry'
            ? biomeDisplayName(previewDiagnostics.centerBiome)
            : previewDiagnostics.centerWater,
        ],
        [
          'Elevation',
          `${previewDiagnostics.minHeight.toFixed(1)}–${previewDiagnostics.maxHeight.toFixed(1)} m`,
        ],
        ['Moisture', previewDiagnostics.meanMoisture.toFixed(3)],
        ['Temperature', previewDiagnostics.meanTemperature.toFixed(3)],
        ['Max slope', `${previewDiagnostics.maxSlopeDegrees.toFixed(1)}°`],
        [
          'Target coverage',
          activePreviewDestination == null
            ? '—'
            : `${(previewDiagnostics.coverage * 100).toFixed(1)}%`,
        ],
      ]
    : [];

  return (
    <div className="ed-planet-diagnostics">
      <div className="ed-planet-diagnostics-title">512 m terrain diagnostic</div>
      <div className="ed-planet-diagnostics-note">
        Land biomes are recipe-driven. Coast, lake, and river are generated features.
      </div>
      <div className="ed-planet-destination-chips">
        {diagnosticTargets.map((destination) => {
          const selected = destination === activePreviewDestination;
          const available = destinationAvailability.get(destination);
          return (
            <button
              key={destination}
              type="button"
              className={`ed-planet-destination-chip${selected ? ' is-active' : ''}${
                available === false ? ' is-missing' : ''
              }`}
              title={
                available === false
                  ? `${surfaceDestinationDisplayName(destination)} was not found in the global probe`
                  : `Preview ${surfaceDestinationDisplayName(destination)}`
              }
              onClick={() => onSelectDestination(destination, 0)}
            >
              {surfaceDestinationDisplayName(destination)}
            </button>
          );
        })}
      </div>
      <div className="ed-planet-variant-row">
        <button
          type="button"
          className="ed-btn"
          disabled={!variantEnabled || activePreviewVariant <= 0}
          onClick={() => {
            if (!activePreviewDestination || activePreviewVariant <= 0) return;
            onSelectDestination(activePreviewDestination, activePreviewVariant - 1);
          }}
        >
          Previous
        </button>
        <span className="ed-planet-variant-label">
          {activePreviewDestination
            ? `${surfaceDestinationDisplayName(activePreviewDestination)} · sample ${activePreviewVariant + 1}`
            : 'Spawn hint'}
        </span>
        <button
          type="button"
          className="ed-btn"
          disabled={!variantEnabled}
          onClick={() => {
            if (!activePreviewDestination) return;
            onSelectDestination(activePreviewDestination, activePreviewVariant + 1);
          }}
        >
          Next
        </button>
      </div>
      <div className="ed-planet-metrics">
        {!previewDiagnostics ? (
          <span>Building terrain metrics…</span>
        ) : (
          metrics.flatMap(([label, value]) => [
            <span key={`${label}-label`} className="ed-planet-metric-label">
              {label}
            </span>,
            <strong key={`${label}-value`}>{value}</strong>,
          ])
        )}
      </div>
      <div className="ed-planet-diagnostic-actions">
        <button type="button" className="ed-btn" onClick={onSetSpawn}>
          Set Spawn Here
        </button>
        <button type="button" className="ed-btn ed-btn-accent" onClick={onTestPlay}>
          Test Play Here
        </button>
      </div>
    </div>
  );
}
