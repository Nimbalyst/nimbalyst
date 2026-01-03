/**
 * MonacoEditor Wrapper
 *
 * Adapts Monaco Editor to work with EditorHost.
 * This component follows the same pattern as MarkdownEditor and custom editors:
 * - Receives EditorHost as prop
 * - Loads content via host.loadContent()
 * - Saves content via host.saveContent()
 * - Reports dirty state via host.setDirty()
 *
 * NOTE: This is a placeholder for the full implementation.
 * Monaco Editor has platform-specific dependencies (@monaco-editor/react) that
 * currently live in the electron package. A full implementation would require:
 * 1. Either moving Monaco dependencies to runtime (increases bundle size)
 * 2. Or having platform-specific implementations with shared interface
 *
 * For now, TabEditor in electron can directly use MonacoCodeEditor with EditorHost
 * pattern, similar to how MarkdownEditor wraps Rexical.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { EditorHost, DiffConfig } from '../extensions/editorHost';

export interface MonacoEditorConfig {
  /** Theme for the editor */
  theme?: 'light' | 'dark' | 'crystal-dark' | 'auto';

  /** Whether the editor is read-only */
  readOnly?: boolean;

  /** Language mode (auto-detected from file extension if not specified) */
  language?: string;
}

export interface MonacoEditorProps {
  /** Host service for all editor-host communication */
  host: EditorHost;

  /** Optional configuration */
  config?: MonacoEditorConfig;

  /** Callback when editor is ready (passes editor instance) */
  onEditorReady?: (editor: any) => void;
}

/**
 * MonacoEditor - EditorHost-aware wrapper for Monaco
 *
 * This is a placeholder implementation. The actual Monaco integration
 * happens in packages/electron where @monaco-editor/react is available.
 *
 * TabEditor should use the pattern established here:
 * 1. Create EditorHost with all callbacks wired up
 * 2. Pass EditorHost to the editor component
 * 3. Editor handles its own lifecycle (load, save, dirty state)
 */
export function MonacoEditor({
  host,
  config = {},
  onEditorReady,
}: MonacoEditorProps): React.ReactElement {
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [initialContent, setInitialContent] = useState<string>('');

  // Editor instance ref
  const editorRef = useRef<any>(null);

  // Function to get current content from editor
  const getContentFnRef = useRef<(() => string) | null>(null);

  // Track if content has been modified
  const isDirtyRef = useRef(false);

  // Track initial content for dirty comparison
  const initialContentRef = useRef<string>('');

  // Load initial content on mount
  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      try {
        setIsLoading(true);
        const content = await host.loadContent();
        if (mounted) {
          setInitialContent(content);
          initialContentRef.current = content;
          setIsLoading(false);
        }
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error : new Error('Failed to load content'));
          setIsLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      mounted = false;
    };
  }, [host]);

  // Subscribe to save requests from host
  useEffect(() => {
    const handleSaveRequest = async () => {
      if (!getContentFnRef.current) {
        console.warn('[MonacoEditor] No getContent function available for save');
        return;
      }

      try {
        const content = getContentFnRef.current();
        await host.saveContent(content);
        // Reset dirty state after successful save
        isDirtyRef.current = false;
        initialContentRef.current = content;
      } catch (error) {
        console.error('[MonacoEditor] Save failed:', error);
      }
    };

    const unsubscribe = host.onSaveRequested(handleSaveRequest);
    return unsubscribe;
  }, [host]);

  // Subscribe to file changes (external edits)
  useEffect(() => {
    const handleFileChanged = (newContent: string) => {
      if (editorRef.current && editorRef.current.setContent) {
        editorRef.current.setContent(newContent);
        initialContentRef.current = newContent;
        isDirtyRef.current = false;
      }
    };

    const unsubscribe = host.onFileChanged(handleFileChanged);
    return unsubscribe;
  }, [host]);

  // Handle content change from Monaco
  const handleContentChange = useCallback(() => {
    if (!getContentFnRef.current) return;

    const currentContent = getContentFnRef.current();
    const isDirty = currentContent !== initialContentRef.current;

    if (isDirty !== isDirtyRef.current) {
      isDirtyRef.current = isDirty;
      host.setDirty(isDirty);
    }
  }, [host]);

  // Handle getContent callback from Monaco
  const handleGetContent = useCallback((getContentFn: () => string) => {
    getContentFnRef.current = getContentFn;
  }, []);

  // Handle editor ready
  const handleEditorReady = useCallback(
    (editor: any) => {
      editorRef.current = editor;
      onEditorReady?.(editor);
    },
    [onEditorReady]
  );

  // Show loading state
  if (isLoading) {
    return (
      <div className="monaco-editor-loading">
        <span>Loading...</span>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="monaco-editor-error">
        <span>Failed to load: {loadError.message}</span>
      </div>
    );
  }

  // Render placeholder
  // In the actual implementation, this would render the Monaco Editor component
  return (
    <div className="monaco-editor-wrapper" data-theme={host.theme}>
      <div className="monaco-editor-placeholder">
        MonacoEditor wrapper ready. Monaco integration pending.
        <br />
        File: {host.filePath}
        <br />
        Initial content length: {initialContent.length}
      </div>
    </div>
  );
}

export default MonacoEditor;
