import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import {
  fetchPlanetList,
  fetchPrefabList,
  fetchSceneList,
  fetchSystem,
  fetchSystemList,
  saveSystem,
  type PlanetListEntry,
  type PrefabListEntry,
  type SceneListEntry,
  type SystemListEntry,
} from '../../api';
import { activateSystemDocument } from '../../../world/systems/runtime';
import {
  createDefaultSystemDocument,
  DEFAULT_STATION_ALTITUDE_METERS,
  parseSystemDocument,
  SYSTEM_ID_PATTERN,
  SYSTEM_MAP_PLANET_DISTANCE_METERS,
  SYSTEM_MAP_STATION_OFFSET_METERS,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
} from '../../../world/systems/schema';
import {
  createSystemMapCanvas,
  type SystemMapCanvasController,
  type SystemMapSelection,
} from '../../panels/system-map-canvas';
import { SystemMapForm } from './system_map/SystemMapForm';

function cloneDocument(doc: SystemDocument): SystemDocument {
  return structuredClone(doc);
}

function documentsEqual(a: SystemDocument | null, b: SystemDocument | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

export interface SystemMapEditor {
  activate: () => void;
  deactivate: () => void;
  canLeave: () => boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  loadSystem: (id: string) => Promise<boolean>;
  getDocument: () => SystemDocument | null;
  getLeftPanel: () => HTMLElement;
}

type SystemMapPanelProps = {
  hidden: boolean;
};

function createSidebarHost(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ed-system-sidebar';
  return el;
}

export const SystemMapPanel = forwardRef<SystemMapEditor, SystemMapPanelProps>(
  function SystemMapPanel({ hidden }, ref): ReactElement {
    const [documentState, setDocumentState] = useState<SystemDocument>(() =>
      createDefaultSystemDocument(),
    );
    const [savedSnapshot, setSavedSnapshot] = useState<SystemDocument>(() =>
      cloneDocument(createDefaultSystemDocument()),
    );
    const [selection, setSelection] = useState<SystemMapSelection>({ kind: 'none' });
    const [status, setStatus] = useState('System Map');
    const [statusError, setStatusError] = useState(false);
    const [formVersion, setFormVersion] = useState(0);
    const [planetList, setPlanetList] = useState<PlanetListEntry[]>([]);
    const [stationPrefabs, setStationPrefabs] = useState<PrefabListEntry[]>([]);
    const [sceneList, setSceneList] = useState<SceneListEntry[]>([]);

    const documentRef = useRef(documentState);
    const savedSnapshotRef = useRef(savedSnapshot);
    const selectionRef = useRef(selection);
    const systemListRef = useRef<SystemListEntry[]>([]);
    const loadGenerationRef = useRef(0);
    const canvasControllerRef = useRef<SystemMapCanvasController | null>(null);
    const mapHostRef = useRef<HTMLDivElement>(null);
    const sidebarHostRef = useRef<HTMLDivElement | null>(null);
    const initializedRef = useRef(false);
    const activeRef = useRef(false);

    if (sidebarHostRef.current === null) {
      sidebarHostRef.current = createSidebarHost();
    }

    documentRef.current = documentState;
    savedSnapshotRef.current = savedSnapshot;
    selectionRef.current = selection;

    const setStatusMessage = useCallback((message: string, isError = false) => {
      setStatus(message);
      setStatusError(isError);
    }, []);

    const rebuildForm = useCallback(() => {
      setFormVersion((v) => v + 1);
    }, []);

    const markDirty = useCallback(() => {
      canvasControllerRef.current?.requestRedraw();
      setStatusMessage(`${documentRef.current.name} — unsaved`);
    }, [setStatusMessage]);

    const markDirtyAndRebuild = useCallback(() => {
      markDirty();
      rebuildForm();
    }, [markDirty, rebuildForm]);

    const setSelectionState = useCallback(
      (next: SystemMapSelection) => {
        selectionRef.current = next;
        setSelection(next);
        canvasControllerRef.current?.requestRedraw();
        rebuildForm();
      },
      [rebuildForm],
    );

    const refreshLists = useCallback(async () => {
      const [planets, prefabs, scenes, systems] = await Promise.all([
        fetchPlanetList().catch(() => [] as PlanetListEntry[]),
        fetchPrefabList().catch(() => [] as PrefabListEntry[]),
        fetchSceneList().catch(() => [] as SceneListEntry[]),
        fetchSystemList().catch(() => [] as SystemListEntry[]),
      ]);
      setPlanetList(planets);
      setStationPrefabs(prefabs.filter((entry) => entry.kind === 'station'));
      setSceneList(scenes);
      systemListRef.current = systems;
    }, []);

    const loadSystem = useCallback(
      async (id: string): Promise<boolean> => {
        const generation = ++loadGenerationRef.current;
        try {
          const loaded = await fetchSystem(id);
          if (generation !== loadGenerationRef.current) return false;
          setDocumentState(loaded);
          documentRef.current = loaded;
          const snapshot = cloneDocument(loaded);
          setSavedSnapshot(snapshot);
          savedSnapshotRef.current = snapshot;
          activateSystemDocument(loaded);
          setSelectionState({ kind: 'none' });
          canvasControllerRef.current?.fitView();
          setStatusMessage(`${loaded.name} (${loaded.id})`);
          return true;
        } catch (error) {
          if (generation !== loadGenerationRef.current) return false;
          setStatusMessage(error instanceof Error ? error.message : String(error), true);
          return false;
        }
      },
      [setSelectionState, setStatusMessage],
    );

    const save = useCallback(async (): Promise<boolean> => {
      const parsed = parseSystemDocument(documentRef.current);
      if (!parsed) {
        setStatusMessage('Invalid system document — check ids, parents, and positions.', true);
        return false;
      }
      try {
        const path = await saveSystem(parsed);
        setDocumentState(parsed);
        documentRef.current = parsed;
        const snapshot = cloneDocument(parsed);
        setSavedSnapshot(snapshot);
        savedSnapshotRef.current = snapshot;
        activateSystemDocument(parsed);
        await refreshLists();
        setStatusMessage(`Saved ${path}`);
        rebuildForm();
        canvasControllerRef.current?.requestRedraw();
        return true;
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : String(error), true);
        return false;
      }
    }, [rebuildForm, refreshLists, setStatusMessage]);

    const addPlanetEntry = useCallback(() => {
      if (planetList.length === 0) {
        setStatusMessage(
          'No planet documents available — create one in Planet Authoring first.',
          true,
        );
        return;
      }
      const doc = documentRef.current;
      const taken = new Set(doc.planets.map((planet) => planet.id));
      const unused = planetList.find((entry) => !taken.has(entry.id)) ?? planetList[0];
      if (!unused) return;
      const id = uniqueSlug(unused.id, taken);
      const angle = doc.planets.length * 0.9;
      const distance = SYSTEM_MAP_PLANET_DISTANCE_METERS * (1 + doc.planets.length * 0.35);
      doc.planets.push({
        id,
        planetId: unused.id,
        name: unused.name,
        positionMeters: {
          x: Math.cos(angle) * distance,
          z: Math.sin(angle) * distance,
        },
      });
      setDocumentState({ ...doc });
      setSelectionState({ kind: 'planet', id });
      markDirtyAndRebuild();
    }, [markDirtyAndRebuild, planetList, setSelectionState, setStatusMessage]);

    const addStationEntry = useCallback(() => {
      if (stationPrefabs.length === 0) {
        setStatusMessage('No station prefabs available.', true);
        return;
      }
      const prefab = stationPrefabs[0];
      if (!prefab) return;
      const doc = documentRef.current;
      const taken = new Set(doc.stations.map((station) => station.id));
      const id = uniqueSlug(`${prefab.id}-orbit`, taken);
      const parent = doc.planets[0];
      const parentBodyId = parent?.id ?? SYSTEM_STAR_PARENT_ID;
      const index = doc.stations.length;
      doc.stations.push({
        id,
        stationPrefabId: prefab.id,
        name: prefab.name,
        parentBodyId,
        offsetMeters: {
          x: Math.cos(index) * SYSTEM_MAP_STATION_OFFSET_METERS,
          z: Math.sin(index) * SYSTEM_MAP_STATION_OFFSET_METERS,
        },
        altitudeMeters: DEFAULT_STATION_ALTITUDE_METERS,
      });
      setDocumentState({ ...doc });
      setSelectionState({ kind: 'station', id });
      markDirtyAndRebuild();
    }, [markDirtyAndRebuild, setSelectionState, setStatusMessage, stationPrefabs]);

    const removeSelected = useCallback(() => {
      const doc = documentRef.current;
      const current = selectionRef.current;
      if (current.kind === 'planet') {
        const id = current.id;
        if (doc.stations.some((station) => station.parentBodyId === id)) {
          setStatusMessage('Reparent or remove stations attached to this planet first.', true);
          return;
        }
        doc.planets = doc.planets.filter((planet) => planet.id !== id);
        setDocumentState({ ...doc });
        setSelectionState({ kind: 'none' });
        markDirtyAndRebuild();
        return;
      }
      if (current.kind === 'station') {
        const id = current.id;
        doc.stations = doc.stations.filter((station) => station.id !== id);
        setDocumentState({ ...doc });
        setSelectionState({ kind: 'none' });
        markDirtyAndRebuild();
      }
    }, [markDirtyAndRebuild, setSelectionState, setStatusMessage]);

    const openSystemPicker = useCallback(() => {
      const query = window.prompt(
        `Open system id:\n${systemListRef.current.map((entry) => `${entry.id} — ${entry.name}`).join('\n') || '(none yet)'}`,
        documentRef.current.id,
      );
      if (!query) return;
      void loadSystem(query.trim());
    }, [loadSystem]);

    const handleNewSystem = useCallback(() => {
      if (
        !documentsEqual(documentRef.current, savedSnapshotRef.current) &&
        !window.confirm('Discard unsaved system changes?')
      ) {
        return;
      }
      const id = window.prompt('New system id (slug)', 'new-system')?.trim().toLowerCase();
      if (!id || !SYSTEM_ID_PATTERN.test(id)) {
        setStatusMessage('System id must be a lowercase slug (a-z, 0-9, -).', true);
        return;
      }
      const doc = createDefaultSystemDocument(id, id);
      setDocumentState(doc);
      documentRef.current = doc;
      const snapshot = cloneDocument(doc);
      setSavedSnapshot(snapshot);
      savedSnapshotRef.current = snapshot;
      setSelectionState({ kind: 'none' });
      canvasControllerRef.current?.fitView();
      setStatusMessage(`New ${id} — unsaved`);
    }, [setSelectionState, setStatusMessage]);

    useEffect(() => {
      const host = mapHostRef.current;
      if (!host) return;
      const controller = createSystemMapCanvas(host, {
        getDocument: () => documentRef.current,
        getSelection: () => selectionRef.current,
        onSelectionChange: setSelectionState,
        onDirty: markDirty,
        onDragEnd: rebuildForm,
      });
      canvasControllerRef.current = controller;
      return () => {
        controller.dispose();
        canvasControllerRef.current = null;
      };
    }, [markDirty, rebuildForm, setSelectionState]);

    const activate = useCallback(() => {
      activeRef.current = true;
      canvasControllerRef.current?.activate();
      if (!initializedRef.current) {
        initializedRef.current = true;
        void (async () => {
          await refreshLists();
          const params = new URLSearchParams(window.location.search);
          const systemId = params.get('systemId') ?? 'default';
          const ok = await loadSystem(systemId);
          if (!ok) {
            const doc = createDefaultSystemDocument();
            setDocumentState(doc);
            documentRef.current = doc;
            const snapshot = cloneDocument(doc);
            setSavedSnapshot(snapshot);
            savedSnapshotRef.current = snapshot;
            activateSystemDocument(doc);
            rebuildForm();
            canvasControllerRef.current?.fitView();
            setStatusMessage('Loaded default template (save to create)');
          }
        })();
      }
    }, [loadSystem, rebuildForm, refreshLists, setStatusMessage]);

    const deactivate = useCallback(() => {
      activeRef.current = false;
      canvasControllerRef.current?.deactivate();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        activate,
        deactivate,
        canLeave: () =>
          documentsEqual(documentRef.current, savedSnapshotRef.current) ||
          window.confirm('Leave System Map with unsaved changes?'),
        isDirty: () => !documentsEqual(documentRef.current, savedSnapshotRef.current),
        save,
        loadSystem,
        getDocument: () => documentRef.current,
        getLeftPanel: () => sidebarHostRef.current!,
      }),
      [activate, deactivate, loadSystem, save],
    );

    useEffect(() => {
      return () => {
        deactivate();
        sidebarHostRef.current?.remove();
      };
    }, [deactivate]);

    const sidebarHost = sidebarHostRef.current;

    return (
      <>
        <div className={`ed-scene-panel ed-system-map-host${hidden ? ' is-hidden' : ''}`}>
          <div ref={mapHostRef} className="ed-system-map-view" />
        </div>
        {sidebarHost
          ? createPortal(
              <>
                <h2 className="ed-base-panel-title">System Map</h2>
                <div className={`ed-system-status${statusError ? ' is-error' : ''}`}>
                  {status}
                </div>
                <div className="ed-base-actions">
                  <button type="button" className="ed-btn" onClick={openSystemPicker}>
                    Open…
                  </button>
                  <button type="button" className="ed-btn" onClick={() => void save()}>
                    Save
                  </button>
                  <button type="button" className="ed-btn" onClick={addPlanetEntry}>
                    Add planet
                  </button>
                  <button type="button" className="ed-btn" onClick={addStationEntry}>
                    Add station
                  </button>
                  <button type="button" className="ed-btn" onClick={removeSelected}>
                    Remove
                  </button>
                  <button
                    type="button"
                    className="ed-btn"
                    onClick={() => canvasControllerRef.current?.fitView()}
                  >
                    Fit
                  </button>
                  <button type="button" className="ed-btn" onClick={handleNewSystem}>
                    New
                  </button>
                </div>
                <div className="ed-system-form" key={formVersion}>
                  <SystemMapForm
                    doc={documentState}
                    selection={selection}
                    planetList={planetList}
                    stationPrefabs={stationPrefabs}
                    sceneList={sceneList}
                    onSelect={setSelectionState}
                    onMarkDirty={markDirty}
                    onMarkDirtyAndRebuild={markDirtyAndRebuild}
                    onSelectionIdChange={(id) => {
                      selectionRef.current = { kind: 'station', id };
                      setSelection({ kind: 'station', id });
                    }}
                  />
                </div>
              </>,
              sidebarHost,
            )
          : null}
      </>
    );
  },
);
