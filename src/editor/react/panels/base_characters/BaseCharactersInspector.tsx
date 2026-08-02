import { type DragEvent, type ReactElement } from 'react';
import type { CharacterEquipmentSlotV1 } from '../../../../player/equipment/base-character-equipment';
import { suggestProviderSocketId } from '../../../../world/prefabs/item-runtime';
import type { WeaponSlotType } from '../../../../types/equipment';
import { ATTACHMENT_BONES, EQUIPMENT_DND_TYPE, LOCOMOTION_LABELS } from './constants';
import type { BaseCharacterEditorUiApi } from './types';

type BaseCharactersInspectorProps = {
  api: BaseCharacterEditorUiApi;
};

function TransformVectorRow({
  label,
  values,
  step,
  onChange,
  displayNumber,
}: {
  label: string;
  values: { x: number; y: number; z: number };
  step: number;
  onChange: (key: 'x' | 'y' | 'z', value: string) => void;
  displayNumber: (value: number) => string;
}): ReactElement {
  return (
    <div className="ed-base-vector">
      <span>{label}</span>
      {(['x', 'y', 'z'] as const).map((key) => (
        <input
          key={key}
          className="ed-input"
          type="number"
          step={step}
          title={key.toUpperCase()}
          value={displayNumber(values[key])}
          onChange={(event) => onChange(key, event.currentTarget.value)}
        />
      ))}
    </div>
  );
}

function PlayTestInspector({ api }: BaseCharactersInspectorProps): ReactElement {
  const snap = api.getSnapshot();
  const weaponName = snap.playTestWeaponSlotId
    ? snap.assignments.get(snap.playTestWeaponSlotId)?.name ?? snap.playTestWeaponSlotId
    : 'Unarmed';
  return (
    <>
      <div className="ed-base-panel-title">Play Test</div>
      <section className="ed-base-section">
        <p className="ed-base-note">
          {`${weaponName} · ${LOCOMOTION_LABELS[snap.previewLocomotion]} · ${
            snap.animation?.activeClipName || 'loading'
          }`}
        </p>
        <p className="ed-base-note">
          WASD move · Shift sprint · Space jump · 1 Assault 01 · 2 Brown 50 · 3 Twin Horned Pistol
        </p>
      </section>
    </>
  );
}

function SlotSettingsSection({
  api,
  slot,
}: {
  api: BaseCharacterEditorUiApi;
  slot: CharacterEquipmentSlotV1;
}): ReactElement {
  const snap = api.getSnapshot();
  const documentState = snap.documentState!;
  const slotOptions = [
    { value: '', label: 'None' },
    ...documentState.slots
      .filter((candidate) => candidate.id !== slot.id)
      .map((candidate) => ({ value: candidate.id, label: candidate.label })),
  ];

  return (
    <section className="ed-base-section">
      <label className="ed-base-field">
        <span>Slot ID</span>
        <code>{slot.id}</code>
      </label>
      <label className="ed-base-field">
        <span>Label</span>
        <input
          className="ed-input"
          value={slot.label}
          onChange={(event) => {
            slot.label = event.currentTarget.value || slot.id;
            api.updateSlot();
          }}
        />
      </label>
      <label className="ed-base-field">
        <span>Kind</span>
        <select
          className="ed-select"
          value={slot.kind}
          onChange={(event) => {
            const value = event.currentTarget.value;
            slot.kind = value === 'backpack' ? 'backpack' : 'weapon';
            if (slot.kind === 'weapon') slot.weaponSlotType ??= 'rifle';
            else delete slot.weaponSlotType;
            snap.assignments.delete(slot.id);
            api.updateSlot();
          }}
        >
          <option value="weapon">Weapon</option>
          <option value="backpack">Backpack</option>
        </select>
      </label>
      {slot.kind === 'weapon' ? (
        <label className="ed-base-field">
          <span>Accepts</span>
          <select
            className="ed-select"
            value={slot.weaponSlotType ?? 'rifle'}
            onChange={(event) => {
              slot.weaponSlotType = event.currentTarget.value as WeaponSlotType;
              snap.assignments.delete(slot.id);
              if (slot.weaponSlotType === 'rifle' && !slot.providerSocket) {
                const backpack = documentState.slots.find((entry) => entry.kind === 'backpack');
                const socketId = suggestProviderSocketId(
                  'rifle',
                  slot.id,
                  snap.equippedBackpackSockets,
                );
                if (backpack) {
                  slot.providerSocket = {
                    slotId: backpack.id,
                    socketId: socketId ?? slot.id,
                  };
                }
              }
              api.updateSlot();
            }}
          >
            {(['sword', 'handgun', 'rifle'] as const).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="ed-base-field">
        <span>Requires slot</span>
        <select
          className="ed-select"
          value={slot.requiresSlotId ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            slot.requiresSlotId = value || undefined;
            if (!value) snap.assignments.delete(slot.id);
            api.updateSlot();
          }}
        >
          {slotOptions.map((option) => (
            <option key={option.value || 'none'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ed-base-field">
        <span>Provider slot</span>
        <select
          className="ed-select"
          value={slot.providerSocket?.slotId ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!value) {
              slot.providerSocket = undefined;
              api.updateSlot();
              return;
            }
            const accepts = slot.weaponSlotType ?? 'rifle';
            const matching = snap.equippedBackpackSockets.filter(
              (socket) => socket.accepts === accepts,
            );
            const socketId =
              matching.find((socket) => socket.id === slot.id)?.id
              ?? matching.find((socket) => socket.id === slot.providerSocket?.socketId)?.id
              ?? matching[0]?.id
              ?? slot.id;
            slot.providerSocket = { slotId: value, socketId };
            api.updateSlot();
          }}
        >
          <option value="">Character mount</option>
          {slotOptions.slice(1).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {slot.providerSocket ? (
        <label className="ed-base-field">
          <span>Provider socket</span>
          {snap.equippedBackpackSockets.length > 0 ? (
            <select
              className="ed-select"
              value={slot.providerSocket.socketId}
              onChange={(event) => {
                if (slot.providerSocket) {
                  slot.providerSocket.socketId = event.currentTarget.value;
                  api.updateSlot();
                }
              }}
            >
              {snap.equippedBackpackSockets.map((socket) => (
                <option key={socket.id} value={socket.id}>
                  {`${socket.id} · ${socket.accepts}`}
                </option>
              ))}
              {!snap.equippedBackpackSockets.some(
                (socket) => socket.id === slot.providerSocket?.socketId,
              ) ? (
                <option value={slot.providerSocket.socketId}>
                  {`${slot.providerSocket.socketId} · missing on pack`}
                </option>
              ) : null}
            </select>
          ) : (
            <>
              <input
                className="ed-input"
                value={slot.providerSocket.socketId}
                onChange={(event) => {
                  if (slot.providerSocket) {
                    slot.providerSocket.socketId = event.currentTarget.value;
                    api.updateSlot();
                  }
                }}
              />
              <p className="ed-base-note">
                Equip a backpack to pick sockets from the prefab (Asteron Backpack:
                rifle-primary / rifle-secondary).
              </p>
            </>
          )}
        </label>
      ) : null}
      <button
        type="button"
        className="ed-btn"
        onClick={() => void api.deleteSlot(slot.id)}
      >
        Delete slot
      </button>
    </section>
  );
}

function WeaponMountModeSection({
  api,
  slot,
}: {
  api: BaseCharacterEditorUiApi;
  slot: CharacterEquipmentSlotV1;
}): ReactElement {
  const snap = api.getSnapshot();
  const drawn = snap.currentDrawnMount;

  return (
    <section className="ed-base-section">
      <h3>Mount target</h3>
      <div className="ed-base-actions">
        {(
          [
            ['Holster', 'holster'],
            ['Hand bone', 'drawn'],
            ['Weapon grip', 'weapon-grip'],
          ] as const
        ).map(([label, mode]) => {
          const disabled = mode === 'weapon-grip' && !snap.assignments.has(slot.id);
          return (
            <button
              key={mode}
              type="button"
              className={`ed-btn${snap.mountEditMode === mode ? ' is-active' : ''}`}
              disabled={disabled}
              title={disabled ? 'Assign a weapon from the catalog first' : undefined}
              onClick={() => {
                if (mode === 'holster') {
                  api.setMountEditMode('holster');
                  if (snap.simulateDrawnSlotId === slot.id) api.setSimulateDrawnSlotId(null);
                  void api.rebuildEquipmentPreview();
                  return;
                }
                api.enterDrawnAuthoring(slot, mode);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {snap.mountEditMode === 'drawn' || snap.mountEditMode === 'weapon-grip' ? (
        <>
          <p className="ed-base-note">
            {snap.mountEditMode === 'weapon-grip'
              ? 'Per-gun rotation/offset saved on this weapon prefab’s drawn-grip marker.'
              : 'Shared hand bone for this loadout slot (usually prop_r). Prefer Weapon grip for mesh-specific aim.'}
          </p>
          <label className="ed-base-note" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={snap.simulateDrawnSlotId === slot.id}
              onChange={(event) => {
                api.setSimulateDrawnSlotId(event.currentTarget.checked ? slot.id : null);
                void api.rebuildEquipmentPreview();
              }}
            />
            Simulate drawn (mesh in hand)
          </label>
        </>
      ) : null}
      {snap.mountEditMode === 'drawn' ? (
        drawn ? (
          <button
            type="button"
            className="ed-btn"
            onClick={() => api.removeHandBoneMount()}
          >
            Remove hand bone mount
          </button>
        ) : (
          <button
            type="button"
            className="ed-btn"
            onClick={() => api.addHandBoneMount()}
          >
            Add hand bone mount
          </button>
        )
      ) : null}
    </section>
  );
}

function transformUnavailableMessage(
  snap: ReturnType<BaseCharacterEditorUiApi['getSnapshot']>,
  slot: CharacterEquipmentSlotV1,
): string {
  if (snap.mountEditMode === 'weapon-grip' && slot.kind === 'weapon') {
    return 'Assign a weapon and enable Simulate drawn to edit that gun’s grip.';
  }
  if (snap.mountEditMode === 'drawn' && slot.kind === 'weapon') {
    return 'Add a hand bone mount to edit the shared character attach bone.';
  }
  if (slot.requiresSlotId) {
    return `Equip a valid ${slot.requiresSlotId} to edit this provider socket.`;
  }
  return 'The selected transform target is unavailable.';
}

function TransformInspectorSection({
  api,
  slot,
  mount,
}: {
  api: BaseCharacterEditorUiApi;
  slot: CharacterEquipmentSlotV1;
  mount: NonNullable<ReturnType<BaseCharacterEditorUiApi['getSnapshot']>['currentMount']>;
}): ReactElement {
  const snap = api.getSnapshot();
  const transformTarget = snap.currentTransformTarget;
  const editingMount =
    snap.mountEditMode === 'drawn' && slot.kind === 'weapon'
      ? snap.currentDrawnMount
      : snap.mountEditMode === 'weapon-grip'
        ? null
        : mount;

  return (
    <section className="ed-base-section">
      <h3>{transformTarget?.label ?? 'Transform unavailable'}</h3>
      {!transformTarget ? (
        <p className="ed-base-warning">{transformUnavailableMessage(snap, slot)}</p>
      ) : null}
      {transformTarget ? (
        <div className="ed-base-actions">
          {(
            [
              ['Move', 'translate'],
              ['Rotate', 'rotate'],
              ['Scale', 'scale'],
            ] as const
          ).map(([label, mode]) => (
            <button
              key={mode}
              type="button"
              className={`ed-btn${snap.gizmoMode === mode ? ' is-active' : ''}`}
              onClick={() => api.setGizmoMode(mode)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="ed-btn"
            title="Toggle local/world gizmo orientation"
            onClick={() => api.toggleGizmoSpace()}
          >
            {snap.gizmoSpace === 'local' ? 'Local' : 'World'}
          </button>
        </div>
      ) : null}
      {transformTarget?.source === 'character' && editingMount ? (
        <label className="ed-base-field">
          <span>Bone</span>
          <select
            className="ed-select"
            value={editingMount.bone}
            onChange={(event) => api.updateMountBone(event.currentTarget.value)}
          >
            {ATTACHMENT_BONES.map((bone) => (
              <option key={bone} value={bone}>
                {bone}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {transformTarget?.source === 'backpack-socket' ? (
        <p className="ed-base-note">
          Editing the backpack item prefab. Saving will persist this resting weapon position for every character using this backpack.
        </p>
      ) : null}
      {transformTarget?.source === 'weapon-grip' ? (
        <p className="ed-base-note">
          Editing this weapon prefab’s drawn-grip. Each gun keeps its own rotation/offset when drawn.
        </p>
      ) : null}
      {transformTarget ? (
        <>
          <TransformVectorRow
            label="Position"
            values={transformTarget.transform.position}
            step={0.01}
            displayNumber={api.displayNumber}
            onChange={(key, value) => api.updateTransformNumber('position', key, value)}
          />
          <TransformInspectorRotation api={api} />
          <TransformVectorRow
            label="Scale"
            values={transformTarget.transform.scale}
            step={0.05}
            displayNumber={api.displayNumber}
            onChange={(key, value) => api.updateTransformNumber('scale', key, value)}
          />
        </>
      ) : null}
    </section>
  );
}

function TransformInspectorRotation({
  api,
}: {
  api: BaseCharacterEditorUiApi;
}): ReactElement {
  const snap = api.getSnapshot();
  const target = snap.currentTransformTarget;
  if (!target) return <></>;

  const rotation = api.getRotationDegrees(target.transform);

  return (
    <TransformVectorRow
      label="Rotation°"
      values={rotation}
      step={5}
      displayNumber={api.displayNumber}
      onChange={(key, value) => api.updateTransformRotation(key, value)}
    />
  );
}

function EquipmentCatalogSection({
  api,
  slot,
}: {
  api: BaseCharacterEditorUiApi;
  slot: CharacterEquipmentSlotV1;
}): ReactElement {
  const snap = api.getSnapshot();
  const available =
    slot.kind === 'backpack'
      ? snap.backpacks
      : snap.weapons.filter((weapon) => weapon.weaponSlotType === slot.weaponSlotType);
  const slotUnavailable = Boolean(
    slot.requiresSlotId && !snap.assignments.has(slot.requiresSlotId),
  );

  const onDragStart = (event: DragEvent<HTMLButtonElement>, definitionId: string): void => {
    event.dataTransfer?.setData(EQUIPMENT_DND_TYPE, definitionId);
  };

  return (
    <section className="ed-base-section ed-base-catalog">
      <h3>Synchronized catalog</h3>
      <button type="button" className="ed-btn" onClick={() => void api.refreshCatalog()}>
        Refresh
      </button>
      <p className="ed-base-note">{snap.catalogMessage}</p>
      {slotUnavailable ? (
        <p className="ed-base-warning">Equip {slot.requiresSlotId} to unlock this slot.</p>
      ) : (
        available.map((definition) => (
          <button
            key={definition.id}
            type="button"
            className="ed-base-catalog-item"
            draggable
            onDragStart={(event) => onDragStart(event, definition.id)}
            onClick={() => api.assignDefinition(slot, definition)}
          >
            {`${definition.name} · ${definition.prefabId ?? 'missing prefab'}`}
          </button>
        ))
      )}
      <button
        type="button"
        className="ed-btn"
        onClick={() => api.clearAssignment(slot.id)}
      >
        Clear preview assignment
      </button>
    </section>
  );
}

function EquipmentSlotInspector({ api }: BaseCharactersInspectorProps): ReactElement {
  const snap = api.getSnapshot();
  const slot = snap.currentSlot;
  const mount = snap.currentMount;

  if (!slot || !mount || !snap.documentState) {
    return (
      <>
        <div className="ed-base-panel-title">Equipment slot</div>
      </>
    );
  }

  return (
    <>
      <div className="ed-base-panel-title">{slot.label}</div>
      <SlotSettingsSection api={api} slot={slot} />
      {slot.kind === 'weapon' ? <WeaponMountModeSection api={api} slot={slot} /> : null}
      <TransformInspectorSection api={api} slot={slot} mount={mount} />
      <EquipmentCatalogSection api={api} slot={slot} />
    </>
  );
}

export function BaseCharactersInspector({ api }: BaseCharactersInspectorProps): ReactElement {
  const snap = api.getSnapshot();
  if (snap.playTestActive) {
    return <PlayTestInspector api={api} />;
  }
  return <EquipmentSlotInspector api={api} />;
}

