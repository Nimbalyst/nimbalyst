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
    messages?: Message[]
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
    messages?: Message[]
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
              result = await this.toolHandler.applyDiff(args);
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
}
