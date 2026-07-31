import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { fetchPrefabList, renamePrefab, type PrefabListEntry } from '../../api';
import { showToast } from '../../dom';
import type { EditorEvent, EditorStore } from '../../document';
import { toPrefabDocument } from '../../serialize';
import { collectShipLayoutIssues } from '../../../player/ship-layout-issues';
import { buildShipLayoutFromPrefab } from '../../../world/prefabs/ship-runtime';
import { slugifyPrefabName } from '../../../world/prefabs/schema';
import { useEditorEvent, useEditorStore } from '../hooks';
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

/** Layout rebuild loads GLB colliders — skip transform drag spam. */
function isShipAuthoringEvent(event: EditorEvent): boolean {
  return (
    event.type === 'document' ||
    event.type === 'entity' ||
    event.type === 'structure' ||
    event.type === 'glb-components' ||
    event.type === 'glb-visibility'
  );
}

const SHIP_ISSUE_REFRESH_DEBOUNCE_MS = 400;

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
  useEditorStore(store, ['document', 'entity', 'structure']);
  const authoringVersion = useEditorEvent(store, isShipAuthoringEvent);
  const docState = store.getState();
  const isShipDocument = docState.documentType === 'prefab' && docState.kind === 'ship';
  const openShipId = isShipDocument ? docState.prefabId : '';

  const [ships, setShips] = useState<PrefabListEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [env, setEnv] = useState<ShipTestEnv>('pad');
  const [issueState, setIssueState] = useState<ShipIssueList>(EMPTY_ISSUES);
  // Null means "show the stored name". Editing holds a draft so a rename fires
  // once on commit rather than moving the file on every keystroke.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

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

  const commitName = useCallback(async () => {
    const draft = nameDraft;
    setNameDraft(null);
    if (draft === null) return;
    const state = store.getState();
    if (state.documentType !== 'prefab' || state.kind !== 'ship') return;
    const name = draft.trim();
    if (!name || name === state.prefabName) return;

    // Never saved: no file to move, and the id is still slugged at first save.
    if (!state.prefabId) {
      store.setPrefabMeta({ prefabName: name });
      return;
    }
    const toId = slugifyPrefabName(name);
    if (!toId) {
      showToast('That name slugs to nothing — pick another.', true);
      return;
    }

    setRenaming(true);
    try {
      const result = await renamePrefab(state.prefabId, toId, name);
      store.setPrefabMeta({ prefabId: result.id, prefabName: name });
      const renamedPath = result.absolutePath ?? result.path;
      showToast(
        result.rewritten.length > 0
          ? `Renamed to ${renamedPath} — repointed ${result.rewritten.length} document(s).`
          : `Renamed to ${renamedPath}.`,
      );
      void refreshList();
    } catch (error) {
      showToast(
        `Rename failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        true,
      );
    } finally {
      setRenaming(false);
    }
  }, [nameDraft, store, refreshList]);

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

  // A pending draft belongs to the ship it was typed against, not the next one.
  useEffect(() => {
    setNameDraft(null);
  }, [openShipId]);

  // Seat/component edits emit `entity`, not `document`. Debounce so dropping a
  // seat into ship-controller clears the stale "no ship-seat markers" warning
  // without rebuilding on every transform drag (those events are filtered out).
  useEffect(() => {
    if (hidden) return;
    const handle = window.setTimeout(() => {
      void refreshIssues();
    }, SHIP_ISSUE_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [hidden, openShipId, docState.kind, authoringVersion, refreshIssues]);

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
          // Saving a rename (or a brand new ship) changes this list, and the
          // panel does not see save complete — re-read it as the menu opens.
          onMouseDown={() => void refreshList()}
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
        <input
          type="text"
          className="ed-input ed-ship-name"
          value={nameDraft ?? (isShipDocument ? docState.prefabName : '')}
          placeholder="Ship name"
          disabled={!isShipDocument || renaming}
          aria-label="Ship name"
          title={
            openShipId
              ? `Renames the file to "${slugifyPrefabName(nameDraft ?? docState.prefabName) || 'untitled'}.prefab.json" and repoints project references. Ship rows already saved in the database keep id "${openShipId}".`
              : 'Saved as the slug of this name.'
          }
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            else if (event.key === 'Escape') setNameDraft(null);
          }}
        />
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
