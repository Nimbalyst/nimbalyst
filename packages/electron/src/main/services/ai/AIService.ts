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

export class AIService {
  private sessionManager: SessionManager;
  private settingsStore: Store;
  private currentProvider: AIProvider | null = null;

  constructor() {
    this.sessionManager = new SessionManager();
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

    this.initializeApiKeys();
    this.setupIpcHandlers();
    
    // Clean up any empty messages from existing sessions on startup
    const cleaned = this.sessionManager.cleanupAllSessions();
    if (cleaned > 0) {
      console.log(`[AIService] Cleaned ${cleaned} empty messages from existing sessions on startup`);
    }
  }

  private initializeApiKeys() {
    // Check if we have API key stored
    const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
    
    // If we have an env variable and no stored key, save it
    if (process.env.ANTHROPIC_API_KEY && !apiKeys['anthropic']) {
      console.log('Initializing API key from environment variable');
      apiKeys['anthropic'] = process.env.ANTHROPIC_API_KEY;
      this.settingsStore.set('apiKeys', apiKeys);
    }
  }

  private setupIpcHandlers() {
    // Initialize/configure AI
    ipcMain.handle('ai:initialize', async (event, provider?: string, apiKey?: string) => {
      if (apiKey) {
        // Save API key - always save as 'anthropic' since both providers use the same key
        const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
        apiKeys['anthropic'] = apiKey;
        this.settingsStore.set('apiKeys', apiKeys);
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
      // Get API key based on provider
      const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
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
        providerConfig.model = model;
      } else if (provider !== 'claude-code') {
        // For other providers, fall back to settings
        providerConfig.model = this.getProviderSetting(provider, 'model');
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
        const lmstudioSettings = this.settingsStore.get('providerSettings.lmstudio', {}) as any;
        initConfig.baseUrl = lmstudioSettings.baseUrl || apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
      }
      
      await providerInstance.initialize(initConfig);

      // Register tool handler
      const toolHandler = this.createToolHandler(event.sender);
      providerInstance.registerToolHandler(toolHandler);

      this.currentProvider = providerInstance;

      // Update MCP document state if provided
      if (documentContext) {
        updateDocumentState(documentContext);
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
      // Get or load the session
      let session = this.sessionManager.getCurrentSession();
      
      if (!session) {
        if (sessionId) {
          session = this.sessionManager.loadSession(sessionId, projectPath);
          console.log(`[AIService] Loaded session ${sessionId} with provider: ${session?.provider}, model: ${session?.model}`);
        }
        if (!session) {
          throw new Error('No session available');
        }
      } else {
        console.log(`[AIService] Using current session with provider: ${session.provider}, model: ${session.model}`);
      }

      // Add user message to session
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now()
      };
      this.sessionManager.addMessage(userMessage);

      // Update MCP document state if provided
      if (documentContext) {
        updateDocumentState(documentContext);
      }

      // Get or create provider for this session
      console.log(`[AIService] Getting provider for: ${session.provider}, sessionId: ${session.id}`);
      let provider = ProviderFactory.getProvider(session.provider, session.id);
      
      // If provider doesn't exist, create and initialize it
      if (!provider) {
        console.log(`[AIService] Provider not found, creating new ${session.provider} provider`);
        const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
        
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
          reinitConfig.model = session.model || session.providerConfig?.model;
        }
        
        await provider.initialize(reinitConfig);

        // Register tool handler
        const toolHandler = this.createToolHandler(event.sender);
        provider.registerToolHandler(toolHandler);
      }

      this.currentProvider = provider;

      try {
        let fullResponse = '';
        const toolCalls: any[] = [];
        const edits: any[] = [];  // Track edits for the assistant message
        let hasStreamingContent = false;  // Track if we used streamContent tool

        // Get existing messages from session for context
        const sessionMessages = session.messages || [];

        // Stream the response
        for await (const chunk of provider.sendMessage(message, documentContext, session.id, sessionMessages)) {
          switch (chunk.type) {
            case 'text':
              fullResponse += chunk.content || '';
              // Send ACCUMULATED response to renderer (not just the chunk)
              event.sender.send('ai:streamResponse', {
                partial: fullResponse,  // Send the full accumulated text
                isComplete: false
              });
              break;

            case 'tool_call':
              if (chunk.toolCall) {
                toolCalls.push(chunk.toolCall);
                
                // Save tool call as a separate message in the session
                const toolMessage: Message = {
                  role: 'tool',
                  content: '',  // Tool messages don't have text content
                  timestamp: Date.now(),
                  toolCall: chunk.toolCall
                };
                this.sessionManager.addMessage(toolMessage);
                
                // Send tool call to renderer
                // For applyDiff, include it as BOTH an edit AND a toolCall
                if (chunk.toolCall.name === 'applyDiff') {
                  const edit = {
                    type: 'diff',
                    replacements: chunk.toolCall.arguments.replacements
                  };
                  edits.push(edit);  // Save edit for the assistant message
                  
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
              // Only add assistant message if there's actual content or edits
              if (fullResponse && fullResponse.trim() !== '') {
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: fullResponse,
                  timestamp: Date.now(),
                  ...(edits.length > 0 && { edits })  // Include edits if any
                };
                this.sessionManager.addMessage(assistantMessage);
              } else if (edits.length > 0) {
                // If there were edits but no text response
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '',  // Empty content since the action was just edits
                  timestamp: Date.now(),
                  edits
                };
                this.sessionManager.addMessage(assistantMessage);
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
                this.sessionManager.addMessage(assistantMessage);
              } else if (toolCalls.length > 0) {
                // If there were only other tool calls and no text
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '[Tool calls executed]',
                  timestamp: Date.now()
                };
                this.sessionManager.addMessage(assistantMessage);
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
        console.error('AI service error:', error);
        
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
        throw new Error('Session not found');
      }
      return session;
    });

    // Clear session
    ipcMain.handle('ai:clearSession', async () => {
      this.sessionManager.clearCurrentSession();
      
      // Abort any ongoing request
      if (this.currentProvider) {
        this.currentProvider.abort();
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
    ipcMain.handle('ai:cancelRequest', async () => {
      if (this.currentProvider) {
        this.currentProvider.abort();
        return { success: true };
      }
      return { success: false, error: 'No active request to cancel' };
    });

    // Settings handlers
    ipcMain.handle('ai:getSettings', async () => {
      const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.settingsStore.get('providerSettings', {}) as any;
      
      return {
        defaultProvider: this.settingsStore.get('defaultProvider', 'claude-code'),
        apiKeys: this.maskApiKeys(apiKeys),
        providerSettings
      };
    });

    ipcMain.handle('ai:saveSettings', async (event, settings: any) => {
      if (settings.defaultProvider) {
        this.settingsStore.set('defaultProvider', settings.defaultProvider);
      }
      
      if (settings.apiKeys) {
        // Only update changed API keys
        const currentKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
        
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
        
        this.settingsStore.set('apiKeys', currentKeys);
      }
      
      if (settings.providerSettings) {
        this.settingsStore.set('providerSettings', settings.providerSettings);
      }
      
      return { success: true };
    });

    // Test connection
    ipcMain.handle('ai:testConnection', async (event, provider: string) => {
      const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
      
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
          const testProvider = provider === 'claude' 
            ? new (await import('./providers/ClaudeProvider')).ClaudeProvider()
            : new (await import('./providers/ClaudeCodeProvider')).ClaudeCodeProvider();
          
          await testProvider.initialize({ apiKey });
          
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
      // Clear cache to get fresh models
      ModelRegistry.clearCache();
      
      const providerSettings = this.settingsStore.get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
      
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
      const providerSettings = this.settingsStore.get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
      
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
    return {
      applyDiff: async (args: DiffArgs): Promise<DiffResult> => {
        // Send the diff to the renderer to apply
        const resultChannel = `applyDiff-result-${Date.now()}`;
        
        return new Promise((resolve) => {
          // Set up one-time listener for result
          ipcMain.once(resultChannel, (event, result) => {
            resolve(result);
          });
          
          // Send the diff to renderer
          webContents.send('ai:applyDiff', {
            replacements: args.replacements,
            resultChannel
          });
          
          // Timeout after 10 seconds
          setTimeout(() => {
            resolve({
              success: false,
              error: 'Timeout waiting for diff application'
            });
          }, 10000);
        });
      }
    };
  }

  private getProviderSetting(provider: string, key: string): any {
    const providerSettings = this.settingsStore.get('providerSettings', {}) as any;
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
    // Clean up all providers
    ProviderFactory.destroyAll();
  }
}