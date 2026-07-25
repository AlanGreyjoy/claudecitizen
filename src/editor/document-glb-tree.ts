import type { GlbNodeRef } from './document-types';

export function findGlbNodeName(tree: GlbNodeRef, nodeUuid: string): string | null {
  if (tree.uuid === nodeUuid) return tree.name;
  for (const child of tree.children) {
    const name = findGlbNodeName(child, nodeUuid);
    if (name) return name;
  }
  return null;
}

export function findGlbNodeUuid(tree: GlbNodeRef, nodeName: string): string | null {
  if (tree.name === nodeName) return tree.uuid;
  for (const child of tree.children) {
    const uuid = findGlbNodeUuid(child, nodeName);
    if (uuid) return uuid;
  }
  return null;
}

export function findGlbNodeRef(tree: GlbNodeRef, nodeUuid: string): GlbNodeRef | null {
  if (tree.uuid === nodeUuid) return tree;
  for (const child of tree.children) {
    const found = findGlbNodeRef(child, nodeUuid);
    if (found) return found;
  }
  return null;
}

export function collectGlbNodeNames(node: GlbNodeRef, names = new Set<string>()): Set<string> {
  names.add(node.name);
  for (const child of node.children) collectGlbNodeNames(child, names);
  return names;
}

export function glbOverrideKey(entityId: string, nodeName: string): string {
  return `${entityId}::${nodeName}`;
}
