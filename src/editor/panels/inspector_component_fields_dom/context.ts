import type { EditorStore } from "../../document";
import type { PrefabComponent } from "../../../world/prefabs/schema";
import type {
  ComponentFieldOptions,
  InspectorPanelOptions,
} from "../inspector_logic";

export type ComponentFieldBuildContext = {
  store: EditorStore;
  update: (next: PrefabComponent) => void;
  options: InspectorPanelOptions;
  fieldOptions?: ComponentFieldOptions;
};
