/**
 * EditorHost Factory
 *
 * Creates an EditorHost instance for custom editors.
 * This bridges the EditorHost interface (from runtime) to TabEditor's machinery.
 */

import type { EditorHost, DiffConfig, DiffResult } from '@nimbalyst/runtime';

export interface EditorHostOptions {
  /** Absolute path to the file being edited */
  filePath: string;

  /** File name (for display) */
  fileName: string;

  /** Current theme */
  theme: 'light' | 'dark' | 'crystal-dark';

  /** Whether this editor's tab is active */
  isActive: boolean;

  /** Workspace identifier (if in a workspace) */
  workspaceId?: string;

  /** Read file content from disk as string */
  readFile: (path: string) => Promise<string>;

  /** Read file content from disk as binary */
  readBinaryFile: (path: string) => Promise<ArrayBuffer>;

  /** Subscribe to file changes. Returns the new content when file changes on disk. */
  subscribeToFileChanges: (
    callback: (newContent: string) => void
  ) => () => void;

  /** Report dirty state change to host */
  onDirtyChange: (isDirty: boolean) => void;

  /** Save content to disk */
  saveContent: (content: string | ArrayBuffer) => Promise<void>;

  /** Subscribe to save requests from host */
  subscribeToSaveRequests: (callback: () => void) => () => void;

  /** Open history dialog */
  openHistory: () => void;

  /** Optional: Subscribe to diff requests */
  subscribeToDiffRequests?: (
    callback: (config: DiffConfig) => void
  ) => () => void;

  /** Optional: Report diff result */
  reportDiffResult?: (result: DiffResult) => Promise<void>;

  /** Optional: Check if diff mode is active */
  isDiffModeActive?: () => boolean;

  // ============ SOURCE MODE (OPTIONAL) ============

  /** Whether this editor supports source mode */
  supportsSourceMode?: boolean;

  /** Toggle source mode on/off */
  toggleSourceMode?: () => void;

  /** Subscribe to source mode changes */
  subscribeToSourceModeChanges?: (
    callback: (isSourceMode: boolean) => void
  ) => () => void;

  /** Check if source mode is currently active */
  isSourceModeActive?: () => boolean;
}

/**
 * Create an EditorHost instance from TabEditor options.
 *
 * This factory creates a host object that implements the EditorHost interface
 * by wiring up to TabEditor's existing save/load/watch machinery.
 */
export function createEditorHost(options: EditorHostOptions): EditorHost {
  return {
    // ============ FILE INFO ============
    filePath: options.filePath,
    fileName: options.fileName,
    theme: options.theme,
    isActive: options.isActive,
    workspaceId: options.workspaceId,

    // ============ CONTENT LOADING ============
    async loadContent(): Promise<string> {
      return options.readFile(options.filePath);
    },

    async loadBinaryContent(): Promise<ArrayBuffer> {
      return options.readBinaryFile(options.filePath);
    },

    // ============ FILE CHANGE NOTIFICATIONS ============
    onFileChanged(callback: (newContent: string) => void): () => void {
      return options.subscribeToFileChanges(callback);
    },

    // ============ DIRTY STATE ============
    setDirty(isDirty: boolean): void {
      options.onDirtyChange(isDirty);
    },

    // ============ SAVING ============
    async saveContent(content: string | ArrayBuffer): Promise<void> {
      return options.saveContent(content);
    },

    // ============ SAVE REQUESTS ============
    onSaveRequested(callback: () => void): () => void {
      return options.subscribeToSaveRequests(callback);
    },

    // ============ HISTORY ============
    openHistory(): void {
      options.openHistory();
    },

    // ============ DIFF MODE (OPTIONAL) ============
    onDiffRequested: options.subscribeToDiffRequests
      ? (callback: (config: DiffConfig) => void) => options.subscribeToDiffRequests!(callback)
      : undefined,

    reportDiffResult: options.reportDiffResult
      ? (result: DiffResult) => {
          options.reportDiffResult!(result);
        }
      : undefined,

    isDiffModeActive: options.isDiffModeActive,

    // ============ SOURCE MODE (OPTIONAL) ============
    supportsSourceMode: options.supportsSourceMode,

    toggleSourceMode: options.toggleSourceMode,

    onSourceModeChanged: options.subscribeToSourceModeChanges
      ? (callback: (isSourceMode: boolean) => void) =>
          options.subscribeToSourceModeChanges!(callback)
      : undefined,

    isSourceModeActive: options.isSourceModeActive,
  };
}
