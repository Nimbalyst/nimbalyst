import { extractTextFromCodexEvent } from './textExtraction';

export interface ParsedCodexToolCall {
  name: string;
  arguments?: unknown;
  result?: unknown;
}

export interface ParsedCodexUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * Base shape of Codex SDK events
 *
 * Codex SDK events are complex objects with varying shapes.
 * This type captures the minimal common structure we rely on.
 */
export interface CodexSdkEvent {
  /** Event type identifier (e.g., 'error', 'item.completed', 'task_complete') */
  type?: string;
  /** Event data varies by type */
  [key: string]: unknown;
}

/**
 * Type guard to check if an unknown value is a CodexSdkEvent
 */
export function isCodexSdkEvent(value: unknown): value is CodexSdkEvent {
  return value !== null && typeof value === 'object';
}

export interface ParsedCodexEvent {
  text?: string;
  reasoning?: string;
  error?: string;
  toolCall?: ParsedCodexToolCall;
  usage?: ParsedCodexUsage;
  threadId?: string; // Thread ID from thread.started event
  rawEvent?: CodexSdkEvent; // Preserve original Codex SDK event for storage
}

/**
 * Legacy function kept for backward compatibility with existing code.
 * @deprecated Use extractTextFromCodexEvent from textExtraction.ts instead.
 */
function getTextCandidate(value: unknown): string | null {
  return extractTextFromCodexEvent(value);
}

function getUsageFromRecord(record: Record<string, unknown> | null | undefined): ParsedCodexUsage | undefined {
  if (!record) return undefined;

  const input =
    typeof record.input_tokens === 'number'
      ? record.input_tokens
      : typeof record.inputTokens === 'number'
        ? record.inputTokens
        : 0;
  const output =
    typeof record.output_tokens === 'number'
      ? record.output_tokens
      : typeof record.outputTokens === 'number'
        ? record.outputTokens
        : 0;
  const total =
    typeof record.total_tokens === 'number'
      ? record.total_tokens
      : typeof record.totalTokens === 'number'
        ? record.totalTokens
        : input + output;

  if (input === 0 && output === 0 && total === 0) {
    return undefined;
  }

  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
  };
}

function extractToolCallFromRecord(record: Record<string, unknown> | null | undefined): ParsedCodexToolCall | undefined {
  if (!record) return undefined;

  const toolField = record.tool;
  const nameFromToolField =
    typeof toolField === 'string'
      ? toolField
      : toolField && typeof toolField === 'object' && typeof (toolField as Record<string, unknown>).name === 'string'
        ? ((toolField as Record<string, unknown>).name as string)
        : '';

  const name =
    nameFromToolField ||
    (typeof record.tool_name === 'string' && record.tool_name) ||
    (typeof record.name === 'string' && record.name) ||
    (typeof record.function_name === 'string' && record.function_name) ||
    (typeof record.command === 'string' && record.command) || // Codex uses 'command' field
    '';

  if (!name) {
    return undefined;
  }

  return {
    name,
    arguments: (record.arguments ?? record.args ?? record.input ?? record.parameters) as unknown,
    result:
      (record.result ??
      record.output ??
      record.aggregated_output ?? // Codex uses aggregated_output for command results
      (record.error ? { error: record.error } : undefined) ??
      (typeof record.exit_code === 'number' ? { exit_code: record.exit_code } : undefined)) as unknown,
  };
}

export function parseCodexEvent(event: unknown): ParsedCodexEvent[] {
  if (!isCodexSdkEvent(event)) {
    return [];
  }

  const parsed: ParsedCodexEvent[] = [];
  const record = event as Record<string, unknown>;
  const eventType = typeof record.type === 'string' ? record.type : '';

  // Capture thread ID from thread.started event
  if (eventType === 'thread.started' && typeof record.thread_id === 'string' && record.thread_id) {
    parsed.push({ threadId: record.thread_id, rawEvent: event });
  }

  const directError = getTextCandidate(record.error) ?? getTextCandidate(record.message);
  if (eventType === 'error' && directError) {
    parsed.push({ error: directError });
  }

  const directText =
    getTextCandidate(record.text) ??
    getTextCandidate(record.delta) ??
    (eventType === 'task_complete' ? getTextCandidate(record.last_agent_message) : null);
  if (directText) {
    parsed.push({ text: directText, rawEvent: event });
  }

  const item = record.item;
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    const itemType = typeof itemRecord.type === 'string' ? itemRecord.type : '';

    const itemText = getTextCandidate(itemRecord);

    // Separate reasoning items from message items
    if (itemType === 'reasoning' && itemText) {
      parsed.push({ reasoning: itemText, rawEvent: event });
    } else if (itemText && (itemType.includes('message') || eventType === 'item.completed' || eventType === 'item.updated')) {
      parsed.push({ text: itemText, rawEvent: event });
    }

    const itemToolCall =
      extractToolCallFromRecord(itemRecord.tool as Record<string, unknown> | undefined) ??
      extractToolCallFromRecord(itemRecord);
    if (
      itemToolCall &&
      (itemType.includes('tool') ||
        itemType.includes('call') ||
        itemType === 'command_execution' || // Codex uses command_execution for tool calls
        eventType.includes('tool') ||
        eventType === 'item.completed' ||
        eventType === 'item.started')
    ) {
      parsed.push({ toolCall: itemToolCall, rawEvent: event });
    }
  }

  const rootToolCall =
    extractToolCallFromRecord(record.tool as Record<string, unknown> | undefined) ??
    extractToolCallFromRecord(record.tool_call as Record<string, unknown> | undefined) ??
    (eventType.includes('tool') ? extractToolCallFromRecord(record) : undefined);
  if (rootToolCall) {
    parsed.push({ toolCall: rootToolCall, rawEvent: event });
  }

  const usage =
    getUsageFromRecord(record.usage as Record<string, unknown> | undefined) ??
    getUsageFromRecord(record.info as Record<string, unknown> | undefined) ??
    getUsageFromRecord(record.token_count as Record<string, unknown> | undefined);
  if (usage) {
    parsed.push({ usage, rawEvent: event });
  }

  return parsed;
}
