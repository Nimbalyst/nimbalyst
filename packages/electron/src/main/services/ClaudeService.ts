import Anthropic from '@anthropic-ai/sdk';
import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { EventEmitter } from 'events';

interface SessionData {
  id: string;
  timestamp: number;
  messages: Message[];
  documentContext?: DocumentContext;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  edits?: EditRequest[];
}

interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

interface EditRequest {
  type: 'diff';
  file: string;
  replacements: Array<{
    oldText: string;
    newText: string;
  }>;
}

export class ClaudeService extends EventEmitter {
  private anthropic: Anthropic | null = null;
  private store: Store;
  private currentSession: SessionData | null = null;
  private apiKey: string | null = null;
  private settings: {
    model: string;
    maxTokens: number;
    temperature: number;
  } = {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4000,
    temperature: 0
  };

  constructor() {
    super();
    this.store = new Store({
      name: 'claude-sessions',
      schema: {
        sessions: {
          type: 'array',
          default: []
        },
        currentSessionId: {
          type: ['string', 'null'],
          default: null
        },
        apiKey: {
          type: ['string', 'null'],
          default: null
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

  private initializeClient() {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    this.anthropic = new Anthropic({
      apiKey: this.apiKey
    });
  }

  private setupIpcHandlers() {
    // Initialize Claude connection
    ipcMain.handle('claude:initialize', async (event, apiKey?: string) => {
      if (apiKey) {
        this.apiKey = apiKey;
        this.store.set('apiKey', apiKey);
      }
      
      if (!this.apiKey) {
        throw new Error('API key required');
      }

      this.initializeClient();
      return { success: true };
    });

    // Create new session
    ipcMain.handle('claude:createSession', async (event, documentContext?: DocumentContext) => {
      const sessionId = `session-${Date.now()}`;
      const session: SessionData = {
        id: sessionId,
        timestamp: Date.now(),
        messages: [],
        documentContext
      };

      this.currentSession = session;
      this.saveSession(session);
      
      return session;
    });

    // Send message to Claude
    ipcMain.handle('claude:sendMessage', async (event, message: string, documentContext?: DocumentContext) => {
      if (!this.anthropic) {
        throw new Error('Claude not initialized');
      }

      if (!this.currentSession) {
        this.currentSession = await this.createSession(documentContext);
      }

      // Add user message to session
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now()
      };
      this.currentSession.messages.push(userMessage);

      // Build system prompt with document context
      const systemPrompt = this.buildSystemPrompt(documentContext);

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
        const edits: EditRequest[] = [];

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

        // Parse any edit requests from the response
        const parsedEdits = this.parseEditRequests(fullResponse, documentContext);
        
        // Add assistant message to session
        const assistantMessage: Message = {
          role: 'assistant',
          content: fullResponse,
          timestamp: Date.now(),
          edits: parsedEdits
        };
        this.currentSession.messages.push(assistantMessage);
        this.saveSession(this.currentSession);

        // Send complete response with edits
        event.sender.send('claude:streamResponse', {
          content: fullResponse,
          edits: parsedEdits,
          isComplete: true
        });

        return { content: fullResponse, edits: parsedEdits };
      } catch (error) {
        console.error('Claude API error:', error);
        throw error;
      }
    });

    // Get session history
    ipcMain.handle('claude:getSessions', async () => {
      return this.store.get('sessions', []);
    });

    // Load session
    ipcMain.handle('claude:loadSession', async (event, sessionId: string) => {
      const sessions = this.store.get('sessions', []) as SessionData[];
      const session = sessions.find(s => s.id === sessionId);
      
      if (session) {
        this.currentSession = session;
        return session;
      }
      
      throw new Error('Session not found');
    });

    // Clear session
    ipcMain.handle('claude:clearSession', async () => {
      this.currentSession = null;
      return { success: true };
    });

    // Apply edit request
    ipcMain.handle('claude:applyEdit', async (event, edit: EditRequest) => {
      // This will be handled by the renderer process
      // The main process just forwards the edit to all windows
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('claude:editRequest', edit);
      });
      
      return { success: true };
    });

    // Get settings
    ipcMain.handle('claude:getSettings', async () => {
      return {
        apiKey: this.apiKey ? this.maskApiKey(this.apiKey) : '',
        model: this.settings.model,
        maxTokens: this.settings.maxTokens,
        temperature: this.settings.temperature
      };
    });

    // Save settings
    ipcMain.handle('claude:saveSettings', async (event, settings: any) => {
      if (settings.apiKey && settings.apiKey !== this.maskApiKey(this.apiKey || '')) {
        this.apiKey = settings.apiKey;
        this.store.set('apiKey', settings.apiKey);
        this.initializeClient();
      }

      this.settings = {
        model: settings.model || this.settings.model,
        maxTokens: settings.maxTokens || this.settings.maxTokens,
        temperature: settings.temperature !== undefined ? settings.temperature : this.settings.temperature
      };

      this.store.set('settings', this.settings);
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
      if (!this.apiKey) {
        return { success: false, error: 'API key not configured', models: [] };
      }

      try {
        const models = await this.fetchAvailableModels();
        return { success: true, models };
      } catch (error: any) {
        console.error('Failed to fetch models:', error);
        // Return fallback models if API call fails
        return { 
          success: false, 
          error: error.message,
          models: [
            { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' }
          ]
        };
      }
    });
  }

  private async fetchAvailableModels(): Promise<Array<{ id: string; display_name: string }>> {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    try {
      // Use fetch to call the models endpoint directly
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Filter and sort models to show only chat models
      const chatModels = data.data
        .filter((model: any) => model.type === 'model' && !model.id.includes('instant'))
        .map((model: any) => ({
          id: model.id,
          display_name: model.display_name || model.id
        }))
        .sort((a: any, b: any) => {
          // Sort by version and capability (opus > sonnet > haiku)
          const order = ['opus', 'sonnet', 'haiku'];
          const getOrder = (id: string) => {
            for (let i = 0; i < order.length; i++) {
              if (id.includes(order[i])) return i;
            }
            return 999;
          };
          return getOrder(a.id) - getOrder(b.id);
        });

      return chatModels;
    } catch (error) {
      console.error('Error fetching models from API:', error);
      throw error;
    }
  }

  private maskApiKey(key: string): string {
    if (!key || key.length <= 20) return key;
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  }

  private buildSystemPrompt(context?: DocumentContext): string {
    let prompt = `You are an AI assistant for Stravu Editor, a markdown-focused text editor built with Lexical.
Your role is to help users edit and improve their documents. You can suggest edits, generate content, and answer questions about the document.

When users ask you to edit or modify their document, you should provide specific edit instructions that can be applied to the document.
Focus on being helpful and making precise, targeted edits rather than rewriting entire documents unless specifically asked.

Key capabilities:
- Generate and expand content
- Rewrite and improve text
- Create structured documents (outlines, summaries, etc.)
- Format markdown correctly
- Suggest improvements for clarity and readability`;

    if (context) {
      prompt += `\n\nCurrent document context:
- File: ${context.filePath}
- Type: ${context.fileType}`;

      if (context.cursorPosition) {
        prompt += `\n- Cursor at line ${context.cursorPosition.line}, column ${context.cursorPosition.column}`;
      }

      if (context.selection) {
        prompt += `\n- Text selected from line ${context.selection.start.line} to line ${context.selection.end.line}`;
      }

      if (context.content) {
        prompt += `\n\nDocument content:\n${context.content}`;
      }
    }

    prompt += `\n\nWhen the user asks you to make changes to their document, you can respond in two ways:

1. For simple explanations or discussions, just respond normally.

2. When you want to actually edit the document, include special edit command blocks in your response.
   For each change you want to make, specify the old text to replace and the new text:

\`\`\`edit-command
{
  "replacements": [
    {
      "oldText": "The exact text to find and replace (can be a paragraph or section)",
      "newText": "The new text that will replace it"
    }
  ]
}
\`\`\`

You can include multiple replacements in a single command. The system will show these as red/green diffs in the document.

Example for fixing a typo:
\`\`\`edit-command
{
  "replacements": [
    {
      "oldText": "This is a paragraf with a typo.",
      "newText": "This is a paragraph with a typo fixed."
    }
  ]
}
\`\`\`

Example for adding a new section at the end:
\`\`\`edit-command
{
  "replacements": [
    {
      "oldText": "",
      "newText": "## New Section\\n\\nThis is the content of the new section."
    }
  ]
}
\`\`\`

IMPORTANT: 
- Match the oldText EXACTLY as it appears in the document (including line breaks)
- For adding new content, use empty string for oldText
- The changes will appear as visual diffs that the user can approve or reject`;

    return prompt;
  }

  private parseEditRequests(response: string, context?: DocumentContext): EditRequest[] {
    const edits: EditRequest[] = [];
    
    // Look for ```edit-command blocks
    const editPattern = /```edit-command\s*\n([\s\S]*?)\n```/g;
    let match;

    while ((match = editPattern.exec(response)) !== null) {
      try {
        const editJson = match[1];
        const editCommand = JSON.parse(editJson);
        
        if (editCommand.replacements && Array.isArray(editCommand.replacements)) {
          // Create a single EditRequest with all replacements
          edits.push({
            type: 'diff',
            file: context?.filePath || '',
            replacements: editCommand.replacements
          });
        }
      } catch (error) {
        console.error('Failed to parse edit command:', error);
      }
    }

    return edits;
  }

  private async createSession(documentContext?: DocumentContext): Promise<SessionData> {
    const sessionId = `session-${Date.now()}`;
    const session: SessionData = {
      id: sessionId,
      timestamp: Date.now(),
      messages: [],
      documentContext
    };

    this.saveSession(session);
    return session;
  }

  private saveSession(session: SessionData) {
    const sessions = this.store.get('sessions', []) as SessionData[];
    const index = sessions.findIndex(s => s.id === session.id);
    
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }

    // Keep only last 50 sessions
    if (sessions.length > 50) {
      sessions.splice(0, sessions.length - 50);
    }

    this.store.set('sessions', sessions);
    this.store.set('currentSessionId', session.id);
  }

  public destroy() {
    // Clean up resources
    this.removeAllListeners();
  }
}