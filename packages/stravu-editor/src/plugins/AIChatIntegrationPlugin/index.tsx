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
import { $getSelection, $isRangeSelection, $getRoot } from 'lexical';
import { APPLY_MARKDOWN_REPLACE_COMMAND } from '../DiffPlugin';
import type { TextReplacement } from '../DiffPlugin/core/exports';
import { MarkdownStreamProcessor } from '../../markdown/MarkdownStreamProcessor';

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
  private activeStreamingSessions: Map<string, MarkdownStreamProcessor> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): AIChatIntegrationBridge {
    if (!AIChatIntegrationBridge.instance) {
      AIChatIntegrationBridge.instance = new AIChatIntegrationBridge();
    }
    return AIChatIntegrationBridge.instance;
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
          id: config.id,
          position: config.position as 'cursor' | 'selection',
          mode: config.mode as 'extend' | 'after',
          insertAfter: config.insertAfter,
          insertAtEnd: config.insertAtEnd,
          ...config // Pass through any other properties
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
 * Plugin component that listens for AI chat events and applies them to the editor
 */
export function AIChatIntegrationPlugin(): null {
  const [editor] = useLexicalComposerContext();
  const streamProcessorsRef = useRef<Map<string, MarkdownStreamProcessor>>(new Map());

  useEffect(() => {
    const bridge = AIChatIntegrationBridge.getInstance();

    const handleAIChatEvent = async (event: Event) => {
      const customEvent = event as CustomEvent<AIChatEvent>;
      const { type } = customEvent.detail;

      if (type === 'applyReplacements') {
        const { replacements } = customEvent.detail;
        logger.log('bridge', 'Applying replacements:', replacements);
        try {
          const success = editor.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
          // Report success
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
          
          if (streamConfig.insertAtEnd) {
            // Insert at the end of the document
            if (children.length > 0) {
              const lastChild = children[children.length - 1];
              startingNodeKey = lastChild.getKey();
              logger.log('streaming', 'Inserting at end, after node:', lastChild.getTextContent().substring(0, 50));
            }
          } else if (streamConfig.insertAfter) {
            // Find the node containing the specified text
            const searchText = streamConfig.insertAfter.toLowerCase();
            
            for (const child of children) {
              const nodeText = child.getTextContent().toLowerCase();
              // Check if this node ends with or contains the search text
              if (nodeText.includes(searchText)) {
                startingNodeKey = child.getKey();
                logger.log('streaming', 'Found insertion point after:', child.getTextContent().substring(0, 50));
                break;
              }
            }
            
            // If not found, default to end of document
            if (!startingNodeKey && children.length > 0) {
              logger.log('streaming', 'Could not find text:', streamConfig.insertAfter, 'Defaulting to end');
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
        
        // Create a new stream processor with the correct starting point
        const processor = new MarkdownStreamProcessor(
          editor,
          undefined, // Use default transformers
          startingNodeKey,
          streamConfig.mode || 'after',
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
        
        const processor = streamProcessorsRef.current.get(streamId);
        if (processor) {
          await processor.insertWithUpdate(content);
        }
      } else if (type === 'endStreaming') {
        const { streamId } = customEvent.detail;
        if (!streamId) return;
        
        logger.log('streaming', 'Ending streaming edit:', streamId);
        streamProcessorsRef.current.delete(streamId);
      }
    };

    bridge.addEventListener('aiChatEvent', handleAIChatEvent);

    return () => {
      bridge.removeEventListener('aiChatEvent', handleAIChatEvent);
      // Clean up any active stream processors
      streamProcessorsRef.current.clear();
    };
  }, [editor]);

  return null;
}