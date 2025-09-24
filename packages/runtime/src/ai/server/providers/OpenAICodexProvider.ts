import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { AIProvider, AIMessage, AIStreamResponse, AIToolCall, AIToolResult } from '../../types';
import {
  ProviderConfig,
  ToolHandler,
  DocumentContext,
  StreamChunk,
  Message,
  ProviderCapabilities
} from '../types';

export class OpenAICodexProvider extends EventEmitter implements AIProvider {
  private apiKey: string;
  private config?: ProviderConfig;
  private toolHandler?: ToolHandler;
  static readonly DEFAULT_MODEL = 'gpt-5';

  constructor(config?: { apiKey?: string }) {
    super();
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    if (config.apiKey) {
      this.apiKey = config.apiKey;
    }
    console.log('[OpenAICodexProvider] Initialized with config:', {
      hasApiKey: !!this.apiKey,
      model: config.model
    });
  }

  registerToolHandler(handler: ToolHandler): void {
    this.toolHandler = handler;
    console.log('[OpenAICodexProvider] Tool handler registered');
  }

  static getModels() {
    return [{
      id: 'openai-codex:gpt-5',
      name: 'GPT-5 (Codex)',
      provider: 'openai-codex',
      contextWindow: 128000,
      maxTokens: 16384
    }, {
      id: 'openai-codex:gpt-4o',
      name: 'GPT-4o (Codex)',
      provider: 'openai-codex',
      contextWindow: 128000,
      maxTokens: 16384
    }];
  }

  static getDefaultModel() {
    return this.DEFAULT_MODEL;
  }

  getName(): string {
    return 'openai-codex';
  }

  getDisplayName(): string {
    return 'OpenAI Codex';
  }

  getDescription(): string {
    return 'OpenAI Codex CLI for advanced code generation';
  }

  async *streamChat(
    messages: AIMessage[],
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: any[];
      sessionId?: string;
      workingDirectory?: string;
    }
  ): AIStreamResponse {
    const workingDir = options?.workingDirectory || process.cwd();
    const model = options?.model || 'gpt-5';

    // Build the prompt from messages
    const prompt = messages
      .map(msg => {
        if (msg.role === 'system') return `System: ${msg.content}`;
        if (msg.role === 'user') return `User: ${msg.content}`;
        if (msg.role === 'assistant') return `Assistant: ${msg.content}`;
        return msg.content;
      })
      .join('\n\n');

    // Build codex command arguments
    const args = ['exec', '--json', '--skip-git-repo-check'];

    // Add model if specified
    if (model && model !== 'auto') {
      args.push('-m', model);
    }

    console.log('[OpenAICodexProvider] Executing codex command:', 'codex', args.join(' '));
    console.log('[OpenAICodexProvider] Prompt:', prompt);

    try {
      // Find codex executable
      const codexPath = await this.findCodexExecutable();
      if (!codexPath) {
        throw new Error('Codex CLI not found. Please install @openai/codex');
      }

      // Spawn codex process
      const codexProcess = spawn(codexPath, args, {
        cwd: workingDir,
        env: {
          ...process.env,
          OPENAI_API_KEY: this.apiKey
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Write prompt to stdin and close it
      codexProcess.stdin.write(prompt);
      codexProcess.stdin.end();

      let buffer = '';
      let hasError = false;

      // Handle stdout (JSON messages)
      codexProcess.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();

        // Try to parse complete JSON messages
        const lines = buffer.split('\n');
        buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          try {
            const jsonMessage = JSON.parse(line);
            // Process JSON message and yield appropriate chunks
            if (jsonMessage.type === 'message' || jsonMessage.content) {
              // Yield text content
              const text = jsonMessage.content || jsonMessage.message || '';
              if (text) {
                // Don't yield in generator, store for later
              }
            }
          } catch (e) {
            // Not JSON, treat as plain text
            if (line && !hasError) {
              // Store plain text for later
            }
          }
        }
      });

      // Handle stderr (codex outputs informational messages here)
      codexProcess.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        console.log('[OpenAICodexProvider] Codex info:', msg);
        // Don't treat stderr as error unless it contains actual error keywords
        if (msg.includes('Error:') || msg.includes('error:') || msg.includes('failed')) {
          hasError = true;
        }
      });

      // Create a promise to handle process completion
      const processComplete = new Promise<string>((resolve, reject) => {
        let fullResponse = '';

        codexProcess.stdout.on('data', (data: Buffer) => {
          fullResponse += data.toString();
        });

        codexProcess.on('exit', (code) => {
          if (code === 0) {
            resolve(fullResponse);
          } else {
            reject(new Error(`Codex process exited with code ${code}`));
          }
        });

        codexProcess.on('error', (error) => {
          reject(error);
        });
      });

      // Wait for the process to complete and get full response
      try {
        const fullResponse = await processComplete;

        // Parse and yield the response
        const lines = fullResponse.split('\n');
        let combinedText = '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const jsonMessage = JSON.parse(line);

            // Extract message text from different types of codex messages
            if (jsonMessage.msg) {
              const msg = jsonMessage.msg;

              // Handle agent messages (the actual AI responses)
              if (msg.type === 'agent_message' && msg.message) {
                combinedText += msg.message + '\n';
              }
              // Handle command output
              else if (msg.type === 'exec_command_end' && msg.formatted_output) {
                combinedText += msg.formatted_output;
              }
            }
            // Also check for direct message field
            else if (jsonMessage.message) {
              combinedText += jsonMessage.message + '\n';
            }
          } catch {
            // Not JSON, skip
          }
        }

        if (combinedText) {
          yield {
            type: 'text',
            text: combinedText
          };
        }

        yield {
          type: 'finish',
          text: combinedText,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
          }
        };
      } catch (error) {
        console.error('[OpenAICodexProvider] Process error:', error);
        yield {
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        };
      }
    } catch (error) {
      console.error('[OpenAICodexProvider] Error:', error);
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async findCodexExecutable(): Promise<string | null> {
    // Check for custom path in environment
    if (process.env.CODEX_PATH) {
      return process.env.CODEX_PATH;
    }

    // Try to find codex in PATH
    const { execSync } = require('child_process');
    try {
      const result = execSync('which codex', { encoding: 'utf8' }).trim();
      if (result) {
        console.log(`[OpenAICodexProvider] Found codex at: ${result}`);
        return result;
      }
    } catch (e) {
      // Not found in PATH
    }

    // Check common installation paths
    const possiblePaths = [
      path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.15.1', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
      path.join(os.homedir(), '.local', 'bin', 'codex'),
    ];

    const fs = require('fs');
    for (const codexPath of possiblePaths) {
      try {
        fs.accessSync(codexPath, fs.constants.X_OK);
        console.log(`[OpenAICodexProvider] Found codex at: ${codexPath}`);
        return codexPath;
      } catch (e) {
        // Continue checking other paths
      }
    }

    console.warn('[OpenAICodexProvider] Codex CLI not found');
    return null;
  }

  async handleToolCall(
    toolCall: AIToolCall,
    options?: {
      sessionId?: string;
      workingDirectory?: string;
    }
  ): Promise<AIToolResult> {
    console.log('[OpenAICodexProvider] Tool calls not yet implemented for Codex CLI');

    return {
      toolCallId: toolCall.id,
      result: 'Tool calls not supported in Codex CLI mode',
      isError: true
    };
  }

  async cancelStream(sessionId?: string): Promise<void> {
    // Codex exec commands are not long-running sessions
    console.log('[OpenAICodexProvider] Cancel requested');
  }

  async *sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[]
  ): AsyncIterableIterator<StreamChunk> {
    // Convert to the format expected by streamChat
    const aiMessages: AIMessage[] = [];

    // Add previous messages if provided
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        aiMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content
        });
      }
    }

    // Add the current message
    aiMessages.push({
      role: 'user',
      content: message
    });

    // Add document context if provided
    if (documentContext) {
      const contextMessage = `Current document context:
File: ${documentContext.fileName || 'untitled'}
Language: ${documentContext.language || 'unknown'}
Content:
\`\`\`${documentContext.language || ''}
${documentContext.content}
\`\`\``;

      aiMessages.unshift({
        role: 'system',
        content: contextMessage
      });
    }

    // Use streamChat to handle the actual streaming
    const streamResponse = this.streamChat(aiMessages, {
      sessionId,
      workingDirectory: documentContext?.workingDirectory
    });

    // Convert the stream response to StreamChunk format
    for await (const chunk of streamResponse) {
      if (chunk.type === 'text') {
        yield {
          type: 'content',
          content: chunk.text || ''
        };
      } else if (chunk.type === 'error') {
        yield {
          type: 'error',
          error: chunk.error || 'Unknown error'
        };
      } else if (chunk.type === 'finish') {
        // Stream is complete
        break;
      }
    }
  }

  abort(): void {
    // Codex exec commands complete quickly
    this.cancelStream();
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: false,
      mcpSupport: false
    };
  }

  destroy(): void {
    this.dispose();
  }

  dispose(): void {
    // Clean up if needed
  }
}