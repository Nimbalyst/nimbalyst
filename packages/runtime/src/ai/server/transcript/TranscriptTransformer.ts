/**
 * TranscriptTransformer -- lazy migration pipeline that transforms old
 * ai_agent_messages rows into canonical ai_transcript_events rows on demand.
 *
 * Used for sessions created before the canonical transcript system shipped.
 * The raw ai_agent_messages log is preserved as the source of truth; this
 * transformer reads it and writes derived canonical events via TranscriptWriter.
 */

import { TranscriptWriter } from './TranscriptWriter';
import type { ITranscriptEventStore } from './types';

// Tool names that represent sub-agent spawns
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

// ---------------------------------------------------------------------------
// Dependencies (injected via interfaces)
// ---------------------------------------------------------------------------

export interface RawMessage {
  id: number;
  sessionId: string;
  source: string;
  direction: 'input' | 'output';
  content: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
  hidden?: boolean;
}

export interface IRawMessageStore {
  /** Get raw messages for a session, ordered by id, optionally starting after a given id */
  getMessages(sessionId: string, afterId?: number): Promise<RawMessage[]>;
}

export interface ISessionMetadataStore {
  getTransformStatus(sessionId: string): Promise<{
    transformVersion: number | null;
    lastRawMessageId: number | null;
    lastTransformedAt: Date | null;
    transformStatus: 'pending' | 'complete' | 'error' | null;
  }>;
  updateTransformStatus(
    sessionId: string,
    update: {
      transformVersion: number;
      lastRawMessageId: number;
      lastTransformedAt: Date;
      transformStatus: 'pending' | 'complete' | 'error';
    },
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Transformer
// ---------------------------------------------------------------------------

export class TranscriptTransformer {
  static readonly CURRENT_VERSION = 2;

  constructor(
    private rawStore: IRawMessageStore,
    private transcriptStore: ITranscriptEventStore,
    private metadataStore: ISessionMetadataStore,
  ) {}

  /**
   * Ensure a session has canonical rows. Call before reading canonical transcript.
   * Returns true if transformation was needed, false if already up to date.
   */
  async ensureTransformed(sessionId: string, provider: string): Promise<boolean> {
    const status = await this.metadataStore.getTransformStatus(sessionId);

    // Already complete at current version -- nothing to do
    if (
      status.transformStatus === 'complete' &&
      status.transformVersion === TranscriptTransformer.CURRENT_VERSION
    ) {
      return false;
    }

    // Version mismatch (upgrade or downgrade) -- re-transform from scratch
    if (
      status.transformVersion != null &&
      status.transformVersion !== TranscriptTransformer.CURRENT_VERSION
    ) {
      await this.transcriptStore.deleteSessionEvents(sessionId);
      return this.transformFromBeginning(sessionId, provider);
    }

    // Never transformed (null status) -- transform from beginning
    if (status.transformStatus == null) {
      return this.transformFromBeginning(sessionId, provider);
    }

    // Pending -- resume from last raw message id
    if (status.transformStatus === 'pending') {
      return this.resumeTransformation(sessionId, provider, status.lastRawMessageId ?? undefined);
    }

    // Error status -- try again from where we left off
    if (status.transformStatus === 'error') {
      return this.resumeTransformation(sessionId, provider, status.lastRawMessageId ?? undefined);
    }

    return false;
  }

  private async transformFromBeginning(sessionId: string, provider: string): Promise<boolean> {
    try {
      await this.metadataStore.updateTransformStatus(sessionId, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: 0,
        lastTransformedAt: new Date(),
        transformStatus: 'pending',
      });

      const messages = await this.rawStore.getMessages(sessionId);
      if (messages.length === 0) {
        await this.metadataStore.updateTransformStatus(sessionId, {
          transformVersion: TranscriptTransformer.CURRENT_VERSION,
          lastRawMessageId: 0,
          lastTransformedAt: new Date(),
          transformStatus: 'complete',
        });
        return true;
      }

      const result = await this.transformMessages(sessionId, messages, provider);

      await this.metadataStore.updateTransformStatus(sessionId, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: result.lastRawMessageId,
        lastTransformedAt: new Date(),
        transformStatus: 'complete',
      });

      return true;
    } catch (err) {
      await this.metadataStore.updateTransformStatus(sessionId, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: 0,
        lastTransformedAt: new Date(),
        transformStatus: 'error',
      });
      throw err;
    }
  }

  private async resumeTransformation(
    sessionId: string,
    provider: string,
    afterId?: number,
  ): Promise<boolean> {
    try {
      const messages = await this.rawStore.getMessages(sessionId, afterId);
      if (messages.length === 0) {
        await this.metadataStore.updateTransformStatus(sessionId, {
          transformVersion: TranscriptTransformer.CURRENT_VERSION,
          lastRawMessageId: afterId ?? 0,
          lastTransformedAt: new Date(),
          transformStatus: 'complete',
        });
        return true;
      }

      const result = await this.transformMessages(sessionId, messages, provider);

      await this.metadataStore.updateTransformStatus(sessionId, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: result.lastRawMessageId,
        lastTransformedAt: new Date(),
        transformStatus: 'complete',
      });

      return true;
    } catch (err) {
      await this.metadataStore.updateTransformStatus(sessionId, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: afterId ?? 0,
        lastTransformedAt: new Date(),
        transformStatus: 'error',
      });
      throw err;
    }
  }

  /**
   * Transform raw messages into canonical events.
   * Parses ai_agent_messages content and writes ai_transcript_events via TranscriptWriter.
   */
  private async transformMessages(
    sessionId: string,
    messages: RawMessage[],
    provider: string,
  ): Promise<{ lastRawMessageId: number; eventsWritten: number }> {
    const writer = new TranscriptWriter(this.transcriptStore, provider);

    // Seed the sequence counter once to avoid N separate MAX(sequence) queries
    const startSequence = await this.transcriptStore.getNextSequence(sessionId);
    writer.seedSequence(startSequence);

    // Track tool_use IDs to their canonical event IDs for matching results
    const toolEventIds = new Map<string, number>();
    // Track subagent tool IDs (Agent/Task spawns) for parent-child grouping
    const subagentEventIds = new Map<string, number>();
    // Track API message IDs that have had text content processed (dedup accumulated chunks)
    const processedTextMessageIds = new Set<string>();
    let eventsWritten = 0;
    let lastRawMessageId = 0;

    for (const msg of messages) {
      if (msg.hidden) {
        lastRawMessageId = msg.id;
        continue;
      }

      try {
        if (msg.direction === 'input') {
          eventsWritten += await this.transformInputMessage(
            writer,
            sessionId,
            msg,
            toolEventIds,
            subagentEventIds,
          );
        } else if (msg.direction === 'output') {
          eventsWritten += await this.transformOutputMessage(
            writer,
            sessionId,
            msg,
            toolEventIds,
            subagentEventIds,
            processedTextMessageIds,
          );
        }
      } catch {
        // Skip unparseable messages -- the raw log is preserved
      }

      lastRawMessageId = msg.id;
    }

    return { lastRawMessageId, eventsWritten };
  }

  // ---------------------------------------------------------------------------
  // Input message transformation
  // ---------------------------------------------------------------------------

  private async transformInputMessage(
    writer: TranscriptWriter,
    sessionId: string,
    msg: RawMessage,
    toolEventIds: Map<string, number>,
    subagentEventIds: Map<string, number>,
  ): Promise<number> {
    let eventsWritten = 0;

    try {
      const parsed = JSON.parse(msg.content);

      if (parsed.prompt) {
        // Claude Code format: { prompt: "...", options: {...} }
        if (parsed.prompt.startsWith('[System:')) {
          // System continuation messages
          const event = await writer.appendSystemMessage(sessionId, parsed.prompt, {
            systemType: 'status',
            searchable: false,
            createdAt: msg.createdAt,
          });
          if (event) eventsWritten++;
        } else if (this.isSystemReminderContent(parsed.prompt, msg.metadata)) {
          const event = await writer.appendSystemMessage(sessionId, parsed.prompt, {
            systemType: 'status',
            createdAt: msg.createdAt,
          });
          if (event) eventsWritten++;
        } else {
          const mode = (msg.metadata?.mode as 'agent' | 'planning') ?? 'agent';
          const event = await writer.appendUserMessage(sessionId, parsed.prompt, {
            mode,
            attachments: msg.metadata?.attachments as any,
            createdAt: msg.createdAt,
          });
          if (event) eventsWritten++;
        }
      } else if (parsed.type === 'user' && parsed.message) {
        // SDK format: { type: "user", message: { role: "user", content: ... } }
        const content = parsed.message.content;

        if (Array.isArray(content)) {
          // Check for tool_result blocks
          for (const block of content) {
            if (block.type === 'tool_result') {
              eventsWritten += await this.handleToolResult(
                writer,
                block,
                toolEventIds,
                subagentEventIds,
              );
            }
          }
        } else if (typeof content === 'string') {
          if (this.isSystemReminderContent(content, msg.metadata)) {
            const event = await writer.appendSystemMessage(sessionId, content, {
              systemType: 'status',
              createdAt: msg.createdAt,
            });
            if (event) eventsWritten++;
          } else {
            const event = await writer.appendUserMessage(sessionId, content, {
              createdAt: msg.createdAt,
            });
            if (event) eventsWritten++;
          }
        }
      }
    } catch {
      // Not JSON -- treat as plain text user message
      const content = String(msg.content ?? '');
      if (content.trim()) {
        if (this.isSystemReminderContent(content, msg.metadata)) {
          const event = await writer.appendSystemMessage(sessionId, content, {
            systemType: 'status',
            createdAt: msg.createdAt,
          });
          if (event) eventsWritten++;
        } else {
          const event = await writer.appendUserMessage(sessionId, content, {
            createdAt: msg.createdAt,
          });
          if (event) eventsWritten++;
        }
      }
    }

    return eventsWritten;
  }

  // ---------------------------------------------------------------------------
  // Output message transformation
  // ---------------------------------------------------------------------------

  private async transformOutputMessage(
    writer: TranscriptWriter,
    sessionId: string,
    msg: RawMessage,
    toolEventIds: Map<string, number>,
    subagentEventIds: Map<string, number>,
    processedTextMessageIds: Set<string>,
  ): Promise<number> {
    let eventsWritten = 0;

    try {
      const parsed = JSON.parse(msg.content);

      if (parsed.type === 'text' && parsed.content !== undefined) {
        // Claude Code text chunk: { type: 'text', content: '...' }
        const event = await writer.appendAssistantMessage(sessionId, String(parsed.content), {
          createdAt: msg.createdAt,
        });
        if (event) eventsWritten++;
      } else if (parsed.type === 'assistant' && parsed.message) {
        // parent_tool_use_id on the outer wrapper indicates child tools of a subagent
        const parentToolUseId: string | undefined = parsed.parent_tool_use_id;

        // The SDK sends both streaming chunks (with message.id/model) and accumulated
        // echo chunks (without these fields) containing duplicate content.
        // Track message IDs to skip duplicate text blocks.
        const messageId: string | undefined = parsed.message.id;

        // Full assistant message with structured content
        if (Array.isArray(parsed.message.content)) {
          for (const block of parsed.message.content) {
            if (block.type === 'text' && block.text) {
              // Deduplicate text:
              // 1. If we've seen this message ID before, skip (repeated streaming chunk)
              // 2. If no message ID AND we've already processed text from streaming chunks,
              //    this is likely an accumulated echo -- skip
              if (messageId && processedTextMessageIds.has(messageId)) {
                continue;
              }
              if (!messageId && processedTextMessageIds.size > 0) {
                continue;
              }
              if (messageId) processedTextMessageIds.add(messageId);
              const event = await writer.appendAssistantMessage(sessionId, block.text, {
                createdAt: msg.createdAt,
              });
              if (event) eventsWritten++;
            } else if (block.type === 'tool_use') {
              eventsWritten += await this.handleToolUse(
                writer,
                sessionId,
                msg,
                block,
                toolEventIds,
                subagentEventIds,
                parentToolUseId,
              );
            } else if (block.type === 'tool_result') {
              eventsWritten += await this.handleToolResult(writer, block, toolEventIds, subagentEventIds);
            }
          }
        }
      } else if (parsed.type === 'error' && parsed.error) {
        // Error message
        const errorContent =
          typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
        const event = await writer.appendSystemMessage(sessionId, errorContent, {
          systemType: 'error',
          createdAt: msg.createdAt,
        });
        if (event) eventsWritten++;
      } else if (parsed.type === 'nimbalyst_tool_use') {
        // Internal tool call (AskUserQuestion, ToolPermission, etc.)
        eventsWritten += await this.handleNimbalystToolUse(
          writer,
          sessionId,
          msg,
          parsed,
          toolEventIds,
        );
      } else if (parsed.type === 'nimbalyst_tool_result') {
        // Internal tool result
        eventsWritten += await this.handleToolResult(writer, {
          tool_use_id: parsed.tool_use_id || parsed.id,
          content: parsed.result,
          is_error: parsed.is_error,
        }, toolEventIds, subagentEventIds);
      } else if (parsed.type === 'user' && parsed.message) {
        // Tool results that come as output direction (slash commands etc.)
        if (Array.isArray(parsed.message.content)) {
          for (const block of parsed.message.content) {
            if (block.type === 'tool_result') {
              eventsWritten += await this.handleToolResult(writer, block, toolEventIds, subagentEventIds);
            }
          }
        } else if (typeof parsed.message.content === 'string' && parsed.message.content.trim()) {
          const event = await writer.appendSystemMessage(
            sessionId,
            parsed.message.content,
            { systemType: 'status', createdAt: msg.createdAt },
          );
          if (event) eventsWritten++;
        }
      }
    } catch {
      // Not JSON -- treat as plain text assistant message
      const content = String(msg.content ?? '');
      if (content.trim()) {
        const event = await writer.appendAssistantMessage(sessionId, content, {
          createdAt: msg.createdAt,
        });
        if (event) eventsWritten++;
      }
    }

    return eventsWritten;
  }

  // ---------------------------------------------------------------------------
  // Tool handling helpers
  // ---------------------------------------------------------------------------

  private async handleToolUse(
    writer: TranscriptWriter,
    sessionId: string,
    msg: RawMessage,
    block: any,
    toolEventIds: Map<string, number>,
    subagentEventIds: Map<string, number>,
    parentToolUseId?: string,
  ): Promise<number> {
    const toolName = block.name ?? 'unknown';
    const toolId: string | undefined = block.id;
    const args = block.input ?? block.arguments ?? {};

    // Detect subagent spawn (Agent/Task tools)
    if (SUBAGENT_TOOLS.has(toolName) && toolId) {
      // Deduplicate: SDK sends streaming + accumulated chunks with the same tool_use
      if (subagentEventIds.has(toolId)) return 0;

      const prompt = typeof args.prompt === 'string' ? args.prompt : JSON.stringify(args);
      const teammateName = typeof args.name === 'string' ? args.name : null;
      const teamName = typeof args.team_name === 'string' ? args.team_name : null;
      const teammateMode = typeof args.mode === 'string' ? args.mode : null;
      const isBackground = args.run_in_background === true;

      const event = await writer.createSubagent(sessionId, {
        subagentId: toolId,
        agentType: toolName,
        teammateName,
        teamName,
        teammateMode,
        isBackground,
        prompt,
        createdAt: msg.createdAt,
      });

      subagentEventIds.set(toolId, event.id);
      // Also track as tool event for result matching
      toolEventIds.set(toolId, event.id);
      return 1;
    }

    const isMcpTool = toolName.startsWith('mcp__');
    let mcpServer: string | null = null;
    let mcpTool: string | null = null;

    if (isMcpTool) {
      const parts = toolName.split('__');
      if (parts.length >= 3) {
        mcpServer = parts[1];
        mcpTool = parts.slice(2).join('__');
      }
    }

    // Deduplicate: SDK sends streaming + accumulated chunks with the same tool_use
    if (toolId && toolEventIds.has(toolId)) return 0;

    // Resolve parent subagent for nested tool calls
    const resolvedParent = parentToolUseId ?? block.parent_tool_use_id;
    const subagentId = resolvedParent && subagentEventIds.has(resolvedParent) ? resolvedParent : undefined;

    const event = await writer.createToolCall(sessionId, {
      toolName,
      toolDisplayName: toolName,
      arguments: args,
      mcpServer,
      mcpTool,
      providerToolCallId: toolId ?? null,
      subagentId,
      createdAt: msg.createdAt,
    });

    if (toolId) {
      toolEventIds.set(toolId, event.id);
    }

    return 1;
  }

  private async handleToolResult(
    writer: TranscriptWriter,
    block: any,
    toolEventIds: Map<string, number>,
    subagentEventIds?: Map<string, number>,
  ): Promise<number> {
    const toolUseId = block.tool_use_id || block.id;
    if (!toolUseId) return 0;

    // Check if this completes a subagent
    const subagentEventId = subagentEventIds?.get(toolUseId);
    if (subagentEventId != null) {
      const resultText = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);
      await writer.updateSubagent(subagentEventId, {
        status: 'completed',
        resultSummary: resultText?.substring(0, 500),
      });
      return 0;
    }

    const eventId = toolEventIds.get(toolUseId);
    if (!eventId) return 0;

    let resultText = '';
    if (typeof block.content === 'string') {
      resultText = block.content;
    } else if (Array.isArray(block.content)) {
      for (const inner of block.content) {
        if (inner.type === 'text' && inner.text) {
          resultText += inner.text;
        }
      }
    } else if (block.content != null) {
      resultText = JSON.stringify(block.content);
    }

    await writer.updateToolCall(eventId, {
      status: block.is_error ? 'error' : 'completed',
      result: resultText,
      isError: block.is_error ?? false,
    });

    return 0; // Update, not a new event
  }

  private async handleNimbalystToolUse(
    writer: TranscriptWriter,
    sessionId: string,
    msg: RawMessage,
    parsed: any,
    toolEventIds: Map<string, number>,
  ): Promise<number> {
    const toolName = parsed.name ?? 'unknown';
    const args = parsed.input ?? {};

    const event = await writer.createToolCall(sessionId, {
      toolName,
      toolDisplayName: toolName,
      arguments: args,
      providerToolCallId: parsed.id ?? null,
      createdAt: msg.createdAt,
    });

    if (parsed.id) {
      toolEventIds.set(parsed.id, event.id);
    }

    return 1;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isSystemReminderContent(
    content: string,
    metadata?: Record<string, unknown>,
  ): boolean {
    return (
      metadata?.promptType === 'system_reminder' ||
      /<SYSTEM_REMINDER>[\s\S]*<\/SYSTEM_REMINDER>/.test(content)
    );
  }
}
