/**
 * MonacoCodeEditor - Monaco Editor wrapper for code files
 *
 * This component wraps Monaco Editor to provide:
 * - Normal editing mode with syntax highlighting
 * - Diff mode for AI-generated changes (Phase 2)
 * - Same interface as StravuEditor for seamless TabEditor integration
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { Theme as ConfigTheme } from 'rexical';
import { getMonacoTheme } from '../../utils/monacoThemeMapper';
import { getMonacoLanguage } from '../../utils/fileTypeDetector';
import './MonacoCodeEditor.css';

export interface MonacoCodeEditorProps {
  // File info
  filePath: string;
  fileName: string;

  // Content
  initialContent: string;

  // Theme
  theme: ConfigTheme;

  // Callbacks matching StravuEditor interface
  onContentChange?: () => void;
  onGetContent?: (getContentFn: () => string) => void;
  onEditorReady?: (editor: any) => void;
}

export const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  filePath,
  fileName,
  initialContent,
  theme,
  onContentChange,
  onGetContent,
  onEditorReady,
}) => {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState(initialContent);
  const initialContentRef = useRef(initialContent);
  const isProgrammaticChangeRef = useRef(false);

  // Get Monaco language from file extension
  const language = getMonacoLanguage(filePath);

  // Get Monaco theme from Nimbalyst theme
  const monacoTheme = getMonacoTheme(theme);

  /**
   * Get current editor content
   * Exposed to parent via onGetContent callback
   */
  const getContent = useCallback((): string => {
    if (!editorRef.current) {
      return content;
    }
    return editorRef.current.getValue();
  }, [content]);

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
    if (editorRef.current) {
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
  }, []);

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

    // Expose editor instance to parent (with setContent method)
    if (onEditorReady) {
      onEditorReady({
        editor,
        setContent: setEditorContent,
        getContent,
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

    // Focus editor on mount
    editor.focus();
  }, [getContent, setEditorContent, onGetContent, onEditorReady, onContentChange]);

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

  return (
    <div className="monaco-code-editor" data-file-path={filePath}>
      <Editor
        height="100%"
        language={language}
        value={initialContent}
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
        }}
      />
    </div>
  );
};
