import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StravuEditor, pluginRegistry } from 'rexical';
import {
  APPLY_MARKDOWN_REPLACE_COMMAND,
  groupDiffChanges,
  scrollToChangeGroup,
  $getDiffState,
  type DiffChangeGroup
} from 'rexical';
import type { LexicalEditor } from 'lexical';
import './DiffPreviewEditor.css';

const HIGHLIGHT_CLASS_REMOVED = 'diff-group-highlight-removed';
const HIGHLIGHT_CLASS_ADDED = 'diff-group-highlight-added';
const HIGHLIGHT_CLASS_MODIFIED = 'diff-group-highlight-modified';

export interface DiffNavigationState {
  currentIndex: number;
  totalGroups: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
}

interface DiffPreviewEditorProps {
  oldMarkdown: string;
  newMarkdown: string;
  onNavigationStateChange?: (state: DiffNavigationState) => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
}

export function DiffPreviewEditor({
  oldMarkdown,
  newMarkdown,
  onNavigationStateChange,
  onNavigatePrevious,
  onNavigateNext
}: DiffPreviewEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const appliedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [changeGroups, setChangeGroups] = useState<DiffChangeGroup[]>([]);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const isNavigatingRef = useRef(false);

  // Debug: Log what nodes are in the registry
  useEffect(() => {
    console.log('[DiffPreviewEditor] Plugin registry nodes:', pluginRegistry.getAllNodes().map(n => n.name));
    console.log('[DiffPreviewEditor] All plugins:', pluginRegistry.getAll().map(p => p.name));
  }, []);

  // Update groups whenever editor changes
  const updateGroups = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const groups = groupDiffChanges(editor);
    setChangeGroups(groups);

    // Update navigation state
    if (onNavigationStateChange) {
      onNavigationStateChange({
        currentIndex: groups.length > 0 ? currentGroupIndex : -1,
        totalGroups: groups.length,
        canGoPrevious: currentGroupIndex > 0,
        canGoNext: currentGroupIndex < groups.length - 1
      });
    }

    // Adjust current index if out of bounds
    setCurrentGroupIndex(prev => {
      if (groups.length === 0) return 0;
      if (prev >= groups.length) return Math.max(0, groups.length - 1);
      return prev;
    });
  }, [currentGroupIndex, onNavigationStateChange]);

  // Apply/remove highlighting based on current group
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || changeGroups.length === 0) return;

    // Remove old highlights
    const removeHighlights = () => {
      editor.update(() => {
        const root = editor.getRootElement();
        if (!root) return;

        root.querySelectorAll(`.${HIGHLIGHT_CLASS_REMOVED}`).forEach(el =>
          el.classList.remove(HIGHLIGHT_CLASS_REMOVED));
        root.querySelectorAll(`.${HIGHLIGHT_CLASS_ADDED}`).forEach(el =>
          el.classList.remove(HIGHLIGHT_CLASS_ADDED));
        root.querySelectorAll(`.${HIGHLIGHT_CLASS_MODIFIED}`).forEach(el =>
          el.classList.remove(HIGHLIGHT_CLASS_MODIFIED));
      });
    };

    // Add highlight to current group
    const addHighlight = () => {
      if (currentGroupIndex < 0 || currentGroupIndex >= changeGroups.length) return;

      const currentGroup = changeGroups[currentGroupIndex];

      // Collect node keys and their diff states
      const nodeInfo: Array<{ key: string; highlightClass: string }> = [];

      editor.getEditorState().read(() => {
        for (const node of currentGroup.nodes) {
          try {
            const nodeType = node.getType();
            const diffState = $getDiffState(node);

            let highlightClass = HIGHLIGHT_CLASS_MODIFIED;
            if (diffState === 'removed' || nodeType === 'remove') {
              highlightClass = HIGHLIGHT_CLASS_REMOVED;
            } else if (diffState === 'added' || nodeType === 'add') {
              highlightClass = HIGHLIGHT_CLASS_ADDED;
            }

            nodeInfo.push({
              key: node.getKey(),
              highlightClass,
            });
          } catch (e) {
            // Node might not be attached anymore
          }
        }
      });

      // Apply highlights to DOM elements
      editor.update(() => {
        for (const info of nodeInfo) {
          try {
            const element = editor.getElementByKey(info.key);
            if (element) {
              element.classList.add(info.highlightClass);
            }
          } catch (e) {
            // Element might not exist
          }
        }
      });
    };

    removeHighlights();
    addHighlight();

    return () => {
      removeHighlights();
    };
  }, [changeGroups, currentGroupIndex]);

  // Listen for editor updates
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const removeUpdateListener = editor.registerUpdateListener(() => {
      updateGroups();
    });

    return () => {
      removeUpdateListener();
    };
  }, [updateGroups]);

  // Handle navigation callbacks from parent
  useEffect(() => {
    if (!onNavigatePrevious || !onNavigateNext) return;

    // Store navigation handlers on window so parent can call them
    (window as any).__richDiffNavigatePrevious = () => {
      if (currentGroupIndex > 0) {
        const newIndex = currentGroupIndex - 1;
        setCurrentGroupIndex(newIndex);
        if (editorRef.current && changeGroups.length > 0) {
          scrollToChangeGroup(editorRef.current, newIndex, changeGroups);
        }
      }
    };

    (window as any).__richDiffNavigateNext = () => {
      if (currentGroupIndex < changeGroups.length - 1) {
        const newIndex = currentGroupIndex + 1;
        setCurrentGroupIndex(newIndex);
        if (editorRef.current && changeGroups.length > 0) {
          scrollToChangeGroup(editorRef.current, newIndex, changeGroups);
        }
      }
    };
  }, [currentGroupIndex, changeGroups, onNavigatePrevious, onNavigateNext]);

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
        setTimeout(() => {
          setIsReady(true);
          // Initial groups update after diff is applied
          updateGroups();
        }, 100);
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
