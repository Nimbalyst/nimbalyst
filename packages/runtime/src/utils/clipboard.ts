/**
 * Copy text to clipboard reliably in Electron.
 *
 * navigator.clipboard.writeText() can silently fail in Electron - the promise
 * resolves but nothing is written to the system clipboard. This helper uses
 * Electron's native clipboard module via IPC when available, falling back to
 * the web API for non-Electron contexts.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Prefer Electron's native clipboard (always works, no focus requirement)
  const electronAPI = (window as any).electronAPI;
  if (electronAPI?.copyToClipboard) {
    await electronAPI.copyToClipboard(text);
    return;
  }

  // Fallback for non-Electron contexts
  await navigator.clipboard.writeText(text);
}
