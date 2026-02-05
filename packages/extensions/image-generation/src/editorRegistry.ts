/**
 * Editor Registry
 *
 * Maintains a registry of active image project editors for AI tool access.
 */

import type { ImageProject, ImageStyle, AspectRatio } from './types';

/**
 * Reference image that can be passed to guide generation
 */
export interface ReferenceImage {
  /** Absolute file path to the image */
  filePath: string;
}

/**
 * API exposed by the editor for AI tool access
 */
export interface ImageProjectEditorAPI {
  getProject: () => ImageProject;
  updateProject: (updater: (prev: ImageProject) => ImageProject) => void;
  generate: (
    prompt: string,
    style: ImageStyle,
    aspectRatio: AspectRatio,
    variations: number,
    referenceImages?: ReferenceImage[]
  ) => Promise<void>;
}

/**
 * Registry of active editors by file path
 */
const editors = new Map<string, ImageProjectEditorAPI>();

/**
 * Register an editor instance
 */
export function registerEditor(filePath: string, api: ImageProjectEditorAPI): void {
  editors.set(filePath, api);
  console.log('[ImageGen] Registered editor:', filePath);
}

/**
 * Unregister an editor instance
 */
export function unregisterEditor(filePath: string): void {
  editors.delete(filePath);
  console.log('[ImageGen] Unregistered editor:', filePath);
}

/**
 * Get an editor API by file path
 */
export function getEditorAPI(filePath?: string): ImageProjectEditorAPI | undefined {
  if (!filePath) {
    // Return the first available editor if no path specified
    const firstEntry = editors.entries().next();
    return firstEntry.done ? undefined : firstEntry.value[1];
  }
  return editors.get(filePath);
}

/**
 * Get all registered editor paths
 */
export function getRegisteredEditors(): string[] {
  return Array.from(editors.keys());
}
