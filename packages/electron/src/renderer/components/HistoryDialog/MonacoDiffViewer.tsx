import React, { useRef, useEffect } from 'react';
import * as monaco from 'monaco-editor';
import { getMonacoLanguage } from '../../utils/fileTypeDetector';
import './MonacoDiffViewer.css';

interface MonacoDiffViewerProps {
  oldContent: string;
  newContent: string;
  filePath: string;
  theme?: 'light' | 'dark' | 'crystal-dark';
}

export function MonacoDiffViewer({
  oldContent,
  newContent,
  filePath,
  theme = 'light'
}: MonacoDiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    // Set Monaco theme based on current theme
    const monacoTheme = theme === 'light' ? 'vs' : 'vs-dark';

    // Detect language from file extension
    const language = getMonacoLanguage(filePath);

    // Create models for original and modified content
    const originalModel = monaco.editor.createModel(oldContent, language);
    const modifiedModel = monaco.editor.createModel(newContent, language);

    // Create diff editor
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: monacoTheme,
      readOnly: true,
      renderSideBySide: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      lineNumbers: 'on',
      glyphMargin: false,
      folding: false,
      automaticLayout: true,
      scrollbar: {
        vertical: 'visible',
        horizontal: 'visible',
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10
      },
      // Disable diff computation options that might cause issues
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      enableSplitViewResizing: false
    });

    diffEditorRef.current = diffEditor;

    // Set the models after a brief delay to ensure editor is ready
    requestAnimationFrame(() => {
      if (!disposed) {
        try {
          diffEditor.setModel({
            original: originalModel,
            modified: modifiedModel
          });
        } catch (error) {
          console.error('[MonacoDiffViewer] Failed to set model:', error);
        }
      }
    });

    // Cleanup on unmount - dispose in correct order
    return () => {
      disposed = true;

      try {
        // First clear the model from the editor
        if (diffEditor) {
          diffEditor.setModel(null);
          diffEditor.dispose();
        }
      } catch (error) {
        console.error('[MonacoDiffViewer] Error disposing editor:', error);
      }

      // Finally dispose the models
      try {
        originalModel.dispose();
        modifiedModel.dispose();
      } catch (error) {
        console.error('[MonacoDiffViewer] Error disposing models:', error);
      }
    };
  }, [oldContent, newContent, filePath, theme]);

  return (
    <div className="monaco-diff-viewer">
      <div ref={containerRef} className="monaco-diff-container" />
    </div>
  );
}
