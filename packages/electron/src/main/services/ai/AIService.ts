/**
 * Main AI service that coordinates providers and sessions
 */

import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { SessionManager } from './SessionManager';
import { ProviderFactory } from './ProviderFactory';
import { AIProvider } from './AIProvider';
import { 
  DocumentContext, 
  Message, 
  ProviderConfig,
  ToolHandler,
  DiffArgs,
  DiffResult
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

    // Create new session with provider selection
    ipcMain.handle('ai:createSession', async (
      event, 
      provider: 'claude' | 'claude-code',
      documentContext?: DocumentContext,
      projectPath?: string
    ) => {
      // Get API key from settings or environment - always use 'anthropic' key
      const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
      const apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        throw new Error('Anthropic API key not configured');
      }

      // Create session
      const session = await this.sessionManager.createSession(
        provider,
        documentContext,
        projectPath,
        {
          model: this.getProviderSetting(provider, 'model'),
          maxTokens: this.getProviderSetting(provider, 'maxTokens'),
          temperature: this.getProviderSetting(provider, 'temperature')
        }
      );

      // Create and initialize provider
      const providerInstance = ProviderFactory.createProvider(provider, session.id);
      await providerInstance.initialize({
        apiKey,
        model: session.providerConfig?.model,
        maxTokens: session.providerConfig?.maxTokens,
        temperature: session.providerConfig?.temperature
      });

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
        }
        if (!session) {
          throw new Error('No session available');
        }
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
      let provider = ProviderFactory.getProvider(session.provider, session.id);
      
      // If provider doesn't exist, create and initialize it
      if (!provider) {
        const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
        const apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
          throw new Error('Anthropic API key not configured');
        }
        
        // Create the provider
        provider = ProviderFactory.createProvider(session.provider, session.id);
        
        await provider.initialize({
          apiKey,
          model: session.providerConfig?.model,
          maxTokens: session.providerConfig?.maxTokens,
          temperature: session.providerConfig?.temperature
        });

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
              // Send partial response to renderer
              event.sender.send('ai:streamResponse', {
                partial: chunk.content,
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
        
        // Always use 'anthropic' key for both providers
        if (settings.apiKeys.anthropic) {
          const key = settings.apiKeys.anthropic;
          if (key && key !== this.maskApiKey(currentKeys['anthropic'] || '')) {
            currentKeys['anthropic'] = key as string;
          }
        }
        this.settingsStore.set('apiKeys', currentKeys);
      }
      
      if (settings.providerSettings) {
        this.settingsStore.set('providerSettings', settings.providerSettings);
      }
      
      return { success: true };
    });

    // Test connection
    ipcMain.handle('ai:testConnection', async (event, provider: 'claude' | 'claude-code') => {
      const apiKeys = this.settingsStore.get('apiKeys', {}) as Record<string, string>;
      const apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
      
      if (!apiKey) {
        return { success: false, error: 'Anthropic API key not configured' };
      }
      
      try {
        // Create a temporary provider instance for testing
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
        
        return { success: true, provider };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Get available models
    ipcMain.handle('ai:getModels', async () => {
      return {
        success: true,
        models: [
          { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' },
          { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' }
        ]
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