/**
 * Plugin to add markdown MIME type to clipboard on copy operations.
 *
 * Registers a high-priority COPY_COMMAND handler that adds markdown
 * alongside the standard text/plain and text/html formats.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, COMMAND_PRIORITY_CRITICAL, COPY_COMMAND } from 'lexical';
import { useEffect } from 'react';
import { $convertSelectionToEnhancedMarkdownString } from '../../markdown/EnhancedMarkdownExport';
import type { Transformer } from '@lexical/markdown';

export interface MarkdownCopyPluginProps {
  transformers: Transformer[];
}

/**
 * Plugin that adds markdown format to clipboard when copying.
 */
export default function MarkdownCopyPlugin({
  transformers,
}: MarkdownCopyPluginProps): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      COPY_COMMAND,
      (event: ClipboardEvent | KeyboardEvent) => {
        // Only handle ClipboardEvent, not KeyboardEvent
        if (event instanceof KeyboardEvent) {
          return false;
        }

        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          return false;
        }

        try {
          let markdown = '';

          // Generate markdown format
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if (!selection) {
              return;
            }

            const nodes = selection.getNodes();
            if (nodes.length === 0) {
              return;
            }

            markdown = $convertSelectionToEnhancedMarkdownString(
              transformers,
              selection,
              true,
            );
          });

          // Only set markdown as text/plain if we generated it successfully
          if (markdown) {
            // Prevent default browser copy behavior
            event.preventDefault();
            // Set our markdown as text/plain
            clipboardData.setData('text/plain', markdown);
            return true; // Stop other Lexical handlers
          }

          // If we didn't generate markdown, let default handler run
          return false;
        } catch (error) {
          console.error('[MarkdownCopy] Error:', error);
          return false;
        }
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, transformers]);

  return null;
}
