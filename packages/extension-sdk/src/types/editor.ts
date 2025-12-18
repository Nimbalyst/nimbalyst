/**
 * Types for custom editor extensions.
 */

/**
 * Props passed to custom editor components.
 *
 * Extensions that contribute custom editors receive these props
 * from the Nimbalyst host.
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
   * Called when the editor content changes.
   * This triggers dirty state tracking and autosave.
   */
  onContentChange?: () => void;

  /**
   * Called to update the dirty state.
   * @param isDirty - Whether the editor has unsaved changes
   */
  onDirtyChange?: (isDirty: boolean) => void;

  /**
   * Register a function that returns the current editor content.
   * This is called by the host when saving.
   *
   * IMPORTANT: For read-only editors (like PDF viewer), do NOT call this.
   * Calling it with a function that returns '' will cause file corruption.
   *
   * @param getContentFn - Function that returns current content as string
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
