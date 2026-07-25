import { type DragEvent, type ReactElement } from 'react';
import { ASSET_DND_TYPE } from '../../../api';
import {
  ANIMATION_LOCOMOTION_KINDS,
  type AnimationLocomotionKind,
} from '../../../../player/animation/schema';
import { EQUIPMENT_DND_TYPE, LOCOMOTION_LABELS } from './constants';
import type { BaseCharacterEditorUiApi, BaseCharacterLeftTab } from './types';

type BaseCharactersSidebarProps = {
  api: BaseCharacterEditorUiApi;
};

function SettingsPanel({ api }: BaseCharactersSidebarProps): ReactElement {
  const snap = api.getSnapshot();
  const speedField = (
    label: string,
    key:
      | 'walkSpeedMetersPerSecond'
      | 'runSpeedMetersPerSecond'
      | 'sprintSpeedMetersPerSecond'
      | 'jumpSpeedMetersPerSecond',
  ): ReactElement => (
    <label className="ed-base-field" key={key}>
      <span>{label}</span>
      <input
        className="ed-input"
        type="number"
        step={0.1}
        value={String(snap.settingsState[key])}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (!Number.isFinite(value) || value <= 0) return;
          api.updateSettingsSpeed(key, value);
        }}
      />
    </label>
  );

  return (
    <div className="ed-base-anim-panel ed-base-settings-panel">
      {speedField('Walk speed (m/s)', 'walkSpeedMetersPerSecond')}
      {speedField('Run speed (m/s)', 'runSpeedMetersPerSecond')}
      {speedField('Sprint speed (m/s)', 'sprintSpeedMetersPerSecond')}
      {speedField('Jump speed (m/s)', 'jumpSpeedMetersPerSecond')}
      <div className="ed-base-actions">
        <button type="button" className="ed-btn" onClick={() => void api.save()}>
          {snap.settingsDirty ? 'Save Settings *' : 'Save Settings'}
        </button>
        <button type="button" className="ed-btn" onClick={() => api.resetSettingsDefaults()}>
          Reset defaults
        </button>
      </div>
      <p className="ed-base-note">
        On-foot locomotion for every character (planet, station, and ship decks). Changes apply
        immediately — start a Play Test to feel them. Save writes
        src/player/data/character-settings.json.
      </p>
    </div>
  );
}

function AnimationTab({ api }: BaseCharactersSidebarProps): ReactElement {
  const snap = api.getSnapshot();
  const animation = snap.animation;

  return (
    <div className="ed-base-anim-panel">
      <label className="ed-base-field">
        <span>Clip</span>
        <select
          className="ed-select"
          title="Animation clip"
          disabled={!animation || animation.clipNames.length === 0}
          value={animation?.activeClipName ?? ''}
          onChange={(event) => api.setAnimationClip(event.currentTarget.value)}
        >
          {(animation?.clipNames ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className="ed-base-actions">
        <button
          type="button"
          className="ed-btn"
          disabled={!animation}
          onClick={() => api.toggleAnimationPlaying()}
        >
          {animation?.playing === false ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          className="ed-btn"
          title="Load Universal Animation Library locomotion clips"
          disabled={!animation}
          onClick={() => void api.loadUalLibrary()}
        >
          UAL
        </button>
        <button
          type="button"
          className="ed-btn"
          title="Load Mixamo/Unity animation GLB and retarget onto this Sidekick"
          disabled={!animation}
          onClick={() => {
            const picker = document.createElement('input');
            picker.type = 'file';
            picker.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
            picker.addEventListener('change', () => {
              const file = picker.files?.[0];
              if (file) void api.loadAnimationGlbFile(file);
            });
            picker.click();
          }}
        >
          Load GLB…
        </button>
      </div>
      <label className="ed-base-field">
        <span>Speed</span>
        <input
          className="ed-input ed-base-anim-speed"
          type="range"
          min={0}
          max={2}
          step={0.05}
          title="Playback speed"
          disabled={!animation}
          value={animation?.timeScale ?? 1}
          onChange={(event) => api.setAnimationTimeScale(Number(event.currentTarget.value))}
        />
      </label>
      <div className="ed-base-note">
        {animation ? `Source: ${animation.sourceLabel}` : 'Animation runtime unavailable.'}
      </div>
      <div className="ed-base-note">
        Quick scrubber for loaded clips. Assign stance bindings on the Controllers tab (or Project →
        Anims).
      </div>
    </div>
  );
}

function ControllerPanel({ api }: BaseCharactersSidebarProps): ReactElement {
  const snap = api.getSnapshot();
  const controllerState = snap.controllerState;

  if (!controllerState) {
    return (
      <div className="ed-base-anim-panel ed-base-controller-panel">
        <div className="ed-base-note">Loading animation controller…</div>
      </div>
    );
  }

  const controllerOptions =
    snap.controllerList.length > 0
      ? snap.controllerList
      : [{ id: controllerState.id, label: controllerState.label }];

  return (
    <div className="ed-base-anim-panel ed-base-controller-panel">
      <label className="ed-base-field">
        <span>Controller</span>
        <select
          className="ed-select"
          value={snap.selectedControllerId}
          onChange={(event) => void api.loadController(event.currentTarget.value)}
        >
          {controllerOptions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <div className="ed-base-actions">
        <button type="button" className="ed-btn" onClick={() => void api.saveController()}>
          {snap.controllerDirty ? 'Save Ctrl *' : 'Save Ctrl'}
        </button>
      </div>
      <label className="ed-base-field">
        <span>Stance</span>
        <div className="ed-base-type-toggle">
          {controllerState.stances.map((stance) => (
            <button
              key={stance.id}
              type="button"
              className={`ed-btn${stance.id === snap.selectedStanceId ? ' is-active' : ''}`}
              onClick={() => api.setSelectedStanceId(stance.id)}
            >
              {stance.label}
            </button>
          ))}
          <button type="button" className="ed-btn" onClick={() => api.addStance()}>
            + Stance
          </button>
        </div>
      </label>
      <button type="button" className="ed-btn" onClick={() => api.renameStance()}>
        Rename
      </button>
      <div className="ed-base-actions">
        <label className="ed-base-field">
          <span>Idle clip</span>
          <select
            className="ed-select"
            value={snap.previewLocomotion}
            onChange={(event) => {
              api.setPreviewLocomotion(event.currentTarget.value as AnimationLocomotionKind);
              void api.previewControllerState();
            }}
          >
            {ANIMATION_LOCOMOTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LOCOMOTION_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ed-btn"
          disabled={!snap.animation}
          onClick={() => void api.previewControllerState()}
        >
          Preview
        </button>
      </div>
      <div className="ed-base-controller-states">
        {ANIMATION_LOCOMOTION_KINDS.map((locomotion) => {
          const state = controllerState.states.find(
            (entry) => entry.stanceId === snap.selectedStanceId && entry.locomotion === locomotion,
          );
          if (!state) return null;
          const clipOptions = [
            { value: '', label: '(unassigned)' },
            ...(snap.animation?.clipNames ?? []).map((name) => ({ value: name, label: name })),
          ];
          if (state.clipName && !clipOptions.some((option) => option.value === state.clipName)) {
            clipOptions.push({
              value: state.clipName,
              label: `${state.clipName} (not loaded)`,
            });
          }
          return (
            <ControllerStateRow
              key={state.id}
              api={api}
              locomotion={locomotion}
              state={state}
              clipOptions={clipOptions}
            />
          );
        })}
      </div>
      <div className="ed-base-note">
        Idle-only controller: each stance maps to one idle clip (unarmed Idle_Loop, rifle idle,
        pistol pistol_idle).
      </div>
    </div>
  );
}

function ControllerStateRow({
  api,
  locomotion,
  state,
  clipOptions,
}: {
  api: BaseCharacterEditorUiApi;
  locomotion: AnimationLocomotionKind;
  state: { id: string; clipName: string; sourceId: string; stanceId: string; locomotion: AnimationLocomotionKind };
  clipOptions: Array<{ value: string; label: string }>;
}): ReactElement {
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const url =
      event.dataTransfer?.getData(ASSET_DND_TYPE) ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    if (!url || !/\.(glb|gltf)(?:[?#].*)?$/i.test(url)) return;
    void api.assignClipFromDroppedUrl(state.id, url);
  };

  return (
    <div
      className="ed-base-controller-state-row"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <span>{LOCOMOTION_LABELS[locomotion]}</span>
      <select
        className="ed-select"
        title="Assign loaded clip"
        value={state.clipName}
        onChange={(event) => api.assignClipToState(state.id, event.currentTarget.value)}
      >
        {clipOptions.map((option) => (
          <option key={option.value || 'empty'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <code className="ed-base-source-badge">{state.sourceId}</code>
    </div>
  );
}

function EquipmentTab({ api }: BaseCharactersSidebarProps): ReactElement {
  const snap = api.getSnapshot();

  const onSlotDrop = (
    event: DragEvent<HTMLButtonElement>,
    slotId: string,
  ): void => {
    event.preventDefault();
    const id = event.dataTransfer?.getData(EQUIPMENT_DND_TYPE);
    const slot = snap.documentState?.slots.find((entry) => entry.id === slotId);
    if (!slot || !id) return;
    const definition = [...snap.weapons, ...snap.backpacks].find((entry) => entry.id === id);
    if (definition) api.assignDefinition(slot, definition);
  };

  return (
    <>
      <div className="ed-base-type-toggle">
        {([1, 2] as const).map((type) => (
          <button
            key={type}
            type="button"
            className={`ed-btn${snap.selectedType === type ? ' is-active' : ''}`}
            onClick={() => api.setSelectedType(type)}
          >
            {`Type ${type}`}
          </button>
        ))}
      </div>
      <div className="ed-base-subtitle">Authoring pose</div>
      <div className="ed-base-type-toggle">
        {(
          [
            ['Reference Pose', 'reference'],
            ['Animation Preview', 'animated'],
          ] as const
        ).map(([label, pose]) => (
          <button
            key={pose}
            type="button"
            className={`ed-btn${snap.previewPose === pose ? ' is-active' : ''}`}
            onClick={() => void api.setPreviewPose(pose)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ed-base-subtitle">Animation stance (for lining up drawn weapons)</div>
      <div className="ed-base-type-toggle">
        {snap.stanceIds.map((stanceId) => (
          <button
            key={stanceId}
            type="button"
            className={`ed-btn${stanceId === snap.selectedStanceId ? ' is-active' : ''}`}
            onClick={() => {
              api.setSelectedStanceId(stanceId);
              void api.previewControllerState();
            }}
          >
            {stanceId}
          </button>
        ))}
      </div>
      <div className="ed-base-actions" style={{ marginTop: '0.35rem' }}>
        <select
          className="ed-select"
          title="Locomotion clip for the selected stance"
          value={snap.previewLocomotion}
          onChange={(event) => {
            api.setPreviewLocomotion(event.currentTarget.value as AnimationLocomotionKind);
            void api.previewControllerState();
          }}
        >
          {ANIMATION_LOCOMOTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {LOCOMOTION_LABELS[kind]}
            </option>
          ))}
        </select>
        <button type="button" className="ed-btn" onClick={() => void api.previewControllerState()}>
          Play stance
        </button>
      </div>
      <p className="ed-base-note">
        Switch to Animation Preview, pick Rifle/Pistol, enable Simulate drawn, then gizmo the drawn
        mount.
      </p>
      <div className="ed-base-subtitle">Equipment slots</div>
      <div className="ed-base-slot-list">
        {(snap.documentState?.slots ?? []).map((slot) => {
          const unavailable = Boolean(
            slot.requiresSlotId && !snap.assignments.has(slot.requiresSlotId),
          );
          return (
            <button
              key={slot.id}
              type="button"
              className={`ed-base-slot${
                slot.id === snap.selectedSlotId ? ' is-selected' : ''
              }${unavailable ? ' is-unavailable' : ''}`}
              onClick={() => api.setSelectedSlotId(slot.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onSlotDrop(event, slot.id)}
            >
              {`${slot.label}${snap.assignments.has(slot.id) ? ' · equipped' : ''}`}
            </button>
          );
        })}
      </div>
      <button type="button" className="ed-btn" onClick={() => api.addEquipmentSlot()}>
        Add slot
      </button>
    </>
  );
}

function PlayTestPanel({ api }: BaseCharactersSidebarProps): ReactElement {
  return (
    <div className="ed-base-anim-panel ed-base-playtest-panel">
      <p className="ed-base-note">
        Click the stage, then use WASD, Shift, Space, and 1–3. Weapon slots switch stance idle
        clips (unarmed / rifle / pistol).
      </p>
      <div className="ed-base-actions">
        <button
          type="button"
          className="ed-btn"
          onClick={() => {
            api.equipDefaultPlayTestLoadout(true);
            void api.rebuildEquipmentPreview();
          }}
        >
          Reset default loadout
        </button>
        <button type="button" className="ed-btn" onClick={() => void api.setPlayTestActive(false)}>
          Stop Play Test
        </button>
      </div>
    </div>
  );
}

export function BaseCharactersSidebar({ api }: BaseCharactersSidebarProps): ReactElement {
  const snap = api.getSnapshot();
  const tabs: Array<{ id: BaseCharacterLeftTab; label: string }> = [
    { id: 'equipment', label: 'Equipment' },
    { id: 'animation', label: 'Animation' },
    { id: 'controllers', label: 'Controllers' },
  ];

  return (
    <aside className="ed-base-sidebar">
      <div className="ed-base-panel-title">Base Characters</div>
      <div className="ed-base-actions">
        <button
          type="button"
          className="ed-btn"
          disabled={snap.playTestActive}
          onClick={() => void api.save()}
        >
          {snap.hasUnsavedChanges ? 'Save *' : 'Save'}
        </button>
        <button
          type="button"
          className="ed-btn"
          disabled={snap.playTestActive}
          onClick={() => api.reload()}
        >
          Reload
        </button>
        <button
          type="button"
          className={`ed-btn${snap.playTestActive ? ' is-active' : ''}`}
          title={
            snap.playTestActive
              ? 'Stop character play test and restore authoring controls'
              : 'Test locomotion, jumping, and the default backpack/weapon loadout'
          }
          onClick={() => void api.setPlayTestActive(!snap.playTestActive)}
        >
          {snap.playTestActive ? 'Stop Test' : 'Play Test'}
        </button>
        <button
          type="button"
          className={`ed-btn${snap.leftTab === 'settings' ? ' is-active' : ''}`}
          title="Tune walk, sprint, and jump speeds — applies live, even during Play Test"
          onClick={() => api.setLeftTab('settings')}
        >
          Char Settings
        </button>
      </div>
      <div className="ed-base-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={`ed-base-tab${snap.leftTab === tab.id ? ' is-active' : ''}`}
            aria-selected={snap.leftTab === tab.id}
            disabled={snap.playTestActive}
            onClick={() => api.setLeftTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ed-base-tab-body">
        {snap.playTestActive && snap.leftTab !== 'settings' ? (
          <PlayTestPanel api={api} />
        ) : snap.leftTab === 'settings' ? (
          <SettingsPanel api={api} />
        ) : snap.leftTab === 'equipment' ? (
          <EquipmentTab api={api} />
        ) : snap.leftTab === 'animation' ? (
          <AnimationTab api={api} />
        ) : (
          <ControllerPanel api={api} />
        )}
      </div>
    </aside>
  );
}
