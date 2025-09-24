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
import { toolRegistry, toAnthropicTools } from '../../tools';

interface ClaudeCodeSession {
  id: string;
  process: ChildProcess;
  workingDirectory: string;
  buffer: string;
  isReady: boolean;
  messageCallbacks: Map<string, (response: any) => void>;
}

export class ClaudeCodeCLIProvider extends EventEmitter implements AIProvider {
  private sessions = new Map<string, ClaudeCodeSession>();
  private apiKey: string;
  private config?: ProviderConfig;
  private toolHandler?: ToolHandler;
  static readonly DEFAULT_MODEL = 'claude-code-cli';

  constructor(config?: { apiKey?: string }) {
    super();
    this.apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY || '';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    if (config.apiKey) {
      this.apiKey = config.apiKey;
    }
    console.log('[ClaudeCodeCLI] Initialized with config:', {
      hasApiKey: !!this.apiKey,
      model: config.model
    });
  }

  registerToolHandler(handler: ToolHandler): void {
    this.toolHandler = handler;
    console.log('[ClaudeCodeCLI] Tool handler registered');
  }

  static getModels() {
    // Claude Code manages its own model internally
    return [{
      id: 'claude-code:claude-code-cli',
      name: 'Claude Code CLI',
      provider: 'claude-code',
      contextWindow: 200000,
      maxTokens: 8192
    }];
  }

  static getDefaultModel() {
    return this.DEFAULT_MODEL;
  }

  getName(): string {
    return 'claude-code';
  }

  getDisplayName(): string {
    return 'Claude Code (MCP)';
  }

  getDescription(): string {
    return 'Claude with Model Context Protocol support via CLI';
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
    const sessionId = options?.sessionId || this.generateSessionId();
    const session = await this.getOrCreateSession(sessionId, options?.workingDirectory);

    // Get available tools if we have a document context
    const tools = options?.tools || this.getRegisteredTools();

    // Format messages for Claude Code CLI with tool definitions
    const prompt = this.formatMessagesWithTools(messages, tools);

    try {
      // Send the prompt to the CLI
      yield* this.sendPromptToSession(session, prompt, options);
    } catch (error) {
      console.error('[ClaudeCodeCLI] Error:', error);
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private getRegisteredTools(): any[] {
    const tools = toolRegistry.getAll();
    return toAnthropicTools(tools);
  }

  private formatMessagesWithTools(messages: AIMessage[], tools: any[]): string {
    let prompt = this.formatMessagesForCLI(messages);

    // If we have tools, append them to the system prompt
    if (tools && tools.length > 0) {
      const toolsDescription = `

You have access to the following tools:

${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

When you need to use a tool, use the following format:
<tool_use>
<tool_name>${tools[0]?.name || 'tool_name'}</tool_name>
<parameters>
{
  "param1": "value1",
  "param2": "value2"
}
</parameters>
</tool_use>`;

      prompt = toolsDescription + '\n\n' + prompt;
    }

    return prompt;
  }

  private async getOrCreateSession(sessionId: string, workingDirectory?: string): Promise<ClaudeCodeSession> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = await this.createSession(sessionId, workingDirectory);
      this.sessions.set(sessionId, session);
    }

    return session;
  }

  private async createSession(sessionId: string, workingDirectory?: string): Promise<ClaudeCodeSession> {
    const cwd = workingDirectory || process.cwd();

    // Start the Claude Code CLI
    const claudePath = this.findClaudePath();
    if (!claudePath) {
      throw new Error('Claude CLI not found. Please install Claude Desktop from https://claude.ai/download');
    }

    console.log(`[ClaudeCodeCLI] Starting Claude CLI at ${claudePath}`);
    console.log(`[ClaudeCodeCLI] Working directory: ${cwd}`);

    // Spawn claude CLI directly without shell, similar to Crystal's approach
    const claudeProcess = spawn(claudePath, [], {
      cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: this.apiKey,
        PATH: this.getEnhancedPath()
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const session: ClaudeCodeSession = {
      id: sessionId,
      process: claudeProcess,
      workingDirectory: cwd,
      buffer: '',
      isReady: false,
      messageCallbacks: new Map()
    };

    // Handle stdout
    claudeProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      session.buffer += output;
      this.processOutput(session, output);
    });

    // Handle stderr
    claudeProcess.stderr?.on('data', (data) => {
      console.error('[ClaudeCodeCLI] Error:', data.toString());
    });

    // Handle process exit
    claudeProcess.on('exit', (code) => {
      console.log(`[ClaudeCodeCLI] Session ${sessionId} exited with code ${code}`);
      this.sessions.delete(sessionId);
    });

    // Wait for the CLI to be ready
    await this.waitForReady(session);

    return session;
  }

  private findClaudePath(): string | null {
    // Check common installation paths for Claude CLI
    const fs = require('fs');
    const possiblePaths = [
      // Most common location from Claude Desktop
      path.join(os.homedir(), '.claude', 'local', 'node_modules', '.bin', 'claude'),
      // Homebrew installation
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      // npm global installation
      path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
      // yarn global installation
      path.join(os.homedir(), '.yarn', 'bin', 'claude')
    ];

    for (const claudePath of possiblePaths) {
      try {
        fs.accessSync(claudePath, fs.constants.X_OK);
        console.log(`[ClaudeCodeCLI] Found claude CLI at: ${claudePath}`);
        return claudePath;
      } catch (e) {
        // Continue checking other paths
      }
    }

    // Try to find in PATH
    const { execSync } = require('child_process');
    try {
      const result = execSync('which claude', { encoding: 'utf8' }).trim();
      if (result) {
        console.log(`[ClaudeCodeCLI] Found claude CLI in PATH: ${result}`);
        return result;
      }
    } catch (e) {
      // Not found in PATH
    }

    return null;
  }

  private async waitForReady(session: ClaudeCodeSession, timeout = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkReady = () => {
        // Check if buffer has any content or process is responsive
        if (session.isReady || session.buffer.length > 0) {
          session.isReady = true;
          resolve();
        } else if (Date.now() - startTime > timeout) {
          // Even if no prompt detected, consider it ready after timeout
          // Claude CLI might not show a prompt until input is received
          console.log('[ClaudeCodeCLI] No prompt detected, but proceeding after timeout');
          session.isReady = true;
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  private formatMessagesForCLI(messages: AIMessage[]): string {
    // Format messages into a single prompt for the CLI
    const formattedMessages = messages.map(msg => {
      if (msg.role === 'system') {
        return `System: ${msg.content}`;
      } else if (msg.role === 'user') {
        return `User: ${msg.content}`;
      } else if (msg.role === 'assistant') {
        return `Assistant: ${msg.content}`;
      }
      return '';
    }).filter(Boolean);

    return formattedMessages.join('\n\n');
  }

  private async *sendPromptToSession(
    session: ClaudeCodeSession,
    prompt: string,
    options?: any
  ): AIStreamResponse {
    // Clear buffer before sending new prompt
    session.buffer = '';

    // Send the prompt to the CLI process
    session.process.stdin?.write(prompt + '\n\n');

    // Stream the response
    let responseBuffer = '';
    let isComplete = false;
    let silenceCounter = 0;
    const maxSilence = 30; // 3 seconds of no output

    while (!isComplete) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const currentBuffer = session.buffer;
      if (currentBuffer.length > responseBuffer.length) {
        const newOutput = currentBuffer.substring(responseBuffer.length);
        responseBuffer = currentBuffer;
        silenceCounter = 0; // Reset silence counter when we get output

        // Clean up the output - remove prompts and special markers
        const cleanOutput = newOutput
          .replace(/claude>/g, '')
          .replace(/^\s*>\s*/gm, '')
          .trim();

        if (cleanOutput) {
          // Check for tool calls using XML format
          if (cleanOutput.includes('<tool_use>')) {
            const toolCall = this.parseXMLToolCall(cleanOutput);
            if (toolCall) {
              yield {
                type: 'tool_call',
                toolCall
              };

              // Execute the tool call and send result back to CLI
              if (this.toolHandler) {
                try {
                  const result = await this.executeToolCall(toolCall);
                  // Send tool result back to the session
                  const resultMessage = `Tool result: ${JSON.stringify(result)}`;
                  session.process.stdin?.write(resultMessage + '\n');
                } catch (error) {
                  console.error('[ClaudeCodeCLI] Tool execution error:', error);
                }
              }
            }
          } else {
            // Regular content
            yield {
              type: 'content',
              content: cleanOutput
            };
          }
        }
      } else {
        silenceCounter++;

        // Consider response complete if we've had enough silence
        if (silenceCounter >= maxSilence) {
          isComplete = true;
        }
      }

      // Check for explicit completion signals
      if (currentBuffer.includes('claude>') && silenceCounter > 5) {
        // If we see a prompt and have had some silence, we're done
        isComplete = true;
      }
    }

    // Send completion event
    yield {
      type: 'end',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    };
  }

  private extractNewOutput(session: ClaudeCodeSession, fromIndex: number): string {
    const currentBuffer = session.buffer;
    if (currentBuffer.length > fromIndex) {
      return currentBuffer.substring(fromIndex);
    }
    return '';
  }

  private processOutput(session: ClaudeCodeSession, output: string) {
    // Process any special output from the CLI
    // Claude CLI might show a prompt like "claude>" or just be ready for input
    if (output.includes('Ready') || output.includes('claude>') || output.includes('>')) {
      session.isReady = true;
    }

    // Handle any callbacks waiting for responses
    session.messageCallbacks.forEach((callback, id) => {
      if (output.includes(id)) {
        callback(output);
        session.messageCallbacks.delete(id);
      }
    });
  }

  private parseXMLToolCall(output: string): AIToolCall | null {
    try {
      // Parse tool call from XML format
      const toolUseMatch = output.match(/<tool_use>(.*?)<\/tool_use>/s);
      if (!toolUseMatch) return null;

      const toolContent = toolUseMatch[1];
      const nameMatch = toolContent.match(/<tool_name>(.*?)<\/tool_name>/);
      const paramsMatch = toolContent.match(/<parameters>(.*?)<\/parameters>/s);

      if (nameMatch) {
        const toolName = nameMatch[1].trim();
        let toolArgs = {};

        if (paramsMatch) {
          try {
            toolArgs = JSON.parse(paramsMatch[1].trim());
          } catch (e) {
            console.warn('[ClaudeCodeCLI] Failed to parse tool parameters:', e);
          }
        }

        return {
          id: this.generateId(),
          name: toolName,
          arguments: toolArgs
        };
      }
    } catch (error) {
      console.error('[ClaudeCodeCLI] Failed to parse XML tool call:', error);
    }
    return null;
  }

  private parseToolCall(output: string): AIToolCall | null {
    try {
      // Parse tool call from CLI output format
      const match = output.match(/\[TOOL_CALL\](.*?)\[\/TOOL_CALL\]/s);
      if (match) {
        const toolCallData = JSON.parse(match[1]);
        return {
          id: toolCallData.id || this.generateId(),
          name: toolCallData.name,
          arguments: toolCallData.arguments
        };
      }
    } catch (error) {
      console.error('[ClaudeCodeCLI] Failed to parse tool call:', error);
    }
    return null;
  }

  async executeToolCall(toolCall: AIToolCall): Promise<AIToolResult> {
    if (!this.toolHandler) {
      return {
        toolCallId: toolCall.id,
        result: {
          success: false,
          output: 'No tool handler registered'
        }
      };
    }

    try {
      // Execute the tool using the registered handler
      let result: any;

      // Check if the tool handler has the specific tool method
      if (typeof (this.toolHandler as any)[toolCall.name] === 'function') {
        result = await (this.toolHandler as any)[toolCall.name](toolCall.arguments);
      } else if (this.toolHandler.executeTool) {
        // Use the generic executeTool method
        result = await this.toolHandler.executeTool(toolCall.name, toolCall.arguments);
      } else {
        // Fallback to applyDiff if it's a diff-related tool
        if (toolCall.name === 'applyDiff' && this.toolHandler.applyDiff) {
          result = await this.toolHandler.applyDiff(toolCall.arguments);
        } else {
          throw new Error(`Tool '${toolCall.name}' not found in tool handler`);
        }
      }

      return {
        toolCallId: toolCall.id,
        result: {
          success: true,
          output: result
        }
      };
    } catch (error) {
      console.error('[ClaudeCodeCLI] Tool execution error:', error);
      return {
        toolCallId: toolCall.id,
        result: {
          success: false,
          output: error instanceof Error ? error.message : 'Tool execution failed'
        }
      };
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    // Claude Code manages its own model selection
    return [
      { id: 'claude-code', name: 'Claude Code (Auto)' }
    ];
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if Claude CLI is available
      const claudePath = this.findClaudePath();
      if (!claudePath) {
        return {
          success: false,
          error: 'Claude CLI not found. Please install Claude Desktop from https://claude.ai/download'
        };
      }

      // Try to spawn the CLI and check if it's available
      const testProcess = spawn(claudePath, ['--version'], {
        env: {
          ...process.env,
          PATH: this.getEnhancedPath()
        }
      });

      return new Promise((resolve) => {
        let output = '';

        testProcess.stdout?.on('data', (data) => {
          output += data.toString();
        });

        testProcess.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true });
          } else {
            resolve({
              success: false,
              error: 'Claude Code CLI not found. Please install it first.'
            });
          }
        });

        testProcess.on('error', () => {
          resolve({
            success: false,
            error: 'Claude Code CLI not found. Please install it first.'
          });
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          testProcess.kill();
          resolve({
            success: false,
            error: 'Claude Code CLI check timed out'
          });
        }, 5000);
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed'
      };
    }
  }

  private getEnhancedPath(): string {
    const paths = [process.env.PATH];

    if (process.platform === 'darwin' || process.platform === 'linux') {
      paths.push('/usr/local/bin');
      paths.push(path.join(os.homedir(), '.npm-global', 'bin'));
      paths.push(path.join(os.homedir(), '.local', 'bin'));
    } else if (process.platform === 'win32') {
      paths.push(path.join(process.env.APPDATA || '', 'npm'));
    }

    return paths.filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateId(): string {
    return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async *sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[]
  ): AsyncIterableIterator<StreamChunk> {
    const actualSessionId = sessionId || this.generateSessionId();

    try {
      // Get or create session
      const session = await this.getOrCreateSession(actualSessionId, documentContext?.workingDirectory);

      // Build the complete prompt including context and previous messages
      let fullPrompt = '';

      // Add document context if provided
      if (documentContext) {
        fullPrompt += `Current document context:\nFile: ${documentContext.fileName || 'untitled'}\nLanguage: ${documentContext.language || 'unknown'}\nContent:\n\`\`\`${documentContext.language || ''}\n${documentContext.content}\n\`\`\`\n\n`;
      }

      // Add conversation history
      if (messages && messages.length > 0) {
        const recentMessages = messages.slice(-5); // Only include last 5 messages to avoid overwhelming the CLI
        for (const msg of recentMessages) {
          if (msg.role === 'user') {
            fullPrompt += `User: ${msg.content}\n\n`;
          } else if (msg.role === 'assistant') {
            fullPrompt += `Assistant: ${msg.content}\n\n`;
          }
        }
      }

      // Add current message
      fullPrompt += `User: ${message}\n\nPlease respond:`;

      console.log(`[ClaudeCodeCLI] Sending prompt to session ${actualSessionId}:`, fullPrompt.substring(0, 200) + '...');

      // Clear buffer before sending
      session.buffer = '';

      // Send the prompt
      if (session.process.stdin && !session.process.stdin.destroyed) {
        session.process.stdin.write(fullPrompt + '\n');
      } else {
        throw new Error('Session process stdin is not available');
      }

      // Stream the response
      let responseStarted = false;
      let totalOutput = '';
      let silenceCounter = 0;
      const maxSilence = 50; // 5 seconds of no new output

      while (silenceCounter < maxSilence) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const currentBuffer = session.buffer;
        if (currentBuffer.length > totalOutput.length) {
          const newOutput = currentBuffer.substring(totalOutput.length);
          totalOutput = currentBuffer;
          silenceCounter = 0; // Reset silence counter

          if (!responseStarted) {
            console.log(`[ClaudeCodeCLI] Response started, first output:`, newOutput.substring(0, 100));
            responseStarted = true;
          }

          // Clean and process the new output
          const cleanOutput = this.cleanOutput(newOutput);
          if (cleanOutput.trim()) {
            // Check for tool calls
            if (cleanOutput.includes('<tool_use>')) {
              const toolCall = this.parseXMLToolCall(cleanOutput);
              if (toolCall) {
                console.log(`[ClaudeCodeCLI] Parsed tool call:`, toolCall.name);
                yield {
                  type: 'tool_call',
                  toolCall: {
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                    result: await this.executeToolCall(toolCall)
                  }
                };
                continue; // Don't yield this as text content
              }
            }

            // Yield text content
            yield {
              type: 'text',
              content: cleanOutput
            };
          }
        } else {
          silenceCounter++;
        }

        // Check for completion indicators
        if (responseStarted && (
          currentBuffer.includes('\n> ') ||
          currentBuffer.includes('claude>') ||
          currentBuffer.endsWith('\n') && silenceCounter > 10
        )) {
          console.log(`[ClaudeCodeCLI] Response appears complete, ending stream`);
          break;
        }
      }

      if (!responseStarted) {
        console.log(`[ClaudeCodeCLI] No response detected from CLI after timeout`);
        yield {
          type: 'error',
          error: 'No response from Claude CLI'
        };
      }

      // Send completion
      yield {
        type: 'complete',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        }
      };

    } catch (error) {
      console.error('[ClaudeCodeCLI] Error in sendMessage:', error);
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private cleanOutput(output: string): string {
    return output
      .replace(/^claude>\s*/gm, '') // Remove claude> prompts
      .replace(/^\s*>\s*/gm, '')    // Remove > prompts
      .replace(/^\s*\n/gm, '')      // Remove empty lines at start
      .trim();
  }

  abort(): void {
    // Abort all active sessions
    for (const session of this.sessions.values()) {
      if (session.process && !session.process.killed) {
        session.process.kill('SIGTERM');
      }
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: true,
      mcpSupport: true
    };
  }

  destroy(): void {
    this.cleanup();
  }

  cleanup() {
    // Clean up all sessions
    this.sessions.forEach(session => {
      if (session.process && !session.process.killed) {
        session.process.kill();
      }
    });
    this.sessions.clear();
  }
}