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
    if (!this.config.apiKey) {
      throw new Error('Claude Code provider not initialized');
    }

    // Create abort controller for this request
    this.abortController = new AbortController();

    try {
      // Find the claude-code CLI executable
      const cliPath = await this.findCliPath();
      
      // Build system prompt with document context
      const systemPrompt = this.buildSystemPrompt(documentContext);

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
        permissionMode: 'bypassPermissions'
      };

      // If we have a session ID and a claude session ID, resume
      if (sessionId) {
        const claudeSessionId = this.claudeSessionIds.get(sessionId);
        if (claudeSessionId) {
          options.resume = claudeSessionId;
          console.log('Resuming claude-code session:', claudeSessionId);
        }
      }

      // Use claude-code-sdk query function
      const queryIterator = query({
        prompt: message,
        options
      });

      let fullContent = '';

      // Stream the response
      for await (const chunk of queryIterator) {
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
                  console.log('Tool use detected:', block.name);
                  
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
            console.log('Standalone tool call:', chunk.name);
            
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
      yield {
        type: 'complete',
        content: fullContent,
        isComplete: true
      };

    } catch (error: any) {
      if (error instanceof AbortError) {
        console.log('Request was aborted');
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error('Claude Code SDK error:', error);
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
        console.log('Found claude-code CLI at:', testPath);
        return testPath;
      }
    }

    // Last resort - try require.resolve
    try {
      const claudeCodePath = require.resolve('@anthropic-ai/claude-code');
      const claudeCodeDir = path.dirname(claudeCodePath);
      const cliPath = path.join(claudeCodeDir, 'cli.js');
      console.log('Resolved claude-code CLI at:', cliPath);
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