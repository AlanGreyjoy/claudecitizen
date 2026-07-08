import type { EditorEntity } from './document';
import type { PrefabComponent } from '../world/prefabs/schema';

/** Parse `Label (GlbNodeName)` — handles node names that contain parentheses. */
export function glbAnchorFromEntityName(name: string): string | null {
  const idx = name.lastIndexOf(' (');
  if (idx === -1) return null;
  const suffix = name.slice(idx + 2);
  if (!suffix.endsWith(')')) return null;
  return suffix.slice(0, -1);
}

export function getEntityGlbAnchor(entity: Pick<EditorEntity, 'name' | 'glbAnchor'>): string | null {
  return entity.glbAnchor ?? glbAnchorFromEntityName(entity.name);
}

function componentTargetsGlbNode(component: PrefabComponent, nodeName: string): boolean {
  if (component.type === 'ship-door' && Array.isArray(component.nodes)) {
    return component.nodes.some((n) => n.name === nodeName);
  }
  if (component.type === 'animation' && Array.isArray(component.nodes)) {
    return component.nodes.some((n) => n.name === nodeName);
  }
  if (component.type === 'collider' && component.node === nodeName) {
    return true;
  }
  return false;
}

export function entityTargetsGlbNode(entity: EditorEntity, nodeName: string): boolean {
  if (getEntityGlbAnchor(entity) === nodeName) return true;
  return (entity.components ?? []).some((component) => componentTargetsGlbNode(component, nodeName));
}

export function entityBoundToAnyGlbNode(
  entity: EditorEntity,
  glbNodeNames: Set<string>,
): boolean {
  const anchor = getEntityGlbAnchor(entity);
  if (anchor && glbNodeNames.has(anchor)) return true;
  for (const component of entity.components ?? []) {
    if (component.type === 'ship-door' && Array.isArray(component.nodes)) {
      if (component.nodes.some((n) => n.name && glbNodeNames.has(n.name))) return true;
    }
    if (component.type === 'animation' && Array.isArray(component.nodes)) {
      if (component.nodes.some((n) => n.name && glbNodeNames.has(n.name))) return true;
    }
    if (component.type === 'collider' && component.node && glbNodeNames.has(component.node)) {
      return true;
    }
  }
  return false;
}
