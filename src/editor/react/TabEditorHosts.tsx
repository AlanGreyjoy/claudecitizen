import { useEffect, useRef, type ReactElement } from 'react';
import {
  createBaseCharacterEquipmentEditor,
  type BaseCharacterEquipmentEditor,
} from '../../render/editor/base_character_equipment_editor';
import {
  createMenuManagerEditor,
  type MenuManagerEditor,
} from '../panels/menu_manager';
import {
  createPlanetAuthoringEditor,
  type PlanetAuthoringEditor,
} from '../panels/planet_authoring';
import {
  createSystemMapEditor,
  type SystemMapEditor,
} from '../panels/system_map';
import type { SceneEditorTab } from './types';

export type TabEditorHandles = {
  baseCharacterEditor: BaseCharacterEquipmentEditor | null;
  planetAuthoringEditor: PlanetAuthoringEditor | null;
  systemMapEditor: SystemMapEditor | null;
  menuManagerEditor: MenuManagerEditor | null;
};

type TabEditorHostsProps = {
  tab: SceneEditorTab;
  onHandles: (handles: TabEditorHandles) => void;
};

/**
 * Imperative tab editors (Three/canvas + dense forms). React owns visibility /
 * activate lifecycle; factories stay in their modules.
 */
export function TabEditorHosts({ tab, onHandles }: TabEditorHostsProps): ReactElement {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const planetRef = useRef<HTMLDivElement | null>(null);
  const systemRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const handlesRef = useRef<TabEditorHandles>({
    baseCharacterEditor: null,
    planetAuthoringEditor: null,
    systemMapEditor: null,
    menuManagerEditor: null,
  });

  // Eager mount so Project → Anims can load clips without waiting for the first tab visit.
  useEffect(() => {
    const host = baseRef.current;
    if (!host) return;
    const editor = createBaseCharacterEquipmentEditor(host);
    handlesRef.current.baseCharacterEditor = editor;
    onHandles({ ...handlesRef.current });
    return () => {
      editor.dispose();
      handlesRef.current.baseCharacterEditor = null;
      onHandles({ ...handlesRef.current });
    };
  }, [onHandles]);

  useEffect(() => {
    const h = handlesRef.current;
    if (tab === 'base-characters') {
      h.baseCharacterEditor?.activate();
    } else {
      h.baseCharacterEditor?.deactivate();
    }

    if (tab === 'planet-authoring') {
      const host = planetRef.current;
      if (host) {
        h.planetAuthoringEditor ??= createPlanetAuthoringEditor(host);
        h.planetAuthoringEditor.activate();
      }
    } else {
      h.planetAuthoringEditor?.deactivate();
    }

    if (tab === 'system-map') {
      const host = systemRef.current;
      if (host) {
        h.systemMapEditor ??= createSystemMapEditor(host);
        h.systemMapEditor.activate();
      }
    } else {
      h.systemMapEditor?.deactivate();
    }

    if (tab === 'menu-manager') {
      const host = menuRef.current;
      if (host) {
        h.menuManagerEditor ??= createMenuManagerEditor(host);
        h.menuManagerEditor.activate();
      }
    } else {
      h.menuManagerEditor?.deactivate();
    }

    onHandles({ ...h });
  }, [tab, onHandles]);

  useEffect(() => {
    return () => {
      const h = handlesRef.current;
      h.baseCharacterEditor?.deactivate();
      h.planetAuthoringEditor?.deactivate();
      h.systemMapEditor?.deactivate();
      h.menuManagerEditor?.deactivate();
    };
  }, []);

  return (
    <>
      <div
        ref={baseRef}
        className={`ed-scene-panel ed-base-characters ed-base-character-editor${
          tab !== 'base-characters' ? ' is-hidden' : ''
        }`}
      />
      <div
        ref={planetRef}
        className={`ed-scene-panel ed-planet-authoring-host${
          tab !== 'planet-authoring' ? ' is-hidden' : ''
        }`}
      />
      <div
        ref={systemRef}
        className={`ed-scene-panel ed-system-map-host${
          tab !== 'system-map' ? ' is-hidden' : ''
        }`}
      />
      <div
        ref={menuRef}
        className={`ed-scene-panel ed-menu-manager-host${
          tab !== 'menu-manager' ? ' is-hidden' : ''
        }`}
      />
    </>
  );
}
