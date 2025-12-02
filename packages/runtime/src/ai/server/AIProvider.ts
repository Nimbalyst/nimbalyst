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
    return buildSystemPrompt(documentContext);
  }

  /**
   * Log an agent message to the audit table
   * This should be called for both input (user/system to AI) and output (AI response) messages
   *
   * Returns a Promise that resolves when the message is saved.
   * Callers can await this for final output messages to ensure the database write
   * completes before signaling completion to the UI.
   * For input messages and streaming chunks, the Promise can be ignored (fire-and-forget).
   * Emits 'message:logged' event after successful write to trigger UI updates.
   */
  protected logAgentMessage(
    sessionId: string,
    source: string, // Provider name (e.g., 'claude', 'claude-code', 'openai')
    direction: 'input' | 'output',
    content: string,
    metadata?: Record<string, unknown>,
    hidden?: boolean
  ): Promise<void> {
    // Create timestamp HERE - this is the authoritative source
    // This same timestamp must be used for message.created_at, session.updated_at, and sync index
    const createdAt = new Date();

    return AgentMessagesRepository.create({
      sessionId,
      source,
      direction,
      content,
      metadata,
      hidden,
      createdAt,
    }).then(() => {
      // Emit event to notify listeners that new message was written to database
      // Include hidden flag so sync handlers can skip hidden messages
      this.emit('message:logged', { sessionId, direction, hidden: hidden ?? false });
    }).catch(error => {
      // Don't fail the request if logging fails - just log the error
      console.error('[BaseAIProvider] Failed to log agent message:', error);
      console.error('[BaseAIProvider] Failed message details:', { sessionId, source, direction, contentLength: content.length });
    });
  }

  /**
   * Log an error to the database
   * Helper method to reduce duplication across provider implementations
   */
  protected logError(
    sessionId: string | undefined,
    providerName: string,
    error: Error,
    source: string,
    errorType: string = 'api_error'
  ): void {
    if (!sessionId) return;

    this.logAgentMessage(sessionId, providerName, 'output', JSON.stringify({
      type: 'error',
      error: error.message,
      source,
      is_error: true,
      error_name: error.name,
      error_stack: error.stack
    }), {
      isError: true,
      errorType,
      errorName: error.name
    });
  }
}
