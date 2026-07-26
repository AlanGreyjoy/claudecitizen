import { useState, type ReactElement } from 'react';
import {
  GLB_NODE_DND_TYPE,
  parseDraggedGlbNode,
} from '../../../panels/hierarchy-logic';
import type { EditorStore } from '../../../document';
import { EmptyNote, RemoveButton, SectionLabel } from '../InspectorForm';

export type ColliderExcludeNodesProps = {
  store: EditorStore;
  nodes: readonly string[];
  onChange: (next: string[] | undefined) => void;
};

/**
 * Nodes carved out of a mesh collider bake, subtree included.
 *
 * A mesh collider swallows every child it can reach — usually what you want,
 * but it is also how a closed door ends up welded into the hull. Drag GLB
 * nodes from the hierarchy in here to keep them out. Door and ramp nodes are
 * excluded automatically; this list is for everything else (geometry you
 * should walk through, parts that carry their own collider).
 */
export function ColliderExcludeNodes({
  store,
  nodes,
  onChange,
}: ColliderExcludeNodesProps): ReactElement {
  const [dropActive, setDropActive] = useState(false);

  const removeNode = (name: string): void => {
    const next = nodes.filter((entry) => entry !== name);
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <>
      <SectionLabel>Exclude from bake</SectionLabel>
      <div
        className={`ed-collider-exclude-drop${dropActive ? ' is-drop-target' : ''}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(GLB_NODE_DND_TYPE)) return;
          event.preventDefault();
          event.stopPropagation();
          // Must match the hierarchy row's `effectAllowed = 'move'`. A
          // mismatched dropEffect makes the browser refuse the drop outright
          // and no drop event ever fires.
          event.dataTransfer.dropEffect = 'move';
          setDropActive(true);
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes(GLB_NODE_DND_TYPE)) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(event) => {
          setDropActive(false);
          const dragged = parseDraggedGlbNode(
            event.dataTransfer.getData(GLB_NODE_DND_TYPE),
          );
          if (!dragged) return;
          event.preventDefault();
          event.stopPropagation();
          const name = store.getGlbNodeName(dragged.entityId, dragged.nodeUuid);
          if (name && !nodes.includes(name)) onChange([...nodes, name]);
        }}
      >
        Drag GLB nodes here
      </div>
      {nodes.length === 0 ? (
        <EmptyNote>Everything under this collider is baked solid.</EmptyNote>
      ) : (
        <ul className="ed-collider-exclude-list">
          {nodes.map((name) => (
            <li key={name} className="ed-collider-exclude-item">
              <span className="ed-collider-exclude-name" title={name}>
                {name}
              </span>
              <RemoveButton
                title={`Bake "${name}" into this collider again`}
                onClick={() => removeNode(name)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
