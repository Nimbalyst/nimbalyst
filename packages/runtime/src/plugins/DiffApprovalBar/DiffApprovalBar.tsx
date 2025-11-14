import { useEffect, useState, useCallback, useRef } from 'react';
import type { LexicalEditor } from 'lexical';
import { $getSelection, $isRangeSelection } from 'lexical';
import {
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
  CLEAR_DIFF_TAG_COMMAND,
  INCREMENTAL_APPROVAL_COMMAND,
  $approveChangeGroup,
  $rejectChangeGroup,
  groupDiffChanges,
  scrollToChangeGroup,
  type DiffChangeGroup,
  $getDiffState,
  $hasDiffNodes
} from 'rexical';
import { usePostHog } from 'posthog-js/react';
import './DiffApprovalBar.css';

interface DiffApprovalBarProps {
  filePath: string;
  fileName: string;
  editor?: LexicalEditor;
}

const HIGHLIGHT_CLASS_REMOVED = 'diff-group-highlight-removed';
const HIGHLIGHT_CLASS_ADDED = 'diff-group-highlight-added';
const HIGHLIGHT_CLASS_MODIFIED = 'diff-group-highlight-modified';

export function DiffApprovalBar({ editor }: DiffApprovalBarProps) {
  const [changeGroups, setChangeGroups] = useState<DiffChangeGroup[]>([]);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(-1); // -1 = no selection
  const isNavigatingRef = useRef(false); // Track programmatic navigation
  const posthog = usePostHog();

  // Update groups whenever editor changes
  const updateGroups = useCallback(() => {
    if (!editor) return;

    const groups = groupDiffChanges(editor);
    setChangeGroups(groups);

    // Adjust current index if out of bounds
    setCurrentGroupIndex(prev => {
      if (groups.length === 0) {
        return -1; // No groups, no selection
      }
      if (prev >= groups.length) {
        return Math.max(0, groups.length - 1);
      }
      if (prev === -1 && groups.length > 0) {
        return 0; // Auto-select first group if there was no selection
      }
      return prev;
    });
  }, [editor]);

  // Apply/remove highlighting based on current group
  useEffect(() => {
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
  }, [editor, changeGroups, currentGroupIndex]);

  // Listen for editor updates
  useEffect(() => {
    if (!editor) return;

    // Initial update
    updateGroups();

    const removeUpdateListener = editor.registerUpdateListener(() => {
      updateGroups();
    });

    return () => {
      removeUpdateListener();
    };
  }, [editor, updateGroups]);

  // Selection detection to update current group
  useEffect(() => {
    if (!editor || changeGroups.length === 0) return;

    const handleSelectionChange = () => {
      // Skip selection detection if we're programmatically navigating
      if (isNavigatingRef.current) return;

      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          // Don't clear the selection when there's no range selection
          // This preserves auto-selection behavior
          return;
        }

        // Get all selected nodes
        const selectedNodes = selection.getNodes();

        // Find which group contains any of the selected nodes
        let foundGroupIndex = -1;
        for (let i = 0; i < changeGroups.length; i++) {
          const group = changeGroups[i];

          // Check if any selected node is in this group
          // or if any selected node is a descendant of a node in this group
          for (const selectedNode of selectedNodes) {
            for (const groupNode of group.nodes) {
              if (selectedNode.getKey() === groupNode.getKey()) {
                foundGroupIndex = i;
                break;
              }

              // Check if selected node is a descendant of group node
              let parent = selectedNode.getParent();
              while (parent) {
                if (parent.getKey() === groupNode.getKey()) {
                  foundGroupIndex = i;
                  break;
                }
                parent = parent.getParent();
              }

              if (foundGroupIndex !== -1) break;
            }
            if (foundGroupIndex !== -1) break;
          }
          if (foundGroupIndex !== -1) break;
        }

        // Only update if we found a group or if the user selected outside diffs
        if (foundGroupIndex !== -1) {
          setCurrentGroupIndex(foundGroupIndex);
        }
      });
    };

    // Listen to selection changes
    const removeSelectionListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        handleSelectionChange();
      });
    });

    // Initial check
    handleSelectionChange();

    return () => {
      removeSelectionListener();
    };
  }, [editor, changeGroups]);

  const handlePrevious = () => {
    if (!editor || changeGroups.length === 0) return;

    // If at first group, re-scroll to it; otherwise go to previous
    const newIndex = currentGroupIndex <= 0
      ? 0  // Stay at first group (re-scroll)
      : currentGroupIndex - 1;

    const targetGroup = changeGroups[newIndex];

    // Set flag to prevent selection detection from interfering
    isNavigatingRef.current = true;

    // Directly set the index
    setCurrentGroupIndex(newIndex);

    // Scroll to the group first (before trying to select)
    scrollToChangeGroup(editor, newIndex, changeGroups);

    // Move the Lexical selection to this group for visual feedback
    // Try to select any node in the group that's selectable
    editor.update(() => {
      try {
        // Try each node in the group until one succeeds
        for (const node of targetGroup.nodes) {
          try {
            node.selectStart();
            break; // Success, stop trying
          } catch (e) {
            // This node isn't selectable, try next one
            continue;
          }
        }
      } catch (e) {
        console.warn('Failed to move selection to previous group:', e);
      }
    });

    // Reset flag after a brief delay
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 100);
  };

  const handleNext = () => {
    if (!editor || changeGroups.length === 0) return;

    // If at last group, re-scroll to it; otherwise go to next
    const newIndex = currentGroupIndex >= changeGroups.length - 1
      ? changeGroups.length - 1  // Stay at last group (re-scroll)
      : currentGroupIndex + 1;

    const targetGroup = changeGroups[newIndex];

    // Set flag to prevent selection detection from interfering
    isNavigatingRef.current = true;

    // Directly set the index
    setCurrentGroupIndex(newIndex);

    // Scroll to the group first (before trying to select)
    scrollToChangeGroup(editor, newIndex, changeGroups);

    // Move the Lexical selection to this group for visual feedback
    // Try to select any node in the group that's selectable
    editor.update(() => {
      try {
        // Try each node in the group until one succeeds
        for (const node of targetGroup.nodes) {
          try {
            node.selectStart();
            break; // Success, stop trying
          } catch (e) {
            // This node isn't selectable, try next one
            continue;
          }
        }
      } catch (e) {
        console.warn('Failed to move selection to next group:', e);
      }
    });

    // Reset flag after a brief delay
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 100);
  };

  const handleAcceptThis = () => {
    if (!editor || currentGroupIndex < 0 || currentGroupIndex >= changeGroups.length) return;

    const indexBeforeApproval = currentGroupIndex;
    const currentGroup = changeGroups[indexBeforeApproval];

    // Track analytics event for accepting a single diff
    posthog?.capture('ai_diff_accepted', {
      acceptType: 'partial',
      replacementCount: currentGroup.nodes.length,
      provider: 'unknown' // Provider is not available in this context
    });

    $approveChangeGroup(editor, currentGroup.nodes);

    // Wait for groups to update, then check if all diffs are cleared
    setTimeout(() => {
      const updatedGroups = groupDiffChanges(editor);
      const hasDiff = $hasDiffNodes(editor);

      console.log('[DiffApprovalBar handleAcceptThis] After accept:', {
        groupCount: updatedGroups.length,
        hasDiff,
        willDispatchClear: updatedGroups.length === 0 || !hasDiff
      });

      // Check if this was the last diff - if so, trigger cleanup
      if (updatedGroups.length === 0 || !hasDiff) {
        // All diffs cleared - dispatch CLEAR_DIFF_TAG_COMMAND
        // This is handled by TabEditor in Electron to mark tag as reviewed
        console.log('[DiffApprovalBar] Dispatching CLEAR_DIFF_TAG_COMMAND');
        editor.dispatchCommand(CLEAR_DIFF_TAG_COMMAND, undefined);
        return;
      }

      // Still have diffs - dispatch INCREMENTAL_APPROVAL_COMMAND
      // This is handled by TabEditor in Electron to create incremental-approval tag
      console.log('[DiffApprovalBar] Dispatching INCREMENTAL_APPROVAL_COMMAND');
      editor.dispatchCommand(INCREMENTAL_APPROVAL_COMMAND, undefined);

      // Move to next group
      const newIndex = Math.min(indexBeforeApproval, updatedGroups.length - 1);
      const nextGroup = updatedGroups[newIndex];

      // Move the actual Lexical selection to the next group
      // Try to select any node in the group that's selectable
      editor.update(() => {
        try {
          // Try each node in the group until one succeeds
          for (const node of nextGroup.nodes) {
            try {
              node.selectStart();
              break; // Success, stop trying
            } catch (e) {
              // This node isn't selectable, try next one
              continue;
            }
          }
        } catch (e) {
          console.warn('Failed to move selection to next group:', e);
        }
      });
    }, 100);
  };

  const handleRejectThis = () => {
    if (!editor || currentGroupIndex < 0 || currentGroupIndex >= changeGroups.length) return;

    const indexBeforeRejection = currentGroupIndex;
    const currentGroup = changeGroups[indexBeforeRejection];

    // Track analytics event for rejecting a single diff
    posthog?.capture('ai_diff_rejected', {
      rejectType: 'partial',
      replacementCount: currentGroup.nodes.length,
      provider: 'unknown' // Provider is not available in this context
    });

    $rejectChangeGroup(editor, currentGroup.nodes);

    // Wait for groups to update, then check if all diffs are cleared
    setTimeout(() => {
      const updatedGroups = groupDiffChanges(editor);
      const hasDiff = $hasDiffNodes(editor);

      // Check if this was the last diff - if so, trigger cleanup
      if (updatedGroups.length === 0 || !hasDiff) {
        // All diffs cleared - dispatch CLEAR_DIFF_TAG_COMMAND
        // This is handled by TabEditor in Electron to mark tag as reviewed
        editor.dispatchCommand(CLEAR_DIFF_TAG_COMMAND, undefined);
        return;
      }

      // Still have diffs - dispatch INCREMENTAL_APPROVAL_COMMAND
      // This is handled by TabEditor in Electron to create incremental-approval tag
      editor.dispatchCommand(INCREMENTAL_APPROVAL_COMMAND, undefined);

      // Move to next group
      const newIndex = Math.min(indexBeforeRejection, updatedGroups.length - 1);
      const nextGroup = updatedGroups[newIndex];

      // Move the actual Lexical selection to the next group
      // Try to select any node in the group that's selectable
      editor.update(() => {
        try {
          // Try each node in the group until one succeeds
          for (const node of nextGroup.nodes) {
            try {
              node.selectStart();
              break; // Success, stop trying
            } catch (e) {
              // This node isn't selectable, try next one
              continue;
            }
          }
        } catch (e) {
          console.warn('Failed to move selection to next group:', e);
        }
      });
    }, 100);
  };

  const hasSelection = currentGroupIndex >= 0 && currentGroupIndex < changeGroups.length;

  const handleAcceptAll = () => {
    if (editor) {
      // Track analytics event for accepting all diffs
      const totalNodes = changeGroups.reduce((sum, group) => sum + group.nodes.length, 0);
      posthog?.capture('ai_diff_accepted', {
        acceptType: 'all',
        replacementCount: totalNodes,
        provider: 'unknown' // Provider is not available in this context
      });

      editor.dispatchCommand(APPROVE_DIFF_COMMAND, undefined);
    }
  };

  const handleRejectAll = () => {
    if (editor) {
      // Track analytics event for rejecting all diffs
      const totalNodes = changeGroups.reduce((sum, group) => sum + group.nodes.length, 0);
      posthog?.capture('ai_diff_rejected', {
        rejectType: 'all',
        replacementCount: totalNodes,
        provider: 'unknown' // Provider is not available in this context
      });

      editor.dispatchCommand(REJECT_DIFF_COMMAND, undefined);
    }
  };

  if (changeGroups.length === 0) {
    return null;
  }

  return (
    <div className="diff-approval-bar">
      <div className="diff-approval-bar-content">
        <span className="diff-approval-bar-label">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L9 5L13 6L9 7L8 11L7 7L3 6L7 5L8 1Z" fill="currentColor"/>
          </svg>
        </span>

        <div className="diff-approval-bar-navigation">
          <button
            onClick={handlePrevious}
            aria-label="Previous change"
            className="diff-nav-button"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 9L3 6L6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="diff-change-counter">
            {hasSelection ? `${currentGroupIndex + 1} of ${changeGroups.length}` : `${changeGroups.length} changes`}
          </span>
          <button
            onClick={handleNext}
            aria-label="Next change"
            className="diff-nav-button"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 3L9 6L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="diff-approval-bar-actions">
          <button
            className="diff-reject-button"
            data-action="reject-single"
            onClick={handleRejectThis}
            title="Undo this change"
            disabled={!hasSelection}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M10 4L4 10M4 4L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Undo
          </button>
          <button
            className="diff-accept-button"
            data-action="accept-single"
            onClick={handleAcceptThis}
            title="Keep this change"
            disabled={!hasSelection}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M12 3L5 10L2 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Keep
          </button>
          <button
            className="diff-reject-all-button"
            data-action="reject-all"
            onClick={handleRejectAll}
            title="Undo all changes"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M10 4L4 10M4 4L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Undo All
          </button>
          <button
            className="diff-accept-all-button"
            data-action="accept-all"
            onClick={handleAcceptAll}
            title="Keep all changes"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M12 3L5 10L2 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Keep All
          </button>
        </div>
      </div>
    </div>
  );
}
