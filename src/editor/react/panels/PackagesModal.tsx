import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  fetchEnginePackages,
  type EnginePackageInfo,
} from '../../api';
import {
  getDesktopEditorBridge,
  openExternalUrl,
  type DesktopPackageState,
} from '../../../platform/editor-desktop';
import { DeployDialogShell, stopKeyPropagation } from './deploy/DeployDialogParts';

const COPY =
  'Engine tools installed under ~/.asteron/tools/. '
  + 'KTX-Software encodes Basis/KTX2 twins for File → Build Web derived assets.';

function stateLabel(pkg: EnginePackageInfo): string {
  if (pkg.state === 'installed') return 'Installed';
  if (pkg.state === 'outdated') return 'Update available';
  if (pkg.pathSource === 'path' || pkg.pathSource === 'env') {
    return `Available via ${pkg.pathSource}`;
  }
  return 'Not installed';
}

function UnavailableDialog({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <DeployDialogShell
      title="Packages"
      copy="Installing engine tools needs the desktop editor and is unavailable in the browser build."
      status={{ message: '', isError: false }}
      onClose={onClose}
      busy={false}
      actions={
        <button type="button" className="ed-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <span />
    </DeployDialogShell>
  );
}

/** Tools → Packages…. Managed native tool installs (KTX-Software today). */
export function PackagesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement | null {
  const bridge = getDesktopEditorBridge();
  const [packages, setPackages] = useState<EnginePackageInfo[]>([]);
  const [status, setStatus] = useState<{ message: string; isError: boolean }>({
    message: '',
    isError: false,
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPackages(await fetchEnginePackages());
    } catch (error) {
      setStatus({
        message: error instanceof Error ? error.message : 'Failed to load packages.',
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !bridge) return;
    return bridge.onPackageState((event: DesktopPackageState) => {
      if (event.phase === 'error') {
        setStatus({ message: event.message, isError: true });
        setBusy(false);
        return;
      }
      if (event.phase === 'success') {
        setStatus({ message: event.message, isError: false });
        setBusy(false);
        if (event.package) setPackages([event.package]);
        else void refresh();
        return;
      }
      setBusy(true);
      setStatus({ message: event.message, isError: false });
    });
  }, [open, bridge, refresh]);

  if (!open) return null;
  if (!bridge) return <UnavailableDialog onClose={onClose} />;

  const ktx = packages.find((entry) => entry.id === 'ktx-software') ?? null;

  return (
    <DeployDialogShell
      title="Packages"
      copy={COPY}
      status={status}
      onClose={onClose}
      busy={busy}
      actions={
        <button type="button" className="ed-btn" disabled={busy} onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="ed-packages-list" onKeyDown={stopKeyPropagation}>
        {loading && packages.length === 0 ? (
          <div className="ed-system-status">Loading packages…</div>
        ) : null}
        {ktx ? (
          <div className="ed-packages-row">
            <div className="ed-packages-row-main">
              <div className="ed-packages-name">{ktx.name}</div>
              <div className="ed-packages-desc">{ktx.description}</div>
              <div className="ed-packages-meta">
                Pin {ktx.version}
                {' · '}
                {stateLabel(ktx)}
                {ktx.versionLabel ? ` · ${ktx.versionLabel}` : ''}
              </div>
            </div>
            <div className="ed-packages-row-actions">
              {ktx.state === 'missing' || ktx.state === 'outdated' ? (
                <button
                  type="button"
                  className="ed-btn ed-btn-accent"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setStatus({ message: 'Installing KTX-Software…', isError: false });
                    void bridge.installKtxPackage().then((result) => {
                      if (!result.ok) {
                        setStatus({ message: result.message, isError: true });
                        setBusy(false);
                      }
                    });
                  }}
                >
                  {ktx.state === 'outdated' ? 'Update' : 'Install'}
                </button>
              ) : null}
              {ktx.state === 'installed' || ktx.state === 'outdated' ? (
                <button
                  type="button"
                  className="ed-btn"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void bridge.uninstallKtxPackage().then((result) => {
                      if (!result.ok) {
                        setStatus({ message: result.message, isError: true });
                        setBusy(false);
                      }
                    });
                  }}
                >
                  Uninstall
                </button>
              ) : null}
              <button
                type="button"
                className="ed-btn"
                disabled={busy}
                onClick={() => openExternalUrl(ktx.releasesUrl)}
              >
                Releases
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </DeployDialogShell>
  );
}
