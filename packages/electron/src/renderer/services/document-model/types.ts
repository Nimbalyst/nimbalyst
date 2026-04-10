/**
 * Types for the DocumentModel layer.
 *
 * DocumentModel is a coordination layer that sits between the file system
 * and editor instances. It owns:
 * - Last-persisted content
 * - Dirty flag (OR of all attached editors)
 * - Single autosave timer
 * - File-watcher event handling
 * - Diff state (pending AI edits)
 * - Save deduplication
 *
 * Each editor still owns its live in-memory working copy, undo/redo history,
 * scroll position, selection, and parsed state.
 */

// -- Backing Store ----------------------------------------------------------

/**
 * Abstraction over the persistence layer for a document.
 *
 * Phase 1 implements DiskBackedStore (IPC-based file I/O).
 * A future CollabBackedStore will use Y.Doc for collaborative editing.
 */
export interface DocumentBackingStore {
  /** Load the document content from the backing store. */
  load(): Promise<string | ArrayBuffer>;

  /** Save content to the backing store. */
  save(content: string | ArrayBuffer): Promise<void>;

  /**
   * Subscribe to external content changes (e.g. file watcher, collab sync).
   * Returns an unsubscribe function.
   */
  onExternalChange(callback: ExternalChangeCallback): () => void;
}

export interface ExternalChangeInfo {
  content: string | ArrayBuffer;
  /** Timestamp of the change (ms since epoch). */
  timestamp: number;
  /**
   * When true, forces pending-tag check even if content matches lastPersistedContent.
   * Set by the tag-created signal from HistoryManager.
   */
  checkPendingTags?: boolean;
}

export type ExternalChangeCallback = (info: ExternalChangeInfo) => void;

// -- Diff State -------------------------------------------------------------

export interface DiffState {
  /** History tag ID for this pending diff. */
  tagId: string;
  /** AI session that made the edit. */
  sessionId: string;
  /** Content before the AI edit. */
  oldContent: string;
  /** Content after the AI edit (currently on disk). */
  newContent: string;
  /** Timestamp when the AI edit was detected. */
  createdAt: number;
}

// -- Editor Attachment ------------------------------------------------------

/**
 * A handle returned when an editor attaches to a DocumentModel.
 * The editor uses this to communicate with the model.
 */
export interface DocumentModelEditorHandle {
  /** Unique identifier for this attachment (for internal tracking). */
  readonly id: string;

  /**
   * Report dirty state from this editor.
   * DocumentModel ORs all attached editors' dirty flags.
   */
  setDirty(isDirty: boolean): void;

  /**
   * Save content through the DocumentModel.
   * DocumentModel writes to the backing store, updates lastPersistedContent,
   * and notifies other attached editors via their onFileChanged callbacks.
   */
  saveContent(content: string | ArrayBuffer): Promise<void>;

  /**
   * Subscribe to external content changes (file watcher, other editor saves, collab).
   * NOT called when this editor itself saves (echo suppression).
   */
  onFileChanged(callback: (content: string | ArrayBuffer) => void): () => void;

  /**
   * Subscribe to save requests from the DocumentModel's autosave timer.
   * The editor should serialize its content and call saveContent().
   */
  onSaveRequested(callback: () => void): () => void;

  /**
   * Subscribe to diff mode requests.
   * Called when DocumentModel detects pending AI edits.
   */
  onDiffRequested(callback: (state: DiffState) => void): () => void;

  /**
   * Subscribe to diff resolution by another editor.
   * Called when diff is accepted/rejected in a different editor.
   */
  onDiffResolved(callback: (accepted: boolean) => void): () => void;

  /**
   * Resolve a pending diff (accept or reject).
   * DocumentModel saves the final content and notifies all other editors.
   */
  resolveDiff(accepted: boolean): Promise<void>;

  /**
   * Detach this editor from the DocumentModel.
   * Equivalent to calling registry.release().
   */
  detach(): void;
}

// -- Document Model ---------------------------------------------------------

export interface DocumentModelState {
  /** Absolute file path. */
  filePath: string;
  /** Whether any attached editor reports dirty. */
  isDirty: boolean;
  /** Current diff state, or null if not in diff mode. */
  diffState: DiffState | null;
  /** Number of attached editors. */
  attachCount: number;
}

// -- Events -----------------------------------------------------------------

export type DocumentModelEventType =
  | 'dirty-changed'
  | 'diff-state-changed'
  | 'content-saved'
  | 'attach-count-changed';

export interface DocumentModelEvent {
  type: DocumentModelEventType;
  filePath: string;
}
