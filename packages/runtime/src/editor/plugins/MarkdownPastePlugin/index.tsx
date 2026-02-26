/**
 * Plugin to automatically detect and transform markdown content on paste.
 *
 * When users paste plain text that appears to be markdown, this plugin
 * will automatically transform it into rich content using the markdown
 * transformer system.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { COMMAND_PRIORITY_HIGH, PASTE_COMMAND, $insertNodes, $parseSerializedNode } from 'lexical';
import { useEffect } from 'react';
import { markdownToJSONSync } from '../../markdown';
import { isLikelyMarkdown } from '../../utils/markdownDetection';
import type { Transformer } from '@lexical/markdown';

export interface MarkdownPastePluginProps {
  transformers: Transformer[];
  minConfidenceScore?: number;
}

/**
 * Plugin that detects markdown in pasted content and transforms it.
 *
 * This plugin:
 * - Intercepts PASTE_COMMAND before the default handler
 * - Analyzes plain text content for markdown patterns
 * - Transforms detected markdown using the editor's transformers
 * - Falls back to default paste behavior for non-markdown content
 */
export default function MarkdownPastePlugin({
  transformers,
  minConfidenceScore = 15,
}: MarkdownPastePluginProps): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          console.log('[MarkdownPaste] No clipboard data');
          return false;
        }

        // Check if HTML is available - if so, let the default handler use it
        const htmlData = clipboardData.getData('text/html');
        if (htmlData && htmlData.trim().length > 0) {
          console.log('[MarkdownPaste] HTML data found, skipping markdown detection');
          return false;
        }

        // Get plain text content
        const plainText = clipboardData.getData('text/plain');
        if (!plainText || plainText.trim().length === 0) {
          console.log('[MarkdownPaste] No plain text data');
          return false;
        }

        console.log('[MarkdownPaste] Plain text length:', plainText.length);
        console.log('[MarkdownPaste] Preview:', plainText.substring(0, 100));

        // Check if this is a "paste as plain text" operation (Cmd+Shift+V)
        // Most browsers don't provide a reliable way to detect this, but we can
        // check for the shiftKey modifier on the paste event
        if (event instanceof ClipboardEvent && (event as any).shiftKey) {
          console.log('[MarkdownPaste] Shift key detected, skipping transformation');
          return false;
        }

        // Detect if content is markdown
        const isMarkdown = isLikelyMarkdown(plainText, {
          minConfidenceScore,
        });

        console.log('[MarkdownPaste] Markdown detected:', isMarkdown, 'threshold:', minConfidenceScore);

        if (!isMarkdown) {
          console.log('[MarkdownPaste] Not markdown, using default paste handler');
          return false;
        }

        console.log('[MarkdownPaste] Transforming markdown to rich content');
        event.preventDefault();

        try {
          editor.update(() => {
            // Convert markdown to JSON representation
            const importedEditorStateJSON = markdownToJSONSync(
              editor,
              transformers,
              plainText
            );

            // Parse nodes from JSON
            const nodes = importedEditorStateJSON.root.children.map($parseSerializedNode);

            // Insert nodes at current selection
            $insertNodes(nodes);
          });

          console.log('[MarkdownPaste] Transformation successful');
          return true;
        } catch (error) {
          console.error('[MarkdownPaste] Failed to transform markdown:', error);
          return false;
        }
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, transformers, minConfidenceScore]);

  return null;
}
