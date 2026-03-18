import React, { useState, useMemo } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { OpenAIAuthWidget } from './OpenAIAuthWidget';
import { MaterialSymbol } from '../../icons/MaterialSymbol';
import { JSONViewer } from './JSONViewer';
import { formatToolDisplayName } from '../utils/toolNameFormatter';
import { getCustomToolWidget, type ToolCallDiffResult } from './CustomToolWidgets';
import { ToolCallChanges } from './ToolCallChanges';
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
const TOOL_ITEM_TYPES = new Set(['mcp_tool_call', 'command_execution', 'file_change', 'web_search']);

interface CodexOutputRendererProps {
  rawEvents: Message[];
  isCollapsed?: boolean;
  sessionId: string;
  workspacePath?: string;
  /** Optional: Open local file paths in the editor */
  onOpenFile?: (filePath: string) => void;
  readFile?: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  /** Optional: Fetch file diffs caused by a specific tool call */
  getToolCallDiffs?: (
    toolCallItemId: string,
    toolCallTimestamp?: number
  ) => Promise<ToolCallDiffResult[] | null>;
}

/**
 * A section of Codex output, preserving the temporal order of events.
 * Consecutive events of the same type are merged into a single section.
 */
export type CodexSection =
  | { type: 'reasoning'; blocks: string[] }
  | { type: 'output'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall; timestamp: number }
  | { type: 'todo_list'; items: Array<{ text: string; completed: boolean }> }
  | { type: 'openai_auth_error' };

interface ParsedCodexOutput {
  /** Ordered sections preserving the temporal sequence of reasoning, tool calls, and output. */
  sections: CodexSection[];
}

function buildCodexToolLookupId(rawItemId: string, timestamp: number, index: number): string {
  return `nimtc|${encodeURIComponent(rawItemId)}|${timestamp}|${index}`;
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

/**
 * Check if text content indicates an OpenAI authentication error (401 from api.openai.com).
 * Matches the same patterns as MessageSegment.isOpenAIAuthError.
 */
function isOpenAIAuthError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('api.openai.com') &&
    (lower.includes('401 unauthorized') || (lower.includes('401') && lower.includes('authentication')))
  );
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

  // Command execution, file changes, and web search: return type name
  if (itemType === 'command_execution' || itemType === 'file_change' || itemType === 'web_search') {
    return itemType;
  }

  // Fallback: extract from item properties
  const name = extractStringField(item, 'name');
  const tool = extractStringField(item, 'tool');
  const command = extractStringField(item, 'command');
  const fromName = (name && name) || (tool && tool) || (command && command);

  return fromName || 'Unknown Tool';
}

function getToolArguments(item: Record<string, unknown>, itemType: string): Record<string, unknown> | undefined {
  // Command execution: wrap command string
  if (itemType === 'command_execution') {
    return { command: extractStringField(item, 'command') ?? '' };
  }

  // File changes: extract changes property
  if (itemType === 'file_change') {
    return { changes: item.changes };
  }

  if (itemType === 'web_search') {
    return {
      query: extractStringField(item, 'query') ?? '',
      ...(item.action !== undefined ? { action: item.action } : {}),
    };
  }

  // Default: use arguments or args property
  return (item.arguments ?? item.args ?? {}) as Record<string, any>;
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

  if (itemType === 'web_search') {
    return {
      success: true,
      query: extractStringField(item, 'query') ?? '',
      ...(item.action !== undefined ? { action: item.action } : {}),
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
 * Parses raw Codex SDK events (stored as JSON strings in message.content) into ordered sections.
 * This is display-time parsing - NO preprocessing before storage.
 *
 * Each message.content contains JSON.stringify(rawEvent) from the Codex SDK.
 * message.metadata.eventType contains the raw event type persisted at write-time.
 *
 * Sections preserve the temporal order of events. Consecutive events of the same type
 * are merged into a single section (e.g., multiple reasoning events become one reasoning
 * section with multiple blocks).
 *
 * PERFORMANCE NOTE: This function re-parses all events on each call. The component already uses
 * useMemo([rawEvents]) for memoization, which prevents unnecessary re-parsing when the component
 * re-renders but rawEvents haven't changed.
 */
export function parseCodexRawEvents(rawEvents: Message[]): ParsedCodexOutput {
  const sections: CodexSection[] = [];

  // Track only active tool calls by raw Codex item ID.
  // Codex can reuse item IDs across turns, so completed calls must be removed.
  const activeToolCallsByItemId = new Map<string, ToolCall>();

  // Track cumulative output state for dedup across the entire parse
  let lastCumulativeOutput = '';
  // Track output parts for the current output section
  let currentOutputParts: string[] | null = null;

  function lastSection(): CodexSection | undefined {
    return sections[sections.length - 1];
  }

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

      // Handle todo_list items - render as a checklist section
      if (item && itemType === 'todo_list') {
        currentOutputParts = null;
        const todoItems = item.items;
        if (Array.isArray(todoItems)) {
          const parsed = todoItems
            .filter((t): t is Record<string, unknown> => t != null && typeof t === 'object')
            .map(t => ({
              text: typeof t.text === 'string' ? t.text : String(t.text ?? ''),
              completed: !!t.completed,
            }));
          // Always replace with the latest snapshot (item.updated / item.completed supersede item.started)
          const last = lastSection();
          if (last && last.type === 'todo_list') {
            last.items = parsed;
          } else {
            sections.push({ type: 'todo_list', items: parsed });
          }
        }
        continue;
      }

      if (shouldTreatAsTool && item) {
        // Reset output tracking when switching away from output
        currentOutputParts = null;

        const itemId = extractStringField(item, 'id');
        const existingToolCall = itemId ? activeToolCallsByItemId.get(itemId) : undefined;
        const toolResult = getToolResult(rawEventType, item, itemType);
        const isCompleted = rawEventType === 'item.completed';

        if (existingToolCall) {
          // Merge update/completion into the active tool call instance.
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

          if (itemId) {
            if (isCompleted) {
              activeToolCallsByItemId.delete(itemId);
            } else {
              activeToolCallsByItemId.set(itemId, existingToolCall);
            }
          }
        } else {
          // New tool call - create a new section
          const toolCallId = itemId
            ? buildCodexToolLookupId(itemId, msg.timestamp, index)
            : `tool-${msg.timestamp}-${index}`;
          const newToolCall: ToolCall = {
            id: toolCallId,
            name: getToolDisplayName(item, itemType),
            arguments: getToolArguments(item, itemType),
          };
          if (toolResult !== undefined) {
            newToolCall.result = toolResult;
          }
          sections.push({ type: 'tool_call', toolCall: newToolCall, timestamp: msg.timestamp });

          if (itemId && !isCompleted) {
            activeToolCallsByItemId.set(itemId, newToolCall);
          }
        }

        continue;
      }

      // Extract text content using shared utility
      const text = extractTextFromCodexEvent(rawEvent);

      if (!text) continue;

      // Check for OpenAI auth errors - show setup widget instead of plain text.
      // Deduplicate consecutive auth errors (e.g. "Reconnecting... 1/5" through "5/5").
      if (rawEventType === 'error' && isOpenAIAuthError(text)) {
        currentOutputParts = null;
        const last = lastSection();
        if (!last || last.type !== 'openai_auth_error') {
          sections.push({ type: 'openai_auth_error' });
        }
        continue;
      }

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
        // Reset output tracking when switching away from output
        currentOutputParts = null;

        const last = lastSection();
        if (last && last.type === 'reasoning') {
          // Merge into the current reasoning section
          last.blocks.push(text);
        } else {
          // Start a new reasoning section
          sections.push({ type: 'reasoning', blocks: [text] });
        }
      } else if (isOutputEvent) {
        const last = lastSection();
        if (last && last.type === 'output' && currentOutputParts !== null) {
          // Continue accumulating into the current output section
          lastCumulativeOutput = appendOutputChunk(currentOutputParts, text, lastCumulativeOutput);
          last.content = currentOutputParts.join('');
        } else {
          // Start a new output section
          currentOutputParts = [];
          lastCumulativeOutput = appendOutputChunk(currentOutputParts, text, lastCumulativeOutput);
          sections.push({ type: 'output', content: currentOutputParts.join('') });
        }
      }
    } catch (error) {
      // If parsing fails, log but don't crash the UI
      console.error('[CodexOutputRenderer] Failed to parse raw event:', error, msg.content);
    }
  }

  return { sections };
}

/**
 * Renders Codex (OpenAI) output from an array of raw event messages.
 * Each message contains a single Codex SDK event as JSON in the content field.
 *
 * Parses at display time into ordered sections preserving the temporal sequence:
 * reasoning blocks, tool calls, and output appear inline in the order they happened.
 *
 * See docs/CODEX_RAW_STORAGE.md for storage architecture.
 */
export const CodexOutputRenderer: React.FC<CodexOutputRendererProps> = ({
  rawEvents,
  isCollapsed = false,
  sessionId,
  workspacePath,
  onOpenFile,
  readFile,
  getToolCallDiffs,
}) => {
  const [collapsedReasoningSections, setCollapsedReasoningSections] = useState<Set<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // Parse raw events at display time
  const { sections } = useMemo(() => parseCodexRawEvents(rawEvents), [rawEvents]);

  const handleToggleReasoningCollapse = (sectionIndex: number) => {
    setCollapsedReasoningSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionIndex)) {
        next.delete(sectionIndex);
      } else {
        next.add(sectionIndex);
      }
      return next;
    });
  };

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
  const renderToolCall = (tool: ToolCall, sectionIndex: number, toolCallTimestamp?: number) => {
    const toolId = tool.id || tool.name || `tool-${sectionIndex}`;
    const isExpanded = expandedTools.has(toolId);
    const toolResult = tool.result;
    const resultDetails = typeof toolResult === 'object' && toolResult !== null && typeof toolResult !== 'string' ? (toolResult as unknown as Record<string, unknown>) : null;
    const explicitSuccess = resultDetails && 'success' in resultDetails ? resultDetails.success !== false : undefined;
    const derivedErrorMessage = resultDetails && typeof resultDetails.error === 'string' ? (resultDetails.error as string) : undefined;
    const didFail = explicitSuccess === false || !!derivedErrorMessage;
    const statusLabel = didFail ? 'Failed' : 'Succeeded';
    const statusColor = didFail ? 'var(--nim-error)' : 'var(--nim-success)';
    const statusBackground = didFail ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
    const hasResultValue = toolResult !== undefined && toolResult !== null;
    const hasDisplayResult = hasResultValue && (typeof toolResult !== 'string' || toolResult.trim().length > 0);
    const toolDisplayName = formatToolDisplayName(tool.name || '') || tool.name || 'Tool Call';

    const CustomWidget = tool.name ? getCustomToolWidget(tool.name) : undefined;
    if (CustomWidget) {
      const toolMessage: Message = {
        role: 'tool',
        content: '',
        timestamp: Date.now(),
        toolCall: tool,
        ...(didFail ? { isError: true } : {}),
      };

      return (
        <div key={toolId} className="my-2">
          <CustomWidget
            message={toolMessage}
            isExpanded={isExpanded}
            onToggle={() => handleToggleToolExpand(toolId)}
            workspacePath={workspacePath}
            sessionId={sessionId}
            readFile={readFile}
            getToolCallDiffs={getToolCallDiffs}
          />
        </div>
      );
    }

    return (
      <div key={toolId} className="rounded-md bg-nim-tertiary overflow-hidden border border-nim my-2">
        <button
          onClick={() => handleToggleToolExpand(toolId)}
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


            <div className="mt-2">
              <div className="text-nim-faint mb-1">Result:</div>
              {hasDisplayResult ? (
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

            {/* File changes caused by this tool call */}
            {getToolCallDiffs && tool.id && hasResultValue && (
              <ToolCallChanges
                toolCallItemId={tool.id}
                toolCallTimestamp={toolCallTimestamp}
                getToolCallDiffs={getToolCallDiffs}
                isExpanded={isExpanded}
                workspacePath={workspacePath}
                onOpenFile={onOpenFile}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTodoList = (items: Array<{ text: string; completed: boolean }>, sectionIndex: number) => {
    const completedCount = items.filter(t => t.completed).length;
    const total = items.length;
    const allDone = completedCount === total;
    return (
      <div
        key={`todo-${sectionIndex}`}
        className="rounded-md overflow-hidden border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] my-2"
      >
        <div className="py-2 px-3 flex items-center gap-2 border-b border-[var(--nim-border)]">
          <MaterialSymbol
            icon="checklist"
            size={16}
            className={allDone ? 'text-[var(--nim-success)]' : 'text-[var(--nim-primary)]'}
          />
          <span className="text-sm font-medium text-[var(--nim-text)]">
            Tasks
          </span>
          <span className="text-xs text-[var(--nim-text-faint)] ml-auto">
            {completedCount}/{total} completed
          </span>
        </div>
        <div className="px-3 py-2 space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 flex-shrink-0">
                {item.completed ? (
                  <MaterialSymbol icon="check_circle" size={16} className="text-[var(--nim-success)]" />
                ) : (
                  <MaterialSymbol icon="radio_button_unchecked" size={16} className="text-[var(--nim-text-faint)]" />
                )}
              </span>
              <span
                className={item.completed
                  ? 'text-[var(--nim-text-faint)] line-through'
                  : 'text-[var(--nim-text)]'}
              >
                {item.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderReasoningSection = (blocks: string[], sectionIndex: number) => {
    const isExpanded = !collapsedReasoningSections.has(sectionIndex);
    return (
      <div key={`reasoning-${sectionIndex}`} className="codex-thinking border border-[var(--nim-border)] rounded-md overflow-hidden bg-[var(--nim-bg-secondary)]">
        <button
          onClick={() => handleToggleReasoningCollapse(sectionIndex)}
          className="w-full py-2 px-3 flex items-center gap-2 text-left border-none cursor-pointer bg-transparent transition-colors hover:bg-[var(--nim-bg-hover)]"
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} reasoning blocks`}
        >
          <MaterialSymbol
            icon={isExpanded ? 'expand_more' : 'chevron_right'}
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
            {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}
          </span>
        </button>

        {isExpanded && (
          <div className="border-t border-[var(--nim-border)] p-3 space-y-3 max-h-96 overflow-y-auto">
            {blocks.map((block, blockIndex) => (
              <div key={blockIndex} className="codex-thinking-block text-sm text-[var(--nim-text-muted)] leading-relaxed">
                <MarkdownRenderer content={block} isUser={false} onOpenFile={onOpenFile} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Empty state
  if (sections.length === 0) {
    return null;
  }

  // Single OpenAI auth error: render widget directly
  if (sections.length === 1 && sections[0].type === 'openai_auth_error') {
    return <OpenAIAuthWidget />;
  }

  // Plain output-only: single output section with no reasoning or tools
  const isPlainOutput = sections.length === 1 && sections[0].type === 'output';
  if (isPlainOutput) {
    return (
      <div className={isCollapsed ? 'max-h-20 overflow-hidden relative' : ''}>
        <MarkdownRenderer
          content={(sections[0] as { type: 'output'; content: string }).content}
          isUser={false}
          onOpenFile={onOpenFile}
        />
        {isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--nim-bg)] to-transparent pointer-events-none" />
        )}
      </div>
    );
  }

  return (
    <div className="codex-output flex flex-col gap-2">
      {sections.map((section, sectionIndex) => {
        if (section.type === 'reasoning') {
          return renderReasoningSection(section.blocks, sectionIndex);
        }
        if (section.type === 'tool_call') {
          return renderToolCall(section.toolCall, sectionIndex, section.timestamp);
        }
        if (section.type === 'todo_list') {
          return renderTodoList(section.items, sectionIndex);
        }
        if (section.type === 'openai_auth_error') {
          return <OpenAIAuthWidget key={`auth-error-${sectionIndex}`} />;
        }
        if (section.type === 'output') {
          const isLastSection = sectionIndex === sections.length - 1;
          return (
            <div
              key={`output-${sectionIndex}`}
              className={`codex-answer ${isLastSection && isCollapsed ? 'max-h-20 overflow-hidden relative' : ''}`}
            >
              <MarkdownRenderer content={section.content} isUser={false} onOpenFile={onOpenFile} />
              {isLastSection && isCollapsed && (
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--nim-bg)] to-transparent pointer-events-none" />
              )}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};
