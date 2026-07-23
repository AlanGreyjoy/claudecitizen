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
import { attachColumnSplitter, PANEL_SIZE_BOUNDS } from '../../panel_resize';
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

export interface ProjectPanelOptions {
  /** Render a thumbnail data-url for a model asset (provided by render/editor). */
  getModelThumbnail: (url: string) => Promise<string>;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onPreviewCharacter: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
  audioPreview: EditorAudioPreviewController;
}

export interface ProjectPanelHandle {
  /** Select and expand a folder path in the Project tree (e.g. `protected/animations`). */
  selectFolder: (folderPath: string) => void;
}

export type ProjectPanelProps = ProjectPanelOptions;

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
  isModel,
  isAudio,
  isEmptyFile,
  thumbSrc,
}: {
  fileName: string;
  url: string;
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
  onPreviewCharacter,
  onPreviewAnimationSource,
  onCreateItemPrefab,
}: {
  url: string;
  isEmptyFile: boolean;
  canCreateItem: boolean;
  onPreviewCharacter: (url: string) => void | Promise<void>;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
}): ReactElement {
  return (
    <>
      <div className="ed-asset-actions">
        <button
          type="button"
          className="ed-asset-action"
          title={isEmptyFile ? 'File is empty' : 'Load in character preview'}
          disabled={isEmptyFile}
          onClick={runAssetAction('Character preview', isEmptyFile, onPreviewCharacter, url)}
        >
          Character
        </button>
        <button
          type="button"
          className="ed-asset-action"
          title={isEmptyFile ? 'File is empty' : 'Load animation clips in character preview'}
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
  onPreviewCharacter,
  onPreviewAnimationSource,
  onCreateItemPrefab,
}: {
  entry: ProjectAssetEntry;
  thumbSrc: string | undefined;
  audioPreview: EditorAudioPreviewController;
  audioTick: number;
  onAudioToggle: () => void;
  onPreviewCharacter: (url: string) => void | Promise<void>;
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
          onPreviewCharacter={onPreviewCharacter}
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
  getModelThumbnail: (url: string) => Promise<string>,
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
          observer.unobserve(thumb);
          delete thumb.dataset.thumbUrl;
          delete thumb.dataset.thumbAlt;
          void getModelThumbnail(url).then((dataUrl) => {
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

function ProjectSide({
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
      <div className="ed-panel-title">
        <span>Project</span>
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
  onPreviewCharacter,
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
  onPreviewCharacter: (url: string) => void | Promise<void>;
  onPreviewAnimationSource: (url: string) => void | Promise<void>;
  onCreateItemPrefab: (url: string) => void | Promise<void>;
}): ReactElement {
  return (
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
              onPreviewCharacter={onPreviewCharacter}
              onPreviewAnimationSource={onPreviewAnimationSource}
              onCreateItemPrefab={onCreateItemPrefab}
            />
          );
        })
      )}
    </div>
  );
}

/**
 * Project browser panel. Mount inside a host with class `ed-project`
 * (shell layout owns that grid cell); this component fills it with side / splitter / grid.
 */
export const ProjectPanel = forwardRef<ProjectPanelHandle, ProjectPanelProps>(
  function ProjectPanel(options, ref): ReactElement {
    const {
      getModelThumbnail,
      onPreviewAnimationSource,
      onPreviewCharacter,
      onCreateItemPrefab,
      audioPreview,
    } = options;

    const [tree, setTree] = useState<FolderNode>(() => emptyFolderNode());
    const [selectedFolder, setSelectedFolder] = useState('');
    const [expanded, setExpanded] = useState(() => new Set<string>(DEFAULT_EXPANDED_FOLDERS));
    const [audioTick, bumpAudio] = useReducer((n: number) => n + 1, 0);

    const pendingFolderRef = useRef<string | null>(null);
    const treeRef = useRef(tree);
    treeRef.current = tree;
    const selectedFolderRef = useRef(selectedFolder);
    selectedFolderRef.current = selectedFolder;

    const splitterRef = useRef<HTMLDivElement | null>(null);
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

    useEffect(() => {
      const splitter = splitterRef.current;
      const project = splitter?.parentElement;
      if (!project || !splitter) return;
      attachColumnSplitter(splitter, project, '--ed-project-side-width', {
        ...PANEL_SIZE_BOUNDS.projectSideWidth,
        storageKey: 'projectSideWidth',
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        selectFolder(folderPath: string) {
          if (!findFolder(treeRef.current, folderPath)) {
            pendingFolderRef.current = folderPath;
            return;
          }
          pendingFolderRef.current = null;
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
        <ProjectSide
          tree={tree}
          selectedFolder={selectedFolder}
          expanded={expanded}
          onRefresh={() => void load()}
          onFolderSelect={onFolderSelect}
        />
        <div className="ed-splitter ed-splitter-col" ref={splitterRef} />
        <ProjectAssetGrid
          gridRef={gridRef}
          selectedFolder={selectedFolder}
          files={files}
          thumbByUrl={thumbByUrl}
          audioPreview={audioPreview}
          audioTick={audioTick}
          onAudioToggle={bumpAudio}
          onPreviewCharacter={onPreviewCharacter}
          onPreviewAnimationSource={onPreviewAnimationSource}
          onCreateItemPrefab={onCreateItemPrefab}
        />
      </>
    );
  },
);
