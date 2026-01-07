/**
 * Common types for AI provider abstraction
 */

import type { ToolDefinition } from '../tools';
export type { ToolDefinition } from '../tools';

export interface DocumentContext {
  filePath?: string;
  fileType?: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?:
    | string
    | {
        text: string;
        filePath: string;
        timestamp: number;
      }
    | {
        start: { line: number; column: number };
        end: { line: number; column: number };
      };
  textSelection?: {
    text: string;
    filePath: string;
    timestamp: number;
  };
  textSelectionTimestamp?: number | null;
}

export interface ChatAttachment {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  type: 'image' | 'pdf' | 'document';
  thumbnail?: string;
  addedAt: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp: number;
  // Additional fields for rich message types
  edits?: any[];
  toolCall?: {
    id?: string;
    name: string;
    arguments?: any;
    result?: any;
    targetFilePath?: string;  // File path this tool call was executed against
    // Sub-agent specific fields
    isSubAgent?: boolean;           // true for Task tools
    subAgentType?: string;          // e.g., "Explore", "bug-fixer", etc.
    parentToolId?: string;          // ID of parent Task tool
    childToolCalls?: Message[];     // Nested tools executed by sub-agent
  };
  isError?: boolean;
  isAuthError?: boolean; // True when error is an authentication failure (SDK first-class detection)
  errorMessage?: string;
  isSystem?: boolean; // For system messages like slash command output
  isStreamingStatus?: boolean;
  streamingData?: {
    position: string;
    mode: string;
    content: string;
    isActive: boolean;
  };
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  attachments?: ChatAttachment[];
}

export type AIProviderType = 'claude' | 'claude-code' | 'openai' | 'openai-codex' | 'lmstudio';

export interface AIModel {
  id: string;           // e.g., 'gpt-4', 'claude-3-5-sonnet-20241022'
  name: string;         // e.g., 'GPT-4', 'Claude 3.5 Sonnet'
  provider: AIProviderType;
  maxTokens?: number;
  contextWindow?: number;
}

export type SessionType = 'chat' | 'planning' | 'coding' | 'terminal';

export type SessionMode = 'planning' | 'agent';

export interface QueuedPrompt {
  id: string;           // Unique ID for this queued item
  prompt: string;       // The user's message
  timestamp: number;    // When queued
  documentContext?: DocumentContext; // Optional document context at queue time
  attachments?: ChatAttachment[]; // Optional attachments
}

export interface TokenUsageCategory {
  name: string;
  tokens: number;
  percentage: number;
}

export interface SessionData {
  id: string;  // Our session ID
  provider: AIProviderType | string;  // Provider type
  model?: string;  // Specific model used (e.g., 'gpt-4', 'claude-3-5-sonnet')
  sessionType?: SessionType;  // Type of session: 'chat', 'planning', 'coding' (deprecated, use mode instead)
  mode?: SessionMode;  // Session behavior mode: 'planning' | 'agent'
  messages: Message[];
  documentContext?: DocumentContext;
  workspacePath?: string;
  name?: string;
  title?: string;
  draftInput?: string;

  // Time tracking
  createdAt: number;  // Creation timestamp
  updatedAt: number;  // Last update timestamp

  // Read state tracking
  lastReadMessageTimestamp?: number;  // Timestamp of the last message the user has read

  // Session naming tracking
  hasBeenNamed?: boolean;  // Whether the session has been named by name_session tool

  // Archive state
  isArchived?: boolean;  // Whether the session is archived

  // Token usage tracking (for providers that support it)
  tokenUsage?: {
    inputTokens: number;      // Cumulative input tokens across session lifetime
    outputTokens: number;     // Cumulative output tokens across session lifetime
    totalTokens: number;      // Total tokens (input + output)
    contextWindow?: number;   // Max context window size for the model (legacy, use currentContext)
    categories?: TokenUsageCategory[]; // Breakdown parsed from /context output (legacy, use currentContext)
    costUSD?: number;         // Total cost in USD (from SDK modelUsage)
    webSearchRequests?: number; // Number of web searches performed (from SDK modelUsage)
    // Current context window snapshot (from /context command for Claude Code)
    // This is separate from cumulative tokens - resets on compaction
    currentContext?: {
      tokens: number;         // Current tokens in context window
      contextWindow: number;  // Max context window size
      categories?: TokenUsageCategory[]; // Category breakdown from /context
      rawResponse?: string;   // Raw markdown from /context for display on session reload
    };
  };

  // Additional metadata
  metadata?: Record<string, unknown>;

  // Provider-specific data
  providerSessionId?: string;  // For Claude Code's internal session ID
  providerConfig?: {
    model?: string;
    apiKey?: string;  // If using per-session keys
  };
}

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
  allowedTools?: string[];  // List of allowed tool names, ['*'] for all tools
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  mcpSupport: boolean;
  edits: boolean;
  resumeSession: boolean;
  /**
   * If true, this provider uses tools to read files when @ referenced
   * If false, files are automatically attached as context to the message
   * Agent models (Claude Code) should set this to true
   * Non-agent models (Claude, OpenAI, LM Studio) should set this to false
   */
  supportsFileTools: boolean;
}

export interface ProviderSettings {
  enabled: boolean;
  apiKey?: string;
  models?: string[];  // List of enabled model IDs for this provider
  defaultModel?: string;
  baseUrl?: string;  // For custom endpoints
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_error' | 'error' | 'complete' | 'stream_edit_start' | 'stream_edit_content' | 'stream_edit_end';
  content?: string;
  isSystem?: boolean; // For system messages like slash command output
  toolCall?: {
    id?: string;
    name: string;
    arguments?: any;
    result?: any;
  };
  toolError?: {
    name: string;
    arguments?: any;
    error: string;
    result?: any;
  };
  error?: string;
  isAuthError?: boolean; // True when error is an authentication failure (SDK first-class detection)
  isComplete?: boolean;
  config?: any; // For stream_edit_start
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  // Per-model usage breakdown from SDK (available on 'complete' chunks from claude-code)
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUSD?: number;
    contextWindow?: number;
    webSearchRequests?: number;
  }>;
}

export interface DiffArgs {
  replacements: Array<{
    oldText: string;
    newText: string;
  }>;
}

export interface DiffResult {
  success: boolean;
  error?: string;
  appliedCount?: number;
}

export interface ToolHandler {
  // All methods are optional - handlers can implement any subset
  applyDiff?(args: DiffArgs): Promise<DiffResult>;
  // Stream content tool for real-time streaming
  streamContent?(args: any): Promise<any>;
  // File search tool
  searchFiles?(args: any): Promise<any>;
  // List files tool
  listFiles?(args: any): Promise<any>;
  // Read file tool
  readFile?(args: any): Promise<any>;
  // Write file tool
  writeFile?(args: any): Promise<any>;
  // Get document content
  getDocumentContent?(args: any): Promise<any>;
  // Update frontmatter
  updateFrontmatter?(args: any): Promise<any>;
  // Dynamic tool execution - for any other tool
  // Note: executeTool has different signature (name, args) so we handle it separately
  executeTool?(name: string, args: any): Promise<any>;
  // Dynamic property access for other tools
  [key: string]: ((args: any) => Promise<any>) | ((name: string, args: any) => Promise<any>) | undefined;
}

/**
 * File link types for tracking file interactions in AI sessions
 */
export type FileLinkType = 'edited' | 'referenced' | 'read';

/**
 * File link metadata structures for each link type
 */
export interface EditedFileMetadata {
  operation?: 'edit' | 'create' | 'delete' | 'rename';
  linesAdded?: number;
  linesRemoved?: number;
  toolName?: string;
}

export interface ReferencedFileMetadata {
  mentionContext?: string;
  messageIndex?: number;
}

export interface ReadFileMetadata {
  toolName?: string;
  bytesRead?: number;
  wasPartial?: boolean;
}

/**
 * Link between a file and an AI session
 */
export interface FileLink {
  id: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  linkType: FileLinkType;
  timestamp: number;
  metadata?: EditedFileMetadata | ReferencedFileMetadata | ReadFileMetadata | Record<string, unknown>;
}

/**
 * Direction of an AI agent message
 */
export type AgentMessageDirection = 'input' | 'output';

/**
 * Raw AI agent message record
 * Write-only audit log for AI interactions
 */
export interface AgentMessage {
  id?: number;  // Auto-generated by database
  sessionId: string;
  createdAt?: Date;  // Auto-set by database
  source: string;  // AI provider (e.g., 'claude-code', 'claude', 'openai')
  direction: AgentMessageDirection;  // 'input' (user/system to AI) or 'output' (AI response)
  content: string;  // Raw message content
  metadata?: Record<string, unknown>;  // Optional provider-specific metadata
  hidden?: boolean;  // Whether to hide this message from UI (e.g., /context commands)
  providerMessageId?: string;  // Provider-assigned message ID (e.g., SDK uuid) for deduplication
}

/**
 * Input type for creating an agent message
 */
export interface CreateAgentMessageInput {
  sessionId: string;
  source: string;
  direction: AgentMessageDirection;
  content: string;
  metadata?: Record<string, unknown>;
  hidden?: boolean;  // Whether to hide this message from UI (e.g., /context commands)
  createdAt?: Date | string;  // Optional timestamp for imported messages (defaults to NOW())
  providerMessageId?: string;  // Provider-assigned message ID (e.g., SDK uuid) for deduplication
}

// ============================================================================
// Interactive Prompt Message Types
// These message types support mobile-compatible permission and question flows.
// Requests are persisted as messages, allowing any device to render the UI and respond.
// Responses are also persisted, allowing the provider to poll for completion.
// ============================================================================

/**
 * Status of an interactive prompt (permission request or user question)
 */
export type InteractivePromptStatus = 'pending' | 'resolved' | 'cancelled';

/**
 * Permission request message - persisted when SDK needs tool approval
 */
export interface PermissionRequestContent {
  type: 'permission_request';
  requestId: string;
  toolName: string;
  rawCommand: string;           // The command/tool description shown to user
  pattern: string;              // Pattern for "Allow Session/Always" (e.g., 'Bash(git commit:*)')
  patternDisplayName: string;   // Human-readable pattern description
  isDestructive: boolean;
  warnings: string[];
  timestamp: number;
  status: InteractivePromptStatus;
}

/**
 * Permission response message - created when user responds to a permission request
 */
export interface PermissionResponseContent {
  type: 'permission_response';
  requestId: string;            // Links to the permission_request
  decision: 'allow' | 'deny';
  scope: 'once' | 'session' | 'always' | 'always-all';
  respondedAt: number;
  respondedBy: 'desktop' | 'mobile';
}

/**
 * AskUserQuestion request message - persisted when Claude needs user input
 */
export interface AskUserQuestionRequestContent {
  type: 'ask_user_question_request';
  questionId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  timestamp: number;
  status: InteractivePromptStatus;
}

/**
 * AskUserQuestion response message - created when user answers questions
 */
export interface AskUserQuestionResponseContent {
  type: 'ask_user_question_response';
  questionId: string;           // Links to the ask_user_question_request
  answers: Record<string, string>;
  cancelled?: boolean;          // True if user cancelled instead of answering
  respondedAt: number;
  respondedBy: 'desktop' | 'mobile';
}

/**
 * Union type for all interactive prompt content types
 */
export type InteractivePromptContent =
  | PermissionRequestContent
  | PermissionResponseContent
  | AskUserQuestionRequestContent
  | AskUserQuestionResponseContent;

/**
 * Type guard to check if content is an interactive prompt
 */
export function isInteractivePromptContent(content: unknown): content is InteractivePromptContent {
  if (typeof content !== 'object' || content === null) return false;
  const type = (content as { type?: string }).type;
  return type === 'permission_request' ||
         type === 'permission_response' ||
         type === 'ask_user_question_request' ||
         type === 'ask_user_question_response';
}

/**
 * Type guard to check if content is a pending permission request
 */
export function isPendingPermissionRequest(content: unknown): content is PermissionRequestContent {
  if (typeof content !== 'object' || content === null) return false;
  const c = content as { type?: string; status?: string };
  return c.type === 'permission_request' && c.status === 'pending';
}

/**
 * Type guard to check if content is a pending AskUserQuestion request
 */
export function isPendingAskUserQuestion(content: unknown): content is AskUserQuestionRequestContent {
  if (typeof content !== 'object' || content === null) return false;
  const c = content as { type?: string; status?: string };
  return c.type === 'ask_user_question_request' && c.status === 'pending';
}

/**
 * Helper to parse message content as interactive prompt content
 * Returns undefined if content is not valid JSON or not an interactive prompt
 */
export function parseInteractivePromptContent(content: string): InteractivePromptContent | undefined {
  try {
    const parsed = JSON.parse(content);
    if (isInteractivePromptContent(parsed)) {
      return parsed;
    }
  } catch {
    // Not valid JSON or not an interactive prompt
  }
  return undefined;
}

/**
 * Check if a list of messages contains any pending interactive prompts.
 * Used to show "waiting for response" indicator in session lists.
 */
export function hasPendingInteractivePrompts(messages: Array<{ content: string }>): boolean {
  for (const msg of messages) {
    try {
      const content = JSON.parse(msg.content);
      if ((content.type === 'permission_request' || content.type === 'ask_user_question_request') &&
          content.status === 'pending') {
        // Check if there's a corresponding response
        const requestId = content.requestId || content.questionId;
        const responseType = content.type === 'permission_request' ? 'permission_response' : 'ask_user_question_response';

        // Look for a response with matching requestId/questionId
        const hasResponse = messages.some(m => {
          try {
            const c = JSON.parse(m.content);
            return c.type === responseType && (c.requestId === requestId || c.questionId === requestId);
          } catch {
            return false;
          }
        });

        if (!hasResponse) {
          return true; // Found a pending prompt without a response
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }
  return false;
}

/**
 * Get a human-readable display name for a tool permission pattern.
 * Used both when persisting permission requests and in the UI.
 */
export function getPatternDisplayName(pattern: string): string {
  // Handle compound commands - these get unique patterns and shouldn't be cached
  if (pattern.startsWith('Bash:compound:')) {
    return 'this compound command (one-time only)';
  }

  // Handle Bash patterns like 'Bash(git commit:*)' or 'Bash(npm run:*)'
  const bashMatch = pattern.match(/^Bash\(([^:]+):\*\)$/);
  if (bashMatch) {
    return `${bashMatch[1]} commands`;
  }

  // Handle tool patterns like 'WebFetch(https://docs.anthropic.com:*)'
  const toolMatch = pattern.match(/^(\w+)\(([^:]+):\*\)$/);
  if (toolMatch) {
    const [, toolName, target] = toolMatch;
    if (toolName === 'WebFetch') {
      try {
        const url = new URL(target);
        return `Fetch from ${url.hostname}`;
      } catch {
        return `Fetch from ${target}`;
      }
    }
    return `${toolName}: ${target}`;
  }

  // Handle wildcard patterns like 'WebFetch' (all WebFetch calls)
  if (pattern === 'WebFetch') {
    return 'all web fetches';
  }

  // Handle simple Bash patterns like 'Bash(ls:*)'
  const simpleBashMatch = pattern.match(/^Bash\((\w+):\*\)$/);
  if (simpleBashMatch) {
    return `${simpleBashMatch[1]} commands`;
  }

  // Default: return the pattern as-is
  return pattern;
}
