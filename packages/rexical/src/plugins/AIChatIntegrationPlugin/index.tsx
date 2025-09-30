/**
 * AI Chat Integration Plugin
 *
 * This plugin provides a bridge for external AI chat components to:
 * 1. Apply text replacements to the editor using the DiffPlugin
 * 2. Stream markdown content directly into the editor using MarkdownStreamProcessor
 */

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { logger } from '../../utils/logger';
import { $setDiffState } from '../DiffPlugin/core/DiffState';
import { $getSelection, $isRangeSelection, $getRoot, $isElementNode, LexicalNode } from 'lexical';
import { APPLY_MARKDOWN_REPLACE_COMMAND } from '../DiffPlugin';
import type { TextReplacement } from '../DiffPlugin/core/exports';
import { MarkdownStreamProcessor } from '../../markdown/MarkdownStreamProcessor';
import { getEditorTransformers } from '../../markdown';
import { $isHeadingNode } from '@lexical/rich-text';
import { $isListNode } from '@lexical/list';
import { $convertToEnhancedMarkdownString, $convertNodeToEnhancedMarkdownString } from '../../markdown';

// Global event emitter for AI chat integration
interface AIChatEvent {
  type: 'applyReplacements' | 'startStreaming' | 'streamContent' | 'endStreaming';
  replacements?: TextReplacement[];
  streamConfig?: {
    id: string;
    position?: 'cursor' | 'selection' | { line: number; column: number };
    mode?: 'extend' | 'after';
    insertAfter?: string;
    insertAtEnd?: boolean;
  };
  content?: string;
  streamId?: string;
}

class AIChatIntegrationBridge extends EventTarget {
  private static instance: AIChatIntegrationBridge;
  // private activeStreamingSessions: Map<string, MarkdownStreamProcessor> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): AIChatIntegrationBridge {
    if (!AIChatIntegrationBridge.instance) {
      AIChatIntegrationBridge.instance = new AIChatIntegrationBridge();
    }
    return AIChatIntegrationBridge.instance;
  }

  getContent(): string {
    // Dispatch an event to get content
    const event = new CustomEvent('aiChatGetContent');
    let content = '';

    // Create a synchronous handler
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ content: string }>;
      content = customEvent.detail?.content || '';
    };

    // This will be handled synchronously by the plugin
    this.addEventListener('aiChatContentResult', handler, { once: true });
    this.dispatchEvent(event);

    return content;
  }

  applyReplacements(replacements: TextReplacement[]): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // Create a one-time listener for the result
      const resultHandler = (event: Event) => {
        const customEvent = event as CustomEvent<{ success: boolean; error?: string }>;
        resolve(customEvent.detail);
      };

      this.addEventListener('aiChatResult', resultHandler, { once: true });

      // Dispatch the apply event
      this.dispatchEvent(new CustomEvent<AIChatEvent>('aiChatEvent', {
        detail: {
          type: 'applyReplacements',
          replacements
        }
      }));

      // Timeout after 5 seconds
      setTimeout(() => {
        this.removeEventListener('aiChatResult', resultHandler);
        resolve({ success: false, error: 'Timeout waiting for diff application' });
      }, 5000);
    });
  }

  startStreamingEdit(config: { id: string; position?: string; mode?: string; insertAfter?: string; insertAtEnd?: boolean; [key: string]: any }): void {
    this.dispatchEvent(new CustomEvent<AIChatEvent>('aiChatEvent', {
      detail: {
        type: 'startStreaming',
        streamConfig: {
          ...config, // Pass through all properties first
          position: config.position as 'cursor' | 'selection',
          mode: config.mode as 'extend' | 'after'
        }
      }
    }));
  }

  streamContent(streamId: string, content: string): void {
    this.dispatchEvent(new CustomEvent<AIChatEvent>('aiChatEvent', {
      detail: {
        type: 'streamContent',
        streamId,
        content
      }
    }));
  }

  endStreamingEdit(streamId: string): void {
    this.dispatchEvent(new CustomEvent<AIChatEvent>('aiChatEvent', {
      detail: {
        type: 'endStreaming',
        streamId
      }
    }));
  }

  reportResult(success: boolean, error?: string) {
    this.dispatchEvent(new CustomEvent('aiChatResult', {
      detail: { success, error }
    }));
  }
}

// Export the bridge for external use
export const aiChatBridge = AIChatIntegrationBridge.getInstance();

// Also expose it on window for Electron renderer access
if (typeof window !== 'undefined') {
  (window as any).aiChatBridge = aiChatBridge;
}

    /**
 * Find the node key to insert after based on markdown content search
 */
function findInsertionPoint(
  children: LexicalNode[],
  searchMarkdown: string,
  transformers: any[]
): string | undefined {
  // Clean up the search markdown - extract section name if it's multi-line
  const searchLines = searchMarkdown.trim().split('\n');
  let searchTarget = searchLines[0].trim();

  // Remove markdown heading syntax if present
  searchTarget = searchTarget.replace(/^#+\s*/, '').toLowerCase();

  logger.log('streaming', 'Finding insertion point for:', searchTarget);
  logger.log('streaming', 'Total children to search:', children.length);

  // First pass: Find exact heading match
  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if ($isHeadingNode(child)) {
      const headingText = child.getTextContent().toLowerCase().trim();

      if (headingText === searchTarget || headingText.includes(searchTarget)) {
        logger.log('streaming', `Found heading match at index ${i}: "${headingText}"`);

        // Find the end of this section (last non-empty node before next heading or end)
        let sectionEndIndex = i;
        let lastNonEmptyIndex = i;

        for (let j = i + 1; j < children.length; j++) {
          const node = children[j];

          if ($isHeadingNode(node)) {
            // Found next section, stop here
            logger.log('streaming', `Found next section at index ${j}`);
            break;
          }

          // Track the last non-empty node in this section
          const nodeText = node.getTextContent().trim();
          if (nodeText.length > 0) {
            lastNonEmptyIndex = j;
            logger.log('streaming', `Found non-empty node at index ${j}: "${nodeText.substring(0, 30)}"`);
          } else {
            logger.log('streaming', `Skipping empty node at index ${j}`);
          }

          sectionEndIndex = j;
        }

        // Use the last non-empty node if we found one, otherwise use the section end
        const insertIndex = lastNonEmptyIndex > i ? lastNonEmptyIndex : sectionEndIndex;
        const endNode = children[insertIndex];
        const nodeType = endNode.getType();
        logger.log('streaming', `Section ends at index ${insertIndex}, node type: ${nodeType}, inserting after: "${endNode.getTextContent().substring(0, 50)}"`);
        return endNode.getKey();
      }
    }
  }

  // Second pass: Look for the search text within any section's markdown content
  logger.log('streaming', 'No heading match, searching within content...');

  // Convert full document to markdown for searching
  const fullMarkdown = $convertToEnhancedMarkdownString(transformers, { includeFrontmatter: false });
  const searchIndex = fullMarkdown.toLowerCase().indexOf(searchTarget);

  if (searchIndex >= 0) {
    logger.log('streaming', `Found text in markdown at position ${searchIndex}`);

    // Find which node contains this position
    let currentPos = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const nodeMarkdown = $isElementNode(child)
        ? $convertNodeToEnhancedMarkdownString(transformers, child, true)
        : child.getTextContent();
      const nodeLength = nodeMarkdown.length;

      if (currentPos <= searchIndex && searchIndex < currentPos + nodeLength) {
        // Found the node containing our search text
        logger.log('streaming', `Text found in node at index ${i}`);

        // If it's a heading, find end of its section
        if ($isHeadingNode(child)) {
          let sectionEndIndex = i;
          for (let j = i + 1; j < children.length; j++) {
            if ($isHeadingNode(children[j])) {
              break;
            }
            sectionEndIndex = j;
          }
          return children[sectionEndIndex].getKey();
        } else {
          // For non-heading nodes, insert after this node
          return child.getKey();
        }
      }
      currentPos += nodeLength + 1; // +1 for newline between nodes
    }
  }

  logger.log('streaming', 'No matching content found');
  return undefined;
}

/**
 * Plugin component that listens for AI chat events and applies them to the editor
 */
export function AIChatIntegrationPlugin(): null {
  const [editor] = useLexicalComposerContext();
  const streamProcessorsRef = useRef<Map<string, MarkdownStreamProcessor>>(new Map());
  const streamConfigRef = useRef<Map<string, { startingNodeKey?: string; insertAfter?: string; insertAtEnd?: boolean }>>(new Map());

  useEffect(() => {
    const bridge = AIChatIntegrationBridge.getInstance();

    const handleAIChatEvent = async (event: Event) => {
      const customEvent = event as CustomEvent<AIChatEvent>;
      const { type } = customEvent.detail;

      if (type === 'applyReplacements') {
        const { replacements } = customEvent.detail;
        logger.log('bridge', `Applying replacements payload (count: ${Array.isArray(replacements) ? replacements.length : 'none'})`, replacements);
        if (!replacements) {
          logger.log('bridge', '❗ No replacements array provided in applyReplacements event');
          bridge.reportResult(false, 'No replacements provided');
          return;
        }
        try {
          const success = editor.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
          // Report success
          logger.log('bridge', success ? 'Diff command returned success' : 'Diff command returned false');
          bridge.reportResult(success, success ? undefined : 'Failed to apply replacements');
        } catch (error) {
          // Report error
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.log('bridge', 'Error applying replacements:', error);
          bridge.reportResult(false, errorMessage);
        }
      } else if (type === 'startStreaming') {
        const { streamConfig } = customEvent.detail;
        if (!streamConfig) return;

        logger.log('streaming', 'Starting streaming edit:', streamConfig);

        // Get the starting node key based on insertion point
        let startingNodeKey: string | undefined;

        await editor.update(() => {
          const root = $getRoot();
          const children = root.getChildren();
          const transformers = getEditorTransformers();

          if (streamConfig.insertAtEnd) {
            // Insert at the end of the document
            if (children.length > 0) {
              const lastChild = children[children.length - 1];
              startingNodeKey = lastChild.getKey();
              logger.log('streaming', 'Inserting at end, after node:', lastChild.getTextContent().substring(0, 50));
            }
          } else if (streamConfig.insertAfter) {
            // Use our new markdown-aware search function
            startingNodeKey = findInsertionPoint(children, streamConfig.insertAfter, transformers);

            // If not found, default to end of document
            if (!startingNodeKey && children.length > 0) {
              logger.log('streaming', 'Could not find insertion point, defaulting to end');
              const lastChild = children[children.length - 1];
              startingNodeKey = lastChild.getKey();
            }
          } else {
            // Fallback to cursor position
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              const anchorNode = selection.anchor.getNode();
              const topLevelNode = anchorNode.getTopLevelElement();
              if (topLevelNode) {
                startingNodeKey = topLevelNode.getKey();
              }
            }
          }
        });

        // Store the configuration for this stream
        streamConfigRef.current.set(streamConfig.id, {
          startingNodeKey,
          insertAfter: streamConfig.insertAfter,
          insertAtEnd: streamConfig.insertAtEnd
        });

        // Create a stream processor - it handles tables just fine!
        // Use 'extend' mode when inserting at end to append to existing structures (like lists)
        // Use 'after' mode when inserting after specific content
        const mode = streamConfig.insertAtEnd ? 'extend' : (streamConfig.mode || 'after');
        const processor = new MarkdownStreamProcessor(
          editor,
          getEditorTransformers(), // Use dynamic transformers from enabled plugins
          startingNodeKey,
          mode,
          (node) => {
            // Mark the streamed node as 'added' in the diff infrastructure
            $setDiffState(node, 'added');
            logger.log('editor', 'Node created during streaming and marked as added:', node.getKey());
          }
        );

        streamProcessorsRef.current.set(streamConfig.id, processor);
      } else if (type === 'streamContent') {
        const { streamId, content } = customEvent.detail;
        if (!streamId || !content) return;

        logger.log('streaming', 'Stream content received:', { streamId, content: content.substring(0, 100) });

        const processor = streamProcessorsRef.current.get(streamId);

        if (processor) {
          // Just use the markdown stream processor - it handles tables!
          logger.log('streaming', 'Using markdown streaming for content:', content);
          await processor.insertWithUpdate(content);
          logger.log('streaming', 'Content streamed successfully');
        } else {
          logger.log('streaming', 'ERROR: No processor found for stream:', streamId);
        }
      } else if (type === 'endStreaming') {
        const { streamId } = customEvent.detail;
        if (!streamId) return;

        logger.log('streaming', 'Ending streaming edit:', streamId);
        streamProcessorsRef.current.delete(streamId);
        streamConfigRef.current.delete(streamId);
      }
    };

    // Add handler for getting content
    const handleGetContent = () => {
      editor.getEditorState().read(() => {
        const transformers = getEditorTransformers();
        const markdown = $convertToEnhancedMarkdownString(transformers, { includeFrontmatter: true });
        bridge.dispatchEvent(new CustomEvent('aiChatContentResult', {
          detail: { content: markdown }
        }));
      });
    };

    bridge.addEventListener('aiChatEvent', handleAIChatEvent);
    bridge.addEventListener('aiChatGetContent', handleGetContent);

    return () => {
      bridge.removeEventListener('aiChatEvent', handleAIChatEvent);
      bridge.removeEventListener('aiChatGetContent', handleGetContent);
      // Clean up any active stream processors
      streamProcessorsRef.current.clear();
    };
  }, [editor]);

  return null;
}
