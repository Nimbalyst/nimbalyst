/**
 * OpenAI provider using OpenAI SDK
 */

import OpenAI from 'openai';
import { BaseAIProvider } from '../AIProvider';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk,
  Message
} from '../types';

export class OpenAIProvider extends BaseAIProvider {
  private openai: OpenAI | null = null;
  private abortController: AbortController | null = null;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    
    if (!config.apiKey) {
      throw new Error('API key required for OpenAI provider');
    }

    this.openai = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  async *sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[]
  ): AsyncIterableIterator<StreamChunk> {
    if (!this.openai) {
      throw new Error('OpenAI provider not initialized');
    }

    // Build system prompt with document context
    const systemPrompt = this.buildSystemPrompt(documentContext);

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Build messages array for OpenAI API
    const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add existing messages if provided
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        // Skip messages with empty content
        if (!msg.content || msg.content.trim() === '') {
          console.warn('Skipping message with empty content:', msg);
          continue;
        }
        
        // Convert tool messages to assistant messages for OpenAI
        if (msg.role === 'tool') {
          continue; // Skip tool messages for now
        }
        
        apiMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    }
    
    // Add the new user message
    if (!message || message.trim() === '') {
      throw new Error('Cannot send empty message to OpenAI API');
    }
    apiMessages.push({ role: 'user', content: message });

    try {
      // Define tools for OpenAI (using function calling)
      const tools: OpenAI.Chat.ChatCompletionTool[] = [{
        type: 'function',
        function: {
          name: 'applyDiff',
          description: 'Apply text replacements to the document with diff preview',
          parameters: {
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
        }
      }, {
        type: 'function',
        function: {
          name: 'streamContent',
          description: 'Stream new content into the document at a specific position',
          parameters: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'The content to stream into the document'
              },
              position: {
                type: 'string',
                enum: ['cursor', 'end', 'after-selection'],
                description: 'Where to insert the content'
              },
              insertAfter: {
                type: 'string',
                description: 'Optional: Find this text and insert content after it'
              }
            },
            required: ['content', 'position']
          }
        }
      }];

      // Create the chat completion with streaming
      if (!this.config.model) {
        throw new Error('No model specified for OpenAI provider');
      }
      
      const modelId = this.config.model;
      
      const completionParams: any = {
        model: modelId,
        messages: apiMessages,
        tools,
        tool_choice: 'auto',
        stream: true
      };
      
      // Some models (o1 series, gpt-5, gpt-4.5) don't support temperature parameter
      // They only work with the default temperature of 1
      const supportsTemperature = 
        !modelId.startsWith('o1') && 
        !modelId.startsWith('gpt-5') && 
        !modelId.startsWith('gpt-4.5');
      if (supportsTemperature) {
        completionParams.temperature = this.config.temperature || 0;
      }
      
      // All recent models use max_completion_tokens
      // Only legacy models (gpt-3.5-turbo, gpt-4-turbo) use max_tokens
      const usesLegacyMaxTokens = 
        modelId.startsWith('gpt-3.5') || 
        modelId === 'gpt-4-turbo' ||
        modelId === 'gpt-4-turbo-preview';
      
      if (usesLegacyMaxTokens) {
        completionParams.max_tokens = this.config.maxTokens || 4000;
      } else {
        // All other models (gpt-4o, gpt-4.5, gpt-5, o1, etc.) use max_completion_tokens
        completionParams.max_completion_tokens = this.config.maxTokens || 4000;
      }
      
      const response = await this.openai.chat.completions.create(completionParams, {
        signal: this.abortController.signal
      });

      let fullContent = '';
      let currentToolCall: any = null;
      let toolCallAccumulator: any = {};

      // Stream the response
      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          // Text chunk
          fullContent += delta.content;
          yield {
            type: 'text',
            content: delta.content
          };
        }
        
        if (delta?.tool_calls) {
          // Handle tool calls
          for (const toolCall of delta.tool_calls) {
            const callId = toolCall.index || 0;
            
            if (!toolCallAccumulator[callId]) {
              toolCallAccumulator[callId] = {
                id: toolCall.id || `call_${callId}`,
                type: 'function',
                function: {
                  name: toolCall.function?.name || '',
                  arguments: ''
                }
              };
            }
            
            if (toolCall.function?.name) {
              toolCallAccumulator[callId].function.name = toolCall.function.name;
            }
            
            if (toolCall.function?.arguments) {
              toolCallAccumulator[callId].function.arguments += toolCall.function.arguments;
            }
          }
        }
        
        if (chunk.choices[0]?.finish_reason === 'tool_calls') {
          // Process accumulated tool calls
          for (const callId in toolCallAccumulator) {
            const toolCall = toolCallAccumulator[callId];
            try {
              const args = JSON.parse(toolCall.function.arguments);
              
              // Handle streamContent specially
              if (toolCall.function.name === 'streamContent') {
                yield {
                  type: 'stream_edit_start',
                  config: {
                    position: args.position || 'cursor',
                    insertAfter: args.insertAfter,
                    mode: 'after'
                  }
                };
                
                // Stream the content
                if (args.content) {
                  yield {
                    type: 'stream_edit_content',
                    content: args.content
                  };
                }
                
                yield {
                  type: 'stream_edit_end'
                };
              } else {
                // Regular tool call
                yield {
                  type: 'tool_call',
                  toolCall: {
                    name: toolCall.function.name,
                    arguments: args
                  }
                };
                
                // Execute applyDiff if handler is available
                if (toolCall.function.name === 'applyDiff' && this.toolHandler) {
                  const result = await this.toolHandler.applyDiff(args);
                  console.log('Tool execution result:', result);
                }
              }
            } catch (error) {
              console.error('Error parsing tool arguments:', error);
            }
          }
        }
        
        if (chunk.choices[0]?.finish_reason === 'stop') {
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
        console.error('OpenAI API error:', error);
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
      mcpSupport: false,
      edits: true,
      resumeSession: false
    };
  }

  destroy(): void {
    this.abort();
    this.openai = null;
  }

  private buildSystemPrompt(documentContext?: DocumentContext): string {
    const basePrompt = super.buildSystemPrompt(documentContext);
    
    return `${basePrompt}

You have access to the following tools for document editing:
- applyDiff: Apply text replacements to the document with diff preview (use for replacing existing text)
- streamContent: Stream new content into the document at a specific position (use for inserting new content)

Tool Usage Guidelines:
- Use 'applyDiff' when you need to REPLACE or MODIFY existing text
- Use 'streamContent' when you need to INSERT NEW content without replacing anything
- For streamContent, use position='cursor' to insert at cursor, position='end' to append to document, or provide 'insertAfter' to insert after specific text

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

Remember: The user can SEE the changes in their editor. They just want confirmation you understood the request.`;
  }
}