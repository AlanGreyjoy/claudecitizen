import type { EditorStore } from "../document";
import type { PrefabComponent } from "../../world/prefabs/schema";
import type {
  ComponentFieldOptions,
  InspectorPanelOptions,
} from "./inspector_logic";
import type { ComponentFieldBuildContext } from "./inspector_component_fields_dom/context";
import { COMPONENT_FIELD_BUILDERS } from "./inspector_component_fields_dom/registry";

/** Imperative field builders for inspector component editors (mounted via ImperativeHost). */
export function buildInspectorComponentFields(
  store: EditorStore,
  component: PrefabComponent,
  update: (next: PrefabComponent) => void,
  options: InspectorPanelOptions,
  fieldOptions?: ComponentFieldOptions,
): HTMLElement[] {
  const ctx: ComponentFieldBuildContext = {
    store,
    update,
    options,
    fieldOptions,
  };
  const builder = COMPONENT_FIELD_BUILDERS[component.type];
  return builder ? builder(ctx, component) : [];
}
