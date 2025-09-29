/**
 * LMStudio provider for local models (OpenAI-compatible API)
 */

import { BaseAIProvider } from '../AIProvider';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk,
  Message,
  AIModel
} from '../types';

interface LMStudioConfig extends ProviderConfig {
  baseUrl?: string;  // Default: http://127.0.0.1:1234
}

export class LMStudioProvider extends BaseAIProvider {
  private baseUrl: string = 'http://127.0.0.1:8234';
  private abortController: AbortController | null = null;
  
  static readonly DEFAULT_MODEL = 'lmstudio:local-model';

  async initialize(config: LMStudioConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:8234';
    
    // Test connection to LMStudio
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      if (!response.ok) {
        throw new Error(`LMStudio server not responding at ${this.baseUrl}. Please ensure LMStudio is running and has a model loaded.`);
      }
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
        throw new Error(`Cannot connect to LMStudio at ${this.baseUrl}. Please ensure:\n1. LMStudio is running\n2. A model is loaded in LMStudio\n3. The local server is started (look for "Local Server" in LMStudio)`);
      }
      throw new Error(`Failed to connect to LMStudio at ${this.baseUrl}: ${error.message || error}`);
    }
  }

  async *sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[]
  ): AsyncIterableIterator<StreamChunk> {
    // Build system prompt with document context
    const systemPrompt = this.buildSystemPrompt(documentContext);

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Build messages array for OpenAI-compatible API
    const apiMessages: any[] = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add existing messages if provided
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        // Skip messages with empty content
        if (!msg.content || msg.content.trim() === '') {
          continue;
        }
        
        // Handle tool/function messages
        if (msg.role === 'tool') {
          // LMStudio expects tool results in a specific format
          apiMessages.push({
            role: 'tool',
            tool_call_id: msg.toolCall?.id || 'tool_' + Date.now(),
            content: msg.content || JSON.stringify(msg.toolCall?.result || {})
          });
        } else {
          apiMessages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        }
      }
    }
    
    // Add the new user message
    if (!message || message.trim() === '') {
      throw new Error('Cannot send empty message to LMStudio');
    }
    apiMessages.push({ role: 'user', content: message });

    // Use the centralized tool system (OpenAI-compatible format)
    const tools = this.getToolsInOpenAIFormat();

    // Log the request for debugging
    const requestBody = {
      model: this.config.model || 'local-model',
      messages: apiMessages,
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature || 0.7,
      tools: tools,
      tool_choice: 'auto',  // Let the model decide when to use tools
      stream: true
    };
    
    console.log('[LMStudio] Sending request with tools:', {
      model: requestBody.model,
      messagesCount: requestBody.messages.length,
      toolsCount: requestBody.tools.length,
      firstMessage: apiMessages[0],
      lastMessage: apiMessages[apiMessages.length - 1]
    });

    try {
      // Make streaming request to LMStudio with tools
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal
      });
      
      console.log('[LMStudio] Response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`LMStudio returned ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body from LMStudio');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let currentToolCall: any = null;
      let toolCallBuffer = '';
      let isStreamingContent = false;
      let streamContentBuffer = '';
      let streamConfig: any = null;
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[LMStudio] Stream done, total chunks:', chunkCount);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.trim() === 'data: [DONE]') {
            console.log('[LMStudio] Received [DONE] marker');
            yield {
              type: 'complete',
              content: fullContent,
              isComplete: true
            };
            return;
          }

          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              chunkCount++;
              const delta = json.choices?.[0]?.delta;
              
              // Log if this is the first chunk or if it's empty
              if (chunkCount === 1) {
                console.log('[LMStudio] First chunk from API:', JSON.stringify(json, null, 2));
              }
              
              // Log if we get an empty response
              if (!delta?.content && !delta?.tool_calls && json.choices?.[0]?.finish_reason) {
                console.log('[LMStudio] Empty response with finish_reason:', json.choices[0].finish_reason);
              }
              
              // Handle text content
              if (delta?.content) {
                fullContent += delta.content;
                yield {
                  type: 'text',
                  content: delta.content
                };
              }
              
              // Handle tool calls (OpenAI format)
              if (delta?.tool_calls) {
                console.log('[LMStudio] Tool calls detected:', delta.tool_calls);
                for (const toolCall of delta.tool_calls) {
                  if (toolCall.id) {
                    // New tool call starting
                    console.log('[LMStudio] Starting new tool call:', toolCall.function?.name);
                    currentToolCall = {
                      id: toolCall.id,
                      type: toolCall.type,
                      function: {
                        name: toolCall.function?.name || '',
                        arguments: ''
                      }
                    };
                    toolCallBuffer = '';
                  }
                  
                  if (toolCall.function?.arguments) {
                    // Accumulate function arguments
                    const chunk = toolCall.function.arguments;
                    toolCallBuffer += chunk;
                    console.log('[LMStudio] Tool call chunk received:', {
                      toolName: currentToolCall?.function?.name,
                      chunkLength: chunk.length,
                      chunkPreview: chunk.substring(0, 50),
                      totalBufferLength: toolCallBuffer.length,
                      isStreamingContent: isStreamingContent
                    });
                    
                    // Special handling for streamContent to enable true streaming
                    if (currentToolCall?.function?.name === 'streamContent') {
                      if (!isStreamingContent) {
                        // Check if we have enough info to start streaming
                        const positionMatch = toolCallBuffer.match(/"position"\s*:\s*"([^"]+)"/);
                        const insertAfterMatch = toolCallBuffer.match(/"insertAfter"\s*:\s*"([^"]+)"/);
                        
                        // Start streaming as soon as we see the content field starting
                        if (toolCallBuffer.includes('"content"')) {
                          // Default to cursor if position not found yet
                          const position = positionMatch ? positionMatch[1] : 'cursor';
                          
                          isStreamingContent = true;
                          streamConfig = {
                            position: position,
                            insertAfter: insertAfterMatch ? insertAfterMatch[1] : undefined,
                            insertAtEnd: position === 'end',
                            mode: 'after'
                          };
                          
                          console.log('[LMStudio] Starting streaming with config:', streamConfig);
                          
                          yield {
                            type: 'stream_edit_start',
                            config: streamConfig
                          };
                          
                          // Initialize stream content buffer to track what we've sent
                          streamContentBuffer = '';
                        }
                      }
                    }
                    
                    // If we're streaming content, extract and stream it incrementally
                    if (isStreamingContent && currentToolCall?.function?.name === 'streamContent') {
                      // Extract content from the accumulated buffer
                      // Look for the content field in the JSON
                      const contentMatch = toolCallBuffer.match(/"content"\s*:\s*"/);
                      
                      if (contentMatch && contentMatch.index !== undefined) {
                        // Find where content value starts (after the matched pattern)
                        const contentStartIndex = contentMatch.index + contentMatch[0].length;
                        
                        // Find potential end of content (look for ", but handle escaped quotes)
                        let contentEndIndex = -1;
                        let escaped = false;
                        for (let i = contentStartIndex; i < toolCallBuffer.length; i++) {
                          if (toolCallBuffer[i] === '\\' && !escaped) {
                            escaped = true;
                            continue;
                          }
                          if (toolCallBuffer[i] === '"' && !escaped) {
                            contentEndIndex = i;
                            break;
                          }
                          escaped = false;
                        }
                        
                        if (contentEndIndex > 0) {
                          // We have complete content
                          const rawContent = toolCallBuffer.substring(contentStartIndex, contentEndIndex);
                          
                          // Only send new content that hasn't been streamed yet
                          if (rawContent.length > streamContentBuffer.length) {
                            const newContent = rawContent.substring(streamContentBuffer.length);
                            
                            // Unescape the JSON string content
                            const unescaped = newContent
                              .replace(/\\n/g, '\n')
                              .replace(/\\r/g, '\r')
                              .replace(/\\t/g, '\t')
                              .replace(/\\"/g, '"')
                              .replace(/\\\\/g, '\\');
                            
                            if (unescaped.length > 0) {
                              console.log('[LMStudio] 📝 Emitting stream_edit_content (complete):', {
                                length: unescaped.length,
                                preview: unescaped.substring(0, 30) + (unescaped.length > 30 ? '...' : '')
                              });
                              
                              yield {
                                type: 'stream_edit_content',
                                content: unescaped
                              };
                            }
                            
                            streamContentBuffer = rawContent;
                          }
                          
                          // End streaming since content is complete
                          yield {
                            type: 'stream_edit_end'
                          };
                          
                          isStreamingContent = false;
                          streamContentBuffer = '';
                          streamConfig = null;
                          currentToolCall = null;
                          toolCallBuffer = '';
                        } else {
                          // Content not complete yet, but we can stream what we have so far
                          const partialContent = toolCallBuffer.substring(contentStartIndex);
                          
                          // Only send new content
                          if (partialContent.length > streamContentBuffer.length) {
                            const newContent = partialContent.substring(streamContentBuffer.length);
                            
                            // Don't send incomplete escape sequences
                            let safeEndIndex = newContent.length;
                            
                            // Check for incomplete escape sequence at the end
                            if (newContent.endsWith('\\')) {
                              // Don't include the trailing backslash as it might be part of an escape
                              safeEndIndex = newContent.length - 1;
                            }
                            
                            if (safeEndIndex > 0) {
                              const safeContent = newContent.substring(0, safeEndIndex);
                              
                              // Unescape the JSON string content
                              const unescaped = safeContent
                                .replace(/\\n/g, '\n')
                                .replace(/\\r/g, '\r')
                                .replace(/\\t/g, '\t')
                                .replace(/\\"/g, '"')
                                .replace(/\\\\/g, '\\');
                              
                              if (unescaped.length > 0) {
                                console.log('[LMStudio] 📝 Emitting stream_edit_content (partial):', {
                                  length: unescaped.length,
                                  preview: unescaped.substring(0, 30) + (unescaped.length > 30 ? '...' : ''),
                                  totalBuffered: streamContentBuffer.length + safeEndIndex
                                });
                                
                                yield {
                                  type: 'stream_edit_content',
                                  content: unescaped
                                };
                              }
                              
                              streamContentBuffer = partialContent.substring(0, streamContentBuffer.length + safeEndIndex);
                            }
                          }
                        }
                      }
                    } else if (!isStreamingContent) {
                      // Not streaming, try to parse complete arguments for other tools
                      try {
                        const args = JSON.parse(toolCallBuffer);
                        
                        // Emit as regular tool call
                        yield {
                          type: 'tool_call',
                          toolCall: {
                            id: currentToolCall.id,
                            name: currentToolCall.function.name,
                            arguments: args
                          }
                        };
                        
                        // Execute tool if handler available
                        if (currentToolCall.function.name === 'applyDiff' && this.toolHandler && this.toolHandler.applyDiff) {
                          await this.toolHandler.applyDiff(args);
                        }
                        
                        // Reset for next tool call
                        currentToolCall = null;
                        toolCallBuffer = '';
                      } catch (e) {
                        // Arguments not complete yet, continue accumulating
                      }
                    }
                  }
                }
              }
              
              if (json.choices?.[0]?.finish_reason === 'stop') {
                yield {
                  type: 'complete',
                  content: fullContent,
                  isComplete: true
                };
              }
            } catch (error) {
              console.error('Error parsing SSE data from LMStudio:', error, 'Line:', line);
            }
          }
        }
      }

      // Handle any remaining buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
        if (buffer.startsWith('data: ')) {
          try {
            const json = JSON.parse(buffer.slice(6));
            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              yield {
                type: 'text',
                content: delta.content
              };
            }
          } catch (error) {
            console.error('Error parsing final SSE data:', error);
          }
        }
      }

      // Ensure we send a complete event
      yield {
        type: 'complete',
        content: fullContent,
        isComplete: true
      };

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error('LMStudio error:', error);
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
      tools: true,  // LMStudio supports native OpenAI-style function calling
      mcpSupport: false,
      edits: true,  // Enable edits through native tool support
      resumeSession: false
    };
  }

  destroy(): void {
    this.abort();
  }

  protected buildSystemPrompt(documentContext?: DocumentContext): string {
    // The base prompt now includes all tool usage instructions
    return super.buildSystemPrompt(documentContext);
  }

  /**
   * Get available models from LMStudio
   */
  static async getModels(baseUrl: string = 'http://127.0.0.1:8234'): Promise<AIModel[]> {
    try {
      const response = await fetch(`${baseUrl}/v1/models`);
      
      if (!response.ok) {
        throw new Error(`LMStudio returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // Map LMStudio models to our format
      return data.data.map((model: any) => ({
        id: `lmstudio:${model.id}`,
        name: this.formatModelName(model.id),
        provider: 'lmstudio' as const,
        maxTokens: model.max_tokens || 4096,
        contextWindow: model.context_length || 4096
      }));
      
    } catch (error) {
      console.error('Failed to fetch LMStudio models:', error);
      return this.getDefaultModels();
    }
  }

  /**
   * Get default models
   */
  static getDefaultModels(): AIModel[] {
    return [{
      id: 'lmstudio:local-model',
      name: 'Local Model',
      provider: 'lmstudio' as const,
      maxTokens: 4096,
      contextWindow: 4096
    }];
  }

  /**
   * Get default model
   */
  static getDefaultModel(): string {
    return this.DEFAULT_MODEL;
  }

  /**
   * Format model name for display
   */
  private static formatModelName(modelId: string): string {
    return modelId
      .replace(/-GGUF$/i, '')
      .replace(/-Q[0-9]_K_[A-Z]/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }
}
