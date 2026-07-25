import { type ReactElement } from 'react';
import type { EditorStore } from '../../document';
import type { PrefabComponent } from '../../../world/prefabs/schema';
import { buildInspectorComponentFields } from '../../panels/inspector_component_fields_dom';
import type {
  ComponentFieldOptions,
  InspectorPanelOptions,
} from '../../panels/inspector_logic';
import { ImperativeHost } from '../ImperativeHost';

export type ComponentFieldsProps = {
  store: EditorStore;
  component: PrefabComponent;
  update: (next: PrefabComponent) => void;
  fieldOptions?: ComponentFieldOptions;
  options: InspectorPanelOptions;
};

/**
 * Intentional ImperativeHost leftover: dense per-component field graphs
 * (including particle-system → `particle_fields.ts`) mount via
 * `buildInspectorComponentFields` so behavior stays complete through the
 * React panel transition. Panel chrome, transforms, materials, components
 * list shell, and add-component are React in `InspectorPanel.tsx`.
 */
export function ComponentFields({
  store,
  component,
  update,
  fieldOptions,
  options,
}: ComponentFieldsProps): ReactElement {
  return (
    <ImperativeHost
      mount={(host) => {
        const fields = buildInspectorComponentFields(
          store,
          component,
          update,
          options,
          fieldOptions,
        );
        host.append(...fields);
      }}
      deps={[
        JSON.stringify(component),
        fieldOptions?.hideColliderNodeField,
        fieldOptions?.entityId,
        JSON.stringify(fieldOptions?.colliderNodeBounds ?? null),
        options.audioPreview,
        options.particlePreview,
        options.onToggleShipDoorPreview,
      ]}
    />
  );
}
