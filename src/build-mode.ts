/**
 * Authoring features are available in Vite development and in the dedicated
 * Electron editor build (`vite build --mode editor`). Public game builds keep
 * the editor, local source-file APIs, and offline preview routes unreachable.
 */
export const AUTHORING_ENABLED =
  import.meta.env.DEV || import.meta.env.MODE === 'editor';
