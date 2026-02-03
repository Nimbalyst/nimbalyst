/**
 * EditorHost Interface
 *
 * Provides all communication between custom editors and the host (TabEditor).
 * This interface lives in runtime so extensions can depend on it without
 * Electron-specific dependencies.
 *
 * Editors receive an EditorHost as a prop and use it for all host interactions:
 * - Loading content from disk
 * - Subscribing to file change notifications
 * - Saving content
 * - Reporting dirty state
 * - Opening history dialog
 * - Handling diff mode (optional)
 */

import type { ExtensionStorage } from './types';

/**
 * Menu item that can be added to the editor's "..." actions menu.
 * Extensions can register these to add custom actions to the header bar.
 */
export interface EditorMenuItem {
  /** Display text for the menu item */
  label: string;

  /** Optional Material Symbols icon name (e.g., 'cloud_upload', 'settings') */
  icon?: string;

  /** Callback when the menu item is clicked */
  onClick: () => void;
}

/**
 * Configuration for diff mode display
 */
export interface DiffConfig {
  /** Pre-edit content (the baseline before AI changes) */
  originalContent: string;

  /** AI's proposed content (what's now on disk) */
  modifiedContent: string;

  /** History tag ID for tracking this diff */
  tagId: string;

  /** AI session ID that made the edit */
  sessionId: string;
}

/**
 * Result of accepting/rejecting a diff
 */
export interface DiffResult {
  /** The content after user's decision */
  content: string;

  /** Whether user accepted or rejected the changes */
  action: 'accept' | 'reject';
}

/**
 * Host service for custom editors.
 *
 * Provides all communication between editor and host (TabEditor).
 * Editors receive this as a prop and use it for all host interactions.
 */
export interface EditorHost {
  // ============ FILE INFO ============

  /** Absolute path to the file being edited */
  readonly filePath: string;

  /** File name (for display) */
  readonly fileName: string;

  /** Current theme */
  readonly theme: string;

  /** Whether this editor's tab is active */
  readonly isActive: boolean;

  // ============ THEME CHANGES ============

  /**
   * Subscribe to theme changes.
   * Called when the application theme changes.
   * Editor should update its visual appearance in response.
   *
   * @param callback Called with new theme when it changes
   * @returns Unsubscribe function
   */
  onThemeChanged(callback: (theme: string) => void): () => void;

  /** Workspace identifier (if in a workspace) */
  readonly workspaceId?: string;

  // ============ CONTENT LOADING ============

  /**
   * Load file content from disk as a string.
   * Editor should call this on mount instead of receiving initialContent.
   * For text files (code, markdown, HTML, etc.)
   */
  loadContent(): Promise<string>;

  /**
   * Load file content from disk as binary data.
   * For binary files (PDFs, images, etc.)
   * Returns an ArrayBuffer containing the raw file bytes.
   */
  loadBinaryContent(): Promise<ArrayBuffer>;

  // ============ FILE CHANGE NOTIFICATIONS ============

  /**
   * Subscribe to file change notifications.
   * Called when the file changes on disk (external edit, AI edit, etc.)
   *
   * Editor decides whether to reload based on comparing against its
   * last known disk state. Returns unsubscribe function.
   *
   * @param callback Called with new content when file changes
   * @returns Unsubscribe function
   */
  onFileChanged(callback: (newContent: string) => void): () => void;

  // ============ DIRTY STATE ============

  /**
   * Report dirty state to host.
   * Host uses this for tab indicator and save prompts.
   */
  setDirty(isDirty: boolean): void;

  // ============ SAVING ============

  /**
   * Save content to disk.
   * Editor calls this when it wants to save (autosave, manual save, etc.)
   * Host handles writing to disk and creating history snapshots.
   * Content can be string (text files) or ArrayBuffer (binary files).
   */
  saveContent(content: string | ArrayBuffer): Promise<void>;

  // ============ SAVE REQUESTS ============

  /**
   * Subscribe to save requests from the host.
   * Host calls this when autosave timer fires or user triggers manual save.
   * Editor should call saveContent() in response.
   * Returns unsubscribe function.
   */
  onSaveRequested(callback: () => void): () => void;

  // ============ HISTORY ============

  /**
   * Open history dialog for this file.
   */
  openHistory(): void;

  // ============ DIFF MODE (OPTIONAL) ============

  /**
   * Subscribe to diff mode requests.
   * Called when AI edits are pending review.
   * Only implement if editor supports diff display.
   *
   * @param callback Called with diff config when diff should be shown
   * @returns Unsubscribe function
   */
  onDiffRequested?(callback: (config: DiffConfig) => void): () => void;

  /**
   * Report diff result when user accepts or rejects.
   * Host will save the resulting content and update history.
   */
  reportDiffResult?(result: DiffResult): void;

  /**
   * Check if diff mode is currently active.
   */
  isDiffModeActive?(): boolean;

  /**
   * Subscribe to diff mode being cleared externally.
   * Called when the user accepts/rejects diff via the unified diff header.
   * Editor should clear its diff state when this fires.
   *
   * @param callback Called when diff mode should be cleared
   * @returns Unsubscribe function
   */
  onDiffCleared?(callback: () => void): () => void;

  // ============ SOURCE MODE (OPTIONAL) ============

  /**
   * Request to toggle source mode on/off.
   * When source mode is active, TabEditor renders Monaco to edit raw source
   * instead of the custom editor's visual representation.
   *
   * Only available if supportsSourceMode is true.
   */
  toggleSourceMode?(): void;

  /**
   * Subscribe to source mode state changes.
   * Called when source mode is toggled (either by editor request or external).
   *
   * @param callback Called with new source mode state
   * @returns Unsubscribe function
   */
  onSourceModeChanged?(callback: (isSourceMode: boolean) => void): () => void;

  /**
   * Check if source mode is currently active.
   */
  isSourceModeActive?(): boolean;

  /**
   * Whether this editor supports source mode.
   * If true, a "View Source" button will be available.
   */
  readonly supportsSourceMode?: boolean;

  // ============ CONFIGURATION (OPTIONAL) ============

  /**
   * Get a configuration value for the extension.
   * Only available if the extension has configuration contributions defined.
   * Returns the workspace value if set, otherwise the user value, otherwise the default.
   */
  getConfig?<T>(key: string, defaultValue?: T): T;

  // ============ STORAGE ============

  /**
   * Namespaced storage for persisting editor state.
   * Automatically scoped to this extension.
   * Use for preferences, history, cached data, etc.
   */
  readonly storage: ExtensionStorage;

  // ============ MENU ITEMS ============

  /**
   * Register menu items to appear in the editor's "..." actions menu.
   * Items appear in a dedicated "Extension" section of the dropdown.
   *
   * Call this once during editor initialization.
   * Call again with an empty array to remove all items.
   *
   * @param items Array of menu items to register
   *
   * @example
   * ```tsx
   * useEffect(() => {
   *   host.registerMenuItems([
   *     {
   *       label: 'Save to Cloud',
   *       icon: 'cloud_upload',
   *       onClick: () => saveToCloud()
   *     },
   *     {
   *       label: 'Export as PDF',
   *       icon: 'picture_as_pdf',
   *       onClick: () => exportPdf()
   *     }
   *   ]);
   *
   *   return () => host.registerMenuItems([]); // Cleanup
   * }, [host]);
   * ```
   */
  registerMenuItems(items: EditorMenuItem[]): void;
}

/**
 * Props for custom editor components using the new EditorHost API.
 */
export interface EditorHostProps {
  /** Host service for all editor-host communication */
  host: EditorHost;
}
