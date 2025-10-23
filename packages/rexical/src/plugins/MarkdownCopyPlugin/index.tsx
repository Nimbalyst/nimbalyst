/**
 * Plugin to copy content as markdown.
 *
 * Registers Cmd+Shift+C (Ctrl+Shift+C on Windows) to copy selection as markdown
 * in text/plain format. Regular Cmd+C still uses Lexical's default HTML copy.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  LexicalCommand,
  KEY_MODIFIER_COMMAND,
} from 'lexical';
import { useEffect } from 'react';
import { mergeRegister } from '@lexical/utils';
import { $convertSelectionToEnhancedMarkdownString } from '../../markdown/EnhancedMarkdownExport';
import type { Transformer } from '@lexical/markdown';

export interface MarkdownCopyPluginProps {
  transformers: Transformer[];
}

export const COPY_AS_MARKDOWN_COMMAND: LexicalCommand<KeyboardEvent> = createCommand(
  'COPY_AS_MARKDOWN_COMMAND'
);

/**
 * Plugin that copies selection as markdown via Cmd+Shift+C.
 */
export default function MarkdownCopyPlugin({
  transformers,
}: MarkdownCopyPluginProps): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeRegister(
      // Register keyboard shortcut: Cmd+Shift+C (Mac) or Ctrl+Shift+C (Windows/Linux)
      editor.registerCommand(
        KEY_MODIFIER_COMMAND,
        (event: KeyboardEvent) => {
          const { code, ctrlKey, metaKey, shiftKey } = event;

          // Check for Cmd+Shift+C (Mac) or Ctrl+Shift+C (Windows/Linux)
          if (code === 'KeyC' && shiftKey && (metaKey || ctrlKey)) {
            event.preventDefault();
            editor.dispatchCommand(COPY_AS_MARKDOWN_COMMAND, event);
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_EDITOR,
      ),

      // Handle the markdown copy command
      editor.registerCommand(
        COPY_AS_MARKDOWN_COMMAND,
        (event: KeyboardEvent) => {
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

            // Copy markdown to clipboard
            if (markdown && navigator.clipboard) {
              navigator.clipboard.writeText(markdown).catch((error) => {
                console.error('[MarkdownCopy] Failed to write to clipboard:', error);
              });
              return true;
            }

            return false;
          } catch (error) {
            console.error('[MarkdownCopy] Error:', error);
            return false;
          }
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor, transformers]);

  return null;
}
