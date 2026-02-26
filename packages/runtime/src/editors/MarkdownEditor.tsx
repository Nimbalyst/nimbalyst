/**
 * MarkdownEditor Wrapper
 *
 * Adapts Rexical (the pure Lexical wrapper) to work with EditorHost.
 * This component follows the same pattern as custom editors:
 * - Receives EditorHost as prop
 * - Loads content via host.loadContent()
 * - Saves content via host.saveContent()
 * - Reports dirty state via host.setDirty()
 *
 * This creates a clean separation:
 * - Rexical: Pure Lexical wrapper, no platform knowledge
 * - MarkdownEditor: Adapts Rexical to EditorHost interface
 * - TabEditor: Provides EditorHost, doesn't know about editor internals
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { StravuEditor, type EditorConfig, type ConfigTheme, $convertFromEnhancedMarkdownString, getEditorTransformers } from '../editor';
import type { EditorHost } from '../extensions/editorHost';
import { $getRoot } from 'lexical';

export interface MarkdownEditorConfig {
  /**
   * @deprecated Theme is now controlled at app level via CSS variables.
   * This prop is ignored. Theme is read from document root's data-theme attribute.
   */
  theme?: string;

  /** Whether the editor is read-only */
  editable?: boolean;

  /** Show the toolbar */
  showToolbar?: boolean;

  /** Document header element to render at top of scroll area */
  documentHeader?: React.ReactNode;

  /** Callback when user double-clicks an image */
  onImageDoubleClick?: (src: string, nodeKey: string) => void;

  /** Callback when user starts dragging an image */
  onImageDragStart?: (src: string, event: DragEvent) => void;

  /** Callback to rename document */
  onRenameDocument?: () => void;

  /** Callback to switch to agent mode */
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;

  /** Callback to open session in chat */
  onOpenSessionInChat?: (sessionId: string) => void;

  /** Callback to toggle markdown mode (switch to raw Monaco view) */
  onToggleMarkdownMode?: () => void;

  /** Show the debug tree view (dev mode only) */
  showTreeView?: boolean;
}

export interface MarkdownEditorProps {
  /** Host service for all editor-host communication */
  host: EditorHost;

  /** Optional configuration */
  config?: MarkdownEditorConfig;

  /** Callback when editor is ready (passes editor instance) */
  onEditorReady?: (editor: any) => void;

  /** Callback when getContent function is available (for mode switching) */
  onGetContent?: (getContentFn: () => string) => void;

  /**
   * When set, the editor operates in collaborative mode:
   * - Content comes from Y.Doc instead of host.loadContent()
   * - CollaborationPlugin replaces HistoryPlugin
   * - Save/file-change subscriptions are skipped
   */
  collaborationConfig?: {
    providerFactory: (id: string, yjsDocMap: Map<string, import('yjs').Doc>) => import('@lexical/yjs').Provider;
    shouldBootstrap: boolean;
    username?: string;
    cursorColor?: string;
    /** Markdown content to seed the Y.Doc with when shouldBootstrap is true */
    initialContent?: string;
  };
}

/**
 * MarkdownEditor - EditorHost-aware wrapper for Rexical
 *
 * This component handles all EditorHost integration:
 * - Content loading on mount
 * - Save request handling (autosave, manual save)
 * - File change notifications
 * - Dirty state reporting
 * - Diff mode (optional)
 */
export function MarkdownEditor({
  host,
  config = {},
  onEditorReady,
  onGetContent: onGetContentProp,
  collaborationConfig,
}: MarkdownEditorProps): React.ReactElement {
  const isCollabMode = !!collaborationConfig;

  // Loading state - we load content via host.loadContent()
  // In collab mode, content comes from Y.Doc, so we skip loading
  const [isLoading, setIsLoading] = useState(!isCollabMode);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [initialContent, setInitialContent] = useState<string>('');

  // Editor instance ref
  const editorRef = useRef<any>(null);

  // Function to get current content from editor
  const getContentFnRef = useRef<(() => string) | null>(null);

  // Load initial content on mount (skip in collaboration mode)
  useEffect(() => {
    if (isCollabMode) return; // CollaborationPlugin hydrates from Y.Doc

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
  // In collaboration mode, saves go through the sync layer, not EditorHost
  useEffect(() => {
    if (isCollabMode) return; // No disk saves in collaboration mode

    const handleSaveRequest = async () => {
      if (!getContentFnRef.current) {
        console.warn('[MarkdownEditor] No getContent function available for save');
        return;
      }

      try {
        const content = getContentFnRef.current();
        await host.saveContent(content);
      } catch (error) {
        console.error('[MarkdownEditor] Save failed:', error);
      }
    };

    const unsubscribe = host.onSaveRequested(handleSaveRequest);
    return unsubscribe;
  }, [host, isCollabMode]);

  // Subscribe to file changes (external edits)
  // In collaboration mode, changes come through Y.Doc, not file watcher
  useEffect(() => {
    if (isCollabMode) return; // No file watcher in collaboration mode

    const handleFileChanged = (newContent: string) => {
      // If we have an editor, update it with new content
      // The editor will decide whether to reload based on its internal state
      if (editorRef.current && editorRef.current.update) {
        // TODO: Import from editor and use proper update method
        console.log('[MarkdownEditor] File changed externally, updating editor');
        // For now, this will be implemented when we have the full Rexical integration
      }
    };

    const unsubscribe = host.onFileChanged(handleFileChanged);
    return unsubscribe;
  }, [host, isCollabMode]);

  // NOTE: We intentionally do NOT subscribe to diff requests here.
  // Markdown diff handling is fully implemented in TabEditor.tsx using Lexical's
  // APPLY_MARKDOWN_REPLACE_COMMAND. If we subscribed here, TabEditor would take
  // the "custom editor" code path (diffRequestCallbackRef) which bypasses the
  // working Lexical diff implementation.
  //
  // Custom editors that implement their own diff display should subscribe
  // to onDiffRequested. For markdown, TabEditor handles it directly.

  // Handle content change from Rexical
  // This is called on dirty state changes, NOT content serialization
  const handleDirtyChange = useCallback(
    (isDirty: boolean) => {
      host.setDirty(isDirty);
    },
    [host]
  );

  // Handle getContent callback from Rexical
  const handleGetContent = useCallback((getContentFn: () => string) => {
    getContentFnRef.current = getContentFn;
    // Also notify parent if they need the getContent function (e.g., for mode switching)
    onGetContentProp?.(getContentFn);
  }, [onGetContentProp]);

  // Handle editor ready
  const handleEditorReady = useCallback(
    (editor: any) => {
      editorRef.current = editor;
      onEditorReady?.(editor);
    },
    [onEditorReady]
  );

  // Handle view history
  const handleViewHistory = useCallback(() => {
    host.openHistory();
  }, [host]);

  // Build config for StravuEditor
  // Note: We use config.theme directly in dependencies because host.theme is a getter
  // that reads from a ref, so it won't trigger re-computation when the ref changes.
  const editorConfig = useMemo(
    (): EditorConfig => ({
      theme: (config.theme ?? host.theme) as ConfigTheme,
      editable: config.editable,
      showToolbar: config.showToolbar,
      showTreeView: config.showTreeView,
      documentHeader: config.documentHeader,
      onImageDoubleClick: config.onImageDoubleClick,
      onImageDragStart: config.onImageDragStart,
      onViewHistory: handleViewHistory,
      onRenameDocument: config.onRenameDocument,
      onSwitchToAgentMode: config.onSwitchToAgentMode,
      onOpenSessionInChat: config.onOpenSessionInChat,
      onToggleMarkdownMode: config.onToggleMarkdownMode,
      filePath: host.filePath,
      workspaceId: host.workspaceId,

      // Content callbacks - using new pattern
      initialContent: isCollabMode ? undefined : initialContent,
      onDirtyChange: handleDirtyChange,
      onGetContent: handleGetContent,
      onEditorReady: handleEditorReady,

      // Collaboration mode -- passed through to Editor.tsx
      collaboration: collaborationConfig ? (() => {
        const hasInitial = collaborationConfig.shouldBootstrap && collaborationConfig.initialContent;
        console.log('[MarkdownEditor] Building collab config, shouldBootstrap:', collaborationConfig.shouldBootstrap,
          'hasInitialContent:', !!collaborationConfig.initialContent,
          'will provide initialEditorState:', !!hasInitial);
        return {
          providerFactory: collaborationConfig.providerFactory,
          shouldBootstrap: collaborationConfig.shouldBootstrap,
          username: collaborationConfig.username,
          cursorColor: collaborationConfig.cursorColor,
          // When bootstrapping with initial content, provide a function that
          // parses the markdown into the editor. CollaborationPlugin calls this
          // inside editor.update() when the Y.Doc is empty after initial sync.
          initialEditorState: hasInitial
            ? () => {
                console.log('[MarkdownEditor] initialEditorState called! Parsing markdown content, length:', collaborationConfig.initialContent!.length);
                const root = $getRoot();
                root.clear();
                $convertFromEnhancedMarkdownString(collaborationConfig.initialContent!, getEditorTransformers());
              }
            : undefined,
        };
      })() : undefined,
    }),
    [
      config.theme,
      config.editable,
      config.showToolbar,
      config.showTreeView,
      config.documentHeader,
      config.onImageDoubleClick,
      config.onImageDragStart,
      config.onRenameDocument,
      config.onSwitchToAgentMode,
      config.onOpenSessionInChat,
      config.onToggleMarkdownMode,
      host.filePath,
      host.workspaceId,
      isCollabMode,
      initialContent,
      handleDirtyChange,
      handleGetContent,
      handleEditorReady,
      handleViewHistory,
      collaborationConfig,
    ]
  );

  // Show loading state
  if (isLoading) {
    return (
      <div className="markdown-editor-loading">
        <span>Loading...</span>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="markdown-editor-error">
        <span>Failed to load: {loadError.message}</span>
      </div>
    );
  }

  // Render StravuEditor with EditorHost integration
  return <StravuEditor config={editorConfig} />;
}

export default MarkdownEditor;
