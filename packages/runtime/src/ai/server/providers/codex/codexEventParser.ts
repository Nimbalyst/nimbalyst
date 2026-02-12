export interface ParsedCodexToolCall {
  name: string;
  arguments?: any;
  result?: any;
}

export interface ParsedCodexUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ParsedCodexEvent {
  text?: string;
  reasoning?: string;
  error?: string;
  toolCall?: ParsedCodexToolCall;
  usage?: ParsedCodexUsage;
  rawEvent?: unknown; // Preserve original Codex SDK event for storage
}

function getTextFromContentArray(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const textParts = content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object') {
        const entry = item as Record<string, unknown>;
        if (typeof entry.text === 'string') return entry.text;
        if (typeof entry.content === 'string') return entry.content;
        if (typeof entry.value === 'string') return entry.value;
      }
      return '';
    })
    .filter(Boolean);

  return textParts.length > 0 ? textParts.join('\n') : null;
}

function getTextCandidate(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? value : null;
  }

  if (Array.isArray(value)) {
    return getTextFromContentArray(value);
  }

  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return (
      getTextCandidate(item.text) ??
      getTextCandidate(item.message) ??
      getTextCandidate(item.content) ??
      getTextCandidate(item.delta) ??
      getTextCandidate(item.output_text) ??
      null
    );
  }

  return null;
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
    arguments: record.arguments ?? record.args ?? record.input ?? record.parameters,
    result:
      record.result ??
      record.output ??
      record.aggregated_output ?? // Codex uses aggregated_output for command results
      (record.error ? { error: record.error } : undefined) ??
      (typeof record.exit_code === 'number' ? { exit_code: record.exit_code } : undefined),
  };
}

export function parseCodexEvent(event: unknown): ParsedCodexEvent[] {
  if (!event || typeof event !== 'object') {
    return [];
  }

  const parsed: ParsedCodexEvent[] = [];
  const record = event as Record<string, unknown>;
  const eventType = typeof record.type === 'string' ? record.type : '';

  // Log ALL events to see what we're receiving
  console.log('[codexEventParser] Received event:', {
    eventType,
    hasItem: !!record.item,
    hasTool: !!record.tool,
    hasToolCall: !!record.tool_call,
    itemType: record.item ? (record.item as any).type : undefined,
    keys: Object.keys(record).join(', '),
  });

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

    // Log command_execution items to see their structure
    if (itemType === 'command_execution') {
      console.log('[codexEventParser] command_execution item:', {
        itemKeys: Object.keys(itemRecord).join(', '),
        hasName: 'name' in itemRecord,
        hasTool: 'tool' in itemRecord,
        hasCommand: 'command' in itemRecord,
        name: itemRecord.name,
        tool: itemRecord.tool,
        command: itemRecord.command,
      });
    }

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
      console.log('[codexEventParser] Parsed item tool call:', {
        toolName: itemToolCall.name,
        itemType,
        eventType,
        hasRawEvent: !!event,
      });
      parsed.push({ toolCall: itemToolCall, rawEvent: event });
    }
  }

  const rootToolCall =
    extractToolCallFromRecord(record.tool as Record<string, unknown> | undefined) ??
    extractToolCallFromRecord(record.tool_call as Record<string, unknown> | undefined) ??
    (eventType.includes('tool') ? extractToolCallFromRecord(record) : undefined);
  if (rootToolCall) {
    console.log('[codexEventParser] Parsed root tool call:', {
      toolName: rootToolCall.name,
      eventType,
      hasRawEvent: !!event,
    });
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
