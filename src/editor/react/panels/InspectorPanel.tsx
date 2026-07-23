import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import {
  addColliderToEntities,
  addComponentFromPalette,
  collectComponentTypesOnEntities,
  collectExistingComponentTypes,
  removeComponentTypeFromEntities,
  shouldHideShipHullCollider,
} from '../../component_actions';
import type { EditorEntity, EditorStore, EntityTransform } from '../../document';
import {
  collectMaterialRowsForEntity,
  formatMaterialNumber,
  type MaterialRow,
} from '../../panels/material_manager';
import {
  ENTITY_TRANSFORM_ROWS,
  GLB_TRANSFORM_ROWS,
  STORE_EVENTS,
  formatInspectorNumber,
  listInspectorComponents,
  type InspectorPanelOptions,
  type TransformFieldKey,
} from '../../panels/inspector_logic';
import {
  getComponentDef,
  searchComponents,
  type ComponentDef,
} from '../../../world/prefabs/component_registry';
import type { PrefabComponent } from '../../../world/prefabs/schema';
import { UiIcons } from '../../../ui/icons';
import { useEditorStore } from '../hooks';
import { UiIcon } from '../UiIcon';
import { ComponentFields } from './inspector_component_fields';
import {
  CheckboxRow,
  ColorField,
  EmptyNote,
  FieldRow,
  RemoveButton,
  TextField,
} from './inspector_form';

export type { InspectorPanelOptions };

export type InspectorPanelProps = InspectorPanelOptions & {
  store: EditorStore;
};

type AxisTuple = [
  HTMLInputElement | null,
  HTMLInputElement | null,
  HTMLInputElement | null,
];
type AxisInputs = Record<TransformFieldKey, AxisTuple>;

function emptyAxisInputs(): AxisInputs {
  return {
    position: [null, null, null],
    rotation: [null, null, null],
    scale: [null, null, null],
  };
}

function readVec3(inputs: AxisTuple): { x: number; y: number; z: number } {
  return {
    x: Number(inputs[0]?.value) || 0,
    y: Number(inputs[1]?.value) || 0,
    z: Number(inputs[2]?.value) || 0,
  };
}

function syncAxisInputs(
  inputs: AxisInputs,
  source: EntityTransform,
): void {
  for (const key of ['position', 'rotation', 'scale'] as const) {
    (['x', 'y', 'z'] as const).forEach((axis, index) => {
      const input = inputs[key][index];
      if (!input || document.activeElement === input) return;
      input.value = formatInspectorNumber(source[key][axis]);
    });
  }
}

function TransformRows({
  transform,
  rows,
  inputsRef,
  onCommit,
}: {
  transform: EntityTransform;
  rows: typeof ENTITY_TRANSFORM_ROWS | typeof GLB_TRANSFORM_ROWS;
  inputsRef: React.MutableRefObject<AxisInputs>;
  onCommit: () => void;
}): ReactElement {
  useEffect(() => {
    const inputs = inputsRef.current;
    const onNativeChange = () => onCommit();
    const onKeyDown = (event: KeyboardEvent) => event.stopPropagation();
    const attached: HTMLInputElement[] = [];
    for (const key of ['position', 'rotation', 'scale'] as const) {
      for (const input of inputs[key]) {
        if (!input) continue;
        input.addEventListener('change', onNativeChange);
        input.addEventListener('keydown', onKeyDown);
        attached.push(input);
      }
    }
    return () => {
      for (const input of attached) {
        input.removeEventListener('change', onNativeChange);
        input.removeEventListener('keydown', onKeyDown);
      }
    };
  }, [onCommit, inputsRef, transform, rows]);

  return (
    <>
      {rows.map(({ key, label, step }) => (
        <FieldRow key={key} label={label}>
          {(['x', 'y', 'z'] as const).map((axis, index) => (
            <input
              key={axis}
              ref={(el) => {
                inputsRef.current[key][index] = el;
              }}
              className="ed-input"
              type="number"
              step={step}
              defaultValue={formatInspectorNumber(transform[key][axis])}
            />
          ))}
        </FieldRow>
      ))}
    </>
  );
}

function EntityTransformSection({
  store,
  entity,
}: {
  store: EditorStore;
  entity: EditorEntity;
}): ReactElement {
  const inputsRef = useRef<AxisInputs>(emptyAxisInputs());
  const commit = useCallback(() => {
    store.setTransform(entity.id, {
      position: readVec3(inputsRef.current.position),
      rotation: readVec3(inputsRef.current.rotation),
      scale: readVec3(inputsRef.current.scale),
    });
  }, [store, entity.id]);

  useEffect(() => {
    syncAxisInputs(inputsRef.current, entity);
  }, [entity, entity.position, entity.rotation, entity.scale]);

  useEffect(() => {
    return store.subscribe((event) => {
      if (event.type !== 'transform' || event.entityId !== entity.id) return;
      const current = store.getSelectedEntity();
      if (!current || current.id !== entity.id) return;
      syncAxisInputs(inputsRef.current, current);
    });
  }, [store, entity.id]);

  return (
    <div className="ed-section">
      <h3 className="ed-section-title">Transform</h3>
      <TransformRows
        key={entity.id}
        transform={entity}
        rows={ENTITY_TRANSFORM_ROWS}
        inputsRef={inputsRef}
        onCommit={commit}
      />
    </div>
  );
}

function VisualSection({
  store,
  entity,
}: {
  store: EditorStore;
  entity: EditorEntity;
}): ReactElement {
  const sub = store.getSubSelection();

  return (
    <div className="ed-section">
      <h3 className="ed-section-title">Visual</h3>
      {entity.asset ? (
        <>
          <FieldRow label="Model" wide>
            <span className="ed-tree-name" title={entity.asset.url}>
              {entity.asset.url}
            </span>
          </FieldRow>
          <CheckboxRow
            label="Cast shadows"
            checked={entity.asset.castShadow ?? true}
            onChange={(castShadow) =>
              store.setAsset(entity.id, { ...entity.asset!, castShadow })
            }
          />
          <button
            type="button"
            className="ed-btn"
            onClick={() => store.setAsset(entity.id, null)}
          >
            Remove model
          </button>
          {sub?.entityId === entity.id && (
            <FieldRow label="GLB node" wide>
              <span
                className="ed-tree-name"
                title={
                  store.getGlbNodeName(entity.id, sub.nodeUuid) ?? sub.nodeUuid
                }
              >
                {store.getGlbNodeName(entity.id, sub.nodeUuid) ?? sub.nodeUuid}
              </span>
            </FieldRow>
          )}
        </>
      ) : entity.primitive ? (
        <>
          <FieldRow label="Box size">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <PrimitiveSizeInput
                key={axis}
                store={store}
                entity={entity}
                axis={axis}
              />
            ))}
          </FieldRow>
          <FieldRow label="Color" wide>
            <ColorField
              value={entity.primitive.color ?? '#4c5663'}
              onCommit={(color) =>
                store.setPrimitive(entity.id, { ...entity.primitive!, color })
              }
            />
          </FieldRow>
          <button
            type="button"
            className="ed-btn"
            onClick={() => store.setPrimitive(entity.id, null)}
          >
            Remove box
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ed-btn"
          onClick={() =>
            store.setPrimitive(entity.id, {
              shape: 'box',
              size: { x: 2, y: 2, z: 2 },
              color: '#4c5663',
            })
          }
        >
          Add box primitive
        </button>
      )}
    </div>
  );
}

function PrimitiveSizeInput({
  store,
  entity,
  axis,
}: {
  store: EditorStore;
  entity: EditorEntity;
  axis: 'x' | 'y' | 'z';
}): ReactElement {
  const primitive = entity.primitive!;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onNativeChange = () => {
      const next = Number(input.value);
      if (!Number.isFinite(next)) return;
      const current = store.getSelectedEntity();
      if (!current?.primitive) return;
      store.setPrimitive(entity.id, {
        ...current.primitive,
        size: { ...current.primitive.size, [axis]: Math.max(0.01, next) },
      });
    };
    const onKeyDown = (event: KeyboardEvent) => event.stopPropagation();
    input.addEventListener('change', onNativeChange);
    input.addEventListener('keydown', onKeyDown);
    return () => {
      input.removeEventListener('change', onNativeChange);
      input.removeEventListener('keydown', onKeyDown);
    };
  }, [store, entity.id, axis]);
  return (
    <input
      ref={ref}
      className="ed-input"
      type="number"
      step={0.1}
      defaultValue={formatInspectorNumber(primitive.size[axis])}
    />
  );
}

function MaterialSummaryRow({ row }: { row: MaterialRow }): ReactElement {
  const values = [
    `M ${formatMaterialNumber(row.values.metalness)}`,
    `R ${formatMaterialNumber(row.values.roughness)}`,
    `A ${formatMaterialNumber(row.values.opacity)}`,
  ];
  if (row.values.emissiveIntensity > 0) {
    values.push(`E ${formatMaterialNumber(row.values.emissiveIntensity)}`);
  }
  return (
    <div className="ed-inspector-material-row">
      <span
        className="ed-inspector-material-swatch"
        title={row.values.color}
        style={{ background: row.values.color }}
      />
      <div className="ed-inspector-material-copy">
        <span className="ed-inspector-material-name" title={row.displayName}>
          {row.displayName}
        </span>
        <span className="ed-inspector-material-meta">
          {row.source}
          {row.overridden ? ' · override' : ''}
        </span>
      </div>
      <span className="ed-inspector-material-values">{values.join(' · ')}</span>
    </div>
  );
}

function MaterialsSection({
  store,
  entity,
}: {
  store: EditorStore;
  entity: EditorEntity;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const [error, setError] = useState(false);
  const generationRef = useRef(0);
  const sub = store.getSubSelection();
  const selectedNodeName =
    sub?.entityId === entity.id
      ? store.getGlbNodeName(entity.id, sub.nodeUuid)
      : null;

  useEffect(() => {
    if (collapsed) return;
    const generation = ++generationRef.current;
    setRows(null);
    setError(false);
    void collectMaterialRowsForEntity(entity, { nodeName: selectedNodeName })
      .then((next) => {
        if (
          generation !== generationRef.current ||
          store.getSelection() !== entity.id
        ) {
          return;
        }
        setRows(next);
      })
      .catch(() => {
        if (
          generation !== generationRef.current ||
          store.getSelection() !== entity.id
        ) {
          return;
        }
        setError(true);
      });
  }, [store, entity, entity.id, selectedNodeName, collapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  return (
    <div className={`ed-section${collapsed ? ' is-collapsed' : ''}`}>
      <h3
        className="ed-section-title ed-section-title-toggle"
        title={collapsed ? 'Expand Materials' : 'Collapse Materials'}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event: ReactKeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        }}
      >
        <span>Materials</span>
        <span className="ed-section-caret">
          <UiIcon
            icon={collapsed ? UiIcons.chevronRight : UiIcons.chevronDown}
            className="ed-ui-icon"
            size={14}
          />
        </span>
      </h3>
      {!collapsed && (
        <div className="ed-inspector-material-list">
          {error ? (
            <EmptyNote>Materials unavailable</EmptyNote>
          ) : rows == null ? (
            <EmptyNote>Loading materials…</EmptyNote>
          ) : rows.length === 0 ? (
            <EmptyNote>No visual material</EmptyNote>
          ) : (
            rows.map((row) => (
              <MaterialSummaryRow
                key={`${row.entity.id}:${row.material}:${row.displayName}`}
                row={row}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AddComponentCombobox({
  store,
  entity,
  options,
}: {
  store: EditorStore;
  entity: EditorEntity;
  options: InspectorPanelOptions;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  let results: ComponentDef[] = open
    ? searchComponents(query, store.getState().kind, collectExistingComponentTypes(store))
    : [];
  if (open && shouldHideShipHullCollider(store, entity)) {
    results = results.filter((def) => def.type !== 'collider');
  }
  const safeHighlight = Math.min(highlighted, Math.max(0, results.length - 1));

  const addComponent = (def: ComponentDef) => {
    const sub = store.getSubSelection();
    const nodeBounds =
      sub && sub.entityId === entity.id && options.getGlbNodeBounds
        ? () => options.getGlbNodeBounds!(entity.id, sub.nodeUuid)
        : undefined;
    addComponentFromPalette(
      store,
      entity.id,
      def,
      nodeBounds ? { getNodeBounds: nodeBounds } : undefined,
    );
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="ed-combobox">
      <input
        ref={inputRef}
        className="ed-input"
        type="text"
        placeholder="Add component…"
        autoComplete="off"
        value={query}
        onFocus={() => {
          setOpen(true);
          setHighlighted(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setHighlighted(0);
            } else if (results.length > 0) {
              setHighlighted((prev) => (prev + 1) % results.length);
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (results.length > 0) {
              setHighlighted(
                (prev) => (prev - 1 + results.length) % results.length,
              );
            }
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const def = results[safeHighlight];
            if (open && def) addComponent(def);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            inputRef.current?.blur();
          }
        }}
      />
      <div
        className={`ed-combobox-list${open ? ' is-open' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
      >
        {open && results.length === 0 && (
          <div className="ed-combobox-empty">No matching components</div>
        )}
        {open &&
          results.map((def, index) => (
            <div
              key={def.type}
              className={`ed-combobox-item${index === safeHighlight ? ' is-highlighted' : ''}`}
              onMouseDown={() => addComponent(def)}
              onMouseEnter={() => setHighlighted(index)}
            >
              <span className="ed-combobox-item-label">{def.label}</span>
              <span className="ed-combobox-item-type">{def.type}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function ComponentsSection({
  store,
  entity,
  options,
}: {
  store: EditorStore;
  entity: EditorEntity;
  options: InspectorPanelOptions;
}): ReactElement {
  const { isNodeContext, subNodeName, nodeOverrideComponents, listed } =
    listInspectorComponents(store, entity);
  const sub = store.getSubSelection();

  return (
    <div className="ed-section">
      <h3 className="ed-section-title">Components</h3>
      {!isNodeContext && shouldHideShipHullCollider(store, entity) && (
        <EmptyNote>
          Select a GLB node (RampParent, interior floors, doors…) to add walk
          colliders.
        </EmptyNote>
      )}
      {listed.map(({ component, source, index }) => {
        const update = (next: PrefabComponent): void => {
          if (source === 'node') {
            const list = structuredClone(nodeOverrideComponents);
            list[index] = next;
            store.setNodeOverrideComponents(entity.id, subNodeName!, list);
            return;
          }
          const list = structuredClone(entity.components);
          list[index] = next;
          store.setComponents(entity.id, list);
        };
        const remove = () => {
          if (source === 'node') {
            const list = structuredClone(nodeOverrideComponents);
            list.splice(index, 1);
            store.setNodeOverrideComponents(entity.id, subNodeName!, list);
            return;
          }
          const list = structuredClone(entity.components);
          list.splice(index, 1);
          store.setComponents(entity.id, list);
        };
        const hint = getComponentDef(component.type)?.hint;
        const componentLabel =
          source === 'entity' && isNodeContext
            ? `${component.type} (entity)`
            : component.type;
        return (
          <div
            key={`${source}:${index}:${component.type}`}
            className="ed-component"
          >
            <div className="ed-component-head">
              <span>{componentLabel}</span>
              <RemoveButton title="Remove component" onClick={remove} />
            </div>
            <div className="ed-component-body">
              <ComponentFields
                store={store}
                component={component}
                update={update}
                options={options}
                fieldOptions={{
                  hideColliderNodeField:
                    isNodeContext && component.type === 'collider',
                  colliderNodeBounds:
                    isNodeContext && sub && options.getGlbNodeBounds
                      ? options.getGlbNodeBounds(entity.id, sub.nodeUuid)
                      : null,
                  entityId: entity.id,
                }}
              />
              {hint ? <EmptyNote>{hint}</EmptyNote> : null}
            </div>
          </div>
        );
      })}
      <div className="ed-add-component">
        <AddComponentCombobox store={store} entity={entity} options={options} />
      </div>
    </div>
  );
}

function InspectorBody({
  store,
  options,
}: {
  store: EditorStore;
  options: InspectorPanelOptions;
}): ReactElement {
  const selectedIds = store.getSelectedIds();
  const subSelection = store.getSubSelection();
  const previewTarget = `${selectedIds.join(',')}:${subSelection?.nodeUuid ?? ''}`;
  const lastPreviewTarget = useRef('');

  useEffect(() => {
    if (lastPreviewTarget.current && previewTarget !== lastPreviewTarget.current) {
      options.audioPreview.stop();
    }
    lastPreviewTarget.current = previewTarget;
  }, [previewTarget, options.audioPreview]);

  if (selectedIds.length > 1) {
    const removableTypes = collectComponentTypesOnEntities(store, selectedIds);
    return (
      <div className="ed-section">
        <EmptyNote>{selectedIds.length} entities selected</EmptyNote>
        <div className="ed-bulk-actions">
          <button
            type="button"
            className="ed-btn"
            onClick={() => addColliderToEntities(store, selectedIds, 'box')}
          >
            Add Box Collider to All
          </button>
          <button
            type="button"
            className="ed-btn"
            onClick={() => addColliderToEntities(store, selectedIds, 'mesh')}
          >
            Add Mesh Collider to All
          </button>
          {removableTypes.map((type) => {
            const label = getComponentDef(type)?.label ?? type;
            return (
              <button
                key={type}
                type="button"
                className="ed-btn"
                onClick={() =>
                  removeComponentTypeFromEntities(store, selectedIds, type)
                }
              >
                Remove {label} from All
              </button>
            );
          })}
          <button
            type="button"
            className="ed-btn"
            onClick={() => store.groupSelectedInEmpty()}
          >
            Group in Empty
          </button>
        </div>
      </div>
    );
  }

  const entity = store.getSelectedEntity();
  if (!entity) {
    return (
      <EmptyNote>
        Nothing selected. Click an object in the scene or the hierarchy.
      </EmptyNote>
    );
  }

  const sub = store.getSubSelection();
  const subNodeName =
    sub && sub.entityId === entity.id
      ? store.getGlbNodeName(entity.id, sub.nodeUuid)
      : null;
  const meshTransform =
    sub?.entityId === entity.id && options.getGlbNodeLocalTransform
      ? options.getGlbNodeLocalTransform(sub.entityId, sub.nodeUuid)
      : null;

  return (
    <>
      <div className="ed-section">
        <FieldRow label="Name" wide>
          {subNodeName ? (
            <span className="ed-field-value-static">{subNodeName}</span>
          ) : (
            <TextField
              value={entity.name}
              onCommit={(name) =>
                store.renameEntity(entity.id, name.trim() || entity.name)
              }
            />
          )}
        </FieldRow>
      </div>
      <EntityTransformSection store={store} entity={entity} />
      {sub && meshTransform ? (
        <GlbNodeTransformSection
          store={store}
          options={options}
          entityId={sub.entityId}
          nodeUuid={sub.nodeUuid}
          transform={meshTransform}
        />
      ) : null}
      <VisualSection store={store} entity={entity} />
      <MaterialsSection store={store} entity={entity} />
      <ComponentsSection store={store} entity={entity} options={options} />
    </>
  );
}

function GlbNodeTransformSection({
  store,
  options,
  entityId,
  nodeUuid,
  transform,
}: {
  store: EditorStore;
  options: InspectorPanelOptions;
  entityId: string;
  nodeUuid: string;
  transform: EntityTransform;
}): ReactElement | null {
  const inputsRef = useRef<AxisInputs>(emptyAxisInputs());
  const setTransform = options.setGlbNodeLocalTransform;
  const getTransform = options.getGlbNodeLocalTransform;

  const commit = useCallback(() => {
    if (!setTransform) return;
    setTransform(entityId, nodeUuid, {
      position: readVec3(inputsRef.current.position),
      rotation: readVec3(inputsRef.current.rotation),
      scale: readVec3(inputsRef.current.scale),
    });
  }, [setTransform, entityId, nodeUuid]);

  useEffect(() => {
    if (!getTransform) return;
    return store.subscribe((event) => {
      if (
        event.type !== 'glb-transform' ||
        event.entityId !== entityId ||
        event.nodeUuid !== nodeUuid
      ) {
        return;
      }
      const next = getTransform(entityId, nodeUuid);
      if (!next) return;
      syncAxisInputs(inputsRef.current, next);
    });
  }, [store, entityId, nodeUuid, getTransform]);

  if (!setTransform || !getTransform) return null;

  return (
    <div className="ed-section">
      <h3 className="ed-section-title">Mesh Transform</h3>
      <EmptyNote>
        Local pose on the selected GLB part. Saved as a prefab node override.
      </EmptyNote>
      <TransformRows
        key={`${entityId}:${nodeUuid}`}
        transform={transform}
        rows={GLB_TRANSFORM_ROWS}
        inputsRef={inputsRef}
        onCommit={commit}
      />
    </div>
  );
}

export function InspectorPanel({
  store,
  ...options
}: InspectorPanelProps): ReactElement {
  useEditorStore(store, STORE_EVENTS);

  const selectedIds = store.getSelectedIds();
  const entity =
    selectedIds.length === 1 ? store.getSelectedEntity() : null;

  return (
    <>
      <div className="ed-panel-title">
        <span>Inspector</span>
        <div className="ed-panel-title-actions">
          <button
            type="button"
            className="ed-eye"
            hidden={!entity}
            title={entity?.visible ? 'Hide' : 'Show'}
            onClick={() => {
              if (!entity || store.getSelectedIds().length !== 1) return;
              store.setVisible(entity.id, !entity.visible);
            }}
          >
            {entity?.visible === false ? '◌' : '◉'}
          </button>
        </div>
      </div>
      <div className="ed-panel-body">
        <InspectorBody store={store} options={options} />
      </div>
    </>
  );
}
