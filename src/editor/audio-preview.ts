import { playAudioPreview, type AudioPreviewHandle } from '../audio/sfx';

export interface EditorAudioPreviewController {
  isPlaying: (key: string) => boolean;
  toggle: (
    key: string,
    url: string,
    options: { loop?: boolean; volume?: number },
    onStateChange?: (playing: boolean) => void,
  ) => void;
  stop: () => void;
}

export function createEditorAudioPreviewController(): EditorAudioPreviewController {
  let active: {
    key: string;
    handle: AudioPreviewHandle;
    onStateChange?: (playing: boolean) => void;
  } | null = null;

  function stop(): void {
    const current = active;
    active = null;
    current?.handle.stop();
    current?.onStateChange?.(false);
  }

  return {
    isPlaying(key) {
      return active?.key === key;
    },
    toggle(key, url, options, onStateChange) {
      if (active?.key === key) {
        stop();
        return;
      }
      stop();
      const handle = playAudioPreview(url, {
        ...options,
        onEnded: () => {
          if (active?.key !== key) return;
          active = null;
          onStateChange?.(false);
        },
      });
      active = { key, handle, onStateChange };
      onStateChange?.(true);
    },
    stop,
  };
}
