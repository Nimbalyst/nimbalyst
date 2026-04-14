/**
 * DocumentModel - Coordination layer for a single file.
 *
 * One DocumentModel exists per open file (shared across all editor instances
 * that have the same file open -- e.g. EditorMode tab + AgentMode tab).
 *
 * Responsibilities:
 * - Holds last-persisted content (updated after each save)
 * - Aggregates dirty state from all attached editors
 * - Runs a single autosave timer (triggers onSaveRequested on a dirty editor)
 * - Handles file-watcher events (single handler, notifies all editors)
 * - Manages diff state (pending AI edits, accept/reject coordination)
 * - Deduplicates saves (one at a time)
 * - Ref-counts attached editors for lifecycle management
 *
 * NOT a live editing buffer. Each editor owns its own in-memory working copy.
 */

import type {
  DocumentBackingStore,
  DocumentModelEditorHandle,
  DocumentModelEvent,
  DocumentModelEventType,
  DocumentModelState,
  DiffState,
  ExternalChangeInfo,
} from './types';

let nextAttachmentId = 0;

interface EditorAttachment {
  id: string;
  isDirty: boolean;
  fileChangedCallbacks: Set<(content: string | ArrayBuffer) => void>;
  saveRequestedCallbacks: Set<() => void>;
  diffRequestedCallbacks: Set<(state: DiffState) => void>;
  diffResolvedCallbacks: Set<(accepted: boolean) => void>;
}

export interface DocumentModelOptions {
  /** Autosave interval in ms. 0 disables autosave. Default: 2000 */
  autosaveInterval?: number;
  /** Minimum time since last edit before autosave fires. Default: 200 */
  autosaveDebounce?: number;
  /**
   * Optional callback to check for pending AI edit tags on a file.
   * Used during external change handling to detect diff mode entry.
   * Returns pending tags array or empty.
   */
  getPendingTags?: (filePath: string) => Promise<Array<{ id: string; sessionId: string; createdAt?: string }>>;
  /**
   * Optional callback to update a tag's status (e.g. mark as reviewed).
   */
  updateTagStatus?: (filePath: string, tagId: string, status: string) => Promise<void>;
  /**
   * Optional callback to get the diff baseline for a file.
   * Returns the content that should be used as the "old" side of the diff.
   * If not provided, falls back to lastPersistedContent.
   */
  getDiffBaseline?: (filePath: string) => Promise<{ content: string } | null>;
}

export class DocumentModel {
  readonly filePath: string;
  private backingStore: DocumentBackingStore;
  private options: Required<DocumentModelOptions>;

  // -- Coordination state ---------------------------------------------------

  /** Last content that was persisted to the backing store. */
  private lastPersistedContent: string | ArrayBuffer | null = null;

  /** Diff state (pending AI edits). */
  private diffState: DiffState | null = null;

  /** All attached editors. */
  private attachments = new Map<string, EditorAttachment>();

  /** Event listeners on the model itself (for Jotai atoms, etc.). */
  private eventListeners = new Map<DocumentModelEventType, Set<(event: DocumentModelEvent) => void>>();

  // -- Save coordination ----------------------------------------------------

  private isSaving = false;
  private pendingSave: { editorId: string; content: string | ArrayBuffer; resolve: () => void; reject: (err: unknown) => void } | null = null;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastEditTime = 0;

  // -- File watcher ---------------------------------------------------------

  private externalChangeCleanup: (() => void) | null = null;

  // -- Disposed flag --------------------------------------------------------

  private disposed = false;

  constructor(
    filePath: string,
    backingStore: DocumentBackingStore,
    options: DocumentModelOptions = {},
  ) {
    this.filePath = filePath;
    this.backingStore = backingStore;
    this.options = {
      autosaveInterval: options.autosaveInterval ?? 2000,
      autosaveDebounce: options.autosaveDebounce ?? 200,
      getPendingTags: options.getPendingTags ?? (async () => []),
      updateTagStatus: options.updateTagStatus ?? (async () => {}),
      getDiffBaseline: options.getDiffBaseline ?? (async () => null),
    };

    // Subscribe to external changes from the backing store
    this.externalChangeCleanup = backingStore.onExternalChange(
      this.handleExternalChange.bind(this),
    );

    // Start autosave timer
    this.startAutosaveTimer();
  }

  // -- Attachment lifecycle -------------------------------------------------

  /**
   * Attach a new editor to this document model.
   * Returns a handle the editor uses for all communication.
   */
  attach(): DocumentModelEditorHandle {
    const id = `editor-${++nextAttachmentId}`;
    const attachment: EditorAttachment = {
      id,
      isDirty: false,
      fileChangedCallbacks: new Set(),
      saveRequestedCallbacks: new Set(),
      diffRequestedCallbacks: new Set(),
      diffResolvedCallbacks: new Set(),
    };
    this.attachments.set(id, attachment);
    this.emit('attach-count-changed');

    const handle: DocumentModelEditorHandle = {
      id,

      setDirty: (isDirty: boolean) => {
        const att = this.attachments.get(id);
        if (!att) return;
        const wasDirty = this.isDirty();
        att.isDirty = isDirty;
        if (isDirty) {
          this.lastEditTime = Date.now();
        }
        if (wasDirty !== this.isDirty()) {
          this.emit('dirty-changed');
        }
      },

      saveContent: async (content: string | ArrayBuffer) => {
        await this.saveFromEditor(id, content);
      },

      /**
       * Notify sibling editors that this editor saved content externally
       * (i.e. through a path that bypasses handle.saveContent, like saveWithHistory).
       * Updates lastPersistedContent and notifies clean siblings.
       */
      notifySiblingsSaved: (content: string | ArrayBuffer) => {
        this.lastPersistedContent = content;
        this.notifyFileChanged(content, id);
      },

      onFileChanged: (callback) => {
        const att = this.attachments.get(id);
        if (!att) return () => {};
        att.fileChangedCallbacks.add(callback);
        return () => {
          att.fileChangedCallbacks.delete(callback);
        };
      },

      onSaveRequested: (callback) => {
        const att = this.attachments.get(id);
        if (!att) return () => {};
        att.saveRequestedCallbacks.add(callback);
        return () => {
          att.saveRequestedCallbacks.delete(callback);
        };
      },

      onDiffRequested: (callback) => {
        const att = this.attachments.get(id);
        if (!att) return () => {};
        att.diffRequestedCallbacks.add(callback);
        // If we're already in diff mode, immediately notify this new subscriber
        if (this.diffState) {
          try {
            callback(this.diffState);
          } catch (err) {
            console.error('[DocumentModel] Error in immediate diff callback:', err);
          }
        }
        return () => {
          att.diffRequestedCallbacks.delete(callback);
        };
      },

      onDiffResolved: (callback) => {
        const att = this.attachments.get(id);
        if (!att) return () => {};
        att.diffResolvedCallbacks.add(callback);
        return () => {
          att.diffResolvedCallbacks.delete(callback);
        };
      },

      resolveDiff: async (accepted: boolean) => {
        await this.resolveDiffFromEditor(id, accepted);
      },

      detach: () => {
        this.detach(id);
      },
    };

    return handle;
  }

  /**
   * Detach an editor. Clears its dirty state and callbacks.
   */
  private detach(editorId: string): void {
    const att = this.attachments.get(editorId);
    if (!att) return;

    const wasDirty = this.isDirty();
    att.fileChangedCallbacks.clear();
    att.saveRequestedCallbacks.clear();
    att.diffRequestedCallbacks.clear();
    att.diffResolvedCallbacks.clear();
    this.attachments.delete(editorId);

    if (wasDirty !== this.isDirty()) {
      this.emit('dirty-changed');
    }
    this.emit('attach-count-changed');
  }

  // -- State queries --------------------------------------------------------

  /** True if any attached editor is dirty. */
  isDirty(): boolean {
    for (const att of this.attachments.values()) {
      if (att.isDirty) return true;
    }
    return false;
  }

  /** Current diff state. */
  getDiffState(): DiffState | null {
    return this.diffState;
  }

  /** Last-persisted content. */
  getLastPersistedContent(): string | ArrayBuffer | null {
    return this.lastPersistedContent;
  }

  /**
   * Set the last-persisted content without saving.
   * Used to initialize the echo-suppression baseline when the
   * DocumentModel is created for a file that's already loaded.
   */
  setLastPersistedContent(content: string | ArrayBuffer): void {
    this.lastPersistedContent = content;
  }

  /**
   * Clear diff state without triggering a save.
   * Used when the editor resolves diffs through its own save path
   * (e.g. Lexical's CLEAR_DIFF_TAG_COMMAND flow).
   */
  clearDiffState(): void {
    if (this.diffState) {
      this.diffState = null;
      this.emit('diff-state-changed');
    }
  }

  /** Number of attached editors. */
  getAttachCount(): number {
    return this.attachments.size;
  }

  /** Full state snapshot (for Jotai atoms). */
  getState(): DocumentModelState {
    return {
      filePath: this.filePath,
      isDirty: this.isDirty(),
      diffState: this.diffState,
      attachCount: this.attachments.size,
    };
  }

  // -- Content loading ------------------------------------------------------

  /**
   * Load content from the backing store and cache it as lastPersistedContent.
   * Typically called once when the model is first created.
   */
  async loadContent(): Promise<string | ArrayBuffer> {
    const content = await this.backingStore.load();
    this.lastPersistedContent = content;
    return content;
  }

  // -- Save handling --------------------------------------------------------

  /**
   * Save content from a specific editor.
   * Updates lastPersistedContent and notifies all OTHER attached editors.
   */
  private async saveFromEditor(editorId: string, content: string | ArrayBuffer): Promise<void> {
    if (this.isSaving) {
      // Queue this save -- it will run after the current save completes.
      // Only the latest content matters. If a previous save was already queued,
      // resolve it now (the newer content supersedes it).
      if (this.pendingSave) {
        this.pendingSave.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        this.pendingSave = { editorId, content, resolve, reject };
      });
    }

    this.isSaving = true;
    try {
      // Update lastPersistedContent BEFORE writing to disk.
      // The file watcher can fire before save() returns, and we need
      // echo suppression to see the new content as "ours".
      this.lastPersistedContent = content;
      await this.backingStore.save(content);

      // Clear dirty flag for the saving editor
      const att = this.attachments.get(editorId);
      if (att) {
        const wasDirty = this.isDirty();
        att.isDirty = false;
        if (wasDirty !== this.isDirty()) {
          this.emit('dirty-changed');
        }
      }

      this.emit('content-saved');

      // Notify clean sibling editors so they pick up the new content.
      // Dirty siblings are skipped by notifyFileChanged to preserve in-flight edits.
      this.notifyFileChanged(content, editorId);
    } finally {
      this.isSaving = false;

      // Process any queued save
      if (this.pendingSave) {
        const { editorId: queuedEditorId, content: queuedContent, resolve, reject } = this.pendingSave;
        this.pendingSave = null;
        try {
          await this.saveFromEditor(queuedEditorId, queuedContent);
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    }
  }

  /**
   * Trigger a save-on-demand (e.g. mode switch flush).
   * Finds the first dirty editor and requests a save from it.
   */
  async flushDirtyEditors(): Promise<void> {
    for (const att of this.attachments.values()) {
      if (att.isDirty) {
        for (const cb of att.saveRequestedCallbacks) {
          try {
            await cb();
          } catch (err) {
            console.error('[DocumentModel] Error in flushDirtyEditors save request:', err);
          }
        }
      }
    }
  }

  // -- External change handling ---------------------------------------------

  private async handleExternalChange(info: ExternalChangeInfo): Promise<void> {
    if (this.disposed) return;

    // Echo suppression: skip if content matches last-persisted.
    // This catches our own saves echoing back through the file watcher.
    const isEcho = this.lastPersistedContent !== null && info.content === this.lastPersistedContent;
    if (isEcho && !info.checkPendingTags) {
      return;
    }

    // Check for pending AI edit tags.
    // For echoed content: only reached when checkPendingTags is set (tag-created signal).
    // For changed content: always check.
    const pendingTags = await this.options.getPendingTags(this.filePath);
    const activeTags = pendingTags.filter(
      (tag: { id: string; sessionId: string; createdAt?: string; status?: string }) =>
        (tag as any).status !== 'reviewed' && (tag as any).status !== 'rejected',
    );

    if (activeTags.length > 0) {
      // Enter diff mode
      const tag = activeTags[0];
      const newContent = info.content;

      // Get the diff baseline -- this is the content BEFORE the AI edit.
      // May come from a history tag (for incremental approvals) or lastPersistedContent.
      let oldContent: string;
      try {
        const baseline = await this.options.getDiffBaseline(this.filePath);
        oldContent = baseline?.content ?? (typeof this.lastPersistedContent === 'string' ? this.lastPersistedContent : '');
      } catch {
        oldContent = typeof this.lastPersistedContent === 'string' ? this.lastPersistedContent : '';
      }

      this.diffState = {
        tagId: tag.id,
        sessionId: tag.sessionId,
        oldContent,
        newContent: typeof newContent === 'string' ? newContent : '',
        createdAt: tag.createdAt ? new Date(tag.createdAt).getTime() : Date.now(),
      };

      this.emit('diff-state-changed');

      // Notify all editors about diff mode
      for (const att of this.attachments.values()) {
        for (const cb of att.diffRequestedCallbacks) {
          try {
            cb(this.diffState);
          } catch (err) {
            console.error('[DocumentModel] Error in diff requested callback:', err);
          }
        }
      }
    } else {
      // Normal external change -- update persisted content and notify editors.
      // (Echo suppression already ran above for non-tag-check events.)
      this.lastPersistedContent = info.content;
      this.notifyFileChanged(info.content);
    }
  }

  // -- Diff resolution ------------------------------------------------------

  private async resolveDiffFromEditor(editorId: string, accepted: boolean): Promise<void> {
    if (!this.diffState) return;

    const { tagId, oldContent, newContent } = this.diffState;
    const finalContent = accepted ? newContent : oldContent;

    // Mark the tag as reviewed
    await this.options.updateTagStatus(this.filePath, tagId, 'reviewed');

    // Save the final content
    await this.backingStore.save(finalContent);
    this.lastPersistedContent = finalContent;

    // Clear diff state
    this.diffState = null;
    this.emit('diff-state-changed');

    // Clear dirty flags on all editors
    for (const att of this.attachments.values()) {
      att.isDirty = false;
    }
    this.emit('dirty-changed');

    // Notify all OTHER editors that diff was resolved
    for (const [attId, att] of this.attachments) {
      if (attId === editorId) continue;
      for (const cb of att.diffResolvedCallbacks) {
        try {
          cb(accepted);
        } catch (err) {
          console.error('[DocumentModel] Error in diff resolved callback:', err);
        }
      }
    }

    // Notify all editors of the final content
    this.notifyFileChanged(finalContent);
  }

  // -- Autosave timer -------------------------------------------------------

  private startAutosaveTimer(): void {
    const interval = this.options.autosaveInterval;
    if (interval <= 0) return;

    this.autosaveTimer = setInterval(() => {
      if (this.disposed) return;

      // NOTE: We do NOT skip when in diff mode. The editor callback handles
      // diff-mode checks (e.g. checking $hasDiffNodes to auto-clear resolved diffs).
      // Skipping here would prevent the editor from detecting manually resolved diffs.

      // Skip if not dirty
      if (!this.isDirty()) return;

      // Skip if edit was too recent (debounce)
      if (Date.now() - this.lastEditTime < this.options.autosaveDebounce) return;

      // Find the first dirty editor and request a save
      for (const att of this.attachments.values()) {
        if (att.isDirty && att.saveRequestedCallbacks.size > 0) {
          for (const cb of att.saveRequestedCallbacks) {
            try {
              cb();
            } catch (err) {
              console.error('[DocumentModel] Error in autosave request:', err);
            }
          }
          // Only request save from one editor at a time
          break;
        }
      }
    }, interval);
  }

  // -- Notifications --------------------------------------------------------

  /**
   * Notify attached editors of a content change.
   * Skips editors that are dirty (have unsaved in-flight edits) to avoid
   * overwriting user work. Also optionally excludes a specific editor.
   */
  private notifyFileChanged(content: string | ArrayBuffer, excludeEditorId?: string): void {
    for (const [attId, att] of this.attachments) {
      if (attId === excludeEditorId) continue;
      // Don't overwrite dirty editors -- they have unsaved user edits.
      if (att.isDirty) continue;
      for (const cb of att.fileChangedCallbacks) {
        try {
          cb(content);
        } catch (err) {
          console.error('[DocumentModel] Error in file changed callback:', err);
        }
      }
    }
  }

  // -- Event system ---------------------------------------------------------

  on(type: DocumentModelEventType, listener: (event: DocumentModelEvent) => void): () => void {
    let listeners = this.eventListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(type, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
    };
  }

  private emit(type: DocumentModelEventType): void {
    const event: DocumentModelEvent = { type, filePath: this.filePath };
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error(`[DocumentModel] Error in ${type} listener:`, err);
        }
      }
    }
  }

  // -- Lifecycle ------------------------------------------------------------

  dispose(): void {
    this.disposed = true;

    if (this.autosaveTimer) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }

    this.externalChangeCleanup?.();
    this.externalChangeCleanup = null;

    // Clear all attachments
    for (const att of this.attachments.values()) {
      att.fileChangedCallbacks.clear();
      att.saveRequestedCallbacks.clear();
      att.diffRequestedCallbacks.clear();
      att.diffResolvedCallbacks.clear();
    }
    this.attachments.clear();

    // Clear event listeners
    this.eventListeners.clear();

    // Dispose backing store if it has a dispose method
    if ('dispose' in this.backingStore && typeof (this.backingStore as any).dispose === 'function') {
      (this.backingStore as any).dispose();
    }
  }
}
