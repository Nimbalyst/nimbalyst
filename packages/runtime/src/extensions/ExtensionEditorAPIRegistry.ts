/**
 * Extension Editor API Registry
 *
 * Central registry for extension editor imperative APIs. When an extension editor
 * mounts and its library initializes, the extension calls host.registerEditorAPI(api)
 * to make its API available for AI tool execution.
 *
 * This replaces the pattern where each extension maintained its own module-level
 * Map + window global (e.g., window.__excalidraw_getEditorAPI).
 *
 * The HiddenTabManager uses this registry to detect when an editor has finished
 * initializing (API is registered = editor is ready for tool calls).
 */

interface RegistryEntry {
  api: unknown;
  /** Trigger an immediate save of the editor's content to disk. */
  flushSave?: () => void;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register an editor API for a file path.
 * Called by EditorHost.registerEditorAPI() when extensions report readiness.
 * @param flushSave Optional callback to trigger an immediate save (used after tool execution).
 */
export function registerEditorAPI(filePath: string, api: unknown, flushSave?: () => void): void {
  registry.set(filePath, { api, flushSave });
}

/**
 * Unregister an editor API for a file path.
 * Called when an editor unmounts.
 */
export function unregisterEditorAPI(filePath: string): void {
  registry.delete(filePath);
}

/**
 * Get the registered editor API for a file path.
 */
export function getEditorAPI(filePath: string): unknown | undefined {
  return registry.get(filePath)?.api;
}

/**
 * Check if an editor API is registered for a file path.
 */
export function hasEditorAPI(filePath: string): boolean {
  return registry.has(filePath);
}

/**
 * Trigger an immediate save for the editor at the given file path.
 * Called by the bridge after tool execution to prevent data loss
 * when the user closes the tab before the normal auto-save fires.
 */
export function flushEditorSave(filePath: string): void {
  registry.get(filePath)?.flushSave?.();
}
