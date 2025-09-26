import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { BaseAIProvider } from '../AIProvider';
import { AIStreamChunk } from '../../types';
import {
  ProviderConfig,
  DocumentContext,
  StreamChunk,
  Message,
  ProviderCapabilities
} from '../types';

export class OpenAICodexProvider extends BaseAIProvider {
  private apiKey: string;
  private abortController: AbortController | null = null;
  private activeProcess: ChildProcess | null = null;
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
      model: config.model,
      hasToolHandler: !!this.toolHandler
    });
  }

  // registerToolHandler is now inherited from BaseAIProvider

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

  private async *executeCodex(
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: any[];
      sessionId?: string;
      workingDirectory?: string;
      mcpServerUrl?: string;
    }
  ): AsyncIterableIterator<AIStreamChunk> {
    console.log('[OpenAICodexProvider] executeCodex called with:', {
      promptLength: prompt.length,
      workingDir: options?.workingDirectory,
      model: options?.model,
      sessionId: options?.sessionId,
      mcpServerUrl: options?.mcpServerUrl,
      hasApiKey: !!this.apiKey
    });
    const workingDir = options?.workingDirectory || process.cwd();
    const model = options?.model || 'gpt-5';

    // Build codex command arguments
    const args = ['exec', '--json', '--skip-git-repo-check'];

    // Add model if specified
    if (model && model !== 'auto') {
        // todo its currently pushing made up models
      // args.push('-m', model);
    }

    console.log('[OpenAICodexProvider] Executing codex command:', 'codex', args.join(' '));
    console.log('[OpenAICodexProvider] Prompt:', prompt);

    try {
      // Find codex executable
      const codexPath = await this.findCodexExecutable();
      if (!codexPath) {
        throw new Error('Codex CLI not found. Please install @openai/codex');
      }

      // Add configuration arguments
      const configArgs = [];

      // Disable sandbox mode - it causes issues on macOS with /bin/false
      // and we need file system access for MCP tools anyway
      configArgs.push('-c', 'sandbox="off"');
      console.log('[OpenAICodexProvider] Sandbox mode disabled for MCP tool access');

      // Configure MCP stdio server for tool support
      // Resolve the path relative to this file's actual location in the source tree
      // In dev: packages/runtime/src/ai/server/providers/
      // In prod: packages/electron/out/main/ (after bundling)
      let mcpServerPath: string;

      // Check if we're in development or production
      if (process.env.NODE_ENV === 'development' || __dirname.includes('src/ai/server/providers')) {
        // Development: Use the source path
        mcpServerPath = path.resolve(__dirname, './mcp-stdio-server.js');
      } else {
        // Production: Look for the bundled version
        // Try to resolve from the runtime package first
        const runtimePath = path.resolve(__dirname, '../../../../runtime/src/ai/server/providers/mcp-stdio-server.js');
        const electronPath = path.resolve(__dirname, './mcp-stdio-server.js');

        // Check which one exists
        if (require('fs').existsSync(runtimePath)) {
          mcpServerPath = runtimePath;
        } else {
          mcpServerPath = electronPath;
        }
      }

      console.log('[OpenAICodexProvider] MCP server path resolved to:', mcpServerPath);

      // Configure Codex to use our native stdio MCP server
      configArgs.push('-c', `mcp_servers.preditor.command="node"`);
      configArgs.push('-c', `mcp_servers.preditor.args=["${mcpServerPath}"]`);
      configArgs.push('-c', 'mcp_servers.preditor.name="Preditor Editor"');
      configArgs.push('-c', 'mcp_servers.preditor.description="Preditor MCP tools for file operations"');

      // Enable debug logging if needed
      if (process.env.DEBUG_MCP || options?.mcpServerUrl) {
        process.env.DEBUG_MCP_STDIO = 'true';
        console.log('[OpenAICodexProvider] MCP stdio server configured:', mcpServerPath);
      }

      // Spawn codex process
      const fullArgs = [...args, ...configArgs];
      console.log('[OpenAICodexProvider] Spawning codex process:', codexPath, fullArgs.join(' '));
      const codexProcess = spawn(codexPath, fullArgs, {
        cwd: workingDir,
        env: {
          ...process.env,
          OPENAI_API_KEY: this.apiKey
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Track the active process so we can abort it if needed
      this.activeProcess = codexProcess;

      // Set up abort controller for this request
      this.abortController = new AbortController();

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
          // Check for abort signal
          if (this.abortController?.signal.aborted) {
            console.log('[OpenAICodexProvider] Processing aborted by user');
            throw new Error('Operation cancelled');
          }

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
                let toolCall = null;

                if (jsonMessage.msg) {
                  const msg = jsonMessage.msg;
                  if (msg.type === 'agent_message' && msg.message) {
                    messageText = msg.message;
                    console.log('[OpenAICodexProvider] Got agent message:', messageText.substring(0, 100));
                  } else if (msg.type === 'exec_command_end' && msg.formatted_output) {
                    messageText = msg.formatted_output;
                    console.log('[OpenAICodexProvider] Got command output:', messageText.substring(0, 100));
                  } else if (msg.type === 'tool_use' || msg.type === 'mcp_tool_use') {
                    // Handle tool calls from Codex via MCP
                    toolCall = {
                      name: msg.tool_name || msg.name,
                      arguments: msg.arguments || msg.input
                    };
                    console.log('[OpenAICodexProvider] Got tool call:', toolCall.name);
                  }
                } else if (jsonMessage.message) {
                  messageText = jsonMessage.message;
                  console.log('[OpenAICodexProvider] Got direct message:', messageText.substring(0, 100));
                } else if (jsonMessage.tool_use) {
                  // Alternative tool call format
                  toolCall = {
                    name: jsonMessage.tool_use.name,
                    arguments: jsonMessage.tool_use.arguments
                  };
                  console.log('[OpenAICodexProvider] Got tool call (alt format):', toolCall.name);
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
                } else if (toolCall) {
                  // Yield tool call chunk
                  console.log('[OpenAICodexProvider] Yielding tool call chunk:', toolCall.name);
                  const chunk: AIStreamChunk = {
                    type: 'tool_call',
                    toolCall: toolCall
                  };
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
      } finally {
        // Clean up process tracking
        this.activeProcess = null;
        this.abortController = null;
      }
    } catch (error) {
      console.error('[OpenAICodexProvider] Error:', error);
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      // Ensure cleanup in case of outer errors
      this.activeProcess = null;
      this.abortController = null;
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
    console.log('[OpenAICodexProvider] Cancel requested');
    this.abort();
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
      // Build system prompt with tool descriptions
      const systemPrompt = this.buildSystemPrompt(documentContext);
      console.log('[OpenAICodexProvider] System prompt generated:', systemPrompt.substring(0, 300));

      // Build the full prompt for Codex
      let fullPrompt = '';

      // Add system prompt first
      fullPrompt += `System: ${systemPrompt}\n\n`;

      // Add previous messages if provided
      if (messages && messages.length > 0) {
        for (const msg of messages) {
          if (msg.role === 'user') {
            fullPrompt += `User: ${msg.content}\n\n`;
          } else if (msg.role === 'assistant') {
            fullPrompt += `Assistant: ${msg.content}\n\n`;
          }
        }
      }

      // Add the current message
      fullPrompt += `User: ${message}\n\nAssistant:`;

      // Get MCP server URL - hardcoded for now, should be passed from main process
      const mcpServerUrl = 'http://127.0.0.1:3456/mcp';

      // Use executeCodex to handle the actual streaming
      console.log('[OpenAICodexProvider] Calling executeCodex with MCP server:', mcpServerUrl);
      const streamResponse = this.executeCodex(fullPrompt, {
        sessionId,
        workingDirectory: documentContext?.workingDirectory,
        mcpServerUrl,
        model: this.config?.model
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
        } else if (chunk.type === 'tool_call') {
          // Forward tool calls from Codex MCP
          console.log(`[OpenAICodexProvider] sendMessage: Tool call chunk #${chunkCount}:`, chunk.toolCall);
          yield {
            type: 'tool_call',
            toolCall: chunk.toolCall
          };
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
    console.log('[OpenAICodexProvider] Aborting current operation');

    // Kill the active process if any
    if (this.activeProcess) {
      console.log('[OpenAICodexProvider] Killing active codex process');
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }

    // Signal abort via controller
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: true,  // Via MCP bridge script
      mcpSupport: true  // Using stdio-to-HTTP bridge for MCP
    };
  }

  destroy(): void {
    console.log('[OpenAICodexProvider] Destroying provider');
    this.abort();
    this.removeAllListeners();
  }
}
