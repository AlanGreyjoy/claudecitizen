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

export interface NodeBounds {
  min: Vec3;
  max: Vec3;
}

export function fitBoxColliderToBounds(bounds: NodeBounds): {
  size: Vec3;
  offset: Vec3;
} {
  return {
    size: {
      x: Math.max(0.01, Math.abs(bounds.max.x - bounds.min.x)),
      y: Math.max(0.01, Math.abs(bounds.max.y - bounds.min.y)),
      z: Math.max(0.01, Math.abs(bounds.max.z - bounds.min.z)),
    },
    offset: {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    },
  };
}

export interface GlbNodeColliderTarget {
  entityId: string;
  nodeUuid: string;
  nodeName: string;
}

export type ColliderShapeChoice = 'box' | 'mesh';

export function addColliderShapeMenuEntries(
  onPick: (shape: ColliderShapeChoice) => void,
): ContextMenuEntry[] {
  return [
    { label: 'Box', action: () => onPick('box') },
    { label: 'Mesh', action: () => onPick('mesh') },
  ];
}

export function addColliderToEntities(
  store: EditorStore,
  entityIds: string[],
  shape: ColliderShapeChoice,
): void {
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
    const component = createComponentForEntity(colliderDef, entity, null, shape);
    store.setComponents(entityId, [...entity.components, component]);
    added += 1;
  }

  if (added === 0 && skipped > 0) {
    showToast(`All ${skipped} selected entities already have colliders.`, true);
    return;
  }
  if (skipped > 0) {
    showToast(
      `Added ${shape} collider to ${added} entities (${skipped} already had one).`,
    );
    return;
  }
  showToast(
    `Added ${shape} collider to ${added} ${added === 1 ? 'entity' : 'entities'}.`,
  );
}

export function addColliderToGlbNodes(
  store: EditorStore,
  targets: GlbNodeColliderTarget[],
  getNodeBounds: ((entityId: string, nodeUuid: string) => NodeBounds | null) | undefined,
  shape: ColliderShapeChoice,
): void {
  const colliderDef = allComponentsForKind(store).find((def) => def.type === 'collider');
  if (!colliderDef) {
    showToast('Collider component is unavailable for this prefab kind.', true);
    return;
  }

  const uniqueTargets = new Map<string, GlbNodeColliderTarget>();
  for (const target of targets) {
    uniqueTargets.set(`${target.entityId}::${target.nodeName}`, target);
  }

  const edits: Parameters<EditorStore['setNodeOverrideComponentsBatch']>[0] = [];
  let skipped = 0;
  for (const target of uniqueTargets.values()) {
    const entity = store.locate(target.entityId)?.entity;
    if (!entity?.asset) continue;
    const existing = store.getNodeOverrideComponents(target.entityId, target.nodeName);
    if (existing.some((component) => component.type === 'collider')) {
      skipped += 1;
      continue;
    }
    const component = createComponentForEntity(
      colliderDef,
      entity,
      target.nodeName,
      shape,
    );
    if (component.type === 'collider' && component.shape === 'box') {
      const bounds = getNodeBounds?.(target.entityId, target.nodeUuid);
      if (bounds) {
        const { size, offset } = fitBoxColliderToBounds(bounds);
        component.size = size;
        component.offset = offset;
      }
    }
    edits.push({
      entityId: target.entityId,
      nodeName: target.nodeName,
      components: [...existing, component],
    });
  }

  if (edits.length === 0) {
    showToast(
      skipped > 0
        ? 'All selected nodes already have colliders.'
        : 'No selected GLB nodes can receive colliders.',
      true,
    );
    return;
  }

  store.setNodeOverrideComponentsBatch(
    edits,
    `Add ${shape} colliders to ${edits.length} ${edits.length === 1 ? 'node' : 'nodes'}`,
  );
  showToast(
    skipped > 0
      ? `Added ${shape} colliders to ${edits.length} nodes (${skipped} already had one).`
      : `Added ${shape} colliders to ${edits.length} ${edits.length === 1 ? 'node' : 'nodes'}.`,
  );
}

export function addComponentFromPalette(
  store: EditorStore,
  targetEntityId: string,
  def: ComponentDef,
  options?: AddComponentOptions & {
    getNodeBounds?: () => NodeBounds | null;
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
        const { size, offset } = fitBoxColliderToBounds(bounds);
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

  // Object Animation (and similar entity-level components) attach to the entity,
  // not the node override list. Clear GLB sub-selection so the inspector shows
  // their settings instead of an empty node Components section.
  if (subNodeName && def.type === 'object-animation') {
    store.setEntitySelection(targetEntityId);
    showToast(
      `Added "${def.label}" targeting ${subNodeName} — tune speed/axis in the inspector.`,
    );
  }
}

function createComponentForEntity(
  def: ComponentDef,
  entity: EditorEntity,
  subNodeName?: string | null,
  colliderShape?: ColliderShapeChoice,
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
  if (component.type === 'object-animation' && subNodeName) {
    const idSafe = subNodeName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return {
      ...component,
      id: `obj-anim-${idSafe}`,
      mode: 'spin',
      nodes: [{ name: subNodeName }],
      speed: 0.4,
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

  const shape =
    colliderShape ??
    (subNodeName
      ? 'box'
      : entity.primitive?.shape === 'box'
        ? 'box'
        : entity.asset
          ? 'mesh'
          : 'box');

  if (shape === 'mesh') {
    return { type: 'collider', shape: 'mesh' };
  }

  // Box: size from primitive when available; GLB-node boxes are fitted by the
  // caller when bounds are known. Authors can still switch to mesh in inspector.
  if (!subNodeName && entity.primitive?.shape === 'box') {
    return {
      type: 'collider',
      shape: 'box',
      size: { ...entity.primitive.size },
    };
  }
  return {
    type: 'collider',
    shape: 'box',
    size: { x: 1, y: 1, z: 1 },
  };
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

export function shouldHideShipHullCollider(
  store: EditorStore,
  entity: EditorEntity,
): boolean {
  if (store.getState().kind !== 'ship') return false;
  const sub = store.getSubSelection();
  if (sub && sub.entityId === entity.id) return false;
  return (
    Boolean(entity.asset) &&
    entity.components.some((component) => component.type === 'ship-controller')
  );
}

export function componentPaletteForContext(
  store: EditorStore,
  options?: { markerOnly?: boolean; targetEntityId?: string },
): ComponentDef[] {
  const existing = collectExistingComponentTypes(store);
  let palette = searchComponents('', store.getState().kind, existing);
  if (options?.markerOnly) palette = palette.filter((def) => def.marker);
  if (options?.targetEntityId) {
    const entity = store.locate(options.targetEntityId)?.entity;
    if (entity && shouldHideShipHullCollider(store, entity)) {
      palette = palette.filter((def) => def.type !== 'collider');
    }
  }
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
    targetEntityId,
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
