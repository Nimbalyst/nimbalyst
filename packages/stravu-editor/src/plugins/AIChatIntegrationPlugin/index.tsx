/**
 * AI Chat Integration Plugin
 * 
 * This plugin provides a bridge for external AI chat components to apply
 * text replacements to the editor using the DiffPlugin.
 */

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { APPLY_MARKDOWN_REPLACE_COMMAND } from '../DiffPlugin';
import type { TextReplacement } from '../DiffPlugin/core/exports';

// Global event emitter for AI chat integration
interface AIChatEvent {
  type: 'applyReplacements';
  replacements: TextReplacement[];
}

class AIChatIntegrationBridge extends EventTarget {
  private static instance: AIChatIntegrationBridge;

  private constructor() {
    super();
  }

  static getInstance(): AIChatIntegrationBridge {
    if (!AIChatIntegrationBridge.instance) {
      AIChatIntegrationBridge.instance = new AIChatIntegrationBridge();
    }
    return AIChatIntegrationBridge.instance;
  }

  applyReplacements(replacements: TextReplacement[]) {
    this.dispatchEvent(new CustomEvent<AIChatEvent>('aiChatEvent', {
      detail: {
        type: 'applyReplacements',
        replacements
      }
    }));
  }
}

// Export the bridge for external use
export const aiChatBridge = AIChatIntegrationBridge.getInstance();

/**
 * Plugin component that listens for AI chat events and applies them to the editor
 */
export function AIChatIntegrationPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const bridge = AIChatIntegrationBridge.getInstance();

    const handleAIChatEvent = (event: Event) => {
      const customEvent = event as CustomEvent<AIChatEvent>;
      const { type, replacements } = customEvent.detail;

      if (type === 'applyReplacements') {
        console.log('[AIChatIntegrationPlugin] Applying replacements:', replacements);
        editor.dispatchCommand(APPLY_MARKDOWN_REPLACE_COMMAND, replacements);
      }
    };

    bridge.addEventListener('aiChatEvent', handleAIChatEvent);

    return () => {
      bridge.removeEventListener('aiChatEvent', handleAIChatEvent);
    };
  }, [editor]);

  return null;
}