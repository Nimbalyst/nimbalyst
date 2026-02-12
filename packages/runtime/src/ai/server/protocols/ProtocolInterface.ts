/**
 * Protocol Interface for Agent SDK Adapters
 *
 * This interface normalizes the differences between various agent SDKs
 * (Claude Agent SDK, OpenAI Codex SDK) to provide a unified abstraction
 * layer for agent providers.
 *
 * The protocol adapters isolate platform-specific SDK details from the
 * provider implementations, making it easier to:
 * - Add new agent SDKs
 * - Update SDK versions without touching provider logic
 * - Test providers with mock protocols
 * - Share common infrastructure across providers
 */

import type { ChatAttachment } from '../types';

/**
 * Options for creating or resuming a session
 */
export interface SessionOptions {
  /** Working directory path for the session */
  workspacePath: string;

  /** Model identifier (e.g., 'sonnet', 'gpt-5') */
  model?: string;

  /** System prompt to initialize the agent */
  systemPrompt?: string;

  /** Abort signal for cancelling the session */
  abortSignal?: AbortSignal;

  /** Permission mode for tool approvals ('ask', 'auto', 'plan') */
  permissionMode?: string;

  /** MCP server configurations */
  mcpServers?: Record<string, any>;

  /** Environment variables for the session */
  env?: Record<string, string>;

  /** Tools to allow (whitelist) */
  allowedTools?: string[];

  /** Tools to disallow (blacklist) */
  disallowedTools?: string[];

  /** Platform-specific options that don't fit the common schema */
  raw?: Record<string, any>;
}

/**
 * Message sent to the agent
 */
export interface ProtocolMessage {
  /** Text content of the message */
  content: string;

  /** Optional attachments (images, PDFs, documents) */
  attachments?: ChatAttachment[];

  /** Session ID for logging and tracking */
  sessionId?: string;

  /** AI mode when message was sent ('planning' or 'agent') */
  mode?: 'planning' | 'agent';
}

/**
 * Session created or resumed by the protocol
 */
export interface ProtocolSession {
  /** Platform-specific session identifier */
  id: string;

  /** Platform identifier (e.g., 'claude-sdk', 'codex-sdk') */
  platform: string;

  /** Platform-specific session data (for internal use) */
  raw?: any;
}

/**
 * Event types emitted during message streaming
 */
export type ProtocolEventType =
  | 'text'                    // Text content chunk
  | 'reasoning'               // Thinking/reasoning content (not part of final output)
  | 'tool_call'               // Tool invocation
  | 'tool_result'             // Tool execution result
  | 'error'                   // Error occurred
  | 'complete'                // Stream complete
  | 'usage'                   // Token usage stats
  | 'planning_mode_entered'   // Agent entered planning mode
  | 'planning_mode_exited';   // Agent exited planning mode

/**
 * Event emitted during message streaming
 */
export interface ProtocolEvent {
  /** Event type */
  type: ProtocolEventType;

  /** Text content (for 'text' events) */
  content?: string;

  /** Tool call data (for 'tool_call' events) */
  toolCall?: {
    id?: string;
    name: string;
    arguments?: any;
    result?: any;
  };

  /** Tool result data (for 'tool_result' events) */
  toolResult?: {
    id?: string;
    name: string;
    result?: any;
  };

  /** Error message (for 'error' events) */
  error?: string;

  /** Token usage (for 'usage' or 'complete' events) */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Agent Protocol Interface
 *
 * All agent SDK adapters must implement this interface to provide
 * a consistent abstraction layer for agent providers.
 */
export interface AgentProtocol {
  /**
   * Platform identifier (e.g., 'claude-sdk', 'codex-sdk')
   */
  readonly platform: string;

  /**
   * Create a new session
   *
   * @param options - Session configuration
   * @returns Protocol session with platform-specific ID
   */
  createSession(options: SessionOptions): Promise<ProtocolSession>;

  /**
   * Resume an existing session
   *
   * @param sessionId - Platform-specific session ID to resume
   * @param options - Session configuration
   * @returns Protocol session
   */
  resumeSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession>;

  /**
   * Fork an existing session (create a branch)
   *
   * Not all platforms support forking. If unsupported, implementations
   * should either throw an error or create a new session.
   *
   * @param sessionId - Platform-specific session ID to fork from
   * @param options - Session configuration for the fork
   * @returns New protocol session branched from the source
   */
  forkSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession>;

  /**
   * Send a message and receive streaming events
   *
   * @param session - Active protocol session
   * @param message - Message to send
   * @returns Async iterable of protocol events
   */
  sendMessage(
    session: ProtocolSession,
    message: ProtocolMessage
  ): AsyncIterable<ProtocolEvent>;

  /**
   * Abort an active session
   *
   * @param session - Session to abort
   */
  abortSession(session: ProtocolSession): void;

  /**
   * Clean up session resources
   *
   * Called when a session is deleted or no longer needed.
   *
   * @param session - Session to clean up
   */
  cleanupSession(session: ProtocolSession): void;
}
