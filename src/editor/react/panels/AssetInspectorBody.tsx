import type { ReactElement } from 'react';
import { PROJECT_ASSET_ROOT } from '../../api';
import {
  assetInspectorTypeLabel,
  fileNameFromPath,
  formatAssetByteSize,
  formatAssetModifiedAt,
  isPrefabPath,
  prefabIdFromPath,
  type AssetInspectorItem,
} from '../../panels/project-logic';
import { EmptyNote, FieldRow } from './InspectorForm';

export type AssetInspectorBodyProps = {
  items: readonly AssetInspectorItem[];
  onOpenPrefab?: (prefabId: string) => void;
};

function AssetPropertyFields({ item }: { item: AssetInspectorItem }): ReactElement {
  const name = fileNameFromPath(item.path) || item.path;
  const displayPath = `${PROJECT_ASSET_ROOT}/${item.path}`;
  return (
    <div className="ed-section">
      <FieldRow label="Name" wide>
        <span className="ed-field-value-static" title={name}>
          {name}
        </span>
      </FieldRow>
      <FieldRow label="Path" wide>
        <span className="ed-field-value-static ed-asset-inspector-path" title={displayPath}>
          {displayPath}
        </span>
      </FieldRow>
      <FieldRow label="Type" wide>
        <span className="ed-field-value-static">{assetInspectorTypeLabel(item)}</span>
      </FieldRow>
      {item.kind === 'file' ? (
        <>
          <FieldRow label="Size" wide>
            <span className="ed-field-value-static">{formatAssetByteSize(item.size)}</span>
          </FieldRow>
          <FieldRow label="Modified" wide>
            <span className="ed-field-value-static">
              {formatAssetModifiedAt(item.modifiedAtMs)}
            </span>
          </FieldRow>
        </>
      ) : null}
    </div>
  );
}

export function AssetInspectorBody({
  items,
  onOpenPrefab,
}: AssetInspectorBodyProps): ReactElement {
  if (items.length === 0) {
    return <EmptyNote>No asset selected.</EmptyNote>;
  }

  if (items.length > 1) {
    return (
      <div className="ed-section">
        <EmptyNote>{items.length} assets selected</EmptyNote>
        <ul className="ed-asset-inspector-list">
          {items.map((item) => (
            <li key={item.path} title={`${PROJECT_ASSET_ROOT}/${item.path}`}>
              {fileNameFromPath(item.path) || item.path}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const item = items[0]!;
  const canOpenPrefab = item.kind === 'file' && isPrefabPath(item.path) && onOpenPrefab;

  return (
    <>
      <AssetPropertyFields item={item} />
      {canOpenPrefab ? (
        <div className="ed-section">
          <button
            type="button"
            className="ed-btn"
            onClick={() => onOpenPrefab(prefabIdFromPath(item.path))}
          >
            Open Prefab
          </button>
        </div>
      ) : null}
    </>
  );
}
