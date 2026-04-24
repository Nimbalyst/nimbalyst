/**
 * TranscriptWriter -- shared service for writing canonical transcript events.
 *
 * Provider adapters call this to produce canonical events. It owns sequence
 * assignment, searchable flag decisions, and stateful row updates.
 */

import type {
  ITranscriptEventStore,
  TranscriptEvent,
  TranscriptEventType,
  UserMessagePayload,
  AssistantMessagePayload,
  SystemMessagePayload,
  ToolCallPayload,
  ToolProgressPayload,
  InteractivePromptPayload,
  SubagentPayload,
  TurnEndedPayload,
} from './types';

export class TranscriptWriter {
  private seededSequence: number | null = null;

  constructor(
    private store: ITranscriptEventStore,
    private provider: string,
  ) {}

  /**
   * Seed the in-memory sequence counter for bulk operations.
   * When seeded, insertEvent uses and increments the counter instead of
   * querying the DB each time. Safe during single-threaded bulk transforms.
   */
  seedSequence(startSequence: number): void {
    this.seededSequence = startSequence;
  }

  // ---------------------------------------------------------------------------
  // Message events (non-stateful)
  // ---------------------------------------------------------------------------

  async appendUserMessage(
    sessionId: string,
    text: string,
    options?: {
      mode?: 'agent' | 'planning';
      inputType?: 'user' | 'system_message';
      attachments?: UserMessagePayload['attachments'];
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    const payload: UserMessagePayload = {
      mode: options?.mode ?? 'agent',
      inputType: options?.inputType ?? 'user',
      ...(options?.attachments ? { attachments: options.attachments } : {}),
    };

    return this.insertEvent(sessionId, {
      eventType: 'user_message',
      searchableText: text,
      searchable: true,
      payload: payload as unknown as Record<string, unknown>,
      createdAt: options?.createdAt,
    });
  }

  async appendAssistantMessage(
    sessionId: string,
    text: string,
    options?: {
      mode?: 'agent' | 'planning';
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    const payload: AssistantMessagePayload = {
      mode: options?.mode ?? 'agent',
    };

    return this.insertEvent(sessionId, {
      eventType: 'assistant_message',
      searchableText: text,
      searchable: true,
      payload: payload as unknown as Record<string, unknown>,
      createdAt: options?.createdAt,
    });
  }

  async appendSystemMessage(
    sessionId: string,
    text: string,
    options?: {
      systemType?: SystemMessagePayload['systemType'];
      statusCode?: string;
      isAuthError?: boolean;
      searchable?: boolean;
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    const payload: SystemMessagePayload = {
      systemType: options?.systemType ?? 'status',
      ...(options?.statusCode ? { statusCode: options.statusCode } : {}),
      ...(options?.isAuthError ? { isAuthError: true } : {}),
    };

    return this.insertEvent(sessionId, {
      eventType: 'system_message',
      searchableText: text,
      searchable: options?.searchable ?? true,
      payload: payload as unknown as Record<string, unknown>,
      createdAt: options?.createdAt,
    });
  }

  // ---------------------------------------------------------------------------
  // Tool call events (stateful -- create then update)
  // ---------------------------------------------------------------------------

  async createToolCall(
    sessionId: string,
    params: {
      toolName: string;
      toolDisplayName: string;
      description?: string | null;
      arguments: Record<string, unknown>;
      targetFilePath?: string | null;
      mcpServer?: string | null;
      mcpTool?: string | null;
      providerToolCallId?: string | null;
      subagentId?: string | null;
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    const payload: ToolCallPayload = {
      toolName: params.toolName,
      toolDisplayName: params.toolDisplayName,
      status: 'running',
      description: params.description ?? null,
      arguments: params.arguments,
      targetFilePath: params.targetFilePath ?? null,
      mcpServer: params.mcpServer ?? null,
      mcpTool: params.mcpTool ?? null,
    };

    return this.insertEvent(sessionId, {
      eventType: 'tool_call',
      searchableText: null,
      searchable: false,
      payload: payload as unknown as Record<string, unknown>,
      providerToolCallId: params.providerToolCallId ?? null,
      subagentId: params.subagentId ?? null,
      createdAt: params.createdAt,
    });
  }

  async updateToolCall(
    eventId: number,
    update: {
      status: 'completed' | 'error';
      result?: string;
      isError?: boolean;
      exitCode?: number;
      durationMs?: number;
      changes?: Array<{ path: string; patch: string }>;
    },
  ): Promise<void> {
    const existing = await this.store.getEventById(eventId);
    if (!existing) {
      throw new Error(`TranscriptWriter: event ${eventId} not found`);
    }
    await this.store.mergeEventPayload(eventId, update as unknown as Record<string, unknown>);
  }

  async appendToolProgress(
    sessionId: string,
    params: {
      parentEventId: number;
      toolName: string;
      elapsedSeconds: number;
      progressContent: string;
      subagentId?: string | null;
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    const payload: ToolProgressPayload = {
      toolName: params.toolName,
      elapsedSeconds: params.elapsedSeconds,
      progressContent: params.progressContent,
    };

    return this.insertEvent(sessionId, {
      eventType: 'tool_progress',
      searchableText: null,
      searchable: false,
      payload: payload as unknown as Record<string, unknown>,
      parentEventId: params.parentEventId,
      subagentId: params.subagentId ?? null,
      createdAt: params.createdAt,
    });
  }

  // ---------------------------------------------------------------------------
  // Interactive prompt events (stateful -- create then update)
  // ---------------------------------------------------------------------------

  async createInteractivePrompt(
    sessionId: string,
    payload: InteractivePromptPayload,
    options?: {
      subagentId?: string | null;
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    return this.insertEvent(sessionId, {
      eventType: 'interactive_prompt',
      searchableText: null,
      searchable: false,
      payload: payload as unknown as Record<string, unknown>,
      subagentId: options?.subagentId ?? null,
      createdAt: options?.createdAt,
    });
  }

  async updateInteractivePrompt(
    eventId: number,
    update: Partial<InteractivePromptPayload>,
  ): Promise<void> {
    const existing = await this.store.getEventById(eventId);
    if (!existing) {
      throw new Error(`TranscriptWriter: event ${eventId} not found`);
    }
    await this.store.mergeEventPayload(eventId, update as unknown as Record<string, unknown>);
  }

  // ---------------------------------------------------------------------------
  // Subagent events (stateful -- create then update)
  // ---------------------------------------------------------------------------

  async createSubagent(
    sessionId: string,
    params: {
      subagentId: string;
      agentType: string;
      teammateName?: string | null;
      teamName?: string | null;
      teammateMode?: string | null;
      model?: string | null;
      color?: string | null;
      isBackground?: boolean;
      prompt: string;
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    const payload: SubagentPayload = {
      agentType: params.agentType,
      status: 'running',
      teammateName: params.teammateName ?? null,
      teamName: params.teamName ?? null,
      teammateMode: params.teammateMode ?? null,
      model: params.model ?? null,
      color: params.color ?? null,
      isBackground: params.isBackground ?? false,
      prompt: params.prompt,
    };

    return this.insertEvent(sessionId, {
      eventType: 'subagent',
      searchableText: null,
      searchable: false,
      payload: payload as unknown as Record<string, unknown>,
      subagentId: params.subagentId,
      createdAt: params.createdAt,
    });
  }

  async updateSubagent(
    eventId: number,
    update: {
      status: 'completed';
      resultSummary?: string;
      toolCallCount?: number;
      durationMs?: number;
    },
  ): Promise<void> {
    const existing = await this.store.getEventById(eventId);
    if (!existing) {
      throw new Error(`TranscriptWriter: event ${eventId} not found`);
    }
    await this.store.mergeEventPayload(eventId, update as unknown as Record<string, unknown>);
  }

  // ---------------------------------------------------------------------------
  // Turn boundary
  // ---------------------------------------------------------------------------

  async recordTurnEnded(
    sessionId: string,
    params: {
      contextFill: TurnEndedPayload['contextFill'];
      contextWindow: number;
      cumulativeUsage: TurnEndedPayload['cumulativeUsage'];
      contextCompacted?: boolean;
      subagentId?: string | null;
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    const payload: TurnEndedPayload = {
      contextFill: params.contextFill,
      contextWindow: params.contextWindow,
      cumulativeUsage: params.cumulativeUsage,
      contextCompacted: params.contextCompacted ?? false,
    };

    return this.insertEvent(sessionId, {
      eventType: 'turn_ended',
      searchableText: null,
      searchable: false,
      payload: payload as unknown as Record<string, unknown>,
      subagentId: params.subagentId ?? null,
      createdAt: params.createdAt,
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async insertEvent(
    sessionId: string,
    fields: {
      eventType: TranscriptEventType;
      searchableText: string | null;
      searchable: boolean;
      payload: Record<string, unknown>;
      parentEventId?: number | null;
      providerToolCallId?: string | null;
      subagentId?: string | null;
      createdAt?: Date;
    },
  ): Promise<TranscriptEvent> {
    // When seeded (bulk transform), use in-memory counter to avoid N round-trips.
    // Otherwise query DB for safe concurrent writes.
    let sequence: number;
    if (this.seededSequence != null) {
      sequence = this.seededSequence++;
    } else {
      sequence = await this.store.getNextSequence(sessionId);
    }

    return this.store.insertEvent({
      sessionId,
      sequence,
      createdAt: fields.createdAt ?? new Date(),
      eventType: fields.eventType,
      searchableText: fields.searchableText,
      searchable: fields.searchable,
      payload: fields.payload,
      parentEventId: fields.parentEventId ?? null,
      subagentId: fields.subagentId ?? null,
      provider: this.provider,
      providerToolCallId: fields.providerToolCallId ?? null,
    });
  }
}
