import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { PlanetDocument } from '../../../world/planets/schema';
import { PlanetAuthoringForm } from './planet_authoring/PlanetAuthoringForm';
import { PlanetDiagnosticsOverlay } from './planet_authoring/PlanetDiagnosticsOverlay';
import { documentsEqual } from './planet_authoring/utils';
import { usePlanetAuthoringPanel } from './planet_authoring/use-planet-authoring-panel';

export interface PlanetAuthoringEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  loadPlanet: (id: string) => Promise<boolean>;
  getDocument: () => PlanetDocument | null;
  previewPlanet: () => Promise<boolean>;
  getLeftPanel: () => HTMLElement;
}

type PlanetAuthoringPanelProps = {
  hidden: boolean;
  onTestPlay: () => void;
};

export const PlanetAuthoringPanel = forwardRef<PlanetAuthoringEditor, PlanetAuthoringPanelProps>(
  function PlanetAuthoringPanel({ hidden, onTestPlay }, ref): ReactElement {
    const previewHostRef = useRef<HTMLDivElement>(null);
    const panel = usePlanetAuthoringPanel(hidden, onTestPlay);

    useImperativeHandle(
      ref,
      () => ({
        activate: panel.activate,
        deactivate: panel.deactivate,
        canLeave: () =>
          documentsEqual(panel.documentRef.current, panel.savedSnapshotRef.current) ||
          window.confirm('Leave Planet Authoring with unsaved changes?'),
        isDirty: () => !documentsEqual(panel.documentRef.current, panel.savedSnapshotRef.current),
        save: panel.save,
        loadPlanet: panel.loadPlanet,
        getDocument: () => panel.documentRef.current,
        previewPlanet: panel.previewPlanet,
        getLeftPanel: () => panel.sidebarHost,
      }),
      [
        panel.activate,
        panel.deactivate,
        panel.documentRef,
        panel.loadPlanet,
        panel.previewPlanet,
        panel.save,
        panel.savedSnapshotRef,
        panel.sidebarHost,
      ],
    );

    return (
      <>
        <div
          className={`ed-scene-panel ed-planet-authoring-host${hidden ? ' is-hidden' : ''}`}
        >
          <div ref={previewHostRef} className="ed-planet-preview">
            <div ref={panel.canvasMountRef} style={{ width: '100%', height: '100%' }} />
            <PlanetDiagnosticsOverlay
              diagnosticTargets={panel.diagnosticTargets()}
              activePreviewDestination={panel.activePreviewDestination}
              activePreviewVariant={panel.activePreviewVariant}
              activePreviewLocation={panel.activePreviewLocation}
              destinationAvailability={panel.destinationAvailability}
              previewDiagnostics={panel.previewDiagnostics}
              onSelectDestination={panel.selectPreviewDestination}
              onSetSpawn={panel.handleSetSpawn}
              onTestPlay={panel.handleTestPlay}
            />
          </div>
        </div>
        {createPortal(
          <>
            <h2 className="ed-base-panel-title">Planet Authoring</h2>
            <div className={`ed-planet-status${panel.statusError ? ' is-error' : ''}`}>
              {panel.status}
            </div>
            <div className="ed-base-actions">
              <button type="button" className="ed-btn" onClick={panel.openPlanetPicker}>
                Open…
              </button>
              <button type="button" className="ed-btn" onClick={() => void panel.save()}>
                Save
              </button>
              <button
                type="button"
                className="ed-btn ed-btn-accent"
                onClick={() => panel.previewControllerRef.current?.refreshHeightfieldPreview()}
              >
                Preview
              </button>
              <button type="button" className="ed-btn" onClick={() => void panel.previewPlanet()}>
                Test Play
              </button>
              <button type="button" className="ed-btn" onClick={panel.handleNewPlanet}>
                New
              </button>
            </div>
            <div className="ed-planet-form" key={panel.formVersion}>
              <PlanetAuthoringForm
                doc={panel.documentState}
                expandedSections={panel.expandedSections}
                onToggleSection={panel.toggleSection}
                onMarkDirty={panel.markDirty}
                onMarkBiomeDirty={panel.markBiomeDirty}
                onMarkVegetationDirty={panel.markVegetationDirty}
                onMarkSpawnCatalogDirty={panel.markSpawnCatalogDirty}
                onStatusError={(message) => panel.setStatusMessage(message, true)}
                onRebuildForm={panel.rebuildForm}
              />
            </div>
          </>,
          panel.sidebarHost,
        )}
      </>
    );
  },
);
