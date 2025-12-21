/**
 * MonacoCodeEditor - Monaco Editor wrapper for code files
 *
 * This component wraps Monaco Editor to provide:
 * - Normal editing mode with syntax highlighting
 * - Diff mode for AI-generated changes (Phase 2)
 * - Same interface as StravuEditor for seamless TabEditor integration
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor, Selection } from 'monaco-editor';
import type { Theme as ConfigTheme } from 'rexical';
import { getMonacoTheme } from '../../utils/monacoThemeMapper';
import { getMonacoLanguage } from '../../utils/fileTypeDetector';
import './MonacoCodeEditor.css';

// CSS class for unfocused selection highlight
const UNFOCUSED_SELECTION_CLASS = 'monaco-unfocused-selection';

export interface MonacoCodeEditorProps {
  // File info
  filePath: string;
  fileName: string;

  // Content
  initialContent: string;

  // Theme
  theme: ConfigTheme;

  // Whether this editor's tab is active
  isActive?: boolean;

  // Callbacks matching StravuEditor interface
  onContentChange?: () => void;
  onGetContent?: (getContentFn: () => string) => void;
  onEditorReady?: (editor: any) => void;
}

export interface MonacoDiffModeConfig {
  oldContent: string;
  newContent: string;
}

export const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  filePath,
  fileName,
  initialContent,
  theme,
  isActive = true,
  onContentChange,
  onGetContent,
  onEditorReady,
}) => {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);
  const [content, setContent] = useState(initialContent);
  const initialContentRef = useRef(initialContent);
  const isProgrammaticChangeRef = useRef(false);

  // Diff mode state
  const [diffMode, setDiffMode] = useState<MonacoDiffModeConfig | null>(null);

  // Track selection decorations for unfocused state
  const selectionDecorationsRef = useRef<string[]>([]);
  const lastSelectionRef = useRef<Selection | null>(null);

  // Clear selection and decorations when tab becomes inactive
  useEffect(() => {
    if (!isActive && editorRef.current) {
      // Clear decorations
      if (selectionDecorationsRef.current.length > 0) {
        selectionDecorationsRef.current = editorRef.current.deltaDecorations(
          selectionDecorationsRef.current,
          []
        );
      }
      // Clear last selection ref
      lastSelectionRef.current = null;
      // Collapse selection to cursor position
      const pos = editorRef.current.getPosition();
      if (pos) {
        editorRef.current.setSelection({
          startLineNumber: pos.lineNumber,
          startColumn: pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column
        });
      }
    }
  }, [isActive]);

  // Get Monaco language from file extension
  const language = getMonacoLanguage(filePath);

  // Get Monaco theme from Nimbalyst theme
  const monacoTheme = getMonacoTheme(theme);

  /**
   * Get current editor content
   * Exposed to parent via onGetContent callback
   */
  const getContent = useCallback((): string => {
    // In diff mode, get content from the modified editor
    if (diffMode && diffEditorRef.current) {
      return diffEditorRef.current.getModifiedEditor().getValue();
    }

    if (!editorRef.current) {
      return content;
    }
    return editorRef.current.getValue();
  }, [content, diffMode]);

  /**
   * Set editor content programmatically
   * Used for external updates (e.g., file watcher reloads)
   */
  const setEditorContent = useCallback((newContent: string) => {
    console.log('[MonacoCodeEditor] setEditorContent called', {
      newLength: newContent.length,
      hasEditor: !!editorRef.current,
      preview: newContent.substring(0, 50)
    });

    // Update state first
    setContent(newContent);

    // Then update Monaco editor if it's mounted
    if (editorRef.current && !diffMode) {
      const currentValue = editorRef.current.getValue();
      console.log('[MonacoCodeEditor] Current editor value', {
        currentLength: currentValue.length,
        willUpdate: currentValue !== newContent
      });

      // Only update if content is different to avoid unnecessary operations
      if (currentValue !== newContent) {
        // Set flag to prevent onContentChange callback during programmatic update
        isProgrammaticChangeRef.current = true;
        console.log('[MonacoCodeEditor] Calling setValue');
        editorRef.current.setValue(newContent);
        console.log('[MonacoCodeEditor] setValue returned');
        // Reset flag after a small delay to allow the change event to process
        setTimeout(() => {
          isProgrammaticChangeRef.current = false;
        }, 0);
      }
    }
  }, [diffMode]);

  /**
   * Enter diff mode - show inline diff between old and new content
   * Used when AI edits are pending review
   */
  const showDiff = useCallback((oldContent: string, newContent: string) => {
    console.log('[MonacoCodeEditor] Entering diff mode', {
      oldLength: oldContent.length,
      newLength: newContent.length
    });

    setDiffMode({ oldContent, newContent });
  }, []);

  /**
   * Exit diff mode and return to normal editing
   */
  const exitDiffMode = useCallback(() => {
    console.log('[MonacoCodeEditor] Exiting diff mode');

    // Clear the diff editor model BEFORE unmounting to prevent disposal errors
    if (diffEditorRef.current) {
      try {
        console.log('[MonacoCodeEditor] Clearing diff editor model before unmount');
        diffEditorRef.current.setModel(null);
      } catch (error) {
        console.warn('[MonacoCodeEditor] Error clearing diff editor model:', error);
      }
    }

    // Now trigger React unmount
    // Note: Monaco may throw benign "Canceled" errors during disposal from its internal
    // cancellation token system. These are filtered by ErrorNotificationService.
    setDiffMode(null);
  }, []);

  /**
   * Accept the diff - get the new content
   * This is called by TabEditor when user clicks Accept All
   */
  const acceptDiff = useCallback((): string => {
    console.log('[MonacoCodeEditor] acceptDiff called', { hasDiffMode: !!diffMode });

    // Get content from diff editor if available
    if (diffEditorRef.current) {
      const newContent = diffEditorRef.current.getModifiedEditor().getValue();
      console.log('[MonacoCodeEditor] Got content from diff editor', { length: newContent.length });
      return newContent;
    }

    // Fallback: if we have diffMode state, return the new content
    if (diffMode) {
      console.log('[MonacoCodeEditor] Returning new content from diffMode state');
      return diffMode.newContent;
    }

    console.warn('[MonacoCodeEditor] acceptDiff called but no diff editor or diffMode available');
    return content;
  }, [diffMode, content]);

  /**
   * Reject the diff - get the old content
   * This is called by TabEditor when user clicks Reject All
   */
  const rejectDiff = useCallback((): string => {
    console.log('[MonacoCodeEditor] rejectDiff called', { hasDiffMode: !!diffMode });

    // Get content from diff editor if available
    if (diffEditorRef.current) {
      const oldContent = diffEditorRef.current.getOriginalEditor().getValue();
      console.log('[MonacoCodeEditor] Got content from diff editor (original)', { length: oldContent.length });
      return oldContent;
    }

    // Fallback: if we have diffMode state, return the old content
    if (diffMode) {
      console.log('[MonacoCodeEditor] Returning old content from diffMode state');
      return diffMode.oldContent;
    }

    console.warn('[MonacoCodeEditor] rejectDiff called but no diff editor or diffMode available');
    return content;
  }, [diffMode, content]);

  /**
   * Handle editor mount
   * Monaco editor is ready to use
   */
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    // Disable TypeScript/JavaScript diagnostics globally
    // We're primarily using Monaco for viewing AI diffs, not for code editing
    // This prevents error markers from showing up for incomplete/out-of-context code
    try {
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      });

      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      });
    } catch (error) {
      console.warn('[MonacoCodeEditor] Failed to disable diagnostics:', error);
    }

    // Expose getContent function to parent
    if (onGetContent) {
      onGetContent(getContent);
    }

    // Expose editor instance to parent (with setContent method and diff mode controls)
    if (onEditorReady) {
      onEditorReady({
        editor,
        setContent: setEditorContent,
        getContent,
        showDiff,
        exitDiffMode,
        acceptDiff,
        rejectDiff,
      });
    }

    // Listen for content changes
    editor.onDidChangeModelContent(() => {
      // Skip callback if this is a programmatic change
      if (isProgrammaticChangeRef.current) {
        return;
      }

      const newContent = editor.getValue();
      setContent(newContent);

      // Notify parent of content change
      if (onContentChange) {
        onContentChange();
      }
    });

    // Track selection changes to remember last selection
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        lastSelectionRef.current = selection;
      }
    });

    // Handle focus loss - show selection decoration
    editor.onDidBlurEditorWidget(() => {
      const selection = lastSelectionRef.current;
      if (selection && !selection.isEmpty()) {
        // Add decoration to show selection when unfocused
        selectionDecorationsRef.current = editor.deltaDecorations(
          selectionDecorationsRef.current,
          [{
            range: selection,
            options: {
              className: UNFOCUSED_SELECTION_CLASS,
              isWholeLine: false,
            }
          }]
        );
      }
    });

    // Handle focus gain - remove selection decoration
    editor.onDidFocusEditorWidget(() => {
      // Remove unfocused selection decoration
      if (selectionDecorationsRef.current.length > 0) {
        selectionDecorationsRef.current = editor.deltaDecorations(
          selectionDecorationsRef.current,
          []
        );
      }
    });

    // Focus editor on mount
    editor.focus();
  }, [getContent, setEditorContent, onGetContent, onEditorReady, onContentChange, showDiff, exitDiffMode, acceptDiff, rejectDiff]);

  /**
   * Handle diff editor mount
   * Monaco diff editor is ready to use
   */
  const handleDiffEditorMount = useCallback((editor: MonacoEditor.IStandaloneDiffEditor, monaco: any) => {
    diffEditorRef.current = editor;

    console.log('[MonacoCodeEditor] Diff editor mounted');

    // Disable diagnostics for diff editor too
    try {
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      });

      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      });
    } catch (error) {
      console.warn('[MonacoCodeEditor] Failed to disable diagnostics in diff editor:', error);
    }
  }, []);

  /**
   * Update editor theme when theme changes
   * Note: @monaco-editor/react automatically updates the theme via the theme prop,
   * but we also set it programmatically for immediate effect
   */
  useEffect(() => {
    if (editorRef.current) {
      try {
        const monaco = (window as any).monaco;
        if (monaco && monaco.editor) {
          monaco.editor.setTheme(monacoTheme);
        }
      } catch (error) {
        // Monaco might not be fully loaded yet, theme will be applied on next render
        console.warn('[MonacoCodeEditor] Failed to set theme:', error);
      }
    }
  }, [monacoTheme]);

  /**
   * Update initial content ref when it changes
   */
  useEffect(() => {
    initialContentRef.current = initialContent;
  }, [initialContent]);

  /**
   * Cleanup on unmount
   * If the component is unmounted while in diff mode (e.g., closing a tab),
   * we need to clear the model before @monaco-editor/react disposes the editor.
   * Monaco may throw benign "Canceled" errors during disposal from its
   * internal cancellation token system - these are filtered by ErrorNotificationService.
   */
  useEffect(() => {
    return () => {
      // If unmounting while in diff mode, clear the model first
      if (diffEditorRef.current) {
        try {
          console.log('[MonacoCodeEditor] Component unmounting with diff editor - clearing model');
          diffEditorRef.current.setModel(null);
        } catch (error) {
          console.warn('[MonacoCodeEditor] Error clearing diff editor model on unmount:', error);
        }
      }
    };
  }, []); // Empty deps - only run on unmount

  // Render diff editor when in diff mode, normal editor otherwise
  return (
    <div className="monaco-code-editor" data-file-path={filePath} data-diff-mode={!!diffMode}>
      {diffMode ? (
        <DiffEditor
          height="100%"
          language={language}
          original={diffMode.oldContent}
          modified={diffMode.newContent}
          theme={monacoTheme}
          onMount={handleDiffEditorMount}
          options={{
            automaticLayout: true,
            fontSize: 14,
            fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
            lineNumbers: 'on',
            minimap: {
              enabled: true,
            },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            // Diff-specific options
            renderSideBySide: false, // Inline diff mode (not side-by-side)
            readOnly: true, // No editing during diff review
            enableSplitViewResizing: false,
            renderOverviewRuler: true,
            // Disable error markers
            renderValidationDecorations: 'off',
            glyphMargin: false,
            // Accessibility
            accessibilitySupport: 'auto',
            // Silently handle unusual line terminators (U+2028, U+2029)
            unusualLineTerminators: 'auto',
          }}
        />
      ) : (
        <Editor
          height="100%"
          language={language}
          value={content}
          theme={monacoTheme}
          onMount={handleEditorMount}
          options={{
            automaticLayout: true,
            fontSize: 14,
            fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
            lineNumbers: 'on',
            minimap: {
              enabled: true,
            },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            tabSize: 2,
            insertSpaces: true,
            detectIndentation: true,
            renderWhitespace: 'selection',
            renderControlCharacters: false,
            folding: true,
            bracketPairColorization: {
              enabled: true,
            },
            // Disable error markers and diagnostics UI
            // We're primarily viewing AI diffs, not editing with full language support
            renderValidationDecorations: 'off', // No error squiggles
            glyphMargin: false, // No error icons in margin
            // Accessibility
            accessibilitySupport: 'auto',
            // Silently handle unusual line terminators (U+2028, U+2029)
            unusualLineTerminators: 'auto',
          }}
        />
      )}
    </div>
  );
};
