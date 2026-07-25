import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import {
  createBaseCharacterEquipmentEditor,
  type BaseCharacterEquipmentEditor,
} from '../../../render/editor/base-character-equipment-editor';
import { BaseCharactersInspector } from './base_characters/BaseCharactersInspector';
import { BaseCharactersSidebar } from './base_characters/BaseCharactersSidebar';

export type { BaseCharacterEquipmentEditor };

type BaseCharactersPanelProps = {
  hidden: boolean;
  onReady: (editor: BaseCharacterEquipmentEditor | null) => void;
};

function createDockHost(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

export const BaseCharactersPanel = forwardRef<BaseCharacterEquipmentEditor, BaseCharactersPanelProps>(
  function BaseCharactersPanel({ hidden, onReady }, ref): ReactElement {
    const [, requestRender] = useReducer((count: number) => count + 1, 0);
    const [editor, setEditor] = useState<BaseCharacterEquipmentEditor | null>(null);
    const stageHostRef = useRef<HTMLDivElement>(null);
    const leftHostRef = useRef<HTMLDivElement | null>(null);
    const rightHostRef = useRef<HTMLDivElement | null>(null);

    // Hold the latest onReady in a ref so the WebGL editor is created exactly
    // once. If onReady were an effect dependency, an unstable parent callback
    // would recreate the WebGLRenderer on every render — an infinite
    // create/dispose loop that leaks WebGL contexts.
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    if (leftHostRef.current === null) {
      leftHostRef.current = createDockHost('ed-base-sidebar');
    }
    if (rightHostRef.current === null) {
      rightHostRef.current = createDockHost('ed-base-sidebar ed-base-inspector');
    }

    useEffect(() => {
      const stageHost = stageHostRef.current;
      const leftHost = leftHostRef.current;
      const rightHost = rightHostRef.current;
      if (!stageHost || !leftHost || !rightHost) return;

      const created = createBaseCharacterEquipmentEditor({
        stageHost,
        leftHost,
        rightHost,
        onUiChange: () => requestRender(),
      });
      setEditor(created);
      onReadyRef.current(created);

      return () => {
        created.dispose();
        setEditor(null);
        onReadyRef.current(null);
      };
    }, []);

    useImperativeHandle(ref, () => editor!, [editor]);

    useEffect(() => {
      return () => {
        leftHostRef.current?.remove();
        rightHostRef.current?.remove();
      };
    }, []);

    const uiApi = editor?.getUiApi() ?? null;
    const leftHost = leftHostRef.current;
    const rightHost = rightHostRef.current;

    return (
      <>
        <div
          className={`ed-scene-panel ed-base-characters ed-base-character-editor${
            hidden ? ' is-hidden' : ''
          }`}
        >
          <div ref={stageHostRef} className="ed-base-stage-host" />
        </div>
        {uiApi && leftHost
          ? createPortal(<BaseCharactersSidebar api={uiApi} />, leftHost)
          : null}
        {uiApi && rightHost
          ? createPortal(<BaseCharactersInspector api={uiApi} />, rightHost)
          : null}
      </>
    );
  },
);
