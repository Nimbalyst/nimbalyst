/**
 * CodexTranscriptAdapter
 *
 * Converts OpenAI Codex SDK streaming events (via CodexSDKProtocol) into
 * canonical TranscriptWriter calls.
 *
 * The Codex provider uses a protocol layer (CodexSDKProtocol) that emits
 * ProtocolEvent objects. This adapter consumes those protocol events.
 *
 * Event types handled:
 *   text           -> assistant message accumulation
 *   tool_call      -> tool call create/update (command_execution, file_change, mcp)
 *   error          -> system message (error)
 *   complete       -> turn ended with usage
 *   reasoning      -> skipped (internal thinking)
 *   raw_event      -> skipped (persisted separately)
 */

import type { TranscriptWriter } from '../TranscriptWriter';
import { parseMcpToolName as parseSharedMcpToolName } from '../utils';

// ---------------------------------------------------------------------------
// MCP tool name parser (same convention as Claude Code: mcp__server__tool)
// ---------------------------------------------------------------------------

function parseMcpToolName(name: string): { mcpServer: string; mcpTool: string } | null {
  const parsed = parseSharedMcpToolName(name);
  if (!parsed) return null;
  return { mcpServer: parsed.server, mcpTool: parsed.tool };
}

// ---------------------------------------------------------------------------
// Tool display name
// ---------------------------------------------------------------------------

function toolDisplayName(toolName: string): string {
  const mcp = parseMcpToolName(toolName);
  if (mcp) return mcp.mcpTool;
  // Codex-specific tool names
  if (toolName === 'file_change') return 'File Change';
  // command_execution -> Bash-like
  if (toolName.includes('command') || toolName === 'shell') return 'Bash';
  return toolName;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CodexTranscriptAdapter {
  private pendingAssistantText = '';
  private toolCallEventIds = new Map<string, number>();
  private currentMode: 'agent' | 'planning' = 'agent';

  constructor(
    private writer: TranscriptWriter,
    private sessionId: string,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Called by the provider for each ProtocolEvent from CodexSDKProtocol.
   */
  async handleEvent(event: any): Promise<void> {
    if (!event || typeof event !== 'object') return;

    switch (event.type) {
      case 'text':
        if (event.content) {
          this.pendingAssistantText += event.content;
        }
        break;

      case 'tool_call':
        await this.handleToolCallEvent(event);
        break;

      case 'error':
        await this.flush();
        if (event.error) {
          await this.writer.appendSystemMessage(this.sessionId, event.error, {
            systemType: 'error',
          });
        }
        break;

      case 'complete':
        await this.handleCompleteEvent(event);
        break;

      case 'reasoning':
        // Reasoning/thinking is internal; skip
        break;

      case 'raw_event':
        // Raw SDK events are stored separately; skip
        break;

      default:
        // Unknown event types are silently ignored
        break;
    }
  }

  /**
   * Called when the user sends input.
   */
  async handleUserInput(
    text: string,
    options?: { mode?: 'agent' | 'planning' },
  ): Promise<void> {
    await this.flush();
    if (options?.mode) this.currentMode = options.mode;

    await this.writer.appendUserMessage(this.sessionId, text, {
      mode: options?.mode ?? this.currentMode,
    });
  }

  /**
   * Flush any accumulated assistant text.
   */
  async flush(): Promise<void> {
    if (this.pendingAssistantText.length > 0) {
      await this.writer.appendAssistantMessage(this.sessionId, this.pendingAssistantText, {
        mode: this.currentMode,
      });
      this.pendingAssistantText = '';
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  private async handleToolCallEvent(event: any): Promise<void> {
    await this.flush();

    const tc = event.toolCall;
    if (!tc) return;

    const toolName: string = tc.name || 'unknown';
    const toolId: string = tc.id || `codex-tool-${Date.now()}`;
    const toolArgs: Record<string, unknown> = tc.arguments ?? {};
    const mcp = parseMcpToolName(toolName);
    const hasResult = tc.result !== undefined && tc.result !== null;

    // Determine target file path
    let targetFilePath: string | null = null;
    if (typeof toolArgs.file_path === 'string') targetFilePath = toolArgs.file_path;
    else if (typeof toolArgs.path === 'string') targetFilePath = toolArgs.path;

    // Build changes array for file_change tools
    let changes: Array<{ path: string; patch: string }> | undefined;
    if (toolName === 'file_change' && toolArgs.changes) {
      changes = Array.isArray(toolArgs.changes)
        ? (toolArgs.changes as Array<{ path: string; patch: string }>)
        : undefined;
    }

    // Check if we've already created this tool call (Codex sometimes emits
    // tool_call once without result, then again with result)
    const existingEventId = this.toolCallEventIds.get(toolId);
    if (existingEventId != null && hasResult) {
      // Update existing tool call with result
      const resultText = typeof tc.result === 'string'
        ? tc.result
        : JSON.stringify(tc.result);

      const isError = typeof tc.result === 'object' && tc.result !== null && 'error' in tc.result;

      await this.writer.updateToolCall(existingEventId, {
        status: isError ? 'error' : 'completed',
        result: resultText,
        isError,
        ...(changes ? { changes } : {}),
      });
      return;
    }

    // Create new tool call
    const writerEvent = await this.writer.createToolCall(this.sessionId, {
      toolName,
      toolDisplayName: toolDisplayName(toolName),
      description: typeof toolArgs.description === 'string' ? toolArgs.description : null,
      arguments: toolArgs,
      targetFilePath,
      mcpServer: mcp?.mcpServer ?? null,
      mcpTool: mcp?.mcpTool ?? null,
      providerToolCallId: toolId,
    });

    this.toolCallEventIds.set(toolId, writerEvent.id);

    // If the tool call already has a result, update immediately
    if (hasResult) {
      const resultText = typeof tc.result === 'string'
        ? tc.result
        : JSON.stringify(tc.result);

      const isError = typeof tc.result === 'object' && tc.result !== null && 'error' in tc.result;

      await this.writer.updateToolCall(writerEvent.id, {
        status: isError ? 'error' : 'completed',
        result: resultText,
        isError,
        ...(changes ? { changes } : {}),
      });
    }
  }

  private async handleCompleteEvent(event: any): Promise<void> {
    await this.flush();

    const usage = event.usage;
    if (!usage) return;

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;

    if (inputTokens === 0 && outputTokens === 0) return;

    await this.writer.recordTurnEnded(this.sessionId, {
      contextFill: {
        inputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens,
        totalContextTokens: inputTokens,
      },
      contextWindow: event.contextWindow || 0,
      cumulativeUsage: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
        webSearchRequests: 0,
      },
      contextCompacted: false,
    });
  }
}
