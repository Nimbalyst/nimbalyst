/**
 * Abstract interface for AI providers
 */

import { EventEmitter } from 'events';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk,
  ToolHandler 
} from './types';

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

  abstract initialize(config: ProviderConfig): Promise<void>;
  abstract sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string
  ): AsyncIterableIterator<StreamChunk>;
  abstract abort(): void;
  abstract getCapabilities(): ProviderCapabilities;

  registerToolHandler(handler: ToolHandler): void {
    this.toolHandler = handler;
  }

  destroy(): void {
    this.removeAllListeners();
  }

  protected async executeToolCall(name: string, args: any): Promise<any> {
    if (!this.toolHandler) {
      throw new Error('No tool handler registered');
    }

    switch (name) {
      case 'applyDiff':
        return await this.toolHandler.applyDiff(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * Build the base system prompt with shared context
   * Providers should call this and append their specific instructions
   */
  protected buildSystemPrompt(documentContext?: DocumentContext): string {
    // Get current date and time
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // Check if we have a document context
    const hasDocument = documentContext && (documentContext.filePath || documentContext.content);
    
    let basePrompt = `Current date and time: ${dateStr} at ${timeStr}

You are an AI assistant integrated into Stravu Editor, a markdown-focused text editor built with Lexical.`;
    
    if (!hasDocument) {
      return basePrompt + `

IMPORTANT: No document is currently open. You cannot perform any editing operations.
The user needs to open a document first before you can help with editing.
You can still answer questions, provide information, and have general conversations.`;
    }
    
    return basePrompt + `

Current document context:
- File: ${documentContext?.filePath || 'untitled'}
- Type: ${documentContext?.fileType || 'markdown'}
${documentContext?.cursorPosition ? `- Cursor position: Line ${documentContext.cursorPosition.line}, Column ${documentContext.cursorPosition.column}` : ''}
${documentContext?.selection ? `- Selected text: "${documentContext.selection.substring(0, 100)}${documentContext.selection.length > 100 ? '...' : ''}"` : ''}
${documentContext?.content ? `- Full document content:\n${documentContext.content}` : ''}`;
  }
}