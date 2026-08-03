import type { ReactElement } from 'react';
import type { PlanetListEntry, PrefabListEntry, SceneListEntry } from '../../../api';
import {
  DEFAULT_STATION_ALTITUDE_METERS,
  SYSTEM_ID_PATTERN,
  SYSTEM_STAR_PARENT_ID,
  type SystemDocument,
} from '../../../../world/systems/schema';
import { stationWorldPos } from '../../../panels/system-map-canvas';
import type { SystemMapSelection } from '../../../panels/system-map-canvas';
import {
  SystemEmpty,
  SystemListRow,
  SystemNumberField,
  SystemSection,
  SystemSelectField,
  SystemTextField,
} from './Fields';

export type SystemMapFormProps = {
  doc: SystemDocument;
  selection: SystemMapSelection;
  planetList: PlanetListEntry[];
  stationPrefabs: PrefabListEntry[];
  sceneList: SceneListEntry[];
  onSelect: (selection: SystemMapSelection) => void;
  onMarkDirty: () => void;
  onMarkDirtyAndRebuild: () => void;
  onSelectionIdChange: (id: string) => void;
};

export function SystemMapForm({
  doc,
  selection,
  planetList,
  stationPrefabs,
  sceneList,
  onSelect,
  onMarkDirty,
  onMarkDirtyAndRebuild,
  onSelectionIdChange,
}: SystemMapFormProps): ReactElement {
  return (
    <>
      <SystemSection title="System">
        <SystemTextField label="Id" value={doc.id} readOnly />
        <SystemTextField
          label="Name"
          value={doc.name}
          onChange={(value) => {
            doc.name = value;
            onMarkDirty();
          }}
        />
        <SystemTextField
          label="Star name"
          value={doc.star.name}
          onChange={(value) => {
            doc.star.name = value;
            onMarkDirty();
          }}
        />
      </SystemSection>

      <SystemSection title="Planets">
        {doc.planets.length > 0 ? (
          doc.planets.map((planet) => (
            <SystemListRow
              key={planet.id}
              label={`${planet.name ?? planet.planetId} (${planet.id})`}
              selected={selection.kind === 'planet' && selection.id === planet.id}
              onClick={() => onSelect({ kind: 'planet', id: planet.id })}
            />
          ))
        ) : (
          <SystemEmpty>No planet entries</SystemEmpty>
        )}
      </SystemSection>

      <SystemSection title="Stations">
        {doc.stations.length > 0 ? (
          doc.stations.map((station) => (
            <SystemListRow
              key={station.id}
              label={`${station.name} (${station.id})`}
              selected={selection.kind === 'station' && selection.id === station.id}
              onClick={() => onSelect({ kind: 'station', id: station.id })}
            />
          ))
        ) : (
          <SystemEmpty>No station entries</SystemEmpty>
        )}
      </SystemSection>

      {selection.kind === 'planet' ? (
        <SelectedPlanetForm
          doc={doc}
          planetId={selection.id}
          planetList={planetList}
          onMarkDirty={onMarkDirty}
          onMarkDirtyAndRebuild={onMarkDirtyAndRebuild}
        />
      ) : null}

      {selection.kind === 'station' ? (
        <SelectedStationForm
          doc={doc}
          stationId={selection.id}
          stationPrefabs={stationPrefabs}
          sceneList={sceneList}
          onMarkDirty={onMarkDirty}
          onMarkDirtyAndRebuild={onMarkDirtyAndRebuild}
          onSelectionIdChange={onSelectionIdChange}
        />
      ) : null}
    </>
  );
}

function SelectedPlanetForm({
  doc,
  planetId,
  planetList,
  onMarkDirty,
  onMarkDirtyAndRebuild,
}: {
  doc: SystemDocument;
  planetId: string;
  planetList: PlanetListEntry[];
  onMarkDirty: () => void;
  onMarkDirtyAndRebuild: () => void;
}): ReactElement | null {
  const planet = doc.planets.find((entry) => entry.id === planetId);
  if (!planet) return null;

  const planetOptions = planetList.map((entry) => ({
    value: entry.id,
    label: `${entry.name} (${entry.id})`,
  }));
  if (!planetOptions.some((option) => option.value === planet.planetId)) {
    planetOptions.unshift({
      value: planet.planetId,
      label: `${planet.planetId} (missing)`,
    });
  }

  return (
    <SystemSection title="Selected planet">
      <SystemTextField label="Entry id" value={planet.id} readOnly />
      <SystemSelectField
        label="Planet document"
        value={planet.planetId}
        options={planetOptions}
        onChange={(value) => {
          planet.planetId = value;
          const meta = planetList.find((entry) => entry.id === value);
          if (meta && !planet.name) planet.name = meta.name;
          onMarkDirtyAndRebuild();
        }}
      />
      <SystemTextField
        label="Display name"
        value={planet.name ?? ''}
        onChange={(value) => {
          planet.name = value.trim() || undefined;
          onMarkDirty();
        }}
      />
      <SystemNumberField
        label="Position X (m)"
        value={planet.positionMeters.x}
        step={1_000_000}
        onChange={(value) => {
          planet.positionMeters.x = value;
          onMarkDirty();
        }}
      />
      <SystemNumberField
        label="Position Z (m)"
        value={planet.positionMeters.z}
        step={1_000_000}
        onChange={(value) => {
          planet.positionMeters.z = value;
          onMarkDirty();
        }}
      />
    </SystemSection>
  );
}

/** Options for one of the two station sources, keeping unknown ids visible. */
function sourceOptions(
  entries: Array<{ id: string; name: string }>,
  currentId: string | undefined,
): Array<{ value: string; label: string }> {
  const options = entries.map((entry) => ({
    value: entry.id,
    label: `${entry.name} (${entry.id})`,
  }));
  if (currentId && !options.some((option) => option.value === currentId)) {
    options.unshift({ value: currentId, label: `${currentId} (missing)` });
  }
  return options;
}

function SelectedStationForm({
  doc,
  stationId,
  stationPrefabs,
  sceneList,
  onMarkDirty,
  onMarkDirtyAndRebuild,
  onSelectionIdChange,
}: {
  doc: SystemDocument;
  stationId: string;
  stationPrefabs: PrefabListEntry[];
  sceneList: SceneListEntry[];
  onMarkDirty: () => void;
  onMarkDirtyAndRebuild: () => void;
  onSelectionIdChange: (id: string) => void;
}): ReactElement | null {
  const station = doc.stations.find((entry) => entry.id === stationId);
  if (!station) return null;

  // A station is authored either as a prefab or as a scene, never both.
  const usesScene = Boolean(station.sceneId);
  const canUsePrefab = stationPrefabs.length > 0 || Boolean(station.stationPrefabId);
  const prefabOptions = sourceOptions(stationPrefabs, station.stationPrefabId);
  const sceneOptions = sourceOptions(sceneList, station.sceneId);
  const ownedSceneOptions = [
    { value: '', label: '(none)' },
    ...sourceOptions(sceneList, station.habSceneId),
  ];
  // Keep hangar options independent so a missing hangar id still shows once.
  const hangarSceneOptions = [
    { value: '', label: '(none)' },
    ...sourceOptions(sceneList, station.hangarSceneId),
  ];

  const parentOptions = [
    { value: SYSTEM_STAR_PARENT_ID, label: 'Star' },
    ...doc.planets.map((planet) => ({
      value: planet.id,
      label: planet.name ?? planet.id,
    })),
  ];

  const sourceOptionsList = [
    ...(canUsePrefab ? [{ value: 'prefab', label: 'Station prefab' }] : []),
    { value: 'scene', label: 'Scene' },
  ];

  return (
    <SystemSection title="Selected station">
      <SystemTextField
        label="Instance id"
        value={station.id}
        onChange={(value) => {
          const next = value.trim().toLowerCase();
          if (!SYSTEM_ID_PATTERN.test(next)) return;
          if (doc.stations.some((other) => other.id === next && other !== station)) return;
          station.id = next;
          onSelectionIdChange(next);
          onMarkDirtyAndRebuild();
        }}
      />
      <SystemTextField
        label="Name"
        value={station.name}
        onChange={(value) => {
          station.name = value;
          onMarkDirty();
        }}
      />
      <SystemSelectField
        label="Source"
        value={usesScene || !canUsePrefab ? 'scene' : 'prefab'}
        options={sourceOptionsList}
        onChange={(value) => {
          if (value === 'scene') {
            const next = station.sceneId ?? sceneList[0]?.id;
            if (!next) return;
            delete station.stationPrefabId;
            station.sceneId = next;
          } else {
            const next = station.stationPrefabId ?? stationPrefabs[0]?.id;
            if (!next) return;
            delete station.sceneId;
            station.stationPrefabId = next;
          }
          onMarkDirtyAndRebuild();
        }}
      />
      {usesScene || !canUsePrefab ? (
        <SystemSelectField
          label="Station scene"
          value={station.sceneId ?? ''}
          options={sceneOptions}
          onChange={(value) => {
            station.sceneId = value;
            onMarkDirty();
          }}
        />
      ) : (
        <SystemSelectField
          label="Station prefab"
          value={station.stationPrefabId ?? ''}
          options={prefabOptions}
          onChange={(value) => {
            station.stationPrefabId = value;
            onMarkDirty();
          }}
        />
      )}
      <SystemSelectField
        label="Hab scene"
        value={station.habSceneId ?? ''}
        options={ownedSceneOptions}
        onChange={(value) => {
          if (value) station.habSceneId = value;
          else delete station.habSceneId;
          onMarkDirty();
        }}
      />
      <SystemSelectField
        label="Hangar scene"
        value={station.hangarSceneId ?? ''}
        options={hangarSceneOptions}
        onChange={(value) => {
          if (value) station.hangarSceneId = value;
          else delete station.hangarSceneId;
          onMarkDirty();
        }}
      />
      <SystemSelectField
        label="Parent body"
        value={station.parentBodyId}
        options={parentOptions}
        onChange={(value) => {
          const world = stationWorldPos(doc, station);
          station.parentBodyId = value;
          const parentPos =
            value === SYSTEM_STAR_PARENT_ID
              ? { x: 0, z: 0 }
              : doc.planets.find((planet) => planet.id === value)?.positionMeters ?? {
                  x: 0,
                  z: 0,
                };
          station.offsetMeters = {
            x: world.x - parentPos.x,
            z: world.z - parentPos.z,
          };
          onMarkDirtyAndRebuild();
        }}
      />
      <SystemNumberField
        label="Offset X from parent centre (m)"
        value={station.offsetMeters.x}
        step={1_000_000}
        onChange={(value) => {
          station.offsetMeters.x = value;
          onMarkDirty();
        }}
      />
      <SystemNumberField
        label="Offset Z from parent centre (m)"
        value={station.offsetMeters.z}
        step={1_000_000}
        onChange={(value) => {
          station.offsetMeters.z = value;
          onMarkDirty();
        }}
      />
      <SystemNumberField
        label="Min orbit clearance (m)"
        value={station.altitudeMeters ?? DEFAULT_STATION_ALTITUDE_METERS}
        step={1000}
        onChange={(value) => {
          station.altitudeMeters = value;
          onMarkDirty();
        }}
      />
    </SystemSection>
  );
}
