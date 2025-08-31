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
      apiKey: config.apiKey,
      defaultHeaders: {
        'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14'
      }
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
        // Skip messages with empty content
        if (!msg.content || msg.content.trim() === '') {
          console.warn('Skipping message with empty content:', msg);
          continue;
        }
        
        apiMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    }
    
    // Add the new user message (ensure it's not empty)
    if (!message || message.trim() === '') {
      throw new Error('Cannot send empty message to Claude API');
    }
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
      }, {
        name: 'streamContent',
        description: 'Stream new content into the document at a specific position',
        input_schema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content to stream into the document'
            },
            position: {
              type: 'string',
              enum: ['cursor', 'end', 'after-selection'],
              description: 'Where to insert the content (cursor = at cursor position, end = end of document, after-selection = after selected text)'
            },
            insertAfter: {
              type: 'string',
              description: 'Optional: Find this text and insert content after it (at end of the line containing this text)'
            }
          },
          required: ['content', 'position']
        }
      }];

      // Create the message with full conversation history
      if (!this.config.model) {
        throw new Error('No model specified for Claude provider');
      }
      
      const response = await this.anthropic.messages.create({
        model: this.config.model,
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
      let isStreamingContent = false;
      let streamContentBuffer = '';
      let streamConfig: any = null;

      // Stream the response
      for await (const chunk of response) {
        console.log('[ClaudeProvider] Chunk received:', {
          type: chunk.type,
          toolName: chunk.content_block?.name,
          deltaType: chunk.delta?.type,
          partialJsonLength: chunk.delta?.partial_json?.length
        });
        
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            // Tool use started
            currentToolUse = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: {}
            };
            toolInputBuffer = '';
            console.log('[ClaudeProvider] Tool use started:', chunk.content_block.name);
            
            // Check if this is streamContent tool
            if (chunk.content_block.name === 'streamContent') {
              isStreamingContent = true;
              streamContentBuffer = '';
            }
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
            
            console.log('[ClaudeProvider] input_json_delta received:', {
              toolName: currentToolUse?.name,
              isStreamingContent,
              bufferLength: toolInputBuffer.length,
              partialJson: chunk.delta.partial_json?.substring(0, 100)
            });
            
            // Special handling for streamContent tool - stream the content as it arrives
            if (isStreamingContent && currentToolUse?.name === 'streamContent') {
              const partialJson = chunk.delta.partial_json;
              console.log('[ClaudeProvider] Processing streaming chunk:', {
                length: partialJson?.length,
                preview: partialJson?.substring(0, 50),
                bufferSoFar: toolInputBuffer.substring(0, 100)
              });
              
              // Wait until we have the opening structure before starting
              if (!streamConfig && toolInputBuffer.includes('"content"')) {
                // Extract position if available
                const positionMatch = toolInputBuffer.match(/"position"\s*:\s*"([^"]+)"/);
                const insertAfterMatch = toolInputBuffer.match(/"insertAfter"\s*:\s*"([^"]+)"/);
                
                const position = positionMatch ? positionMatch[1] : 'cursor';
                
                streamConfig = {
                  position: position,
                  insertAfter: insertAfterMatch ? insertAfterMatch[1] : undefined,
                  insertAtEnd: position === 'end',
                  mode: 'after'
                };
                
                console.log('[ClaudeProvider] 🚀 Emitting stream_edit_start with config:', JSON.stringify(streamConfig, null, 2));
                
                yield {
                  type: 'stream_edit_start',
                  config: streamConfig
                };
                
                // Track how much of the content we've already streamed
                streamContentBuffer = '';
              }
              
              // Extract and stream content incrementally
              if (streamConfig) {
                // Try to extract the content value from the accumulated buffer
                // We're looking for the pattern: "content": "...actual content..."
                // The content value starts after "content": " and ends before the next "
                
                // Find where content starts in the buffer
                const contentStartMarker = '"content": "';
                const contentStartIndex = toolInputBuffer.indexOf(contentStartMarker);
                
                if (contentStartIndex !== -1) {
                  // Calculate where the actual content starts
                  const actualContentStart = contentStartIndex + contentStartMarker.length;
                  
                  // Find where content might end (look for ", " which would indicate next field)
                  // But we need to be careful about escaped quotes
                  let contentEndIndex = toolInputBuffer.length; // Default to end of buffer
                  
                  // Look for the end of the content field
                  // This is tricky because we need to handle escaped quotes
                  for (let i = actualContentStart; i < toolInputBuffer.length - 1; i++) {
                    if (toolInputBuffer[i] === '"' && toolInputBuffer[i-1] !== '\\') {
                      // Found an unescaped quote - this might be the end
                      if (toolInputBuffer[i+1] === ',' || toolInputBuffer[i+1] === '}') {
                        contentEndIndex = i;
                        break;
                      }
                    }
                  }
                  
                  // Extract the content portion (might be incomplete)
                  const rawContent = toolInputBuffer.substring(actualContentStart, contentEndIndex);
                  
                  // Only process if we have new content beyond what we've already sent
                  if (rawContent.length > streamContentBuffer.length) {
                    const newRawContent = rawContent.substring(streamContentBuffer.length);
                    
                    // Unescape the new content
                    const unescapedContent = newRawContent
                      .replace(/\\n/g, '\n')
                      .replace(/\\r/g, '\r')
                      .replace(/\\t/g, '\t')
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, '\\');
                    
                    if (unescapedContent.length > 0) {
                      console.log('[ClaudeProvider] 📝 Streaming content:', unescapedContent.substring(0, 30));
                      
                      yield {
                        type: 'stream_edit_content',
                        content: unescapedContent
                      };
                      
                      // Update how much we've sent
                      streamContentBuffer = rawContent;
                    }
                  }
                }
              }
            }
          }
        } else if (chunk.type === 'content_block_stop') {
          // Check if this was a tool use block
          if (currentToolUse && toolInputBuffer) {
            try {
              // Parse the complete tool input
              currentToolUse.input = JSON.parse(toolInputBuffer);
              
              // If this was streamContent, emit the end event
              if (currentToolUse.name === 'streamContent' && isStreamingContent) {
                yield {
                  type: 'stream_edit_end'
                };
                isStreamingContent = false;
                streamContentBuffer = '';
                streamConfig = null;
              } else {
                // Only emit tool call event for non-streaming tools
                // streamContent is handled entirely through streaming events
                yield {
                  type: 'tool_call',
                  toolCall: {
                    name: currentToolUse.name,
                    arguments: currentToolUse.input
                  }
                };
              }

              // If it's an applyDiff tool and we have a handler, execute it
              if (currentToolUse.name === 'applyDiff' && this.toolHandler) {
                const result = await this.toolHandler.applyDiff(currentToolUse.input);
                // We could handle the result here if needed
                console.log('Tool execution result:', result);
              }
            } catch (error) {
              console.error('Error parsing tool input:', error);
              
              // If we were streaming, end with error
              if (isStreamingContent) {
                yield {
                  type: 'stream_edit_end',
                  error: 'Failed to parse tool input'
                };
                isStreamingContent = false;
                streamContentBuffer = '';
                streamConfig = null;
              }
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
    const basePrompt = super.buildSystemPrompt(documentContext);
    
    return `${basePrompt}

You have access to the following tools for document editing:
- applyDiff: Apply text replacements to the document with diff preview (use for replacing existing text)
- streamContent: Stream new content into the document at a specific position (use for inserting new content)

Tool Usage Guidelines:
- Use 'applyDiff' when you need to REPLACE or MODIFY existing text
- Use 'streamContent' when you need to INSERT NEW content without replacing anything
- For streamContent, use position='cursor' to insert at cursor, position='end' to append to document, or provide 'insertAfter' to insert after specific text

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

Remember: The user can SEE the changes in their editor. They just want confirmation you understood the request.`;
  }
}