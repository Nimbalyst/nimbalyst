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
    console.log('[CLAUDE-CODE] Initializing provider with config:', {
      model: config.model,
      configKeys: Object.keys(config)
    });

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
      const tempAttachmentsDir = path.join(workspacePath, '.stravu', 'ai-chat-attachments', sessionId || 'default');
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
        // Do NOT pass API key - Claude Agent SDK manages authentication internally
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

      // In production, we need to spawn claude-code differently
      // The SDK expects to spawn with 'node', but we need to use Electron in node mode
      if (app.isPackaged) {
        // Set environment to run Electron as Node
        options.env = {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1'
        };
        options.executable = process.execPath;
        options.executableArgs = [];
        console.log('[CLAUDE-CODE] Using Electron as node with ELECTRON_RUN_AS_NODE=1');
      }

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

      console.log('[CLAUDE-CODE] Starting to iterate over query response...');

      // Stream the response
      try {
        for await (const rawChunk of queryIterator) {
          const chunk = rawChunk as any;
          chunkCount++;

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
                  console.log(`[CLAUDE-CODE] Tool use #${toolCallCount} detected: ${block.name}`);
                  console.log(`[CLAUDE-CODE] Tool arguments:`, JSON.stringify(block.input || block.arguments, null, 2).substring(0, 500));

                  const toolName = block.name;
                  const toolArgs = block.input;
                  const isMcpApplyDiff = toolName?.endsWith('__applyDiff');

                  // SDK-native tools that are executed by the Claude Code SDK itself
                  const sdkNativeTools = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash',
                                          'WebFetch', 'WebSearch', 'Task', 'ExitPlanMode',
                                          'NotebookRead', 'NotebookEdit', 'TodoRead', 'TodoWrite'];
                  const isSdkNativeTool = sdkNativeTools.includes(toolName);

                  let executionResult: any | undefined;

                  if (!toolName) {
                    console.warn('[CLAUDE-CODE] Tool use block missing name');
                  } else if (isMcpApplyDiff) {
                    console.log(`[CLAUDE-CODE] MCP applyDiff detected: ${toolName} - handled by MCP server`);
                  } else if (isSdkNativeTool) {
                    console.log(`[CLAUDE-CODE] SDK-native tool detected: ${toolName} - executed by Claude Code SDK`);
                    // SDK executes these tools itself, we just observe them
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

                  // Emit tool call event
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      name: toolName || 'unknown',
                      arguments: toolArgs,
                      ...(executionResult !== undefined ? { result: executionResult } : {})
                    }
                  };
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
            const isMcpApplyDiff = toolName.endsWith('__applyDiff');

            // SDK-native tools that are executed by the Claude Code SDK itself
            const sdkNativeTools = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash',
                                    'WebFetch', 'WebSearch', 'Task', 'ExitPlanMode',
                                    'NotebookRead', 'NotebookEdit', 'TodoRead', 'TodoWrite'];
            const isSdkNativeTool = sdkNativeTools.includes(toolName);

            let executionResult: any | undefined;

            if (isMcpApplyDiff) {
              console.log(`[CLAUDE-CODE] MCP applyDiff (standalone): ${toolName} - handled by MCP server`);
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

            yield {
              type: 'tool_call',
              toolCall: {
                name: toolName,
                arguments: toolArgs,
                ...(executionResult !== undefined ? { result: executionResult } : {})
              }
            };
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
                slashCommands: chunk.slash_commands || []
              });

              // Capture available slash commands
              if (chunk.slash_commands && Array.isArray(chunk.slash_commands)) {
                this.slashCommands = chunk.slash_commands;
                console.log('[CLAUDE-CODE] Available slash commands:', this.slashCommands);
              }

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
              hasContent: !!chunk.message?.content
            });

            // Check if this is a slash command result with <local-command-stdout>
            const content = chunk.message?.content;
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
            // Other user messages (like tool results) are internal - don't display
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
    console.log('[CLAUDE-CODE] Including stravu-editor MCP server configuration');
    return {
      "stravu-editor": {
        "type": "sse",
        "transport": "sse",
        "url": "http://127.0.0.1:3456/mcp"
      }
    };
  }

  private async findCliPath(): Promise<string> {
    // Use bundled CLI from the package
    try {
      const claudeAgentPath = require.resolve('@anthropic-ai/claude-agent-sdk');
      const claudeAgentDir = path.dirname(claudeAgentPath);
      const cliPath = path.join(claudeAgentDir, 'cli.js');

      if (fs.existsSync(cliPath)) {
        console.log(`[CLAUDE-CODE] Found bundled CLI at: ${cliPath}`);
        return cliPath;
      }

      throw new Error(`CLI not found at expected path: ${cliPath}`);
    } catch (err) {
      throw new Error(`Could not find bundled claude-agent-sdk CLI: ${err}`);
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

You are an AI assistant integrated into the Preditor editor's agentic coding workspace.
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
}
