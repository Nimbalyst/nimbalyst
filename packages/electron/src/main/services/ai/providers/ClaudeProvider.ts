/**
 * Claude provider using direct Anthropic SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider } from '../AIProvider';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk,
  AIModel 
} from '../types';
import { CLAUDE_MODELS, DEFAULT_MODELS } from '../../../../shared/modelConstants';
import { logger } from '../../../utils/logger';

const LOG_PREVIEW_LENGTH = 400;

function previewForLog(value?: string, max: number = LOG_PREVIEW_LENGTH): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export class ClaudeProvider extends BaseAIProvider {
  private anthropic: Anthropic | null = null;
  private abortController: AbortController | null = null;

  static readonly DEFAULT_MODEL = DEFAULT_MODELS.claude;

  async initialize(config: ProviderConfig): Promise<void> {
    console.log('[ClaudeProvider] initialize called with config:', {
      hasApiKey: !!config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens
    });
    
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
      // Only define tools if we have a document open
      const hasDocument = documentContext && (documentContext.filePath || documentContext.content);
      // Use the centralized tool system
      const tools: Anthropic.Tool[] = hasDocument ? this.getToolsInAnthropicFormat() : [];

      // Create the message with full conversation history
      if (!this.config.model) {
        throw new Error('No model specified for Claude provider');
      }
      
      // Remove provider prefix from model ID for API call
      const modelId = this.config.model.replace('claude:', '');
      console.log('[ClaudeProvider] sendMessage - model conversion:', {
        original: this.config.model,
        stripped: modelId
      });
      
      console.log('[ClaudeProvider] About to call Anthropic API with model:', modelId);
      console.log('[ClaudeProvider] Stack trace:', new Error().stack);
      
      const response = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: this.config.maxTokens || 4000,
        temperature: this.config.temperature || 0,
        system: systemPrompt,
        messages: apiMessages,
        ...(tools.length > 0 ? { tools } : {}),
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
              if (currentToolUse.name === 'applyDiff') {
                logger.aiClaude.info('[ClaudeProvider] applyDiff raw input', previewForLog(toolInputBuffer));
              }

              currentToolUse.input = JSON.parse(toolInputBuffer);

              // Prepare optional execution result for tools that run immediately
              let executionResult: any = undefined;

              if (currentToolUse.name === 'applyDiff') {
                const replacements = (currentToolUse.input as any)?.replacements;
                if (!Array.isArray(replacements) || replacements.length === 0) {
                  logger.aiClaude.warn('[ClaudeProvider] applyDiff tool call missing replacements', {
                    inputKeys: currentToolUse.input ? Object.keys(currentToolUse.input) : []
                  });
                } else {
                  logger.aiClaude.info('[ClaudeProvider] applyDiff replacements received', {
                    count: replacements.length
                  });
                }

                if (this.toolHandler) {
                  executionResult = await this.toolHandler.applyDiff(currentToolUse.input);
                  logger.aiClaude.info('[ClaudeProvider] applyDiff execution result', executionResult);

                  if (!executionResult?.success) {
                    const errorMessage = executionResult?.error || 'applyDiff execution failed';
                    yield {
                      type: 'tool_error',
                      toolError: {
                        name: currentToolUse.name,
                        arguments: currentToolUse.input,
                        error: errorMessage,
                        result: executionResult
                      }
                    };
                  }
                }
              }

              if (currentToolUse.name === 'streamContent' && isStreamingContent) {
                // streamContent handled separately through streaming events
                yield {
                  type: 'stream_edit_end'
                };
                isStreamingContent = false;
                streamContentBuffer = '';
                streamConfig = null;
              } else {
                // Emit tool call for logging/UI purposes
                yield {
                  type: 'tool_call',
                  toolCall: {
                    name: currentToolUse.name,
                    arguments: currentToolUse.input,
                    ...(executionResult !== undefined ? { result: executionResult } : {})
                  }
                };
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
          if (fullContent) {
            logger.aiClaude.info('[ClaudeProvider] Assistant response', {
              length: fullContent.length,
              preview: previewForLog(fullContent)
            });
          }
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
    // The base prompt now includes all tool usage instructions
    return super.buildSystemPrompt(documentContext);
  }

  /**
   * Get available Claude models
   */
  static getModels(): AIModel[] {
    return CLAUDE_MODELS.map(model => ({
      id: `claude:${model.id}`,
      name: model.displayName,
      provider: 'claude' as const,
      maxTokens: model.maxTokens,
      contextWindow: model.contextWindow
    }));
  }

  /**
   * Get default model
   */
  static getDefaultModel(): string {
    return this.DEFAULT_MODEL;
  }

  /**
   * Check if a model is allowed
   */
  static isModelAllowed(modelId: string): boolean {
    const cleanId = modelId.replace('claude:', '');
    return CLAUDE_MODELS.some(m => m.id === cleanId);
  }
}
