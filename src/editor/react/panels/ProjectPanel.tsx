import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ASSET_DND_TYPE,
  ASSET_MOVE_DND_TYPE,
  ENTITY_DND_TYPE,
  PREFAB_DND_TYPE,
  assetUrlFor,
  createAssetFolder,
  deleteAssetEntry,
  fetchFolderOrder,
  moveAssetEntry,
  PROJECT_ASSET_ROOT,
  saveFolderOrder,
  type AssetEntry,
  type FolderOrderMap,
} from '../../api';
import { showConfirmDialog, showContextMenu, showPromptDialog, showToast } from '../../dom';
import type { EditorAudioPreviewController } from '../../audio-preview';
import {
  applyFolderMoveToOrder,
  assetCardKind,
  assetCardTitle,
  assetVersionOf,
  buildFolderTree,
  canCreateItemPrefabFromPath,
  canDropRelativeTo,
  canMoveInto,
  collectFolderFiles,
  collectImmediateChildFolders,
  DEFAULT_EXPANDED_FOLDERS,
  emptyFolderNode,
  emptyNoteForFolder,
  expandAncestorsInto,
  fetchProjectAssetEntries,
  fileNameFromPath,
  findFolder,
  folderBreadcrumbs,
  folderDropZoneFromOffset,
  insertChildInOrder,
  isDraggableAssetPath,
  isPrefabPath,
  isValidAssetEntryName,
  joinFolderPath,
  parentFolderOfPath,
  parseAssetMovePayload,
  prefabIdFromPath,
  PROJECT_ROOT_LABEL,
  remapFolderPath,
  removeChildFromOrder,
  setParentOrder,
  siblingOrderAfterDrop,
  sortedFolderChildren,
  type AssetCardKind,
  type AssetMoveDragPayload,
  type FolderDropZone,
  type FolderNode,
} from '../../panels/project-logic';
import { parseDraggedEntityIds } from '../../panels/hierarchy-logic';
import {
  attachColumnSplitter,
  PANEL_SIZE_BOUNDS,
  restoreProjectSideWidth,
} from '../../panel-resize';
import { UiIcons } from '../../../ui/icons';
import { UiIcon } from '../UiIcon';
import { ConsolePanel } from './ConsolePanel';

export interface ProjectPanelOptions {
  /** Render a thumbnail data-url for a model asset (provided by render/editor). */
  getModelThumbnail: (url: string, assetVersion?: string) => Promise<string>;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
  /** Open a prefab document for editing (double-click on a prefab card). */
  onOpenPrefab: (prefabId: string) => void;
  /**
   * Save dragged Hierarchy GameObjects as prefabs in `folder`. Resolves to the
   * ids that were written so the panel can reveal them.
   */
  onCreatePrefabsInFolder: (entityIds: string[], folder: string) => Promise<string[]>;
  audioPreview: EditorAudioPreviewController;
}

export interface ProjectPanelHandle {
  /** Select and expand a folder path in the Project tree (e.g. `protected/animations`). */
  selectFolder: (folderPath: string) => void;
  /** Re-read the project asset listing. There is no filesystem watcher. */
  refresh: () => Promise<void>;
}

export type ProjectPanelProps = ProjectPanelOptions;

type BottomLeftTab = 'project' | 'console';
type FolderScope = 'this-folder' | 'all-subfolders';

/** Drop kinds a Project folder accepts. */
type FolderDropKind = 'prefab-from-entity' | 'move';

type FolderDropTarget = { path: string; zone: FolderDropZone };

function folderDropKind(dataTransfer: DataTransfer | null): FolderDropKind | null {
  if (!dataTransfer) return null;
  if (dataTransfer.types.includes(ENTITY_DND_TYPE)) return 'prefab-from-entity';
  if (dataTransfer.types.includes(ASSET_MOVE_DND_TYPE)) return 'move';
  return null;
}

function FolderRow({
  node,
  depth,
  selectedFolder,
  expanded,
  orderMap,
  dropTarget,
  onSelect,
  onToggleExpand,
  onContextMenu,
  onFolderDragStart,
  onDropOver,
  onDropInto,
  onDragLeaveRow,
  onDragEnd,
}: {
  node: FolderNode;
  depth: number;
  selectedFolder: string;
  expanded: ReadonlySet<string>;
  orderMap: FolderOrderMap;
  dropTarget: FolderDropTarget | null;
  onSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onContextMenu: (event: MouseEvent, folderPath: string) => void;
  onFolderDragStart: (event: DragEvent, folder: FolderNode) => void;
  onDropOver: (event: DragEvent, folderPath: string) => void;
  onDropInto: (event: DragEvent, folderPath: string) => void;
  onDragLeaveRow: (folderPath: string) => void;
  onDragEnd: () => void;
}): ReactElement {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded.has(node.path);
  const isRoot = node.path === '';
  const label = isRoot ? PROJECT_ROOT_LABEL : node.name;
  const isDropRow = dropTarget?.path === node.path;
  const dropZone = isDropRow ? dropTarget.zone : null;

  return (
    <>
      <div
        className={`ed-folder-row${node.path === selectedFolder ? ' is-selected' : ''}${
          dropZone === 'into' ? ' is-drop-target' : ''
        }${dropZone === 'before' ? ' is-drop-before' : ''}${
          dropZone === 'after' ? ' is-drop-after' : ''
        }`}
        data-folder-path={node.path}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        draggable={!isRoot}
        onClick={() => onSelect(node.path)}
        onContextMenu={(event) => onContextMenu(event, node.path)}
        onDragStart={(event) => {
          if (isRoot) {
            event.preventDefault();
            return;
          }
          onFolderDragStart(event, node);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDropOver(event, node.path)}
        onDragLeave={() => onDragLeaveRow(node.path)}
        onDrop={(event) => onDropInto(event, node.path)}
      >
        <button
          type="button"
          className={`ed-folder-chevron${hasChildren ? '' : ' is-leaf'}`}
          aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          disabled={!hasChildren}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleExpand(node.path);
          }}
        >
          {hasChildren ? (
            <UiIcon
              icon={isExpanded ? UiIcons.chevronDown : UiIcons.chevronRight}
              className="ed-ui-icon"
              size={12}
              strokeWidth={2.25}
            />
          ) : null}
        </button>
        <UiIcon
          icon={isExpanded && hasChildren ? UiIcons.folderOpen : UiIcons.folder}
          className="ed-ui-icon ed-folder-icon"
          size={14}
          strokeWidth={1.75}
        />
        <span className="ed-folder-name">{label}</span>
      </div>
      {isExpanded
        ? sortedFolderChildren(node, orderMap).map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFolder={selectedFolder}
              expanded={expanded}
              orderMap={orderMap}
              dropTarget={dropTarget}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onContextMenu={onContextMenu}
              onFolderDragStart={onFolderDragStart}
              onDropOver={onDropOver}
              onDropInto={onDropInto}
              onDragLeaveRow={onDragLeaveRow}
              onDragEnd={onDragEnd}
            />
          ))
        : null}
    </>
  );
}

function AssetThumb({
  fileName,
  url,
  assetVersion,
  kind,
  isModel,
  isEmptyFile,
  thumbSrc,
}: {
  fileName: string;
  url: string;
  assetVersion: string | undefined;
  kind: AssetCardKind;
  isModel: boolean;
  isEmptyFile: boolean;
  thumbSrc: string | undefined;
}): ReactElement {
  let content: ReactNode;
  if (kind === 'empty') content = '!';
  else if (kind === 'model') content = thumbSrc ? <img src={thumbSrc} alt={fileName} /> : '◇';
  else if (kind === 'audio') content = '♪';
  else if (kind === 'prefab') {
    content = (
      <UiIcon icon={UiIcons.box} className="ed-ui-icon" size={22} strokeWidth={1.5} />
    );
  } else content = <img src={url} alt={fileName} loading="lazy" />;

  return (
    <div
      className={`ed-asset-thumb${isEmptyFile ? ' is-warning' : ''}${
        kind === 'prefab' ? ' is-prefab' : ''
      }`}
      data-thumb-url={isModel && !isEmptyFile && !thumbSrc ? url : undefined}
      data-thumb-version={isModel && !isEmptyFile && !thumbSrc ? assetVersion : undefined}
      data-thumb-alt={isModel && !isEmptyFile && !thumbSrc ? fileName : undefined}
    >
      {content}
    </div>
  );
}

function runAssetAction(
  label: string,
  isEmptyFile: boolean,
  action: (url: string) => void | Promise<void>,
  url: string,
): (event: MouseEvent) => void {
  return (event) => {
    event.stopPropagation();
    if (isEmptyFile) return;
    void Promise.resolve(action(url)).catch((error) => {
      showToast(`${label} failed: ${(error as Error).message}`, true);
    });
  };
}

function ModelAssetActions({
  url,
  isEmptyFile,
  canCreateItem,
  onPreviewAnimationSource,
  onCreateItemPrefab,
}: {
  url: string;
  isEmptyFile: boolean;
  canCreateItem: boolean;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
}): ReactElement {
  return (
    <>
      <div className="ed-asset-actions">
        <button
          type="button"
          className="ed-asset-action"
          title={isEmptyFile ? 'File is empty' : 'Load animation clips in Base Characters'}
          disabled={isEmptyFile}
          onClick={runAssetAction('Animation preview', isEmptyFile, onPreviewAnimationSource, url)}
        >
          Anims
        </button>
      </div>
      {canCreateItem ? (
        <div className="ed-asset-actions">
          <button
            type="button"
            className="ed-asset-action"
            title={isEmptyFile ? 'File is empty' : 'Create an item prefab using this model'}
            disabled={isEmptyFile}
            onClick={runAssetAction('Item prefab creation', isEmptyFile, onCreateItemPrefab, url)}
          >
            Item
          </button>
        </div>
      ) : null}
    </>
  );
}

function AudioAssetActions({
  url,
  previewKey,
  isEmptyFile,
  audioPreview,
  audioTick,
  onAudioToggle,
}: {
  url: string;
  previewKey: string;
  isEmptyFile: boolean;
  audioPreview: EditorAudioPreviewController;
  audioTick: number;
  onAudioToggle: () => void;
}): ReactElement {
  const playing = audioTick >= 0 && audioPreview.isPlaying(previewKey);
  return (
    <div className="ed-asset-actions">
      <button
        type="button"
        className="ed-asset-action"
        title={isEmptyFile ? 'File is empty' : 'Preview audio'}
        disabled={isEmptyFile}
        onClick={(event) => {
          event.stopPropagation();
          if (isEmptyFile) return;
          audioPreview.toggle(previewKey, url, {}, onAudioToggle);
        }}
      >
        {playing ? 'Stop' : 'Play'}
      </button>
    </div>
  );
}

function AssetCard({
  entry,
  thumbSrc,
  audioPreview,
  audioTick,
  onAudioToggle,
  onPreviewAnimationSource,
  onCreateItemPrefab,
  onOpenPrefab,
  onContextMenu,
}: {
  entry: AssetEntry;
  thumbSrc: string | undefined;
  audioPreview: EditorAudioPreviewController;
  audioTick: number;
  onAudioToggle: () => void;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
  onOpenPrefab: (prefabId: string) => void;
  onContextMenu: (event: MouseEvent, entry: AssetEntry) => void;
}): ReactElement {
  const fileName = fileNameFromPath(entry.path);
  const url = assetUrlFor(PROJECT_ASSET_ROOT, entry.path);
  const kind = assetCardKind(entry);
  const isModel = kind === 'model';
  const isAudio = kind === 'audio';
  const isPrefab = isPrefabPath(entry.path);
  const isDraggable = isDraggableAssetPath(entry.path);
  const isEmptyFile = kind === 'empty';
  const sourcePath = `${PROJECT_ASSET_ROOT}/${entry.path}`;
  const assetVersion = assetVersionOf(entry);

  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    if (isPrefab) {
      event.dataTransfer.setData(PREFAB_DND_TYPE, prefabIdFromPath(entry.path));
    }
    event.dataTransfer.setData(
      ASSET_MOVE_DND_TYPE,
      JSON.stringify({ path: entry.path, kind: 'file' } satisfies AssetMoveDragPayload),
    );
    event.dataTransfer.setData(ASSET_DND_TYPE, url);
    event.dataTransfer.setData('text/plain', url);
  };

  return (
    <div
      className={`ed-asset-card${isEmptyFile ? ' is-unavailable' : ''}`}
      title={assetCardTitle(sourcePath, kind)}
      draggable={isDraggable && !isEmptyFile}
      onDragStart={isDraggable && !isEmptyFile ? onDragStart : undefined}
      onDoubleClick={
        isPrefab && !isEmptyFile ? () => onOpenPrefab(prefabIdFromPath(entry.path)) : undefined
      }
      onContextMenu={(event) => onContextMenu(event, entry)}
    >
      <AssetThumb
        fileName={fileName}
        url={url}
        assetVersion={assetVersion}
        kind={kind}
        isModel={isModel}
        isEmptyFile={isEmptyFile}
        thumbSrc={thumbSrc}
      />
      <div className="ed-asset-name">{fileName}</div>
      {isModel ? (
        <ModelAssetActions
          url={url}
          isEmptyFile={isEmptyFile}
          canCreateItem={canCreateItemPrefabFromPath(entry.path)}
          onPreviewAnimationSource={onPreviewAnimationSource}
          onCreateItemPrefab={onCreateItemPrefab}
        />
      ) : null}
      {isAudio ? (
        <AudioAssetActions
          url={url}
          previewKey={`asset:${sourcePath}`}
          isEmptyFile={isEmptyFile}
          audioPreview={audioPreview}
          audioTick={audioTick}
          onAudioToggle={onAudioToggle}
        />
      ) : null}
    </div>
  );
}

function FolderCard({
  folder,
  dropTarget,
  onOpen,
  onContextMenu,
  onFolderDragStart,
  onDropOver,
  onDropInto,
  onDragLeaveRow,
  onDragEnd,
}: {
  folder: FolderNode;
  dropTarget: FolderDropTarget | null;
  onOpen: (path: string) => void;
  onContextMenu: (event: MouseEvent, folderPath: string) => void;
  onFolderDragStart: (event: DragEvent, folder: FolderNode) => void;
  onDropOver: (event: DragEvent, folderPath: string) => void;
  onDropInto: (event: DragEvent, folderPath: string) => void;
  onDragLeaveRow: (folderPath: string) => void;
  onDragEnd: () => void;
}): ReactElement {
  const isDropRow = dropTarget?.path === folder.path;
  const dropZone = isDropRow ? dropTarget.zone : null;
  const labelPath = `${PROJECT_ROOT_LABEL}/${folder.path}`;

  return (
    <div
      className={`ed-asset-card is-folder${dropZone === 'into' ? ' is-drop-target' : ''}`}
      title={`${labelPath}\nDouble-click to open`}
      draggable
      data-folder-path={folder.path}
      onDoubleClick={() => onOpen(folder.path)}
      onContextMenu={(event) => onContextMenu(event, folder.path)}
      onDragStart={(event) => onFolderDragStart(event, folder)}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDropOver(event, folder.path)}
      onDragLeave={() => onDragLeaveRow(folder.path)}
      onDrop={(event) => onDropInto(event, folder.path)}
    >
      <div className="ed-asset-thumb is-folder">
        <UiIcon icon={UiIcons.folder} className="ed-ui-icon" size={28} strokeWidth={1.5} />
      </div>
      <div className="ed-asset-name">{folder.name}</div>
    </div>
  );
}

function useLazyModelThumbs(
  gridRef: RefObject<HTMLDivElement | null>,
  getModelThumbnail: (url: string, assetVersion?: string) => Promise<string>,
  selectedFolder: string,
  tree: FolderNode,
): {
  thumbByUrl: Record<string, string>;
  clearThumbs: () => void;
} {
  const [thumbByUrl, setThumbByUrl] = useState<Record<string, string>>({});
  const clearThumbs = useCallback(() => setThumbByUrl({}), []);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const thumb = entry.target as HTMLElement;
          const url = thumb.dataset.thumbUrl;
          if (!url) continue;
          const assetVersion = thumb.dataset.thumbVersion;
          observer.unobserve(thumb);
          delete thumb.dataset.thumbUrl;
          delete thumb.dataset.thumbVersion;
          delete thumb.dataset.thumbAlt;
          void getModelThumbnail(url, assetVersion).then((dataUrl) => {
            if (!dataUrl) return;
            setThumbByUrl((prev) => (prev[url] ? prev : { ...prev, [url]: dataUrl }));
          });
        }
      },
      { root: grid, rootMargin: '160px 0px', threshold: 0.01 },
    );

    for (const thumb of grid.querySelectorAll<HTMLElement>('[data-thumb-url]')) {
      observer.observe(thumb);
    }

    return () => observer.disconnect();
  }, [getModelThumbnail, gridRef, selectedFolder, tree, thumbByUrl]);

  return { thumbByUrl, clearThumbs };
}

function ProjectFolderTree({
  tree,
  selectedFolder,
  expanded,
  orderMap,
  dropTarget,
  onFolderSelect,
  onToggleExpand,
  onContextMenu,
  onFolderDragStart,
  onDropOver,
  onDropInto,
  onDragLeaveRow,
  onDragEnd,
}: {
  tree: FolderNode;
  selectedFolder: string;
  expanded: ReadonlySet<string>;
  orderMap: FolderOrderMap;
  dropTarget: FolderDropTarget | null;
  onFolderSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onContextMenu: (event: MouseEvent, folderPath: string) => void;
  onFolderDragStart: (event: DragEvent, folder: FolderNode) => void;
  onDropOver: (event: DragEvent, folderPath: string) => void;
  onDropInto: (event: DragEvent, folderPath: string) => void;
  onDragLeaveRow: (folderPath: string) => void;
  onDragEnd: () => void;
}): ReactElement {
  return (
    <div className="ed-project-side">
      <div
        className="ed-folder-tree"
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('.ed-folder-row')) return;
          onContextMenu(event, selectedFolder);
        }}
      >
        <FolderRow
          node={tree}
          depth={0}
          selectedFolder={selectedFolder}
          expanded={expanded}
          orderMap={orderMap}
          dropTarget={dropTarget}
          onSelect={onFolderSelect}
          onToggleExpand={onToggleExpand}
          onContextMenu={onContextMenu}
          onFolderDragStart={onFolderDragStart}
          onDropOver={onDropOver}
          onDropInto={onDropInto}
          onDragLeaveRow={onDragLeaveRow}
          onDragEnd={onDragEnd}
        />
      </div>
    </div>
  );
}

function ProjectAssetToolbar({
  selectedFolder,
  folderScope,
  onNavigate,
  onScopeChange,
}: {
  selectedFolder: string;
  folderScope: FolderScope;
  onNavigate: (path: string) => void;
  onScopeChange: (scope: FolderScope) => void;
}): ReactElement {
  const crumbs = folderBreadcrumbs(selectedFolder);
  return (
    <div className="ed-asset-browser-toolbar">
      <nav className="ed-asset-breadcrumbs" aria-label="Asset folder path">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <span key={crumb.path === '' ? 'root' : crumb.path} className="ed-asset-breadcrumb">
              {index > 0 ? <span className="ed-asset-breadcrumb-sep">/</span> : null}
              {isLast ? (
                <span className="ed-asset-breadcrumb-current">{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  className="ed-asset-breadcrumb-link"
                  onClick={() => onNavigate(crumb.path)}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>
      <select
        className="ed-select ed-asset-scope-select"
        value={folderScope}
        aria-label="Folder scope"
        onChange={(event) => onScopeChange(event.target.value as FolderScope)}
      >
        <option value="this-folder">This folder</option>
        <option value="all-subfolders">All subfolders</option>
      </select>
    </div>
  );
}

function ProjectAssetGrid({
  gridRef,
  selectedFolder,
  folderScope,
  folders,
  files,
  thumbByUrl,
  audioPreview,
  audioTick,
  isDropTarget,
  dropTarget,
  onNavigate,
  onScopeChange,
  onContextMenu,
  onAssetContextMenu,
  onOpenPrefab,
  onFolderDragStart,
  onDropOver,
  onDropInto,
  onDragLeaveRow,
  onDragEnd,
  onAudioToggle,
  onPreviewAnimationSource,
  onCreateItemPrefab,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  selectedFolder: string;
  folderScope: FolderScope;
  folders: FolderNode[];
  files: AssetEntry[];
  thumbByUrl: Record<string, string>;
  audioPreview: EditorAudioPreviewController;
  audioTick: number;
  isDropTarget: boolean;
  dropTarget: FolderDropTarget | null;
  onNavigate: (path: string) => void;
  onScopeChange: (scope: FolderScope) => void;
  onContextMenu: (event: MouseEvent, folderPath: string) => void;
  onAssetContextMenu: (event: MouseEvent, entry: AssetEntry) => void;
  onOpenPrefab: (prefabId: string) => void;
  onFolderDragStart: (event: DragEvent, folder: FolderNode) => void;
  onDropOver: (event: DragEvent, folderPath: string) => void;
  onDropInto: (event: DragEvent, folderPath: string) => void;
  onDragLeaveRow: (folderPath: string) => void;
  onDragEnd: () => void;
  onAudioToggle: () => void;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
}): ReactElement {
  const isEmpty = folders.length === 0 && files.length === 0;
  return (
    <div
      className={`ed-asset-browser-body${isDropTarget ? ' is-drop-target' : ''}`}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('.ed-asset-card')) return;
        onContextMenu(event, selectedFolder);
      }}
      onDragOver={(event) => onDropOver(event, selectedFolder)}
      onDrop={(event) => onDropInto(event, selectedFolder)}
    >
      <ProjectAssetToolbar
        selectedFolder={selectedFolder}
        folderScope={folderScope}
        onNavigate={onNavigate}
        onScopeChange={onScopeChange}
      />
      <div className="ed-asset-grid" ref={gridRef}>
        {isEmpty ? (
          <div className="ed-empty-note">{emptyNoteForFolder(selectedFolder)}</div>
        ) : (
          <>
            {folders.map((folder) => (
              <FolderCard
                key={`folder:${folder.path}`}
                folder={folder}
                dropTarget={dropTarget}
                onOpen={onNavigate}
                onContextMenu={onContextMenu}
                onFolderDragStart={onFolderDragStart}
                onDropOver={onDropOver}
                onDropInto={onDropInto}
                onDragLeaveRow={onDragLeaveRow}
                onDragEnd={onDragEnd}
              />
            ))}
            {files.map((entry) => {
              const url = assetUrlFor(PROJECT_ASSET_ROOT, entry.path);
              return (
                <AssetCard
                  key={entry.path}
                  entry={entry}
                  thumbSrc={thumbByUrl[url]}
                  audioPreview={audioPreview}
                  audioTick={audioTick}
                  onAudioToggle={onAudioToggle}
                  onPreviewAnimationSource={onPreviewAnimationSource}
                  onCreateItemPrefab={onCreateItemPrefab}
                  onOpenPrefab={onOpenPrefab}
                  onContextMenu={onAssetContextMenu}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function referenceSuffix(updated: number): string {
  if (updated === 0) return '';
  return ` (updated ${updated} document${updated === 1 ? '' : 's'})`;
}

/**
 * Filesystem mutations offered by the Project panel. Each one reloads the
 * listing itself because Electron does not watch the project directory.
 */
function useProjectFileOperations(
  reload: () => Promise<void>,
  revealFolder: (folderPath: string) => Promise<void>,
  onFolderRenamed: (fromPath: string, toPath: string) => void,
  getOrderMap: () => FolderOrderMap,
  persistOrder: (order: FolderOrderMap) => Promise<void>,
): {
  createFolderIn: (parentPath: string) => Promise<void>;
  moveEntryInto: (payload: AssetMoveDragPayload, folderPath: string) => Promise<void>;
  moveFolderTo: (
    payload: AssetMoveDragPayload,
    toPath: string,
    insertIndex?: number,
  ) => Promise<void>;
  reorderFolderAmongSiblings: (
    folderPath: string,
    parentPath: string,
    siblingNames: string[],
  ) => Promise<void>;
  renameFolder: (folder: FolderNode) => Promise<void>;
  renameEntry: (entry: AssetEntry) => Promise<void>;
  deleteEntry: (entry: AssetEntry) => Promise<void>;
  deleteFolder: (folder: FolderNode) => Promise<void>;
} {
  const createFolderIn = useCallback(
    async (parentPath: string): Promise<void> => {
      const parentLabel = parentPath
        ? `${PROJECT_ROOT_LABEL}/${parentPath}`
        : PROJECT_ROOT_LABEL;
      const name = await showPromptDialog({
        title: 'New Folder',
        message: `Create a folder in ${parentLabel}`,
        defaultValue: 'New Folder',
        confirmLabel: 'Create',
      });
      if (!name) return;
      const trimmedName = name.trim();
      if (!isValidAssetEntryName(trimmedName)) {
        showToast('Folder name cannot start with a dot or contain path separators.', true);
        return;
      }
      try {
        const created = await createAssetFolder(parentPath, trimmedName);
        await persistOrder(
          insertChildInOrder(getOrderMap(), parentPath, trimmedName, Number.MAX_SAFE_INTEGER),
        );
        await revealFolder(created.path);
        showToast(`Created ${PROJECT_ROOT_LABEL}/${created.path}`);
      } catch (error) {
        showToast(`Could not create folder: ${(error as Error).message}`, true);
      }
    },
    [getOrderMap, persistOrder, revealFolder],
  );

  const moveEntryInto = useCallback(
    async (payload: AssetMoveDragPayload, folderPath: string): Promise<void> => {
      const name = fileNameFromPath(payload.path);
      const toPath = joinFolderPath(folderPath, name);
      try {
        const result = await moveAssetEntry(PROJECT_ASSET_ROOT, payload.path, toPath);
        if (payload.kind === 'dir' || result.kind === 'dir') {
          onFolderRenamed(payload.path, toPath);
          await persistOrder(
            applyFolderMoveToOrder(getOrderMap(), payload.path, toPath),
          );
        }
        await reload();
        const destination = folderPath
          ? `${PROJECT_ROOT_LABEL}/${folderPath}`
          : PROJECT_ROOT_LABEL;
        showToast(
          `Moved ${name} to ${destination}${referenceSuffix(result.updatedReferences)}`,
        );
      } catch (error) {
        showToast(`Could not move ${name}: ${(error as Error).message}`, true);
      }
    },
    [getOrderMap, onFolderRenamed, persistOrder, reload],
  );

  const moveFolderTo = useCallback(
    async (
      payload: AssetMoveDragPayload,
      toPath: string,
      insertIndex?: number,
    ): Promise<void> => {
      if (payload.path === toPath) return;
      const name = fileNameFromPath(toPath);
      let moved = false;
      try {
        const result = await moveAssetEntry(PROJECT_ASSET_ROOT, payload.path, toPath);
        moved = true;
        onFolderRenamed(payload.path, toPath);
        await persistOrder(
          applyFolderMoveToOrder(getOrderMap(), payload.path, toPath, insertIndex),
        );
        await revealFolder(toPath);
        showToast(`Moved ${name}${referenceSuffix(result.updatedReferences)}`);
      } catch (error) {
        if (moved) {
          try {
            await moveAssetEntry(PROJECT_ASSET_ROOT, toPath, payload.path);
          } catch {
            // Best-effort rollback; surface the original error below.
          }
        }
        await reload();
        showToast(`Could not move folder: ${(error as Error).message}`, true);
      }
    },
    [getOrderMap, onFolderRenamed, persistOrder, reload, revealFolder],
  );

  const reorderFolderAmongSiblings = useCallback(
    async (
      folderPath: string,
      parentPath: string,
      siblingNames: string[],
    ): Promise<void> => {
      try {
        await persistOrder(setParentOrder(getOrderMap(), parentPath, siblingNames));
        showToast(`Reordered ${fileNameFromPath(folderPath)}`);
      } catch (error) {
        showToast(`Could not reorder folder: ${(error as Error).message}`, true);
      }
    },
    [getOrderMap, persistOrder],
  );

  const renameFolder = useCallback(
    async (folder: FolderNode): Promise<void> => {
      if (!folder.path) return;
      const currentName = folder.name;
      const enteredName = await showPromptDialog({
        title: 'Rename Folder',
        message: `Rename ${currentName}`,
        defaultValue: currentName,
        confirmLabel: 'Rename',
      });
      if (enteredName === null) return;
      const nextName = enteredName.trim();
      if (nextName === currentName) return;
      if (!isValidAssetEntryName(nextName)) {
        showToast('Folder name cannot start with a dot or contain path separators.', true);
        return;
      }

      const nextPath = joinFolderPath(parentFolderOfPath(folder.path), nextName);
      let renamed = false;
      try {
        const result = await moveAssetEntry(PROJECT_ASSET_ROOT, folder.path, nextPath);
        renamed = true;
        onFolderRenamed(folder.path, nextPath);
        await persistOrder(applyFolderMoveToOrder(getOrderMap(), folder.path, nextPath));
        await revealFolder(nextPath);
        showToast(`Renamed to ${nextName}${referenceSuffix(result.updatedReferences)}`);
      } catch (error) {
        let rollbackError: unknown = null;
        if (renamed) {
          try {
            await moveAssetEntry(PROJECT_ASSET_ROOT, nextPath, folder.path);
          } catch (caught) {
            rollbackError = caught;
          }
        }
        await reload();
        const detail =
          rollbackError === null
            ? (error as Error).message
            : `${(error as Error).message}; rollback failed: ${(rollbackError as Error).message}`;
        showToast(`Could not rename folder: ${detail}`, true);
      }
    },
    [getOrderMap, onFolderRenamed, persistOrder, reload, revealFolder],
  );

  const renameEntry = useCallback(
    async (entry: AssetEntry): Promise<void> => {
      const currentName = fileNameFromPath(entry.path);
      const enteredName = await showPromptDialog({
        title: 'Rename',
        message: `Rename ${currentName}`,
        defaultValue: currentName,
        confirmLabel: 'Rename',
      });
      if (enteredName === null) return;
      const nextName = enteredName.trim();
      if (nextName === currentName) return;
      if (!isValidAssetEntryName(nextName)) {
        showToast('Asset name cannot start with a dot or contain path separators.', true);
        return;
      }
      try {
        const result = await moveAssetEntry(
          PROJECT_ASSET_ROOT,
          entry.path,
          joinFolderPath(parentFolderOfPath(entry.path), nextName),
        );
        await reload();
        showToast(`Renamed to ${nextName}${referenceSuffix(result.updatedReferences)}`);
      } catch (error) {
        showToast(`Could not rename: ${(error as Error).message}`, true);
      }
    },
    [reload],
  );

  const deleteEntry = useCallback(
    async (entry: AssetEntry): Promise<void> => {
      const name = fileNameFromPath(entry.path);
      const confirmed = await showConfirmDialog({
        title: 'Delete',
        message: `Delete ${name}? This cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return;
      try {
        await deleteAssetEntry(PROJECT_ASSET_ROOT, entry.path);
        await reload();
        showToast(`Deleted ${name}`);
      } catch (error) {
        showToast(`Could not delete ${name}: ${(error as Error).message}`, true);
      }
    },
    [reload],
  );

  const deleteFolder = useCallback(
    async (folder: FolderNode): Promise<void> => {
      if (!folder.path) return;
      const name = folder.name;
      if (folder.children.size > 0 || folder.files.length > 0) {
        showToast(`Cannot delete "${name}": folder is not empty.`, true);
        return;
      }
      const confirmed = await showConfirmDialog({
        title: 'Delete Folder',
        message: `Delete empty folder ${name}? This cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return;
      try {
        await deleteAssetEntry(PROJECT_ASSET_ROOT, folder.path);
        await persistOrder(
          removeChildFromOrder(getOrderMap(), parentFolderOfPath(folder.path), name),
        );
        await reload();
        showToast(`Deleted ${name}`);
      } catch (error) {
        await reload();
        const message = (error as Error).message;
        if (/not empty/i.test(message)) {
          showToast(`Cannot delete "${name}": folder is not empty.`, true);
          return;
        }
        showToast(`Could not delete ${name}: ${message}`, true);
      }
    },
    [getOrderMap, persistOrder, reload],
  );

  return {
    createFolderIn,
    moveEntryInto,
    moveFolderTo,
    reorderFolderAmongSiblings,
    renameFolder,
    renameEntry,
    deleteEntry,
    deleteFolder,
  };
}

function resolveFolderDropZone(event: DragEvent, folderPath: string): FolderDropZone {
  const row = event.currentTarget as HTMLElement;
  if (row.classList.contains('ed-asset-browser-body')) return 'into';
  // Grid folder cards only accept nest-into drops (no before/after reorder).
  if (row.classList.contains('ed-asset-card')) return 'into';
  return folderDropZoneFromOffset(event.nativeEvent.offsetY, row.clientHeight, folderPath === '');
}

function handleFolderMoveDrop(options: {
  payload: AssetMoveDragPayload;
  folderPath: string;
  zone: FolderDropZone;
  tree: FolderNode;
  orderMap: FolderOrderMap;
  moveEntryInto: (payload: AssetMoveDragPayload, folderPath: string) => Promise<void>;
  moveFolderTo: (
    payload: AssetMoveDragPayload,
    toPath: string,
    insertIndex?: number,
  ) => Promise<void>;
  reorderFolderAmongSiblings: (
    folderPath: string,
    parentPath: string,
    siblingNames: string[],
  ) => Promise<void>;
}): void {
  const {
    payload,
    folderPath,
    zone,
    tree,
    orderMap,
    moveEntryInto,
    moveFolderTo,
    reorderFolderAmongSiblings,
  } = options;
  const isFolderDrag = payload.kind === 'dir';

  if (zone === 'into') {
    if (!canMoveInto(payload, folderPath)) return;
    if (isFolderDrag) {
      void moveFolderTo(payload, joinFolderPath(folderPath, fileNameFromPath(payload.path)));
    } else {
      void moveEntryInto(payload, folderPath);
    }
    return;
  }

  if (!isFolderDrag || !canDropRelativeTo(payload, folderPath)) return;

  const parentPath = parentFolderOfPath(folderPath);
  const targetName = fileNameFromPath(folderPath);
  const draggedName = fileNameFromPath(payload.path);
  const sourceParent = parentFolderOfPath(payload.path);
  const parentNode = findFolder(tree, parentPath) ?? tree;

  if (sourceParent === parentPath) {
    const currentSiblings = sortedFolderChildren(parentNode, orderMap).map((child) => child.name);
    const nextSiblings = siblingOrderAfterDrop(currentSiblings, draggedName, targetName, zone);
    if (nextSiblings.join('\0') === currentSiblings.join('\0')) return;
    void reorderFolderAmongSiblings(payload.path, parentPath, nextSiblings);
    return;
  }

  const siblingsWithoutDragged = sortedFolderChildren(parentNode, orderMap)
    .map((child) => child.name)
    .filter((name) => name !== draggedName);
  const nextSiblings = siblingOrderAfterDrop(
    [...siblingsWithoutDragged, draggedName],
    draggedName,
    targetName,
    zone,
  );
  const insertIndex = nextSiblings.indexOf(draggedName);
  void moveFolderTo(
    payload,
    joinFolderPath(parentPath, draggedName),
    insertIndex >= 0 ? insertIndex : undefined,
  );
}

function useProjectFolderDnd(options: {
  treeRef: RefObject<FolderNode>;
  orderMapRef: RefObject<FolderOrderMap>;
  moveEntryInto: (payload: AssetMoveDragPayload, folderPath: string) => Promise<void>;
  moveFolderTo: (
    payload: AssetMoveDragPayload,
    toPath: string,
    insertIndex?: number,
  ) => Promise<void>;
  reorderFolderAmongSiblings: (
    folderPath: string,
    parentPath: string,
    siblingNames: string[],
  ) => Promise<void>;
  savePrefabsInto: (entityIds: string[], folderPath: string) => Promise<void>;
}): {
  dropTarget: FolderDropTarget | null;
  onFolderDragStart: (event: DragEvent, folder: FolderNode) => void;
  onDragLeaveRow: (folderPath: string) => void;
  onDragEnd: () => void;
  onDropOver: (event: DragEvent, folderPath: string) => void;
  onDropInto: (event: DragEvent, folderPath: string) => void;
} {
  const {
    treeRef,
    orderMapRef,
    moveEntryInto,
    moveFolderTo,
    reorderFolderAmongSiblings,
    savePrefabsInto,
  } = options;
  const [dropTarget, setDropTarget] = useState<FolderDropTarget | null>(null);

  const onFolderDragStart = useCallback((event: DragEvent, folder: FolderNode) => {
    if (!folder.path) {
      event.preventDefault();
      return;
    }
    const payload: AssetMoveDragPayload = { path: folder.path, kind: 'dir' };
    event.dataTransfer?.setData(ASSET_MOVE_DND_TYPE, JSON.stringify(payload));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragLeaveRow = useCallback((folderPath: string) => {
    setDropTarget((current) => (current?.path === folderPath ? null : current));
  }, []);

  const onDragEnd = useCallback(() => {
    setDropTarget(null);
  }, []);

  const onDropOver = useCallback((event: DragEvent, folderPath: string) => {
    const kind = folderDropKind(event.dataTransfer);
    if (!kind) return;

    const zone = resolveFolderDropZone(event, folderPath);
    if (kind === 'move') {
      const payload = parseAssetMovePayload(
        event.dataTransfer?.getData(ASSET_MOVE_DND_TYPE) ?? '',
      );
      // `getData` is blocked during dragover in some browsers, so an
      // unreadable payload still highlights and is validated on drop.
      if (payload) {
        if (zone === 'into' && !canMoveInto(payload, folderPath)) return;
        if (zone !== 'into' && !canDropRelativeTo(payload, folderPath)) return;
      }
    } else if (zone !== 'into') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDropTarget({ path: folderPath, zone });
  }, []);

  const onDropInto = useCallback(
    (event: DragEvent, folderPath: string) => {
      const kind = folderDropKind(event.dataTransfer);
      const zone = resolveFolderDropZone(event, folderPath);
      setDropTarget(null);
      if (!kind) return;
      event.preventDefault();
      event.stopPropagation();

      if (kind === 'prefab-from-entity') {
        if (zone !== 'into') return;
        const entityIds = parseDraggedEntityIds(
          event.dataTransfer?.getData(ENTITY_DND_TYPE) ?? '',
        );
        if (entityIds.length > 0) void savePrefabsInto(entityIds, folderPath);
        return;
      }

      const payload = parseAssetMovePayload(
        event.dataTransfer?.getData(ASSET_MOVE_DND_TYPE) ?? '',
      );
      if (!payload) return;
      handleFolderMoveDrop({
        payload,
        folderPath,
        zone,
        tree: treeRef.current,
        orderMap: orderMapRef.current,
        moveEntryInto,
        moveFolderTo,
        reorderFolderAmongSiblings,
      });
    },
    [
      moveEntryInto,
      moveFolderTo,
      orderMapRef,
      reorderFolderAmongSiblings,
      savePrefabsInto,
      treeRef,
    ],
  );

  return {
    dropTarget,
    onFolderDragStart,
    onDragLeaveRow,
    onDragEnd,
    onDropOver,
    onDropInto,
  };
}

/**
 * Project browser for the Rogue-style shell.
 * Bottom dock: Project tree | assets grid, or full-width Console.
 */
export const ProjectPanel = forwardRef<ProjectPanelHandle, ProjectPanelProps>(
  function ProjectPanel(options, ref): ReactElement {
    const {
      getModelThumbnail,
      onPreviewAnimationSource,
      onCreateItemPrefab,
      onOpenPrefab,
      onCreatePrefabsInFolder,
      audioPreview,
    } = options;

    const [tree, setTree] = useState<FolderNode>(() => emptyFolderNode());
    const [selectedFolder, setSelectedFolder] = useState('');
    const [expanded, setExpanded] = useState(() => new Set<string>(DEFAULT_EXPANDED_FOLDERS));
    const [folderScope, setFolderScope] = useState<FolderScope>('this-folder');
    const [bottomTab, setBottomTab] = useState<BottomLeftTab>('project');
    const [audioTick, bumpAudio] = useReducer((n: number) => n + 1, 0);
    const [orderMap, setOrderMap] = useState<FolderOrderMap>({});

    const pendingFolderRef = useRef<string | null>(null);
    const treeRef = useRef(tree);
    treeRef.current = tree;
    const selectedFolderRef = useRef(selectedFolder);
    selectedFolderRef.current = selectedFolder;
    const orderMapRef = useRef(orderMap);
    orderMapRef.current = orderMap;

    const dockRef = useRef<HTMLDivElement | null>(null);
    const sideSplitterRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);
    const { thumbByUrl, clearThumbs } = useLazyModelThumbs(
      gridRef,
      getModelThumbnail,
      selectedFolder,
      tree,
    );

    useEffect(() => {
      const dock = dockRef.current;
      const splitter = sideSplitterRef.current;
      if (!dock || !splitter) return;
      restoreProjectSideWidth(dock);
      attachColumnSplitter(splitter, dock, '--ed-project-side-width', {
        ...PANEL_SIZE_BOUNDS.projectSideWidth,
        storageKey: 'projectSideWidth',
      });
    }, []);

    const load = useCallback(async (): Promise<void> => {
      let nextTree: FolderNode;
      let nextOrder: FolderOrderMap = orderMapRef.current;
      try {
        nextTree = buildFolderTree(await fetchProjectAssetEntries());
      } catch (error) {
        showToast(`Asset listing failed: ${(error as Error).message}`, true);
        nextTree = emptyFolderNode();
      }
      try {
        const folderOrder = await fetchFolderOrder();
        nextOrder = folderOrder.order ?? {};
      } catch {
        // Keep the last known order if the sidecar is temporarily unreadable.
      }

      const pending = pendingFolderRef.current;
      let nextSelected = selectedFolderRef.current;
      if (pending && findFolder(nextTree, pending)) {
        pendingFolderRef.current = null;
        nextSelected = pending;
        setExpanded((prev) => {
          const next = new Set(prev);
          expandAncestorsInto(next, pending);
          return next;
        });
      } else if (!findFolder(nextTree, nextSelected)) {
        nextSelected = '';
      }

      setTree(nextTree);
      setOrderMap(nextOrder);
      orderMapRef.current = nextOrder;
      setSelectedFolder(nextSelected);
      clearThumbs();
    }, [clearThumbs]);

    const getOrderMap = useCallback((): FolderOrderMap => orderMapRef.current, []);

    const persistOrder = useCallback(async (order: FolderOrderMap): Promise<void> => {
      const document = await saveFolderOrder({ schemaVersion: 1, order });
      setOrderMap(document.order);
      orderMapRef.current = document.order;
    }, []);

    useEffect(() => {
      void load();
    }, [load]);

    useImperativeHandle(
      ref,
      () => ({
        selectFolder(folderPath: string) {
          if (!findFolder(treeRef.current, folderPath)) {
            pendingFolderRef.current = folderPath;
            return;
          }
          pendingFolderRef.current = null;
          setBottomTab('project');
          setSelectedFolder(folderPath);
          setExpanded((prev) => {
            const next = new Set(prev);
            expandAncestorsInto(next, folderPath);
            return next;
          });
        },
        refresh: load,
      }),
      [load],
    );

    const onFolderSelect = useCallback((path: string) => {
      setSelectedFolder(path);
      setExpanded((prev) => {
        if (prev.has(path)) return prev;
        const node = findFolder(treeRef.current, path);
        if (!node || node.children.size === 0) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
    }, []);

    const onToggleExpand = useCallback((path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    }, []);

    const onNavigateFolder = useCallback((path: string) => {
      setSelectedFolder(path);
      setExpanded((prev) => {
        const next = new Set(prev);
        expandAncestorsInto(next, path);
        return next;
      });
    }, []);

    const revealFolder = useCallback(
      async (folderPath: string): Promise<void> => {
        pendingFolderRef.current = folderPath;
        setBottomTab('project');
        setExpanded((prev) => {
          const next = new Set(prev);
          expandAncestorsInto(next, folderPath);
          return next;
        });
        await load();
      },
      [load],
    );

    const onFolderRenamed = useCallback((fromPath: string, toPath: string): void => {
      setSelectedFolder((current) => {
        const next = remapFolderPath(current, fromPath, toPath);
        selectedFolderRef.current = next;
        return next;
      });
      setExpanded((current) => {
        const next = new Set<string>();
        for (const path of current) next.add(remapFolderPath(path, fromPath, toPath));
        return next;
      });
    }, []);

    const {
      createFolderIn,
      moveEntryInto,
      moveFolderTo,
      reorderFolderAmongSiblings,
      renameFolder,
      renameEntry,
      deleteEntry,
      deleteFolder,
    } = useProjectFileOperations(load, revealFolder, onFolderRenamed, getOrderMap, persistOrder);

    const savePrefabsInto = useCallback(
      async (entityIds: string[], folderPath: string): Promise<void> => {
        const created = await onCreatePrefabsInFolder(entityIds, folderPath);
        if (created.length === 0) return;
        await revealFolder(folderPath);
      },
      [onCreatePrefabsInFolder, revealFolder],
    );

    const {
      dropTarget,
      onFolderDragStart,
      onDragLeaveRow,
      onDragEnd,
      onDropOver,
      onDropInto,
    } = useProjectFolderDnd({
      treeRef,
      orderMapRef,
      moveEntryInto,
      moveFolderTo,
      reorderFolderAmongSiblings,
      savePrefabsInto,
    });

    const onProjectContextMenu = useCallback(
      (event: MouseEvent, folderPath: string) => {
        event.preventDefault();
        event.stopPropagation();
        const items = [
          {
            label: 'New Folder',
            action: () => {
              void createFolderIn(folderPath);
            },
          },
        ];
        const folder = findFolder(treeRef.current, folderPath);
        if (folderPath && folder) {
          items.push({
            label: 'Rename…',
            action: () => {
              void renameFolder(folder);
            },
          });
          items.push({
            label: 'Delete…',
            action: () => {
              void deleteFolder(folder);
            },
          });
        }
        items.push(
          {
            label: 'Refresh',
            action: () => {
              void load();
            },
          },
        );
        showContextMenu(event.clientX, event.clientY, items);
      },
      [createFolderIn, deleteFolder, load, renameFolder],
    );

    const onAssetContextMenu = useCallback(
      (event: MouseEvent, entry: AssetEntry) => {
        event.preventDefault();
        event.stopPropagation();
        const items = [];
        if (isPrefabPath(entry.path)) {
          items.push({
            label: 'Open Prefab',
            action: () => onOpenPrefab(prefabIdFromPath(entry.path)),
          });
        }
        items.push(
          {
            label: 'Rename…',
            action: () => {
              void renameEntry(entry);
            },
          },
          {
            label: 'Delete…',
            action: () => {
              void deleteEntry(entry);
            },
          },
        );
        showContextMenu(event.clientX, event.clientY, items);
      },
      [deleteEntry, onOpenPrefab, renameEntry],
    );

    const files = collectFolderFiles(
      tree,
      selectedFolder,
      folderScope === 'all-subfolders',
      orderMap,
    );
    const folders = collectImmediateChildFolders(tree, selectedFolder, orderMap);

    return (
      <div
        ref={dockRef}
        className={`ed-bottom-dock${bottomTab === 'console' ? ' is-console' : ''}`}
      >
        <div className="ed-bottom-left">
          <div className="ed-bottom-left-tabs">
            <button
              type="button"
              className={`ed-scene-tab${bottomTab === 'project' ? ' is-active' : ''}`}
              onClick={() => setBottomTab('project')}
            >
              Project
            </button>
            <button
              type="button"
              className={`ed-scene-tab${bottomTab === 'console' ? ' is-active' : ''}`}
              onClick={() => setBottomTab('console')}
            >
              Console
            </button>
          </div>
          <div className="ed-bottom-left-body">
            <div
              className={`ed-bottom-left-pane${
                bottomTab === 'project' ? '' : ' is-hidden'
              }`}
            >
              <ProjectFolderTree
                tree={tree}
                selectedFolder={selectedFolder}
                expanded={expanded}
                orderMap={orderMap}
                dropTarget={dropTarget}
                onFolderSelect={onFolderSelect}
                onToggleExpand={onToggleExpand}
                onContextMenu={onProjectContextMenu}
                onFolderDragStart={onFolderDragStart}
                onDropOver={onDropOver}
                onDropInto={onDropInto}
                onDragLeaveRow={onDragLeaveRow}
                onDragEnd={onDragEnd}
              />
            </div>
            <div
              className={`ed-bottom-left-pane${
                bottomTab === 'console' ? '' : ' is-hidden'
              }`}
            >
              <ConsolePanel />
            </div>
          </div>
        </div>
        <div
          ref={sideSplitterRef}
          className="ed-splitter ed-splitter-col ed-project-side-splitter"
        />
        <div className="ed-asset-browser">
          <ProjectAssetGrid
            gridRef={gridRef}
            selectedFolder={selectedFolder}
            folderScope={folderScope}
            folders={folders}
            files={files}
            thumbByUrl={thumbByUrl}
            audioPreview={audioPreview}
            audioTick={audioTick}
            isDropTarget={
              dropTarget?.path === selectedFolder && dropTarget.zone === 'into'
            }
            dropTarget={dropTarget}
            onNavigate={onNavigateFolder}
            onScopeChange={setFolderScope}
            onContextMenu={onProjectContextMenu}
            onAssetContextMenu={onAssetContextMenu}
            onOpenPrefab={onOpenPrefab}
            onFolderDragStart={onFolderDragStart}
            onDropOver={onDropOver}
            onDropInto={onDropInto}
            onDragLeaveRow={onDragLeaveRow}
            onDragEnd={onDragEnd}
            onAudioToggle={bumpAudio}
            onPreviewAnimationSource={onPreviewAnimationSource}
            onCreateItemPrefab={onCreateItemPrefab}
          />
        </div>
      </div>
    );
  },
);

