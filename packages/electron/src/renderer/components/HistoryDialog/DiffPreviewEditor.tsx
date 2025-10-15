import React, { useEffect, useRef, useState } from 'react';
import { StravuEditor, pluginRegistry } from 'rexical';
import { APPLY_MARKDOWN_REPLACE_COMMAND } from 'rexical';
import type { LexicalEditor } from 'lexical';
import './DiffPreviewEditor.css';

interface DiffPreviewEditorProps {
  oldMarkdown: string;
  newMarkdown: string;
}

export function DiffPreviewEditor({ oldMarkdown, newMarkdown }: DiffPreviewEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const appliedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  // Debug: Log what nodes are in the registry
  useEffect(() => {
    console.log('[DiffPreviewEditor] Plugin registry nodes:', pluginRegistry.getAllNodes().map(n => n.name));
    console.log('[DiffPreviewEditor] All plugins:', pluginRegistry.getAll().map(p => p.name));
  }, []);

  const handleEditorReady = (editor: LexicalEditor) => {
    editorRef.current = editor;

    if (appliedRef.current) return;
    appliedRef.current = true;

    // Wait for markdown to be loaded and plugins to register
    setTimeout(() => {
      const replacements = [{ oldText: oldMarkdown, newText: newMarkdown }];

      try {
        console.log('[DiffPreviewEditor] Applying diff replacements:', replacements);
        console.log('[DiffPreviewEditor] Old markdown length:', oldMarkdown.length);
        console.log('[DiffPreviewEditor] New markdown length:', newMarkdown.length);

        const result = editor.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
        console.log('[DiffPreviewEditor] Command dispatch result:', result);

        // Show the editor after diff is applied
        setTimeout(() => setIsReady(true), 100);
      } catch (error) {
        console.error('[DiffPreviewEditor] Failed to apply diff in preview:', error);
        setIsReady(true); // Show anyway if there's an error
      }
    }, 1000);
  };

  return (
    <div className={`diff-preview-editor ${!isReady ? 'loading' : ''}`}>
      <div className="diff-preview-editor-container">
        <StravuEditor
          config={{
            initialContent: oldMarkdown,
            isRichText: true,
            editable: false,
            onEditorReady: handleEditorReady,
          }}
        />
      </div>
    </div>
  );
}
