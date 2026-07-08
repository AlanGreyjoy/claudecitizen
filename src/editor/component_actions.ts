import { createEmptyEntity, type EditorEntity, type EditorStore } from './document';
import { showToast, type ContextMenuEntry } from './dom';
import type { ComponentDef } from '../world/prefabs/component_registry';
import {
  getComponentsForKind,
  searchComponents,
} from '../world/prefabs/component_registry';
import type { PrefabComponent, PrefabComponentType } from '../world/prefabs/schema';
import type { Vec3 } from '../types';

export function collectExistingComponentTypes(store: EditorStore): PrefabComponentType[] {
  const types: PrefabComponentType[] = [];
  const visit = (entities: ReturnType<EditorStore['getState']>['roots']): void => {
    for (const current of entities) {
      for (const component of current.components) types.push(component.type);
      visit(current.children);
    }
  };
  visit(store.getState().roots);
  return types;
}

export interface AddComponentOptions {
  spawnPosition?: Vec3;
}

export function addColliderToEntities(store: EditorStore, entityIds: string[]): void {
  const colliderDef = allComponentsForKind(store).find((def) => def.type === 'collider');
  if (!colliderDef) {
    showToast('Collider component is unavailable for this prefab kind.', true);
    return;
  }

  let added = 0;
  let skipped = 0;

  for (const entityId of entityIds) {
    const entity = store.locate(entityId)?.entity;
    if (!entity) continue;
    if (entity.components.some((component) => component.type === 'collider')) {
      skipped += 1;
      continue;
    }
    const component = createComponentForEntity(colliderDef, entity, null);
    store.setComponents(entityId, [...entity.components, component]);
    added += 1;
  }

  if (added === 0 && skipped > 0) {
    showToast(`All ${skipped} selected entities already have colliders.`, true);
    return;
  }
  if (skipped > 0) {
    showToast(`Added collider to ${added} entities (${skipped} already had one).`);
    return;
  }
  showToast(`Added collider to ${added} ${added === 1 ? 'entity' : 'entities'}.`);
}

export function addComponentFromPalette(
  store: EditorStore,
  targetEntityId: string,
  def: ComponentDef,
  options?: AddComponentOptions & {
    getNodeBounds?: () => { min: Vec3; max: Vec3 } | null;
  },
): void {
  const entity = store.locate(targetEntityId)?.entity;
  if (!entity) return;

  const sub = store.getSubSelection();
  const subNodeName =
    sub && sub.entityId === targetEntityId
      ? store.getGlbNodeName(targetEntityId, sub.nodeUuid)
      : null;

  // When a GLB node is sub-selected and the component is a collider, attach
  // it to the node override rather than the entity or a child marker.
  if (
    subNodeName &&
    !def.marker &&
    def.type === 'collider' &&
    entity.asset
  ) {
    const existing = store.getNodeOverrideComponents(targetEntityId, subNodeName);
    const component = createComponentForEntity(def, entity, subNodeName);
    // Auto-size the box collider to the node's mesh bounds
    if (component.type === 'collider' && component.shape === 'box') {
      const bounds = options?.getNodeBounds?.();
      if (bounds) {
        const size = {
          x: Math.abs(bounds.max.x - bounds.min.x),
          y: Math.abs(bounds.max.y - bounds.min.y),
          z: Math.abs(bounds.max.z - bounds.min.z),
        };
        const offset = {
          x: (bounds.min.x + bounds.max.x) / 2,
          y: (bounds.min.y + bounds.max.y) / 2,
          z: (bounds.min.z + bounds.max.z) / 2,
        };
        component.size = size;
        component.offset = offset;
      }
    }
    store.setNodeOverrideComponents(targetEntityId, subNodeName, [...existing, component]);
    showToast(`Added "${def.label}" to node ${subNodeName}.`);
    return;
  }

  const hasVisual = Boolean(entity.asset || entity.primitive);
  if (def.marker && hasVisual) {
    const markerLabel = subNodeName ? `${def.label} (${subNodeName})` : def.label;
    const marker = createEmptyEntity(markerLabel);
    if (subNodeName) marker.glbAnchor = subNodeName;
    marker.components = [createComponentForEntity(def, entity, subNodeName)];
    if (options?.spawnPosition) {
      marker.position = { ...options.spawnPosition };
    }
    store.addEntity(marker, targetEntityId);
    showToast(
      options?.spawnPosition
        ? `Added "${def.label}" at mesh position — fine-tune with the gizmo.`
        : `Added "${def.label}" as a child marker — position it with the gizmo.`,
    );
    return;
  }

  const components = structuredClone(entity.components);
  components.push(createComponentForEntity(def, entity, subNodeName));
  store.setComponents(targetEntityId, components);
}

function createComponentForEntity(
  def: ComponentDef,
  entity: EditorEntity,
  subNodeName?: string | null,
): PrefabComponent {
  const component = def.createDefault();
  if (component.type === 'animation' && subNodeName) {
    const idSafe = subNodeName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return {
      ...component,
      id: `anim-${idSafe}`,
      name: subNodeName,
      nodes: [{ name: subNodeName, delta: -1 }],
    };
  }
  if (component.type === 'ship-door' && subNodeName) {
    const idSafe = subNodeName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return {
      ...component,
      id: `door-${idSafe}`,
      label: subNodeName,
      nodes: [{ name: subNodeName, delta: -1 }],
    };
  }
  if (component.type !== 'collider') return component;

  // When a GLB node is sub-selected, default to a box collider (not mesh)
  // since the collider is attached to a specific node.
  if (subNodeName) {
    return {
      ...component,
      shape: 'box',
      size: { x: 1, y: 1, z: 1 },
    };
  }

  // Default new colliders to fit the entity's visual so authors don't end up
  // with a useless 1x1x1 box on a wall, prop, or hull model.
  if (entity.primitive?.shape === 'box') {
    return {
      ...component,
      shape: 'box',
      size: { ...entity.primitive.size },
    };
  }
  if (entity.asset) {
    return {
      ...component,
      shape: 'mesh',
    };
  }
  return component;
}

export function addEmptyAtPosition(
  store: EditorStore,
  parentEntityId: string,
  position: Vec3,
  name = 'Empty',
  glbAnchor?: string | null,
): void {
  const entity = createEmptyEntity(name);
  entity.position = { ...position };
  if (glbAnchor) entity.glbAnchor = glbAnchor;
  store.addEntity(entity, parentEntityId);
}

export function componentPaletteForContext(
  store: EditorStore,
  options?: { markerOnly?: boolean },
): ComponentDef[] {
  const existing = collectExistingComponentTypes(store);
  const palette = searchComponents('', store.getState().kind, existing);
  if (options?.markerOnly) return palette.filter((def) => def.marker);
  return palette;
}

export function isComponentAvailable(
  store: EditorStore,
  def: ComponentDef,
): boolean {
  if (!def.singleton) return true;
  return !collectExistingComponentTypes(store).includes(def.type);
}

export function allComponentsForKind(store: EditorStore): ComponentDef[] {
  return getComponentsForKind(store.getState().kind);
}

export function buildComponentsSubmenu(
  store: EditorStore,
  targetEntityId: string,
  options?: {
    markerOnly?: boolean;
    getSpawnPosition?: () => Vec3 | null;
    getNodeBounds?: () => { min: Vec3; max: Vec3 } | null;
  },
): ContextMenuEntry[] {
  const palette = componentPaletteForContext(store, {
    markerOnly: options?.markerOnly,
  });
  if (palette.length === 0) {
    return [{ label: 'No components', disabled: true }];
  }
  return palette.map((def) => ({
    label: def.label,
    disabled: !isComponentAvailable(store, def),
    action: () => {
      const spawnPosition = options?.getSpawnPosition?.() ?? undefined;
      const nodeBounds = options?.getNodeBounds?.() ?? undefined;
      addComponentFromPalette(
        store,
        targetEntityId,
        def,
        spawnPosition || nodeBounds
          ? { spawnPosition: spawnPosition ?? undefined, getNodeBounds: options?.getNodeBounds }
          : undefined,
      );
    },
  }));
}

export function buildGlbAuthoringMenu(
  store: EditorStore,
  entityId: string,
  nodeUuid: string,
  getSpawnPosition: (entityId: string, nodeUuid: string) => Vec3 | null,
  getNodeBounds: (entityId: string, nodeUuid: string) => { min: Vec3; max: Vec3 } | null,
  nodeName?: string | null,
): ContextMenuEntry[] {
  const getPos = () => getSpawnPosition(entityId, nodeUuid);
  const getBounds = () => getNodeBounds(entityId, nodeUuid);
  const entries: ContextMenuEntry[] = [
    {
      label: 'Add Empty Here',
      action: () => {
        const position = getPos();
        if (!position) {
          showToast('Mesh position unavailable — model may still be loading.', true);
          return;
        }
        addEmptyAtPosition(store, entityId, position, 'Empty', nodeName ?? null);
      },
    },
    'sep',
    {
      label: 'Add Component to Node',
      children: buildComponentsSubmenu(store, entityId, {
        getSpawnPosition: getPos,
        getNodeBounds: getBounds,
      }),
    },
  ];
  if (nodeName) {
    entries.push('sep', {
      label: 'Copy Node Name',
      action: () => {
        void navigator.clipboard.writeText(nodeName).then(
          () => showToast(`Copied "${nodeName}"`),
          () => showToast('Could not copy to clipboard', true),
        );
      },
    });
  }
  return entries;
}

export function buildEntityComponentsSubmenu(
  store: EditorStore,
  entityId: string,
  getSpawnPosition?: () => Vec3 | null,
): ContextMenuEntry {
  return {
    label: 'Components',
    children: buildComponentsSubmenu(store, entityId, {
      getSpawnPosition: getSpawnPosition ?? undefined,
    }),
  };
}
