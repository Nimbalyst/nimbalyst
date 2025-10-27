/**
 * EditorRegistry - Manages multiple editor instances for AI operations
 *
 * Replaces the singleton event bridge pattern with a registry that tracks
 * editor instances by file path, enabling targeted AI operations on specific editors.
 */

import type { LexicalEditor } from 'lexical';

export interface EditorInstance {
  filePath: string;
  editor: LexicalEditor;
  hasPendingDiffs: () => boolean;
  applyReplacements: (replacements: any[], requestId?: string) => Promise<{ success: boolean; error?: string }>;
  startStreaming: (config: any) => void;
  streamContent: (streamId: string, content: string) => void;
  endStreaming: (streamId: string) => void;
  getContent: () => string;
}

export type FileOpenerFunction = (filePath: string, content: string, switchToTab: boolean) => Promise<void> | void;

class EditorRegistry {
  private editors: Map<string, EditorInstance> = new Map();
  private activeFilePath: string | null = null;
  private fileOpener: FileOpenerFunction | null = null;

  /**
   * Register an editor instance for a file path
   */
  register(instance: EditorInstance): void {
    // console.log('[EditorRegistry] Registering editor for:', instance.filePath);
    this.editors.set(instance.filePath, instance);
    // Set as active if it's the first editor or explicitly set later
    if (!this.activeFilePath) {
      this.activeFilePath = instance.filePath;
    }
  }

  /**
   * Unregister an editor instance
   */
  unregister(filePath: string): void {
    // console.log('[EditorRegistry] Unregistering editor for:', filePath);
    this.editors.delete(filePath);
    // If we're unregistering the active editor, clear it
    if (this.activeFilePath === filePath) {
      this.activeFilePath = null;
      // Set a new active editor if one exists
      const paths = Array.from(this.editors.keys());
      if (paths.length > 0) {
        this.activeFilePath = paths[0];
      }
    }
  }

  /**
   * Get an editor instance by file path
   */
  getEditor(filePath: string): EditorInstance | undefined {
    return this.editors.get(filePath);
  }

  /**
   * Get all registered file paths
   */
  getFilePaths(): string[] {
    return Array.from(this.editors.keys());
  }

  /**
   * Check if an editor is registered for a file path
   */
  has(filePath: string): boolean {
    return this.editors.has(filePath);
  }

  /**
   * Set the active editor by file path
   */
  setActive(filePath: string): void {
    if (this.editors.has(filePath)) {
      // console.log('[EditorRegistry] Setting active editor:', filePath);
      this.activeFilePath = filePath;
    } else {
      console.warn('[EditorRegistry] Attempted to set active editor for unregistered file:', filePath);
    }
  }

  /**
   * Get the currently active file path
   */
  getActiveFilePath(): string | null {
    return this.activeFilePath;
  }

  /**
   * Apply text replacements to a specific editor
   */
  async applyReplacements(
    filePath: string,
    replacements: any[],
    requestId?: string
  ): Promise<{ success: boolean; error?: string }> {
    const editor = this.getEditor(filePath);

    if (!editor) {
      return { success: false, error: `No editor registered for ${filePath}` };
    }

    return editor.applyReplacements(replacements, requestId);
  }

  /**
   * Start a streaming edit session for a specific editor
   */
  startStreaming(filePath: string, config: any): void {
    const editor = this.getEditor(filePath);

    if (!editor) {
      console.error('[EditorRegistry] No editor found for streaming to file:', filePath);
      return;
    }

    console.log('[EditorRegistry] Starting streaming for:', filePath, config);
    editor.startStreaming(config);
  }

  /**
   * Stream content to an active session
   */
  streamContent(filePath: string, streamId: string, content: string): void {
    const editor = this.getEditor(filePath);

    if (!editor) {
      console.error('[EditorRegistry] No editor found for streaming content to:', filePath);
      return;
    }

    editor.streamContent(streamId, content);
  }

  /**
   * End a streaming session
   */
  endStreaming(filePath: string, streamId: string): void {
    const editor = this.getEditor(filePath);

    if (!editor) {
      console.error('[EditorRegistry] No editor found for ending stream:', filePath);
      return;
    }

    console.log('[EditorRegistry] Ending streaming for:', filePath, streamId);
    editor.endStreaming(streamId);
  }

  /**
   * Get content from a specific editor
   */
  getContent(filePath: string): string {
    const editor = this.getEditor(filePath);

    if (!editor) {
      console.error('[EditorRegistry] No editor found for getting content from:', filePath);
      return '';
    }

    return editor.getContent();
  }

  /**
   * Set the file opener function to be called when opening files in background
   */
  setFileOpener(opener: FileOpenerFunction): void {
    this.fileOpener = opener;
  }

  /**
   * Open a file in the background (without switching focus)
   */
  async openFileInBackground(filePath: string, content: string): Promise<void> {
    if (!this.fileOpener) {
      console.warn('[EditorRegistry] No file opener registered, cannot open file:', filePath);
      return;
    }

    await this.fileOpener(filePath, content, false);

    // Wait a bit for the editor to register
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Scroll to a tracker item in the document by its ID
   */
  scrollToTrackerItem(filePath: string, itemId: string): void {
    const editorInstance = this.getEditor(filePath);

    if (!editorInstance) {
      console.warn('[EditorRegistry] No editor found for scrolling to tracker item:', filePath);
      return;
    }

    const { editor } = editorInstance;

    // Find the TrackerItemNode with the matching ID
    editor.getEditorState().read(() => {
      let targetKey: string | null = null;

      // Walk through all nodes to find the TrackerItemNode with matching ID
      const allNodes = editor._editorState._nodeMap;
      for (const [key, node] of allNodes) {
        if ((node as any).__type === 'tracker-item') {
          const trackerNode = node as any;
          if (trackerNode.__data?.id === itemId) {
            targetKey = key;
            break;
          }
        }
      }

      if (targetKey) {
        const domElement = editor.getElementByKey(targetKey);
        if (domElement) {
          // Scroll the element into view with smooth behavior
          domElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        console.warn('[EditorRegistry] TrackerItemNode not found with ID:', itemId);
      }
    });
  }
}

// Export singleton instance
export const editorRegistry = new EditorRegistry();

// Expose for testing (browser environment only)
if (typeof window !== 'undefined') {
  (window as any).__editorRegistry = editorRegistry;
}
