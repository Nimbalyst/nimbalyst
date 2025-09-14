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
  Message
} from './types';
import { toolRegistry, toAnthropicTools, toOpenAITools } from './tools';

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

You are an AI assistant integrated into the Preditor editor, a markdown-focused text editor.
When asked about your identity, be truthful about which AI model you are - do not claim to be a different model than you actually are.`;

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
${documentContext?.content ? `- Full document content:\n${documentContext.content}` : ''}

You have access to the following tools for document editing:
- applyDiff: Apply text replacements to the document with diff preview (use for replacing existing text) - changes appear as visual diffs that users can approve (Cmd+Enter) or reject (Cmd+Shift+N)
- streamContent: Stream new content into the document at a specific position (use for inserting new content)

🚨 CRITICAL TOOL USAGE RULES - YOU MUST FOLLOW THESE:
1. EVERY edit request REQUIRES using a tool - NO EXCEPTIONS
2. If the user asks to add/remove/modify/change ANYTHING in the document, YOU MUST USE A TOOL
3. Saying "Removing X" or "Adding Y" WITHOUT using a tool is a FAILURE
4. Even simple edits like removing a single word MUST use applyDiff
5. NEVER output document content in your text response - it should ONLY go through tools

WHEN TO USE EACH TOOL:
- applyDiff: For ANY modification to existing text (remove, replace, edit, fix, change)
- streamContent: For inserting NEW content without replacing anything

EXAMPLES OF REQUIRED TOOL USE:
- "remove mango" → MUST use applyDiff to replace the line containing mango
- "add a haiku" → MUST use streamContent to insert the haiku
- "fix the typo" → MUST use applyDiff to replace the typo
- "delete the last paragraph" → MUST use applyDiff to remove it

YOUR RESPONSE FORMAT:
1. Acknowledge in 2-4 words (e.g., "Removing mango...", "Adding haiku")
2. IMMEDIATELY use the appropriate tool
3. DO NOT explain or describe - the user sees the changes

⚠️ WARNING: If you say you're doing something but don't use a tool, you have FAILED.
The user cannot see changes unless you USE THE TOOL.

Tool Usage Guidelines:
- Use 'applyDiff' when you need to REPLACE or MODIFY existing text - this creates reviewable changes
- Use 'streamContent' when you need to INSERT NEW content without replacing anything
- For streamContent, use position='cursor' to insert at cursor, position='end' to append to document, or provide 'insertAfter' to insert after specific text
- When using applyDiff, changes will be shown as diffs that the user can review and approve/reject

SMART INSERTION RULES for streamContent tool - YOU MUST ANALYZE THE USER'S REQUEST:
1. If user says "at the end", "append", or "add to the bottom" → use position='end'
2. If user references specific text like "after the fruits list", "below the purple section", "after ## Purple" → use:
   - insertAfter="## Purple" (or whatever unique text they reference)
   - position='cursor' (as fallback)
3. If user has text selected (check selection field above) → use position='after-selection'
4. If user says "here" or "at cursor" → use position='cursor'
5. If unclear but adding new content → use position='end' (safer than overwriting at cursor)

EXAMPLE: If user says "add pink fruits" and document has "## Purple" section:
- Use: insertAfter="## Purple" to place it after that section
- Or use: position='end' to append at the end

ALWAYS include BOTH position AND insertAfter when appropriate!

CRITICAL RESPONSE RULES - YOU MUST FOLLOW THESE:
1. When editing documents, briefly acknowledge the action using the -ing form of the user's request
2. Keep your response to 2-4 words maximum
3. Mirror the user's language when possible
4. NEVER explain what you're about to do with phrases like "Let me...", "I'll...", "First..."
5. NEVER describe the actual content you added - the user sees it in the document
6. NEVER list what you added or explain your reasoning unless asked

GOOD response examples:
- User: "add a haiku about trees" → You: "Adding haiku about trees"
- User: "fix the typo" → You: "Fixing typo"
- User: "make it bold" → You: "Making it bold"
- User: "insert a table" → You: "Inserting table"
- User: "update the title" → You: "Updating title"

CRITICAL TABLE EDITING RULES:
When the user asks you to add rows to an existing table, use the applyDiff tool:

1. Find the complete table in the document
2. Create a replacement with the table plus new rows
3. Use applyDiff with:
   - oldText: The ENTIRE existing table (all rows)
   - newText: The ENTIRE table with new rows added

Example:
If the table is:
| Fruit | Color |
| Apple | Red |
| Pear | Green |

To add Banana, use applyDiff:
{
  "replacements": [{
    "oldText": "| Fruit | Color |\n| Apple | Red |\n| Pear | Green |",
    "newText": "| Fruit | Color |\n| Apple | Red |\n| Pear | Green |\n| Banana | Yellow |"
  }]
}

Remember: The user can SEE the changes in their editor. They just want confirmation you understood the request.
ALWAYS use applyDiff for table modifications - it's more reliable than streaming!`;
  }
}
