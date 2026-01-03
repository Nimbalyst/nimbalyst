/**
 * MonacoEditor - EditorHost-aware wrapper for Monaco
 *
 * Adapts MonacoCodeEditor to work with EditorHost interface.
 * This component follows the same pattern as MarkdownEditor:
 * - Receives EditorHost as prop
 * - Loads content via host.loadContent()
 * - Saves content via host.saveContent()
 * - Reports dirty state via host.setDirty()
 *
 * This creates a clean separation:
 * - MonacoCodeEditor: Pure Monaco wrapper, handles diff mode
 * - MonacoEditor: Adapts Monaco to EditorHost interface
 * - TabEditor: Provides EditorHost, doesn't know about editor internals
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MonacoCodeEditor } from './MonacoCodeEditor';
import type { EditorHost, DiffConfig } from '../extensions/editorHost';
import type { Theme as ConfigTheme } from 'rexical';

export interface MonacoEditorConfig {
  /** Theme for the editor */
  theme?: ConfigTheme;

  /** Whether this editor's tab is active */
  isActive?: boolean;
}

export interface MonacoEditorProps {
  /** Host service for all editor-host communication */
  host: EditorHost;

  /** File name for language detection */
  fileName: string;

  /** Optional configuration */
  config?: MonacoEditorConfig;

  /** Callback when editor is ready (passes editor instance with diff controls) */
  onEditorReady?: (editor: any) => void;

  /** Callback when getContent function is available */
  onGetContent?: (getContentFn: () => string) => void;

  /** Callback when diff change count updates (for diff header UI) */
  onDiffChangeCountUpdate?: (count: number) => void;
}

/**
 * MonacoEditor - EditorHost-aware wrapper for Monaco
 *
 * This component handles all EditorHost integration:
 * - Content loading on mount
 * - Save request handling (autosave, manual save)
 * - File change notifications
 * - Dirty state reporting
 * - Diff mode (for AI edit review)
 */
export function MonacoEditor({
  host,
  fileName,
  config = {},
  onEditorReady,
  onGetContent: onGetContentProp,
  onDiffChangeCountUpdate,
}: MonacoEditorProps): React.ReactElement {
  // Loading state - we load content via host.loadContent()
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [initialContent, setInitialContent] = useState<string>('');

  // Editor wrapper ref (contains editor, setContent, showDiff, etc.)
  const editorWrapperRef = useRef<any>(null);

  // Function to get current content from editor
  const getContentFnRef = useRef<(() => string) | null>(null);

  // Load initial content on mount
  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      try {
        setIsLoading(true);
        const content = await host.loadContent();
        if (mounted) {
          setInitialContent(content);
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

  // Subscribe to save requests from host (autosave timer, manual Cmd+S)
  useEffect(() => {
    const handleSaveRequest = async () => {
      if (!getContentFnRef.current) {
        console.warn('[MonacoEditor] No getContent function available for save');
        return;
      }

      try {
        const content = getContentFnRef.current();
        await host.saveContent(content);
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
      // Use editor's setContent method to update content
      if (editorWrapperRef.current?.setContent) {
        editorWrapperRef.current.setContent(newContent);
      }
    };

    const unsubscribe = host.onFileChanged(handleFileChanged);
    return unsubscribe;
  }, [host]);

  // Subscribe to diff requests (for AI edit review)
  useEffect(() => {
    if (!host.onDiffRequested) return;

    const handleDiffRequest = (config: DiffConfig) => {
      // Use editor's showDiff method
      if (editorWrapperRef.current?.showDiff) {
        editorWrapperRef.current.showDiff(config.oldContent, config.newContent);
      }
    };

    const unsubscribe = host.onDiffRequested(handleDiffRequest);
    return unsubscribe;
  }, [host]);

  // Handle dirty state changes from Monaco
  const handleDirtyChange = useCallback(
    (isDirty: boolean) => {
      host.setDirty(isDirty);
    },
    [host]
  );

  // Handle getContent callback from Monaco
  const handleGetContent = useCallback((getContentFn: () => string) => {
    getContentFnRef.current = getContentFn;
    // Also notify parent if they need the getContent function
    onGetContentProp?.(getContentFn);
  }, [onGetContentProp]);

  // Handle editor ready (Monaco wrapper with diff controls)
  const handleEditorReady = useCallback(
    (editorWrapper: any) => {
      editorWrapperRef.current = editorWrapper;
      onEditorReady?.(editorWrapper);
    },
    [onEditorReady]
  );

  // Show loading state
  if (isLoading) {
    return (
      <div className="monaco-editor-loading" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-secondary)'
      }}>
        <span>Loading...</span>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="monaco-editor-error" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-error)'
      }}>
        <span>Failed to load: {loadError.message}</span>
      </div>
    );
  }

  // Render MonacoCodeEditor with EditorHost integration
  return (
    <MonacoCodeEditor
      filePath={host.filePath}
      fileName={fileName}
      initialContent={initialContent}
      theme={config.theme ?? host.theme}
      isActive={config.isActive}
      onDirtyChange={handleDirtyChange}
      onGetContent={handleGetContent}
      onEditorReady={handleEditorReady}
      onDiffChangeCountUpdate={onDiffChangeCountUpdate}
    />
  );
}

export default MonacoEditor;
