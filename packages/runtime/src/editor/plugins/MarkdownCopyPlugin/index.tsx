/**
 * Plugin to copy content as markdown.
 *
 * Registers Cmd+Shift+C (Ctrl+Shift+C on Windows) to copy selection as markdown
 * in text/plain format. Regular Cmd+C still uses Lexical's default HTML copy.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $getRoot,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  LexicalCommand,
  LexicalNode,
  KEY_MODIFIER_COMMAND,
} from 'lexical';
import { useEffect } from 'react';
import { copyToClipboard } from '../../../utils/clipboard';
import { mergeRegister } from '@lexical/utils';
import { $convertSelectionToEnhancedMarkdownString } from '../../markdown/EnhancedMarkdownExport';
import { $getFrontmatter, serializeWithFrontmatter } from '../../markdown/FrontmatterUtils';
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

              // Convert selection to markdown
              markdown = $convertSelectionToEnhancedMarkdownString(
                transformers,
                selection,
                true,
              );

              // Check if everything is selected (select all was used)
              // If so, include frontmatter in the copied markdown
              if ($isRangeSelection(selection)) {
                const root = $getRoot();

                // Get all root-level nodes that are in the selection
                const selectedRootNodes = new Set();
                nodes.forEach(node => {
                  // Find the top-level parent (direct child of root)
                  let topNode: LexicalNode = node;
                  while (topNode.getParent() !== null && topNode.getParent() !== root) {
                    topNode = topNode.getParent()!;
                  }
                  if (topNode.getParent() === root) {
                    selectedRootNodes.add(topNode.getKey());
                  }
                });

                // Check if all root children are selected
                const rootChildren = root.getChildren();
                const allRootChildrenSelected = rootChildren.length > 0 &&
                  rootChildren.every(child => selectedRootNodes.has(child.getKey()));

                // If everything is selected, include frontmatter
                if (allRootChildrenSelected) {
                  const frontmatter = $getFrontmatter();
                  if (frontmatter) {
                    markdown = serializeWithFrontmatter(markdown, frontmatter);
                  }
                }
              }
            });

            // Copy markdown to clipboard
            if (markdown) {
              copyToClipboard(markdown).catch((error) => {
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
