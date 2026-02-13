import React, { useState, useMemo } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import { JSONViewer } from './JSONViewer';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import {
  extractStringField,
  extractNumberField,
} from '../utils/fieldExtractors';
import type { Message, ToolCall, ToolResult } from '../../../ai/server/types';
import { extractTextFromCodexEvent } from '../../../ai/server/providers/codex/textExtraction';
import { isCodexSdkEvent } from '../../../ai/server/providers/codex/codexEventParser';

/**
 * Tool item types that can be rendered as tool calls.
 * These represent different categories of tool-like items in Codex SDK events.
 */
const TOOL_ITEM_TYPES = new Set(['mcp_tool_call', 'command_execution', 'file_change']);

interface CodexOutputRendererProps {
  rawEvents: Message[];
  isCollapsed?: boolean;
}

interface ParsedCodexOutput {
  reasoning: string[];
  output: string;
  toolCalls: ToolCall[];
}

function getEventItem(rawEvent: Record<string, unknown>): Record<string, unknown> | null {
  const item = rawEvent.item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }
  return item as Record<string, unknown>;
}

function getItemType(item: Record<string, unknown> | null): string {
  if (!item) return '';
  return extractStringField(item, 'type') ?? '';
}

function isToolItemType(itemType: string): boolean {
  if (!itemType) return false;
  const normalized = itemType.toLowerCase();
  if (TOOL_ITEM_TYPES.has(normalized)) {
    return true;
  }
  return normalized.includes('tool') || normalized.includes('command_execution');
}

function getToolDisplayName(item: Record<string, unknown>, itemType: string): string {
  // MCP tool calls: format as mcp__server__tool or just tool
  if (itemType === 'mcp_tool_call') {
    const server = extractStringField(item, 'server');
    const tool = extractStringField(item, 'tool');
    return (server && tool) ? `mcp__${server}__${tool}` : (tool || 'Unknown Tool');
  }

  // Command execution and file changes: return type name
  if (itemType === 'command_execution' || itemType === 'file_change') {
    return itemType;
  }

  // Fallback: extract from item properties
  const name = extractStringField(item, 'name');
  const tool = extractStringField(item, 'tool');
  const command = extractStringField(item, 'command');
  const fromName = (name && name) || (tool && tool) || (command && command);

  return fromName || 'Unknown Tool';
}

function getToolArguments(item: Record<string, unknown>, itemType: string): Record<string, unknown> | unknown {
  // Command execution: wrap command string
  if (itemType === 'command_execution') {
    return { command: extractStringField(item, 'command') ?? '' };
  }

  // File changes: extract changes property
  if (itemType === 'file_change') {
    return { changes: item.changes };
  }

  // Default: use arguments or args property
  return (item.arguments ?? item.args ?? {}) as Record<string, unknown>;
}

function getToolResult(
  rawEventType: string,
  item: Record<string, unknown>,
  itemType: string
): ToolResult | undefined {
  // Only process completed items
  if (rawEventType !== 'item.completed') {
    return undefined;
  }

  // Command execution: return structured result with exit code and output
  if (itemType === 'command_execution') {
    const exitCode = extractNumberField(item, 'exit_code');
    const errorText = extractStringField(item, 'error');
    const status = extractStringField(item, 'status');
    return {
      success: !errorText && (exitCode === undefined || exitCode === 0),
      command: extractStringField(item, 'command'),
      output: item.aggregated_output ?? item.output,
      exit_code: exitCode,
      status,
      ...(errorText ? { error: errorText } : {}),
    };
  }

  // MCP tool calls: return result and status
  if (itemType === 'mcp_tool_call') {
    const errorText = extractStringField(item, 'error');
    const status = extractStringField(item, 'status');
    const hasError = !!errorText || (item.error !== null && item.error !== undefined);
    return {
      success: !hasError,
      result: item.result,
      status,
      ...(hasError ? { error: errorText || item.error } : {}),
    };
  }

  // File changes: return status and changes
  if (itemType === 'file_change') {
    const status = extractStringField(item, 'status');
    return {
      success: status !== 'failed',
      status,
      changes: item.changes,
    };
  }

  // Fallback: extract any available result
  if (item.result !== undefined || item.output !== undefined || item.aggregated_output !== undefined) {
    return {
      success: true,
      result: item.result ?? item.output ?? item.aggregated_output,
    };
  }

  return undefined;
}

function appendOutputChunk(outputParts: string[], candidateText: string, previousCumulativeText: string): string {
  if (candidateText.startsWith(previousCumulativeText) && previousCumulativeText.length > 0) {
    const delta = candidateText.slice(previousCumulativeText.length);
    if (delta) {
      outputParts.push(delta);
    }
    return candidateText;
  }

  outputParts.push(candidateText);
  return candidateText;
}

/**
 * Parses raw Codex SDK events (stored as JSON strings in message.content) to extract reasoning and output.
 * This is display-time parsing - NO preprocessing before storage.
 *
 * Each message.content contains JSON.stringify(rawEvent) from the Codex SDK.
 * message.metadata.eventType contains the raw event type persisted at write-time.
 *
 * PERFORMANCE NOTE: This function re-parses all events on each call. The component already uses
 * useMemo([rawEvents]) for memoization, which prevents unnecessary re-parsing when the component
 * re-renders but rawEvents haven't changed. If incremental parsing becomes necessary (e.g., for
 * handling very large event streams), consider implementing a cached index tracker in the parent
 * component to only process new events added since the last parse.
 */
export function parseCodexRawEvents(rawEvents: Message[]): ParsedCodexOutput {
  const reasoning: string[] = [];
  const toolCallsMap = new Map<string, ToolCall>();
  const outputParts: string[] = [];
  let lastCumulativeOutput = '';

  for (let index = 0; index < rawEvents.length; index++) {
    const msg = rawEvents[index];
    const eventType = msg.metadata?.eventType;

    if (!msg.content || typeof msg.content !== 'string') {
      console.error('[parseCodexRawEvents] Invalid message content:', msg);
      continue;
    }

    // Type guard for timestamp - ensure it's a valid number
    if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0) {
      console.warn('[parseCodexRawEvents] Message has invalid timestamp:', {
        timestamp: msg.timestamp,
        messageIndex: index,
      });
      // Assign a fallback timestamp to maintain data integrity
      msg.timestamp = Date.now();
    }

    try {
      const rawEvent = JSON.parse(msg.content);

      // Validate the parsed event
      if (!isCodexSdkEvent(rawEvent)) {
        console.error('[parseCodexRawEvents] Invalid Codex event structure:', rawEvent);
        continue;
      }

      const rawEventRecord = rawEvent as Record<string, unknown>;
      const rawEventType = extractStringField(rawEventRecord, 'type') ?? '';
      const item = getEventItem(rawEventRecord);
      const itemType = getItemType(item);
      const shouldTreatAsTool = (item && isToolItemType(itemType)) || eventType === 'tool_call';

      if (shouldTreatAsTool && item) {
        const itemId = extractStringField(item, 'id');
        const toolCallId = (itemId && itemId) || `tool-${msg.timestamp ?? Date.now()}-${index}`;
        const existingToolCall = toolCallsMap.get(toolCallId);
        const toolResult = getToolResult(rawEventType, item, itemType);

        if (existingToolCall) {
          if (existingToolCall.name === 'Unknown Tool') {
            existingToolCall.name = getToolDisplayName(item, itemType);
          }
          if (
            existingToolCall.arguments === undefined ||
            (typeof existingToolCall.arguments === 'object' &&
              existingToolCall.arguments !== null &&
              !Array.isArray(existingToolCall.arguments) &&
              Object.keys(existingToolCall.arguments as Record<string, unknown>).length === 0)
          ) {
            existingToolCall.arguments = getToolArguments(item, itemType);
          }
          if (toolResult !== undefined) {
            existingToolCall.result = toolResult;
          }
        } else {
          const newToolCall: ToolCall = {
            id: toolCallId,
            name: getToolDisplayName(item, itemType),
            arguments: getToolArguments(item, itemType),
          };
          if (toolResult !== undefined) {
            newToolCall.result = toolResult;
          }
          toolCallsMap.set(toolCallId, newToolCall);
        }

        continue;
      }

      // Extract text content using shared utility
      const text = extractTextFromCodexEvent(rawEvent);

      if (!text) continue;

      // Categorize based on raw event shape (with metadata fallback for older rows)
      const isReasoningEvent =
        itemType === 'reasoning' || eventType === 'reasoning' || rawEventType === 'reasoning';
      const isOutputEvent =
        !isReasoningEvent &&
        (itemType === 'agent_message' ||
          itemType === 'message' ||
          eventType === 'text' ||
          rawEventType === 'task_complete' ||
          rawEventType === 'error');

      if (isReasoningEvent) {
        reasoning.push(text);
      } else if (isOutputEvent) {
        lastCumulativeOutput = appendOutputChunk(outputParts, text, lastCumulativeOutput);
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
 * - Reasoning blocks: Thinking content (from raw `item.type='reasoning'`)
 * - Final answer: Agent message content (from raw `item.type='agent_message'`)
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
    const resultDetails = typeof toolResult === 'object' && toolResult !== null && typeof toolResult !== 'string' ? (toolResult as unknown as Record<string, unknown>) : null;
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
