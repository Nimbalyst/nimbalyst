/**
 * Claude Code provider using claude-agent-sdk with MCP support
 * Uses bundled SDK from package dependencies
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { MessageParam, ImageBlockParam, TextBlockParam, ContentBlockParam } from '@anthropic-ai/sdk/resources';
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
import { setupClaudeCodeEnvironment, getClaudeCodeExecutableOptions } from '../../../electron/claudeCodeEnvironment';
import { SessionManager } from '../SessionManager';

/**
 * Track changes in the agent-sdk and claude-code itself here:
 * https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md
 * https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
 */
export class ClaudeCodeProvider extends BaseAIProvider {
  // Single abort controller - each provider instance is per-session via ProviderFactory
  private abortController: AbortController | null = null;
  private claudeSessionIds: Map<string, string> = new Map(); // Our session ID -> Claude session ID
  private currentMode?: 'planning' | 'agent'; // Track session mode for prompt customization and tool filtering
  private slashCommands: string[] = []; // Available slash commands from SDK
  private editedFilesThisTurn: Set<string> = new Set(); // Track files edited in current turn
  private markMessagesAsHidden: boolean = false; // Flag to mark next messages as hidden

  // ExitPlanMode confirmation flow - stores pending confirmation resolvers
  private pendingExitPlanModeConfirmations: Map<string, {
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Session naming MCP server port (injected from electron main process)
  private static sessionNamingServerPort: number | null = null;

  static readonly DEFAULT_MODEL = 'claude-code';

  /**
   * Set the session naming MCP server port (called from electron main process)
   * This allows the runtime package to use the MCP server without directly depending on electron code
   */
  public static setSessionNamingServerPort(port: number | null): void {
    ClaudeCodeProvider.sessionNamingServerPort = port;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    const safeConfig = { ...config, apiKey: config.apiKey ? '***' : undefined };
    // console.log('[CLAUDE-CODE] Initializing provider with config:', JSON.stringify({
    //   model: config.model,
    //   configKeys: Object.keys(config),
    //   config: safeConfig
    // }, null, 2));

    this.config = config;

    // Claude Code manages its own authentication - do not require or use API key
    // console.log('[CLAUDE-CODE] Claude Code manages authentication internally');
  }

  /**
   * Mark the next sendMessage call's logged messages as hidden
   * Used for auto-triggered commands like /context that shouldn't appear in UI
   * Flag is automatically reset after sendMessage completes
   */
  public setHiddenMode(hidden: boolean): void {
    this.markMessagesAsHidden = hidden;
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
    // console.log(`[CLAUDE-CODE] ========== START sendMessage ==========`);
    // console.log(`[CLAUDE-CODE] Message length: ${message.length}`);
    // console.log(`[CLAUDE-CODE] Has document context: ${!!documentContext}`);
    // console.log(`[CLAUDE-CODE] Session ID: ${sessionId || 'new session'}`);
    // console.log(`[CLAUDE-CODE] Workspace path: ${workspacePath}`);
    // console.log(`[CLAUDE-CODE] First 200 chars of message:`, message.substring(0, 200));
    // console.log(`[CLAUDE-CODE] Has attachments: ${!!attachments && attachments.length > 0}`);

    // Track session mode for MCP server configuration and tool filtering
    this.currentMode = (documentContext as any)?.mode || 'agent';
    // console.log(`[CLAUDE-CODE] Session mode: ${this.currentMode}`);

    // Build image content blocks for attachments (sent directly to Claude, not via file paths)
    const imageContentBlocks: ImageBlockParam[] = [];
    // TODO: Debug logging - uncomment if needed for attachment troubleshooting
    // console.log(`[CLAUDE-CODE] Attachments received:`, attachments?.length || 0, attachments);
    if (attachments && attachments.length > 0) {
      // console.log(`[CLAUDE-CODE] Processing ${attachments.length} attachments as direct content blocks`);

      for (const attachment of attachments) {
        if (attachment.type === 'image' && attachment.filepath) {
          try {
            // Read image file and convert to base64
            const imageData = await fs.promises.readFile(attachment.filepath);
            const base64Data = imageData.toString('base64');

            // Determine media type from mimeType or extension
            let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
            if (attachment.mimeType) {
              const mimeType = attachment.mimeType.toLowerCase();
              if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
                mediaType = 'image/jpeg';
              } else if (mimeType === 'image/gif') {
                mediaType = 'image/gif';
              } else if (mimeType === 'image/webp') {
                mediaType = 'image/webp';
              } else if (mimeType === 'image/png') {
                mediaType = 'image/png';
              }
            }

            imageContentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            });
            // console.log(`[CLAUDE-CODE] Created image content block for ${attachment.filename || path.basename(attachment.filepath)}, size: ${base64Data.length} bytes`);
          } catch (error) {
            console.error(`[CLAUDE-CODE] Failed to read attachment for content block:`, error);
          }
        }
      }
    }

    // Abort any existing request before starting a new one
    if (this.abortController) {
      // console.log(`[CLAUDE-CODE] Aborting existing request for session ${sessionId}`);
      this.abortController.abort();
    }

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Clear edited files tracker for this turn
    this.editedFilesThisTurn.clear();

    try {
      // Append document context to message when there's a specific document
      // AgenticPanel strips out filePath when in agent mode, so this only applies to AIChat panel
      // Skip adding system message if the prompt starts with a slash command
      const isSlashCommand = message.trimStart().startsWith('/');
      const currentDocPath = documentContext?.filePath;
      if (currentDocPath && !isSlashCommand) {
        const fileName = path.basename(currentDocPath) || currentDocPath;
        message = `${message}\n\n<NIMBALYST_SYSTEM_MESSAGE>\nThe user is currently viewing this document:\n<current_open_document>${fileName}</current_open_document>\n</NIMBALYST_SYSTEM_MESSAGE>`;
      }

      // Build system prompt with document context
      const promptBuildStart = Date.now();
      const systemPrompt = this.buildSystemPrompt(documentContext);
      // console.log(`[CLAUDE-CODE] System prompt build took ${Date.now() - promptBuildStart}ms, length: ${systemPrompt.length}`);
      // console.log(`[CLAUDE-CODE] System prompt first 300 chars:`, systemPrompt.substring(0, 300));

      // Require workspace path
      if (!workspacePath) {
        throw new Error('[CLAUDE-CODE] workspacePath is required but was not provided');
      }
      // console.log(`[CLAUDE-CODE] Working directory (cwd): ${workspacePath}`);

      // Build options for claude-code SDK
      // console.log('[CLAUDE-CODE] Building SDK options...');

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
        mcpServers: await this.getMcpServersConfig(sessionId, workspacePath),
        cwd: workspacePath,
        abortController: this.abortController,
        model: 'sonnet',
        permissionMode: 'bypassPermissions',
        // PHASE 3: PreToolUse hook for tagging "before" state
        // PostToolUse hook for triggering file watcher (no snapshot creation)
        hooks: {
          'PreToolUse': [
            {
              hooks: [this.createPreToolUseHook(workspacePath, sessionId)]
            }
          ],
          'PostToolUse': [
            {
              hooks: [this.createPostToolUseHook(workspacePath, sessionId)]
            }
          ]
        },
        // API key is passed via environment variable if configured (see env setup below)
      };

      // Apply tool restrictions based on session mode
      // Planning mode: restrict to read-only tools + Write/Edit/MultiEdit for markdown files
      const DEFAULT_PLANNING_TOOLS = [
        'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS',
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
      if (this.currentMode === 'planning') {
        // In planning mode, enforce read-only toolset regardless of configured settings
        allowedList = DEFAULT_PLANNING_TOOLS;
      } else if ((this.config as any)?.allowedTools) {
        allowedList = (this.config as any).allowedTools as string[];
      } else {
        // Default to full tool access in agent mode
        allowedList = ['*'];
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

      // console.log('[CLAUDE-CODE] Options built without API key (Claude Code manages auth internally)');

      // Set up environment variables for the SDK
      // If user has configured a claude-code API key, pass it via environment
      const env: any = {
        ...process.env
        // Note: MCP is enabled when we have MCP servers configured (like session naming)
      };

      if (this.config.apiKey) {
        // console.log('[CLAUDE-CODE] Using API key from config');
        env.ANTHROPIC_API_KEY = this.config.apiKey;
      } else {
        // console.log('[CLAUDE-CODE] No API key in config - SDK will use claude login credentials or system env var');
      }

      // In production, we need to spawn claude-code differently
      // The SDK expects to spawn with 'node', but we need to use Electron in node mode
      if (app.isPackaged) {
        // Use shared environment setup utility
        const packagedEnv = setupClaudeCodeEnvironment();
        Object.assign(env, packagedEnv);

        // Set executable options
        const executableOptions = getClaudeCodeExecutableOptions();
        Object.assign(options, executableOptions);

        // console.log('[CLAUDE-CODE] Enhanced environment for packaged build:', {
        //   platform: process.platform,
        //   HOME: env.HOME || env.USERPROFILE,
        //   USER: env.USER || env.USERNAME,
        //   SHELL: env.SHELL,
        //   PATH: env.PATH?.substring(0, 100) + '...',
        //   NODE_PATH: env.NODE_PATH,
        //   ELECTRON_RUN_AS_NODE: env.ELECTRON_RUN_AS_NODE,
        //   executable: options.executable,
        //   cwd: workspacePath
        // });
      }

      options.env = env;

      // If we have a session ID and a claude session ID, resume
      if (sessionId) {
        const claudeSessionId = this.claudeSessionIds.get(sessionId);
        if (claudeSessionId) {
          options.resume = claudeSessionId;
          // console.log(`[CLAUDE-CODE] Resuming claude-code session: ${claudeSessionId}`);
        } else {
          // console.log(`[CLAUDE-CODE] No existing Claude session for ID: ${sessionId}`);
        }
      }

      // Use claude-code-sdk query function
      // const optionsSummary = {
      //   model: options.model,
      //   hasSystemPrompt: !!options.systemPrompt,
      //   hasMcpServers: !!options.mcpServers,
      //   mcpServers: options.mcpServers ? Object.keys(options.mcpServers) : [],
      //   cwd: options.cwd,
      //   resume: options.resume,
      //   hasAbortController: !!options.abortController,
      //   executable: options.executable,
      //   executableArgs: options.executableArgs,
      //   pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      //   hasEnv: !!options.env,
      //   envKeys: options.env ? Object.keys(options.env).filter(k => k.includes('ANTHROPIC') || k.includes('NODE') || k.includes('ELECTRON') || k.includes('HOME') || k.includes('PATH')) : []
      // };
      // console.log(`[CLAUDE-CODE] Calling query with options:`, JSON.stringify(optionsSummary, null, 2));

      const queryStartTime = Date.now();

      // console.log('[CLAUDE-CODE] Calling query with prompt length:', message.length);
      // console.log('[CLAUDE-CODE] Creating query iterator...');

      // Log the raw input to the SDK (include attachments in metadata for UI restoration)
      if (sessionId) {
        const metadataToLog = attachments && attachments.length > 0 ? { attachments } : undefined;
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
        }), metadataToLog, this.markMessagesAsHidden);
      }

      // TODO: Debug logging - uncomment if needed for MCP troubleshooting
      // Log MCP servers being passed to SDK (CONTAINS SENSITIVE CONFIG - commented out for production)
      // console.log('[CLAUDE-CODE] Final MCP config for SDK:', JSON.stringify(options.mcpServers, null, 2));

      // Build the prompt - use streaming input mode when we have image attachments
      // This allows us to send images directly as content blocks instead of file paths
      // See: https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
      type SDKUserMessage = {
        type: 'user';
        message: MessageParam;
        parent_tool_use_id: string | null;
      };

      let promptInput: string | AsyncIterable<SDKUserMessage>;

      if (imageContentBlocks.length > 0) {
        // Use streaming input mode with content blocks for images + text
        const contentBlocks: ContentBlockParam[] = [
          ...imageContentBlocks,
          { type: 'text', text: message } as TextBlockParam
        ];

        // Create an async generator that yields a single user message with the content blocks
        async function* createStreamingInput(): AsyncGenerator<SDKUserMessage> {
          yield {
            type: 'user',
            message: {
              role: 'user',
              content: contentBlocks
            },
            parent_tool_use_id: null
          };
        }

        promptInput = createStreamingInput();
        // console.log(`[CLAUDE-CODE] Using streaming input with ${imageContentBlocks.length} image(s) + text`);
      } else {
        // Simple string prompt when no images
        promptInput = message;
      }

      const queryIterator = query({
        prompt: promptInput,
        options
      }) as AsyncIterable<any>;

      // console.log('[CLAUDE-CODE] Query iterator created, type:', typeof queryIterator);
      // console.log('[CLAUDE-CODE] Has Symbol.asyncIterator:', !!queryIterator?.[Symbol.asyncIterator]);

      let fullContent = '';
      let chunkCount = 0;
      let firstChunkTime: number | undefined;
      let toolCallCount = 0;
      // Track tool calls by ID so we can update them with results
      const toolCallsById: Map<string, any> = new Map();
      // Track usage data from the SDK
      let usageData: { input_tokens?: number; output_tokens?: number } | undefined;

      // console.log('[CLAUDE-CODE] Starting to iterate over query response...');

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
            this.logAgentMessage(sessionId, 'claude-code', 'output', rawChunkJson, undefined, this.markMessagesAsHidden);
          }

          // if (chunkCount <= 5) {
          //   console.log(`[CLAUDE-CODE] Chunk #${chunkCount}:`,
          //     typeof chunk === 'string'
          //       ? { type: 'string', length: chunk.length, preview: chunk.substring(0, 100) }
          //       : JSON.stringify(chunk, null, 2)
          //   );
          // }

          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            const timeToFirstChunk = firstChunkTime - queryStartTime;
            // console.log(`[CLAUDE-CODE] First chunk received after ${timeToFirstChunk}ms (total: ${firstChunkTime - startTime}ms from start)`);
          }
          if (typeof chunk === 'string') {
            // Text chunk - always display it
            // if (chunkCount <= 3) {
            //   console.log(`[CLAUDE-CODE] Text chunk #${chunkCount}, length: ${chunk.length}, first 100 chars:`, chunk.substring(0, 100));
            // }
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
            // if (chunkCount <= 5) {
            //   console.log(`[CLAUDE-CODE] Object chunk #${chunkCount}:`, JSON.stringify(chunk, null, 2));
            // }

            if (chunk.session_id && sessionId) {
              // Store the claude session ID
              // console.log(`[CLAUDE-CODE] Storing session ID mapping: ${sessionId} -> ${chunk.session_id}`);
              this.claudeSessionIds.set(sessionId, chunk.session_id);
            }

            if (chunk.type === 'assistant' && chunk.message) {
            // Capture usage data from the message if available
            if (chunk.message.usage) {
              usageData = chunk.message.usage;
            }

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
                  // console.log(`[CLAUDE-CODE] Tool use #${toolCallCount} detected: ${block.name} (id: ${toolId})`);
                  // console.log(`[CLAUDE-CODE] Tool arguments:`, JSON.stringify(block.input || block.arguments, null, 2).substring(0, 500));

                  const toolName = block.name;
                  const toolArgs = block.input;
                  const isMcpTool = toolName?.startsWith('mcp__');

                  // Detect TodoWrite tool invocations and extract todos
                  if (toolName === 'TodoWrite' && toolArgs && toolArgs.todos) {
                    // console.log(`[CLAUDE-CODE] TodoWrite detected with ${toolArgs.todos.length} todos`);
                    // Emit todo update event to renderer via IPC (don't await - let it happen async)
                    this.emitTodoUpdate(sessionId, toolArgs.todos).catch(err => {
                      console.error('[CLAUDE-CODE] Failed to emit todo update:', err);
                    });
                  }

                  // SDK-native tools that are executed by the Claude Code SDK itself
                  const sdkNativeTools = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash',
                                          'WebFetch', 'WebSearch', 'Task', 'ExitPlanMode',
                                          'NotebookRead', 'NotebookEdit', 'TodoRead', 'TodoWrite'];
                  const isSdkNativeTool = sdkNativeTools.includes(toolName);

                  let executionResult: any | undefined;

                  if (!toolName) {
                    // console.warn('[CLAUDE-CODE] Tool use block missing name');
                  } else if (isMcpTool) {
                    // console.log(`[CLAUDE-CODE] MCP tool detected: ${toolName} - handled by MCP server`);
                  } else if (isSdkNativeTool) {
                    // console.log(`[CLAUDE-CODE] SDK-native tool detected: ${toolName} - executed by Claude Code SDK, result will come in tool_result block`);
                    // SDK executes these tools itself, result will come in a tool_result block
                  } else if (this.toolHandler) {
                    // console.log(`[CLAUDE-CODE] Executing tool: ${toolName}`);
                    const toolStartTime = Date.now();
                    try {
                      executionResult = await this.executeToolCall(toolName, toolArgs);
                      // console.log(`[CLAUDE-CODE] ${toolName} execution completed in ${Date.now() - toolStartTime}ms`);
                      // if (executionResult !== undefined) {
                      //   try {
                      //     console.log(`[CLAUDE-CODE] ${toolName} result:`, JSON.stringify(executionResult, null, 2));
                      //   } catch (stringifyError) {
                      //     console.log(`[CLAUDE-CODE] ${toolName} result could not be stringified`, stringifyError);
                      //   }
                      // }
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
                    // console.warn(`[CLAUDE-CODE] No tool handler registered - skipping execution for ${toolName}`);
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
                      }), undefined, this.markMessagesAsHidden);

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
                      }), undefined, this.markMessagesAsHidden);
                    }

                    yield {
                      type: 'tool_call',
                      toolCall
                    };
                  } else {
                    // console.log(`[CLAUDE-CODE] Deferring tool call emission for ${toolName} until result arrives`);
                  }
                } else if (block.type === 'tool_result') {
                  // Handle tool results from Claude Code SDK
                  const toolResultId = block.tool_use_id || block.id;
                  const toolResult = block.content;
                  const isError = block.is_error || false;

                  // console.log(`[CLAUDE-CODE] Tool result received for tool ID: ${toolResultId}`);
                  // console.log(`[CLAUDE-CODE] Tool result (first 500 chars):`,
                  //   typeof toolResult === 'string'
                  //     ? toolResult.substring(0, 500)
                  //     : JSON.stringify(toolResult, null, 2).substring(0, 500)
                  // );

                  // Find the corresponding tool call and update it with result
                  const toolCall = toolCallsById.get(toolResultId);
                  if (toolCall) {
                    // Check if tool already has a result - if so, skip duplicate
                    if (toolCall.result !== undefined) {
                      // console.log(`[CLAUDE-CODE] Tool call ${toolResultId} already has result, skipping duplicate`);
                      continue; // Skip this tool_result block
                    }

                    toolCall.result = toolResult;

                    // Check if this is an error - either explicit is_error flag or error in content
                    const hasErrorFlag = isError === true;
                    const hasErrorContent = typeof toolResult === 'string' &&
                      (toolResult.includes('<tool_use_error>') || toolResult.startsWith('Error:'));

                    if (hasErrorFlag || hasErrorContent) {
                      toolCall.isError = true;
                      // console.log(`[CLAUDE-CODE] Marked tool call ${toolResultId} as error`);
                    }

                    // console.log(`[CLAUDE-CODE] Updated tool call ${toolResultId} with result (isError: ${toolCall.isError || false})`);

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
                      }), undefined, this.markMessagesAsHidden);
                    }

                    // Re-emit the tool call with the result
                    yield {
                      type: 'tool_call',
                      toolCall
                    };
                  } else {
                    // console.warn(`[CLAUDE-CODE] Received tool result for unknown tool ID: ${toolResultId}`);
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
            // console.log(`[CLAUDE-CODE] Standalone tool call #${toolCallCount}: ${toolChunk.name}`);
            // console.log(`[CLAUDE-CODE] Standalone tool arguments:`, JSON.stringify(toolChunk.input || toolChunk.arguments, null, 2).substring(0, 500));

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
              // console.log(`[CLAUDE-CODE] MCP tool (standalone): ${toolName} - handled by MCP server`);
            } else if (isSdkNativeTool) {
              // console.log(`[CLAUDE-CODE] SDK-native tool (standalone): ${toolName} - executed by Claude Code SDK`);
              // SDK executes these tools itself, we just observe them
            } else if (this.toolHandler) {
              // console.log(`[CLAUDE-CODE] Executing tool (standalone): ${toolName}`);
              const toolStartTime = Date.now();
              try {
                executionResult = await this.executeToolCall(toolName, toolArgs);
                // console.log(`[CLAUDE-CODE] ${toolName} execution completed in ${Date.now() - toolStartTime}ms`);
                // if (executionResult !== undefined) {
                //   try {
                //     console.log(`[CLAUDE-CODE] ${toolName} result:`, JSON.stringify(executionResult, null, 2));
                //   } catch (stringifyError) {
                //     console.log(`[CLAUDE-CODE] ${toolName} result could not be stringified`, stringifyError);
                //   }
                // }
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
              // console.warn(`[CLAUDE-CODE] No tool handler registered - skipping execution for ${toolName}`);
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
                }), undefined, this.markMessagesAsHidden);

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
                }), undefined, this.markMessagesAsHidden);
              }

              yield {
                type: 'tool_call',
                toolCall
              };
            } else {
              // console.log(`[CLAUDE-CODE] Deferring standalone tool call emission for ${toolName} until result arrives`);
            }
          } else if (chunk.type === 'text') {
            const text = chunk.text || chunk.content || '';
            fullContent += text;
            yield {
              type: 'text',
              content: text
            };
          } else if (chunk.type === 'result') {
            // Final result - capture comprehensive usage data if available
            // console.log(`[CLAUDE-CODE] Result chunk received, is_error: ${chunk.is_error}`);

            // The result chunk often has the most complete usage data
            if (chunk.usage) {
              usageData = chunk.usage;
            }

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

              // Yield error to UI - MessageSegment will handle displaying it (possibly as LoginRequiredWidget)
              yield {
                type: 'error',
                error: errorMessage
              };
            }
            // Don't yield result content as text - it's already been sent in the assistant message
            // Only errors need to be displayed from result chunks
          } else if (chunk.type === 'system') {
            // Handle system messages from Claude Code (initialization, etc.)
            // console.log(`[CLAUDE-CODE] System chunk received:`, chunk);

            // Store session_id if present
            if (chunk.session_id && sessionId) {
              // console.log(`[CLAUDE-CODE] Storing session ID from system message: ${sessionId} -> ${chunk.session_id}`);
              this.claudeSessionIds.set(sessionId, chunk.session_id);
            }

            // System messages like 'init' are informational - don't display to user
            if (chunk.subtype === 'init') {
              // console.log('[CLAUDE-CODE] Claude Code initialized with:', {
              //   cwd: chunk.cwd,
              //   model: chunk.model,
              //   session_id: chunk.session_id,
              //   toolCount: chunk.tools?.length || 0,
              //   mcpServers: chunk.mcp_servers || [],
              //   apiKeySource: chunk.apiKeySource,
              //   slashCommands: chunk.slash_commands || [],
              //   agents: chunk.agents || [],
              //   skills: chunk.skills || [],
              //   plugins: chunk.plugins || []
              // });

              // Log all chunk properties to discover what's available
              // console.log('[CLAUDE-CODE] Full init chunk keys:', Object.keys(chunk));

              // Capture available slash commands
              if (chunk.slash_commands && Array.isArray(chunk.slash_commands)) {
                this.slashCommands = chunk.slash_commands;
                // console.log('[CLAUDE-CODE] Available slash commands:', this.slashCommands);
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

              // console.log('[CLAUDE-CODE] Session initialization data:', {
              //   mcpServerCount,
              //   slashCommandCount,
              //   agentCount,
              //   skillCount,
              //   pluginCount,
              //   toolCount: chunk.tools?.length || 0
              // });

              // Warn if API key source is "none" - this means Claude Code didn't find credentials
              if (chunk.apiKeySource === 'none') {
                  // console.log('[CLAUDE-CODE] no api key: using system configured claude-code credentials');
                // console.error('[CLAUDE-CODE] ⚠️  API Key Source is "none" - Claude Code did not detect any API key!');
                // console.error('[CLAUDE-CODE] This likely means:');
                // console.error('[CLAUDE-CODE]   1. Environment variable ANTHROPIC_API_KEY is not set or not visible to the spawned process');
                // console.error('[CLAUDE-CODE]   2. API key in options is not being recognized by Claude Code SDK');
                // console.error('[CLAUDE-CODE]   3. No stored credentials from `claude login` command');
                // console.error('[CLAUDE-CODE] Subsequent API calls will likely fail with authentication errors');
              }
            } else if (chunk.subtype === 'compact_boundary') {
              // Handle /compact command response
              // console.log('[CLAUDE-CODE] Compact boundary received:', {
              //   pre_tokens: chunk.compact_metadata?.pre_tokens,
              //   trigger: chunk.compact_metadata?.trigger
              // });

              // Display compact completion message to user
              const preTokens = chunk.compact_metadata?.pre_tokens || 'unknown';
              yield {
                type: 'text',
                content: `✓ Conversation compacted (was ${preTokens} tokens)`
              };
            } else {
              // Other system messages might be relevant
              // console.log('[CLAUDE-CODE] Other system message:', chunk.subtype, chunk);

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
            // console.log(`[CLAUDE-CODE] User chunk received:`, {
            //   role: chunk.message?.role,
            //   hasContent: !!chunk.message?.content,
            //   contentType: Array.isArray(chunk.message?.content) ? 'array' : typeof chunk.message?.content
            // });

            const content = chunk.message?.content;

            // Check if content is an array (typical for tool results)
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  // Handle tool results from Claude Code SDK
                  const toolResultId = block.tool_use_id || block.id;
                  const toolResult = block.content;
                  const isError = block.is_error || false;

                  // console.log(`[CLAUDE-CODE] Tool result in user message for tool ID: ${toolResultId}`);
                  // console.log(`[CLAUDE-CODE] Tool result (first 500 chars):`,
                  //   typeof toolResult === 'string'
                  //     ? toolResult.substring(0, 500)
                  //     : JSON.stringify(toolResult, null, 2).substring(0, 500)
                  // );

                  // Find the corresponding tool call and update it with result
                  const toolCall = toolCallsById.get(toolResultId);
                  if (toolCall) {
                    // Check if tool already has a result - if so, skip duplicate
                    if (toolCall.result !== undefined) {
                      // console.log(`[CLAUDE-CODE] Tool call ${toolResultId} already has result from user message, skipping duplicate`);
                      continue; // Skip this tool_result
                    }

                    toolCall.result = toolResult;

                    // Check if this is an error - either explicit is_error flag or error in content
                    const hasErrorFlag = isError === true;
                    const hasErrorContent = typeof toolResult === 'string' &&
                      (toolResult.includes('<tool_use_error>') || toolResult.startsWith('Error:'));

                    if (hasErrorFlag || hasErrorContent) {
                      toolCall.isError = true;
                      // console.log(`[CLAUDE-CODE] Marked tool call ${toolResultId} as error (from user message)`);
                    }

                    // console.log(`[CLAUDE-CODE] Updated tool call ${toolResultId} with result from user message (isError: ${toolCall.isError || false})`);

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
                      }), undefined, this.markMessagesAsHidden);
                    }

                    // Re-emit the tool call with the result
                    yield {
                      type: 'tool_call',
                      toolCall
                    };
                  } else {
                    // console.warn(`[CLAUDE-CODE] Received tool result for unknown tool ID: ${toolResultId}`);
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
                // console.log('[CLAUDE-CODE] Slash command output detected, length:', commandOutput.length);

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
            // console.log(`[CLAUDE-CODE] Summary chunk received:`, chunk);
            const summary = chunk.summary || '';

            // Check if this is an error summary
            const lowerSummary = summary.toLowerCase();
            if (lowerSummary.includes('invalid api key') ||
                lowerSummary.includes('error') ||
                lowerSummary.includes('failed') ||
                lowerSummary.includes('/login') ||
                lowerSummary.includes('unauthorized') ||
                lowerSummary.includes('oauth token has expired') ||
                lowerSummary.includes('token has expired') ||
                lowerSummary.includes('expired token') ||
                lowerSummary.includes('authentication_error') ||
                lowerSummary.includes('process exited with code')) {
              console.error('[CLAUDE-CODE] ERROR: Summary contains error message:', summary);
              console.error('[CLAUDE-CODE] Full summary chunk:', JSON.stringify(chunk, null, 2));

              // Pass through the error message directly
              // The LoginRequiredWidget in MessageSegment will handle displaying a proper UI
              const errorMessage = summary;

              // Log error to database (as 'output' since errors are provider responses)
              this.logError(sessionId, 'claude-code', new Error(errorMessage), 'summary_chunk', 'authentication_error');

              // Yield error to UI - MessageSegment will handle displaying it (possibly as LoginRequiredWidget)
              yield {
                type: 'error',
                error: errorMessage
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
              // console.log('[CLAUDE-CODE] Informational summary:', summary);

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
            // console.log(`[CLAUDE-CODE] Unknown chunk type at #${chunkCount}:`, chunk);
            // console.log(`[CLAUDE-CODE] Full unknown chunk:`, JSON.stringify(chunk, null, 2));

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
              // console.log(`[CLAUDE-CODE] Yielding unknown chunk content to UI:`, extractedContent.substring(0, 200));
              yield {
                type: 'text',
                content: extractedContent
              };
            }

            // Also check if this looks like an error
            const chunkStr = JSON.stringify(chunk).toLowerCase();
            if (chunkStr.includes('error') || chunkStr.includes('fail') || chunkStr.includes('invalid')) {
              // console.warn('[CLAUDE-CODE] Unknown chunk might contain an error');
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
      // console.log(`[CLAUDE-CODE] ========== END sendMessage ==========`);
      // console.log(`[CLAUDE-CODE] Stream complete - Total time: ${totalTime}ms`);
      // console.log(`[CLAUDE-CODE] Stats - Chunks: ${chunkCount}, Tool calls: ${toolCallCount}, Content length: ${fullContent.length}`);
      // console.log(`[CLAUDE-CODE] First 500 chars of response:`, fullContent.substring(0, 500));

      // Create snapshots for all files edited during this turn
      // console.log(`[CLAUDE-CODE] ========== TURN ENDING ==========`);
      // console.log(`[CLAUDE-CODE] editedFilesThisTurn size:`, this.editedFilesThisTurn.size);
      // console.log(`[CLAUDE-CODE] editedFilesThisTurn contents:`, Array.from(this.editedFilesThisTurn));

      if (this.editedFilesThisTurn.size > 0) {
        // console.log(`[CLAUDE-CODE] Creating ai-edit snapshots for ${this.editedFilesThisTurn.size} files edited this turn`);
        await this.createTurnEndSnapshots(workspacePath!, sessionId);
        // console.log(`[CLAUDE-CODE] Turn-end snapshots complete`);
      } else {
        // console.log(`[CLAUDE-CODE] WARNING: No files in editedFilesThisTurn set - no snapshots will be created`);
      }
      // console.log(`[CLAUDE-CODE] ========== TURN END COMPLETE ==========`);

      yield {
        type: 'complete',
        // Don't send content here - it's already been sent in chunks
        // The AIService accumulates the chunks itself
        isComplete: true,
        ...(usageData ? {
          usage: {
            input_tokens: usageData.input_tokens || 0,
            output_tokens: usageData.output_tokens || 0,
            cache_read_input_tokens: usageData.cache_read_input_tokens || 0,
            cache_creation_input_tokens: usageData.cache_creation_input_tokens || 0,
            total_tokens: (usageData.input_tokens || 0) + (usageData.output_tokens || 0)
          }
        } : {})
      };

      // console.log('[CLAUDE-CODE] Complete event yielded');

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
        console.error(`[CLAUDE-CODE] Error occurred`);

        // If we were trying to resume a session, check if it's missing
        const resumeSessionId = sessionId ? this.claudeSessionIds.get(sessionId) : null;
        if (resumeSessionId) {
          const sessionExists = await this.checkSessionExists(resumeSessionId);
          if (!sessionExists) {
            console.error(`[CLAUDE-CODE] Session ${resumeSessionId} not found - user needs to create new session`);
            this.claudeSessionIds.delete(sessionId!);

            yield {
              type: 'error',
              error: 'Your previous conversation session has expired or been cleaned up. Please create a new session to continue.'
            };

            // CRITICAL: Always send completion after error to clean up UI state
            yield {
              type: 'complete'
            };
            return;
          }
        }

        console.error(`[CLAUDE-CODE] Yielding error to client`);
        console.error(`[CLAUDE-CODE] Session ID for error logging:`, sessionId);

        // Log error to database (as 'output' since errors are provider responses)
        if (!sessionId) {
          console.error(`[CLAUDE-CODE] CRITICAL: Cannot log error - sessionId is undefined!`);
        } else {
          console.error(`[CLAUDE-CODE] Logging error to database for session:`, sessionId);
          this.logError(sessionId, 'claude-code', error, 'catch_block', 'exception');
        }

        yield {
          type: 'error',
          error: error.message
        };

        // CRITICAL: Always send completion after error to clean up UI state
        yield {
          type: 'complete'
        };
      }
    } finally {
      // console.log('[CLAUDE-CODE] Cleaning up abort controller');
      this.abortController = null;
      // Reset hidden mode flag after sendMessage completes
      this.markMessagesAsHidden = false;
    }
  }

  abort(): void {
    // console.log('[CLAUDE-CODE] Abort called');
    if (this.abortController) {
      // console.log('[CLAUDE-CODE] Aborting active request');
      this.abortController.abort();
      this.abortController = null;
    } else {
      // console.log('[CLAUDE-CODE] No active request to abort');
    }

    // Clean up any pending ExitPlanMode confirmations
    this.rejectAllPendingConfirmations();
  }

  /**
   * Update session metadata with current todos
   * Uses the existing metadata update mechanism instead of custom IPC events
   */
  private async emitTodoUpdate(sessionId: string | undefined, todos: any[]): Promise<void> {
    // console.log(`[CLAUDE-CODE] emitTodoUpdate called with sessionId: ${sessionId}, todos count: ${todos?.length}`);

    if (!sessionId) {
      // console.warn('[CLAUDE-CODE] Cannot update todos: no session ID');
      return;
    }

    try {
      // Update session metadata with the current todos
      // This will trigger session reloads which will update the UI
      // console.log(`[CLAUDE-CODE] Updating session metadata with ${todos.length} todos for session ${sessionId}`);

      // Import AISessionsRepository dynamically
      // console.log('[CLAUDE-CODE] Importing AISessionsRepository...');
      const { AISessionsRepository } = await import('../../../storage/repositories/AISessionsRepository');
      // console.log('[CLAUDE-CODE] AISessionsRepository imported successfully');

      // Get current session to merge metadata
      // console.log(`[CLAUDE-CODE] Getting current session ${sessionId}...`);
      const currentSession = await AISessionsRepository.get(sessionId);
      // console.log(`[CLAUDE-CODE] Current session retrieved:`, currentSession ? 'found' : 'not found');

      const currentMetadata = currentSession?.metadata || {};
      // console.log(`[CLAUDE-CODE] Current metadata:`, JSON.stringify(currentMetadata, null, 2));

      // console.log(`[CLAUDE-CODE] Updating metadata with merged todos...`);
      await AISessionsRepository.updateMetadata(sessionId, {
        metadata: {
          ...currentMetadata,
          currentTodos: todos
        }
      });

      // console.log(`[CLAUDE-CODE] Session metadata updated successfully with todos:`, JSON.stringify(todos, null, 2));

      // Emit message:logged event to trigger UI reload
      // This will cause the AgenticPanel to reload the session and pick up the new todos
      // console.log(`[CLAUDE-CODE] Emitting message:logged event...`);
      this.emit('message:logged', {
        sessionId,
        direction: 'output'
      });
      // console.log(`[CLAUDE-CODE] Emitted message:logged event to trigger UI reload`);
    } catch (error) {
      console.error('[CLAUDE-CODE] Failed to update session metadata with todos:', error);
      console.error('[CLAUDE-CODE] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
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
    // console.log(`[CLAUDE-CODE] Setting provider session data for ${sessionId}:`, data);
    if (data.claudeSessionId) {
      this.claudeSessionIds.set(sessionId, data.claudeSessionId);
      // console.log(`[CLAUDE-CODE] Stored Claude session ID: ${data.claudeSessionId}`);
    }
  }

  getProviderSessionData(sessionId: string): any {
    const claudeSessionId = this.claudeSessionIds.get(sessionId);
    // console.log(`[CLAUDE-CODE] Getting provider session data for ${sessionId}: ${claudeSessionId || 'none'}`);
    return {
      claudeSessionId
    };
  }

  /**
   * Resolve a pending ExitPlanMode confirmation request
   * Called by AIService when renderer responds to confirmation prompt
   */
  public resolveExitPlanModeConfirmation(requestId: string, approved: boolean): void {
    const pending = this.pendingExitPlanModeConfirmations.get(requestId);
    if (pending) {
      pending.resolve(approved);
      this.pendingExitPlanModeConfirmations.delete(requestId);
      // TODO: Debug logging - uncomment if needed
      // console.log(`[CLAUDE-CODE] ExitPlanMode confirmation resolved: ${approved ? 'approved' : 'denied'}`);
    } else {
      console.warn(`[CLAUDE-CODE] No pending ExitPlanMode confirmation found for requestId: ${requestId}`);
    }
  }

  /**
   * Reject all pending ExitPlanMode confirmations (e.g., on abort)
   */
  public rejectAllPendingConfirmations(): void {
    for (const [requestId, pending] of this.pendingExitPlanModeConfirmations) {
      pending.reject(new Error('Request aborted'));
    }
    this.pendingExitPlanModeConfirmations.clear();
  }

  private async getMcpServersConfig(sessionId?: string, workspacePath?: string) {
    // Load MCP servers from .mcp.json in the workspace (if available)
    // and merge with built-in session naming server
    const config: any = {};

    // Include session naming MCP server if it's started
    if (ClaudeCodeProvider.sessionNamingServerPort !== null && sessionId) {
      config['nimbalyst-session-naming'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${ClaudeCodeProvider.sessionNamingServerPort}/mcp?sessionId=${encodeURIComponent(sessionId)}`
      };
      console.log('[CLAUDE-CODE] Session naming MCP server configured on port', ClaudeCodeProvider.sessionNamingServerPort, 'for session', sessionId);
    }

    // Load user and workspace MCP servers from .mcp.json
    if (workspacePath) {
      try {
        const fs = require('fs');
        const path = require('path');
        const mcpJsonPath = path.join(workspacePath, '.mcp.json');

        if (fs.existsSync(mcpJsonPath)) {
          const mcpJsonContent = fs.readFileSync(mcpJsonPath, 'utf8');
          const mcpConfig = JSON.parse(mcpJsonContent);

          if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object') {
            // Process and merge workspace MCP servers with built-in servers
            for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
              const processedConfig = { ...serverConfig as any };

              // For SSE transport, convert env vars to headers (SDK requirement)
              if (processedConfig.type === 'sse' && processedConfig.env) {
                // TODO: Debug logging - uncomment if needed for MCP SSE troubleshooting (CONTAINS SENSITIVE DATA)
                // console.log(`[CLAUDE-CODE] Processing SSE server "${serverName}", converting env to headers`);
                processedConfig.headers = processedConfig.headers || {};

                // Convert API keys from env to Authorization headers
                for (const [key, value] of Object.entries(processedConfig.env)) {
                  if (key.endsWith('_API_KEY')) {
                    // TODO: Debug logging - uncomment if needed (LOGS API KEY FRAGMENTS - SECURITY RISK)
                    // console.log(`[CLAUDE-CODE] Found API key: ${key}, value starts with:`, value.substring(0, 10));
                    // Expand environment variable if needed
                    const expandedValue = this.expandEnvVar(value as string, process.env as Record<string, string | undefined>);
                    // TODO: Debug logging - uncomment if needed (LOGS API KEY FRAGMENTS - SECURITY RISK)
                    // console.log(`[CLAUDE-CODE] Expanded value starts with:`, expandedValue.substring(0, 10));
                    if (expandedValue && !expandedValue.startsWith('${')) {
                      processedConfig.headers['Authorization'] = `Bearer ${expandedValue}`;
                      // TODO: Debug logging - uncomment if needed for MCP SSE troubleshooting
                      // console.log(`[CLAUDE-CODE] Converted ${key} to Authorization header for SSE server "${serverName}"`);
                    } else {
                      // TODO: Debug logging - uncomment if needed for MCP SSE troubleshooting
                      // console.log(`[CLAUDE-CODE] Skipped ${key} - unexpanded or empty`);
                    }
                  }
                }

                // Remove env from SSE config (not used for SSE transport)
                delete processedConfig.env;
                // TODO: Debug logging - uncomment if needed (CONTAINS AUTHORIZATION HEADERS - SECURITY RISK)
                // console.log(`[CLAUDE-CODE] Removed env field, headers:`, JSON.stringify(processedConfig.headers));
              }

              config[serverName] = processedConfig;
              // TODO: Debug logging - uncomment if needed (MAY CONTAIN SENSITIVE CONFIG - SECURITY RISK)
              // console.log(`[CLAUDE-CODE] Loaded MCP server "${serverName}":`, JSON.stringify(processedConfig));
            }
            // TODO: Debug logging - uncomment if needed for MCP troubleshooting
            // console.log('[CLAUDE-CODE] Loaded MCP servers from .mcp.json:', Object.keys(mcpConfig.mcpServers));
          }
        }
      } catch (error) {
        console.error('[CLAUDE-CODE] Failed to load .mcp.json:', error);
      }
    }

    return config;
  }

  /**
   * Expand environment variable syntax: ${VAR} and ${VAR:-default}
   */
  private expandEnvVar(value: string, env: Record<string, string | undefined>): string {
    return value.replace(/\$\{([^}:]+)(:-([^}]+))?\}/g, (_, varName, __, defaultValue) => {
      const envValue = env[varName];
      if (envValue !== undefined) {
        return envValue;
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      // Variable not set and no default - return original
      return `\${${varName}}`;
    });
  }

  /**
   * PHASE 3: Create PreToolUse hook for tagging file state before edits
   * This hook intercepts Edit/Write/MultiEdit tools, tags the current file state,
   * and tracks files for end-of-turn snapshot creation.
   */
  private createPreToolUseHook(workspacePath: string, sessionId?: string) {
    const fs = require('fs');
    const path = require('path');

    return async (input: any, toolUseID: string | undefined, options: { signal: AbortSignal }) => {
      const toolName = input.tool_name;
      const toolInput = input.tool_input;

      // console.log(`[CLAUDE-CODE] PreToolUse hook: ${toolName}`, { toolUseID, toolInput });

      // EXITPLANMODE CONFIRMATION: Intercept ExitPlanMode tool calls in planning mode
      // TODO: Debug logging - uncomment if needed for ExitPlanMode troubleshooting
      // if (toolName === 'ExitPlanMode') {
      //   console.log(`[CLAUDE-CODE] ExitPlanMode tool called, currentMode=${this.currentMode}`);
      // }

      if (toolName === 'ExitPlanMode' && this.currentMode === 'planning') {
        // TODO: Debug logging - uncomment if needed
        // console.log(`[CLAUDE-CODE] ExitPlanMode intercepted - requesting user confirmation`);

        // Generate unique request ID for this confirmation
        const requestId = `exit-plan-${sessionId}-${Date.now()}`;
        const planSummary = toolInput?.plan || '';

        // Create a promise that will be resolved when user responds
        const confirmationPromise = new Promise<boolean>((resolve, reject) => {
          this.pendingExitPlanModeConfirmations.set(requestId, { resolve, reject });

          // Set up abort handler
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              this.pendingExitPlanModeConfirmations.delete(requestId);
              reject(new Error('Request aborted'));
            }, { once: true });
          }
        });

        // Emit event to notify renderer to show confirmation UI
        this.emit('exitPlanMode:confirm', {
          requestId,
          sessionId,
          planSummary,
          timestamp: Date.now()
        });

        try {
          const approved = await confirmationPromise;

          if (approved) {
            // User approved - update our mode state and allow ExitPlanMode to proceed
            // TODO: Debug logging - uncomment if needed
            // console.log(`[CLAUDE-CODE] ExitPlanMode approved by user, switching to agent mode`);
            this.currentMode = 'agent';
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'allow' as const
              }
            };
          } else {
            // User denied - keep in planning mode
            // TODO: Debug logging - uncomment if needed
            // console.log(`[CLAUDE-CODE] ExitPlanMode denied by user, staying in planning mode`);
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'deny' as const,
                errorMessage: `The user chose to continue planning. Please refine the plan further before attempting to exit plan mode.`
              }
            };
          }
        } catch (error) {
          // Handle abort or other errors
          // TODO: Debug logging - uncomment if needed
          // console.log(`[CLAUDE-CODE] ExitPlanMode confirmation failed:`, error);
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              errorMessage: `ExitPlanMode was cancelled or interrupted.`
            }
          };
        }
      }

      // Handle non-file-editing tools (except ExitPlanMode which is handled above)
      if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'MultiEdit') {
        // console.log(`[CLAUDE-CODE] PreToolUse: Not a file editing tool, allowing`);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'allow' as const
          }
        };
      }

      try {
        // Extract file paths from tool arguments
        const filePaths: string[] = [];
        if (toolName === 'Edit' || toolName === 'Write') {
          const filePath = toolInput.file_path || toolInput.filePath;
          if (filePath) {
            filePaths.push(filePath);
          }
        } else if (toolName === 'MultiEdit') {
          // MultiEdit might have multiple files - tag each one
          const edits = toolInput.edits || [];
          for (const edit of edits) {
            const editFilePath = edit.file_path || edit.filePath;
            if (editFilePath) {
              filePaths.push(editFilePath);
            }
          }
        }

        // PLANNING MODE VALIDATION: Restrict file edits to markdown files only
        if (this.currentMode === 'planning') {
          for (const filePath of filePaths) {
            if (!filePath.endsWith('.md')) {
              console.error(`[CLAUDE-CODE] Planning mode validation FAILED: ${toolName} on ${filePath}`);
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'deny' as const,
                  errorMessage: `Planning mode restricts file operations to markdown files only. ` +
                    `Cannot use ${toolName} on '${filePath}'. ` +
                    `Please only edit .md files in the nimbalyst-local/plans/ directory.`
                }
              };
            }
          }
          // TODO: Debug logging - uncomment if needed for planning mode troubleshooting
          // console.log(`[CLAUDE-CODE] Planning mode validation passed for: ${filePaths.join(', ')}`);
        }

        // Tag each file and track for end-of-turn snapshot
        for (let filePath of filePaths) {
          if (!filePath) continue;

          // Make file path absolute if relative
          if (!path.isAbsolute(filePath)) {
            filePath = path.join(workspacePath, filePath);
          }

          // Track this file as edited during this turn
          this.editedFilesThisTurn.add(filePath);

          // Read current file content (if file exists)
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Create unique tag ID for this edit
            const actualToolUseId = toolUseID || `tool-${Date.now()}`;
            await this.tagFileBeforeEdit(filePath, workspacePath!, sessionId, actualToolUseId);
          } catch (error) {
            // File might not exist yet (Write tool creating new file)
            // console.log(`[CLAUDE-CODE] PreToolUse: File doesn't exist yet, will track for snapshot:`, filePath);
          }
        }

      } catch (error) {
        console.error('[CLAUDE-CODE] PreToolUse hook error:', error);
        // Don't block the edit if tagging fails
      }

      // Always return 'allow' to let the edit proceed
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'allow' as const
        }
      };
    };
  }

  /**
   * Tag a file's current state before an AI edit
   */
  private async tagFileBeforeEdit(
    filePath: string,
    workspacePath: string,
    sessionId: string | undefined,
    toolUseId: string
  ): Promise<void> {
    const fs = require('fs');

    try {
      // Import historyManager dynamically if we're in the main process context
      try {
        const { historyManager } = await import('../../../../../electron/src/main/HistoryManager');

        // CRITICAL: Check if there are already pending tags for this file
        // If yes, skip creating a new tag - we want to show ALL edits together as one diff
        // console.log(`[CLAUDE-CODE] PreToolUse: Checking for existing pending tags for:`, filePath);
        const pendingTags = await historyManager.getPendingTags(filePath);
        // console.log(`[CLAUDE-CODE] PreToolUse: Found ${pendingTags?.length || 0} pending tags for ${filePath}`);
        // if (pendingTags && pendingTags.length > 0) {
        //   console.log(`[CLAUDE-CODE] PreToolUse: Existing tag details:`, JSON.stringify(pendingTags[0], null, 2));
        // }

        if (pendingTags && pendingTags.length > 0) {
          // PRODUCTION LOG: Track when tag creation is skipped due to existing tag
          const tagAge = Date.now() - pendingTags[0].createdAt.getTime();
          console.log('[PRE-EDIT SKIP]', JSON.stringify({
            file: path.basename(filePath),
            existingTagAge: tagAge + 'ms',
            existingTagId: pendingTags[0].id,
            reason: 'existing_pending_tag',
          }));
          // Don't create a new tag - the existing one covers all edits until user approves/rejects
          return;
        }

        // PRODUCTION LOG: Track when new tag is created
        const tagId = `ai-edit-pending-${sessionId || 'unknown'}-${toolUseId}`;
        console.log('[PRE-EDIT TAG]', JSON.stringify({
          file: path.basename(filePath),
          tagId,
        }));

        // No pending tags - create the first one for this edit session
        // Read current file content
        const content = fs.readFileSync(filePath, 'utf-8');

        await historyManager.createTag(
          filePath,
          tagId,
          content,
          sessionId || 'unknown',
          toolUseId
        );
        // console.log(`[CLAUDE-CODE] PreToolUse: Tag created successfully`);

        // Small delay to ensure tag is committed to database before next edit check
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (importError) {
        // console.warn('[CLAUDE-CODE] PreToolUse: Could not import historyManager (might be in renderer process):',  importError);
        // If we're not in the main process, we'll need to use IPC
        // This will be implemented when we integrate with the IPC layer
      }

    } catch (error) {
      // Check if this is a unique constraint violation (expected if tag already exists)
      const errorStr = String(error);
      if (errorStr.includes('unique') || errorStr.includes('UNIQUE') || errorStr.includes('duplicate')) {
        // console.log(`[CLAUDE-CODE] PreToolUse: Tag already exists (unique constraint), skipping:`, filePath);
        // This is fine - means another rapid edit already created the tag
        return;
      }
      console.error('[CLAUDE-CODE] PreToolUse: Failed to tag file:', error);
      // Don't throw - allow the edit to proceed even if tagging fails
    }
  }

  /**
   * PostToolUse hook to ensure file watcher detects changes
   * This doesn't create snapshots - those are created at turn end
   * It just ensures the file system has flushed the write
   */
  private createPostToolUseHook(workspacePath: string, sessionId?: string) {
    return async (input: any, toolUseID: string | undefined, options: { signal: AbortSignal }) => {
      const toolName = input.tool_name;

      // Only care about file editing tools
      if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'MultiEdit') {
        return {};
      }

      // console.log(`[CLAUDE-CODE] PostToolUse hook: ${toolName} completed`, { toolUseID });

      // Small delay to ensure file system has flushed the write
      // This gives chokidar time to detect the change and trigger diff update
      // Increased from 50ms to 200ms to ensure file watcher can process each edit
      await new Promise(resolve => setTimeout(resolve, 200));

      // console.log(`[CLAUDE-CODE] PostToolUse hook: Delay complete, file watcher should have detected change`);
      return {};
    };
  }

  /**
   * Create 'ai-edit' snapshots for all files edited during this turn
   * Called at the end of the agent's turn, before yielding completion
   */
  private async createTurnEndSnapshots(workspacePath: string, sessionId?: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');

    // console.log(`[CLAUDE-CODE] Creating turn-end snapshots for ${this.editedFilesThisTurn.size} files`);

    for (const filePath of this.editedFilesThisTurn) {
      try {
        // Read the final content after all edits this turn
        let finalContent = '';
        try {
          finalContent = fs.readFileSync(filePath, 'utf-8');
        } catch (error) {
          console.warn(`[CLAUDE-CODE] Turn-end snapshot: Could not read file:`, filePath);
          continue;
        }

        // Save as 'ai-edit' snapshot in history
        try {
          const { historyManager } = await import('../../../../../electron/src/main/HistoryManager');
          await historyManager.createSnapshot(
            filePath,
            finalContent,
            'ai-edit',
            `AI edit turn complete (session: ${sessionId || 'unknown'})`
          );
          // console.log(`[CLAUDE-CODE] Turn-end snapshot created for ${filePath}`);
        } catch (importError) {
          console.warn('[CLAUDE-CODE] Could not import historyManager:', importError);
        }
      } catch (error) {
        console.error(`[CLAUDE-CODE] Failed to create turn-end snapshot for ${filePath}:`, error);
      }
    }
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

        // console.log(`[CLAUDE-CODE] ✓ Using unpacked CLI at: ${unpackedCliPath}`);

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
        // console.log(`[CLAUDE-CODE] ✓ Unpacked node_modules directory exists`);

        // Verify the SDK directory specifically
        const unpackedSdkDir = path.join(unpackedNodeModules, '@anthropic-ai', 'claude-agent-sdk');
        if (!fs.existsSync(unpackedSdkDir)) {
          const error = `SDK directory not found at: ${unpackedSdkDir}. ` +
                       `Build must unpack @anthropic-ai/claude-agent-sdk package.`;
          console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
          throw new Error(error);
        }
        // console.log(`[CLAUDE-CODE] ✓ Unpacked SDK directory verified`);

        cliPath = unpackedCliPath;
      }

      if (!fs.existsSync(cliPath)) {
        throw new Error(`CLI not found at expected path: ${cliPath}`);
      }

      // console.log(`[CLAUDE-CODE] Found CLI at: ${cliPath}`);
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

      let prompt = `Current date and time: ${dateStr} at ${timeStr}

You are an AI assistant integrated into the Nimbalyst editor's agentic coding workspace.
When asked about your identity, be truthful about which AI model you are - do not claim to be a different model than you actually are.`;

      // Add session naming instructions if MCP server is available
      if (ClaudeCodeProvider.sessionNamingServerPort !== null) {
        prompt += `

## Session Naming

You have access to a special tool called \`name_session\` that allows you to name this conversation session.

IMPORTANT: Call the \`name_session\` tool ONCE at the very start of this conversation, as soon as you understand the user's task or goal. The name should be:
- 2-5 words long
- Concise and descriptive
- Task-focused (e.g., "Fix authentication bug", "Add dark mode", "Refactor database layer")

Do NOT call this tool more than once per session. It should be called early, typically in your first response after understanding what the user wants to accomplish.`;
      }

      return prompt;
    }

    // For non-coding sessions, use the addendum-based approach
    const hasSessionNaming = ClaudeCodeProvider.sessionNamingServerPort !== null;
    const addendum = buildClaudeCodeSystemPromptAddendum(documentContext, hasSessionNaming);
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
      // console.log('[CLAUDE-CODE] Added Electron dir to PATH:', electronDir);
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

  /**
   * Quick check if a Claude Code session exists
   * Reads the history file to see if the session ID is present
   */
  private async checkSessionExists(sessionId: string): Promise<boolean> {
    try {
      const os = await import('os');
      const fs = await import('fs/promises');
      const path = await import('path');

      const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');

      // Quick existence check
      try {
        await fs.access(historyPath);
      } catch {
        return false; // No history file = no sessions
      }

      // Read file and search for session ID
      const content = await fs.readFile(historyPath, 'utf-8');
      return content.includes(sessionId);
    } catch (error) {
      console.warn('[CLAUDE-CODE] Failed to check session existence:', error);
      return true; // Assume it exists if we can't check (fail open)
    }
  }
}
