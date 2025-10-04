/**
 * Main AI service that coordinates providers and sessions
 */

import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { SessionManager, ProviderFactory, ModelRegistry, AIProvider } from '@stravu/runtime/ai/server';
import type { SessionStore } from '@stravu/runtime';
import type {
  DocumentContext,
  Message,
  ProviderConfig,
  ToolHandler,
  DiffArgs,
  DiffResult,
  AIProviderType,
  AIModel,
} from '@stravu/runtime/ai/server/types';
import type { AIMessage } from '@stravu/runtime/ai/types';
import { updateDocumentState } from '../../mcp/httpServer';
import { ToolExecutor, toolRegistry, BUILT_IN_TOOLS } from './tools';
import { logger } from '../../utils/logger';
import { windowStates } from '../../window/WindowManager';

const LOG_PREVIEW_LENGTH = 400;

function previewForLog(value?: string, max: number = LOG_PREVIEW_LENGTH): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export class AIService {
  private sessionManager: SessionManager;
  private settingsStore: Store | null = null;
  // Track providers per window to avoid cross-window conflicts
  private providersByWindow: Map<number, AIProvider> = new Map();

  constructor(sessionStore: SessionStore) {
    this.sessionManager = new SessionManager(sessionStore);

    // Register built-in tools (which now includes file tools)
    console.log('[AIService] Registering built-in tools...');
    for (const tool of BUILT_IN_TOOLS) {
      toolRegistry.register(tool);
      // console.log(`[AIService] Registered tool: ${tool.name}`);
    }

    // Delay initialization until first use
    this.initializeApiKeys();
    this.setupIpcHandlers();

    // Clean up any empty messages from existing sessions on startup
    const cleaned = this.sessionManager.cleanupAllSessions();
    if (cleaned > 0) {
      console.log(`[AIService] Cleaned ${cleaned} empty messages from existing sessions on startup`);
    }
  }

  private getSettingsStore(): Store {
    if (!this.settingsStore) {
      this.settingsStore = new Store({
        name: 'ai-settings',
        schema: {
          defaultProvider: {
            type: 'string',
            default: 'claude-code'
          },
          apiKeys: {
            type: 'object',
            default: {}
          },
          providerSettings: {
            type: 'object',
            default: {}
          }
        }
      });
    }
    return this.settingsStore;
  }

  private initializeApiKeys() {
    // Delay initialization to avoid accessing store before app is ready
    process.nextTick(() => {
      try {
        // Check if we have API key stored
        const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

        // If we have an env variable and no stored key, save it
        if (process.env.ANTHROPIC_API_KEY && !apiKeys['anthropic']) {
          console.log('Initializing API key from environment variable');
          apiKeys['anthropic'] = process.env.ANTHROPIC_API_KEY;
          this.getSettingsStore().set('apiKeys', apiKeys);
        }
      } catch (error) {
        console.error('[AIService] Error initializing API keys:', error);
      }
    });
  }

  private setupIpcHandlers() {
    // Check if any AI provider is configured with usable models
    ipcMain.handle('ai:hasApiKey', async () => {  // Keeping the name for backward compatibility
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;

      // Check Claude/Claude Code (needs API key)
      const hasAnthropicKey = !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY);
      if (hasAnthropicKey) {
        // Claude Code is always available with API key
        // Regular Claude needs to be enabled with models
        const hasClaudeCode = true; // Always available with key
        const hasClaude = providerSettings['claude']?.enabled &&
                         providerSettings['claude']?.models?.length > 0;
        if (hasClaudeCode || hasClaude) return true;
      }

      // Check OpenAI (needs API key and enabled models)
      const hasOpenAIKey = !!(apiKeys['openai'] || process.env.OPENAI_API_KEY);
      if (hasOpenAIKey) {
        const hasOpenAI = providerSettings['openai']?.enabled &&
                         providerSettings['openai']?.models?.length > 0;
        if (hasOpenAI) return true;
      }

      // Check LM Studio (doesn't need API key but needs enabled models)
      const hasLMStudio = providerSettings['lmstudio']?.enabled === true &&
                         providerSettings['lmstudio']?.models?.length > 0;
      if (hasLMStudio) return true;

      return false;
    });

    // Initialize/configure AI
    ipcMain.handle('ai:initialize', async (event, provider?: string, apiKey?: string) => {
      if (apiKey) {
        // Save API key - always save as 'anthropic' since both providers use the same key
        const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
        apiKeys['anthropic'] = apiKey;
        this.getSettingsStore().set('apiKeys', apiKeys);
      }

      return { success: true };
    });

    // Create new session with provider and model selection
    ipcMain.handle('ai:createSession', async (
      event,
      provider: AIProviderType,
      documentContext?: DocumentContext,
      workspacePath?: string,
      modelId?: string
    ) => {
      console.log('[AIService] ai:createSession called:', {
        provider,
        modelId,
        hasDocumentContext: !!documentContext,
        workspacePath
      });

      // Get API key based on provider
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      let apiKey: string | undefined;

      switch (provider) {
        case 'claude':
        case 'claude-code':
          apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            throw new Error('Anthropic API key not configured');
          }
          break;
        case 'openai':
        case 'openai-codex':
          apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;
          if (!apiKey) {
            throw new Error('OpenAI API key not configured');
          }
          break;
        case 'lmstudio':
          // LMStudio doesn't need an API key, just the base URL
          apiKey = 'not-required';
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }

      // Get model details if specified
      let model = modelId;
      if (!model && provider !== 'claude-code') {
        // For non-claude-code providers, try to get a default model
        const defaultModel = ModelRegistry.getDefaultModel(provider);
        model = defaultModel?.id;
      }

      // For claude-code, don't pass a model at all - let it handle its own selection
      const providerConfig: any = {
        maxTokens: this.getProviderSetting(provider, 'maxTokens'),
        temperature: this.getProviderSetting(provider, 'temperature')
      };

      // Only add model to config if we have one and it's not claude-code
      if (model && provider !== 'claude-code') {
        // Strip provider prefix if present (e.g., "openai:gpt-4" -> "gpt-4")
        if (model.includes(':')) {
          providerConfig.model = model.split(':').slice(1).join(':');
        } else {
          providerConfig.model = model;
        }
      } else if (provider !== 'claude-code') {
        // For other providers, fall back to settings
        const settingsModel = this.getProviderSetting(provider, 'model');
        if (settingsModel && settingsModel.includes(':')) {
          providerConfig.model = settingsModel.split(':').slice(1).join(':');
        } else {
          providerConfig.model = settingsModel;
        }
      }

      // Create session
      const session = await this.sessionManager.createSession(
        provider,
        documentContext,
        workspacePath,
        providerConfig,
        model
      );

      // Create and initialize provider
      const providerInstance = ProviderFactory.createProvider(provider, session.id);

      // Build config based on provider type
      const initConfig: any = {
        maxTokens: session.providerConfig?.maxTokens,
        temperature: session.providerConfig?.temperature
      };

      // Claude Code manages its own authentication - do not pass API key
      if (provider !== 'claude-code') {
        initConfig.apiKey = apiKey;
      }

      // Only add model if it exists and provider isn't claude-code or openai-codex
      // Both claude-code and openai-codex manage their own model selection
      if (session.providerConfig?.model && provider !== 'claude-code' && provider !== 'openai-codex') {
        initConfig.model = session.providerConfig.model;
      }

      // Add LMStudio-specific config
      if (provider === 'lmstudio') {
        const lmstudioSettings = this.getSettingsStore().get('providerSettings.lmstudio', {}) as any;
        initConfig.baseUrl = lmstudioSettings.baseUrl || apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
      }

      await providerInstance.initialize(initConfig);

      // Register tool handler with the document context file path
      const targetFilePath = documentContext?.filePath;
      const toolHandler = this.createToolHandler(event.sender, targetFilePath);
      providerInstance.registerToolHandler(toolHandler);

      // Track provider for this window
      this.providersByWindow.set(event.sender.id, providerInstance);

      // Update MCP document state if provided
      if (documentContext) {
        updateDocumentState(documentContext, session.id);
      }

      return session;
    });

    // Send message to AI
    ipcMain.handle('ai:sendMessage', async (
      event,
      message: string,
      documentContext?: DocumentContext,
      sessionId?: string,
      workspacePath?: string
    ) => {
      const startTime = Date.now();
      const perfLog: any = {
        startTime,
        provider: '',
        model: '',
        messageLength: message.length,
        hasDocumentContext: !!documentContext
      };

      // ALWAYS load session by ID - never use "current" session (causes cross-window issues)
      if (!sessionId) {
        throw new Error('No session ID provided - cannot send message');
      }

      // Get workspace path from window state if not provided
      if (!workspacePath) {
        const windowState = windowStates.get(event.sender.id);
        workspacePath = windowState?.workspacePath || undefined;
        console.log(`[AIService] Got workspace path from window ${event.sender.id}:`, workspacePath);
      }

      // Require workspace path for AI operations
      if (!workspacePath) {
        throw new Error('No workspace path available - AI operations require an open workspace');
      }

      const loadStartTime = Date.now();
      const session = await this.sessionManager.loadSession(sessionId, workspacePath);
      perfLog.sessionLoadTime = Date.now() - loadStartTime;

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      console.log(`[AIService] Loaded session ${sessionId} with provider: ${session.provider}, model: ${session.model} (took ${perfLog.sessionLoadTime}ms)`);

      // Verify we got the right session
      if (session.id !== sessionId) {
        console.error(`[AIService] CRITICAL ERROR: Requested session ${sessionId} but got session ${session.id}!`);
        throw new Error(`Session mismatch: requested ${sessionId} but got ${session.id}`);
      }

      // Comprehensive logging of what we're sending to Claude
      console.group('🤖 [AIService] Sending message to AI provider');
      console.log('📝 User Message:', message);
      console.log('🏢 Provider:', session.provider);
      console.log('🤖 Model:', session.model || 'default');
      console.log('📄 Document Context:', {
        hasDocument: !!documentContext,
        filePath: documentContext?.filePath || 'none',
        fileType: documentContext?.fileType || 'none',
        contentLength: documentContext?.content?.length || 0,
      });

      if (documentContext?.content) {
        console.log('📋 Document Content Preview (first 500 chars):',
          documentContext.content.substring(0, 500) +
          (documentContext.content.length > 500 ? '...' : ''));

        // Check for frontmatter
        const frontmatterMatch = documentContext.content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          console.log('🏷️ Document Frontmatter:', frontmatterMatch[1]);
        } else {
          console.log('⚠️ No frontmatter found in document');
        }
      }

      // Show available tools
      const tools = toolRegistry.getAll();
      console.log('🔧 Available Tools:', tools.map(t => t.name));
      console.groupEnd();

      perfLog.provider = session.provider;
      perfLog.model = session.model || 'default';

      // Add user message to session
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now()
      };
      await this.sessionManager.addMessage(userMessage, session.id);

      // Update session title if this is the first user message
      if (session.messages.length === 0 || (session.messages.length === 1 && session.messages[0].role === 'user')) {
        // Generate a title from the first message (truncate to 100 chars)
        const title = message.length > 100 ? message.substring(0, 97) + '...' : message;
        await this.sessionManager.updateSessionTitle(session.id, title);
      }

      // Update MCP document state if provided
      if (documentContext) {
        updateDocumentState(documentContext, sessionId);
      }

      // Get or create provider for this session
      const providerStartTime = Date.now();
      const isProviderClaudeCode = session.provider === 'claude-code';
      
      if (isProviderClaudeCode) {
        console.log('[CLAUDE-CODE-SERVICE] Getting provider for claude-code, session:', session.id);
      }
      
      console.log(`[AIService] Getting provider for: ${session.provider}, sessionId: ${session.id}`);
      let provider = ProviderFactory.getProvider(session.provider, session.id);
      perfLog.getProviderTime = Date.now() - providerStartTime;

      // If provider doesn't exist, create and initialize it
      if (!provider) {
        if (isProviderClaudeCode) {
          console.log('[CLAUDE-CODE-SERVICE] Provider not found, creating new claude-code provider');
        }
        console.log(`[AIService] Provider not found, creating new ${session.provider} provider`);
        const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

        // Get the correct API key based on provider
        let apiKey: string | undefined;
        let errorMessage: string;

        switch (session.provider) {
          case 'claude':
          case 'claude-code':
            apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
            errorMessage = 'Anthropic API key not configured';
            break;
          case 'openai':
          case 'openai-codex':
            apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;
            errorMessage = 'OpenAI API key not configured';
            break;
          case 'lmstudio':
            // LMStudio doesn't need an API key, just the base URL
            apiKey = 'not-required'; // Dummy value since LMStudio doesn't need a key
            break;
          default:
            throw new Error(`Unknown provider: ${session.provider}`);
        }

        if (!apiKey) {
          throw new Error(errorMessage);
        }

        // Create the provider
        if (isProviderClaudeCode) {
          console.log('[CLAUDE-CODE-SERVICE] Creating claude-code provider instance');
        }
        provider = ProviderFactory.createProvider(session.provider, session.id);
        
        if (isProviderClaudeCode) {
          console.log('[CLAUDE-CODE-SERVICE] Provider instance created, preparing config');
        }

        const reinitConfig: any = {
          apiKey,
          maxTokens: session.providerConfig?.maxTokens,
          temperature: session.providerConfig?.temperature
        };

        // Add baseUrl for LMStudio
        if (session.provider === 'lmstudio') {
          reinitConfig.baseUrl = apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
        }

        // Only add model if it exists and provider isn't claude-code
        if ((session.model || session.providerConfig?.model) && session.provider !== 'claude-code') {
          const fullModel = session.model || session.providerConfig?.model;
          console.log('[AIService] Reinitializing provider with model:', {
            sessionModel: session.model,
            providerConfigModel: session.providerConfig?.model,
            fullModel,
            provider: session.provider
          });

          // Strip provider prefix if present (e.g., "claude:claude-sonnet-4" -> "claude-sonnet-4")
          if (fullModel && fullModel.includes(':')) {
            reinitConfig.model = fullModel.split(':').slice(1).join(':');
            console.log('[AIService] Stripped model prefix:', {
              original: fullModel,
              stripped: reinitConfig.model
            });
          } else {
            reinitConfig.model = fullModel;
          }
        }

        if (isProviderClaudeCode) {
          console.log('[CLAUDE-CODE-SERVICE] About to initialize claude-code provider with config:', reinitConfig);
        }
        console.log('[AIService] About to initialize provider with config:', reinitConfig);
        const initStartTime = Date.now();
        
        try {
          await provider.initialize(reinitConfig);
          perfLog.providerInitTime = Date.now() - initStartTime;
          
          if (isProviderClaudeCode) {
            console.log(`[CLAUDE-CODE-SERVICE] Provider initialization completed in ${perfLog.providerInitTime}ms`);
          }
          console.log(`[AIService] Provider initialization took ${perfLog.providerInitTime}ms`);
        } catch (initError) {
          if (isProviderClaudeCode) {
            console.error('[CLAUDE-CODE-SERVICE] Failed to initialize provider:', initError);
            console.error('[CLAUDE-CODE-SERVICE] Init config was:', reinitConfig);
          }
          throw initError;
        }

        // Register tool handler with the session's document context file path
        const targetFilePath = documentContext?.filePath;
        const toolHandler = this.createToolHandler(event.sender, targetFilePath);
        provider.registerToolHandler(toolHandler);
      }

      // Track provider for this window to avoid cross-window conflicts
      this.providersByWindow.set(event.sender.id, provider);
      console.log(`[AIService] Set provider for window ${event.sender.id}: ${session.provider}`);

      try {
        let fullResponse = '';
        const toolCalls: any[] = [];
        const edits: any[] = [];  // Track edits for the assistant message
        let hasStreamingContent = false;  // Track if we used streamContent tool
        let firstChunkTime: number | undefined;
        let chunkCount = 0;
        let textChunks = 0;
        let toolCallCount = 0;

        // Get existing messages from session for context
        const sessionMessages = session.messages || [];

        console.log(`[AIService] Starting message stream (${sessionMessages.length} context messages)`);
        const streamStartTime = Date.now();

        // Send performance metrics to renderer
        event.sender.send('ai:performanceMetrics', {
          phase: 'start',
          provider: session.provider,
          model: session.model || 'default',
          messageLength: message.length,
          contextMessages: sessionMessages.length
        });

        // Stream the response
        const isClaudeCode = session.provider === 'claude-code';
        const logPrefix = isClaudeCode ? '[CLAUDE-CODE-SERVICE]' : '[AIService]';
        console.log(`🚀 ${logPrefix} Starting to stream response from provider: ${session.provider}`);
        
        if (isClaudeCode) {
          console.log(`[CLAUDE-CODE-SERVICE] Calling sendMessage with:`, {
            messageLength: message.length,
            hasContext: !!documentContext,
            sessionId: session.id,
            sessionMessages: sessionMessages.length,
            workspacePath
          });
        }

        for await (const chunk of provider.sendMessage(message, documentContext, session.id, sessionMessages, workspacePath)) {
          chunkCount++;

          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            perfLog.timeToFirstChunk = firstChunkTime - startTime;
            console.log(`${logPrefix} First chunk received after ${perfLog.timeToFirstChunk}ms`);

            // Send first chunk metrics
            event.sender.send('ai:performanceMetrics', {
              phase: 'firstChunk',
              timeToFirstChunk: perfLog.timeToFirstChunk
            });
          }
          switch (chunk.type) {
            case 'text':
              textChunks++;
              const chunkContent = chunk.content || '';
              fullResponse += chunkContent;
              if (isClaudeCode && textChunks <= 5) {
                console.log(`[CLAUDE-CODE-SERVICE] Text chunk #${textChunks}: ${chunkContent.length} chars, first 100:`, chunkContent.substring(0, 100));
              }
              console.log(`${logPrefix} Forwarding text chunk #${textChunks}: ${chunkContent.length} chars, total: ${fullResponse.length}`);
              // Send ACCUMULATED response to renderer (not just the chunk)
              event.sender.send('ai:streamResponse', {
                partial: fullResponse,  // Send the full accumulated text
                isComplete: false
              });
              break;

            case 'tool_call':
              if (chunk.toolCall) {
                toolCallCount++;
                toolCalls.push(chunk.toolCall);
                console.group('🔨 [AIService] Tool call received from AI');
                console.log('Tool name:', chunk.toolCall.name);
                console.log('Tool arguments:', chunk.toolCall.arguments);
                console.groupEnd();
                console.log(`[AIService] Tool call #${toolCallCount}: ${chunk.toolCall.name}`);
                console.log(`[AIService] Tool arguments:`, JSON.stringify(chunk.toolCall.arguments, null, 2));

                const toolName = chunk.toolCall.name;
                const toolArgs = chunk.toolCall.arguments as Record<string, unknown> | undefined;
                const replacementCount = Array.isArray((toolArgs as any)?.replacements)
                  ? (toolArgs as any).replacements.length
                  : undefined;
                logger.ai.info('[AIService] Tool call received', {
                  name: toolName,
                  replacements: replacementCount,
                  argKeys: toolArgs ? Object.keys(toolArgs) : []
                });

                if (toolName === 'applyDiff' && (replacementCount === undefined || replacementCount === 0)) {
                  const rawArgs = toolArgs ? JSON.stringify(toolArgs) : 'null';
                  logger.ai.warn('[AIService] applyDiff payload missing replacements', previewForLog(rawArgs));
                }

                // Save tool call as a separate message in the session
                const toolResult = chunk.toolCall.result as any;
                const isFailedResult = toolResult?.success === false;

                if (!isFailedResult) {
                  const toolMessage: Message = {
                    role: 'tool',
                    content: '',  // Tool messages don't have text content
                    timestamp: Date.now(),
                    toolCall: chunk.toolCall,
                    ...(toolResult !== undefined ? { errorMessage: toolResult?.error, isError: toolResult?.success === false } : {})
                  };
                  await this.sessionManager.addMessage(toolMessage, session.id);
                }

                // Send tool call to renderer
                // For applyDiff (including MCP variants), include it as BOTH an edit AND a toolCall
                if (toolName === 'applyDiff' || toolName?.endsWith('__applyDiff')) {
                  const edit = {
                    type: 'diff',
                    replacements: chunk.toolCall.arguments.replacements,
                    // MCP edits are applied automatically by the MCP server
                    applied: toolName?.endsWith('__applyDiff')
                  };
                  edits.push(edit);  // Save edit for the assistant message

                  if (!Array.isArray(edit.replacements) || edit.replacements.length === 0) {
                    logger.ai.warn('[AIService] Forwarding applyDiff edit without replacements');
                  } else {
                    logger.ai.info('[AIService] Forwarding applyDiff edit', {
                      count: edit.replacements.length
                    });
                  }

                  event.sender.send('ai:streamResponse', {
                    partial: '',
                    isComplete: false,
                    edits: [edit],
                    toolCalls: [chunk.toolCall]  // Also send as toolCall so it displays in chat
                  });
                } else if (chunk.toolCall.name === 'streamContent') {
                  // Mark that we used streamContent - we'll handle this specially
                  hasStreamingContent = true;
                } else {
                  // For other tools, just send the tool call
                  event.sender.send('ai:streamResponse', {
                    partial: '',
                    isComplete: false,
                    toolCalls: [chunk.toolCall]
                  });
                }
              }
              break;

            case 'tool_error':
              if (chunk.toolError) {
                logger.ai.warn('[AIService] Tool error reported', {
                  name: chunk.toolError.name,
                  error: chunk.toolError.error
                });

                const errorMessage: Message = {
                  role: 'tool',
                  content: '',
                  timestamp: Date.now(),
                  toolCall: {
                    name: chunk.toolError.name,
                    arguments: chunk.toolError.arguments,
                    result: chunk.toolError.result
                  },
                  isError: true,
                  errorMessage: chunk.toolError.error
                };
                await this.sessionManager.addMessage(errorMessage, session.id);

                event.sender.send('ai:streamResponse', {
                  partial: '',
                  isComplete: false,
                  toolError: chunk.toolError
                });
              }
              break;

            case 'stream_edit_start':
              // Forward streaming edit start event to renderer
              console.log('[AIService] Forwarding stream_edit_start to renderer:', chunk.config);
              event.sender.send('ai:streamEditStart', chunk.config);
              hasStreamingContent = true;  // Mark that we're doing streaming
              break;

            case 'stream_edit_content':
              // Forward streaming content to renderer
              console.log('[AIService] Forwarding stream_edit_content to renderer:', chunk.content?.substring(0, 50));
              event.sender.send('ai:streamEditContent', chunk.content);
              break;

            case 'stream_edit_end':
              // Forward streaming end event to renderer
              console.log('[AIService] Forwarding stream_edit_end to renderer');
              event.sender.send('ai:streamEditEnd', chunk.error ? { error: chunk.error } : {});
              break;

            case 'error':
              if (isClaudeCode) {
                console.error('[CLAUDE-CODE-SERVICE] ERROR FROM PROVIDER:', chunk.error);
                console.error('[CLAUDE-CODE-SERVICE] Error context:', {
                  chunksSoFar: chunkCount,
                  textChunksSoFar: textChunks,
                  responseLengthSoFar: fullResponse.length,
                  timeElapsed: Date.now() - startTime
                });
              }
              console.error(`${logPrefix} Provider error:`, chunk.error);
              event.sender.send('ai:error', {
                message: chunk.error || 'Unknown error occurred'
              });
              break;

            case 'complete':
              if (isClaudeCode) {
                console.log('[CLAUDE-CODE-SERVICE] COMPLETE CHUNK RECEIVED!');
                console.log('[CLAUDE-CODE-SERVICE] Final response length:', fullResponse.length);
              }
              console.log(`${logPrefix} COMPLETE CHUNK RECEIVED! Sending completion signal to UI`);
              perfLog.totalTime = Date.now() - startTime;
              perfLog.streamTime = Date.now() - streamStartTime;
              perfLog.chunkCount = chunkCount;
              perfLog.textChunks = textChunks;
              perfLog.toolCallCount = toolCallCount;
              perfLog.responseLength = fullResponse.length;

              // Capture token usage if available
              const tokenUsage = chunk.usage;

              console.log('[AIService] Stream complete - Performance metrics:', perfLog);
              if (tokenUsage) {
                console.log('[AIService] Token usage:', tokenUsage);
              }
              if (fullResponse) {
                logger.ai.info('[AIService] Assistant final response', {
                  length: fullResponse.length,
                  preview: previewForLog(fullResponse)
                });
              } else {
                logger.ai.info('[AIService] Assistant response empty', {
                  edits: edits.length,
                  streamed: hasStreamingContent,
                  toolCalls: toolCallCount
                });
              }
              if (edits.length > 0) {
                logger.ai.info('[AIService] Collected edits', {
                  editCount: edits.length,
                  replacementCounts: edits.map(edit => Array.isArray(edit.replacements) ? edit.replacements.length : 0)
                });
              }

              // Send completion metrics with token usage if available
              event.sender.send('ai:performanceMetrics', {
                phase: 'complete',
                totalTime: perfLog.totalTime,
                streamTime: perfLog.streamTime,
                chunkCount: chunkCount,
                textChunks: textChunks,
                toolCallCount: toolCallCount,
                responseLength: fullResponse.length,
                ...(tokenUsage && { tokenUsage })
              });

              // Only add assistant message if there's actual content or edits
              if (fullResponse && fullResponse.trim() !== '') {
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: fullResponse,
                  timestamp: Date.now(),
                  ...(edits.length > 0 && { edits }),  // Include edits if any
                  ...(tokenUsage && { tokenUsage })  // Include token usage if available
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (edits.length > 0) {
                // If there were edits but no text response
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '',  // Empty content since the action was just edits
                  timestamp: Date.now(),
                  edits,
                  ...(tokenUsage && { tokenUsage })  // Include token usage if available
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (hasStreamingContent) {
                // If we used streamContent, add a message to track it
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '',  // Content was streamed directly to editor
                  timestamp: Date.now(),
                  isStreamingStatus: true,
                  streamingData: {
                    position: 'document',
                    mode: 'after',
                    content: '[Content streamed to editor]',
                    isActive: false
                  },
                  ...(tokenUsage && { tokenUsage })  // Include token usage if available
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (toolCalls.length > 0) {
                // If there were only other tool calls and no text
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '[Tool calls executed]',
                  timestamp: Date.now(),
                  ...(tokenUsage && { tokenUsage })  // Include token usage if available
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              }

              // Update provider session data if available
              if (provider.getProviderSessionData) {
                const providerData = provider.getProviderSessionData(session.id);
                if (providerData?.claudeSessionId) {
                  await this.sessionManager.updateProviderSessionData(session.id, providerData.claudeSessionId);
                }
              }

              // Send complete response
              console.log('[AIService] Sending FINAL ai:streamResponse with isComplete=true, content length:', fullResponse.length);
              event.sender.send('ai:streamResponse', {
                content: fullResponse,
                isComplete: true
              });
              console.log('[AIService] COMPLETION SIGNAL SENT TO UI!');
              break;
          }
        }

        return { content: fullResponse };
      } catch (error) {
        const errorTime = Date.now() - startTime;
        
        if (isClaudeCode) {
          console.error('[CLAUDE-CODE-SERVICE] ========== CRITICAL ERROR ==========');
          console.error('[CLAUDE-CODE-SERVICE] Error caught in stream handler:', error);
          console.error('[CLAUDE-CODE-SERVICE] Error type:', error instanceof Error ? error.constructor.name : typeof error);
          console.error('[CLAUDE-CODE-SERVICE] Error message:', error instanceof Error ? error.message : String(error));
          console.error('[CLAUDE-CODE-SERVICE] Error stack:', error instanceof Error ? error.stack : 'No stack');
          console.error('[CLAUDE-CODE-SERVICE] Context:', {
            errorTime,
            chunksReceived: chunkCount,
            textChunks: textChunks,
            responseLength: fullResponse.length
          });
        }
        
        console.error(`${logPrefix} Error after ${errorTime}ms:`, error);

        // Send error metrics
        event.sender.send('ai:performanceMetrics', {
          phase: 'error',
          errorTime,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // Send error to renderer
        event.sender.send('ai:error', {
          message: error instanceof Error ? error.message : 'Unknown error occurred'
        });

        throw error;
      }
    });

    // Get session history
    ipcMain.handle('ai:getSessions', async (event, workspacePath?: string) => {
      return await this.sessionManager.getSessions(workspacePath);
    });

    // Load a session
    ipcMain.handle('ai:loadSession', async (event, sessionId: string, workspacePath?: string) => {
      const session = await this.sessionManager.loadSession(sessionId, workspacePath);
      if (!session) {
        console.log(`[SESSION] Session not found: ${sessionId} (this is normal if the session was deleted)`);
        return null;
      }
      return session;
    });

    // Clear session
    ipcMain.handle('ai:clearSession', async () => {
      this.sessionManager.clearCurrentSession();

      // Abort any ongoing request
      // Abort the provider for this specific window
      const windowId = event.sender.id;
      const provider = this.providersByWindow.get(windowId);
      if (provider) {
        provider.abort();
        console.log(`[AIService] Aborted provider for window ${windowId}`);
      }

      return { success: true };
    });

    // Update session messages
    ipcMain.handle('ai:updateSessionMessages', async (
      event,
      sessionId: string,
      messages: Message[],
      workspacePath?: string
    ) => {
      const success = await this.sessionManager.updateSessionMessages(sessionId, messages, workspacePath);
      return { success };
    });

    // Save draft input
    ipcMain.handle('ai:saveDraftInput', async (
      event,
      sessionId: string,
      draftInput: string,
      workspacePath?: string
    ) => {
      const success = await this.sessionManager.saveDraftInput(sessionId, draftInput, workspacePath);
      return { success };
    });

    // Clean up empty messages from all sessions
    ipcMain.handle('ai:cleanupEmptyMessages', async () => {
      const cleaned = this.sessionManager.cleanupAllSessions();
      console.log(`[AIService] Manual cleanup: removed ${cleaned} empty messages`);
      return { success: true, cleaned };
    });

    // Delete session
    ipcMain.handle('ai:deleteSession', async (event, sessionId: string, workspacePath?: string) => {
      const success = await this.sessionManager.deleteSession(sessionId, workspacePath);

      // Clean up provider if it exists
      if (success) {
        ProviderFactory.destroyProvider(sessionId);
      }

      return { success };
    });

    // Cancel current request
    ipcMain.handle('ai:cancelRequest', async (event) => {
      // Abort the provider for this specific window
      const windowId = event.sender.id;
      const provider = this.providersByWindow.get(windowId);
      if (provider) {
        provider.abort();
        console.log(`[AIService] Cancelled request for window ${windowId}`);
        return { success: true };
      }
      return { success: false, error: 'No active request to cancel' };
    });

    // Settings handlers
    ipcMain.handle('ai:getSettings', async () => {
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;

      return {
        defaultProvider: this.getSettingsStore().get('defaultProvider', 'claude-code'),
        apiKeys: this.maskApiKeys(apiKeys),
        providerSettings
      };
    });

    ipcMain.handle('ai:saveSettings', async (event, settings: any) => {
      if (settings.defaultProvider) {
        this.getSettingsStore().set('defaultProvider', settings.defaultProvider);
      }

      if (settings.apiKeys) {
        // Only update changed API keys
        const currentKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

        // Save Anthropic key
        if (settings.apiKeys.anthropic !== undefined) {
          const key = settings.apiKeys.anthropic;
          if (key && key !== this.maskApiKey(currentKeys['anthropic'] || '')) {
            currentKeys['anthropic'] = key as string;
          }
        }

        // Save OpenAI key
        if (settings.apiKeys.openai !== undefined) {
          const key = settings.apiKeys.openai;
          if (key && key !== this.maskApiKey(currentKeys['openai'] || '')) {
            currentKeys['openai'] = key as string;
          }
        }

        // Save LMStudio URL
        if (settings.apiKeys.lmstudio_url !== undefined) {
          currentKeys['lmstudio_url'] = settings.apiKeys.lmstudio_url as string;
        }

        this.getSettingsStore().set('apiKeys', currentKeys);
      }

      if (settings.providerSettings) {
        this.getSettingsStore().set('providerSettings', settings.providerSettings);
      }

      return { success: true };
    });

    // Test connection
    ipcMain.handle('ai:testConnection', async (event, provider: string) => {
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      // Get the appropriate API key based on provider
      let apiKey: string | undefined;
      switch (provider) {
        case 'claude':
        case 'claude-code':
          apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            return { success: false, error: 'Anthropic API key not configured' };
          }
          break;
        case 'openai':
        case 'openai-codex':
          apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;
          if (!apiKey) {
            return { success: false, error: 'OpenAI API key not configured' };
          }
          break;
        case 'lmstudio':
          // LMStudio doesn't need an API key, just test the connection
          apiKey = 'not-required';
          break;
        default:
          return { success: false, error: `Unknown provider: ${provider}` };
      }

      try {
        // For OpenAI, just try to list models as a connection test
        if (provider === 'openai') {
          const models = await ModelRegistry.getModelsForProvider('openai', apiKey);
          return { success: models.length > 0, provider };
        }

        // For OpenAI Codex, just check if API key is present (CLI will validate on use)
        if (provider === 'openai-codex') {
          // We already checked for API key above, so just return success
          return { success: true, provider };
        }

        // For Claude providers, test the API connection
        if (provider === 'claude') {
          console.log('[AIService] testConnection - Testing provider:', provider);

          // Create provider with appropriate config
          const config: any = { apiKey };

          const testProvider = new (await import('@stravu/runtime/ai/server/providers/ClaudeProvider')).ClaudeProvider();

          // Use the provider's default model for testing (already includes prefix)
          const defaultModel = await ModelRegistry.getDefaultModel('claude');
          console.log('[AIService] testConnection - Got default model:', defaultModel);
          config.model = defaultModel;
          console.log('[AIService] testConnection - Initializing with config:', config);
          await testProvider.initialize(config);

          console.log('[AIService] Testing connection by sending a simple message...');
          // Try a simple message
          const response = testProvider.sendMessage('Say "Hello" in one word');
          for await (const chunk of response) {
            if (chunk.type === 'error') {
              throw new Error(chunk.error);
            }
          }
          testProvider.destroy();
        }

        // For Claude Code, just verify the API key works with the regular Claude API
        if (provider === 'claude-code') {
          console.log('[AIService] testConnection - Testing Claude Code provider');

          // Test using the regular Claude API to verify the key
          const testProvider = new (await import('@stravu/runtime/ai/server/providers/ClaudeProvider')).ClaudeProvider();
          const config: any = {
            apiKey,
            model: 'claude-3-5-sonnet-20241022'
          };

          await testProvider.initialize(config);

          // Quick test message
          const response = testProvider.sendMessage('Say "Hello" in one word');
          for await (const chunk of response) {
            if (chunk.type === 'error') {
              throw new Error(chunk.error);
            }
            // Exit after first response
            if (chunk.type === 'text') {
              break;
            }
          }
          testProvider.destroy();
        }

        // For LMStudio, test the endpoint
        if (provider === 'lmstudio') {
          const baseUrl = apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
          const response = await fetch(`${baseUrl}/v1/models`);
          if (!response.ok) {
            throw new Error(`LMStudio server not responding at ${baseUrl}`);
          }
        }

        return { success: true, provider };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Get ALL available models for configuration UI
    ipcMain.handle('ai:getAllModels', async () => {
      console.log('[AIService] ai:getAllModels called');

      // Clear cache to get fresh models
      ModelRegistry.clearCache();

      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      console.log('[AIService] ai:getAllModels - API keys available:', {
        anthropic: !!apiKeys['anthropic'],
        openai: !!apiKeys['openai'],
        lmstudio_url: apiKeys['lmstudio_url']
      });

      // Get all models - pass provider settings for LMStudio URL
      const modelsConfig = {
        ...apiKeys,
        lmstudio_url: providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234'
      };
      const allModels = await ModelRegistry.getAllModels(modelsConfig);

      // Group ALL models by provider (for configuration UI)
      const grouped: Record<string, any[]> = {};
      for (const model of allModels) {
        if (!grouped[model.provider]) {
          grouped[model.provider] = [];
        }
        grouped[model.provider].push(model);
      }

      return {
        success: true,
        models: allModels,
        grouped
      };
    });

    // Clear model cache
    ipcMain.handle('ai:clearModelCache', async () => {
      ModelRegistry.clearCache();
      return { success: true };
    });

    // Get ENABLED models for actual use
    ipcMain.handle('ai:getModels', async () => {
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      // Get all models - pass provider settings for LMStudio URL
      const modelsConfig = {
        ...apiKeys,
        lmstudio_url: providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234'
      };
      const allModels = await ModelRegistry.getAllModels(modelsConfig);

      // Build enabled providers map
      const enabledProviders: Record<AIProviderType, { enabled: boolean; models?: string[] }> = {
        'claude': {
          enabled: providerSettings['claude']?.enabled === true && !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY),
          models: providerSettings['claude']?.models
        },
        'claude-code': {
          // Claude Code is always available if API key exists (it's the MCP integration)
          enabled: !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY),
          models: providerSettings['claude-code']?.models
        },
        'openai': {
          enabled: providerSettings['openai']?.enabled === true && !!(apiKeys['openai'] || process.env.OPENAI_API_KEY),
          models: providerSettings['openai']?.models
        },
        'openai-codex': {
          enabled: providerSettings['openai-codex']?.enabled === true && !!(apiKeys['openai'] || process.env.OPENAI_API_KEY),
          models: providerSettings['openai-codex']?.models
        },
        'lmstudio': {
          enabled: providerSettings['lmstudio']?.enabled === true,
          models: providerSettings['lmstudio']?.models
        }
      };

      // Filter to only enabled models
      const enabledModels = allModels.filter(model => {
        const provider = enabledProviders[model.provider as AIProviderType];
        if (model.provider === 'openai-codex') {
          console.log('[AIService] Filtering openai-codex model:', {
            modelId: model.id,
            providerEnabled: provider?.enabled,
            selectedModels: provider?.models
          });
        }
        if (!provider?.enabled) return false;
        // If specific models are selected, filter to those
        if (provider.models && provider.models.length > 0) {
          return provider.models.includes(model.id);
        }
        // Otherwise include all models for this provider
        return true;
      });

      // Group ENABLED models by provider (not all models)
      const grouped: Record<string, any[]> = {};
      for (const model of enabledModels) {
        if (!grouped[model.provider]) {
          grouped[model.provider] = [];
        }
        grouped[model.provider].push(model);
      }

      return {
        success: true,
        models: enabledModels.map(m => ({
          id: m.id,
          display_name: m.name,
          provider: m.provider,
          maxTokens: m.maxTokens
        })),
        grouped,  // This now contains only enabled models
        providers: enabledProviders
      };
    });

    // MCP integration for applyDiff results
    ipcMain.handle('mcp:applyDiff:result', async (event, resultChannel: string, result: any) => {
      // Forward result back through the result channel
      event.sender.send(resultChannel, result);
    });
  }

  private createToolHandler(webContents: Electron.WebContents, targetFilePath?: string): ToolHandler {
    const executor = new ToolExecutor(webContents);

    return {
      applyDiff: async (args: DiffArgs): Promise<DiffResult> => {
        // Pass the targetFilePath along with the diff args
        return executor.applyDiff({ ...args, targetFilePath });
      },
      executeTool: async (name: string, args: any): Promise<any> => {
        return executor.executeTool(name, args);
      }
    };
  }

  private getProviderSetting(provider: string, key: string): any {
    const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
    return providerSettings[provider]?.[key];
  }

  private maskApiKey(key: string): string {
    if (!key || key.length <= 20) return key;
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  }

  private maskApiKeys(keys: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [provider, key] of Object.entries(keys)) {
      masked[provider] = this.maskApiKey(key);
    }
    return masked;
  }

  public destroy() {
    try {
      // Clean up all providers with error handling
      ProviderFactory.destroyAll();
    } catch (error) {
      console.error('[AIService] Error destroying providers:', error);
      // Continue destruction even if providers fail
    }

    // Clear any remaining references
    try {
      this.sessionManager = null as any;
      this.settingsStore = null;
    } catch (error) {
      console.error('[AIService] Error clearing references:', error);
    }
  }
}
