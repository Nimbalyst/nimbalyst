// Note: @anthropic-ai/claude-code is a CLI tool, not a programmatic SDK
// We'll use the Anthropic SDK directly instead
import Anthropic from '@anthropic-ai/sdk';
import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { EventEmitter } from 'events';
import path from 'path';
import { spawn } from 'child_process';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

interface SessionData {
  id: string;
  timestamp: number;
  messages: Message[];
  documentContext?: DocumentContext;
  projectPath?: string;
  name?: string;
  title?: string;
  draftInput?: string;
}

export class ClaudeCodeService extends EventEmitter {
  private anthropic: Anthropic | null = null;
  private currentSession: SessionData | null = null;
  private store: Store;
  private apiKey: string | null = null;
  private currentProjectPath: string | null = null;
  private settings: {
    model: string;
    maxTokens: number;
    temperature: number;
  } = {
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 4000,
    temperature: 0
  };

  constructor() {
    super();
    this.store = new Store({
      name: 'claude-sessions',
      schema: {
        sessionsByProject: {
          type: 'object',
          default: {}
        },
        currentSessionByProject: {
          type: 'object',
          default: {}
        },
        apiKey: {
          type: ['string', 'null'],
          default: null
        },
        settings: {
          type: 'object',
          default: {}
        }
      }
    });

    this.setupIpcHandlers();
    this.loadSettings();
  }

  private loadSettings() {
    this.apiKey = this.store.get('apiKey') as string || process.env.ANTHROPIC_API_KEY || null;
    const savedSettings = this.store.get('settings') as any;
    if (savedSettings) {
      this.settings = { ...this.settings, ...savedSettings };
    }
    if (this.apiKey) {
      this.initializeClient();
    }
  }

  private async initializeClient() {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    try {
      // Initialize Anthropic SDK
      this.anthropic = new Anthropic({
        apiKey: this.apiKey
      });
      console.log('Anthropic SDK initialized');
    } catch (error) {
      console.error('Failed to initialize Anthropic SDK:', error);
      throw error;
    }
  }

  private setupIpcHandlers() {
    // Initialize Claude connection
    ipcMain.handle('claude:initialize', async (event, apiKey?: string) => {
      if (apiKey) {
        this.apiKey = apiKey;
        this.store.set('apiKey', apiKey);
      } else if (!this.apiKey) {
        // Try to load from store if not already loaded
        this.apiKey = this.store.get('apiKey') as string || process.env.ANTHROPIC_API_KEY || null;
      }

      if (!this.apiKey) {
        throw new Error('API key required');
      }

      await this.initializeClient();
      return { success: true };
    });

    // Create new session
    ipcMain.handle('claude:createSession', async (event, documentContext?: DocumentContext, projectPath?: string) => {
      this.currentProjectPath = projectPath || documentContext?.filePath?.split('/').slice(0, -1).join('/') || process.cwd();
      
      // Update MCP server with document state
      if (documentContext) {
        await this.updateMcpDocumentState(documentContext);
      }

      // Claude-code-sdk manages sessions internally
      // Return a session-like object for compatibility
      const sessionId = `session-${Date.now()}`;
      return {
        id: sessionId,
        timestamp: Date.now(),
        messages: [],
        documentContext,
        projectPath: this.currentProjectPath,
        title: 'New conversation'
      };
    });

    // Send message to Claude
    ipcMain.handle('claude:sendMessage', async (event, message: string, documentContext?: DocumentContext) => {
      if (!this.anthropic) {
        throw new Error('Claude not initialized');
      }

      if (!this.currentSession) {
        // Create a new session if none exists
        this.currentSession = await this.createSession(documentContext);
      }

      // Add user message to session
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now()
      };
      this.currentSession.messages.push(userMessage);
      this.saveSession(this.currentSession);

      // Update document context in MCP server
      if (documentContext) {
        await this.updateMcpDocumentState(documentContext);
      }

      // Build system prompt
      const systemPrompt = `You are an AI assistant integrated into Stravu Editor, a markdown-focused text editor built with Lexical.
      
Current document context:
- File: ${documentContext?.filePath || 'untitled'}
- Type: ${documentContext?.fileType || 'markdown'}

You can help with editing and improving documents. When suggesting edits, be precise and helpful.`;

      try {
        // Stream response from Claude
        const stream = await this.anthropic.messages.create({
          model: this.settings.model,
          max_tokens: this.settings.maxTokens,
          temperature: this.settings.temperature,
          system: systemPrompt,
          messages: this.currentSession.messages.map(m => ({
            role: m.role,
            content: m.content
          })),
          stream: true
        });

        let fullResponse = '';
        
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullResponse += chunk.delta.text;
            
            // Send partial response to renderer
            event.sender.send('claude:streamResponse', {
              partial: chunk.delta.text,
              isComplete: false
            });
          }
        }

        // Add assistant message to session
        const assistantMessage: Message = {
          role: 'assistant',
          content: fullResponse,
          timestamp: Date.now()
        };
        this.currentSession.messages.push(assistantMessage);
        this.saveSession(this.currentSession);

        // Send complete response
        event.sender.send('claude:streamResponse', {
          content: fullResponse,
          isComplete: true
        });

        return { content: fullResponse };
      } catch (error) {
        console.error('Claude API error:', error);
        throw error;
      }
    });

    // Get session history for current project
    ipcMain.handle('claude:getSessions', async (event, projectPath?: string) => {
      const project = projectPath || this.currentProjectPath || 'default';
      const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
      const sessions = sessionsByProject[project] || [];
      // Sort by timestamp descending (newest first)
      return sessions.sort((a, b) => b.timestamp - a.timestamp);
    });

    // Load session
    ipcMain.handle('claude:loadSession', async (event, sessionId: string, projectPath?: string) => {
      const project = projectPath || this.currentProjectPath || 'default';
      const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
      const sessions = sessionsByProject[project] || [];
      const session = sessions.find(s => s.id === sessionId);
      
      if (session) {
        this.currentSession = session;
        this.currentProjectPath = project;
        return session;
      }
      
      throw new Error('Session not found');
    });

    // Clear session
    ipcMain.handle('claude:clearSession', async () => {
      this.currentSession = null;
      return { success: true };
    });

    // Update session messages (for syncing streaming status messages)
    ipcMain.handle('claude:updateSessionMessages', async (event, sessionId: string, messages: Message[], projectPath?: string) => {
      const project = projectPath || this.currentProjectPath || 'default';
      const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
      const sessions = sessionsByProject[project] || [];
      const session = sessions.find(s => s.id === sessionId);

      if (session) {
        session.messages = messages;
        this.saveSession(session);

        // Update current session if it matches
        if (this.currentSession?.id === sessionId) {
          this.currentSession = session;
        }

        return { success: true };
      }

      return { success: false, error: 'Session not found' };
    });

    // Save draft input for a session
    ipcMain.handle('claude:saveDraftInput', async (event, sessionId: string, draftInput: string, projectPath?: string) => {
      const project = projectPath || this.currentProjectPath || 'default';
      const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
      const sessions = sessionsByProject[project] || [];
      const session = sessions.find(s => s.id === sessionId);

      if (session) {
        session.draftInput = draftInput;
        this.saveSession(session);

        // Update current session if it matches
        if (this.currentSession?.id === sessionId) {
          this.currentSession.draftInput = draftInput;
        }

        return { success: true };
      }

      return { success: false, error: 'Session not found' };
    });

    // Settings handlers
    ipcMain.handle('claude:getSettings', async () => {
      return {
        apiKey: this.apiKey ? this.maskApiKey(this.apiKey) : '',
        model: this.settings.model,
        maxTokens: this.settings.maxTokens,
        temperature: this.settings.temperature
      };
    });

    ipcMain.handle('claude:saveSettings', async (event, settings: any) => {
      if (settings.apiKey && settings.apiKey !== this.maskApiKey(this.apiKey || '')) {
        this.apiKey = settings.apiKey;
        this.store.set('apiKey', settings.apiKey);
        await this.initializeClient();
      }

      this.settings = {
        model: settings.model || this.settings.model,
        maxTokens: settings.maxTokens || this.settings.maxTokens,
        temperature: settings.temperature !== undefined ? settings.temperature : this.settings.temperature
      };

      this.store.set('settings', this.settings);
      
      // Reinitialize with new settings
      if (this.apiKey) {
        await this.initializeClient();
      }
      
      return { success: true };
    });

    // Test connection
    ipcMain.handle('claude:testConnection', async () => {
      if (!this.anthropic) {
        return { success: false, error: 'API client not initialized' };
      }

      try {
        // Send a simple test message
        const response = await this.anthropic.messages.create({
          model: this.settings.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        });
        
        return { success: true, model: this.settings.model };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Get available models
    ipcMain.handle('claude:getModels', async () => {
      // Return available Claude models
      return {
        success: true,
        models: [
          { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' },
          { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' }
        ]
      };
    });

    // Handlers for MCP integration
    ipcMain.handle('mcp:applyDiff:result', async (event, resultChannel: string, result: any) => {
      // Forward result back through the result channel
      event.sender.send(resultChannel, result);
    });
  }

  private async updateMcpDocumentState(documentContext: DocumentContext) {
    // Send document state to all windows (MCP server will pick it up)
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.webContents.send('mcp:updateDocumentState', documentContext);
    }
  }

  private maskApiKey(key: string): string {
    if (!key || key.length <= 20) return key;
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  }

  private async createSession(documentContext?: DocumentContext): Promise<SessionData> {
    const sessionId = `session-${Date.now()}`;
    const session: SessionData = {
      id: sessionId,
      timestamp: Date.now(),
      messages: [],
      documentContext,
      projectPath: this.currentProjectPath || 'default',
      title: 'New conversation'
    };
    
    this.saveSession(session);
    return session;
  }

  private saveSession(session: SessionData) {
    const project = session.projectPath || this.currentProjectPath || 'default';
    const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
    
    if (!sessionsByProject[project]) {
      sessionsByProject[project] = [];
    }
    
    const sessions = sessionsByProject[project];
    const index = sessions.findIndex(s => s.id === session.id);
    
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }
    
    // Keep only last 50 sessions per project
    if (sessions.length > 50) {
      sessions.splice(0, sessions.length - 50);
    }
    
    sessionsByProject[project] = sessions;
    this.store.set('sessionsByProject', sessionsByProject);
  }

  public destroy() {
    // Clean up resources
    this.removeAllListeners();
  }
}