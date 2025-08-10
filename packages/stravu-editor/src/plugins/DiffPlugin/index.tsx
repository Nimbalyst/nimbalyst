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
import { $convertToMarkdownString } from '@lexical/markdown';
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
import { MARKDOWN_TRANSFORMERS } from '../../markdown';
import { DiffToolbar } from './DiffToolbar';

import { createCommand } from 'lexical';

/**
 * Custom command for applying markdown replacements
 */
export const APPLY_MARKDOWN_REPLACE_COMMAND = createCommand<TextReplacement[]>('APPLY_MARKDOWN_REPLACE_COMMAND');

/**
 * React plugin component that sets up commands for diff functionality.
 * This plugin automatically applies CSS classes to nodes based on their diff state.
 */
export function DiffPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

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
          // Skip table internal nodes as they don't have direct DOM elements
          // Only process table cells which do have DOM elements
          const isTableInternalNode = $isTableNode(node) || $isTableRowNode(node);
          
          if (!isTableInternalNode) {
            const diffState = $getDiffState(node);
            const element = editor.getElementByKey(node.getKey());
            
            if (element) {
              // Clear existing diff classes
              if (diffAddClass) {
                element.classList.remove(diffAddClass);
              }
              if (diffRemoveClass) {
                element.classList.remove(diffRemoveClass);
              }
              if (diffModifyClass) {
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
    const applyMarkdownReplaceUnregister = editor.registerCommand<TextReplacement[]>(
      APPLY_MARKDOWN_REPLACE_COMMAND,
      (replacements) => {
        if (!replacements || replacements.length === 0) {
          console.log('No replacements to apply');
          return false;
        }

        try {
          // Get current markdown content
          const currentMarkdown = editor.getEditorState().read(() => {
            return $convertToMarkdownString(MARKDOWN_TRANSFORMERS, undefined, true);
          });

          console.log('Applying diff with replacements:', replacements);

          // Apply the replacements - this will create diff state nodes
          editor.update(() => {
            applyMarkdownReplace(
              editor,
              currentMarkdown,
              replacements,
              MARKDOWN_TRANSFORMERS
            );
          }, { discrete: true });

          console.log('Diff applied successfully');
          return true;
        } catch (error: any) {
          console.error('Failed to apply diff:', error);
          
          // Extract meaningful error message
          let errorMessage = 'Failed to apply changes';
          
          if (error?.context?.errorType === 'TEXT_REPLACEMENT_ERROR') {
            // Whitespace or text mismatch error
            const replacement = error.context?.additionalInfo?.replacement;
            if (replacement) {
              errorMessage = `Could not find matching text in the document. The text may have been modified or contains different whitespace/formatting.`;
            }
          } else if (error?.message) {
            errorMessage = error.message;
          }
          
          // Re-throw with a more user-friendly error
          throw new Error(errorMessage);
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
      <DiffToolbar />
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
      return $convertToMarkdownString(MARKDOWN_TRANSFORMERS, undefined, true);
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