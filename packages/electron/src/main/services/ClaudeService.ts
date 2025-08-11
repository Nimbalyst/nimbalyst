import Anthropic from '@anthropic-ai/sdk';
import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { EventEmitter } from 'events';

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
  private currentProjectPath: string | null = null;
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
    ipcMain.handle('claude:createSession', async (event, documentContext?: DocumentContext, projectPath?: string) => {
      // Use provided project path or try to extract from document context
      const project = projectPath || documentContext?.filePath?.split('/').slice(0, -1).join('/') || 'default';
      this.currentProjectPath = project;

      // Check if we already have a recent session (within 2 seconds) to avoid duplicates
      const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
      const projectSessions = sessionsByProject[project] || [];
      const now = Date.now();

      // Find a session created within the last 2 seconds
      const recentSession = projectSessions.find(s =>
        (now - s.timestamp) < 2000
      );

      if (recentSession) {
        // Return existing recent session instead of creating a new one
        this.currentSession = recentSession;
        return recentSession;
      }

      const sessionId = `session-${now}`;
      const session: SessionData = {
        id: sessionId,
        timestamp: now,
        messages: [],
        documentContext,
        projectPath: project,
        title: 'New conversation'
      };

      this.currentSession = session;
      this.saveSession(session);

      // Set as current session for this project
      const currentByProject = this.store.get('currentSessionByProject', {}) as Record<string, string>;
      currentByProject[project] = sessionId;
      this.store.set('currentSessionByProject', currentByProject);

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

      // Clear draft input since message is being sent
      this.currentSession.draftInput = '';

      // Generate title from first user message if not already set
      if (this.currentSession.messages.length === 1 && (!this.currentSession.title || this.currentSession.title === 'New conversation')) {
        this.currentSession.title = this.generateSessionTitle(message);
      }

      // Save session after adding user message
      this.saveSession(this.currentSession);

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

    // Get session history for current project (newest first)
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

        // Set as current session for this project
        const currentByProject = this.store.get('currentSessionByProject', {}) as Record<string, string>;
        currentByProject[project] = sessionId;
        this.store.set('currentSessionByProject', currentByProject);
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

    // Delete session
    ipcMain.handle('claude:deleteSession', async (event, sessionId: string, projectPath?: string) => {
      const project = projectPath || this.currentProjectPath || 'default';
      const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
      const sessions = sessionsByProject[project] || [];

      // Filter out the session to delete
      const updatedSessions = sessions.filter(s => s.id !== sessionId);

      // Update the store
      sessionsByProject[project] = updatedSessions;
      this.store.set('sessionsByProject', sessionsByProject);

      // If we deleted the current session, clear it
      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;

        // Clear from current session tracking
        const currentByProject = this.store.get('currentSessionByProject', {}) as Record<string, string>;
        if (currentByProject[project] === sessionId) {
          delete currentByProject[project];
          this.store.set('currentSessionByProject', currentByProject);
        }
      }

      return { success: true };
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

IMPORTANT: You have TWO DIFFERENT WAYS to modify documents. NEVER mix them:

METHOD 1 - STREAMING (for NEW content only):
Use this ONLY when adding completely NEW content to the document.
Format: <!-- STREAM_EDIT --> followed by markdown content, then <!-- STREAM_END -->

METHOD 2 - EDIT COMMANDS (for modifying EXISTING content):
Use this for ALL modifications to existing content, including tables.
Format: \`\`\`edit-command\`\`\` JSON blocks with oldText/newText replacements

CRITICAL RULES:
- NEVER use STREAM_EDIT for table modifications (adding rows, columns, etc.)
- NEVER stream edit-command JSON blocks into the document
- Table modifications MUST use edit-command with exact oldText/newText
- If you're changing existing content in ANY way, use edit-command
- Only use STREAM_EDIT for completely new paragraphs/sections

STREAMING PROTOCOL (METHOD 1 - for NEW content only):
When the user asks you to add completely NEW content (new sections, paragraphs, etc.), 
stream it directly into the editor.

Format for streaming NEW content:
<!-- STREAM_EDIT: {"insertAfter": "text to insert after", "mode": "after"} -->
New markdown content here...
<!-- STREAM_END -->

Or for end of document:
<!-- STREAM_EDIT: {"insertAtEnd": true, "mode": "after"} -->
New content...
<!-- STREAM_END -->

Use streaming ONLY when:
- Adding new sections or paragraphs
- Appending content at the end
- Inserting completely new content between existing sections

DO NOT use streaming when:
- Modifying tables (adding/removing rows or columns)
- Editing existing text
- Replacing content
- Making any changes to existing content

When NOT streaming, provide specific edit instructions that can be applied to the document.
Focus on being helpful and making precise, targeted edits rather than rewriting entire documents unless specifically asked.

Key capabilities:
- Generate and expand content (use streaming for new content)
- Rewrite and improve text (use diff edits for modifications)
- Create structured documents (use streaming for new sections)
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

    prompt += `\n\nEDIT COMMANDS (METHOD 2 - for modifying EXISTING content):
When you need to MODIFY existing content (including tables), use edit-command blocks.

\`\`\`edit-command
{
  "replacements": [
    {
      "oldText": "The exact text to find and replace",
      "newText": "The new text that will replace it"
    }
  ]
}
\`\`\`

ALWAYS use edit-command for:
- Adding/removing table rows or columns
- Modifying table cells
- Changing any existing text
- Replacing paragraphs
- Updating lists
- ANY modification to existing content

The system will show these as red/green diffs in the document.

Example for adding a column to a table:
\`\`\`edit-command
{
  "replacements": [
    {
      "oldText": "| Fruit | Color |\\n| --- | --- |\\n| Apple | Red |",
      "newText": "| Fruit | Color | Size |\\n| --- | --- | --- |\\n| Apple | Red | Medium |"
    }
  ]
}
\`\`\`

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

NEVER do this (wrong - streaming an edit command):
<!-- STREAM_EDIT: {"insertAfter": "some text", "mode": "after"} -->
\`\`\`edit-command
...
\`\`\`
<!-- STREAM_END -->

IMPORTANT: 
- Match the oldText EXACTLY as it appears in the document (including line breaks)
- For adding new content, use empty string for oldText
- The changes will appear as visual diffs that the user can approve or reject
- When editing markdown tables, preserve the EXACT formatting including:
  - The exact number of dashes in separator rows (e.g., |---|---| not |-------|-------|)
  - The spacing and alignment as it appears in the original
  - Do NOT normalize or "improve" table formatting unless specifically asked
- The document uses a specific markdown table format with 3 dashes per column separator`;

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
      documentContext,
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

  private generateSessionTitle(firstMessage: string): string {
    // Clean and truncate the message for a title
    let title = firstMessage
      .replace(/[\n\r]+/g, ' ')  // Replace newlines with spaces
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim();

    // If message starts with common patterns, extract the main topic
    const patterns = [
      /^(can you |could you |please |help me |i need to |i want to |how do i |how to |what is |what are |where is |where are |why is |why are |when is |when are )/i,
      /^(add |create |make |build |implement |fix |update |modify |change |refactor |optimize |debug |test |write |generate )/i
    ];

    for (const pattern of patterns) {
      if (pattern.test(title)) {
        title = title.replace(pattern, '');
        break;
      }
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    // Truncate to reasonable length (50 chars) and add ellipsis if needed
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    // If title is too short or empty, use a default
    if (title.length < 3) {
      title = 'New conversation';
    }

    return title;
  }

  public destroy() {
    // Clean up resources
    this.removeAllListeners();
  }
}
