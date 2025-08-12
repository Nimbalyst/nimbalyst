import { query, AbortError } from '@anthropic-ai/claude-code';
import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { updateDocumentState } from '../mcp/httpServer';

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
  claudeSessionId?: string; // The actual session ID from claude-code CLI
}

export class ClaudeCodeSDKService extends EventEmitter {
  private store: Store;
  private apiKey: string | null = null;
  private currentProjectPath: string | null = null;
  private currentSessionId: string | null = null;
  private currentSession: SessionData | null = null;
  private abortController: AbortController | null = null;
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
      name: 'claude-code-sessions',
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
  }

  private getMcpServersConfig() {
    // Connect to MCP server running in Electron
    return {
      "stravu-editor": {
          "type": "sse",
        "transport": "sse",
        "url": "http://127.0.0.1:3456/mcp"
      }
    };
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

      return { success: true };
    });

    // Create new session
    ipcMain.handle('claude:createSession', async (event, documentContext?: DocumentContext, projectPath?: string) => {
      this.currentProjectPath = projectPath || documentContext?.filePath?.split('/').slice(0, -1).join('/') || process.cwd();

      // Create a new session with UUID
      const sessionId = uuidv4();
      const session: SessionData = {
        id: sessionId,
        timestamp: Date.now(),
        messages: [],
        documentContext,
        projectPath: this.currentProjectPath,
        title: 'New conversation'
      };

      this.currentSession = session;
      this.currentSessionId = sessionId;
      this.saveSession(session);

      // Set as current session for this project
      const currentByProject = this.store.get('currentSessionByProject', {}) as Record<string, string>;
      currentByProject[this.currentProjectPath] = sessionId;
      this.store.set('currentSessionByProject', currentByProject);

      return session;
    });

    // Send message to Claude using claude-code-sdk
    ipcMain.handle('claude:sendMessage', async (event, message: string, documentContext?: DocumentContext, sessionId?: string, projectPath?: string) => {
      if (!this.apiKey) {
        throw new Error('Claude not initialized - API key required');
      }

      // If a session ID is provided, make sure it's loaded
      if (sessionId && sessionId !== this.currentSessionId) {
        const project = projectPath || this.currentProjectPath || 'default';
        const sessionsByProject = this.store.get('sessionsByProject', {}) as Record<string, SessionData[]>;
        const sessions = sessionsByProject[project] || [];
        const session = sessions.find(s => s.id === sessionId);

        if (session) {
          this.currentSession = session;
          this.currentSessionId = session.id;
          this.currentProjectPath = project;
        } else {
          throw new Error(`Session not found: ${sessionId}`);
        }
      }

      if (!this.currentSession) {
        // This should not happen if frontend is working correctly
        throw new Error('No session loaded - frontend should create or load a session first');
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

      this.saveSession(this.currentSession);

      // Update document context in MCP server
      if (documentContext) {
        await this.updateMcpDocumentState(documentContext);
      }

      // Build system prompt with document context
      const systemPrompt = `You are an AI assistant integrated into Stravu Editor, a markdown-focused text editor built with Lexical.

You have access to the following MCP tools for document editing:
- getDocument: Get the current document content and metadata
- applyDiff: Apply text replacements to the document with diff preview
- streamContent: Stream markdown content into the document at specific positions
- getSelection: Get the current selection or cursor position
- navigateTo: Navigate to a specific line and column
- getOutline: Get the document outline (headings structure)
- searchInDocument: Search for text in the current document

Current document context:
- File: ${documentContext?.filePath || 'untitled'}
- Type: ${documentContext?.fileType || 'markdown'}
${documentContext?.content ? `- Content preview: ${documentContext.content.substring(0, 200)}...` : ''}

CRITICAL RESPONSE RULES - YOU MUST FOLLOW THESE:
1. When editing documents, your ENTIRE response should be 1 short sentence MAX
2. NEVER explain what you're about to do (e.g., "Let me...", "I'll...", "First...")
3. NEVER describe what you added - the user sees it in the document
4. NEVER list the content you added
5. NEVER explain your reasoning unless explicitly asked

GOOD responses after editing:
- "Done."
- "Added funny color names section."
- "Fixed the formatting."
- "Updated with 5 examples."

BAD responses (DO NOT DO THIS):
- Any response longer than 1 sentence
- "I'll add a section with funny color names..."
- "I've added the following colors..."
- "Let me first check the document..."
- Explaining what the content contains
- Describing your editing process

Remember: The user can SEE the changes in their editor. They don't need you to describe them.`;

      try {
        // Create abort controller for this request
        this.abortController = new AbortController();

        // Find the claude-code CLI executable
        // The SDK expects to find cli.js in the same directory as sdk.mjs
        // We need to provide the absolute path to the actual CLI file
        let cliPath: string;

        // Try to find the CLI in various locations
        const possiblePaths = [
          // Development path - monorepo root node_modules
          path.join(__dirname, '../../../../node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(__dirname, '../../../../../node_modules/@anthropic-ai/claude-code/cli.js'),
          // Electron app node_modules
          path.join(__dirname, '../../node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(__dirname, '../node_modules/@anthropic-ai/claude-code/cli.js'),
          // Try process.cwd() based paths
          path.join(process.cwd(), 'node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(process.cwd(), '../node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(process.cwd(), '../../node_modules/@anthropic-ai/claude-code/cli.js'),
        ];

        // Find the first path that exists
        let found = false;
        for (const testPath of possiblePaths) {
          if (fs.existsSync(testPath)) {
            cliPath = testPath;
            found = true;
            console.log('Found claude-code CLI at:', cliPath);
            break;
          }
        }

        if (!found) {
          // Last resort - try require.resolve
          try {
            const claudeCodePath = require.resolve('@anthropic-ai/claude-code');
            const claudeCodeDir = path.dirname(claudeCodePath);
            cliPath = path.join(claudeCodeDir, 'cli.js');
            console.log('Resolved claude-code CLI at:', cliPath);
          } catch (err) {
            console.error('Failed to resolve claude-code package:', err);
            console.error('Tried paths:', possiblePaths);
            console.error('__dirname:', __dirname);
            console.error('process.cwd():', process.cwd());
            throw new Error('Could not find claude-code CLI executable. Tried: ' + possiblePaths.join(', '));
          }
        }

        // Set API key in environment for the CLI
        process.env.ANTHROPIC_API_KEY = this.apiKey;

        const claudeProjectPath = this.currentProjectPath || process.cwd();

        console.log(`Sending message to Claude (model: ${this.settings.model}) in project: ${claudeProjectPath}`);

        // Build options object conditionally
        const options: any = {
          pathToClaudeCodeExecutable: cliPath, // Explicitly provide the CLI path
          customSystemPrompt: systemPrompt,
          mcpServers: this.getMcpServersConfig(),
          allowedTools: ['*'], // Allow all tools
          cwd: claudeProjectPath,
          abortController: this.abortController,
          model: this.settings.model,
          permissionMode: 'bypassPermissions', // Automatically grant permissions for all tools
          // Add stderr handler to see error output
          stderr: (data: string) => {
            console.error('Claude Code CLI stderr:', data);
          }
        };

        // If we have a claude session ID from a previous message, use it to resume
        if (this.currentSession?.claudeSessionId) {
          options.resume = this.currentSession.claudeSessionId;
          console.log('Resuming claude-code session:', this.currentSession.claudeSessionId);
        } else {
          console.log('Starting new claude-code session');
        }

        console.log('Calling claude-code SDK with:');
        console.log('  CLI Path:', cliPath);
        console.log('  Model:', this.settings.model);
        console.log('  CWD:', this.currentProjectPath || process.cwd());
        console.log('  Our Session ID:', this.currentSessionId);
        console.log('  Claude Session ID:', this.currentSession?.claudeSessionId || 'none');
        console.log('  API Key set:', !!process.env.ANTHROPIC_API_KEY);
        console.log('  MCP Servers:', Object.keys(this.getMcpServersConfig()));
        console.log('  Allowed Tools:', options.allowedTools);

        // Use claude-code-sdk query function with correct API
        const queryIterator = query({
          prompt: message,
          options
        });

        let fullResponse = '';
        let actualSessionId: string | null = null;

        // Track tool calls separately from message content
        const toolCalls: Array<{ name: string; arguments?: any; result?: any }> = [];

        // Stream the response
        for await (const chunk of queryIterator) {
          // Handle different message types from the SDK
          if (typeof chunk === 'string') {
            fullResponse += chunk;

            // Send streaming response to renderer
            event.sender.send('claude:streamResponse', {
              partial: chunk,
              isComplete: false
            });
          } else if (chunk && typeof chunk === 'object') {
            // Check for session information
            if (chunk.session_id) {
              actualSessionId = chunk.session_id;
              console.log('Received actual session ID from CLI:', actualSessionId);
              // Store the claude-code session ID in our session data
              if (this.currentSession && this.currentSession.claudeSessionId !== actualSessionId) {
                this.currentSession.claudeSessionId = actualSessionId;
                this.saveSession(this.currentSession);
                console.log('Stored claude-code session ID in our session');
              }
            }

            // Handle different message types
            if (chunk.type === 'assistant' && chunk.message) {
              // Extract content from assistant message
              const content = chunk.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    fullResponse += block.text;
                    event.sender.send('claude:streamResponse', {
                      partial: block.text,
                      isComplete: false
                    });
                  } else if (block.type === 'tool_use') {
                    // Handle tool calls from Claude
                    console.log('Tool use detected:', block);

                    // Add to tool calls array
                    toolCalls.push({
                      name: block.name,
                      arguments: block.input
                    });

                    // If it's an applyDiff tool call, also emit it as an edit event for auto-apply
                    if (block.name === 'applyDiff' && block.input) {
                      console.log('Emitting applyDiff as edit event:', block.input);

                      // Convert from/to format to replacements format if needed
                      let replacements = [];
                      if (block.input.replacements) {
                        replacements = block.input.replacements;
                      } else if (block.input.from && block.input.to) {
                        // Convert from/to to a single replacement
                        replacements = [{
                          oldText: block.input.from,
                          newText: block.input.to
                        }];
                      }

                      // Send edit event to renderer for UI display
                      event.sender.send('claude:streamResponse', {
                        partial: '',
                        isComplete: false,
                        edits: [{
                          type: 'diff',
                          replacements: replacements
                        }],
                        toolCalls: [{
                          name: block.name,
                          arguments: block.input
                        }]
                      });
                    } else {
                      // Send tool call info for other tools
                      event.sender.send('claude:streamResponse', {
                        partial: '',
                        isComplete: false,
                        toolCalls: [{
                          name: block.name,
                          arguments: block.input
                        }]
                      });
                    }
                  }
                }
              } else if (typeof content === 'string') {
                fullResponse += content;
                event.sender.send('claude:streamResponse', {
                  partial: content,
                  isComplete: false
                });
              }
            } else if (chunk.type === 'tool_call' || chunk.type === 'tool_use') {
              // Handle standalone tool call events
              console.log('Standalone tool call detected:', chunk);

              // Add to tool calls array
              toolCalls.push({
                name: chunk.name || 'unknown',
                arguments: chunk.input
              });

              if (chunk.name === 'applyDiff' && chunk.input) {
                console.log('Emitting standalone applyDiff as edit event:', chunk.input);

                // Convert from/to format to replacements format if needed
                let replacements = [];
                if (chunk.input.replacements) {
                  replacements = chunk.input.replacements;
                } else if (chunk.input.from && chunk.input.to) {
                  // Convert from/to to a single replacement
                  replacements = [{
                    oldText: chunk.input.from,
                    newText: chunk.input.to
                  }];
                }

                // Send edit event to renderer for UI display
                event.sender.send('claude:streamResponse', {
                  partial: '',
                  isComplete: false,
                  edits: [{
                    type: 'diff',
                    replacements: replacements
                  }],
                  toolCalls: [{
                    name: chunk.name,
                    arguments: chunk.input
                  }]
                });
              } else {
                // Send tool call info for other tools
                event.sender.send('claude:streamResponse', {
                  partial: '',
                  isComplete: false,
                  toolCalls: [{
                    name: chunk.name || 'unknown',
                    arguments: chunk.input
                  }]
                });
              }
            } else if (chunk.type === 'text') {
              const text = chunk.text || chunk.content || '';
              fullResponse += text;

              event.sender.send('claude:streamResponse', {
                partial: text,
                isComplete: false
              });
            } else if (chunk.type === 'result') {
              // Final result - check if it succeeded
              if (chunk.is_error) {
                console.error('Claude Code result error:', chunk);
              }
              const result = chunk.result || chunk.content || '';
              if (typeof result === 'string' && result && !fullResponse.includes(result)) {
                fullResponse += result;
              }
            } else {
              // Log any unhandled chunk types for debugging
              console.log('Unhandled chunk type:', chunk.type, 'Full chunk:', JSON.stringify(chunk, null, 2));
            }
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

        // Send complete response (tool calls were already sent during streaming)
        event.sender.send('claude:streamResponse', {
          content: fullResponse,
          isComplete: true
        });

        return { content: fullResponse };
      } catch (error: any) {
        if (error instanceof AbortError) {
          console.log('Request was aborted');
          return { content: '', aborted: true };
        }

        // Log detailed error information
        console.error('Claude API error:', error);
        console.error('Error stack:', error.stack);

        // Send error to renderer for display in console
        event.sender.send('claude:error', {
          message: error.message || 'Unknown error occurred',
          stack: error.stack,
          type: error.constructor.name
        });

        // Throw a more informative error
        const errorMessage = error.message || 'Unknown error occurred';
        const enhancedError = new Error(`Claude Code SDK Error: ${errorMessage}`);
        enhancedError.stack = error.stack;
        throw enhancedError;
      } finally {
        this.abortController = null;
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
        this.currentSessionId = session.id;
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
      this.currentSessionId = null;

      // Abort any ongoing request
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }

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
        this.currentSessionId = null;

        // Clear from current session tracking
        const currentByProject = this.store.get('currentSessionByProject', {}) as Record<string, string>;
        if (currentByProject[project] === sessionId) {
          delete currentByProject[project];
          this.store.set('currentSessionByProject', currentByProject);
        }
      }

      return { success: true };
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
      if (!this.apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      try {
        // Find the claude-code CLI executable
        // The SDK expects to find cli.js in the same directory as sdk.mjs
        // We need to provide the absolute path to the actual CLI file
        let cliPath: string;

        // Try to find the CLI in various locations
        const possiblePaths = [
          // Development path - monorepo root node_modules
          path.join(__dirname, '../../../../node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(__dirname, '../../../../../node_modules/@anthropic-ai/claude-code/cli.js'),
          // Electron app node_modules
          path.join(__dirname, '../../node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(__dirname, '../node_modules/@anthropic-ai/claude-code/cli.js'),
          // Try process.cwd() based paths
          path.join(process.cwd(), 'node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(process.cwd(), '../node_modules/@anthropic-ai/claude-code/cli.js'),
          path.join(process.cwd(), '../../node_modules/@anthropic-ai/claude-code/cli.js'),
        ];

        // Find the first path that exists
        let found = false;
        for (const testPath of possiblePaths) {
          if (fs.existsSync(testPath)) {
            cliPath = testPath;
            found = true;
            console.log('Found claude-code CLI at:', cliPath);
            break;
          }
        }

        if (!found) {
          // Last resort - try require.resolve
          try {
            const claudeCodePath = require.resolve('@anthropic-ai/claude-code');
            const claudeCodeDir = path.dirname(claudeCodePath);
            cliPath = path.join(claudeCodeDir, 'cli.js');
            console.log('Resolved claude-code CLI at:', cliPath);
          } catch (err) {
            console.error('Failed to resolve claude-code package:', err);
            console.error('Tried paths:', possiblePaths);
            console.error('__dirname:', __dirname);
            console.error('process.cwd():', process.cwd());
            throw new Error('Could not find claude-code CLI executable. Tried: ' + possiblePaths.join(', '));
          }
        }

        // Set API key in environment for the CLI
        process.env.ANTHROPIC_API_KEY = this.apiKey;

        // Use claude-code-sdk to send a test message
        const testIterator = query({
          prompt: 'Say "Hello" in one word',
          options: {
            pathToClaudeCodeExecutable: cliPath,
            model: this.settings.model,
            customSystemPrompt: 'You are a test assistant. Respond with just "Hello".',
            stderr: (data: string) => {
              console.error('Test connection stderr:', data);
            }
          }
        });

        // Just iterate to completion to test the connection
        for await (const chunk of testIterator) {
          // Connection successful if we get any response
        }

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
    // Update the MCP server's document state directly
    updateDocumentState(documentContext);

    // Also send to renderer windows for their awareness
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
    const sessionId = uuidv4();
    const session: SessionData = {
      id: sessionId,
      timestamp: Date.now(),
      messages: [],
      documentContext,
      projectPath: this.currentProjectPath || 'default',
      title: 'New conversation'
    };

    this.currentSessionId = sessionId;
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
    // Abort any ongoing requests
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clean up resources
    this.removeAllListeners();
  }
}
