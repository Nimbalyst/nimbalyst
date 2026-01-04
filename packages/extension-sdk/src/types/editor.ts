/**
 * Types for custom editor extensions.
 *
 * The EditorHost interface is the primary API for custom editors.
 * External extensions should import from @nimbalyst/extension-sdk:
 *
 * ```typescript
 * import type { EditorHost, EditorHostProps } from '@nimbalyst/extension-sdk';
 * ```
 *
 * At runtime, Nimbalyst provides the implementation via the externals system.
 * Your extension code imports from @nimbalyst/runtime, which is externalized
 * and provided by the host.
 */

// ============================================================================
// EditorHost API - The primary API for custom editors
// ============================================================================

/**
 * Configuration for diff mode display (AI edit review)
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
 *
 * @example
 * ```tsx
 * import type { EditorHostProps } from '@nimbalyst/extension-sdk';
 *
 * function MyEditor({ host }: EditorHostProps) {
 *   useEffect(() => {
 *     host.loadContent().then(content => {
 *       // Parse and display content
 *     });
 *   }, [host]);
 *
 *   useEffect(() => {
 *     return host.onSaveRequested(async () => {
 *       const content = serialize(myData);
 *       await host.saveContent(content);
 *     });
 *   }, [host]);
 * }
 * ```
 */
export interface EditorHost {
  // ============ FILE INFO ============

  /** Absolute path to the file being edited */
  readonly filePath: string;

  /** File name (for display) */
  readonly fileName: string;

  /** Current theme */
  readonly theme: 'light' | 'dark' | 'crystal-dark';

  /** Whether this editor's tab is active */
  readonly isActive: boolean;

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
}

/**
 * Props for custom editor components using the EditorHost API.
 */
export interface EditorHostProps {
  /** Host service for all editor-host communication */
  host: EditorHost;
}

// ============================================================================
// Legacy API - Deprecated
// ============================================================================

/**
 * @deprecated Use EditorHostProps instead.
 *
 * The old CustomEditorProps used a pull-based model where the host would call
 * onGetContentReady to get content. The new EditorHost uses a push-based model
 * where the editor calls host.saveContent() directly.
 *
 * Old pattern (deprecated):
 * ```typescript
 * function MyEditor({ initialContent, onContentChange, onGetContentReady }: CustomEditorProps) {
 *   useEffect(() => {
 *     onGetContentReady?.(() => getContent());
 *   }, []);
 * }
 * ```
 *
 * New pattern (recommended):
 * ```typescript
 * import type { EditorHostProps } from '@nimbalyst/runtime';
 *
 * function MyEditor({ host }: EditorHostProps) {
 *   useEffect(() => {
 *     return host.onSaveRequested(async () => {
 *       const content = getContent();
 *       await host.saveContent(content);
 *     });
 *   }, [host]);
 * }
 * ```
 */
export interface CustomEditorProps {
  /** Absolute path to the file being edited */
  filePath: string;

  /** File name (basename) */
  fileName: string;

  /** Initial file content (may be empty for binary files) */
  initialContent: string;

  /** Current theme */
  theme: 'light' | 'dark' | 'crystal-dark';

  /** Whether this editor tab is currently active/focused */
  isActive: boolean;

  /** Workspace path (if in a workspace) */
  workspaceId?: string;

  /**
   * @deprecated Use host.setDirty() instead
   */
  onContentChange?: () => void;

  /**
   * @deprecated Use host.setDirty() instead
   */
  onDirtyChange?: (isDirty: boolean) => void;

  /**
   * @deprecated Use host.onSaveRequested() and host.saveContent() instead
   */
  onGetContentReady?: (getContentFn: () => string) => void;

  /** Called when user requests to view file history */
  onViewHistory?: () => void;

  /** Called when user requests to rename the document */
  onRenameDocument?: () => void;
}

/**
 * For editors that support the Monaco-style wrapper interface.
 */
export interface EditorWrapper {
  /** Get current content */
  getContent: () => string;

  /** Set content programmatically */
  setContent: (content: string) => void;

  /** Focus the editor */
  focus: () => void;
}
