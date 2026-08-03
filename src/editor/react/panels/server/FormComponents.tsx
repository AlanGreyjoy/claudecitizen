import { useEffect, useState, type ReactElement } from 'react';
import {
  generateItemPrefabScreenshot,
  generateShipPrefabScreenshot,
} from '../../../../render/prefabs/item-prefab-screenshot';
import { useServerConsole } from './ServerConsoleContext';
import { AdminButton, AdminField } from './Components';

type IconUrlFieldProps = {
  value: string;
  onChange: (value: string) => void;
  prefabId: string;
  /** Defaults to item — ships use the same isometric capture path. */
  prefabKind?: 'item' | 'ship';
};

export function IconUrlField({
  value,
  onChange,
  prefabId,
  prefabKind = 'item',
}: IconUrlFieldProps): ReactElement {
  const { setStatus } = useServerConsole();
  const [generating, setGenerating] = useState(false);
  const trimmed = value.trim();
  const kindLabel = prefabKind === 'ship' ? 'ship' : 'item';

  const handleGenerate = (): void => {
    if (!prefabId) {
      setStatus(`Select a ${kindLabel} prefab before generating a screenshot.`, true);
      return;
    }
    setGenerating(true);
    setStatus(`Generating isometric screenshot for "${prefabId}"...`);
    const capture =
      prefabKind === 'ship'
        ? generateShipPrefabScreenshot(prefabId)
        : generateItemPrefabScreenshot(prefabId);
    void capture
      .then((dataUrl) => {
        onChange(dataUrl);
        setStatus('Screenshot generated. Save the definition to persist the icon.');
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Screenshot generation failed.', true);
      })
      .finally(() => {
        setGenerating(false);
      });
  };

  return (
    <AdminField label="Icon URL (optional)">
      <div className="sc-admin-icon-url">
        <div className="sc-admin-icon-url-row">
          <input
            className="sc-admin-input"
            name="iconUrl"
            type="text"
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          <AdminButton
            small
            variant="secondary"
            type="button"
            disabled={generating}
            title={`Load the selected ${kindLabel} prefab and capture an isometric PNG with a transparent background`}
            onClick={handleGenerate}
          >
            Generate Screenshot
          </AdminButton>
        </div>
        {trimmed ? (
          <img
            className="sc-admin-icon-preview"
            alt={`${kindLabel === 'ship' ? 'Ship' : 'Item'} icon preview`}
            src={trimmed}
          />
        ) : null}
      </div>
    </AdminField>
  );
}

export function StarterEditor({
  definitions,
  selectedIds,
  onChange,
}: {
  definitions: Array<{ id: string; name: string }>;
  selectedIds: string[];
  onChange: (next: string[]) => void;
}): ReactElement {
  const available = definitions.filter((definition) => !selectedIds.includes(definition.id));
  const [addId, setAddId] = useState(available[0]?.id ?? '');

  useEffect(() => {
    if (!addId || !available.some((entry) => entry.id === addId)) {
      setAddId(available[0]?.id ?? '');
    }
  }, [addId, available]);

  return (
    <div>
      <p className="sc-admin-meta">
        Starter ships are granted once on first bootstrap. Order matters — first entry is the
        default primary ship.
      </p>
      <div className="sc-admin-actions">
        <select
          className="sc-admin-select"
          value={addId}
          onChange={(event) => setAddId(event.currentTarget.value)}
        >
          {available.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.name}
            </option>
          ))}
        </select>
        <AdminButton
          variant="secondary"
          type="button"
          onClick={() => {
            if (!addId || selectedIds.includes(addId)) return;
            onChange([...selectedIds, addId]);
          }}
        >
          Add starter ship
        </AdminButton>
      </div>
      <ul className="sc-admin-starter-list">
        {selectedIds.map((id, index) => {
          const definition = definitions.find((entry) => entry.id === id);
          return (
            <li key={id} className="sc-admin-starter-item">
              <span>
                {index + 1}. {definition?.name ?? id}
              </span>
              <AdminButton
                small
                variant="secondary"
                type="button"
                disabled={index === 0}
                onClick={() => {
                  const next = [...selectedIds];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange(next);
                }}
              >
                Up
              </AdminButton>
              <AdminButton
                small
                variant="secondary"
                type="button"
                disabled={index === selectedIds.length - 1}
                onClick={() => {
                  const next = [...selectedIds];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  onChange(next);
                }}
              >
                Down
              </AdminButton>
              <AdminButton
                small
                variant="secondary"
                type="button"
                onClick={() => onChange(selectedIds.filter((entry) => entry !== id))}
              >
                Remove
              </AdminButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
