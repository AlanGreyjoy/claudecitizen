export type SceneEditorTab =
  | 'scene'
  | 'material-manager'
  | 'ship'
  | 'base-characters'
  | 'planets'
  | 'stations'
  | 'star-map'
  // Legacy ids remain valid for HMR snapshots and previously bookmarked URLs.
  | 'planet-authoring'
  | 'system-map'
  | 'menu-manager'
  | 'server';

export const SCENE_EDITOR_TABS: ReadonlyArray<{ id: SceneEditorTab; label: string }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'material-manager', label: 'Material Manager' },
  { id: 'ship', label: 'Ship' },
  { id: 'base-characters', label: 'Base Characters' },
  { id: 'planets', label: 'Planets' },
  { id: 'stations', label: 'Stations' },
  { id: 'star-map', label: 'Star Map' },
  { id: 'menu-manager', label: 'Menu Manager' },
  { id: 'server', label: 'Server' },
];
