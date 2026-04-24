/**
 * Canonical Transcript Event Types
 *
 * Defines the product-facing canonical transcript contract.
 * The ai_transcript_events table stores these typed events,
 * while ai_agent_messages remains the raw source log.
 */

// ---------------------------------------------------------------------------
// Event type discriminator
// ---------------------------------------------------------------------------

export type TranscriptEventType =
  | 'user_message'
  | 'assistant_message'
  | 'system_message'
  | 'tool_call'
  | 'tool_progress'
  | 'interactive_prompt'
  | 'subagent'
  | 'turn_ended';

// ---------------------------------------------------------------------------
// Per-event payload interfaces
// ---------------------------------------------------------------------------

export interface UserMessagePayload {
  mode: 'agent' | 'planning';
  inputType: 'user' | 'system_message';
  attachments?: Array<{
    id: string;
    filename: string;
    filepath: string;
    mimeType: string;
    size: number;
    type: string;
  }>;
}

export interface AssistantMessagePayload {
  mode: 'agent' | 'planning';
}

export interface SystemMessagePayload {
  systemType: 'status' | 'slash_command' | 'error' | 'init';
  statusCode?: string;
  /** Marks an authentication failure so the UI can render the login widget. */
  isAuthError?: boolean;
}

export interface ToolCallPayload {
  toolName: string;
  toolDisplayName: string;
  status: 'running' | 'completed' | 'error';
  description: string | null;
  arguments: Record<string, unknown>;
  targetFilePath: string | null;
  mcpServer: string | null;
  mcpTool: string | null;
  result?: string;
  isError?: boolean;
  exitCode?: number;
  durationMs?: number;
  changes?: Array<{ path: string; patch: string }>;
}

export interface ToolProgressPayload {
  toolName: string;
  elapsedSeconds: number;
  progressContent: string;
}

// Interactive prompt payloads (discriminated union on promptType)

export interface PermissionRequestPayload {
  promptType: 'permission_request';
  requestId: string;
  status: 'pending' | 'resolved' | 'cancelled';
  toolName: string;
  rawCommand: string;
  pattern: string;
  patternDisplayName: string;
  isDestructive: boolean;
  warnings: string[];
  decision?: 'allow' | 'deny';
  scope?: 'once' | 'session' | 'always' | 'always-all';
  respondedBy?: 'desktop' | 'mobile';
}

export interface AskUserQuestionPayload {
  promptType: 'ask_user_question';
  requestId: string;
  status: 'pending' | 'resolved' | 'cancelled';
  questions: Array<{
    question: string;
    header: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  answers?: Record<string, string>;
  cancelled?: boolean;
  respondedBy?: 'desktop' | 'mobile';
}

export interface GitCommitProposalPayload {
  promptType: 'git_commit_proposal';
  requestId: string;
  status: 'pending' | 'resolved' | 'cancelled';
  commitMessage: string;
  stagedFiles: string[];
  decision?: 'committed' | 'cancelled';
  commitSha?: string;
  respondedBy?: 'desktop' | 'mobile';
}

export type InteractivePromptPayload =
  | PermissionRequestPayload
  | AskUserQuestionPayload
  | GitCommitProposalPayload;

export interface SubagentPayload {
  agentType: string;
  status: 'running' | 'completed';
  teammateName: string | null;
  teamName: string | null;
  teammateMode: string | null;
  model: string | null;
  color: string | null;
  isBackground: boolean;
  prompt: string;
  resultSummary?: string;
  toolCallCount?: number;
  durationMs?: number;
}

export interface TurnEndedPayload {
  contextFill: {
    inputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    outputTokens: number;
    totalContextTokens: number;
  };
  contextWindow: number;
  cumulativeUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
    webSearchRequests: number;
  };
  contextCompacted: boolean;
}

// ---------------------------------------------------------------------------
// Payload type map (event type -> payload interface)
// ---------------------------------------------------------------------------

export interface TranscriptPayloadMap {
  user_message: UserMessagePayload;
  assistant_message: AssistantMessagePayload;
  system_message: SystemMessagePayload;
  tool_call: ToolCallPayload;
  tool_progress: ToolProgressPayload;
  interactive_prompt: InteractivePromptPayload;
  subagent: SubagentPayload;
  turn_ended: TurnEndedPayload;
}

// ---------------------------------------------------------------------------
// Base transcript event
// ---------------------------------------------------------------------------

export interface TranscriptEvent {
  id: number;
  sessionId: string;
  sequence: number;
  createdAt: Date;
  eventType: TranscriptEventType;
  searchableText: string | null;
  payload: Record<string, unknown>;
  parentEventId: number | null;
  searchable: boolean;
  subagentId: string | null;
  provider: string;
  providerToolCallId: string | null;
}

// ---------------------------------------------------------------------------
// Typed transcript events (type-safe payload access)
// ---------------------------------------------------------------------------

export type TypedTranscriptEvent<T extends TranscriptEventType> = Omit<TranscriptEvent, 'eventType' | 'payload'> & {
  eventType: T;
  payload: TranscriptPayloadMap[T];
};

export type UserMessageEvent = TypedTranscriptEvent<'user_message'>;
export type AssistantMessageEvent = TypedTranscriptEvent<'assistant_message'>;
export type SystemMessageEvent = TypedTranscriptEvent<'system_message'>;
export type ToolCallEvent = TypedTranscriptEvent<'tool_call'>;
export type ToolProgressEvent = TypedTranscriptEvent<'tool_progress'>;
export type InteractivePromptEvent = TypedTranscriptEvent<'interactive_prompt'>;
export type SubagentEvent = TypedTranscriptEvent<'subagent'>;
export type TurnEndedEvent = TypedTranscriptEvent<'turn_ended'>;

// ---------------------------------------------------------------------------
// Store interface (abstraction over concrete storage implementations)
// ---------------------------------------------------------------------------

export interface ITranscriptEventStore {
  insertEvent(event: Omit<TranscriptEvent, 'id'>): Promise<TranscriptEvent>;
  updateEventPayload(id: number, payload: Record<string, unknown>): Promise<void>;
  /** Merge partial payload fields into an existing event's payload via JSONB || operator */
  mergeEventPayload(id: number, partialPayload: Record<string, unknown>): Promise<void>;
  getSessionEvents(
    sessionId: string,
    options?: { eventTypes?: TranscriptEventType[]; limit?: number; offset?: number; createdAfter?: Date; createdBefore?: Date },
  ): Promise<TranscriptEvent[]>;
  getNextSequence(sessionId: string): Promise<number>;
  findByProviderToolCallId(
    providerToolCallId: string,
    sessionId: string,
  ): Promise<TranscriptEvent | null>;
  getEventById(id: number): Promise<TranscriptEvent | null>;
  getChildEvents(parentEventId: number): Promise<TranscriptEvent[]>;
  getSubagentEvents(subagentId: string, sessionId: string): Promise<TranscriptEvent[]>;
  getMultiSessionEvents(
    sessionIds: string[],
    options?: { eventTypes?: TranscriptEventType[]; createdAfter?: Date; createdBefore?: Date },
  ): Promise<TranscriptEvent[]>;
  searchSessions(
    query: string,
    options?: { sessionIds?: string[]; limit?: number },
  ): Promise<Array<{ event: TranscriptEvent; sessionId: string }>>;
  getTailEvents(
    sessionId: string,
    count: number,
    options?: { excludeEventTypes?: TranscriptEventType[] },
  ): Promise<TranscriptEvent[]>;
  deleteSessionEvents(sessionId: string): Promise<void>;
}
