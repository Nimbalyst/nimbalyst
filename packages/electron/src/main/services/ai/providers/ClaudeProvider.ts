/**
 * Claude provider using direct Anthropic SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider } from '../AIProvider';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk 
} from '../types';

export class ClaudeProvider extends BaseAIProvider {
  private anthropic: Anthropic | null = null;
  private abortController: AbortController | null = null;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    
    if (!config.apiKey) {
      throw new Error('API key required for Claude provider');
    }

    this.anthropic = new Anthropic({
      apiKey: config.apiKey
    });
  }

  async *sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: any[]
  ): AsyncIterableIterator<StreamChunk> {
    if (!this.anthropic) {
      throw new Error('Claude provider not initialized');
    }

    // Build system prompt with document context
    const systemPrompt = this.buildSystemPrompt(documentContext);

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Build messages array for Anthropic API
    const apiMessages = [];
    
    // Add existing messages if provided
    if (messages && messages.length > 0) {
      // Convert our message format to Anthropic's format
      for (const msg of messages) {
        apiMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    }
    
    // Add the new user message
    apiMessages.push({ role: 'user', content: message });

    try {
      // Define tools for Claude
      const tools: Anthropic.Tool[] = [{
        name: 'applyDiff',
        description: 'Apply text replacements to the document with diff preview',
        input_schema: {
          type: 'object',
          properties: {
            replacements: {
              type: 'array',
              description: 'Array of text replacements to apply',
              items: {
                type: 'object',
                properties: {
                  oldText: { 
                    type: 'string',
                    description: 'The exact text to replace'
                  },
                  newText: { 
                    type: 'string',
                    description: 'The new text to insert'
                  }
                },
                required: ['oldText', 'newText']
              }
            }
          },
          required: ['replacements']
        }
      }];

      // Create the message with full conversation history
      const response = await this.anthropic.messages.create({
        model: this.config.model || 'claude-3-5-sonnet-20241022',
        max_tokens: this.config.maxTokens || 4000,
        temperature: this.config.temperature || 0,
        system: systemPrompt,
        messages: apiMessages,
        tools,
        stream: true
      }, {
        signal: this.abortController.signal
      });

      let fullContent = '';
      let currentToolUse: any = null;
      let toolInputBuffer = '';

      // Stream the response
      for await (const chunk of response) {
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            // Tool use started
            currentToolUse = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: {}
            };
            toolInputBuffer = '';
            console.log('Tool use started:', chunk.content_block.name);
          }
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            // Text chunk
            fullContent += chunk.delta.text;
            yield {
              type: 'text',
              content: chunk.delta.text
            };
          } else if (chunk.delta.type === 'input_json_delta') {
            // Accumulate tool input JSON
            toolInputBuffer += chunk.delta.partial_json;
          }
        } else if (chunk.type === 'content_block_stop') {
          // Check if this was a tool use block
          if (currentToolUse && toolInputBuffer) {
            try {
              // Parse the complete tool input
              currentToolUse.input = JSON.parse(toolInputBuffer);
              
              // Emit tool call event
              yield {
                type: 'tool_call',
                toolCall: {
                  name: currentToolUse.name,
                  arguments: currentToolUse.input
                }
              };

              // If it's an applyDiff tool and we have a handler, execute it
              if (currentToolUse.name === 'applyDiff' && this.toolHandler) {
                const result = await this.toolHandler.applyDiff(currentToolUse.input);
                // We could handle the result here if needed
                console.log('Tool execution result:', result);
              }
            } catch (error) {
              console.error('Error parsing tool input:', error);
            }
            
            currentToolUse = null;
            toolInputBuffer = '';
          }
        } else if (chunk.type === 'message_stop') {
          // Message complete
          yield {
            type: 'complete',
            content: fullContent,
            isComplete: true
          };
        }
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error('Claude API error:', error);
        yield {
          type: 'error',
          error: error.message
        };
      }
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: true,
      mcpSupport: false,  // No MCP support, uses direct tool calling
      edits: true,
      resumeSession: false  // Cannot resume Claude sessions
    };
  }

  private buildSystemPrompt(documentContext?: DocumentContext): string {
    return `You are an AI assistant integrated into Stravu Editor, a markdown-focused text editor built with Lexical.

You have access to the following tool for document editing:
- applyDiff: Apply text replacements to the document with diff preview

Current document context:
- File: ${documentContext?.filePath || 'untitled'}
- Type: ${documentContext?.fileType || 'markdown'}
${documentContext?.content ? `- Content preview: ${documentContext.content.substring(0, 200)}...` : ''}

CRITICAL RESPONSE RULES - YOU MUST FOLLOW THESE:
1. When editing documents, your ENTIRE response should be 1 short sentence MAX
2. NEVER explain what you're about to do (e.g., "Let me...", "I'll...", "First...")
3. NEVER describe what you added - the user sees it in the document
4. NEVER list the content you added
5. NEVER explain your reasoning unless explicitly asked

GOOD responses after editing:
- "Done."
- "Added the section."
- "Fixed the formatting."
- "Updated with examples."

Remember: The user can SEE the changes in their editor. They don't need you to describe them.`;
  }
}