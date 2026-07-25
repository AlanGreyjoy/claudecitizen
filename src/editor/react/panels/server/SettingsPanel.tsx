import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  AdminAuthError,
  getGameSettings,
  listItemDefinitions,
  listPropDefinitions,
  listShipDefinitions,
  updateGameSettings,
} from './server-console-api';
import { formNumber } from './form-readers';
import { StarterEditor } from './FormComponents';
import { useServerConsole } from './ServerConsoleContext';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminMessage,
  AdminPageHeader,
} from './Components';

export function SettingsPanel(): ReactElement {
  const { onAuthError, setStatus } = useServerConsole();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingArcBalance, setStartingArcBalance] = useState(0);
  const [starterShipIds, setStarterShipIds] = useState<string[]>([]);
  const [starterPropIds, setStarterPropIds] = useState<string[]>([]);
  const [starterItemIds, setStarterItemIds] = useState<string[]>([]);
  const [shipDefinitions, setShipDefinitions] = useState<Array<{ id: string; name: string }>>([]);
  const [propDefinitions, setPropDefinitions] = useState<Array<{ id: string; name: string }>>([]);
  const [itemDefinitions, setItemDefinitions] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getGameSettings(),
      listShipDefinitions(),
      listPropDefinitions(),
      listItemDefinitions(),
    ])
      .then(([settings, ships, props, items]) => {
        setStartingArcBalance(settings.startingArcBalance);
        setStarterShipIds([...settings.starterShipDefinitionIds]);
        setStarterPropIds([...settings.starterPropDefinitionIds]);
        setStarterItemIds([...settings.starterItemDefinitionIds]);
        setShipDefinitions(ships);
        setPropDefinitions(props);
        setItemDefinitions(items);
      })
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          onAuthError(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load settings.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [onAuthError]);

  if (loading) {
    return <AdminMessage message="Loading game settings..." status />;
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Game settings" />
        <AdminMessage message={error} isError status />
      </>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setStatus('Saving settings...');
    updateGameSettings({
      startingArcBalance: Math.round(formNumber(event.currentTarget, 'startingArcBalance')),
      starterShipDefinitionIds: starterShipIds,
      starterPropDefinitionIds: starterPropIds,
      starterItemDefinitionIds: starterItemIds,
    })
      .then(() => {
        setStatus('Settings saved.');
      })
      .catch((err) => {
        setStatus(err instanceof Error ? err.message : 'Save failed.', true);
      });
  };

  return (
    <>
      <AdminPageHeader
        title="Game settings"
        subtitle="Configure starting balances and starter loadouts for new players"
      />
      <AdminCard>
        <form className="sc-admin-form sc-admin-form-wide" onSubmit={handleSubmit}>
          <AdminField label="Starting Asteron Reserve Credits (ARC)">
            <input
              className="sc-admin-input"
              name="startingArcBalance"
              type="number"
              value={startingArcBalance}
              onChange={(event) => setStartingArcBalance(Number(event.currentTarget.value))}
            />
          </AdminField>
          <AdminField label="Starter ships">
            <StarterEditor
              definitions={shipDefinitions}
              selectedIds={starterShipIds}
              onChange={setStarterShipIds}
            />
          </AdminField>
          <AdminField label="Starter props">
            <StarterEditor
              definitions={propDefinitions}
              selectedIds={starterPropIds}
              onChange={setStarterPropIds}
            />
          </AdminField>
          <AdminField label="Starter items">
            <StarterEditor
              definitions={itemDefinitions}
              selectedIds={starterItemIds}
              onChange={setStarterItemIds}
            />
          </AdminField>
          <div className="sc-admin-actions">
            <AdminButton type="submit">Save settings</AdminButton>
          </div>
          <AdminMessage message="" status />
        </form>
      </AdminCard>
    </>
  );
}
