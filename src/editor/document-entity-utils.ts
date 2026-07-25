import type { Vec3 } from '../types';
import type { EditorEntity, EntityLocation, EntityTransform } from './document-types';

export function makeEntityId(): string {
  return `e-${crypto.randomUUID().slice(0, 8)}`;
}

export function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function cloneTransform(t: EntityTransform): EntityTransform {
  return { position: cloneVec(t.position), rotation: cloneVec(t.rotation), scale: cloneVec(t.scale) };
}

export function createEmptyEntity(name: string): EditorEntity {
  return {
    id: makeEntityId(),
    name,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    asset: null,
    primitive: null,
    glbNodeTransforms: [],
    glbNodeHidden: [],
    materialOverrides: [],
    components: [],
    children: [],
  };
}

export function regenerateIds(entity: EditorEntity): void {
  entity.id = makeEntityId();
  for (const child of entity.children) regenerateIds(child);
}

export function locateEntity(
  roots: EditorEntity[],
  id: string,
): EntityLocation | null {
  const stack: { list: EditorEntity[]; parent: EditorEntity | null }[] = [
    { list: roots, parent: null },
  ];
  while (stack.length > 0) {
    const { list, parent } = stack.pop()!;
    for (let index = 0; index < list.length; index += 1) {
      const entity = list[index];
      if (entity.id === id) return { entity, siblings: list, index, parent };
      stack.push({ list: entity.children, parent: entity });
    }
  }
  return null;
}

export function isDescendantOf(
  roots: EditorEntity[],
  ancestorId: string,
  id: string,
): boolean {
  const ancestor = locateEntity(roots, ancestorId)?.entity;
  if (!ancestor) return false;
  const stack = [...ancestor.children];
  while (stack.length > 0) {
    const entity = stack.pop()!;
    if (entity.id === id) return true;
    stack.push(...entity.children);
  }
  return false;
}
