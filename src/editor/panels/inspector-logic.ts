import type { EditorEntity, EditorStore, EntityTransform } from '../document';
import type { PrefabComponent } from '../../world/prefabs/schema';
import type { StationFloorId } from '../../world/station';
import type { Vec3 } from '../../types';
import type { EditorAudioPreviewController } from '../audio-preview';
import type { ParticlePreviewControls } from './particle-preview';
import type { NodeBounds } from '../component-actions';
import type { AssetInspectorItem } from './project-logic';

export const FLOOR_OPTIONS: StationFloorId[] = ['hab', 'lobby', 'hangar'];

const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.m4a'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.ktx'];
const MODEL_EXTENSIONS = ['.glb', '.gltf'];

export function isAudioAssetUrl(url: string): boolean {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

export function isImageAssetUrl(url: string): boolean {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

export function isModelAssetUrl(url: string): boolean {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  return MODEL_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

export function parseDraggedEntityIds(data: string): string[] {
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    // Legacy single-id payload.
  }
  return [data];
}

export function findEntityById(
  roots: EditorEntity[],
  id: string,
): EditorEntity | null {
  for (const entity of roots) {
    if (entity.id === id) return entity;
    const nested = findEntityById(entity.children, id);
    if (nested) return nested;
  }
  return null;
}

export function formatInspectorNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function collectAnimationIds(roots: EditorEntity[]): string[] {
  const ids: string[] = [];
  const visit = (entities: EditorEntity[]) => {
    for (const entity of entities) {
      for (const comp of entity.components) {
        if (comp.type === 'animation' && comp.id) {
          ids.push(comp.id);
        }
      }
      visit(entity.children);
    }
  };
  visit(roots);
  return ids;
}

export type ListedComponent = {
  component: PrefabComponent;
  source: 'node' | 'entity';
  /** Index in nodeOverrideComponents or entity.components */
  index: number;
};

export function listInspectorComponents(
  store: EditorStore,
  entity: EditorEntity,
): {
  isNodeContext: boolean;
  subNodeName: string | null;
  nodeOverrideComponents: PrefabComponent[];
  listed: ListedComponent[];
} {
  const sub = store.getSubSelection();
  const subNodeName =
    sub && sub.entityId === entity.id
      ? store.getGlbNodeName(entity.id, sub.nodeUuid)
      : null;

  const isNodeContext = Boolean(subNodeName && entity.asset);
  const nodeOverrideComponents = isNodeContext
    ? store.getNodeOverrideComponents(entity.id, subNodeName!)
    : [];

  const listed: ListedComponent[] = [];
  if (isNodeContext && subNodeName) {
    nodeOverrideComponents.forEach((component, index) => {
      listed.push({ component, source: 'node', index });
    });
    entity.components.forEach((component, index) => {
      const targetsNode =
        (component.type === 'object-animation' ||
          component.type === 'animation' ||
          component.type === 'ship-door' ||
          component.type === 'door') &&
        (component.nodes ?? []).some((node) => node.name === subNodeName);
      if (targetsNode) {
        listed.push({ component, source: 'entity', index });
      }
    });
  } else {
    entity.components.forEach((component, index) => {
      listed.push({ component, source: 'entity', index });
    });
  }

  return { isNodeContext, subNodeName, nodeOverrideComponents, listed };
}

export type ComponentFieldOptions = {
  hideColliderNodeField?: boolean;
  colliderNodeBounds?: NodeBounds | null;
  entityId?: string;
};

export interface InspectorPanelOptions {
  audioPreview: EditorAudioPreviewController;
  particlePreview?: ParticlePreviewControls;
  getGlbNodeLocalTransform?: (
    entityId: string,
    nodeUuid: string,
  ) => EntityTransform | null;
  setGlbNodeLocalTransform?: (
    entityId: string,
    nodeUuid: string,
    transform: Partial<EntityTransform>,
  ) => void;
  getGlbNodeBounds?: (
    entityId: string,
    nodeUuid: string,
  ) => { min: Vec3; max: Vec3 } | null;
  /** Toggle ship-door / animation open preview in the viewport. */
  onToggleShipDoorPreview?: (doorId: string) => void;
  /** Play the boarding ramp raise / lower in the viewport. */
  onPlayShipRampPreview?: () => void;
  /** Play the cockpit canopy open / close in the viewport. */
  onPlayShipCanopyPreview?: () => void;
  /** Jump to a material row in the Material Manager tab. */
  onOpenMaterial?: (target: { entityId: string; material: string }) => void;
  /** Project asset-grid selection; when non-empty, inspector shows asset properties. */
  assetFocus?: readonly AssetInspectorItem[];
  /** Open a prefab document from the asset inspector. */
  onOpenPrefab?: (prefabId: string) => void;
}

export type TransformFieldKey = 'position' | 'rotation' | 'scale';

export const ENTITY_TRANSFORM_ROWS: ReadonlyArray<{
  key: TransformFieldKey;
  label: string;
  step: number;
}> = [
  { key: 'position', label: 'Position', step: 0.25 },
  { key: 'rotation', label: 'Rotation°', step: 5 },
  { key: 'scale', label: 'Scale', step: 0.1 },
];

export const GLB_TRANSFORM_ROWS: ReadonlyArray<{
  key: TransformFieldKey;
  label: string;
  step: number;
}> = [
  { key: 'position', label: 'Position', step: 0.01 },
  { key: 'rotation', label: 'Rotation°', step: 1 },
  { key: 'scale', label: 'Scale', step: 0.01 },
];

export const STORE_EVENTS = [
  'selection',
  'sub-selection',
  'document',
  'structure',
  'entity',
  'glb-components',
] as const;
