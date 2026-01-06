/**
 * Editor Registry
 *
 * Maintains references to active Excalidraw editors for AI tool access.
 */

import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';

interface EditorInstance {
  filePath: string;
  api: ExcalidrawImperativeAPI;
}

const editorRegistry = new Map<string, EditorInstance>();

export function registerEditor(filePath: string, api: ExcalidrawImperativeAPI) {
  editorRegistry.set(filePath, { filePath, api });
}

export function unregisterEditor(filePath: string) {
  editorRegistry.delete(filePath);
}

export function getEditorAPI(filePath?: string): ExcalidrawImperativeAPI | null {
  if (filePath && editorRegistry.has(filePath)) {
    return editorRegistry.get(filePath)!.api;
  }
  // If no specific path, try to get the first/only active editor
  if (editorRegistry.size === 1) {
    return editorRegistry.values().next().value?.api ?? null;
  }
  return null;
}

// Expose for E2E testing
if (typeof window !== 'undefined') {
  (window as any).__excalidraw_getEditorAPI = getEditorAPI;
}
