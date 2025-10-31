/**
 * Claude Code provider using claude-agent-sdk with MCP support
 * Uses bundled SDK from package dependencies
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { BaseAIProvider } from '../AIProvider';
import {
  DocumentContext,
  ProviderConfig,
  ProviderCapabilities,
  StreamChunk,
  AIModel,
  Message,
} from '../types';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { buildClaudeCodeSystemPromptAddendum } from '../../prompt';

export class ClaudeCodeProvider extends BaseAIProvider {
  private abortController: AbortController | null = null;
  private claudeSessionIds: Map<string, string> = new Map(); // Our session ID -> Claude session ID
  private currentSessionType?: string; // Track session type for prompt customization
  private slashCommands: string[] = []; // Available slash commands from SDK

  static readonly DEFAULT_MODEL = 'claude-code';

  async initialize(config: ProviderConfig): Promise<void> {
    const safeConfig = { ...config, apiKey: config.apiKey ? '***' : undefined };
    console.log('[CLAUDE-CODE] Initializing provider with config:', JSON.stringify({
      model: config.model,
      configKeys: Object.keys(config),
      config: safeConfig
    }, null, 2));

    this.config = config;

    // Claude Code manages its own authentication - do not require or use API key
    console.log('[CLAUDE-CODE] Claude Code manages authentication internally');
  }

  async *sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[],
    workspacePath?: string,
    attachments?: any[]
  ): AsyncIterableIterator<StreamChunk> {
    const startTime = Date.now();
    console.log(`[CLAUDE-CODE] ========== START sendMessage ==========`);
    console.log(`[CLAUDE-CODE] Message length: ${message.length}`);
    console.log(`[CLAUDE-CODE] Has document context: ${!!documentContext}`);
    console.log(`[CLAUDE-CODE] Session ID: ${sessionId || 'new session'}`);
    console.log(`[CLAUDE-CODE] Workspace path: ${workspacePath}`);
    console.log(`[CLAUDE-CODE] First 200 chars of message:`, message.substring(0, 200));
    console.log(`[CLAUDE-CODE] Has attachments: ${!!attachments && attachments.length > 0}`);

    // Track session type for MCP server configuration
    this.currentSessionType = (documentContext as any)?.sessionType;
    console.log(`[CLAUDE-CODE] Session type: ${this.currentSessionType}`);

    // Handle attachments by copying them to a temp location Claude can access
    let attachmentRefs: string[] = [];
    if (attachments && attachments.length > 0 && workspacePath) {
      console.log(`[CLAUDE-CODE] Processing ${attachments.length} attachments`);

      // Create temp attachments directory in workspace
      const tempAttachmentsDir = path.join(workspacePath, '.nimbalyst', 'ai-chat-attachments', sessionId || 'default');
      await fs.promises.mkdir(tempAttachmentsDir, { recursive: true });

      for (const attachment of attachments) {
        if (attachment.type === 'image' && attachment.filepath) {
          try {
            // Copy image to temp location
            const filename = path.basename(attachment.filepath);
            const tempPath = path.join(tempAttachmentsDir, filename);

            // Read original and write to temp location
            const imageData = await fs.promises.readFile(attachment.filepath);
            await fs.promises.writeFile(tempPath, imageData);

            console.log(`[CLAUDE-CODE] Copied attachment to temp location: ${tempPath}`);
            attachmentRefs.push(tempPath);
          } catch (error) {
            console.error(`[CLAUDE-CODE] Failed to copy attachment:`, error);
          }
        }
      }

      // If we have attachments, prepend them to the message
      if (attachmentRefs.length > 0) {
        const attachmentsList = attachmentRefs.map(p => `- ${p}`).join('\n');
        message = `I have attached the following image files for you to examine:\n${attachmentsList}\n\nPlease use your Read tool to view these images.\n\n${message}`;
        console.log(`[CLAUDE-CODE] Updated message with ${attachmentRefs.length} attachment references`);
      }
    }

    // Create abort controller for this request
    this.abortController = new AbortController();

    try {
      // Build system prompt with document context
      const promptBuildStart = Date.now();
      const systemPrompt = this.buildSystemPrompt(documentContext);
      console.log(`[CLAUDE-CODE] System prompt build took ${Date.now() - promptBuildStart}ms, length: ${systemPrompt.length}`);
      console.log(`[CLAUDE-CODE] System prompt first 300 chars:`, systemPrompt.substring(0, 300));

      // Require workspace path
      if (!workspacePath) {
        throw new Error('[CLAUDE-CODE] workspacePath is required but was not provided');
      }
      console.log(`[CLAUDE-CODE] Working directory (cwd): ${workspacePath}`);

      // Build options for claude-code SDK
      console.log('[CLAUDE-CODE] Building SDK options...');

      const options: any = {
        // The SDK might internally need the CLI path
        pathToClaudeCodeExecutable: await this.findCliPath().catch(() => undefined),
        // BREAKING CHANGE: Claude Agent SDK requires explicit system prompt preset
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPrompt
        },
        // BREAKING CHANGE: Claude Agent SDK requires explicit settings sources
        settingSources: ['user', 'project', 'local'],
        mcpServers: this.getMcpServersConfig(),
        cwd: workspacePath,
        abortController: this.abortController,
        model: 'sonnet',
        permissionMode: 'bypassPermissions'
        // API key is passed via environment variable if configured (see env setup below)
      };

      // Apply tool restrictions based on session type
      // Planning mode: restrict to read-only tools + ExitPlanMode; allow MCP server for edits
      const DEFAULT_PLANNING_TOOLS = [
        'Read', 'Glob', 'Grep', 'LS',
        'WebFetch', 'WebSearch',
        'TodoRead', 'Task',
        'ExitPlanMode'
      ];
      const SDK_NATIVE_TOOLS = [
        'Read', 'Write', 'Edit', 'MultiEdit',
        'Glob', 'Grep', 'LS',
        'Bash',
        'WebFetch', 'WebSearch',
        'Task', 'ExitPlanMode',
        'NotebookRead', 'NotebookEdit',
        'TodoRead', 'TodoWrite'
      ];

      let allowedList: string[] | undefined;
      if (this.currentSessionType === 'planning') {
        // In planning mode, enforce read-only toolset regardless of configured settings
        allowedList = DEFAULT_PLANNING_TOOLS;
      } else if (this.currentSessionType === 'coding') {
        allowedList = ['*'];
      } else if ((this.config as any)?.allowedTools) {
        allowedList = (this.config as any).allowedTools as string[];
      }

      if (allowedList) {
        (options as any).allowedTools = allowedList;
        // Workaround for SDK bug: also pass all disallowed tools explicitly
        if (!(allowedList.length === 1 && allowedList[0] === '*')) {
          const disallowed = SDK_NATIVE_TOOLS.filter(t => !allowedList!.includes(t));
          (options as any).disallowedTools = disallowed;
          // Some builds expect 'blockedTools' instead
          (options as any).blockedTools = disallowed;
        }
      }

      console.log('[CLAUDE-CODE] Options built without API key (Claude Code manages auth internally)');

      // Set up environment variables for the SDK
      // If user has configured a claude-code API key, pass it via environment
      const env: any = { ...process.env };

      if (this.config.apiKey) {
        console.log('[CLAUDE-CODE] Using API key from config');
        env.ANTHROPIC_API_KEY = this.config.apiKey;
      } else {
        console.log('[CLAUDE-CODE] No API key in config - SDK will use claude login credentials or system env var');
      }

      // In production, we need to spawn claude-code differently
      // The SDK expects to spawn with 'node', but we need to use Electron in node mode
      if (app.isPackaged) {
        const os = require('os');
        const homedir = os.homedir();
        const username = os.userInfo().username;
        const platform = process.platform;

        // Enhanced environment variables (cross-platform)
        if (platform === 'win32') {
          // Windows environment setup
          env.USERPROFILE = homedir;
          env.USERNAME = username;
          env.TEMP = env.TEMP || path.join(homedir, 'AppData', 'Local', 'Temp');
          env.TMP = env.TMP || env.TEMP;

          // Windows PATH - preserve existing and add common locations
          const pathSeparator = ';';
          const commonPaths = [
            env.PATH || '',
            path.join(homedir, 'AppData', 'Local', 'Programs'),
            'C:\\Program Files\\nodejs',
            'C:\\Program Files (x86)\\nodejs',
          ].filter(Boolean);
          env.PATH = commonPaths.join(pathSeparator);
        } else {
          // Unix-like (macOS/Linux) environment setup
          env.HOME = homedir;
          env.USER = username;
          env.LOGNAME = username;
          env.SHELL = env.SHELL || process.env.SHELL || '/bin/bash';
          env.TMPDIR = env.TMPDIR || os.tmpdir() || '/tmp';

          // Unix PATH - preserve existing and add common locations
          const pathSeparator = ':';
          const commonPaths = [
            env.PATH || '',
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
            '/usr/sbin',
            '/sbin',
            path.join(homedir, '.local', 'bin'),
            path.join(homedir, 'bin'),
            '/opt/homebrew/bin',
            '/opt/local/bin',
          ].filter(Boolean);
          env.PATH = commonPaths.join(pathSeparator);
        }

        // CRITICAL FIX: Set NODE_PATH to unpacked modules
        const appPath = app.getAppPath();
        const unpackedPath = appPath.includes('app.asar')
          ? appPath.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked')
          : appPath;

        env.NODE_PATH = path.join(unpackedPath, 'node_modules');
        console.log(`[CLAUDE-CODE] Platform: ${platform}`);
        console.log(`[CLAUDE-CODE] Set NODE_PATH for module resolution: ${env.NODE_PATH}`);

        // Verify the unpacked node_modules directory exists
        if (!fs.existsSync(env.NODE_PATH)) {
          const error = `Unpacked node_modules directory not found at: ${env.NODE_PATH}. ` +
                       `This indicates a build configuration issue. The Claude Agent SDK must be unpacked during the build process.`;
          console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
          throw new Error(error);
        }
        console.log(`[CLAUDE-CODE] ✓ Verified unpacked node_modules exists`);

        // Use Electron as Node
        env.ELECTRON_RUN_AS_NODE = '1';
        options.executable = process.execPath;
        options.executableArgs = [];
        console.log(`[CLAUDE-CODE] Using Electron as Node: ${process.execPath}`);

        console.log('[CLAUDE-CODE] Enhanced environment for packaged build:', {
          platform,
          HOME: env.HOME || env.USERPROFILE,
          USER: env.USER || env.USERNAME,
          SHELL: env.SHELL,
          PATH: env.PATH.substring(0, 100) + '...',
          NODE_PATH: env.NODE_PATH,
          executable: options.executable,
          cwd: workspacePath
        });
      }

      options.env = env;

      // If we have a session ID and a claude session ID, resume
      if (sessionId) {
        const claudeSessionId = this.claudeSessionIds.get(sessionId);
        if (claudeSessionId) {
          options.resume = claudeSessionId;
          console.log(`[CLAUDE-CODE] Resuming claude-code session: ${claudeSessionId}`);
        } else {
          console.log(`[CLAUDE-CODE] No existing Claude session for ID: ${sessionId}`);
        }
      }

      // Use claude-code-sdk query function
      console.log(`[CLAUDE-CODE] Full options object:`, JSON.stringify(options, null, 2));
      console.log(`[CLAUDE-CODE] Calling query with options:`, {
        model: options.model,
        hasSystemPrompt: !!options.customSystemPrompt,
        systemPromptLength: options.customSystemPrompt?.length,
        hasMcpServers: !!options.mcpServers,
        cwd: options.cwd,
        resume: options.resume,
        hasAbortController: !!options.abortController
      });

      const queryStartTime = Date.now();

      console.log('[CLAUDE-CODE] Calling query with prompt length:', message.length);
      console.log('[CLAUDE-CODE] Creating query iterator...');

      // Log the raw input to the SDK
      if (sessionId) {
        this.logAgentMessage(sessionId, 'claude-code', 'input', JSON.stringify({
          prompt: message,
          options: {
            model: options.model,
            cwd: options.cwd,
            resume: options.resume,
            systemPrompt: options.systemPrompt,
            settingSources: options.settingSources,
            mcpServers: options.mcpServers ? Object.keys(options.mcpServers) : [],
            allowedTools: options.allowedTools,
            disallowedTools: options.disallowedTools,
            permissionMode: options.permissionMode
          }
        }));
      }

      const queryIterator = query({
        prompt: message,
        options
      }) as AsyncIterable<any>;

      console.log('[CLAUDE-CODE] Query iterator created, type:', typeof queryIterator);
      console.log('[CLAUDE-CODE] Has Symbol.asyncIterator:', !!queryIterator?.[Symbol.asyncIterator]);

      let fullContent = '';
      let chunkCount = 0;
      let firstChunkTime: number | undefined;
      let toolCallCount = 0;
      // Track tool calls by ID so we can update them with results
      const toolCallsById: Map<string, any> = new Map();

      console.log('[CLAUDE-CODE] Starting to iterate over query response...');

      // Stream the response
      try {
        for await (const rawChunk of queryIterator) {
          const chunk = rawChunk as any;
          chunkCount++;

          // Log raw SDK chunks to database
          if (sessionId) {
            const rawChunkJson = typeof chunk === 'string'
              ? JSON.stringify({ type: 'text', content: chunk })
              : JSON.stringify(chunk);
            this.logAgentMessage(sessionId, 'claude-code', 'output', rawChunkJson);
          }

          if (chunkCount <= 5) {
            console.log(`[CLAUDE-CODE] Chunk #${chunkCount}:`,
              typeof chunk === 'string'
                ? { type: 'string', length: chunk.length, preview: chunk.substring(0, 100) }
                : JSON.stringify(chunk, null, 2)
            );
          }

          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            const timeToFirstChunk = firstChunkTime - queryStartTime;
            console.log(`[CLAUDE-CODE] First chunk received after ${timeToFirstChunk}ms (total: ${firstChunkTime - startTime}ms from start)`);
          }
          if (typeof chunk === 'string') {
            // Text chunk - always display it
            if (chunkCount <= 3) {
              console.log(`[CLAUDE-CODE] Text chunk #${chunkCount}, length: ${chunk.length}, first 100 chars:`, chunk.substring(0, 100));
            }
            fullContent += chunk;
            yield {
              type: 'text',
              content: chunk
            };

            // Check if the string looks like an error
            if (chunk.toLowerCase().includes('error') ||
                chunk.toLowerCase().includes('invalid') ||
                chunk.toLowerCase().includes('failed')) {
              console.warn('[CLAUDE-CODE] String chunk might contain an error:', chunk);
            }
          } else if (chunk && typeof chunk === 'object') {
            // Handle different message types from the SDK
            if (chunkCount <= 5) {
              console.log(`[CLAUDE-CODE] Object chunk #${chunkCount}:`, JSON.stringify(chunk, null, 2));
            }

            if (chunk.session_id && sessionId) {
              // Store the claude session ID
              console.log(`[CLAUDE-CODE] Storing session ID mapping: ${sessionId} -> ${chunk.session_id}`);
              this.claudeSessionIds.set(sessionId, chunk.session_id);
            }

            if (chunk.type === 'assistant' && chunk.message) {
            const content = chunk.message.content as any;
            if (Array.isArray(content)) {
              for (const rawBlock of content) {
                const block = rawBlock as any;
                if (block.type === 'text') {
                  fullContent += block.text;
                  yield {
                    type: 'text',
                    content: block.text
                  };
                } else if (block.type === 'tool_use') {
                  // Handle tool calls from Claude
                  toolCallCount++;
                  const toolId = block.id || `tool-${toolCallCount}`;
                  console.log(`[CLAUDE-CODE] Tool use #${toolCallCount} detected: ${block.name} (id: ${toolId})`);
                  console.log(`[CLAUDE-CODE] Tool arguments:`, JSON.stringify(block.input || block.arguments, null, 2).substring(0, 500));

                  const toolName = block.name;
                  const toolArgs = block.input;
                  const isMcpTool = toolName?.startsWith('mcp__');

                  // SDK-native tools that are executed by the Claude Code SDK itself
                  const sdkNativeTools = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash',
                                          'WebFetch', 'WebSearch', 'Task', 'ExitPlanMode',
                                          'NotebookRead', 'NotebookEdit', 'TodoRead', 'TodoWrite'];
                  const isSdkNativeTool = sdkNativeTools.includes(toolName);

                  let executionResult: any | undefined;

                  if (!toolName) {
                    console.warn('[CLAUDE-CODE] Tool use block missing name');
                  } else if (isMcpTool) {
                    console.log(`[CLAUDE-CODE] MCP tool detected: ${toolName} - handled by MCP server`);
                  } else if (isSdkNativeTool) {
                    console.log(`[CLAUDE-CODE] SDK-native tool detected: ${toolName} - executed by Claude Code SDK, result will come in tool_result block`);
                    // SDK executes these tools itself, result will come in a tool_result block
                  } else if (this.toolHandler) {
                    console.log(`[CLAUDE-CODE] Executing tool: ${toolName}`);
                    const toolStartTime = Date.now();
                    try {
                      executionResult = await this.executeToolCall(toolName, toolArgs);
                      console.log(`[CLAUDE-CODE] ${toolName} execution completed in ${Date.now() - toolStartTime}ms`);
                      if (executionResult !== undefined) {
                        try {
                          console.log(`[CLAUDE-CODE] ${toolName} result:`, JSON.stringify(executionResult, null, 2));
                        } catch (stringifyError) {
                          console.log(`[CLAUDE-CODE] ${toolName} result could not be stringified`, stringifyError);
                        }
                      }
                    } catch (error) {
                      const errorMessage = error instanceof Error ? error.message : 'Tool execution failed';
                      const errorResult = (error as any)?.toolResult ?? { success: false, error: errorMessage };
                      executionResult = errorResult;
                      console.error('[CLAUDE-CODE] Tool execution failed:', error);
                      yield {
                        type: 'tool_error',
                        toolError: {
                          name: toolName,
                          arguments: toolArgs,
                          error: errorMessage,
                          result: errorResult
                        }
                      };
                    }
                  } else {
                    console.warn(`[CLAUDE-CODE] No tool handler registered - skipping execution for ${toolName}`);
                  }

                  // Create tool call object
                  const toolCall = {
                    id: toolId,
                    name: toolName || 'unknown',
                    arguments: toolArgs,
                    ...(executionResult !== undefined ? { result: executionResult } : {})
                  };

                  // Store in map for later result updates
                  toolCallsById.set(toolId, toolCall);

                  // Only emit tool call if we executed it ourselves and have a result
                  // SDK-native tools will be emitted when their result arrives
                  if (executionResult !== undefined) {
                    // Log tool call and result to database in format that UI can reconstruct
                    if (sessionId) {
                      // Log the tool_use block
                      this.logAgentMessage(sessionId, 'claude-code', 'output', JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{
                            type: 'tool_use',
                            id: toolId,
                            name: toolName || 'unknown',
                            input: toolArgs
                          }]
                        }
                      }));

                      // Log the tool_result block
                      this.logAgentMessage(sessionId, 'claude-code', 'output', JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{
                            type: 'tool_result',
                            tool_use_id: toolId,
                            content: executionResult,
                            is_error: false
                          }]
                        }
                      }));
                    }

                    yield {
                      type: 'tool_call',
                      toolCall
                    };
                  } else {
                    console.log(`[CLAUDE-CODE] Deferring tool call emission for ${toolName} until result arrives`);
                  }
                } else if (block.type === 'tool_result') {
                  // Handle tool results from Claude Code SDK
                  const toolResultId = block.tool_use_id || block.id;
                  const toolResult = block.content;
                  const isError = block.is_error || false;

                  console.log(`[CLAUDE-CODE] Tool result received for tool ID: ${toolResultId}`);
                  console.log(`[CLAUDE-CODE] Tool result (first 500 chars):`,
                    typeof toolResult === 'string'
                      ? toolResult.substring(0, 500)
                      : JSON.stringify(toolResult, null, 2).substring(0, 500)
                  );

                  // Find the corresponding tool call and update it with result
                  const toolCall = toolCallsById.get(toolResultId);
                  if (toolCall) {
                    // Check if tool already has a result - if so, skip duplicate
                    if (toolCall.result !== undefined) {
                      console.log(`[CLAUDE-CODE] Tool call ${toolResultId} already has result, skipping duplicate`);
                      continue; // Skip this tool_result block
                    }

                    toolCall.result = toolResult;

                    // Check if this is an error - either explicit is_error flag or error in content
                    const hasErrorFlag = isError === true;
                    const hasErrorContent = typeof toolResult === 'string' &&
                      (toolResult.includes('<tool_use_error>') || toolResult.startsWith('Error:'));

                    if (hasErrorFlag || hasErrorContent) {
                      toolCall.isError = true;
                      console.log(`[CLAUDE-CODE] Marked tool call ${toolResultId} as error`);
                    }

                    console.log(`[CLAUDE-CODE] Updated tool call ${toolResultId} with result (isError: ${toolCall.isError || false})`);

                    // Log ONLY the tool_result block to database
                    // The tool_use block was already logged by raw chunk logging at line 264
                    if (sessionId) {
                      this.logAgentMessage(sessionId, 'claude-code', 'output', JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{
                            type: 'tool_result',
                            tool_use_id: toolCall.id,
                            content: toolCall.result,
                            is_error: toolCall.isError || false
                          }]
                        }
                      }));
                    }

                    // Re-emit the tool call with the result
                    yield {
                      type: 'tool_call',
                      toolCall
                    };
                  } else {
                    console.warn(`[CLAUDE-CODE] Received tool result for unknown tool ID: ${toolResultId}`);
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
            const toolChunk = chunk as any;
            console.log(`[CLAUDE-CODE] Standalone tool call #${toolCallCount}: ${toolChunk.name}`);
            console.log(`[CLAUDE-CODE] Standalone tool arguments:`, JSON.stringify(toolChunk.input || toolChunk.arguments, null, 2).substring(0, 500));

            const toolName = toolChunk.name || 'unknown';
            const toolArgs = toolChunk.input;
            const isMcpTool = toolName.startsWith('mcp__');

            // SDK-native tools that are executed by the Claude Code SDK itself
            const sdkNativeTools = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash',
                                    'WebFetch', 'WebSearch', 'Task', 'ExitPlanMode',
                                    'NotebookRead', 'NotebookEdit', 'TodoRead', 'TodoWrite'];
            const isSdkNativeTool = sdkNativeTools.includes(toolName);

            let executionResult: any | undefined;

            if (isMcpTool) {
              console.log(`[CLAUDE-CODE] MCP tool (standalone): ${toolName} - handled by MCP server`);
            } else if (isSdkNativeTool) {
              console.log(`[CLAUDE-CODE] SDK-native tool (standalone): ${toolName} - executed by Claude Code SDK`);
              // SDK executes these tools itself, we just observe them
            } else if (this.toolHandler) {
              console.log(`[CLAUDE-CODE] Executing tool (standalone): ${toolName}`);
              const toolStartTime = Date.now();
              try {
                executionResult = await this.executeToolCall(toolName, toolArgs);
                console.log(`[CLAUDE-CODE] ${toolName} execution completed in ${Date.now() - toolStartTime}ms`);
                if (executionResult !== undefined) {
                  try {
                    console.log(`[CLAUDE-CODE] ${toolName} result:`, JSON.stringify(executionResult, null, 2));
                  } catch (stringifyError) {
                    console.log(`[CLAUDE-CODE] ${toolName} result could not be stringified`, stringifyError);
                  }
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Tool execution failed';
                const errorResult = (error as any)?.toolResult ?? { success: false, error: errorMessage };
                executionResult = errorResult;
                console.error('[CLAUDE-CODE] Tool execution failed:', error);
                yield {
                  type: 'tool_error',
                  toolError: {
                    name: toolName,
                    arguments: toolArgs,
                    error: errorMessage,
                    result: errorResult
                  }
                };
              }
            } else {
              console.warn(`[CLAUDE-CODE] No tool handler registered - skipping execution for ${toolName}`);
            }

            // Create tool call object
            const toolId = toolChunk.id || `tool-${toolCallCount}`;
            const toolCall = {
              id: toolId,
              name: toolName,
              arguments: toolArgs,
              ...(executionResult !== undefined ? { result: executionResult } : {})
            };

            // Store in map for later result updates
            toolCallsById.set(toolId, toolCall);

            // Only emit tool call if we executed it ourselves and have a result
            // SDK-native tools will be emitted when their result arrives
            if (executionResult !== undefined) {
              // Log tool call and result to database in format that UI can reconstruct
              if (sessionId) {
                // Log the tool_use block
                this.logAgentMessage(sessionId, 'claude-code', 'output', JSON.stringify({
                  type: 'assistant',
                  message: {
                    content: [{
                      type: 'tool_use',
                      id: toolId,
                      name: toolName,
                      input: toolArgs
                    }]
                  }
                }));

                // Log the tool_result block
                this.logAgentMessage(sessionId, 'claude-code', 'output', JSON.stringify({
                  type: 'assistant',
                  message: {
                    content: [{
                      type: 'tool_result',
                      tool_use_id: toolId,
                      content: executionResult,
                      is_error: false
                    }]
                  }
                }));
              }

              yield {
                type: 'tool_call',
                toolCall
              };
            } else {
              console.log(`[CLAUDE-CODE] Deferring standalone tool call emission for ${toolName} until result arrives`);
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
            console.log(`[CLAUDE-CODE] Result chunk received, is_error: ${chunk.is_error}`);
            if (chunk.is_error) {
              console.error('[CLAUDE-CODE] Result error:', chunk);

              // Extract the actual error message from the result field
              let errorMessage = chunk.result || chunk.error || chunk.message || chunk.error_message;

              // If we have a result string, use it directly
              if (typeof errorMessage === 'string') {
                // Check if it contains API Error
                if (errorMessage.includes('API Error:')) {
                  // Extract just the relevant part
                  const apiErrorMatch = errorMessage.match(/API Error: \d+ (.*?)(?:\s*·|$)/);
                  if (apiErrorMatch) {
                    try {
                      const errorJson = JSON.parse(apiErrorMatch[1]);
                      if (errorJson.error?.message) {
                        errorMessage = errorJson.error.message;
                      }
                    } catch {
                      // If parsing fails, use the original message
                    }
                  }
                }
              } else {
                // Fallback to JSON stringify
                errorMessage = JSON.stringify(chunk, null, 2);
              }

              // Log error to database (as 'output' since errors are provider responses)
              this.logError(sessionId, 'claude-code', new Error(errorMessage), 'result_chunk', 'api_error');

              // Yield error to UI
              yield {
                type: 'error',
                error: errorMessage
              };

              // Also yield as text to ensure visibility with better formatting
              yield {
                type: 'text',
                content: `❌ ${errorMessage}`,
                isSystem: true
              };
            }
            // Don't yield result content as text - it's already been sent in the assistant message
            // Only errors need to be displayed from result chunks
          } else if (chunk.type === 'system') {
            // Handle system messages from Claude Code (initialization, etc.)
            console.log(`[CLAUDE-CODE] System chunk received:`, chunk);

            // Store session_id if present
            if (chunk.session_id && sessionId) {
              console.log(`[CLAUDE-CODE] Storing session ID from system message: ${sessionId} -> ${chunk.session_id}`);
              this.claudeSessionIds.set(sessionId, chunk.session_id);
            }

            // System messages like 'init' are informational - don't display to user
            if (chunk.subtype === 'init') {
              console.log('[CLAUDE-CODE] Claude Code initialized with:', {
                cwd: chunk.cwd,
                model: chunk.model,
                session_id: chunk.session_id,
                toolCount: chunk.tools?.length || 0,
                mcpServers: chunk.mcp_servers || [],
                apiKeySource: chunk.apiKeySource,
                slashCommands: chunk.slash_commands || [],
                agents: chunk.agents || [],
                skills: chunk.skills || [],
                plugins: chunk.plugins || []
              });

              // Log all chunk properties to discover what's available
              console.log('[CLAUDE-CODE] Full init chunk keys:', Object.keys(chunk));

              // Capture available slash commands
              if (chunk.slash_commands && Array.isArray(chunk.slash_commands)) {
                this.slashCommands = chunk.slash_commands;
                console.log('[CLAUDE-CODE] Available slash commands:', this.slashCommands);
              }

              // Track session initialization with MCP, slash commands, agents, skills, and plugins counts
              // This will be picked up by AIService which has access to analytics
              const mcpServerCount = Array.isArray(chunk.mcp_servers) ? chunk.mcp_servers.length : 0;
              const slashCommandCount = Array.isArray(chunk.slash_commands) ? chunk.slash_commands.length : 0;
              const agentCount = Array.isArray(chunk.agents) ? chunk.agents.length : 0;
              const skillCount = Array.isArray(chunk.skills) ? chunk.skills.length : 0;
              const pluginCount = Array.isArray(chunk.plugins) ? chunk.plugins.length : 0;

              // Store initialization data for AIService to retrieve
              (this as any)._initData = {
                mcpServerCount,
                slashCommandCount,
                agentCount,
                skillCount,
                pluginCount,
                toolCount: chunk.tools?.length || 0
              };

              console.log('[CLAUDE-CODE] Session initialization data:', {
                mcpServerCount,
                slashCommandCount,
                agentCount,
                skillCount,
                pluginCount,
                toolCount: chunk.tools?.length || 0
              });

              // Warn if API key source is "none" - this means Claude Code didn't find credentials
              if (chunk.apiKeySource === 'none') {
                  console.log('[CLAUDE-CODE] no api key: using system configured claude-code credentials');
                // console.error('[CLAUDE-CODE] ⚠️  API Key Source is "none" - Claude Code did not detect any API key!');
                // console.error('[CLAUDE-CODE] This likely means:');
                // console.error('[CLAUDE-CODE]   1. Environment variable ANTHROPIC_API_KEY is not set or not visible to the spawned process');
                // console.error('[CLAUDE-CODE]   2. API key in options is not being recognized by Claude Code SDK');
                // console.error('[CLAUDE-CODE]   3. No stored credentials from `claude login` command');
                // console.error('[CLAUDE-CODE] Subsequent API calls will likely fail with authentication errors');
              }
            } else if (chunk.subtype === 'compact_boundary') {
              // Handle /compact command response
              console.log('[CLAUDE-CODE] Compact boundary received:', {
                pre_tokens: chunk.compact_metadata?.pre_tokens,
                trigger: chunk.compact_metadata?.trigger
              });

              // Display compact completion message to user
              const preTokens = chunk.compact_metadata?.pre_tokens || 'unknown';
              yield {
                type: 'text',
                content: `✓ Conversation compacted (was ${preTokens} tokens)`
              };
            } else {
              // Other system messages might be relevant
              console.log('[CLAUDE-CODE] Other system message:', chunk.subtype, chunk);

              // Check if this system message has displayable content
              if (chunk.message || chunk.text || chunk.content) {
                const messageText = chunk.message || chunk.text || chunk.content;
                yield {
                  type: 'text',
                  content: typeof messageText === 'string' ? messageText : JSON.stringify(messageText)
                };
              }
            }
            // Don't yield most system messages to UI - they're internal
          } else if (chunk.type === 'user') {
            // Handle user messages (including tool results and slash command output)
            console.log(`[CLAUDE-CODE] User chunk received:`, {
              role: chunk.message?.role,
              hasContent: !!chunk.message?.content,
              contentType: Array.isArray(chunk.message?.content) ? 'array' : typeof chunk.message?.content
            });

            const content = chunk.message?.content;

            // Check if content is an array (typical for tool results)
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  // Handle tool results from Claude Code SDK
                  const toolResultId = block.tool_use_id || block.id;
                  const toolResult = block.content;
                  const isError = block.is_error || false;

                  console.log(`[CLAUDE-CODE] Tool result in user message for tool ID: ${toolResultId}`);
                  console.log(`[CLAUDE-CODE] Tool result (first 500 chars):`,
                    typeof toolResult === 'string'
                      ? toolResult.substring(0, 500)
                      : JSON.stringify(toolResult, null, 2).substring(0, 500)
                  );

                  // Find the corresponding tool call and update it with result
                  const toolCall = toolCallsById.get(toolResultId);
                  if (toolCall) {
                    // Check if tool already has a result - if so, skip duplicate
                    if (toolCall.result !== undefined) {
                      console.log(`[CLAUDE-CODE] Tool call ${toolResultId} already has result from user message, skipping duplicate`);
                      continue; // Skip this tool_result
                    }

                    toolCall.result = toolResult;

                    // Check if this is an error - either explicit is_error flag or error in content
                    const hasErrorFlag = isError === true;
                    const hasErrorContent = typeof toolResult === 'string' &&
                      (toolResult.includes('<tool_use_error>') || toolResult.startsWith('Error:'));

                    if (hasErrorFlag || hasErrorContent) {
                      toolCall.isError = true;
                      console.log(`[CLAUDE-CODE] Marked tool call ${toolResultId} as error (from user message)`);
                    }

                    console.log(`[CLAUDE-CODE] Updated tool call ${toolResultId} with result from user message (isError: ${toolCall.isError || false})`);

                    // Log ONLY the tool_result block to database
                    // The tool_use block was already logged when the tool was first called
                    if (sessionId) {
                      this.logAgentMessage(sessionId, 'claude-code', 'output', JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{
                            type: 'tool_result',
                            tool_use_id: toolCall.id,
                            content: toolCall.result,
                            is_error: toolCall.isError || false
                          }]
                        }
                      }));
                    }

                    // Re-emit the tool call with the result
                    yield {
                      type: 'tool_call',
                      toolCall
                    };
                  } else {
                    console.warn(`[CLAUDE-CODE] Received tool result for unknown tool ID: ${toolResultId}`);
                  }
                }
              }
            }

            // Check if this is a slash command result with <local-command-stdout>
            if (typeof content === 'string' && content.includes('<local-command-stdout>')) {
              // Extract and display the command output
              const match = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
              if (match && match[1]) {
                const commandOutput = match[1].trim();
                console.log('[CLAUDE-CODE] Slash command output detected, length:', commandOutput.length);

                // Yield as a system message type
                yield {
                  type: 'text',
                  content: commandOutput,
                  isSystem: true
                };
              }
            }
            // Other user messages are internal - don't display
          } else if (chunk.type === 'summary') {
            // Handle summary messages from Claude Code
            console.log(`[CLAUDE-CODE] Summary chunk received:`, chunk);
            const summary = chunk.summary || '';

            // Check if this is an error summary
            if (summary.toLowerCase().includes('invalid api key') ||
                summary.toLowerCase().includes('error') ||
                summary.toLowerCase().includes('failed') ||
                summary.includes('/login') ||
                summary.toLowerCase().includes('unauthorized')) {
              console.error('[CLAUDE-CODE] ERROR: Summary contains error message:', summary);
              console.error('[CLAUDE-CODE] Full summary chunk:', JSON.stringify(chunk, null, 2));

              // Format a user-friendly error message
              let userMessage = summary;

              // Make API key errors more actionable
              if (summary.toLowerCase().includes('invalid api key')) {
                userMessage = `❌ Claude Code Error: ${summary}\n\n` +
                            `Please check your API key in Settings → AI Models → Claude.\n` +
                            `Make sure you're using a valid Anthropic API key that starts with "sk-ant-"`;
              } else if (summary.includes('/login')) {
                userMessage = `❌ Claude Code Authentication Error\n\n` +
                            `${summary}\n\n` +
                            `Please ensure your Anthropic API key is correctly configured in Settings.`;
              }

              // Log error to database (as 'output' since errors are provider responses)
              this.logError(sessionId, 'claude-code', new Error(userMessage), 'summary_chunk', 'authentication_error');

              // Yield both as error and as text to ensure visibility
              yield {
                type: 'error',
                error: userMessage
              };

              yield {
                type: 'text',
                content: userMessage
              };

              // Send completion event before breaking
              yield {
                type: 'complete',
                isComplete: true
              };

              // Break out of the loop since we have an error
              break;
            } else {
              // Non-error summary - always display it
              console.log('[CLAUDE-CODE] Informational summary:', summary);

              // Always yield summaries to the UI with context
              const displayMessage = summary ?
                `[Claude Code]: ${summary}` :
                `[Claude Code]: ${JSON.stringify(chunk)}`;

              yield {
                type: 'text',
                content: displayMessage
              };
            }
          } else {
            // Unknown chunk type - display it anyway so nothing is lost
            console.log(`[CLAUDE-CODE] Unknown chunk type at #${chunkCount}:`, chunk);
            console.log(`[CLAUDE-CODE] Full unknown chunk:`, JSON.stringify(chunk, null, 2));

            // Try to extract any text content from the unknown chunk
            let extractedContent = '';
            let hadTextContent = false;

            // Try various common fields that might contain text
            if (typeof chunk === 'string') {
              extractedContent = chunk;
              hadTextContent = true;
            } else if (chunk) {
              // Try to extract text from various possible fields
              const rawContent = chunk.text ||
                               chunk.content ||
                               chunk.message ||
                               chunk.data ||
                               chunk.output ||
                               chunk.response ||
                               chunk.value ||
                               '';

              if (rawContent) {
                hadTextContent = true;
                // Wrap extracted text with context
                // Serialize objects to JSON, keep strings as-is
                const contentToDisplay = typeof rawContent === 'string'
                  ? rawContent
                  : JSON.stringify(rawContent, null, 2);
                extractedContent = `\n\n⚠️ **Unhandled message from Claude Code** (type: \`${chunk.type || 'unknown'}\`):\n\n${contentToDisplay}\n\n`;
              }

              // If still no content, check for nested message content
              if (!extractedContent && chunk.message?.content) {
                const nestedContent = typeof chunk.message.content === 'string'
                  ? chunk.message.content
                  : JSON.stringify(chunk.message.content);
                if (nestedContent) {
                  hadTextContent = true;
                  extractedContent = `\n\n⚠️ **Unhandled message from Claude Code** (type: \`${chunk.type || 'unknown'}\`):\n\n${nestedContent}\n\n`;
                }
              }

              // If we still have no content but have an object, stringify it
              if (!extractedContent && Object.keys(chunk).length > 0) {
                // Format it nicely for display with clear separation
                extractedContent = `\n\n---\n\n⚠️ **Unhandled message from Claude Code:**\n\n` +
                                 `Type: \`${chunk.type || 'unknown'}\`\n\n` +
                                 `\`\`\`json\n${JSON.stringify(chunk, null, 2)}\n\`\`\`\n\n` +
                                 `---\n\n`;
              }
            }

            // If we extracted any content, yield it to the UI
            if (extractedContent) {
              console.log(`[CLAUDE-CODE] Yielding unknown chunk content to UI:`, extractedContent.substring(0, 200));
              yield {
                type: 'text',
                content: extractedContent
              };
            }

            // Also check if this looks like an error
            const chunkStr = JSON.stringify(chunk).toLowerCase();
            if (chunkStr.includes('error') || chunkStr.includes('fail') || chunkStr.includes('invalid')) {
              console.warn('[CLAUDE-CODE] Unknown chunk might contain an error');
            }
          }
          }
        }
      } catch (iterError) {
        console.error('[CLAUDE-CODE] Error during iteration:', iterError);
        console.error('[CLAUDE-CODE] Error stack:', (iterError as Error).stack);
        throw iterError;
      }

      // Send completion event
      const totalTime = Date.now() - startTime;
      console.log(`[CLAUDE-CODE] ========== END sendMessage ==========`);
      console.log(`[CLAUDE-CODE] Stream complete - Total time: ${totalTime}ms`);
      console.log(`[CLAUDE-CODE] Stats - Chunks: ${chunkCount}, Tool calls: ${toolCallCount}, Content length: ${fullContent.length}`);
      console.log(`[CLAUDE-CODE] First 500 chars of response:`, fullContent.substring(0, 500));

      yield {
        type: 'complete',
        // Don't send content here - it's already been sent in chunks
        // The AIService accumulates the chunks itself
        isComplete: true
      };

      console.log('[CLAUDE-CODE] Complete event yielded');

    } catch (error: any) {
      const errorTime = Date.now() - startTime;
      console.error(`[CLAUDE-CODE] ========== ERROR in sendMessage ==========`);
      console.error(`[CLAUDE-CODE] Error occurred after ${errorTime}ms`);
      console.error(`[CLAUDE-CODE] Error name: ${error.name}`);
      console.error(`[CLAUDE-CODE] Error message: ${error.message}`);
      console.error(`[CLAUDE-CODE] Error stack:`, error.stack);

      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        console.log(`[CLAUDE-CODE] Request was aborted after ${errorTime}ms`);
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error(`[CLAUDE-CODE] Yielding error to client`);

        // Log error to database (as 'output' since errors are provider responses)
        this.logError(sessionId, 'claude-code', error, 'catch_block', 'exception');

        yield {
          type: 'error',
          error: error.message
        };
      }
    } finally {
      console.log('[CLAUDE-CODE] Cleaning up abort controller');
      this.abortController = null;
    }
  }

  abort(): void {
    console.log('[CLAUDE-CODE] Abort called');
    if (this.abortController) {
      console.log('[CLAUDE-CODE] Aborting active request');
      this.abortController.abort();
      this.abortController = null;
    } else {
      console.log('[CLAUDE-CODE] No active request to abort');
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
    console.log(`[CLAUDE-CODE] Setting provider session data for ${sessionId}:`, data);
    if (data.claudeSessionId) {
      this.claudeSessionIds.set(sessionId, data.claudeSessionId);
      console.log(`[CLAUDE-CODE] Stored Claude session ID: ${data.claudeSessionId}`);
    }
  }

  getProviderSessionData(sessionId: string): any {
    const claudeSessionId = this.claudeSessionIds.get(sessionId);
    console.log(`[CLAUDE-CODE] Getting provider session data for ${sessionId}: ${claudeSessionId || 'none'}`);
    return {
      claudeSessionId
    };
  }

  private getMcpServersConfig() {
    // letting the agent work for coding
    // Don't include MCP servers for agentic coding sessions
    if (this.currentSessionType === 'coding') {
      console.log('[CLAUDE-CODE] Agentic coding session - excluding MCP server configuration');
      return {};
    }

    // Connect to MCP server running in Electron
    console.log('[CLAUDE-CODE] Including nimbalyst MCP server configuration');
    return {
      "nimbalyst": {
        "type": "sse",
        "transport": "sse",
        "url": "http://127.0.0.1:3456/mcp"
      }
    };
  }

  private async findCliPath(): Promise<string> {
    try {
      const claudeAgentPath = require.resolve('@anthropic-ai/claude-agent-sdk');
      const claudeAgentDir = path.dirname(claudeAgentPath);
      let cliPath = path.join(claudeAgentDir, 'cli.js');

      // CRITICAL FIX: Use unpacked CLI path in production
      // System Node.js cannot read from .asar archives
      if (app.isPackaged && cliPath.includes('app.asar')) {
        // Use regex to replace app.asar more safely (handles path separators)
        const unpackedCliPath = cliPath.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked');

        if (!fs.existsSync(unpackedCliPath)) {
          const error = `Unpacked CLI not found at: ${unpackedCliPath}. ` +
                       `This indicates a build configuration issue. The Claude Agent SDK must be unpacked during the build process.`;
          console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
          throw new Error(error);
        }

        console.log(`[CLAUDE-CODE] ✓ Using unpacked CLI at: ${unpackedCliPath}`);

        // Verify the unpacked node_modules directory exists
        const appPath = app.getAppPath();
        const unpackedAppPath = appPath.includes('app.asar')
          ? appPath.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked')
          : appPath;
        const unpackedNodeModules = path.join(unpackedAppPath, 'node_modules');

        if (!fs.existsSync(unpackedNodeModules)) {
          const error = `Unpacked node_modules not found at: ${unpackedNodeModules}. ` +
                       `Build configuration must unpack node_modules for Claude Agent SDK.`;
          console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
          throw new Error(error);
        }
        console.log(`[CLAUDE-CODE] ✓ Unpacked node_modules directory exists`);

        // Verify the SDK directory specifically
        const unpackedSdkDir = path.join(unpackedNodeModules, '@anthropic-ai', 'claude-agent-sdk');
        if (!fs.existsSync(unpackedSdkDir)) {
          const error = `SDK directory not found at: ${unpackedSdkDir}. ` +
                       `Build must unpack @anthropic-ai/claude-agent-sdk package.`;
          console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
          throw new Error(error);
        }
        console.log(`[CLAUDE-CODE] ✓ Unpacked SDK directory verified`);

        cliPath = unpackedCliPath;
      }

      if (!fs.existsSync(cliPath)) {
        throw new Error(`CLI not found at expected path: ${cliPath}`);
      }

      console.log(`[CLAUDE-CODE] Found CLI at: ${cliPath}`);
      return cliPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not find claude-agent-sdk CLI: ${message}`);
    }
  }

  protected buildSystemPrompt(documentContext?: DocumentContext): string {
    // Check if this is an agentic coding session
    const sessionType = (documentContext as any)?.sessionType;
    if (sessionType === 'coding') {
      // Minimal prompt for agentic coding mode - let Claude Code work naturally
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      return `Current date and time: ${dateStr} at ${timeStr}

You are an AI assistant integrated into the Nimbalyst editor's agentic coding workspace.
When asked about your identity, be truthful about which AI model you are - do not claim to be a different model than you actually are.`;
    }

    // For non-coding sessions, use the addendum-based approach
    const addendum = buildClaudeCodeSystemPromptAddendum(documentContext);
    return addendum;
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
      console.log('[CLAUDE-CODE] Added Electron dir to PATH:', electronDir);
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
    // Note: This is now handled directly in the options setup
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

  /**
   * Get available slash commands discovered from the SDK
   */
  getSlashCommands(): string[] {
    return [...this.slashCommands];
  }

  /**
   * Get the known built-in Claude Code slash commands
   * These are always available, even before a session is initialized
   */
  static getKnownSlashCommands(): string[] {
    return [
      'compact',
      'clear',
      'context',
      'cost',
      'init',
      'output-style:new',
      'pr-comments',
      'release-notes',
      'todos',
      'review',
      'security-review'
    ];
  }

  /**
   * Get initialization data for analytics tracking
   * Returns counts for MCP servers, slash commands, agents, skills, plugins, and tools
   */
  getInitData(): {
    mcpServerCount: number;
    slashCommandCount: number;
    agentCount: number;
    skillCount: number;
    pluginCount: number;
    toolCount: number;
  } | null {
    return (this as any)._initData || null;
  }
}
