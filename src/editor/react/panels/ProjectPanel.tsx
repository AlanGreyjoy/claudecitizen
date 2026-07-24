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
import { ASSET_DND_TYPE, assetUrlFor } from '../../api';
import { showToast } from '../../dom';
import type { EditorAudioPreviewController } from '../../audio_preview';
import {
  buildFolderTree,
  canCreateItemPrefabFromPath,
  DEFAULT_EXPANDED_FOLDERS,
  emptyFolderNode,
  emptyNoteForFolder,
  expandAncestorsInto,
  fetchProjectAssetEntries,
  fileNameFromPath,
  findFolder,
  isAudioPath,
  isDraggableAssetPath,
  isModelPath,
  PROJECT_ROOT_LABEL,
  sortedFolderChildren,
  sortedFolderFiles,
  type FolderNode,
  type ProjectAssetEntry,
} from '../../panels/project_logic';
import { UiIcons } from '../../../ui/icons';
import { UiIcon } from '../UiIcon';
import { ConsolePanel } from './ConsolePanel';

export interface ProjectPanelOptions {
  /** Render a thumbnail data-url for a model asset (provided by render/editor). */
  getModelThumbnail: (url: string, assetVersion?: string) => Promise<string>;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
  audioPreview: EditorAudioPreviewController;
}

export interface ProjectPanelHandle {
  /** Select and expand a folder path in the Project tree (e.g. `protected/animations`). */
  selectFolder: (folderPath: string) => void;
}

export type ProjectPanelProps = ProjectPanelOptions;

type BottomLeftTab = 'project' | 'console';

function FolderRow({
  node,
  depth,
  selectedFolder,
  expanded,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selectedFolder: string;
  expanded: ReadonlySet<string>;
  onSelect: (path: string, hasChildren: boolean, isExpanded: boolean) => void;
}): ReactElement {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded.has(node.path);
  const label = node.path === '' ? PROJECT_ROOT_LABEL : node.name;

  return (
    <>
      <div
        className={`ed-folder-row${node.path === selectedFolder ? ' is-selected' : ''}`}
        data-folder-path={node.path}
        style={{ paddingLeft: `${10 + depth * 12}px` }}
        onClick={() => onSelect(node.path, hasChildren, isExpanded)}
      >
        {hasChildren ? (
          <UiIcon
            icon={isExpanded ? UiIcons.chevronDown : UiIcons.chevronRight}
            className="ed-ui-icon"
            size={14}
            strokeWidth={2}
          />
        ) : (
          <UiIcon
            icon={UiIcons.chevronRight}
            className="ed-ui-icon ed-ui-icon-muted"
            size={12}
            strokeWidth={2}
          />
        )}
        <span>{label}</span>
      </div>
      {isExpanded
        ? sortedFolderChildren(node).map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFolder={selectedFolder}
              expanded={expanded}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  );
}

function assetCardTitle(sourcePath: string, kind: 'empty' | 'model' | 'audio' | 'other'): string {
  if (kind === 'empty') return `${sourcePath}\nFile is empty`;
  if (kind === 'model') return `${sourcePath}\nDrag into the scene`;
  if (kind === 'audio') return `${sourcePath}\nDrag into the scene or onto an audio field`;
  return sourcePath;
}

function AssetThumb({
  fileName,
  url,
  assetVersion,
  isModel,
  isAudio,
  isEmptyFile,
  thumbSrc,
}: {
  fileName: string;
  url: string;
  assetVersion: string | undefined;
  isModel: boolean;
  isAudio: boolean;
  isEmptyFile: boolean;
  thumbSrc: string | undefined;
}): ReactElement {
  let content: ReactNode;
  if (isEmptyFile) content = '!';
  else if (isModel) content = thumbSrc ? <img src={thumbSrc} alt={fileName} /> : '◇';
  else if (isAudio) content = '♪';
  else content = <img src={url} alt={fileName} loading="lazy" />;

  return (
    <div
      className={`ed-asset-thumb${isEmptyFile ? ' is-warning' : ''}`}
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
}: {
  entry: ProjectAssetEntry;
  thumbSrc: string | undefined;
  audioPreview: EditorAudioPreviewController;
  audioTick: number;
  onAudioToggle: () => void;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
}): ReactElement {
  const fileName = fileNameFromPath(entry.path);
  const url = assetUrlFor(entry.root, entry.path);
  const isModel = isModelPath(entry.path);
  const isAudio = isAudioPath(entry.path);
  const isDraggable = isDraggableAssetPath(entry.path);
  const isEmptyFile = entry.size === 0;
  const sourcePath = `${entry.root}/${entry.path}`;
  const kind = isEmptyFile ? 'empty' : isModel ? 'model' : isAudio ? 'audio' : 'other';
  const assetVersion =
    entry.size !== undefined && entry.modifiedAtMs !== undefined
      ? `${entry.size}:${Math.trunc(entry.modifiedAtMs)}`
      : undefined;

  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(ASSET_DND_TYPE, url);
    event.dataTransfer.setData('text/plain', url);
  };

  return (
    <div
      className={`ed-asset-card${isEmptyFile ? ' is-unavailable' : ''}`}
      title={assetCardTitle(sourcePath, kind)}
      draggable={isDraggable && !isEmptyFile}
      onDragStart={isDraggable && !isEmptyFile ? onDragStart : undefined}
    >
      <AssetThumb
        fileName={fileName}
        url={url}
        assetVersion={assetVersion}
        isModel={isModel}
        isAudio={isAudio}
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
  onRefresh,
  onFolderSelect,
}: {
  tree: FolderNode;
  selectedFolder: string;
  expanded: ReadonlySet<string>;
  onRefresh: () => void;
  onFolderSelect: (path: string, hasChildren: boolean, isExpanded: boolean) => void;
}): ReactElement {
  return (
    <div className="ed-project-side">
      <div className="ed-panel-title ed-project-tree-toolbar">
        <span>{selectedFolder === '' ? PROJECT_ROOT_LABEL : selectedFolder}</span>
        <div className="ed-panel-title-actions">
          <button
            type="button"
            className="ed-btn"
            title="Refresh assets"
            aria-label="Refresh assets"
            onClick={onRefresh}
          >
            ↻
          </button>
        </div>
      </div>
      <div className="ed-folder-tree">
        <FolderRow
          node={tree}
          depth={0}
          selectedFolder={selectedFolder}
          expanded={expanded}
          onSelect={onFolderSelect}
        />
      </div>
    </div>
  );
}

function ProjectAssetGrid({
  gridRef,
  selectedFolder,
  files,
  thumbByUrl,
  audioPreview,
  audioTick,
  onAudioToggle,
  onPreviewAnimationSource,
  onCreateItemPrefab,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  selectedFolder: string;
  files: ProjectAssetEntry[];
  thumbByUrl: Record<string, string>;
  audioPreview: EditorAudioPreviewController;
  audioTick: number;
  onAudioToggle: () => void;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
}): ReactElement {
  const folderLabel = selectedFolder === '' ? PROJECT_ROOT_LABEL : selectedFolder;
  return (
    <div className="ed-asset-browser-body">
      <div className="ed-panel-title ed-asset-browser-toolbar">
        <span>{folderLabel}</span>
      </div>
      <div className="ed-asset-grid" ref={gridRef}>
        {files.length === 0 ? (
          <div className="ed-empty-note">{emptyNoteForFolder(selectedFolder)}</div>
        ) : (
          files.map((entry) => {
            const url = assetUrlFor(entry.root, entry.path);
            return (
              <AssetCard
                key={`${entry.root}:${entry.path}`}
                entry={entry}
                thumbSrc={thumbByUrl[url]}
                audioPreview={audioPreview}
                audioTick={audioTick}
                onAudioToggle={onAudioToggle}
                onPreviewAnimationSource={onPreviewAnimationSource}
                onCreateItemPrefab={onCreateItemPrefab}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Project browser for the Rogue-style shell.
 * Renders two grid children (fragment): bottom-left Project|Console dock + center asset grid.
 */
export const ProjectPanel = forwardRef<ProjectPanelHandle, ProjectPanelProps>(
  function ProjectPanel(options, ref): ReactElement {
    const {
      getModelThumbnail,
      onPreviewAnimationSource,
      onCreateItemPrefab,
      audioPreview,
    } = options;

    const [tree, setTree] = useState<FolderNode>(() => emptyFolderNode());
    const [selectedFolder, setSelectedFolder] = useState('');
    const [expanded, setExpanded] = useState(() => new Set<string>(DEFAULT_EXPANDED_FOLDERS));
    const [bottomTab, setBottomTab] = useState<BottomLeftTab>('project');
    const [audioTick, bumpAudio] = useReducer((n: number) => n + 1, 0);

    const pendingFolderRef = useRef<string | null>(null);
    const treeRef = useRef(tree);
    treeRef.current = tree;
    const selectedFolderRef = useRef(selectedFolder);
    selectedFolderRef.current = selectedFolder;

    const gridRef = useRef<HTMLDivElement | null>(null);
    const { thumbByUrl, clearThumbs } = useLazyModelThumbs(
      gridRef,
      getModelThumbnail,
      selectedFolder,
      tree,
    );

    const load = useCallback(async (): Promise<void> => {
      let nextTree: FolderNode;
      try {
        nextTree = buildFolderTree(await fetchProjectAssetEntries());
      } catch (error) {
        showToast(`Asset listing failed: ${(error as Error).message}`, true);
        nextTree = emptyFolderNode();
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
      setSelectedFolder(nextSelected);
      clearThumbs();
    }, [clearThumbs]);

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
      }),
      [],
    );

    const onFolderSelect = useCallback(
      (path: string, hasChildren: boolean, isExpanded: boolean) => {
        setSelectedFolder(path);
        if (!hasChildren) return;
        setExpanded((prev) => {
          const next = new Set(prev);
          if (isExpanded) next.delete(path);
          else next.add(path);
          return next;
        });
      },
      [],
    );

    const files = sortedFolderFiles(findFolder(tree, selectedFolder) ?? tree);

    return (
      <>
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
                onRefresh={() => void load()}
                onFolderSelect={onFolderSelect}
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
        <div className="ed-asset-browser">
          <ProjectAssetGrid
            gridRef={gridRef}
            selectedFolder={selectedFolder}
            files={files}
            thumbByUrl={thumbByUrl}
            audioPreview={audioPreview}
            audioTick={audioTick}
            onAudioToggle={bumpAudio}
            onPreviewAnimationSource={onPreviewAnimationSource}
            onCreateItemPrefab={onCreateItemPrefab}
          />
        </div>
      </>
    );
  },
);
