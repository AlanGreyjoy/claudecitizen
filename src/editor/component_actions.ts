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

export function addComponentFromPalette(
  store: EditorStore,
  targetEntityId: string,
  def: ComponentDef,
  options?: AddComponentOptions,
): void {
  const entity = store.locate(targetEntityId)?.entity;
  if (!entity) return;

  const sub = store.getSubSelection();
  const subNodeName =
    sub && sub.entityId === targetEntityId
      ? store.getGlbNodeName(targetEntityId, sub.nodeUuid)
      : null;

  const hasVisual = Boolean(entity.asset || entity.primitive);
  if (def.marker && hasVisual) {
    const markerLabel = subNodeName ? `${def.label} (${subNodeName})` : def.label;
    const marker = createEmptyEntity(markerLabel);
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
): void {
  const entity = createEmptyEntity(name);
  entity.position = { ...position };
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
      addComponentFromPalette(
        store,
        targetEntityId,
        def,
        spawnPosition ? { spawnPosition } : undefined,
      );
    },
  }));
}

export function buildGlbAuthoringMenu(
  store: EditorStore,
  entityId: string,
  nodeUuid: string,
  getSpawnPosition: (entityId: string, nodeUuid: string) => Vec3 | null,
  nodeName?: string | null,
): ContextMenuEntry[] {
  const getPos = () => getSpawnPosition(entityId, nodeUuid);
  const entries: ContextMenuEntry[] = [
    {
      label: 'Add Empty Here',
      action: () => {
        const position = getPos();
        if (!position) {
          showToast('Mesh position unavailable — model may still be loading.', true);
          return;
        }
        addEmptyAtPosition(store, entityId, position);
      },
    },
    'sep',
    {
      label: 'Components',
      children: buildComponentsSubmenu(store, entityId, {
        markerOnly: true,
        getSpawnPosition: getPos,
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
