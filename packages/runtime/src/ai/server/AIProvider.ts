/**
 * Abstract interface for AI providers
 */

import { EventEmitter } from 'events';
import {
  DocumentContext,
  ProviderConfig,
  ProviderCapabilities,
  StreamChunk,
  ToolHandler,
  ToolDefinition,
  Message,
} from './types';
import { toolRegistry, toAnthropicTools, toOpenAITools } from '../tools';
import { buildSystemPrompt } from '../prompt';
import { AgentMessagesRepository } from '../../storage/repositories/AgentMessagesRepository';

/**
 * Interface for providers that support the AskUserQuestion tool
 * Currently only ClaudeCodeProvider implements this
 */
export interface AskUserQuestionProvider {
  /**
   * Resolve a pending AskUserQuestion request with user's answers
   * @returns true if the question was found and resolved, false if not found
   */
  resolveAskUserQuestion(
    questionId: string,
    answers: Record<string, string>,
    sessionId?: string,
    respondedBy?: 'desktop' | 'mobile'
  ): boolean;

  /**
   * Reject a pending AskUserQuestion request (e.g., on cancel/abort)
   */
  rejectAskUserQuestion(questionId: string, error: Error): void;
}

/**
 * Type guard to check if a provider supports AskUserQuestion
 */
export function isAskUserQuestionProvider(provider: AIProvider): provider is AIProvider & AskUserQuestionProvider {
  return typeof (provider as any).resolveAskUserQuestion === 'function';
}

export interface AIProvider extends EventEmitter {
  /**
   * Initialize the provider with configuration
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Send a message to the AI provider
   * Returns an async iterator for streaming responses
   */
  sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[],
    workspacePath?: string,
    attachments?: any[]
  ): AsyncIterableIterator<StreamChunk>;

  /**
   * Abort any ongoing request
   */
  abort(): void;

  /**
   * Get the capabilities of this provider
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * Register a tool handler for executing tools
   */
  registerToolHandler(handler: ToolHandler): void;

  /**
   * Set provider-specific session data (e.g., Claude Code session ID)
   */
  setProviderSessionData?(sessionId: string, data: any): void;

  /**
   * Get provider-specific session data
   */
  getProviderSessionData?(sessionId: string): any;

  /**
   * Set hidden mode for next message logging (Claude Code only)
   * When true, the next sendMessage call will mark logged messages as hidden
   */
  setHiddenMode?(enabled: boolean): void;

  /**
   * Clean up resources
   */
  destroy(): void;
}

/**
 * Base class with common functionality for AI providers
 */
export abstract class BaseAIProvider extends EventEmitter implements AIProvider {
  protected toolHandler: ToolHandler | null = null;
  protected config: ProviderConfig = {};
  protected correlationId: string | null = null;

  /**
   * Set of in-flight non-blocking write promises.
   * Each logAgentMessageNonBlocking call adds its promise here;
   * the promise self-removes on settle. flushPendingWrites() awaits them all
   * so callers (e.g. the completion path) can ensure DB consistency.
   */
  private pendingWritePromises = new Set<Promise<void>>();

  abstract initialize(config: ProviderConfig): Promise<void>;
  abstract sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[],
    workspacePath?: string,
    attachments?: any[]
  ): AsyncIterableIterator<StreamChunk>;
  abstract abort(): void;
  abstract getCapabilities(): ProviderCapabilities;

  registerToolHandler(handler: ToolHandler): void {
    this.toolHandler = handler;
  }

  /**
   * Get all registered tools from the centralized registry
   */
  protected getRegisteredTools(): ToolDefinition[] {
    return toolRegistry.getAll();
  }

  /**
   * Convert tools to Anthropic format
   */
  protected getToolsInAnthropicFormat(): any[] {
    return toAnthropicTools(this.getRegisteredTools());
  }

  /**
   * Convert tools to OpenAI format
   */
  protected getToolsInOpenAIFormat(): any[] {
    return toOpenAITools(this.getRegisteredTools());
  }

  /**
   * Generate a correlation ID for request tracking
   */
  protected generateCorrelationId(): string {
    this.correlationId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return this.correlationId;
  }

  destroy(): void {
    this.removeAllListeners();
  }

  protected async executeToolCall(name: string, args: any): Promise<any> {
    // Generate correlation ID for tracking
    const correlationId = `tool-${name}-${Date.now()}`;
    this.emit('tool:start', { correlationId, name, args });

    try {
      if (!this.toolHandler) {
        throw new Error('No tool handler registered');
      }

      let result;

      // Check if tool exists in registry
      if (toolRegistry.has(name)) {
        // Use the centralized tool executor
        if (this.toolHandler.executeTool) {
          result = await this.toolHandler.executeTool(name, args);
        } else {
          // Fallback to built-in handlers
          switch (name) {
            case 'applyDiff':
              if (this.toolHandler.applyDiff) {
                result = await this.toolHandler.applyDiff(args);
              } else {
                throw new Error('applyDiff not implemented in handler');
              }
              break;
            default:
              throw new Error(`Tool ${name} not implemented in handler`);
          }
        }
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }

      this.emit('tool:complete', { correlationId, name, result });
      return result;
    } catch (error) {
      this.emit('tool:error', { correlationId, name, error });
      throw error;
    }
  }

  /**
   * Build the base system prompt with shared context
   * Providers should call this and append their specific instructions
   */
  protected buildSystemPrompt(documentContext?: DocumentContext): string {
    // Extract transition info from document context if present
    const documentTransition = (documentContext as any)?.documentTransition;
    const documentDiff = (documentContext as any)?.documentDiff;

    // Use the new options format to pass transition/diff info
    return buildSystemPrompt({
      documentContext,
      documentTransition,
      documentDiff,
    });
  }

  /**
   * Log an agent message to the audit table
   * This should be called for both input (user/system to AI) and output (AI response) messages
   *
   * IMPORTANT: This method MUST be awaited for critical messages (user input and final output)
   * to ensure they are persisted before continuing. Fire-and-forget usage can cause message loss.
   *
   * Returns a Promise that resolves when the message is saved.
   * Emits 'message:logged' event after successful write to trigger UI updates.
   *
   * @throws Error if the database write fails - callers must handle this appropriately
   */
  protected async logAgentMessage(
    sessionId: string,
    source: string, // Provider name (e.g., 'claude', 'claude-code', 'openai')
    direction: 'input' | 'output',
    content: string,
    metadata?: Record<string, unknown>,
    hidden?: boolean,
    providerMessageId?: string,  // Provider-assigned message ID (e.g., SDK uuid) for deduplication
    searchable?: boolean  // Whether to include in FTS index (user prompts and assistant text only)
  ): Promise<void> {
    // Create timestamp HERE - this is the authoritative source
    // This same timestamp must be used for message.created_at, session.updated_at, and sync index
    const createdAt = new Date();

    // Only allow searchable for content under 500KB to avoid tsvector 1MB limit
    const isSearchable = searchable && content.length < 500000;

    try {
      await AgentMessagesRepository.create({
        sessionId,
        source,
        direction,
        content,
        metadata,
        hidden,
        createdAt,
        providerMessageId,
        searchable: isSearchable,
      });
      // Emit event to notify listeners that new message was written to database
      // Include hidden flag so sync handlers can skip hidden messages
      this.emit('message:logged', { sessionId, direction, hidden: hidden ?? false });
    } catch (error) {
      // Log error details for debugging but re-throw to let callers handle appropriately
      console.error('[BaseAIProvider] Failed to log agent message:', error);
      console.error('[BaseAIProvider] Failed message details:', { sessionId, source, direction, contentLength: content.length });
      throw error;
    }
  }

  /**
   * Log an agent message without blocking execution.
   * Use this ONLY for streaming chunks where some loss is acceptable.
   * NEVER use this for user input messages or final output messages.
   *
   * The write promise is tracked so flushPendingWrites() can await all
   * outstanding writes before session completion, preventing race conditions
   * where the UI reloads before the DB has committed the final messages.
   *
   * Errors are logged but not propagated.
   */
  protected logAgentMessageNonBlocking(
    sessionId: string,
    source: string,
    direction: 'input' | 'output',
    content: string,
    metadata?: Record<string, unknown>,
    hidden?: boolean,
    providerMessageId?: string,
    searchable?: boolean
  ): void {
    const writePromise = this.logAgentMessage(sessionId, source, direction, content, metadata, hidden, providerMessageId, searchable)
      .catch(error => {
        // For non-blocking calls, we've already logged the error in logAgentMessage
        // Just suppress the unhandled rejection
      })
      .finally(() => {
        this.pendingWritePromises.delete(writePromise);
      });
    this.pendingWritePromises.add(writePromise);
  }

  /**
   * Await all in-flight non-blocking message writes.
   * Call this before yielding the completion event to ensure all messages
   * are committed to the database before the UI reloads.
   */
  protected async flushPendingWrites(): Promise<void> {
    if (this.pendingWritePromises.size === 0) return;
    await Promise.all(this.pendingWritePromises);
  }

  /**
   * Log an error to the database (non-blocking)
   * Helper method to reduce duplication across provider implementations
   * @param hidden - If true, marks the error message as hidden (won't appear in UI)
   */
  protected logError(
    sessionId: string | undefined,
    providerName: string,
    error: Error,
    source: string,
    errorType: string = 'api_error',
    hidden: boolean = false
  ): void {
    if (!sessionId) return;

    const isAuthError = errorType === 'authentication_error';

    // Use non-blocking for error logging - errors are secondary to the main message flow
    this.logAgentMessageNonBlocking(sessionId, providerName, 'output', JSON.stringify({
      type: 'error',
      error: error.message,
      source,
      is_error: true,
      is_auth_error: isAuthError,
      error_name: error.name,
      error_stack: error.stack
    }), {
      isError: true,
      isAuthError,
      errorType,
      errorName: error.name
    }, hidden);
  }
}
