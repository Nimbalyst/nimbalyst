/**
 * Main AI service that coordinates providers and sessions
 */

import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { SessionManager } from './SessionManager';
import { ProviderFactory } from './ProviderFactory';
import { ModelRegistry } from './ModelRegistry';
import { AIProvider } from './AIProvider';
import {
  DocumentContext,
  Message,
  ProviderConfig,
  ToolHandler,
  DiffArgs,
  DiffResult,
  AIProviderType,
  AIModel
} from './types';
import { updateDocumentState } from '../../mcp/httpServer';
import { ToolExecutor, toolRegistry, BUILT_IN_TOOLS } from './tools';
import { logger } from '../../utils/logger';

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

  constructor() {
    this.sessionManager = new SessionManager();
    
    // Register built-in tools
    console.log('[AIService] Registering built-in tools...');
    for (const tool of BUILT_IN_TOOLS) {
      toolRegistry.register(tool);
      console.log(`[AIService] Registered tool: ${tool.name}`);
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
      projectPath?: string,
      modelId?: string
    ) => {
      console.log('[AIService] ai:createSession called:', {
        provider,
        modelId,
        hasDocumentContext: !!documentContext,
        projectPath
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
        projectPath,
        providerConfig,
        model
      );

      // Create and initialize provider
      const providerInstance = ProviderFactory.createProvider(provider, session.id);

      // Build config based on provider type
      const initConfig: any = {
        apiKey,
        maxTokens: session.providerConfig?.maxTokens,
        temperature: session.providerConfig?.temperature
      };

      // Only add model if it exists and provider isn't claude-code
      if (session.providerConfig?.model && provider !== 'claude-code') {
        initConfig.model = session.providerConfig.model;
      }

      // Add LMStudio-specific config
      if (provider === 'lmstudio') {
        const lmstudioSettings = this.getSettingsStore().get('providerSettings.lmstudio', {}) as any;
        initConfig.baseUrl = lmstudioSettings.baseUrl || apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
      }

      await providerInstance.initialize(initConfig);

      // Register tool handler
      const toolHandler = this.createToolHandler(event.sender);
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
      projectPath?: string
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
      
      const loadStartTime = Date.now();
      const session = this.sessionManager.loadSession(sessionId, projectPath);
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

      perfLog.provider = session.provider;
      perfLog.model = session.model || 'default';

      // Add user message to session
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now()
      };
      this.sessionManager.addMessage(userMessage, session.id);

      // Update MCP document state if provided
      if (documentContext) {
        updateDocumentState(documentContext, sessionId);
      }

      // Get or create provider for this session
      const providerStartTime = Date.now();
      console.log(`[AIService] Getting provider for: ${session.provider}, sessionId: ${session.id}`);
      let provider = ProviderFactory.getProvider(session.provider, session.id);
      perfLog.getProviderTime = Date.now() - providerStartTime;

      // If provider doesn't exist, create and initialize it
      if (!provider) {
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
        provider = ProviderFactory.createProvider(session.provider, session.id);

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

        console.log('[AIService] About to initialize provider with config:', reinitConfig);
        const initStartTime = Date.now();
        await provider.initialize(reinitConfig);
        perfLog.providerInitTime = Date.now() - initStartTime;
        console.log(`[AIService] Provider initialization took ${perfLog.providerInitTime}ms`);

        // Register tool handler
        const toolHandler = this.createToolHandler(event.sender);
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
        for await (const chunk of provider.sendMessage(message, documentContext, session.id, sessionMessages)) {
          chunkCount++;
          
          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            perfLog.timeToFirstChunk = firstChunkTime - startTime;
            console.log(`[AIService] First chunk received after ${perfLog.timeToFirstChunk}ms`);
            
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
              console.log(`[AIService] Forwarding text chunk #${textChunks}: ${chunkContent.length} chars, total: ${fullResponse.length}`);
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
                console.log(`[AIService] Tool call #${toolCallCount}: ${chunk.toolCall.name}`);

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
                  this.sessionManager.addMessage(toolMessage, session.id);
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
                this.sessionManager.addMessage(errorMessage, session.id);

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
              console.error('Provider error:', chunk.error);
              event.sender.send('ai:error', {
                message: chunk.error || 'Unknown error occurred'
              });
              break;

            case 'complete':
              perfLog.totalTime = Date.now() - startTime;
              perfLog.streamTime = Date.now() - streamStartTime;
              perfLog.chunkCount = chunkCount;
              perfLog.textChunks = textChunks;
              perfLog.toolCallCount = toolCallCount;
              perfLog.responseLength = fullResponse.length;
              
              console.log('[AIService] Stream complete - Performance metrics:', perfLog);
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
              
              // Send completion metrics
              event.sender.send('ai:performanceMetrics', {
                phase: 'complete',
                totalTime: perfLog.totalTime,
                streamTime: perfLog.streamTime,
                chunkCount: chunkCount,
                textChunks: textChunks,
                toolCallCount: toolCallCount,
                responseLength: fullResponse.length
              });
              
              // Only add assistant message if there's actual content or edits
              if (fullResponse && fullResponse.trim() !== '') {
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: fullResponse,
                  timestamp: Date.now(),
                  ...(edits.length > 0 && { edits })  // Include edits if any
                };
                this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (edits.length > 0) {
                // If there were edits but no text response
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '',  // Empty content since the action was just edits
                  timestamp: Date.now(),
                  edits
                };
                this.sessionManager.addMessage(assistantMessage, session.id);
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
                  }
                };
                this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (toolCalls.length > 0) {
                // If there were only other tool calls and no text
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '[Tool calls executed]',
                  timestamp: Date.now()
                };
                this.sessionManager.addMessage(assistantMessage, session.id);
              }

              // Update provider session data if available
              if (provider.getProviderSessionData) {
                const providerData = provider.getProviderSessionData(session.id);
                if (providerData?.claudeSessionId) {
                  this.sessionManager.updateProviderSessionData(session.id, providerData.claudeSessionId);
                }
              }

              // Send complete response
              event.sender.send('ai:streamResponse', {
                content: fullResponse,
                isComplete: true
              });
              break;
          }
        }

        return { content: fullResponse };
      } catch (error) {
        const errorTime = Date.now() - startTime;
        console.error(`[AIService] Error after ${errorTime}ms:`, error);
        
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
    ipcMain.handle('ai:getSessions', async (event, projectPath?: string) => {
      return this.sessionManager.getSessions(projectPath);
    });

    // Load a session
    ipcMain.handle('ai:loadSession', async (event, sessionId: string, projectPath?: string) => {
      const session = this.sessionManager.loadSession(sessionId, projectPath);
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
      projectPath?: string
    ) => {
      const success = this.sessionManager.updateSessionMessages(sessionId, messages, projectPath);
      return { success };
    });

    // Save draft input
    ipcMain.handle('ai:saveDraftInput', async (
      event,
      sessionId: string,
      draftInput: string,
      projectPath?: string
    ) => {
      const success = this.sessionManager.saveDraftInput(sessionId, draftInput, projectPath);
      return { success };
    });

    // Clean up empty messages from all sessions
    ipcMain.handle('ai:cleanupEmptyMessages', async () => {
      const cleaned = this.sessionManager.cleanupAllSessions();
      console.log(`[AIService] Manual cleanup: removed ${cleaned} empty messages`);
      return { success: true, cleaned };
    });

    // Delete session
    ipcMain.handle('ai:deleteSession', async (event, sessionId: string, projectPath?: string) => {
      const success = this.sessionManager.deleteSession(sessionId, projectPath);

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

        // For Claude providers, use the existing test
        if (provider === 'claude' || provider === 'claude-code') {
          console.log('[AIService] testConnection - Testing provider:', provider);
          
          const testProvider = provider === 'claude'
            ? new (await import('./providers/ClaudeProvider')).ClaudeProvider()
            : new (await import('./providers/ClaudeCodeProvider')).ClaudeCodeProvider();

          // Initialize with a default model for testing
          const config: any = { apiKey };
          if (provider === 'claude') {
            // Use the provider's default model for testing (already includes prefix)
            const defaultModel = await ModelRegistry.getDefaultModel('claude');
            console.log('[AIService] testConnection - Got default model:', defaultModel);
            config.model = defaultModel;
          }
          
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
        'lmstudio': {
          enabled: providerSettings['lmstudio']?.enabled === true,
          models: providerSettings['lmstudio']?.models
        }
      };

      // Filter to only enabled models
      const enabledModels = allModels.filter(model => {
        const provider = enabledProviders[model.provider as AIProviderType];
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

  private createToolHandler(webContents: Electron.WebContents): ToolHandler {
    const executor = new ToolExecutor(webContents);
    
    return {
      applyDiff: async (args: DiffArgs): Promise<DiffResult> => {
        return executor.applyDiff(args);
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
