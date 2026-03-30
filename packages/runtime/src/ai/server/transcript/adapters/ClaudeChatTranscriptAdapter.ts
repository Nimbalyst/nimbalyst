/**
 * ClaudeChatTranscriptAdapter
 *
 * Converts Anthropic streaming API events into canonical TranscriptWriter calls.
 * The Claude Chat provider (ClaudeProvider) uses the Anthropic SDK which emits
 * content_block_start/delta/stop and message_start/stop events.
 *
 * This adapter is designed to consume the raw Anthropic streaming chunks
 * (not the provider's StreamChunk output) so it can capture fine-grained
 * tool call lifecycle events.
 *
 * Event types handled:
 *   content_block_start  (text / tool_use)    -> begin accumulation
 *   content_block_delta  (text_delta / input_json_delta) -> continue accumulation
 *   content_block_stop                        -> finalize text or tool call
 *   message_stop                              -> turn boundary
 *   message_start / message_delta with usage  -> token usage for turn_ended
 */

import type { TranscriptWriter } from '../TranscriptWriter';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ClaudeChatTranscriptAdapter {
  private pendingAssistantText = '';
  private pendingToolUse: { id: string; name: string; inputJson: string } | null = null;
  private toolCallEventIds = new Map<string, number>();
  private usageData: { input_tokens?: number; output_tokens?: number } | null = null;

  constructor(
    private writer: TranscriptWriter,
    private sessionId: string,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Called for each raw Anthropic streaming chunk from the SDK.
   */
  async handleEvent(event: any): Promise<void> {
    if (!event || typeof event !== 'object') return;

    switch (event.type) {
      case 'message_start':
        // Extract usage from the initial message if available
        if (event.message?.usage) {
          this.usageData = {
            input_tokens: event.message.usage.input_tokens ?? 0,
            output_tokens: event.message.usage.output_tokens ?? 0,
          };
        }
        break;

      case 'message_delta':
        // Accumulate output token usage from message_delta
        if (event.usage) {
          if (!this.usageData) this.usageData = {};
          this.usageData.output_tokens = event.usage.output_tokens ?? this.usageData.output_tokens;
        }
        break;

      case 'content_block_start':
        await this.handleContentBlockStart(event);
        break;

      case 'content_block_delta':
        this.handleContentBlockDelta(event);
        break;

      case 'content_block_stop':
        await this.handleContentBlockStop();
        break;

      case 'message_stop':
        await this.handleMessageStop();
        break;

      default:
        // Unknown event types are silently ignored
        break;
    }
  }

  /**
   * Called when the user sends input (before the API call).
   */
  async handleUserInput(
    text: string,
    options?: { mode?: string; attachments?: any[] },
  ): Promise<void> {
    await this.flush();

    await this.writer.appendUserMessage(this.sessionId, text, {
      mode: (options?.mode as 'agent' | 'planning') ?? 'agent',
      attachments: options?.attachments,
    });
  }

  /**
   * Called when a tool result is received after tool execution.
   */
  async handleToolResult(toolCallId: string, result: string, isError?: boolean): Promise<void> {
    const eventId = this.toolCallEventIds.get(toolCallId);
    if (eventId == null) return;

    await this.writer.updateToolCall(eventId, {
      status: isError ? 'error' : 'completed',
      result,
      isError: isError ?? false,
    });
  }

  /**
   * Flush any accumulated assistant text.
   */
  async flush(): Promise<void> {
    if (this.pendingAssistantText.length > 0) {
      await this.writer.appendAssistantMessage(this.sessionId, this.pendingAssistantText);
      this.pendingAssistantText = '';
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  private async handleContentBlockStart(event: any): Promise<void> {
    const block = event.content_block;
    if (!block) return;

    if (block.type === 'text') {
      // Text block starting -- nothing to do until deltas arrive
    } else if (block.type === 'tool_use') {
      // Flush any pending text before the tool call
      await this.flush();
      this.pendingToolUse = {
        id: block.id || `tool-${Date.now()}`,
        name: block.name || 'unknown',
        inputJson: '',
      };
    }
  }

  private handleContentBlockDelta(event: any): void {
    const delta = event.delta;
    if (!delta) return;

    if (delta.type === 'text_delta') {
      this.pendingAssistantText += delta.text ?? '';
    } else if (delta.type === 'input_json_delta') {
      if (this.pendingToolUse) {
        this.pendingToolUse.inputJson += delta.partial_json ?? '';
      }
    }
  }

  private async handleContentBlockStop(): Promise<void> {
    if (this.pendingToolUse) {
      // Finalize the tool call
      let parsedArgs: Record<string, unknown> = {};
      try {
        const jsonToParse = this.pendingToolUse.inputJson.trim() || '{}';
        parsedArgs = JSON.parse(jsonToParse);
      } catch {
        // If JSON parsing fails, store raw input
        parsedArgs = { _rawInput: this.pendingToolUse.inputJson };
      }

      const writerEvent = await this.writer.createToolCall(this.sessionId, {
        toolName: this.pendingToolUse.name,
        toolDisplayName: this.pendingToolUse.name,
        arguments: parsedArgs,
        providerToolCallId: this.pendingToolUse.id,
      });

      this.toolCallEventIds.set(this.pendingToolUse.id, writerEvent.id);
      this.pendingToolUse = null;
    } else if (this.pendingAssistantText.length > 0) {
      // Text block stopped -- flush the accumulated text
      await this.flush();
    }
  }

  private async handleMessageStop(): Promise<void> {
    await this.flush();

    // Record turn_ended with usage data if available
    const inputTokens = this.usageData?.input_tokens ?? 0;
    const outputTokens = this.usageData?.output_tokens ?? 0;

    if (inputTokens > 0 || outputTokens > 0) {
      await this.writer.recordTurnEnded(this.sessionId, {
        contextFill: {
          inputTokens,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens,
          totalContextTokens: inputTokens,
        },
        contextWindow: 0,
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

    // Reset usage for next turn
    this.usageData = null;
  }
}
