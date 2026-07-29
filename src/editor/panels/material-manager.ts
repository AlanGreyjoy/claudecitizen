import * as THREE from 'three';
import type { EditorEntity, EditorStore } from '../document';
import {
  MAIN_SURFACE_MATERIAL,
  PREFAB_PRIMITIVE_MATERIAL_NAME,
} from '../../render/materials/ship-material';
import { loadPrefabModel } from '../../render/prefabs/prefab-renderer';
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
  /**
   * The asset's own material, straight off the shared GLB cache. The preview
   * clones it so authored texture maps show up — never mutate it, every
   * instance of that model points at the same object.
   */
  sample: THREE.Material | null;
  /** Which texture maps the asset material carries, for the inspector badges. */
  maps: readonly string[];
}

const MAP_LABELS: ReadonlyArray<[keyof THREE.MeshStandardMaterial, string]> = [
  ['map', 'Base'],
  ['normalMap', 'Normal'],
  ['roughnessMap', 'Rough'],
  ['metalnessMap', 'Metal'],
  ['aoMap', 'AO'],
  ['emissiveMap', 'Emissive'],
  ['alphaMap', 'Alpha'],
];

function describeMaterialMaps(material: THREE.Material | null): string[] {
  if (!material) return [];
  const standard = material as THREE.MeshStandardMaterial;
  return MAP_LABELS.filter(([key]) => Boolean(standard[key])).map(
    ([, label]) => label,
  );
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

export function valuesToOverride(
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

export function clampMaterialNumber(value: number, min: number, max: number): number {
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
      sample: null,
      maps: [],
    });
  }

  if (!entity.asset) return rows;
  try {
    const model = await loadPrefabModel(entity.asset.url, { pin: true });
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
        sample,
        maps: describeMaterialMaps(sample),
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
      sample: null,
      maps: [],
    });
  }

  return rows;
}

export async function collectRows(store: EditorStore): Promise<MaterialRow[]> {
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
