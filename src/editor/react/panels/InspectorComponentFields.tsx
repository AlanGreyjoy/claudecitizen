import { useMemo, type ReactElement } from 'react';
import type { EditorStore } from '../../document';
import type { PrefabComponent } from '../../../world/prefabs/schema';
import type {
  ComponentFieldOptions,
  InspectorPanelOptions,
} from '../../panels/inspector-logic';
import { renderComponentFields } from './component_fields/Registry';
import type { ComponentFieldContext } from './component_fields/context';

export type ComponentFieldsProps = {
  store: EditorStore;
  component: PrefabComponent;
  update: (next: PrefabComponent) => void;
  fieldOptions?: ComponentFieldOptions;
  options: InspectorPanelOptions;
};

export function ComponentFields({
  store,
  component,
  update,
  fieldOptions,
  options,
}: ComponentFieldsProps): ReactElement | null {
  const ctx = useMemo<ComponentFieldContext>(
    () => ({
      store,
      update,
      options,
      fieldOptions,
    }),
    [store, update, options, fieldOptions],
  );

  return renderComponentFields(ctx, component);
}
