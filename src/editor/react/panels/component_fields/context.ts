import type { EditorStore } from '../../../document';
import type { PrefabComponent } from '../../../../world/prefabs/schema';
import type {
  ComponentFieldOptions,
  InspectorPanelOptions,
} from '../../../panels/inspector-logic';

export type ComponentFieldContext = {
  store: EditorStore;
  update: (next: PrefabComponent) => void;
  options: InspectorPanelOptions;
  fieldOptions?: ComponentFieldOptions;
};

export type ComponentFieldsProps<T extends PrefabComponent = PrefabComponent> = {
  ctx: ComponentFieldContext;
  component: T;
};
