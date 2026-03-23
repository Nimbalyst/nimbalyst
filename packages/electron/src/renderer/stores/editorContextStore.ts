/**
 * Editor Context Store
 *
 * Module-level store for extension-provided editor context.
 * Extensions call host.setEditorContext() to push context here.
 * The chat panel reads it via getEditorContext() and includes it
 * in the AI prompt.
 *
 * Uses useSyncExternalStore-compatible API (subscribe/getSnapshot).
 */

import type { EditorContext } from '@nimbalyst/runtime';

export interface EditorContextEntry {
  filePath: string;
  context: EditorContext;
  timestamp: number;
}

// Module-level state
let currentEntry: EditorContextEntry | null = null;
let listeners: Set<() => void> = new Set();
let snapshotVersion = 0;

/**
 * Set editor context for a file. Called by TabEditor when the extension
 * calls host.setEditorContext().
 */
export function setEditorContext(filePath: string, context: EditorContext | null): void {
  if (context) {
    currentEntry = { filePath, context, timestamp: Date.now() };
  } else if (currentEntry?.filePath === filePath) {
    // Only clear if it's the same file (don't clear another editor's context)
    currentEntry = null;
  }
  snapshotVersion++;
  listeners.forEach((listener) => listener());
}

/**
 * Clear editor context for a specific file (e.g., when tab closes).
 */
export function clearEditorContext(filePath: string): void {
  if (currentEntry?.filePath === filePath) {
    currentEntry = null;
    snapshotVersion++;
    listeners.forEach((listener) => listener());
  }
}

/**
 * Get current editor context.
 */
export function getEditorContext(): EditorContextEntry | null {
  return currentEntry;
}

/**
 * Subscribe to editor context changes (useSyncExternalStore compatible).
 */
export function subscribeEditorContext(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Get snapshot version (useSyncExternalStore compatible).
 */
export function getEditorContextSnapshot(): number {
  return snapshotVersion;
}
