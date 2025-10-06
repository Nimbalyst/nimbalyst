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
  applyReplacements: (replacements: any[]) => Promise<{ success: boolean; error?: string }>;
  startStreaming: (config: any) => void;
  streamContent: (streamId: string, content: string) => void;
  endStreaming: (streamId: string) => void;
  getContent: () => string;
}

class EditorRegistry {
  private editors: Map<string, EditorInstance> = new Map();

  /**
   * Register an editor instance for a file path
   */
  register(instance: EditorInstance): void {
    // console.log('[EditorRegistry] Registering editor for:', instance.filePath);
    this.editors.set(instance.filePath, instance);
  }

  /**
   * Unregister an editor instance
   */
  unregister(filePath: string): void {
    // console.log('[EditorRegistry] Unregistering editor for:', filePath);
    this.editors.delete(filePath);
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
   * Apply text replacements to a specific editor
   */
  async applyReplacements(
    filePath: string,
    replacements: any[]
  ): Promise<{ success: boolean; error?: string }> {
    const editor = this.getEditor(filePath);

    if (!editor) {
      console.error('[EditorRegistry] No editor found for file:', filePath);
      return { success: false, error: `No editor registered for ${filePath}` };
    }

    console.log(`[EditorRegistry] Applying ${replacements.length} replacements to:`, filePath);
    return editor.applyReplacements(replacements);
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
}

// Export singleton instance
export const editorRegistry = new EditorRegistry();
