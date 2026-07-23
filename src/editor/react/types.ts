export type SceneEditorTab =
  | 'scene'
  | 'character-preview'
  | 'material-manager'
  | 'base-characters'
  | 'planet-authoring'
  | 'system-map'
  | 'menu-manager';

export const SCENE_EDITOR_TABS: ReadonlyArray<{ id: SceneEditorTab; label: string }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'character-preview', label: 'Character Preview' },
  { id: 'material-manager', label: 'Material Manager' },
  { id: 'base-characters', label: 'Base Characters' },
  { id: 'planet-authoring', label: 'Planet Authoring' },
  { id: 'system-map', label: 'System Map' },
  { id: 'menu-manager', label: 'Menu Manager' },
];
