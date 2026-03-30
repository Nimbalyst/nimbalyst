/**
 * OpenAIChatTranscriptAdapter
 *
 * Converts OpenAI Chat Completion streaming chunks into canonical TranscriptWriter
 * calls. The OpenAI provider streams `chat.completion.chunk` objects with deltas
 * for text content and tool calls.
 *
 * This adapter also works for LM Studio, which uses the OpenAI-compatible API
 * format with identical streaming chunk structure. Rather than creating a separate
 * LMStudioTranscriptAdapter, consumers should instantiate this adapter with
 * provider='lmstudio' for LM Studio sessions.
 *
 * Event types handled:
 *   delta.content                  -> accumulate assistant text
 *   delta.tool_calls               -> accumulate tool call data
 *   finish_reason: 'stop'          -> flush text, record turn_ended
 *   finish_reason: 'tool_calls'    -> finalize accumulated tool calls
 *   chunk.usage                    -> capture token usage
 */

import type { TranscriptWriter } from '../TranscriptWriter';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAIChatTranscriptAdapter {
  private pendingAssistantText = '';
  private pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
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
   * Called for each streaming chunk from the OpenAI (or LM Studio) API.
   */
  async handleChunk(chunk: any): Promise<void> {
    if (!chunk || typeof chunk !== 'object') return;

    // Capture usage data if present (included in final chunk with stream_options.include_usage)
    if (chunk.usage) {
      this.usageData = {
        input_tokens: chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0,
        output_tokens: chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0,
      };
    }

    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;

    // Accumulate text content
    if (delta?.content) {
      this.pendingAssistantText += delta.content;
    }

    // Accumulate tool calls
    if (delta?.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        const index = toolCall.index ?? 0;

        if (!this.pendingToolCalls.has(index)) {
          this.pendingToolCalls.set(index, {
            id: toolCall.id || `call_${index}`,
            name: toolCall.function?.name || '',
            arguments: '',
          });
        }

        const pending = this.pendingToolCalls.get(index)!;

        if (toolCall.id) {
          pending.id = toolCall.id;
        }
        if (toolCall.function?.name) {
          pending.name = toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          pending.arguments += toolCall.function.arguments;
        }
      }
    }

    // Handle finish reasons
    const finishReason = choice.finish_reason;
    if (finishReason === 'stop') {
      await this.flush();
      await this.recordTurnEnded();
    } else if (finishReason === 'tool_calls') {
      await this.finalizeToolCalls();
    }
  }

  /**
   * Called when the user sends input (before the API call).
   */
  async handleUserInput(
    text: string,
    options?: { mode?: string },
  ): Promise<void> {
    await this.flush();

    await this.writer.appendUserMessage(this.sessionId, text, {
      mode: (options?.mode as 'agent' | 'planning') ?? 'agent',
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
  // Internal helpers
  // -----------------------------------------------------------------------

  private async finalizeToolCalls(): Promise<void> {
    // Flush any pending text first
    await this.flush();

    for (const [, pending] of this.pendingToolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        const jsonToParse = pending.arguments.trim() || '{}';
        parsedArgs = JSON.parse(jsonToParse);
      } catch {
        parsedArgs = { _rawInput: pending.arguments };
      }

      const writerEvent = await this.writer.createToolCall(this.sessionId, {
        toolName: pending.name,
        toolDisplayName: pending.name,
        arguments: parsedArgs,
        providerToolCallId: pending.id,
      });

      this.toolCallEventIds.set(pending.id, writerEvent.id);
    }

    // Clear pending tool calls
    this.pendingToolCalls.clear();
  }

  private async recordTurnEnded(): Promise<void> {
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
