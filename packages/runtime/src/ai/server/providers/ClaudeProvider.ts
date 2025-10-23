/**
 * Claude provider using direct Anthropic SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import { BaseAIProvider } from '../AIProvider';
import {
  DocumentContext,
  ProviderConfig,
  ProviderCapabilities,
  StreamChunk,
  AIModel
} from '../types';
import { CLAUDE_MODELS, DEFAULT_MODELS } from '../../modelConstants';

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
    messages?: any[],
    workspacePath?: string,
    attachments?: any[]
  ): AsyncIterableIterator<StreamChunk> {
    if (!this.anthropic) {
      throw new Error('Claude provider not initialized');
    }

    // Build system prompt with document context
    const systemPrompt = this.buildSystemPrompt(documentContext);

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Build messages array for Anthropic API
    const apiMessages: any[] = [];

    // Add existing messages if provided
    if (messages && messages.length > 0) {
      // Convert our message format to Anthropic's format
      for (const msg of messages) {
        // Skip messages with empty content
        if (!msg.content || msg.content.trim() === '') {
          console.warn('Skipping message with empty content:', msg);
          continue;
        }

        // Check if message has attachments
        if (msg.attachments && msg.attachments.length > 0) {
          // Format as content array with images and text
          const content: any[] = [];

          // Add images first
          for (const attachment of msg.attachments) {
            if (attachment.type === 'image') {
              // Read image as base64
              try {
                const fileBuffer = await fs.readFile(attachment.filepath);
                const base64Data = fileBuffer.toString('base64');

                content.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: attachment.mimeType,
                    data: base64Data
                  }
                });
              } catch (error) {
                console.error('[ClaudeProvider] Failed to read attachment:', error);
              }
            }
          }

          // Add text content
          content.push({
            type: 'text',
            text: msg.content
          });

          apiMessages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content
          });
        } else {
          // No attachments, use simple string content
          apiMessages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        }
      }
    }

    // Add the new user message (ensure it's not empty)
    if (!message || message.trim() === '') {
      throw new Error('Cannot send empty message to Claude API');
    }

    // Log the input message
    if (sessionId) {
      this.logAgentMessage(sessionId, 'claude', 'input', message);
    }

    // Check if current message has attachments
    if (attachments && attachments.length > 0) {
      const content: any[] = [];

      // Add images first
      for (const attachment of attachments) {
        if (attachment.type === 'image') {
          try {
            const fileBuffer = await fs.readFile(attachment.filepath);
            const base64Data = fileBuffer.toString('base64');

            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: attachment.mimeType,
                data: base64Data
              }
            });
          } catch (error) {
            console.error('[ClaudeProvider] Failed to read attachment:', error);
          }
        }
      }

      // Add text content
      content.push({
        type: 'text',
        text: message
      });

      apiMessages.push({ role: 'user', content });
    } else {
      // No attachments, use simple string content
      apiMessages.push({ role: 'user', content: message });
    }

    // Comprehensive logging of what we're sending to Claude
    console.group('🤖 [ClaudeProvider] Preparing API Request to Claude');
    console.log('📝 System Prompt (first 1000 chars):',
      systemPrompt.substring(0, 1000) + (systemPrompt.length > 1000 ? '...' : ''));
    console.log('💬 Messages:', apiMessages.map(m => ({
      role: m.role,
      contentPreview: m.content?.substring(0, 100) + (m.content?.length > 100 ? '...' : '')
    })));
    console.log('📄 Document Context:', {
      hasDocument: !!documentContext,
      filePath: documentContext?.filePath || 'none',
      contentLength: documentContext?.content?.length || 0
    });
    console.groupEnd();

    try {
      // Only define tools if we have a document open
      const hasDocument = documentContext && (documentContext.filePath || documentContext.content);
      // Use the centralized tool system
      const tools = hasDocument ? this.getToolsInAnthropicFormat() : [];

      console.group('🔧 [ClaudeProvider] Tools Configuration');
      console.log('Has document open:', hasDocument);
      console.log('Tools available:', tools.map(t => t.name));
      if (tools.length > 0) {
        console.log('Tool definitions:', tools);
      }
      console.groupEnd();

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

      // Use the stream helper for better usage data support
      const apiRequest = {
        model: modelId,
        max_tokens: this.config.maxTokens || 4000,
        temperature: this.config.temperature || 0,
        system: systemPrompt,
        messages: apiMessages,
        ...(tools.length > 0 ? { tools } : {}),
      };

      console.group('🚀 [ClaudeProvider] Final API Request');
      console.log('Model:', apiRequest.model);
      console.log('Max tokens:', apiRequest.max_tokens);
      console.log('Temperature:', apiRequest.temperature);
      console.log('Has tools:', !!apiRequest.tools);
      console.log('Number of tools:', apiRequest.tools?.length || 0);
      console.log('System prompt length:', apiRequest.system.length);
      console.log('Number of messages:', apiRequest.messages.length);
      console.groupEnd();

      // Tool execution loop - continue conversation until no more tool calls
      let continuationMessages = [...apiMessages];
      let totalUsageData: any = null;
      let conversationComplete = false;

      while (!conversationComplete) {
        const currentRequest = {
          ...apiRequest,
          messages: continuationMessages
        };

        const stream = this.anthropic.messages.stream(currentRequest);

        // Note: Cannot directly set abort controller on stream due to protected access
        // The stream will be aborted through the provider's abort() method if needed

        let fullContent = '';
        let currentToolUse: any = null;
        let toolInputBuffer = '';
        let isStreamingContent = false;
        let streamContentBuffer = '';
        let streamConfig: any = null;
        let usageData: any = null;
        let assistantContent: any[] = [];
        let toolUses: any[] = [];

        // Stream the response
        for await (const rawChunk of stream as AsyncIterable<any>) {
        const chunk = rawChunk as any;
        console.log('[ClaudeProvider] Chunk received:', {
          type: chunk.type,
          toolName: chunk.content_block?.name,
          deltaType: chunk.delta?.type,
          partialJsonLength: chunk.delta?.partial_json?.length
        });

        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'text') {
            // Text content block
            assistantContent.push({
              type: 'text',
              text: ''
            });
          } else if (chunk.content_block.type === 'tool_use') {
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
            // Update the last text content block
            if (assistantContent.length > 0 && assistantContent[assistantContent.length - 1].type === 'text') {
              assistantContent[assistantContent.length - 1].text += chunk.delta.text;
            }
            yield {
              type: 'text',
              content: chunk.delta.text
            };
          } else if (chunk.delta.type === 'input_json_delta') {
            // Accumulate tool input JSON
            toolInputBuffer += (chunk.delta as any)?.partial_json ?? '';

            console.log('[ClaudeProvider] input_json_delta received:', {
              toolName: currentToolUse?.name,
              isStreamingContent,
              bufferLength: toolInputBuffer.length,
              partialJson: (chunk.delta as any)?.partial_json?.substring(0, 100)
            });

            // Special handling for streamContent tool - stream the content as it arrives
            if (isStreamingContent && currentToolUse?.name === 'streamContent') {
              const partialJson = (chunk.delta as any)?.partial_json;
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
          // Note: toolInputBuffer can be empty string for tools with no parameters
          if (currentToolUse) {
            try {
              // Parse the complete tool input
              if (currentToolUse.name === 'applyDiff') {
                try {
                  console.info('[ClaudeProvider] applyDiff raw input', previewForLog(toolInputBuffer));
                } catch {}
              }

              // Clean the buffer by attempting to parse JSON and handling protocol tag leakage
              // The fine-grained-tool-streaming beta API sometimes appends protocol tags after valid JSON
              let parsedInput;
              try {
                // Empty buffer means no parameters - treat as empty object
                const jsonToParse = toolInputBuffer.trim() || '{}';
                parsedInput = JSON.parse(jsonToParse);
              } catch (firstError) {
                // Try to find where valid JSON ends by looking for the closing brace
                // then removing any trailing garbage (like ]</invoke>})
                // We only want to remove trailing protocol tags, not XML content in the actual data

                // Find the last valid JSON closing brace
                // Strategy: try parsing progressively shorter strings from the end
                let cleaned = toolInputBuffer.trim();

                // Common pattern: valid JSON followed by ]</invoke>} or similar
                // Try removing common protocol tag patterns from the END only
                const protocolTagPatterns = [
                  /]<\/invoke>}$/,
                  /<\/invoke>$/,
                  /]<\/[^>]+>}$/,
                  /<\/[^>]+>$/
                ];

                for (const pattern of protocolTagPatterns) {
                  const testBuffer = cleaned.replace(pattern, '');
                  if (testBuffer !== cleaned) {
                    try {
                      parsedInput = JSON.parse(testBuffer);
                      console.warn('[ClaudeProvider] Removed trailing protocol tag from tool input:', {
                        pattern: pattern.toString(),
                        removed: cleaned.substring(testBuffer.length)
                      });
                      cleaned = testBuffer;
                      break;
                    } catch {
                      // This pattern didn't help, try next
                    }
                  }
                }

                // If still not parsed, throw the original error
                if (!parsedInput) {
                  throw firstError;
                }
              }

              currentToolUse.input = parsedInput;

              // Add tool_use to assistant content for conversation continuation
              assistantContent.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: currentToolUse.input
              });

              // Store tool use for later execution
              toolUses.push(currentToolUse);

              // Prepare optional execution result for tools that run immediately
              let executionResult: any = undefined;

              // Execute ALL tools through the centralized tool handler
              if (this.toolHandler && currentToolUse.name !== 'streamContent') {
                console.log(`[ClaudeProvider] Executing tool: ${currentToolUse.name}`, currentToolUse.input);
                console.log('[ClaudeProvider] Tool handler available:', !!this.toolHandler);
                console.log('[ClaudeProvider] Tool handler.executeTool available:', !!(this.toolHandler as any).executeTool);

                try {
                  // Use the centralized tool executor if available
                  if (this.toolHandler.executeTool) {
                    executionResult = await this.toolHandler.executeTool(currentToolUse.name, currentToolUse.input);
                  } else {
                    // Fallback to specific tool methods
                    switch (currentToolUse.name) {
                      case 'applyDiff':
                        if (this.toolHandler.applyDiff) {
                          executionResult = await this.toolHandler.applyDiff(currentToolUse.input);
                        }
                        break;
                      case 'getDocumentContent':
                        if (this.toolHandler.getDocumentContent) {
                          executionResult = await this.toolHandler.getDocumentContent(currentToolUse.input);
                        }
                        break;
                      case 'updateFrontmatter':
                        if (this.toolHandler.updateFrontmatter) {
                          executionResult = await this.toolHandler.updateFrontmatter(currentToolUse.input);
                        }
                        break;
                      default:
                        console.warn(`[ClaudeProvider] Unknown tool: ${currentToolUse.name}`);
                    }
                  }

                  console.log(`[ClaudeProvider] Tool execution result for ${currentToolUse.name}:`, executionResult);

                  // Store result on tool use for continuation
                  currentToolUse.result = executionResult;

                  if (executionResult && !executionResult.success) {
                    const errorMessage = executionResult.error || `${currentToolUse.name} execution failed`;
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
                } catch (error) {
                  console.error(`[ClaudeProvider] Error executing tool ${currentToolUse.name}:`, error);
                  const errorResult = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
                  currentToolUse.result = errorResult;
                  yield {
                    type: 'tool_error',
                    toolError: {
                      name: currentToolUse.name,
                      arguments: currentToolUse.input,
                      error: error instanceof Error ? error.message : 'Tool execution failed',
                      result: errorResult
                    }
                  };
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
          // Message complete - capture usage if available
          if (chunk.usage) {
            usageData = chunk.usage;
            console.log('[ClaudeProvider] Usage data from message_stop:', usageData);
          }
        }
        }

        // After streaming completes, try to get usage data from finalMessage
        try {
          const finalMessage = await stream.finalMessage();
          if (finalMessage?.usage) {
            usageData = finalMessage.usage;
            console.log('[ClaudeProvider] Usage data from finalMessage:', usageData);
          }
        } catch (e) {
          console.error('[ClaudeProvider] Failed to get final message:', e);
        }

        // Accumulate usage data
        if (usageData) {
          if (!totalUsageData) {
            totalUsageData = { ...usageData };
          } else {
            totalUsageData.input_tokens = (totalUsageData.input_tokens || 0) + (usageData.input_tokens || 0);
            totalUsageData.output_tokens = (totalUsageData.output_tokens || 0) + (usageData.output_tokens || 0);
          }
        }

        // Log assistant response
        if (fullContent) {
          try {
            console.info('[ClaudeProvider] Assistant response', {
              length: fullContent.length,
              preview: previewForLog(fullContent),
              usage: usageData
            });
          } catch {}
        }

        // Check if we need to continue the conversation with tool results
        if (toolUses.length > 0) {
          console.log(`[ClaudeProvider] Got ${toolUses.length} tool uses, continuing conversation...`);

          // Add assistant message with tool uses to conversation
          continuationMessages.push({
            role: 'assistant',
            content: assistantContent
          });

          // Build tool results message
          const toolResults = toolUses.map(toolUse => {
            const result = toolUse.result || { success: true, message: 'Tool executed successfully' };

            // Format the result as a string for Claude
            let resultContent: string;
            if (typeof result === 'string') {
              resultContent = result;
            } else if (result.content) {
              resultContent = result.content;
            } else if (result.message) {
              resultContent = result.message;
            } else {
              resultContent = JSON.stringify(result, null, 2);
            }

            return {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: resultContent,
              ...(result.success === false ? { is_error: true } : {})
            };
          });

          // Add tool results as user message
          continuationMessages.push({
            role: 'user',
            content: toolResults
          });

          console.log('[ClaudeProvider] Continuing with tool results:', JSON.stringify(toolResults, null, 2));

          // Yield a continuation marker so the UI knows we're continuing
          // This helps with debugging and understanding the conversation flow
          yield {
            type: 'text',
            content: '' // Empty content, just marks continuation
          };

          // Continue the loop - don't mark as complete yet
        } else {
          // No tool uses, conversation is complete
          conversationComplete = true;

          // Log the output message
          if (sessionId && fullContent) {
            this.logAgentMessage(sessionId, 'claude', 'output', fullContent, {
              usage: totalUsageData
            });
          }

          // Yield the complete chunk with usage data if available
          yield {
            type: 'complete',
            content: fullContent,
            isComplete: true,
            ...(totalUsageData ? {
              usage: {
                input_tokens: totalUsageData.input_tokens || 0,
                output_tokens: totalUsageData.output_tokens || 0,
                total_tokens: (totalUsageData.input_tokens || 0) + (totalUsageData.output_tokens || 0)
              }
            } : {})
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

        // Log error to database
        this.logError(sessionId, 'claude', error, 'catch_block');

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

  protected buildSystemPrompt(documentContext?: DocumentContext): string {
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
