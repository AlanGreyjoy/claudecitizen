/**
 * Persistent model thumbnail cache via the Electron `/__editor` API.
 * Files live under userData/model-thumbnails/ (main process) — not IndexedDB,
 * which did not survive editor restarts reliably.
 */

export async function getCachedModelThumbnail(key: string): Promise<string | null> {
  if (!key) return null;
  try {
    const response = await fetch(
      `/__editor/model-thumbnail?key=${encodeURIComponent(key)}`,
    );
    const payload = (await response.json().catch(() => null)) as
      | { dataUrl?: string | null; error?: string }
      | null;
    if (!response.ok || !payload) return null;
    return typeof payload.dataUrl === 'string' && payload.dataUrl ? payload.dataUrl : null;
  } catch {
    return null;
  }
}

export async function putCachedModelThumbnail(key: string, dataUrl: string): Promise<void> {
  if (!key || !dataUrl) return;
  try {
    await fetch('/__editor/model-thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, dataUrl }),
    });
  } catch {
    // Cache writes are best-effort; a miss only costs one WebGPU re-render.
  }
}
