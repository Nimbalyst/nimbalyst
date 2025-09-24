import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { AIProvider, AIMessage, AIStreamResponse, AIStreamChunk, AIToolCall, AIToolResult } from '../../types';
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
      id: 'openai-codex:openai-codex-cli',
      name: 'OpenAI Codex CLI',
      provider: 'openai-codex',
      contextWindow: 272000,
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
    console.log('[OpenAICodexProvider] streamChat called with:', {
      messageCount: messages.length,
      workingDir: options?.workingDirectory,
      model: options?.model,
      sessionId: options?.sessionId,
      hasApiKey: !!this.apiKey
    });
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
      console.log('[OpenAICodexProvider] Spawning codex process:', codexPath, args.join(' '));
      const codexProcess = spawn(codexPath, args, {
        cwd: workingDir,
        env: {
          ...process.env,
          OPENAI_API_KEY: this.apiKey
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      console.log('[OpenAICodexProvider] Writing prompt to stdin:', prompt.substring(0, 200));
      // Write prompt to stdin and close it
      codexProcess.stdin.write(prompt);
      codexProcess.stdin.end();
      console.log('[OpenAICodexProvider] Prompt sent, waiting for response...');

      let buffer = '';
      let hasError = false;
      let fullText = '';
      let processExited = false;
      let exitCode: number | null = null;

      // Set up process exit handler
      const processExitPromise = new Promise<void>((resolve, reject) => {
        codexProcess.on('exit', (code) => {
          console.log('[OpenAICodexProvider] Codex process exited with code:', code);
          processExited = true;
          exitCode = code;
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Codex process exited with code ${code}`));
          }
        });

        codexProcess.on('error', (error) => {
          console.error('[OpenAICodexProvider] Codex process error:', error);
          hasError = true;
          reject(error);
        });
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

      // Handle stdout (JSON messages) and yield chunks as they arrive
      codexProcess.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        console.log('[OpenAICodexProvider] Got stdout chunk:', chunk.substring(0, 200));
        buffer += chunk;
      });

      // Poll for messages and yield them as they arrive
      let chunksYielded = 0;
      let lastYieldTime = Date.now();

      try {
        while (!processExited) {
          await new Promise(resolve => setTimeout(resolve, 50)); // Poll every 50ms

          // Process any buffered data
          if (buffer.length > 0) {
            const lines = buffer.split('\n');
            buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

            for (let i = 0; i < lines.length - 1; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              try {
                const jsonMessage = JSON.parse(line);
                console.log('[OpenAICodexProvider] Parsed JSON message type:', jsonMessage.msg?.type || jsonMessage.type);

                let messageText = '';

                if (jsonMessage.msg) {
                  const msg = jsonMessage.msg;
                  if (msg.type === 'agent_message' && msg.message) {
                    messageText = msg.message;
                    console.log('[OpenAICodexProvider] Got agent message:', messageText.substring(0, 100));
                  } else if (msg.type === 'exec_command_end' && msg.formatted_output) {
                    messageText = msg.formatted_output;
                    console.log('[OpenAICodexProvider] Got command output:', messageText.substring(0, 100));
                  }
                } else if (jsonMessage.message) {
                  messageText = jsonMessage.message;
                  console.log('[OpenAICodexProvider] Got direct message:', messageText.substring(0, 100));
                }

                if (messageText) {
                  fullText += messageText + '\n';
                  console.log('[OpenAICodexProvider] Yielding text chunk #' + (++chunksYielded) + ':', messageText.substring(0, 100));
                  const timeSinceLastYield = Date.now() - lastYieldTime;
                  console.log('[OpenAICodexProvider] Time since last yield:', timeSinceLastYield, 'ms');
                  lastYieldTime = Date.now();

                  // Yield text chunk immediately
                  const chunk: AIStreamChunk = {
                    type: 'text',
                    content: messageText
                  };
                  console.log('[OpenAICodexProvider] Yielding chunk object:', JSON.stringify(chunk));
                  yield chunk;
                }
              } catch (e) {
                // Not JSON, skip
                console.log('[OpenAICodexProvider] Could not parse as JSON:', line.substring(0, 100));
              }
            }
          }
        }

        console.log('[OpenAICodexProvider] Process has exited, waiting for clean exit...');
        // Wait for process to exit cleanly (in case there's an error)
        await processExitPromise.catch(err => {
          console.error('[OpenAICodexProvider] Process exit error:', err);
          throw err;
        });

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const jsonMessage = JSON.parse(buffer.trim());
            let messageText = '';

            if (jsonMessage.msg) {
              const msg = jsonMessage.msg;
              if (msg.type === 'agent_message' && msg.message) {
                messageText = msg.message;
              } else if (msg.type === 'exec_command_end' && msg.formatted_output) {
                messageText = msg.formatted_output;
              }
            } else if (jsonMessage.message) {
              messageText = jsonMessage.message;
            }

            if (messageText) {
              fullText += messageText;
              yield {
                type: 'text',
                content: messageText  // Changed from 'text' to 'content'
              };
            }
          } catch (e) {
            // Not JSON, skip
          }
        }

        // Send complete chunk
        console.log('[OpenAICodexProvider] Sending complete chunk with full text:', fullText.substring(0, 100));
        console.log('[OpenAICodexProvider] Total chunks yielded:', chunksYielded);

        const completeChunk: AIStreamChunk = {
          type: 'complete',
          content: fullText,
          isComplete: true,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
          }
        };
        console.log('[OpenAICodexProvider] Yielding complete chunk:', JSON.stringify(completeChunk));
        yield completeChunk;
        console.log('[OpenAICodexProvider] Complete chunk yielded successfully');
      } catch (error) {
        console.error('[OpenAICodexProvider] Process error:', error);
        console.error('[OpenAICodexProvider] Error stack:', error instanceof Error ? error.stack : 'No stack');
        const errorChunk: AIStreamChunk = {
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        };
        yield errorChunk;
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
    console.log('[OpenAICodexProvider] ========== sendMessage START ==========');
    console.log('[OpenAICodexProvider] sendMessage called:', {
      message: message.substring(0, 100),
      hasDocumentContext: !!documentContext,
      sessionId,
      previousMessageCount: messages?.length || 0
    });

    try {
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
      console.log('[OpenAICodexProvider] Calling streamChat with', aiMessages.length, 'messages');
      const streamResponse = this.streamChat(aiMessages, {
        sessionId,
        workingDirectory: documentContext?.workingDirectory
      });

      // Convert the stream response to StreamChunk format
      console.log('[OpenAICodexProvider] sendMessage: Starting to process stream chunks...');
      let chunkCount = 0;
      let totalContent = '';
      let hasError = false;
      let hasCompleted = false;

      for await (const chunk of streamResponse) {
        chunkCount++;
        console.log(`[OpenAICodexProvider] sendMessage: Received chunk #${chunkCount}`);
        console.log(`[OpenAICodexProvider] sendMessage: Chunk details:`, JSON.stringify(chunk));

        if (chunk.type === 'text') {
          const content = chunk.content || '';
          totalContent += content;
          console.log(`[OpenAICodexProvider] sendMessage: Yielding content chunk #${chunkCount} with ${content.length} chars`);

          const yieldChunk: StreamChunk = {
            type: 'text',  // AIService expects 'text' not 'content'!
            content: content
          };
          console.log(`[OpenAICodexProvider] sendMessage: About to yield:`, JSON.stringify(yieldChunk));
          yield yieldChunk;
          console.log(`[OpenAICodexProvider] sendMessage: Successfully yielded content chunk #${chunkCount}`);
        } else if (chunk.type === 'error') {
          hasError = true;
          console.error(`[OpenAICodexProvider] sendMessage: ERROR in chunk #${chunkCount}: ${chunk.error}`);
          yield {
            type: 'error',
            error: chunk.error || 'Unknown error'
          };
        } else if (chunk.type === 'complete') {
          hasCompleted = true;
          console.log(`[OpenAICodexProvider] sendMessage: Stream complete at chunk #${chunkCount}`);
          console.log(`[OpenAICodexProvider] sendMessage: Total content received: ${totalContent.length} chars`);
          console.log(`[OpenAICodexProvider] sendMessage: Yielding complete chunk to AIService`);

          // MUST yield the complete chunk so AIService knows to stop the spinner!
          yield {
            type: 'complete',
            content: chunk.content || totalContent,
            isComplete: true,
            usage: chunk.usage
          };
          console.log(`[OpenAICodexProvider] sendMessage: Successfully yielded complete chunk`);
        } else {
          console.warn(`[OpenAICodexProvider] sendMessage: Unknown chunk type '${chunk.type}' at chunk #${chunkCount}`);
        }
      }

      console.log(`[OpenAICodexProvider] sendMessage: Iterator complete. Processed ${chunkCount} chunks, total content: ${totalContent.length} chars`);
      console.log(`[OpenAICodexProvider] sendMessage: hasError: ${hasError}, hasCompleted: ${hasCompleted}`);

      if (!hasError && chunkCount === 0) {
        console.error('[OpenAICodexProvider] sendMessage: WARNING - No chunks received from streamChat!');
        yield {
          type: 'error',
          error: 'No response received from Codex'
        };
      } else if (!hasError && !hasCompleted && totalContent.length === 0) {
        console.error('[OpenAICodexProvider] sendMessage: WARNING - No content received despite chunks!');
        yield {
          type: 'error',
          error: 'Empty response from Codex'
        };
      }
    } catch (error) {
      console.error('[OpenAICodexProvider] sendMessage: FATAL ERROR:', error);
      console.error('[OpenAICodexProvider] sendMessage: Error stack:', error instanceof Error ? error.stack : 'No stack');
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      console.log('[OpenAICodexProvider] ========== sendMessage END ==========');
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