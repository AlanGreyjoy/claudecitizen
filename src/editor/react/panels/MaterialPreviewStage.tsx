import { useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react';
import type * as THREE from 'three';
import { ASSET_DND_TYPE } from '../../api';
import { isModelAssetUrl } from '../../panels/inspector-logic';
import type { MaterialValues } from '../../panels/material-manager';
import {
  createMaterialPreview,
  type MaterialPreviewBackdrop,
  type MaterialPreviewHandle,
  type MaterialPreviewShape,
} from '../../panels/material-preview';

const SHAPES: ReadonlyArray<{ id: MaterialPreviewShape; label: string; title: string }> = [
  { id: 'sphere', label: 'Sphere', title: 'Sphere' },
  { id: 'cube', label: 'Cube', title: 'Cube' },
  { id: 'cylinder', label: 'Cyl', title: 'Cylinder' },
  { id: 'plane', label: 'Plane', title: 'Flat plane — best for reading texture detail' },
  { id: 'knot', label: 'Knot', title: 'Torus knot — curvature and highlight falloff' },
];

const BACKDROPS: ReadonlyArray<{
  id: MaterialPreviewBackdrop;
  label: string;
  title: string;
}> = [
  { id: 'checker', label: 'Checker', title: 'Checker — shows alpha' },
  { id: 'studio', label: 'Studio', title: 'Studio gradient with floor' },
  { id: 'dark', label: 'Dark', title: 'Flat dark — isolates emissive' },
];

type MaterialPreviewStageProps = {
  values: MaterialValues;
  source: THREE.Material | null;
  maps: readonly string[];
};

/**
 * `dataTransfer.getData` is blocked during dragover (protected mode) — only the
 * type list is readable, so accepting the drop has to be decided from that.
 */
function dragCarriesAsset(event: DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer.types;
  return types.includes(ASSET_DND_TYPE) || types.includes('text/plain');
}

function assetUrlFromDrag(event: DragEvent<HTMLElement>): string | null {
  const payload =
    event.dataTransfer.getData(ASSET_DND_TYPE) ||
    event.dataTransfer.getData('text/plain');
  return payload && isModelAssetUrl(payload) ? payload : null;
}

function meshLabel(url: string): string {
  const file = url.split(/[?#]/, 1)[0].split('/').pop() ?? url;
  return file.replace(/\.(glb|gltf)$/i, '');
}

/**
 * Live material stage. Mounts the Three.js preview once and pushes value edits
 * straight at it, so slider drags repaint at frame rate instead of waiting for
 * a document commit.
 */
export function MaterialPreviewStage({
  values,
  source,
  maps,
}: MaterialPreviewStageProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<MaterialPreviewHandle | null>(null);
  const [shape, setShape] = useState<MaterialPreviewShape>('sphere');
  const [backdrop, setBackdrop] = useState<MaterialPreviewBackdrop>('checker');
  const [spin, setSpin] = useState(true);
  const [customMesh, setCustomMesh] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [meshError, setMeshError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const preview = createMaterialPreview(host);
    previewRef.current = preview;
    return () => {
      preview.dispose();
      previewRef.current = null;
    };
  }, []);

  useEffect(() => {
    previewRef.current?.setSource(source);
  }, [source]);
  useEffect(() => {
    previewRef.current?.setValues(values);
  }, [values]);
  useEffect(() => {
    previewRef.current?.setShape(shape);
  }, [shape]);
  useEffect(() => {
    setMeshError(null);
    void previewRef.current?.setCustomMesh(customMesh)?.catch(() => {
      setMeshError('Could not load that model');
      setCustomMesh(null);
    });
  }, [customMesh]);
  useEffect(() => {
    previewRef.current?.setBackdrop(backdrop);
  }, [backdrop]);
  useEffect(() => {
    previewRef.current?.setSpin(spin);
  }, [spin]);

  return (
    <div className="ed-material-stage">
      <div
        ref={hostRef}
        className={`ed-material-stage-canvas${dropActive ? ' is-drop-target' : ''}`}
        title="Drag to orbit · wheel to zoom · drop a .glb to preview on it"
        onDragOver={(event) => {
          if (!dragCarriesAsset(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropActive(true);
          if (meshError) setMeshError(null);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(event) => {
          setDropActive(false);
          const url = assetUrlFromDrag(event);
          if (!url) {
            setMeshError('Drop a .glb or .gltf model');
            return;
          }
          event.preventDefault();
          setCustomMesh(url);
        }}
      />
      <div className="ed-material-stage-bar">
        <div className="ed-material-chipset">
          {SHAPES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.title}
              className={`ed-material-chip${
                shape === entry.id && !customMesh ? ' is-active' : ''
              }`}
              onClick={() => {
                setCustomMesh(null);
                setShape(entry.id);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {customMesh ? (
          <div className="ed-material-chipset">
            <button
              type="button"
              title={`${customMesh} — click to go back to ${shape}`}
              className="ed-material-chip is-active ed-material-chip-mesh"
              onClick={() => setCustomMesh(null)}
            >
              {meshLabel(customMesh)} ✕
            </button>
          </div>
        ) : null}
        {meshError ? (
          <div className="ed-material-stage-error">{meshError}</div>
        ) : null}
        <div className="ed-material-chipset">
          {BACKDROPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.title}
              className={`ed-material-chip${backdrop === entry.id ? ' is-active' : ''}`}
              onClick={() => setBackdrop(entry.id)}
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            title={spin ? 'Stop rotation' : 'Start rotation'}
            className={`ed-material-chip${spin ? ' is-active' : ''}`}
            onClick={() => setSpin((current) => !current)}
          >
            Spin
          </button>
        </div>
      </div>
      {maps.length > 0 ? (
        <div className="ed-material-maps">
          {maps.map((map) => (
            <span key={map} className="ed-material-map" title={`${map} map present`}>
              {map}
            </span>
          ))}
        </div>
      ) : (
        <div className="ed-material-maps">
          <span className="ed-material-map is-empty">No texture maps</span>
        </div>
      )}
    </div>
  );
}
