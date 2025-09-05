/**
 * OpenAI provider using OpenAI SDK
 */

import OpenAI from 'openai';
import { BaseAIProvider } from '../AIProvider';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk,
  Message,
  AIModel
} from '../types';
import { OPENAI_MODELS, DEFAULT_MODELS } from '../../../../shared/modelConstants';

export class OpenAIProvider extends BaseAIProvider {
  private openai: OpenAI | null = null;
  private abortController: AbortController | null = null;

  static readonly DEFAULT_MODEL = DEFAULT_MODELS.openai;

  async initialize(config: ProviderConfig): Promise<void> {
    const initStartTime = Date.now();
    console.log(`[OpenAIProvider] Initializing with config:`, {
      hasApiKey: !!config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens
    });
    
    this.config = config;
    
    if (!config.apiKey) {
      throw new Error('API key required for OpenAI provider');
    }

    // For GPT-5, use a shorter timeout to see if it helps
    const timeout = config.model === 'gpt-5' ? 15000 : 60000;
    console.log(`[OpenAIProvider] Creating OpenAI client with timeout: ${timeout}ms, maxRetries: 0`);
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      timeout,
      maxRetries: 0,  // NO RETRIES - fail fast
      dangerouslyAllowBrowser: false  // We're in Node.js/Electron main process
    });
    console.log(`[OpenAIProvider] OpenAI client created`);
    console.log(`[OpenAIProvider] Initialized in ${Date.now() - initStartTime}ms`);
  }

  async *sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[]
  ): AsyncIterableIterator<StreamChunk> {
    const startTime = Date.now();
    console.log(`[OpenAIProvider] Starting sendMessage - message length: ${message.length}, hasContext: ${!!documentContext}, contextMessages: ${messages?.length || 0}`);
    
    if (!this.openai) {
      throw new Error('OpenAI provider not initialized');
    }

    // Build system prompt with document context
    const promptStartTime = Date.now();
    const systemPrompt = this.buildSystemPrompt(documentContext);
    console.log(`[OpenAIProvider] System prompt built in ${Date.now() - promptStartTime}ms, length: ${systemPrompt.length}`);

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Build messages array for OpenAI API
    const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add existing messages if provided
    if (messages && messages.length > 0) {
      console.log(`[OpenAIProvider] Processing ${messages.length} context messages`);
      for (const msg of messages) {
        // Skip messages with empty content
        if (!msg.content || msg.content.trim() === '') {
          console.warn('[OpenAIProvider] Skipping message with empty content:', msg);
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
      
      // Remove provider prefix from model ID for API call
      const modelId = this.config.model.replace('openai:', '');
      console.log(`[OpenAIProvider] Using model: ${modelId}`);
      
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
      
      console.log(`[OpenAIProvider] Calling OpenAI API with ${apiMessages.length} messages`);
      console.log(`[OpenAIProvider] Request params:`, {
        model: completionParams.model,
        messageCount: completionParams.messages.length,
        temperature: completionParams.temperature,
        max_tokens: completionParams.max_tokens,
        max_completion_tokens: completionParams.max_completion_tokens,
        tools: completionParams.tools?.length,
        stream: completionParams.stream
      });
      console.log(`[OpenAIProvider] Actual completionParams keys:`, Object.keys(completionParams));
      
      const apiCallStartTime = Date.now();
      
      console.log(`[OpenAIProvider] About to call OpenAI completions.create...`);
      console.log(`[OpenAIProvider] Full API URL: https://api.openai.com/v1/chat/completions`);
      console.log(`[OpenAIProvider] Headers: Authorization: Bearer ${this.config.apiKey?.substring(0, 10)}...`);
      
      let response;
      try {
        const createStartTime = Date.now();
        console.log(`[OpenAIProvider] Calling openai.chat.completions.create at ${new Date().toISOString()}`);
        
        const beforeAwait = Date.now();
        
        // Write debug info to file
        const debugFile = path.join(os.tmpdir(), 'openai-debug.log');
        fs.appendFileSync(debugFile, `\n[${new Date().toISOString()}] About to call OpenAI API with model: ${completionParams.model}\n`);
        
        // Track if we're in Electron
        console.log(`[OpenAIProvider] Running in Electron: ${!!process.versions.electron}`);
        console.log(`[OpenAIProvider] Process type: ${process.type || 'node'}`);
        
        response = await this.openai.chat.completions.create(completionParams, {
          signal: this.abortController.signal
        });
        
        const afterAwait = Date.now();
        fs.appendFileSync(debugFile, `[${new Date().toISOString()}] API call returned after ${afterAwait - beforeAwait}ms\n`);
        console.log(`[OpenAIProvider] await returned after ${afterAwait - beforeAwait}ms`);
        
        console.log(`[OpenAIProvider] completions.create returned after ${Date.now() - createStartTime}ms`);
        console.log(`[OpenAIProvider] Response type: ${typeof response}, has Symbol.asyncIterator: ${!!response[Symbol.asyncIterator]}`);
      } catch (error: any) {
        console.error(`[OpenAIProvider] completions.create failed after ${Date.now() - apiCallStartTime}ms:`, error);
        console.error(`[OpenAIProvider] Error details:`, {
          name: error.name,
          message: error.message,
          status: error.status,
          code: error.code,
          type: error.type
        });
        throw error;
      }
      console.log(`[OpenAIProvider] Got response object after ${Date.now() - apiCallStartTime}ms`);

      let fullContent = '';
      let currentToolCall: any = null;
      let toolCallAccumulator: any = {};
      let chunkCount = 0;
      let firstChunkTime: number | undefined;
      let toolCallCount = 0;

      // Stream the response
      console.log(`[OpenAIProvider] About to start iterating response stream at ${new Date().toISOString()}`);
      const iteratorStartTime = Date.now();
      
      // Add a timeout check
      const timeoutCheck = setTimeout(() => {
        if (!firstChunkTime) {
          console.warn(`[OpenAIProvider] WARNING: No chunks received after 5 seconds of iteration`);
        }
      }, 5000);
      
      for await (const chunk of response) {
        if (chunkCount === 0) {
          console.log(`[OpenAIProvider] Iteration started, first chunk arriving after ${Date.now() - iteratorStartTime}ms`);
        }
        chunkCount++;
        
        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          clearTimeout(timeoutCheck);  // Clear the timeout check
          const timeToFirstChunk = firstChunkTime - apiCallStartTime;
          const timeFromIteratorStart = firstChunkTime - iteratorStartTime;
          console.log(`[OpenAIProvider] First chunk received:`);
          console.log(`  - Time from API call start: ${timeToFirstChunk}ms`);
          console.log(`  - Time from iterator start: ${timeFromIteratorStart}ms`);
          console.log(`  - Total time from request start: ${firstChunkTime - startTime}ms`);
          console.log(`  - Chunk data:`, chunk?.choices?.[0]?.delta);
        }
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
            toolCallCount++;
            try {
              const args = JSON.parse(toolCall.function.arguments);
              console.log(`[OpenAIProvider] Tool call #${toolCallCount}: ${toolCall.function.name}`);
              
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
                  const toolStartTime = Date.now();
                  const result = await this.toolHandler.applyDiff(args);
                  console.log(`[OpenAIProvider] Tool execution completed in ${Date.now() - toolStartTime}ms:`, result);
                }
              }
            } catch (error) {
              console.error(`[OpenAIProvider] Error parsing tool arguments for call ${callId}:`, error);
            }
          }
        }
        
        if (chunk.choices[0]?.finish_reason === 'stop') {
          // Message complete
          const totalTime = Date.now() - startTime;
          console.log(`[OpenAIProvider] Stream complete - Total time: ${totalTime}ms, Chunks: ${chunkCount}, Tool calls: ${toolCallCount}, Content length: ${fullContent.length}`);
          
          yield {
            type: 'complete',
            content: fullContent,
            isComplete: true
          };
        }
      }

    } catch (error: any) {
      const errorTime = Date.now() - startTime;
      if (error.name === 'AbortError') {
        console.log(`[OpenAIProvider] Request was aborted after ${errorTime}ms`);
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error(`[OpenAIProvider] Error after ${errorTime}ms:`, error);
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

  /**
   * Get available OpenAI models (filtered from API response)
   */
  static async getModels(apiKey?: string): Promise<AIModel[]> {
    if (!apiKey) return this.getDefaultModels();

    try {
      console.log('[OpenAIProvider] Fetching available models from OpenAI API');
      const modelFetchStart = Date.now();
      const openai = new OpenAI({ apiKey });
      const response = await openai.models.list();
      console.log(`[OpenAIProvider] Fetched ${response.data.length} models in ${Date.now() - modelFetchStart}ms`);
      
      // Filter to only allowed models
      const availableIds = new Set(response.data.map(m => m.id));
      const filtered: AIModel[] = [];
      
      for (const model of OPENAI_MODELS) {
        if (availableIds.has(model.id)) {
          filtered.push({
            id: `openai:${model.id}`,
            name: model.displayName,
            provider: 'openai' as const,
            maxTokens: model.maxTokens,
            contextWindow: model.contextWindow
          });
        }
      }
      
      console.log(`[OpenAIProvider] Filtered to ${filtered.length} allowed models`);
      return filtered.length > 0 ? filtered : [];
    } catch (error) {
      console.error('[OpenAIProvider] Failed to fetch models:', error);
      return [];
    }
  }

  /**
   * Get default models
   */
  static getDefaultModels(): AIModel[] {
    return OPENAI_MODELS.map(model => ({
      id: `openai:${model.id}`,
      name: model.displayName,
      provider: 'openai' as const,
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
    const cleanId = modelId.replace('openai:', '');
    // Check if it's in our allowed list
    return OPENAI_MODELS.some(m => m.id === cleanId) ||
           cleanId.startsWith('gpt-5') ||
           cleanId.startsWith('gpt-4');
  }
}