import React, { useState, useMemo } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import { JSONViewer } from './JSONViewer';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import type { Message, ToolCall } from '../../../ai/server/types';
import { extractTextFromCodexEvent } from '../../../ai/server/providers/codex/textExtraction';
import { isCodexSdkEvent } from '../../../ai/server/providers/codex/codexEventParser';

interface CodexOutputRendererProps {
  rawEvents: Message[];
  isCollapsed?: boolean;
}

interface ParsedCodexOutput {
  reasoning: string[];
  output: string;
  toolCalls: ToolCall[];
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
  const toolCallsMap = new Map<string, ToolCall>();
  const outputParts: string[] = [];

  for (const msg of rawEvents) {
    const eventType = msg.metadata?.eventType;

    if (!msg.content || typeof msg.content !== 'string') {
      console.error('[parseCodexRawEvents] Invalid message content:', msg);
      continue;
    }

    try {
      const rawEvent = JSON.parse(msg.content);

      // Validate the parsed event
      if (!isCodexSdkEvent(rawEvent)) {
        console.error('[parseCodexRawEvents] Invalid Codex event structure:', rawEvent);
        continue;
      }

      // Handle tool_call events
      if (eventType === 'tool_call' && 'item' in rawEvent && typeof rawEvent.item === 'object' && rawEvent.item !== null) {
        const item = rawEvent.item as Record<string, unknown>;
        const toolCallId = (typeof item.id === 'string' ? item.id : undefined) || `tool-${Date.now()}`;
        const toolCall: ToolCall = {
          id: toolCallId,
          name: (typeof item.command === 'string' ? item.command :
                 typeof item.name === 'string' ? item.name :
                 typeof item.tool === 'string' ? item.tool : 'Unknown Tool'),
          arguments: item.arguments || item.args || {},
        };

        // Check if we already have a tool call with this ID (for started/completed pairs)
        const existingToolCall = toolCallsMap.get(toolCallId);

        if (existingToolCall) {
          // Update existing tool call with result if this is a completed event
          if (rawEvent.type === 'item.completed' && (item.aggregated_output || item.output || item.result)) {
            existingToolCall.result = item.aggregated_output || item.output || item.result;
          }
        } else {
          // Add new tool call
          if (rawEvent.type === 'item.completed' && (item.aggregated_output || item.output || item.result)) {
            toolCall.result = item.aggregated_output || item.output || item.result;
          }
          toolCallsMap.set(toolCallId, toolCall);
        }

        continue;
      }

      // Extract text content using shared utility
      const text = extractTextFromCodexEvent(rawEvent);

      if (!text) continue;

      // Categorize based on eventType metadata
      if (eventType === 'reasoning') {
        reasoning.push(text);
      } else if (eventType === 'text') {
        outputParts.push(text);
      }
    } catch (error) {
      // If parsing fails, log but don't crash the UI
      console.error('[CodexOutputRenderer] Failed to parse raw event:', error, msg.content);
    }
  }

  // Convert Map to array
  const toolCalls = Array.from(toolCallsMap.values());

  // Join output parts for efficient string concatenation
  const output = outputParts.join('');

  return { reasoning, output, toolCalls };
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
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // Parse raw events at display time
  const { reasoning, output, toolCalls } = useMemo(() => parseCodexRawEvents(rawEvents), [rawEvents]);

  const handleToggleToolExpand = (toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  // Render tool call widget (same style as Claude Code)
  const renderToolCall = (tool: ToolCall) => {
    const isExpanded = expandedTools.has(tool.id || tool.name);
    const toolResult = tool.result;
    const resultDetails = typeof toolResult === 'object' && toolResult !== null ? (toolResult as Record<string, unknown>) : null;
    const explicitSuccess = resultDetails && 'success' in resultDetails ? resultDetails.success !== false : undefined;
    const derivedErrorMessage = resultDetails && typeof resultDetails.error === 'string' ? (resultDetails.error as string) : undefined;
    const didFail = explicitSuccess === false || !!derivedErrorMessage;
    const statusLabel = didFail ? 'Failed' : 'Succeeded';
    const statusColor = didFail ? 'var(--nim-error)' : 'var(--nim-success)';
    const statusBackground = didFail ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
    const hasResult = toolResult !== undefined && toolResult !== null && (typeof toolResult !== 'string' || toolResult.trim().length > 0);
    const toolDisplayName = formatToolDisplayName(tool.name || '') || tool.name || 'Tool Call';

    return (
      <div key={tool.id || tool.name} className="rounded-md bg-nim-tertiary overflow-hidden border border-nim my-2">
        <button
          onClick={() => handleToggleToolExpand(tool.id || tool.name)}
          className="w-full py-2 px-3 bg-nim-secondary flex items-center gap-2 transition-colors text-left border-none cursor-pointer hover:bg-nim-hover"
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${toolDisplayName} tool call details`}
        >
          <MaterialSymbol icon="build" size={14} className="tool-icon" />
          <span
            className="font-mono text-xs text-nim flex-1"
            title={tool.name}
          >
            {toolDisplayName}
          </span>
          <span
            className="text-[0.7rem] font-semibold py-0.5 px-2 rounded-full uppercase tracking-tight pointer-events-none"
            style={{
              color: statusColor,
              backgroundColor: statusBackground
            }}
          >
            {statusLabel}
          </span>
          <MaterialSymbol
            icon={isExpanded ? "expand_more" : "chevron_right"}
            size={12}
            className="chevron-icon"
          />
        </button>

        {isExpanded && (
          <div className="py-2 px-3 text-xs">
            {typeof tool.arguments === 'object' && tool.arguments !== null && Object.keys(tool.arguments).length > 0 && (
              <div className="mb-2">
                <div className="text-nim-faint mb-1">Parameters:</div>
                <JSONViewer data={tool.arguments} maxHeight="16rem" />
              </div>
            )}

            {typeof tool.arguments === 'string' && tool.arguments.trim().length > 0 && (
              <div className="mb-2">
                <div className="text-nim-faint mb-1">Parameters (raw):</div>
                <pre className="text-xs text-nim-muted font-mono overflow-x-auto bg-nim-secondary p-2 rounded">
                  {tool.arguments}
                </pre>
              </div>
            )}

            <div className="mt-2">
              <div className="text-nim-faint mb-1">Result:</div>
              {hasResult ? (
                typeof toolResult === 'string' ? (
                  <pre className="text-xs text-nim font-mono overflow-x-auto bg-nim-secondary p-2 rounded max-h-64 overflow-y-auto">
                    {toolResult}
                  </pre>
                ) : (
                  <JSONViewer data={toolResult} maxHeight="16rem" />
                )
              ) : (
                <div className="text-xs text-nim-faint italic">
                  Tool did not return a result.
                </div>
              )}
              {derivedErrorMessage && (
                <div className="mt-2 text-xs text-nim-error">
                  {derivedErrorMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // If no reasoning blocks and no tool calls, render as plain markdown
  if (reasoning.length === 0 && toolCalls.length === 0) {
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
            aria-expanded={isThinkingExpanded}
            aria-label={`${isThinkingExpanded ? 'Collapse' : 'Expand'} reasoning blocks`}
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

      {/* Tool calls - rendered with same widget as Claude Code */}
      {toolCalls.map(renderToolCall)}

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
