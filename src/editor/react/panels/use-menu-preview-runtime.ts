import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { clearShipWorld } from '../../../flight/ship-world';
import type { HaloBandTab } from '../../../render/effects/hud/haloband';
import type { MenuPreviewId } from '../../menus/catalog';
import {
  createFreshMenuPreviewContext,
  disposeMenuPreviewHost,
  mountMenuPreview,
  pushHaloBandWorld,
  type MountedMenuPreview,
} from '../../panels/menu-manager-preview';

export function useMenuPreviewRuntime(
  previewHostRef: RefObject<HTMLDivElement | null>,
  activeMenuId: MenuPreviewId,
  shipMode: boolean,
  activeHaloBandTab: HaloBandTab,
): {
  activate: () => void;
  deactivate: () => void;
} {
  const activeRef = useRef(false);
  const activeMenuIdRef = useRef(activeMenuId);
  const shipModeRef = useRef(shipMode);
  const activeHaloBandTabRef = useRef(activeHaloBandTab);
  const previewRef = useRef<MountedMenuPreview | null>(null);
  const previewCtxRef = useRef(createFreshMenuPreviewContext());

  activeMenuIdRef.current = activeMenuId;
  shipModeRef.current = shipMode;
  activeHaloBandTabRef.current = activeHaloBandTab;

  const disposePreview = useCallback((): void => {
    previewRef.current?.dispose();
    previewRef.current = null;
    const host = previewHostRef.current;
    if (host) disposeMenuPreviewHost(host);
    else clearShipWorld();
  }, [previewHostRef]);

  const mountActiveMenu = useCallback((): void => {
    const host = previewHostRef.current;
    if (!host) return;
    disposePreview();
    previewCtxRef.current = createFreshMenuPreviewContext();
    previewRef.current = mountMenuPreview(
      host,
      activeMenuIdRef.current,
      previewCtxRef.current,
      shipModeRef.current,
    );
    if (previewRef.current.haloBand) {
      previewRef.current.haloBand.setActiveTab(activeHaloBandTabRef.current);
    }
  }, [disposePreview, previewHostRef]);

  const activate = useCallback((): void => {
    if (activeRef.current) return;
    activeRef.current = true;
    mountActiveMenu();
  }, [mountActiveMenu]);

  const deactivate = useCallback((): void => {
    if (!activeRef.current) return;
    activeRef.current = false;
    disposePreview();
  }, [disposePreview]);

  useEffect(() => {
    if (!activeRef.current) return;
    mountActiveMenu();
  }, [activeMenuId, mountActiveMenu]);

  useEffect(() => {
    const haloBand = previewRef.current?.haloBand;
    if (!haloBand || activeMenuId !== 'haloband') return;
    pushHaloBandWorld(haloBand, shipMode);
  }, [shipMode, activeMenuId]);

  useEffect(() => {
    const haloBand = previewRef.current?.haloBand;
    if (!haloBand || activeMenuId !== 'haloband') return;
    haloBand.setActiveTab(activeHaloBandTab);
  }, [activeHaloBandTab, activeMenuId]);

  useEffect(() => {
    return () => {
      disposePreview();
    };
  }, [disposePreview]);

  return { activate, deactivate };
}
