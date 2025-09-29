/**
 * MermaidComponent - React component for rendering Mermaid diagrams
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, NodeKey } from 'lexical';
import { $isMermaidNode } from './MermaidNode';
import { ErrorBoundary } from 'react-error-boundary';
import { useTheme } from '../../context/ThemeContext';
import './MermaidPlugin.css';

interface MermaidComponentProps {
  content: string;
  nodeKey: NodeKey;
  className?: string;
}

// Dynamic import to avoid bundling mermaid when not needed
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let currentTheme: string | null = null;

function loadMermaid(isDarkTheme: boolean) {
  const theme = isDarkTheme ? 'dark' : 'default';

  // Re-initialize if theme changed
  if (!mermaidPromise || currentTheme !== theme) {
    mermaidPromise = import('mermaid').then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: theme,
        securityLevel: 'antiscript',
        fontFamily: 'monospace',
      });
      currentTheme = theme;
      return mermaid;
    });
  }
  return mermaidPromise;
}

function MermaidDiagram({ content, id }: { content: string; id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { theme } = useTheme();
  const isDarkTheme = theme === 'dark' || theme === 'crystal-dark';

  useEffect(() => {
    let mounted = true;

    // Clear any pending render
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    // Debounce the render by 500ms
    renderTimeoutRef.current = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid(isDarkTheme);

        if (!mounted) return;

        // Parse the diagram to check for errors
        const parseResult = await mermaid.parse(content);

        if (!mounted) return;

        // Render the diagram
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          const elementId = `mermaid_${id}`;
          const div = document.createElement('div');
          div.id = elementId;
          div.textContent = content;
          containerRef.current.appendChild(div);

          await mermaid.run({
            querySelector: `#${elementId}`,
          });

          setError(null);
        }
      } catch (err) {
        if (mounted) {
          console.error('Mermaid render error:', err);
          setError(err?.toString() || 'Failed to render diagram');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }, 500);

    return () => {
      mounted = false;
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [content, id, isDarkTheme]);

  return (
    <div className="mermaid-diagram">
      {loading && !error && <div className="mermaid-loading">Loading diagram...</div>}
      <div ref={containerRef} className="mermaid-render-container" />
      {error && (
        <div className="mermaid-error">
          <strong>Diagram Error:</strong>
          <pre>{error}</pre>
        </div>
      )}
    </div>
  );
}

function MermaidComponent({ content: initialContent, nodeKey, className }: MermaidComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [editedContent, setEditedContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasInitializedRef = useRef(false);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    if (isEditing) {
      adjustTextareaHeight();
    }
  }, [editedContent, isEditing, adjustTextareaHeight]);

  // Save content to node when toggling edit mode off or on blur
  const saveToNode = useCallback((newContent: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMermaidNode(node)) {
        node.setContent(newContent);
      }
    });
  }, [editor, nodeKey]);

  const handleToggleEdit = () => {
    if (isEditing) {
      // Save when closing edit mode
      saveToNode(editedContent);
    }
    setIsEditing(!isEditing);
  };

  // Update local state and preview as user types (no node update yet)
  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setContent(newContent);
  };

  // Only use initialContent on first mount
  useEffect(() => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      setContent(initialContent);
      setEditedContent(initialContent);
    }
  }, [initialContent]);

  return (
    <div className={`mermaid-block ${className || ''}`}>
      <div className="mermaid-header">
        <span className="mermaid-label">Mermaid Diagram</span>
        <button
          className={`mermaid-edit-button ${isEditing ? 'mermaid-edit-button-active' : ''}`}
          onClick={handleToggleEdit}
        >
          {isEditing ? 'Done' : 'Edit'}
        </button>
      </div>

      {isEditing && (
        <div className="mermaid-editor">
          <textarea
            ref={textareaRef}
            className="mermaid-textarea"
            value={editedContent}
            onChange={(e) => {
              handleContentChange(e.target.value);
              adjustTextareaHeight();
            }}
            onBlur={() => {
              // Save when textarea loses focus
              saveToNode(editedContent);
            }}
            placeholder="Enter Mermaid diagram code..."
            autoFocus
          />
        </div>
      )}

      <ErrorBoundary
        fallback={
          <div className="mermaid-error">
            Failed to render Mermaid diagram
          </div>
        }
      >
        <React.Suspense fallback={<div className="mermaid-loading">Loading...</div>}>
          <MermaidDiagram content={content} id={nodeKey} />
        </React.Suspense>
      </ErrorBoundary>
    </div>
  );
}

export default MermaidComponent;
