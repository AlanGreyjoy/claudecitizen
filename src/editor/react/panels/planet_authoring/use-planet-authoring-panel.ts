import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fetchPlanet, fetchPlanetList, savePlanet, type PlanetListEntry } from '../../../api';
import {
  findSurfaceDestinationVariant,
  surfaceDestinationDisplayName,
  type SurfaceDestination,
} from '../../../../world/biome-teleport';
import { cartesianFromLatLonAlt } from '../../../../world/coordinates';
import { activatePlanetDocument } from '../../../../world/planets/runtime';
import {
  createDefaultPlanetDocument,
  createDefaultSpawnCatalog,
  parsePlanetDocument,
  planetPhysicsFromDocument,
  type PlanetDocument,
} from '../../../../world/planets/schema';
import { samplePlanetSurface } from '../../../../world/planet-surface';
import type { LandingSiteHint } from '../../../../types';
import {
  createPlanetPreviewController,
  type PlanetPreviewController,
  type PreviewDiagnostics,
} from '../../../panels/planet-preview-controller';
import { cloneDocument, documentsEqual } from './utils';

const DIAGNOSTIC_FEATURES: readonly SurfaceDestination[] = ['coast', 'lake', 'river'];

export const DEFAULT_PREVIEW_LOCATION: LandingSiteHint = {
  latRadians: -0.946,
  lonRadians: 2.176407,
};

function createSidebarHost(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ed-planet-sidebar';
  return el;
}

function ensureSpawnCatalog(doc: PlanetDocument): void {
  if (
    !doc.spawning ||
    typeof doc.spawning !== 'object' ||
    Array.isArray(doc.spawning) ||
    !Array.isArray(doc.spawning.entries)
  ) {
    doc.spawning = createDefaultSpawnCatalog();
  }
}

export type PlanetAuthoringPanelState = {
  hidden: boolean;
  documentState: PlanetDocument;
  status: string;
  statusError: boolean;
  formVersion: number;
  expandedSections: Set<string>;
  activePreviewLocation: LandingSiteHint;
  activePreviewDestination: SurfaceDestination | null;
  activePreviewVariant: number;
  previewDiagnostics: PreviewDiagnostics | null;
  destinationAvailability: Map<SurfaceDestination, boolean>;
  canvasMountRef: React.RefObject<HTMLDivElement | null>;
  sidebarHost: HTMLDivElement;
  diagnosticTargets: () => SurfaceDestination[];
  setStatusMessage: (message: string, isError?: boolean) => void;
  selectPreviewDestination: (destination: SurfaceDestination, variant: number) => void;
  toggleSection: (title: string) => void;
  openPlanetPicker: () => void;
  save: () => Promise<boolean>;
  previewPlanet: () => Promise<boolean>;
  handleNewPlanet: () => void;
  handleSetSpawn: () => void;
  handleTestPlay: () => void;
  markDirty: () => void;
  markBiomeDirty: () => void;
  markVegetationDirty: () => void;
  markSpawnCatalogDirty: () => void;
  rebuildForm: () => void;
  previewControllerRef: RefObject<PlanetPreviewController | null>;
  activate: () => void;
  deactivate: () => void;
  loadPlanet: (id: string) => Promise<boolean>;
  documentRef: RefObject<PlanetDocument>;
  savedSnapshotRef: RefObject<PlanetDocument>;
};

export function usePlanetAuthoringPanel(hidden: boolean): PlanetAuthoringPanelState {
  const [documentState, setDocumentState] = useState<PlanetDocument>(() =>
    createDefaultPlanetDocument(),
  );
  const [savedSnapshot, setSavedSnapshot] = useState<PlanetDocument>(() =>
    cloneDocument(createDefaultPlanetDocument()),
  );
  const [status, setStatus] = useState('Asteron');
  const [statusError, setStatusError] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const [activePreviewLocation, setActivePreviewLocation] = useState<LandingSiteHint>({
    ...DEFAULT_PREVIEW_LOCATION,
  });
  const [activePreviewDestination, setActivePreviewDestination] =
    useState<SurfaceDestination | null>(null);
  const [activePreviewVariant, setActivePreviewVariant] = useState(0);
  const [previewDiagnostics, setPreviewDiagnostics] = useState<PreviewDiagnostics | null>(null);
  const [destinationAvailability, setDestinationAvailability] = useState<
    Map<SurfaceDestination, boolean>
  >(() => new Map());

  const documentRef = useRef(documentState);
  const savedSnapshotRef = useRef(savedSnapshot);
  const planetListRef = useRef<PlanetListEntry[]>([]);
  const loadGenerationRef = useRef(0);
  const previewLocationRef = useRef(activePreviewLocation);
  const previewDestinationRef = useRef(activePreviewDestination);
  const previewControllerRef = useRef<PlanetPreviewController | null>(null);
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const sidebarHostRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const activeRef = useRef(false);
  const diagnosticScanTimerRef = useRef(0);
  const vegetationPreviewTimerRef = useRef(0);

  if (sidebarHostRef.current === null) {
    sidebarHostRef.current = createSidebarHost();
  }

  documentRef.current = documentState;
  savedSnapshotRef.current = savedSnapshot;
  previewLocationRef.current = activePreviewLocation;
  previewDestinationRef.current = activePreviewDestination;

  const setStatusMessage = useCallback((message: string, isError = false) => {
    setStatus(message);
    setStatusError(isError);
  }, []);

  const diagnosticTargets = useCallback((): SurfaceDestination[] => {
    return [...documentRef.current.biomes.enabled, ...DIAGNOSTIC_FEATURES];
  }, []);

  const refreshDestinationAvailability = useCallback(() => {
    const doc = documentRef.current;
    const next = new Map<SurfaceDestination, boolean>();
    for (const biome of doc.biomes.enabled) {
      next.set(biome, false);
    }
    let hasDryLand = false;
    let hasOcean = false;
    const probeCount = 768;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const planet = planetPhysicsFromDocument(doc);
    activatePlanetDocument(doc);
    for (let index = 0; index < probeCount; index += 1) {
      const y = 1 - (2 * (index + 0.5)) / probeCount;
      const latRadians = Math.asin(y);
      const lonRadians = ((index * goldenAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
      const surface = samplePlanetSurface(
        planet,
        doc.seed,
        cartesianFromLatLonAlt(latRadians, lonRadians, 0, planet.radiusMeters),
      );
      if (surface.waterBody == null) {
        hasDryLand = true;
        next.set(surface.biome, true);
      } else {
        if (surface.waterBody === 'lake' || surface.waterBody === 'river') {
          next.set(surface.waterBody, true);
        }
        if (surface.waterBody === 'ocean') hasOcean = true;
      }
    }
    next.set('coast', hasDryLand && hasOcean);
    setDestinationAvailability(next);
  }, []);

  const resetDiagnosticLocation = useCallback(
    (doc: PlanetDocument) => {
      const location = { ...(doc.spawnHint ?? DEFAULT_PREVIEW_LOCATION) };
      setActivePreviewLocation(location);
      previewLocationRef.current = location;
      setActivePreviewDestination(null);
      previewDestinationRef.current = null;
      setActivePreviewVariant(0);
      setPreviewDiagnostics(null);
      refreshDestinationAvailability();
    },
    [refreshDestinationAvailability],
  );

  const selectPreviewDestination = useCallback(
    (destination: SurfaceDestination, variant: number) => {
      const doc = documentRef.current;
      activatePlanetDocument(doc);
      setStatusMessage(
        `Finding ${surfaceDestinationDisplayName(destination)} sample ${variant + 1}…`,
      );
      const location = findSurfaceDestinationVariant(
        planetPhysicsFromDocument(doc),
        doc.seed,
        destination,
        Math.max(0, variant),
      );
      if (!location) {
        setDestinationAvailability((prev) => {
          const next = new Map(prev);
          next.set(destination, false);
          return next;
        });
        setStatusMessage(
          `No ${surfaceDestinationDisplayName(destination)} location was generated by this recipe.`,
          true,
        );
        return;
      }
      setDestinationAvailability((prev) => {
        const next = new Map(prev);
        next.set(destination, true);
        return next;
      });
      const nextLocation = {
        latRadians: location.latRadians,
        lonRadians: location.lonRadians,
      };
      setActivePreviewDestination(destination);
      previewDestinationRef.current = destination;
      setActivePreviewVariant(Math.max(0, variant));
      setActivePreviewLocation(nextLocation);
      previewLocationRef.current = nextLocation;
      setPreviewDiagnostics(null);
      previewControllerRef.current?.resetCameraOnNextRebuild();
      previewControllerRef.current?.markPreviewDirty();
      setStatusMessage(
        `Previewing ${surfaceDestinationDisplayName(destination)} sample ${Math.max(0, variant) + 1}.`,
      );
    },
    [setStatusMessage],
  );

  const rebuildForm = useCallback(() => {
    setFormVersion((v) => v + 1);
  }, []);

  const markDirty = useCallback(() => {
    previewControllerRef.current?.markPreviewDirty();
    setStatusMessage(`${documentRef.current.name} — unsaved`);
    window.clearTimeout(diagnosticScanTimerRef.current);
    diagnosticScanTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current) return;
      refreshDestinationAvailability();
    }, 250);
  }, [refreshDestinationAvailability, setStatusMessage]);

  const markBiomeDirty = useCallback(() => {
    markDirty();
  }, [markDirty]);

  const markVegetationDirty = useCallback(() => {
    setStatusMessage(`${documentRef.current.name} — unsaved`);
    window.clearTimeout(vegetationPreviewTimerRef.current);
    vegetationPreviewTimerRef.current = window.setTimeout(() => {
      if (!activeRef.current) return;
      previewControllerRef.current?.refreshHeightfieldPreview();
    }, 200);
  }, [setStatusMessage]);

  const markSpawnCatalogDirty = useCallback(() => {
    markVegetationDirty();
  }, [markVegetationDirty]);

  const toggleSection = useCallback((title: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const refreshPlanetList = useCallback(async () => {
    try {
      planetListRef.current = await fetchPlanetList();
    } catch {
      planetListRef.current = [
        { id: documentRef.current.id, name: documentRef.current.name },
      ];
    }
  }, []);

  const loadPlanet = useCallback(
    async (id: string): Promise<boolean> => {
      const hasUnsaved =
        !documentsEqual(documentRef.current, savedSnapshotRef.current);
      if (hasUnsaved && !window.confirm('Discard unsaved planet changes?')) {
        return false;
      }
      const generation = ++loadGenerationRef.current;
      try {
        const loaded = await fetchPlanet(id);
        if (generation !== loadGenerationRef.current) return false;
        ensureSpawnCatalog(loaded);
        setDocumentState(loaded);
        documentRef.current = loaded;
        const snapshot = cloneDocument(loaded);
        setSavedSnapshot(snapshot);
        savedSnapshotRef.current = snapshot;
        activatePlanetDocument(loaded);
        resetDiagnosticLocation(loaded);
        rebuildForm();
        previewControllerRef.current?.resetCameraOnNextRebuild();
        previewControllerRef.current?.markPreviewDirty();
        setStatusMessage(`${loaded.name} (${loaded.id})`);
        return true;
      } catch (error) {
        if (generation !== loadGenerationRef.current) return false;
        setStatusMessage(error instanceof Error ? error.message : String(error), true);
        return false;
      }
    },
    [rebuildForm, resetDiagnosticLocation, setStatusMessage],
  );

  const save = useCallback(async (): Promise<boolean> => {
    const parsed = parsePlanetDocument(documentRef.current);
    if (!parsed) {
      setStatusMessage('Invalid planet document — check id slug and fields.', true);
      return false;
    }
    try {
      const path = await savePlanet(parsed);
      setDocumentState(parsed);
      documentRef.current = parsed;
      const snapshot = cloneDocument(parsed);
      setSavedSnapshot(snapshot);
      savedSnapshotRef.current = snapshot;
      activatePlanetDocument(parsed);
      await refreshPlanetList();
      setStatusMessage(`Saved ${path}`);
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }, [refreshPlanetList, setStatusMessage]);

  const previewPlanet = useCallback(async (): Promise<boolean> => {
    const doc = documentRef.current;
    doc.spawnHint = { ...previewLocationRef.current };
    setDocumentState({ ...doc });
    const ok = await save();
    if (!ok) return false;
    const id = documentRef.current.id;
    window.location.href = `/?boot=play&planetId=${encodeURIComponent(id)}&spawn=surface&from=editor&debug=1`;
    return true;
  }, [save]);

  const openPlanetPicker = useCallback(() => {
    const query = window.prompt(
      `Open planet id:\n${planetListRef.current.map((entry) => `${entry.id} — ${entry.name}`).join('\n')}`,
      documentRef.current.id,
    );
    if (!query) return;
    void loadPlanet(query.trim());
  }, [loadPlanet]);

  const handleNewPlanet = useCallback(() => {
    if (
      !documentsEqual(documentRef.current, savedSnapshotRef.current) &&
      !window.confirm('Discard unsaved planet changes?')
    ) {
      return;
    }
    const id = window.prompt('New planet id (slug)', 'new-planet')?.trim().toLowerCase();
    if (!id) return;
    const doc = createDefaultPlanetDocument(id, id);
    ensureSpawnCatalog(doc);
    setDocumentState(doc);
    documentRef.current = doc;
    const snapshot = cloneDocument(doc);
    setSavedSnapshot(snapshot);
    savedSnapshotRef.current = snapshot;
    activatePlanetDocument(doc);
    resetDiagnosticLocation(doc);
    rebuildForm();
    previewControllerRef.current?.resetCameraOnNextRebuild();
    previewControllerRef.current?.markPreviewDirty();
    setStatusMessage(`New ${id} — unsaved`);
  }, [rebuildForm, resetDiagnosticLocation, setStatusMessage]);

  const handleSetSpawn = useCallback(() => {
    const doc = documentRef.current;
    doc.spawnHint = { ...previewLocationRef.current };
    setDocumentState({ ...doc });
    const lat = (previewLocationRef.current.latRadians * 180) / Math.PI;
    const lon = (previewLocationRef.current.lonRadians * 180) / Math.PI;
    setStatusMessage(`Spawn set to ${lat.toFixed(4)}°, ${lon.toFixed(4)}° — unsaved.`);
  }, [setStatusMessage]);

  const handleTestPlay = useCallback(() => {
    const doc = documentRef.current;
    doc.spawnHint = { ...previewLocationRef.current };
    setDocumentState({ ...doc });
    void previewPlanet();
  }, [previewPlanet]);

  useEffect(() => {
    const host = canvasMountRef.current;
    if (!host) return;
    const controller = createPlanetPreviewController(host, {
      getDocument: () => documentRef.current,
      getPreviewLocation: () => previewLocationRef.current,
      getPreviewDestination: () => previewDestinationRef.current,
      onDiagnostics: setPreviewDiagnostics,
      onBuildStatus: setStatusMessage,
    });
    previewControllerRef.current = controller;
    return () => {
      controller.dispose();
      previewControllerRef.current = null;
    };
  }, [setStatusMessage]);

  const activate = useCallback(() => {
    activeRef.current = true;
    previewControllerRef.current?.activate();
    if (!initializedRef.current) {
      initializedRef.current = true;
      void (async () => {
        await refreshPlanetList();
        const params = new URLSearchParams(window.location.search);
        const planetId = params.get('planetId') ?? 'asteron';
        await loadPlanet(planetId);
        previewControllerRef.current?.markPreviewDirty();
      })();
    }
  }, [loadPlanet, refreshPlanetList]);

  const deactivate = useCallback(() => {
    activeRef.current = false;
    window.clearTimeout(vegetationPreviewTimerRef.current);
    window.clearTimeout(diagnosticScanTimerRef.current);
    previewControllerRef.current?.deactivate();
  }, []);

  useEffect(() => {
    return () => {
      deactivate();
      sidebarHostRef.current?.remove();
    };
  }, [deactivate]);

  ensureSpawnCatalog(documentState);

  return {
    hidden,
    documentState,
    status,
    statusError,
    formVersion,
    expandedSections,
    activePreviewLocation,
    activePreviewDestination,
    activePreviewVariant,
    previewDiagnostics,
    destinationAvailability,
    canvasMountRef,
    sidebarHost: sidebarHostRef.current!,
    diagnosticTargets,
    setStatusMessage,
    selectPreviewDestination,
    toggleSection,
    openPlanetPicker,
    save,
    previewPlanet,
    handleNewPlanet,
    handleSetSpawn,
    handleTestPlay,
    markDirty,
    markBiomeDirty,
    markVegetationDirty,
    markSpawnCatalogDirty,
    rebuildForm,
    previewControllerRef,
    activate,
    deactivate,
    loadPlanet,
    documentRef,
    savedSnapshotRef,
  };
}
