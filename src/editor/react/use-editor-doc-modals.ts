import { useState } from 'react';

/**
 * Open state for document/project dialogs owned by the editor shell.
 * Keeps `EditorApp` under the function size ceiling.
 */
export function useEditorDocModals() {
  const [sceneSettingsOpen, setSceneSettingsOpen] = useState(false);
  const [prefabSettingsOpen, setPrefabSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [newSceneOpen, setNewSceneOpen] = useState(false);
  const [newPrefabOpen, setNewPrefabOpen] = useState(false);
  return {
    sceneSettingsOpen,
    setSceneSettingsOpen,
    prefabSettingsOpen,
    setPrefabSettingsOpen,
    projectSettingsOpen,
    setProjectSettingsOpen,
    newSceneOpen,
    setNewSceneOpen,
    newPrefabOpen,
    setNewPrefabOpen,
  };
}

export type EditorDocModals = ReturnType<typeof useEditorDocModals>;
