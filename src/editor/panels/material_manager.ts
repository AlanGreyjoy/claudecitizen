import * as THREE from 'three';
import type { EditorEntity, EditorStore } from '../document';
import { clearChildren, el } from '../dom';
import {
  MAIN_SURFACE_MATERIAL,
  PREFAB_PRIMITIVE_MATERIAL_NAME,
} from '../../render/materials/ship_material';
import { loadPrefabModel } from '../../render/prefabs/prefab_renderer';
import type { PrefabMaterialOverride } from '../../world/prefabs/schema';

export interface MaterialValues {
  color: string;
  emissive: string;
  emissiveIntensity: number;
  metalness: number;
  roughness: number;
  opacity: number;
}

export interface MaterialRow {
  entity: EditorEntity;
  source: 'Primitive' | 'Asset';
  material: string;
  displayName: string;
  base: MaterialValues;
  values: MaterialValues;
  overridden: boolean;
}

const DEFAULT_VALUES: MaterialValues = {
  color: '#ffffff',
  emissive: '#000000',
  emissiveIntensity: 0,
  metalness: MAIN_SURFACE_MATERIAL.metalness,
  roughness: MAIN_SURFACE_MATERIAL.roughness,
  opacity: 1,
};

function materialLabel(name: string): string {
  if (name === PREFAB_PRIMITIVE_MATERIAL_NAME) return 'Primitive';
  return name || '(unnamed material)';
}

function toHex(color: THREE.Color | undefined, fallback: string): string {
  return color ? `#${color.getHexString()}` : fallback;
}

function sampleMaterial(material: THREE.Material): MaterialValues {
  const standard = material as THREE.MeshStandardMaterial & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
  };
  return {
    color: toHex(standard.color, DEFAULT_VALUES.color),
    emissive: toHex(standard.emissive, DEFAULT_VALUES.emissive),
    emissiveIntensity:
      typeof standard.emissiveIntensity === 'number'
        ? standard.emissiveIntensity
        : DEFAULT_VALUES.emissiveIntensity,
    metalness:
      typeof standard.metalness === 'number'
        ? standard.metalness
        : DEFAULT_VALUES.metalness,
    roughness:
      typeof standard.roughness === 'number'
        ? standard.roughness
        : DEFAULT_VALUES.roughness,
    opacity:
      typeof material.opacity === 'number' ? material.opacity : DEFAULT_VALUES.opacity,
  };
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function applyOverride(
  base: MaterialValues,
  override: PrefabMaterialOverride | undefined,
): MaterialValues {
  if (!override) return { ...base };
  return {
    color: override.color ?? base.color,
    emissive: override.emissive ?? base.emissive,
    emissiveIntensity: override.emissiveIntensity ?? base.emissiveIntensity,
    metalness: override.metalness ?? base.metalness,
    roughness: override.roughness ?? base.roughness,
    opacity: override.opacity ?? base.opacity,
  };
}

function overrideFor(
  entity: EditorEntity,
  material: string,
): PrefabMaterialOverride | undefined {
  return entity.materialOverrides.find((entry) => entry.material === material);
}

function valuesToOverride(
  material: string,
  values: MaterialValues,
): PrefabMaterialOverride {
  return {
    material,
    color: values.color,
    emissive: values.emissive,
    emissiveIntensity: values.emissiveIntensity,
    metalness: values.metalness,
    roughness: values.roughness,
    opacity: values.opacity,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function formatMaterialNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function visitEntities(entities: readonly EditorEntity[], visit: (entity: EditorEntity) => void): void {
  for (const entity of entities) {
    visit(entity);
    visitEntities(entity.children, visit);
  }
}

export async function collectMaterialRowsForEntity(
  entity: EditorEntity,
  options: { nodeName?: string | null } = {},
): Promise<MaterialRow[]> {
  const rows: MaterialRow[] = [];
  const { nodeName = null } = options;
  if (entity.primitive && !nodeName) {
    const base: MaterialValues = {
      ...DEFAULT_VALUES,
      color: entity.primitive.color ?? '#4c5663',
    };
    const material = PREFAB_PRIMITIVE_MATERIAL_NAME;
    const override = overrideFor(entity, material);
    rows.push({
      entity,
      source: 'Primitive',
      material,
      displayName: materialLabel(material),
      base,
      values: applyOverride(base, override),
      overridden: Boolean(override),
    });
  }

  if (!entity.asset) return rows;
  try {
    const model = await loadPrefabModel(entity.asset.url);
    const materialRoot = nodeName ? model.getObjectByName(nodeName) : model;
    if (!materialRoot) return rows;
    const byMaterial = new Map<string, THREE.Material>();
    materialRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of materialList(object.material)) {
        const name = material.name;
        if (!byMaterial.has(name)) byMaterial.set(name, material);
      }
    });
    for (const [material, sample] of byMaterial.entries()) {
      const base = sampleMaterial(sample);
      const override = overrideFor(entity, material);
      rows.push({
        entity,
        source: 'Asset',
        material,
        displayName: materialLabel(material),
        base,
        values: applyOverride(base, override),
        overridden: Boolean(override),
      });
    }
  } catch {
    rows.push({
      entity,
      source: 'Asset',
      material: '',
      displayName: '(failed to load)',
      base: { ...DEFAULT_VALUES },
      values: { ...DEFAULT_VALUES },
      overridden: false,
    });
  }

  return rows;
}

async function collectRows(store: EditorStore): Promise<MaterialRow[]> {
  const rows: MaterialRow[] = [];
  const entities: EditorEntity[] = [];
  visitEntities(store.getState().roots, (entity) => entities.push(entity));

  await Promise.all(
    entities.map(async (entity) => {
      rows.push(...(await collectMaterialRowsForEntity(entity)));
    }),
  );

  rows.sort((a, b) => {
    const entityCompare = a.entity.name.localeCompare(b.entity.name);
    if (entityCompare !== 0) return entityCompare;
    return a.displayName.localeCompare(b.displayName);
  });
  return rows;
}

export function createMaterialManagerPanel(host: HTMLElement, store: EditorStore): void {
  let generation = 0;

  function commit(row: MaterialRow, values: MaterialValues): void {
    store.setMaterialOverride(
      row.entity.id,
      row.material,
      valuesToOverride(row.material, values),
    );
  }

  function colorInput(
    row: MaterialRow,
    key: 'color' | 'emissive',
  ): HTMLInputElement {
    const input = el('input', {
      className: 'ed-material-color',
      attrs: { type: 'color', value: row.values[key] },
      on: {
        change: () => {
          commit(row, { ...row.values, [key]: input.value });
        },
      },
    });
    return input;
  }

  function numberInput(
    row: MaterialRow,
    key: 'metalness' | 'roughness' | 'opacity' | 'emissiveIntensity',
    max: number,
  ): HTMLInputElement {
    const input = el('input', {
      className: 'ed-input ed-material-number',
      attrs: {
        type: 'number',
        min: '0',
        max: String(max),
        step: '0.01',
        value: formatMaterialNumber(row.values[key]),
      },
      on: {
        change: () => {
          commit(row, {
            ...row.values,
            [key]: clamp(Number(input.value), 0, max),
          });
        },
      },
    });
    return input;
  }

  function renderRow(row: MaterialRow): HTMLElement {
    const resetBtn = el('button', {
      className: 'ed-btn ed-material-reset',
      text: 'Reset',
      attrs: { type: 'button' },
      on: {
        click: () => store.setMaterialOverride(row.entity.id, row.material, null),
      },
    });
    resetBtn.disabled = !row.overridden;

    return el('div', { className: 'ed-material-row' }, [
      el('div', { className: 'ed-material-name' }, [
        el('span', { className: 'ed-material-title', text: row.displayName }),
        el('span', {
          className: 'ed-material-subtitle',
          text: `${row.entity.name} · ${row.source}`,
        }),
      ]),
      el('label', { className: 'ed-material-field' }, [
        el('span', { text: 'Color' }),
        colorInput(row, 'color'),
      ]),
      el('label', { className: 'ed-material-field' }, [
        el('span', { text: 'Metal' }),
        numberInput(row, 'metalness', 1),
      ]),
      el('label', { className: 'ed-material-field' }, [
        el('span', { text: 'Rough' }),
        numberInput(row, 'roughness', 1),
      ]),
      el('label', { className: 'ed-material-field' }, [
        el('span', { text: 'Alpha' }),
        numberInput(row, 'opacity', 1),
      ]),
      el('label', { className: 'ed-material-field' }, [
        el('span', { text: 'Glow' }),
        colorInput(row, 'emissive'),
      ]),
      el('label', { className: 'ed-material-field' }, [
        el('span', { text: 'Power' }),
        numberInput(row, 'emissiveIntensity', 20),
      ]),
      el('div', { className: 'ed-material-actions' }, [resetBtn]),
    ]);
  }

  async function render(): Promise<void> {
    const current = ++generation;
    clearChildren(host);
    host.append(
      el('div', { className: 'ed-material-toolbar' }, [
        el('div', { className: 'ed-material-toolbar-title', text: 'Materials' }),
        el('div', { className: 'ed-material-toolbar-status', text: 'Loading' }),
      ]),
      el('div', { className: 'ed-material-list' }),
    );
    const list = host.querySelector<HTMLElement>('.ed-material-list');
    const status = host.querySelector<HTMLElement>('.ed-material-toolbar-status');
    if (!list || !status) return;

    const rows = await collectRows(store);
    if (current !== generation) return;

    clearChildren(list);
    status.textContent = `${rows.length} material${rows.length === 1 ? '' : 's'}`;
    if (rows.length === 0) {
      list.append(el('div', { className: 'ed-material-empty', text: 'No materials' }));
      return;
    }
    for (const row of rows) list.append(renderRow(row));
  }

  store.subscribe((event) => {
    if (
      event.type === 'document' ||
      event.type === 'structure' ||
      event.type === 'entity'
    ) {
      void render();
    }
  });

  void render();
}
