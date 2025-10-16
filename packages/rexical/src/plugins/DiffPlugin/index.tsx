/**
 * Lexical Diff Plugin
 *
 * Provides visual diff functionality with approve/reject capabilities
 * for the Stravu Editor. This plugin handles:
 * - Visual diff rendering with CSS classes
 * - Approve/reject commands
 * - Diff toolbar component
 */

import type { Change } from './core/exports';
import type { JSX } from 'react';

import {
  $approveDiffs,
  $getDiffState,
  $hasDiffNodes,
  $rejectDiffs,
  $setDiffState,
  APPLY_DIFF_COMMAND,
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
  applyMarkdownReplace,
  type TextReplacement,
} from './core/exports';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $convertToEnhancedMarkdownString, getEditorTransformers } from '../../markdown';
import { $isTableNode, $isTableRowNode, $isTableCellNode } from '@lexical/table';
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  LexicalNode,
} from 'lexical';
import React, { useEffect, useCallback } from 'react';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { DiffToolbar } from './DiffToolbar';

import { createCommand } from 'lexical';

/**
 * Payload for APPLY_MARKDOWN_REPLACE_COMMAND
 * Supports both legacy array format and new object format with requestId
 */
type ApplyMarkdownReplacePayload =
  | TextReplacement[]
  | {
      replacements: TextReplacement[];
      requestId?: string;
    };

/**
 * Custom command for applying markdown replacements
 */
export const APPLY_MARKDOWN_REPLACE_COMMAND = createCommand<ApplyMarkdownReplacePayload>('APPLY_MARKDOWN_REPLACE_COMMAND');

/**
 * React plugin component that sets up commands for diff functionality.
 * This plugin automatically applies CSS classes to nodes based on their diff state.
 */
export function DiffPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();

  useEffect(() => {
    // Apply diff styling based on node state
    const updateDiffStyling = () => {
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const theme = editor._config.theme;

        // Get theme classes for diff styling
        const diffAddClass = theme?.diffAdd;
        const diffRemoveClass = theme?.diffRemove;
        const diffModifyClass = theme?.diffModify;

        if (!diffAddClass && !diffRemoveClass && !diffModifyClass) {
          return; // No theme classes defined
        }

        const traverseNodes = (node: LexicalNode) => {
          // Skip table row nodes as they don't have direct DOM elements in some implementations
          // But DO process table nodes and table cell nodes which have DOM elements
          const isTableRowNode = $isTableRowNode(node);

          if (!isTableRowNode) {
            const diffState = $getDiffState(node);
            const element = editor.getElementByKey(node.getKey());

            if (element) {
              // Clear existing diff classes
              if (diffAddClass && element.classList.contains(diffAddClass)) {
                element.classList.remove(diffAddClass);
              }
              if (diffRemoveClass && element.classList.contains(diffRemoveClass)) {
                element.classList.remove(diffRemoveClass);
              }
              if (diffModifyClass && element.classList.contains(diffModifyClass)) {
                element.classList.remove(diffModifyClass);
              }

              // Apply appropriate diff class based on state
              if (diffState === 'added' && diffAddClass) {
                element.classList.add(diffAddClass);
              } else if (diffState === 'removed' && diffRemoveClass) {
                element.classList.add(diffRemoveClass);
              } else if (diffState === 'modified' && diffModifyClass) {
                element.classList.add(diffModifyClass);
              }
            }
          }

          if ($isElementNode(node)) {
            // Recursively process children
            for (const child of node.getChildren()) {
              traverseNodes(child);
            }
          }
        };

        // Traverse all nodes from root
        for (const child of root.getChildren()) {
          traverseNodes(child);
        }
      });
    };

    // Update styling on editor state changes
    const removeUpdateListener = editor.registerUpdateListener(() => {
      updateDiffStyling();
    });

    // Initial styling application
    updateDiffStyling();

    // Register the command to apply diffs
    const applyDiffUnregister = editor.registerCommand<Change>(
      APPLY_DIFF_COMMAND,
      (payload) => {
        const { type, oldText, newText } = payload;

        // Apply diff at current selection
        editor.update(() => {
          const selection = $getSelection();

          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return false;
          }

          // Remove old text
          if (type === 'remove' && oldText) {
            const removeNode = $createTextNode(oldText);
            $setDiffState(removeNode, 'removed');
            selection.insertNodes([removeNode]);
          }

          // Add new text
          if ((type === 'add' || type === 'change') && newText) {
            const addNode = $createTextNode(newText);
            $setDiffState(addNode, 'added');
            selection.insertNodes([addNode]);
          }
        });

        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    // Register command to apply markdown replacements
    const applyMarkdownReplaceUnregister = editor.registerCommand<ApplyMarkdownReplacePayload>(
      APPLY_MARKDOWN_REPLACE_COMMAND,
      (payload) => {
        // Handle both old format (array) and new format (object with replacements + requestId)
        const replacements = Array.isArray(payload) ? payload : payload?.replacements;
        const requestId = Array.isArray(payload) ? undefined : payload?.requestId;

        if (!replacements || replacements.length === 0) {
          return false;
        }

        try {
          // Get transformers including both core and plugin transformers
          const transformers = getEditorTransformers();

          // Get current markdown content
          const currentMarkdown = editor.getEditorState().read(() => {
            return $convertToEnhancedMarkdownString(transformers);
          });

          // Apply the replacements inside editor.update and handle errors there
          // IMPORTANT: We must dispatch events INSIDE the editor.update callback
          // because when an error occurs, editor.update() may not return normally
          editor.update(() => {
            try {
              applyMarkdownReplace(
                editor,
                currentMarkdown,
                replacements,
                transformers
              );

              // Success - dispatch completion event from INSIDE the update callback
              // Use setTimeout to defer event dispatch to next tick to avoid race condition
              if (typeof window !== 'undefined') {
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('diffApplyComplete', {
                    detail: { success: true, requestId }
                  }));
                }, 0);
              }
            } catch (error: any) {
              // Handle error from INSIDE the editor.update callback
              // Extract meaningful error message
              let errorMessage = 'Failed to apply changes';

              if (error?.context?.errorType === 'TEXT_REPLACEMENT_ERROR') {
                const replacement = error.context?.additionalInfo?.replacement;
                if (replacement) {
                  errorMessage = `Could not find matching text in the document. The text may have been modified or contains different whitespace/formatting.`;
                }
              } else if (error?.message) {
                errorMessage = error.message;
              }

              // Dispatch error event from INSIDE the catch block
              // Use setTimeout to defer event dispatch to next tick to avoid race condition
              if (typeof window !== 'undefined') {
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('diffApplyComplete', {
                    detail: { success: false, error: errorMessage, requestId }
                  }));
                }, 0);
              }
            }
          }, { discrete: true });

          return true;
        } catch (error: any) {
          // This catches errors from getting markdown or other setup BEFORE editor.update
          // Errors from applyMarkdownReplace are caught inside the editor.update callback above
          console.error('[DiffPlugin] Setup error before editor.update:', error);

          // Dispatch error event for setup errors
          // Use setTimeout to defer event dispatch to next tick to avoid race condition
          if (typeof window !== 'undefined') {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('diffApplyComplete', {
                detail: { success: false, error: error.message || 'Unknown error', requestId }
              }));
            }, 0);
          }

          return true;
        }
      },
      COMMAND_PRIORITY_EDITOR,
    );

    // Register command to approve all diffs
    const approveDiffUnregister = editor.registerCommand(
      APPROVE_DIFF_COMMAND,
      () => {
        editor.update(() => {
          $approveDiffs(editor);
        });

        // Clear diff styling after approval
        setTimeout(() => updateDiffStyling(), 0);

        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    // Register command to reject all diffs
    const rejectDiffUnregister = editor.registerCommand(
      REJECT_DIFF_COMMAND,
      () => {
        editor.update(() => {
          $rejectDiffs(editor);
        });

        // Clear diff styling after rejection
        setTimeout(() => updateDiffStyling(), 0);

        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    // Clean up command registrations
    return () => {
      removeUpdateListener();
      applyDiffUnregister();
      applyMarkdownReplaceUnregister();
      approveDiffUnregister();
      rejectDiffUnregister();
    };
  }, [editor]);

  return (
    <>
      {isEditable && <DiffToolbar />}
    </>
  );
}

/**
 * Hook to provide diff functionality
 */
export function useDiffCommands() {
  const [editor] = useLexicalComposerContext();

  const applyDiff = useCallback((change: Change) => {
    editor.dispatchCommand(APPLY_DIFF_COMMAND, change);
  }, [editor]);

  const applyMarkdownReplacements = useCallback((replacements: TextReplacement[]) => {
    editor.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
  }, [editor]);

  const approveDiffs = useCallback(() => {
    editor.dispatchCommand(APPROVE_DIFF_COMMAND, undefined);
  }, [editor]);

  const rejectDiffs = useCallback(() => {
    editor.dispatchCommand(REJECT_DIFF_COMMAND, undefined);
  }, [editor]);

  const hasDiffs = useCallback(() => {
    return editor.getEditorState().read(() => {
      return $hasDiffNodes(editor);
    });
  }, [editor]);

  const getCurrentMarkdown = useCallback(() => {
    return editor.getEditorState().read(() => {
      const transformers = getEditorTransformers();
      return $convertToEnhancedMarkdownString(transformers, { shouldPreserveNewLines: true });
    });
  }, [editor]);

  return {
    applyDiff,
    applyMarkdownReplacements,
    approveDiffs,
    hasDiffs,
    rejectDiffs,
    getCurrentMarkdown,
  };
}
