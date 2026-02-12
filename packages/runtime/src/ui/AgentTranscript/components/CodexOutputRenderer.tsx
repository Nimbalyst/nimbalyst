import React, { useState, useMemo } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import type { Message } from '../../../ai/server/types';

interface CodexOutputRendererProps {
  rawEvents: Message[];
  isCollapsed?: boolean;
}

interface ParsedCodexOutput {
  reasoning: string[];
  output: string;
}

/**
 * Parses raw Codex SDK events (stored as JSON strings in message.content) to extract reasoning and output.
 * This is display-time parsing - NO preprocessing before storage.
 *
 * Each message.content contains JSON.stringify(rawEvent) from the Codex SDK.
 * message.metadata.eventType indicates 'reasoning' or 'text' etc.
 */
function parseCodexRawEvents(rawEvents: Message[]): ParsedCodexOutput {
  const reasoning: string[] = [];
  let output = '';

  for (const msg of rawEvents) {
    const eventType = msg.metadata?.eventType;

    try {
      const rawEvent = JSON.parse(msg.content);

      // Extract text content from various Codex SDK event structures
      const getText = (event: any): string | null => {
        // Handle item.completed/updated with text in item field
        if (event.item?.content) {
          for (const part of event.item.content) {
            if (part.type === 'text' && part.text) {
              return part.text;
            }
          }
        }
        // Handle delta updates with delta.content
        if (event.delta?.content) {
          for (const part of event.delta.content) {
            if (part.type === 'text' && part.text) {
              return part.text;
            }
          }
        }
        return null;
      };

      const text = getText(rawEvent);
      if (!text) continue;

      // Categorize based on eventType metadata
      if (eventType === 'reasoning') {
        reasoning.push(text);
      } else if (eventType === 'text') {
        output += text;
      }
    } catch (error) {
      // If parsing fails, log but don't crash the UI
      console.error('[CodexOutputRenderer] Failed to parse raw event:', error, msg.content);
    }
  }

  return { reasoning, output };
}

/**
 * Renders Codex (OpenAI GPT-5) output from an array of raw event messages.
 * Each message contains a single Codex SDK event as JSON in the content field.
 *
 * Parses at display time to extract:
 * - Reasoning blocks: Thinking content (eventType='reasoning')
 * - Final answer: Message content (eventType='text')
 *
 * Tool calls are handled separately by the parent component (same as Claude Code).
 *
 * See docs/CODEX_RAW_STORAGE.md for storage architecture.
 */
export const CodexOutputRenderer: React.FC<CodexOutputRendererProps> = ({
  rawEvents,
  isCollapsed = false,
}) => {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  // Parse raw events at display time
  const { reasoning, output } = useMemo(() => parseCodexRawEvents(rawEvents), [rawEvents]);

  // If no reasoning blocks, render as plain markdown
  if (reasoning.length === 0) {
    return (
      <div className={isCollapsed ? 'max-h-20 overflow-hidden relative' : ''}>
        <MarkdownRenderer content={output} isUser={false} />
        {isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--nim-bg)] to-transparent pointer-events-none" />
        )}
      </div>
    );
  }

  return (
    <div className="codex-output flex flex-col gap-2">
      {/* Reasoning blocks - collapsible */}
      {reasoning.length > 0 && (
        <div className="codex-thinking border border-[var(--nim-border)] rounded-md overflow-hidden bg-[var(--nim-bg-secondary)]">
          <button
            onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
            className="w-full py-2 px-3 flex items-center gap-2 text-left border-none cursor-pointer bg-transparent transition-colors hover:bg-[var(--nim-bg-hover)]"
          >
            <MaterialSymbol
              icon={isThinkingExpanded ? 'expand_more' : 'chevron_right'}
              size={16}
              className="text-[var(--nim-text-faint)]"
            />
            <MaterialSymbol
              icon="psychology"
              size={16}
              className="text-[var(--nim-primary)]"
            />
            <span className="text-sm font-medium text-[var(--nim-text)]">
              Reasoning
            </span>
            <span className="text-xs text-[var(--nim-text-faint)] ml-auto">
              {reasoning.length} {reasoning.length === 1 ? 'block' : 'blocks'}
            </span>
          </button>

          {isThinkingExpanded && (
            <div className="border-t border-[var(--nim-border)] p-3 space-y-3 max-h-96 overflow-y-auto">
              {reasoning.map((block, index) => (
                <div key={index} className="codex-thinking-block text-sm text-[var(--nim-text-muted)] leading-relaxed">
                  <MarkdownRenderer content={block} isUser={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Final answer - main content */}
      <div className={`codex-answer ${isCollapsed ? 'max-h-20 overflow-hidden relative' : ''}`}>
        <MarkdownRenderer content={output} isUser={false} />
        {isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--nim-bg)] to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  );
};
