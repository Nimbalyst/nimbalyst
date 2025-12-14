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
// Uses singleton promise pattern to prevent race conditions during concurrent loads
let mermaidPromise: Promise<any> | null = null;
let currentTheme: string | null = null;

async function loadMermaid(isDarkTheme: boolean): Promise<any> {
  const theme = isDarkTheme ? 'dark' : 'default';

  // If theme changed, force re-initialization
  if (currentTheme !== null && currentTheme !== theme) {
    mermaidPromise = null;
  }

  if (!mermaidPromise) {
    currentTheme = theme;
    mermaidPromise = (async () => {
      const module = await import('mermaid');
      // In mermaid v11+, use the named export or default
      const mermaid = module.default || (module as any).mermaid || module;

      // Check if we got a valid mermaid instance
      if (typeof mermaid.initialize !== 'function') {
        console.error('Invalid mermaid instance:', mermaid);
        throw new Error('Failed to load mermaid module');
      }

      mermaid.initialize({
        startOnLoad: false,
        theme: theme,
        securityLevel: 'antiscript',
        fontFamily: 'monospace',
      });
      return mermaid;
    })();
  }

  return mermaidPromise;
}

function MermaidDiagram({ content, id, renderKey }: { content: string; id: string; renderKey: number }) {
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

        // Use mermaid.render() for more control - it returns SVG directly
        // Use a unique ID with renderKey to avoid mermaid's internal caching issues
        const elementId = `mermaid_${id}_${renderKey}_${Date.now()}`;
        const { svg, bindFunctions } = await mermaid.render(elementId, content);

        if (!mounted) return;

        // Insert the rendered SVG
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          // Bind any interactive functions (like click handlers) to the SVG
          if (bindFunctions) {
            bindFunctions(containerRef.current);
          }
          setError(null);
        }
      } catch (err: any) {
        if (mounted) {
          console.error('Mermaid render error:', err);
          // Extract error message - mermaid errors can have various structures
          let errorMessage = 'Failed to render diagram';
          if (typeof err === 'string') {
            errorMessage = err;
          } else if (err?.message) {
            errorMessage = err.message;
          } else if (err?.str) {
            // Mermaid parser errors often have a 'str' property
            errorMessage = err.str;
          } else if (err?.hash?.text) {
            // Some mermaid errors have hash.text
            errorMessage = `Parse error near: ${err.hash.text}`;
          } else if (typeof err === 'object') {
            // Last resort: try to stringify the object for debugging
            try {
              const jsonStr = JSON.stringify(err, null, 2);
              if (jsonStr !== '{}') {
                errorMessage = jsonStr;
              }
            } catch {
              // If JSON.stringify fails, keep default message
            }
          }
          setError(errorMessage);
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
  }, [content, id, isDarkTheme, renderKey]);

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
  const [renderKey, setRenderKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasInitializedRef = useRef(false);

  const handleRedraw = useCallback(() => {
    // Force re-render by incrementing the render key
    setRenderKey((k) => k + 1);
  }, []);

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
        <div className="mermaid-header-buttons">
          <button
            className="mermaid-redraw-button"
            onClick={handleRedraw}
            title="Redraw diagram"
          >
            Redraw
          </button>
          <button
            className={`mermaid-edit-button ${isEditing ? 'mermaid-edit-button-active' : ''}`}
            onClick={handleToggleEdit}
          >
            {isEditing ? 'Done' : 'Edit'}
          </button>
        </div>
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
          <MermaidDiagram content={content} id={nodeKey} renderKey={renderKey} />
        </React.Suspense>
      </ErrorBoundary>
    </div>
  );
}

export default MermaidComponent;
