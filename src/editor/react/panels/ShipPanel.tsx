import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { fetchPrefabList, type PrefabListEntry } from '../../api';
import type { EditorStore } from '../../document';
import { toPrefabDocument } from '../../serialize';
import { collectShipLayoutIssues } from '../../../player/ship-layout-issues';
import { buildShipLayoutFromPrefab } from '../../../world/prefabs/ship-runtime';
import { useEditorStore } from '../hooks';
import { ShipIssues } from './ship/ShipIssues';
import {
  SHIP_TEST_ENVS,
  type ShipEditor,
  type ShipIssueList,
  type ShipTestEnv,
} from './ship/types';

export type { ShipEditor, ShipTestEnv } from './ship/types';

export type ShipPanelProps = {
  store: EditorStore;
  hidden: boolean;
  playing: boolean;
  onOpenShip: (id: string) => void | Promise<void>;
  onNewShip: () => void | Promise<void>;
  onSave: () => void;
  onTogglePlay: () => void;
};

const EMPTY_ISSUES: ShipIssueList = {
  issues: [],
  checkedPrefabId: null,
  building: false,
  error: null,
};

/**
 * Ship tab bar. The tab deliberately reuses the scene viewport, hierarchy, and
 * inspector for authoring — ship components already live in the prefab palette
 * and the toolbar already previews gear/ramp/door articulation. What was
 * missing was a way to *find* a ship and *fly* the one you have open, so this
 * bar owns exactly that: browse, validate, and launch the playtest.
 */
export const ShipPanel = forwardRef<ShipEditor, ShipPanelProps>(function ShipPanel(
  { store, hidden, playing, onOpenShip, onNewShip, onSave, onTogglePlay },
  ref,
): ReactElement {
  useEditorStore(store, ['document']);
  const docState = store.getState();
  const isShipDocument = docState.documentType === 'prefab' && docState.kind === 'ship';
  const openShipId = isShipDocument ? docState.prefabId : '';

  const [ships, setShips] = useState<PrefabListEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [env, setEnv] = useState<ShipTestEnv>('pad');
  const [issueState, setIssueState] = useState<ShipIssueList>(EMPTY_ISSUES);

  const envRef = useRef(env);
  envRef.current = env;
  const issueGenerationRef = useRef(0);

  const refreshList = useCallback(async () => {
    try {
      const entries = await fetchPrefabList();
      setShips(entries.filter((entry) => entry.kind === 'ship'));
      setListError(null);
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Ship list failed to load.');
    }
  }, []);

  const refreshIssues = useCallback(async () => {
    const state = store.getState();
    if (state.documentType !== 'prefab' || state.kind !== 'ship') {
      setIssueState(EMPTY_ISSUES);
      return;
    }
    const generation = issueGenerationRef.current + 1;
    issueGenerationRef.current = generation;
    setIssueState((prev) => ({ ...prev, building: true, error: null }));
    try {
      const layout = await buildShipLayoutFromPrefab(toPrefabDocument(state));
      if (issueGenerationRef.current !== generation) return;
      setIssueState({
        issues: collectShipLayoutIssues(layout),
        checkedPrefabId: state.prefabId || state.prefabName || 'untitled',
        building: false,
        error: null,
      });
    } catch (error) {
      if (issueGenerationRef.current !== generation) return;
      setIssueState({
        issues: [],
        checkedPrefabId: null,
        building: false,
        error: error instanceof Error ? error.message : 'Ship check failed.',
      });
    }
  }, [store]);

  useEffect(() => {
    if (hidden) return;
    void refreshList();
  }, [hidden, refreshList]);

  // Rebuilding the layout touches GLB colliders, so it follows the open ship
  // rather than every keystroke. The summary button re-checks on demand.
  useEffect(() => {
    if (hidden) return;
    void refreshIssues();
  }, [hidden, openShipId, docState.kind, refreshIssues]);

  useImperativeHandle(
    ref,
    () => ({
      getTestEnv: () => envRef.current,
      refreshIssues,
    }),
    [refreshIssues],
  );

  if (hidden) return <></>;

  const activeEnv = SHIP_TEST_ENVS.find((entry) => entry.id === env) ?? SHIP_TEST_ENVS[0];

  return (
    <div className="ed-ship-bar" role="toolbar" aria-label="Ship">
      <div className="ed-ship-group">
        <select
          className="ed-select ed-ship-select"
          value={ships.some((entry) => entry.id === openShipId) ? openShipId : ''}
          onChange={(event) => {
            const id = event.target.value;
            if (id) void onOpenShip(id);
          }}
        >
          <option value="">
            {listError ?? (ships.length === 0 ? 'No ship prefabs' : 'Open ship…')}
          </option>
          {ships.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name || entry.id}
            </option>
          ))}
        </select>
        <button type="button" className="ed-btn" onClick={() => void onNewShip()}>
          New Ship
        </button>
        <button type="button" className="ed-btn" onClick={onSave} disabled={!isShipDocument}>
          Save
        </button>
      </div>

      {isShipDocument ? (
        <ShipIssues state={issueState} onRefresh={() => void refreshIssues()} />
      ) : (
        <span className="ed-ship-hint">
          Open a ship prefab to author and test it.
        </span>
      )}

      <div className="ed-ship-group ed-ship-test">
        <div className="ed-ship-envs" role="group" aria-label="Test environment">
          {SHIP_TEST_ENVS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`ed-btn ed-ship-env${env === entry.id ? ' is-active' : ''}`}
              title={entry.hint}
              disabled={playing}
              onClick={() => setEnv(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`ed-btn ${playing ? 'ed-ship-stop' : 'ed-btn-accent'}`}
          onClick={onTogglePlay}
          disabled={!isShipDocument}
          title={playing ? 'Stop the playtest (Shift+F6)' : 'Start the playtest (F6)'}
        >
          {playing ? 'Stop' : 'Test'}
        </button>
      </div>

      <span className="ed-ship-hint">
        {playing
          ? 'F interact · hold Y to leave the seat · G gear · Esc menu'
          : activeEnv.hint}
      </span>
    </div>
  );
});
