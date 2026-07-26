export type SceneEditorTab =
  | 'scene'
  | 'material-manager'
  | 'ship'
  | 'base-characters'
  | 'planet-authoring'
  | 'system-map'
  | 'menu-manager'
  | 'server';

export const SCENE_EDITOR_TABS: ReadonlyArray<{ id: SceneEditorTab; label: string }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'material-manager', label: 'Material Manager' },
  { id: 'ship', label: 'Ship' },
  { id: 'base-characters', label: 'Base Characters' },
  { id: 'planet-authoring', label: 'Planet Authoring' },
  { id: 'system-map', label: 'System Map' },
  { id: 'menu-manager', label: 'Menu Manager' },
  { id: 'server', label: 'Server' },
];
