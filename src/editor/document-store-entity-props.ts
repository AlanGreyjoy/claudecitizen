import type {
  PrefabComponent,
  PrefabMaterialOverride,
  PrefabPrimitive,
} from '../world/prefabs/schema';
import type { EditorStoreCtx } from './document-store-ctx';
import type { EditorEntity, EntityTransform } from './document-types';
import { cloneTransform, cloneVec } from './document-entity-utils';

export function attachEntityPropMethods(ctx: EditorStoreCtx): void {
  function patchEntity(
    id: string,
    label: string,
    apply: (entity: EditorEntity) => void,
    revert: (entity: EditorEntity) => void,
  ): void {
    ctx.history.execute({
      label,
      do() {
        const entity = ctx.locate(id)?.entity;
        if (!entity) return;
        apply(entity);
        ctx.markDirty();
        ctx.emit({ type: 'entity', entityId: id });
      },
      undo() {
        const entity = ctx.locate(id)?.entity;
        if (!entity) return;
        revert(entity);
        ctx.emit({ type: 'entity', entityId: id });
      },
    });
  }

  function renameEntity(id: string, name: string): void {
    const before = ctx.locate(id)?.entity.name;
    if (before === undefined || before === name) return;
    patchEntity(
      id,
      `Rename to ${name}`,
      (entity) => {
        entity.name = name;
      },
      (entity) => {
        entity.name = before;
      },
    );
  }

  function setVisible(id: string, visible: boolean): void {
    const before = ctx.locate(id)?.entity.visible;
    if (before === undefined || before === visible) return;
    patchEntity(
      id,
      visible ? 'Show' : 'Hide',
      (entity) => {
        entity.visible = visible;
      },
      (entity) => {
        entity.visible = before;
      },
    );
  }

  function setPrimitive(id: string, primitive: PrefabPrimitive | null): void {
    const before = ctx.locate(id)?.entity.primitive ?? null;
    patchEntity(
      id,
      'Edit primitive',
      (entity) => {
        entity.primitive = primitive ? structuredClone(primitive) : null;
      },
      (entity) => {
        entity.primitive = before ? structuredClone(before) : null;
      },
    );
  }

  function setAsset(id: string, asset: { url: string; castShadow?: boolean } | null): void {
    const before = ctx.locate(id)?.entity.asset ?? null;
    const beforeOverrides = ctx.locate(id)?.entity.materialOverrides ?? [];
    const beforeOverridesCopy = structuredClone(beforeOverrides);
    patchEntity(
      id,
      'Edit asset',
      (entity) => {
        const nextAsset = asset ? { ...asset } : null;
        entity.asset = nextAsset;
        if (before?.url !== nextAsset?.url) entity.materialOverrides = [];
      },
      (entity) => {
        entity.asset = before ? { ...before } : null;
        entity.materialOverrides = structuredClone(beforeOverridesCopy);
      },
    );
  }

  function setMaterialOverride(
    id: string,
    material: string,
    override: PrefabMaterialOverride | null,
  ): void {
    const before = ctx.locate(id)?.entity.materialOverrides;
    if (!before) return;
    const beforeCopy = structuredClone(before);
    const next = beforeCopy.filter((entry) => entry.material !== material);
    if (override) next.push(structuredClone(override));
    next.sort((a, b) => a.material.localeCompare(b.material));
    if (JSON.stringify(beforeCopy) === JSON.stringify(next)) return;
    patchEntity(
      id,
      `Edit material ${material}`,
      (entity) => {
        entity.materialOverrides = structuredClone(next);
      },
      (entity) => {
        entity.materialOverrides = structuredClone(beforeCopy);
      },
    );
  }

  function setMaterialOverridesBatch(
    edits: ReadonlyArray<{
      entityId: string;
      material: string;
      override: PrefabMaterialOverride | null;
    }>,
    label = 'Apply materials',
  ): void {
    const unique = new Map<
      string,
      { entityId: string; material: string; override: PrefabMaterialOverride | null }
    >();
    for (const edit of edits) {
      if (!ctx.locate(edit.entityId)) continue;
      unique.set(`${edit.entityId}::${edit.material}`, {
        entityId: edit.entityId,
        material: edit.material,
        override: edit.override ? structuredClone(edit.override) : null,
      });
    }
    if (unique.size === 0) return;

    const byEntity = new Map<
      string,
      {
        before: PrefabMaterialOverride[];
        slots: Map<string, PrefabMaterialOverride | null>;
      }
    >();
    for (const edit of unique.values()) {
      let entry = byEntity.get(edit.entityId);
      if (!entry) {
        const entity = ctx.locate(edit.entityId)?.entity;
        if (!entity) continue;
        entry = {
          before: structuredClone(entity.materialOverrides),
          slots: new Map(),
        };
        byEntity.set(edit.entityId, entry);
      }
      entry.slots.set(edit.material, edit.override);
    }

    const changes = [...byEntity.entries()]
      .map(([entityId, { before, slots }]) => {
        let next = structuredClone(before);
        for (const [material, override] of slots) {
          next = next.filter((entry) => entry.material !== material);
          if (override) next.push(structuredClone(override));
        }
        next.sort((a, b) => a.material.localeCompare(b.material));
        return { entityId, before, next };
      })
      .filter(
        (change) => JSON.stringify(change.before) !== JSON.stringify(change.next),
      );
    if (changes.length === 0) return;

    ctx.history.execute({
      label,
      do() {
        for (const change of changes) {
          const entity = ctx.locate(change.entityId)?.entity;
          if (!entity) continue;
          entity.materialOverrides = structuredClone(change.next);
          ctx.emit({ type: 'entity', entityId: change.entityId });
        }
        ctx.markDirty();
      },
      undo() {
        for (const change of changes) {
          const entity = ctx.locate(change.entityId)?.entity;
          if (!entity) continue;
          entity.materialOverrides = structuredClone(change.before);
          ctx.emit({ type: 'entity', entityId: change.entityId });
        }
      },
    });
  }

  function setComponents(id: string, components: PrefabComponent[]): void {
    const before = ctx.locate(id)?.entity.components;
    if (!before) return;
    const beforeCopy = structuredClone(before);
    const nextCopy = structuredClone(components);
    patchEntity(
      id,
      'Edit components',
      (entity) => {
        entity.components = structuredClone(nextCopy);
      },
      (entity) => {
        entity.components = structuredClone(beforeCopy);
      },
    );
  }

  function setTransform(id: string, transform: EntityTransform): void {
    const entity = ctx.locate(id)?.entity;
    if (!entity) return;
    const before = cloneTransform(entity);
    const after = cloneTransform(transform);
    ctx.history.execute({
      label: `Transform ${entity.name}`,
      do() {
        const target = ctx.locate(id)?.entity;
        if (!target) return;
        target.position = cloneVec(after.position);
        target.rotation = cloneVec(after.rotation);
        target.scale = cloneVec(after.scale);
        ctx.markDirty();
        ctx.emit({ type: 'transform', entityId: id });
      },
      undo() {
        const target = ctx.locate(id)?.entity;
        if (!target) return;
        target.position = cloneVec(before.position);
        target.rotation = cloneVec(before.rotation);
        target.scale = cloneVec(before.scale);
        ctx.emit({ type: 'transform', entityId: id });
      },
    });
  }
  ctx.renameEntity = renameEntity;
  ctx.setVisible = setVisible;
  ctx.setPrimitive = setPrimitive;
  ctx.setAsset = setAsset;
  ctx.setMaterialOverride = setMaterialOverride;
  ctx.setMaterialOverridesBatch = setMaterialOverridesBatch;
  ctx.setComponents = setComponents;
  ctx.setTransform = setTransform;
}
