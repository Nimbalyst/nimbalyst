/**
 * Claude Code provider using claude-code SDK with MCP support
 */

import { query, AbortError } from '@anthropic-ai/claude-code';
import { BaseAIProvider } from '../AIProvider';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk,
  AIModel 
} from '../types';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export class ClaudeCodeProvider extends BaseAIProvider {
  private abortController: AbortController | null = null;
  private claudeSessionIds: Map<string, string> = new Map(); // Our session ID -> Claude session ID
  
  static readonly DEFAULT_MODEL = 'claude-code';

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    
    if (!config.apiKey) {
      throw new Error('API key required for Claude Code provider');
    }

    // Set API key in environment for the CLI
    process.env.ANTHROPIC_API_KEY = config.apiKey;
  }

  async *sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string
  ): AsyncIterableIterator<StreamChunk> {
    const startTime = Date.now();
    console.log(`[ClaudeCodeProvider] Starting sendMessage - message length: ${message.length}, hasContext: ${!!documentContext}`);
    
    if (!this.config.apiKey) {
      throw new Error('Claude Code provider not initialized');
    }

    // Create abort controller for this request
    this.abortController = new AbortController();

    try {
      // In production, ensure we have node in PATH
      this.ensureNodeInPath();
      
      // Find the claude-code CLI executable
      const cliPathStart = Date.now();
      const cliPath = await this.findCliPath();
      console.log(`[ClaudeCodeProvider] CLI path resolution took ${Date.now() - cliPathStart}ms`);
      
      // Build system prompt with document context
      const promptBuildStart = Date.now();
      const systemPrompt = this.buildSystemPrompt(documentContext);
      console.log(`[ClaudeCodeProvider] System prompt build took ${Date.now() - promptBuildStart}ms, length: ${systemPrompt.length}`);

      // Get project path from document context
      const projectPath = documentContext?.filePath?.split('/').slice(0, -1).join('/') || process.cwd();

      // Build options for claude-code
      const options: any = {
        pathToClaudeCodeExecutable: cliPath,
        customSystemPrompt: systemPrompt,
        mcpServers: this.getMcpServersConfig(),
        allowedTools: ['*'],
        cwd: projectPath,
        abortController: this.abortController,
        model: this.config.model || 'claude-3-5-sonnet-20241022',
        permissionMode: 'bypassPermissions',
        // Specify node executable for production builds
        nodeExecutable: this.getNodeExecutable()
      };

      // If we have a session ID and a claude session ID, resume
      if (sessionId) {
        const claudeSessionId = this.claudeSessionIds.get(sessionId);
        if (claudeSessionId) {
          options.resume = claudeSessionId;
          console.log(`[ClaudeCodeProvider] Resuming claude-code session: ${claudeSessionId}`);
        } else {
          console.log(`[ClaudeCodeProvider] No existing Claude session for ID: ${sessionId}`);
        }
      }

      // Use claude-code-sdk query function
      console.log(`[ClaudeCodeProvider] Calling query with options:`, {
        model: options.model,
        hasSystemPrompt: !!options.customSystemPrompt,
        hasMcpServers: !!options.mcpServers,
        cwd: options.cwd,
        resume: options.resume
      });
      
      const queryStartTime = Date.now();
      const queryIterator = query({
        prompt: message,
        options
      });

      let fullContent = '';
      let chunkCount = 0;
      let firstChunkTime: number | undefined;
      let toolCallCount = 0;

      // Stream the response
      for await (const chunk of queryIterator) {
        chunkCount++;
        
        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          const timeToFirstChunk = firstChunkTime - queryStartTime;
          console.log(`[ClaudeCodeProvider] First chunk received after ${timeToFirstChunk}ms (total: ${firstChunkTime - startTime}ms from start)`);
        }
        if (typeof chunk === 'string') {
          // Text chunk
          fullContent += chunk;
          yield {
            type: 'text',
            content: chunk
          };
        } else if (chunk && typeof chunk === 'object') {
          // Handle different message types from the SDK
          if (chunk.session_id && sessionId) {
            // Store the claude session ID
            this.claudeSessionIds.set(sessionId, chunk.session_id);
          }

          if (chunk.type === 'assistant' && chunk.message) {
            const content = chunk.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text') {
                  fullContent += block.text;
                  yield {
                    type: 'text',
                    content: block.text
                  };
                } else if (block.type === 'tool_use') {
                  // Handle tool calls from Claude
                  toolCallCount++;
                  console.log(`[ClaudeCodeProvider] Tool use #${toolCallCount} detected: ${block.name}`);
                  
                  // Emit tool call event
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      name: block.name,
                      arguments: block.input
                    }
                  };

                  // If it's an applyDiff tool, execute it
                  if (block.name === 'applyDiff' && this.toolHandler) {
                    try {
                      const result = await this.toolHandler.applyDiff(block.input);
                      // Tool result will be sent back to Claude Code automatically
                    } catch (error) {
                      console.error('Error executing applyDiff:', error);
                    }
                  }
                }
              }
            } else if (typeof content === 'string') {
              fullContent += content;
              yield {
                type: 'text',
                content
              };
            }
          } else if (chunk.type === 'tool_call' || chunk.type === 'tool_use') {
            // Standalone tool call event
            toolCallCount++;
            console.log(`[ClaudeCodeProvider] Standalone tool call #${toolCallCount}: ${chunk.name}`);
            
            yield {
              type: 'tool_call',
              toolCall: {
                name: chunk.name || 'unknown',
                arguments: chunk.input
              }
            };

            // Handle applyDiff
            if (chunk.name === 'applyDiff' && chunk.input && this.toolHandler) {
              try {
                const result = await this.toolHandler.applyDiff(chunk.input);
              } catch (error) {
                console.error('Error executing applyDiff:', error);
              }
            }
          } else if (chunk.type === 'text') {
            const text = chunk.text || chunk.content || '';
            fullContent += text;
            yield {
              type: 'text',
              content: text
            };
          } else if (chunk.type === 'result') {
            // Final result
            if (chunk.is_error) {
              console.error('Claude Code result error:', chunk);
            }
          }
        }
      }

      // Send completion event
      const totalTime = Date.now() - startTime;
      console.log(`[ClaudeCodeProvider] Stream complete - Total time: ${totalTime}ms, Chunks: ${chunkCount}, Tool calls: ${toolCallCount}, Content length: ${fullContent.length}`);
      
      yield {
        type: 'complete',
        content: fullContent,
        isComplete: true
      };

    } catch (error: any) {
      const errorTime = Date.now() - startTime;
      if (error instanceof AbortError) {
        console.log(`[ClaudeCodeProvider] Request was aborted after ${errorTime}ms`);
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error(`[ClaudeCodeProvider] Error after ${errorTime}ms:`, error);
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
      mcpSupport: true,  // Full MCP support
      edits: true,
      resumeSession: true  // Can resume Claude Code sessions
    };
  }

  setProviderSessionData(sessionId: string, data: any): void {
    if (data.claudeSessionId) {
      this.claudeSessionIds.set(sessionId, data.claudeSessionId);
    }
  }

  getProviderSessionData(sessionId: string): any {
    return {
      claudeSessionId: this.claudeSessionIds.get(sessionId)
    };
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

  private async findCliPath(): Promise<string> {
    // Try to find the CLI in various locations
    const possiblePaths = [
      path.join(__dirname, '../../../../node_modules/@anthropic-ai/claude-code/cli.js'),
      path.join(__dirname, '../../../../../node_modules/@anthropic-ai/claude-code/cli.js'),
      path.join(__dirname, '../../node_modules/@anthropic-ai/claude-code/cli.js'),
      path.join(__dirname, '../node_modules/@anthropic-ai/claude-code/cli.js'),
      path.join(process.cwd(), 'node_modules/@anthropic-ai/claude-code/cli.js'),
      path.join(process.cwd(), '../node_modules/@anthropic-ai/claude-code/cli.js'),
      path.join(process.cwd(), '../../node_modules/@anthropic-ai/claude-code/cli.js'),
    ];

    // Find the first path that exists
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        console.log(`[ClaudeCodeProvider] Found claude-code CLI at: ${testPath}`);
        return testPath;
      }
    }

    // Last resort - try require.resolve
    try {
      const claudeCodePath = require.resolve('@anthropic-ai/claude-code');
      const claudeCodeDir = path.dirname(claudeCodePath);
      const cliPath = path.join(claudeCodeDir, 'cli.js');
      console.log(`[ClaudeCodeProvider] Resolved claude-code CLI at: ${cliPath}`);
      return cliPath;
    } catch (err) {
      throw new Error('Could not find claude-code CLI executable');
    }
  }

  private buildSystemPrompt(documentContext?: DocumentContext): string {
    const basePrompt = super.buildSystemPrompt(documentContext);
    
    // If no document is open, return just the base prompt (which already has the no-document warning)
    const hasDocument = documentContext && (documentContext.filePath || documentContext.content);
    if (!hasDocument) {
      return basePrompt;
    }
    
    return `${basePrompt}

You have access to the following MCP tools for document editing:
- getDocument: Get the current document content and metadata
- applyDiff: Apply text replacements to the document with diff preview
- streamContent: Stream markdown content into the document at specific positions
- getSelection: Get the current selection or cursor position
- navigateTo: Navigate to a specific line and column
- getOutline: Get the document outline (headings structure)
- searchInDocument: Search for text in the current document

CRITICAL RESPONSE RULES - YOU MUST FOLLOW THESE:
1. When editing documents, your ENTIRE response should be 1 short sentence MAX
2. NEVER explain what you're about to do (e.g., "Let me...", "I'll...", "First...")
3. NEVER describe what you added - the user sees it in the document
4. NEVER list the content you added
5. NEVER explain your reasoning unless explicitly asked

GOOD responses after editing:
- "Done."
- "Added the section."
- "Fixed the formatting."
- "Updated with examples."

Remember: The user can SEE the changes in their editor. They don't need you to describe them.`;
  }

  /**
   * Ensure node is available in PATH for production builds
   */
  private ensureNodeInPath(): void {
    if (!app.isPackaged) {
      return; // In development, node is already available
    }

    // In production, add Electron's internal node to PATH
    const electronPath = process.execPath;
    const electronDir = path.dirname(electronPath);
    
    if (!process.env.PATH?.includes(electronDir)) {
      process.env.PATH = `${electronDir}:${process.env.PATH}`;
      console.log('[ClaudeCodeProvider] Added Electron dir to PATH:', electronDir);
    }
  }

  /**
   * Get the node executable path for claude-code to use
   */
  private getNodeExecutable(): string | undefined {
    if (!app.isPackaged) {
      return undefined; // Use system node in development
    }

    // In production, use Electron's node binary
    return process.execPath;
  }

  /**
   * Get Claude Code model
   */
  static getModels(): AIModel[] {
    return [{
      id: 'claude-code',
      name: 'Claude Code',
      provider: 'claude-code' as const,
      maxTokens: 8192,
      contextWindow: 200000
    }];
  }

  /**
   * Get default model
   */
  static getDefaultModel(): string {
    return this.DEFAULT_MODEL;
  }
}