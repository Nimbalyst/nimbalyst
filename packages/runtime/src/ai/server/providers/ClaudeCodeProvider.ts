/**
 * Claude Code provider using claude-agent-sdk with MCP support
 * Dynamically loads SDK from user's installation to avoid bundling
 */

import type { query as QueryType } from '@anthropic-ai/claude-agent-sdk';
import { BaseAIProvider } from '../AIProvider';
import {
  DocumentContext,
  ProviderConfig,
  ProviderCapabilities,
  StreamChunk,
  AIModel,
  DiffArgs,
  Message,
} from '../types';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';
import { buildClaudeCodeSystemPromptAddendum } from '../../prompt';

export class ClaudeCodeProvider extends BaseAIProvider {
  private abortController: AbortController | null = null;
  private claudeSessionIds: Map<string, string> = new Map(); // Our session ID -> Claude session ID
  private claudeCodeModule?: typeof import('@anthropic-ai/claude-agent-sdk'); // Dynamically loaded module with type safety
  private queryFunction?: typeof QueryType; // The query function from the SDK with proper types
  private currentSessionType?: string; // Track session type for prompt customization

  static readonly DEFAULT_MODEL = 'claude-code';

  /**
   * Dynamically load the Claude Code SDK from user's installation
   */
  private async loadClaudeCodeSDK(): Promise<void> {
    if (this.claudeCodeModule) {
      console.log('[CLAUDE-CODE] SDK already loaded, skipping reload');
      return; // Already loaded
    }

    console.log('[CLAUDE-CODE] Starting SDK load process...');
    
    // Get global npm root dynamically
    let globalNpmRoot: string | null = null;
    try {
      const { execSync } = require('child_process');
      globalNpmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      console.log(`[CLAUDE-CODE] Global npm root: ${globalNpmRoot}`);
    } catch (error) {
      console.log(`[CLAUDE-CODE] Could not get npm root:`, error);
    }

    // Try to find Claude Agent SDK in common locations
    const possiblePaths = [
      // User's local Claude installation (primary)
      path.join(os.homedir(), '.claude', 'local', 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
      // Dynamic global npm path
      ...(globalNpmRoot ? [path.join(globalNpmRoot, '@anthropic-ai', 'claude-agent-sdk')] : []),
      // System-wide npm installations
      '/usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk',
      '/usr/lib/node_modules/@anthropic-ai/claude-agent-sdk',
      // Common global npm locations
      path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
      // Yarn global installation
      path.join(os.homedir(), '.config', 'yarn', 'global', 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
      // Local development (if available)
      path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
    ];

    // NVM installations - enumerate actual node versions instead of using wildcard
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    try {
      const nodeVersions = fs.readdirSync(nvmDir);
      for (const version of nodeVersions) {
        possiblePaths.push(
          path.join(nvmDir, version, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
        );
      }
    } catch (e) {
      // NVM directory doesn't exist or can't be read
      console.log('[CLAUDE-CODE] NVM directory not found or inaccessible:', nvmDir);
    }

    // Fallback: Try to resolve from claude CLI in PATH
    try {
      const { execSync } = require('child_process');
      const claudePath = execSync('which claude', { encoding: 'utf8' }).trim();
      if (claudePath) {
        console.log(`[CLAUDE-CODE] Found claude CLI at: ${claudePath}`);
        // Resolve symlinks to find the real path
        const realPath = fs.realpathSync(claudePath);
        console.log(`[CLAUDE-CODE] Real path: ${realPath}`);

        // If it ends with cli.js, the package directory is two levels up
        if (realPath.endsWith('cli.js')) {
          const packageDir = path.dirname(realPath);
          possiblePaths.push(packageDir);
          console.log(`[CLAUDE-CODE] Added package directory from CLI: ${packageDir}`);
        }
      }
    } catch (e) {
      // CLI not in PATH or error resolving - not a problem, just skip this fallback
      console.log('[CLAUDE-CODE] Could not resolve claude CLI from PATH:', e instanceof Error ? e.message : e);
    }

    for (const sdkPath of possiblePaths) {
      try {
        // Check if path exists and has sdk.mjs
        const sdkFile = path.join(sdkPath, 'sdk.mjs');
        console.log(`[CLAUDE-CODE] Checking for SDK at: ${sdkFile}`);

        if (fs.existsSync(sdkFile)) {
          console.log(`[CLAUDE-CODE] Found SDK file, attempting to load from: ${sdkFile}`);

          // Use file:// protocol for ESM imports in Electron
          const fileUrl = `file://${sdkFile}`;
          console.log(`[CLAUDE-CODE] Loading SDK from URL: ${fileUrl}`);

          // For ESM modules, we need to use dynamic import with file:// protocol
          this.claudeCodeModule = await import(fileUrl);
          console.log(`[CLAUDE-CODE] SDK module loaded, checking for query function...`);
          console.log(`[CLAUDE-CODE] Module keys:`, Object.keys(this.claudeCodeModule || {}));

          this.queryFunction = this.claudeCodeModule?.query;
          if (!this.queryFunction) {
            console.warn(`[CLAUDE-CODE] No query function found in module at ${sdkPath}`);
            console.warn(`[CLAUDE-CODE] Available exports:`, Object.keys(this.claudeCodeModule || {}));
            continue;
          }

          console.log(`[CLAUDE-CODE] Successfully loaded SDK with query function from: ${sdkPath}`);
          console.log(`[CLAUDE-CODE] Query function type:`, typeof this.queryFunction);
          return;
        }
      } catch (error: any) {
        console.error(`[CLAUDE-CODE] Failed to load from ${sdkPath}:`, error.message || error);
      }
    }

    throw new Error(
      'Claude Agent SDK not found. Please install it via AI Models settings or run: npm install -g @anthropic-ai/claude-agent-sdk'
    );
  }

  async initialize(config: ProviderConfig): Promise<void> {
    console.log('[CLAUDE-CODE] Initializing provider with config:', {
      model: config.model,
      configKeys: Object.keys(config)
    });

    this.config = config;

    // Claude Code manages its own authentication - do not require or use API key
    console.log('[CLAUDE-CODE] Claude Code manages authentication internally');

    // Load the SDK dynamically
    console.log('[CLAUDE-CODE] Loading SDK...');
    await this.loadClaudeCodeSDK();
    console.log('[CLAUDE-CODE] SDK loaded successfully');
  }

  async *sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[],
    workspacePath?: string
  ): AsyncIterableIterator<StreamChunk> {
    const startTime = Date.now();
    console.log(`[CLAUDE-CODE] ========== START sendMessage ==========`);
    console.log(`[CLAUDE-CODE] Message length: ${message.length}`);
    console.log(`[CLAUDE-CODE] Has document context: ${!!documentContext}`);
    console.log(`[CLAUDE-CODE] Session ID: ${sessionId || 'new session'}`);
    console.log(`[CLAUDE-CODE] Workspace path: ${workspacePath}`);
    console.log(`[CLAUDE-CODE] First 200 chars of message:`, message.substring(0, 200));

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

      // Get allowed tools from config, default to a safe subset
      // Default tools: Read, Search & Navigation (all), Web Access (all), Task Management (all), ExitPlanMode
      const defaultTools = [
        'Read',
        'Glob', 'Grep', 'LS',
        'WebFetch', 'WebSearch',
        'TodoRead', 'TodoWrite', 'Task',
        'ExitPlanMode'
      ];
      const allowedTools = this.config.allowedTools && this.config.allowedTools.length > 0
        ? this.config.allowedTools
        : defaultTools;
      console.log('[CLAUDE-CODE] Allowed tools:', allowedTools);

      // Calculate disallowed tools - all tools NOT in the allowed list
      const allTools = [
        'Read', 'Write', 'Edit', 'MultiEdit',
        'Glob', 'Grep', 'LS',
        'WebFetch', 'WebSearch',
        'TodoRead', 'TodoWrite', 'Task',
        'NotebookRead', 'NotebookEdit',
        'Bash', 'ExitPlanMode'
      ];
      const disallowedTools = allTools.filter(tool => !allowedTools.includes(tool));
      console.log('[CLAUDE-CODE] Disallowed tools:', disallowedTools);

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
        allowedTools,
        disallowedTools,
        cwd: workspacePath,
        abortController: this.abortController,
        model: 'sonnet',
        permissionMode: 'bypassPermissions'
        // Do NOT pass API key - Claude Agent SDK manages authentication internally
      };

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

      // Ensure we have the query function
      if (!this.queryFunction) {
        console.error('[CLAUDE-CODE] Query function is undefined!');
        throw new Error('Claude Code SDK not loaded properly');
      }

      console.log('[CLAUDE-CODE] Query function is defined, type:', typeof this.queryFunction);
      console.log('[CLAUDE-CODE] Calling query with prompt length:', message.length);
      console.log('[CLAUDE-CODE] Creating query iterator...');
      
      const queryIterator = this.queryFunction({
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
            console.log(`[CLAUDE-CODE] Chunk #${chunkCount}:`, {
              type: typeof chunk,
              isString: typeof chunk === 'string',
              keys: typeof chunk === 'object' ? Object.keys(chunk) : [],
              chunkType: chunk?.type,
              length: typeof chunk === 'string' ? chunk.length : undefined
            });
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
              console.log(`[CLAUDE-CODE] Object chunk #${chunkCount}, type: ${chunk.type}, keys:`, Object.keys(chunk));
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
                  
                  // Emit tool call event
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      name: block.name,
                      arguments: block.input
                    }
                  };

                  // If it's an applyDiff tool (including MCP variant), execute it
                  // Note: For MCP tools, Claude Code handles the execution internally
                  // We only execute non-MCP applyDiff calls here
                  if (block.name === 'applyDiff' && this.toolHandler && this.toolHandler.applyDiff) {
                    console.log(`[CLAUDE-CODE] Executing non-MCP applyDiff tool`);
                    try {
                      const result = await this.toolHandler.applyDiff(block.input as DiffArgs);
                      console.log(`[CLAUDE-CODE] applyDiff result:`, result);
                      // Tool result will be sent back to Claude Code automatically
                    } catch (error) {
                      console.error('[CLAUDE-CODE] Error executing applyDiff:', error);
                    }
                  } else if (block.name?.endsWith('__applyDiff')) {
                    // MCP applyDiff - Claude Code handles this through MCP server
                    console.log(`[CLAUDE-CODE] MCP applyDiff detected: ${block.name} - handled by MCP server`);
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
            
            yield {
              type: 'tool_call',
              toolCall: {
                name: toolChunk.name || 'unknown',
                arguments: toolChunk.input
              }
            };

            // Handle applyDiff - only non-MCP versions
            // MCP tools are handled by the MCP server directly
            if (toolChunk.name === 'applyDiff' && toolChunk.input && this.toolHandler && this.toolHandler.applyDiff) {
              console.log(`[CLAUDE-CODE] Executing non-MCP applyDiff tool (standalone)`);
              try {
                const result = await this.toolHandler.applyDiff(toolChunk.input as DiffArgs);
                console.log(`[CLAUDE-CODE] applyDiff result:`, result);
              } catch (error) {
                console.error('[CLAUDE-CODE] Error executing applyDiff:', error);
              }
            } else if (toolChunk.name?.endsWith('__applyDiff')) {
              // MCP applyDiff - handled by MCP server
              console.log(`[CLAUDE-CODE] MCP applyDiff (standalone): ${toolChunk.name} - handled by MCP server`);
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

              // Extract error message and display it
              const errorMessage = chunk.error || chunk.message || chunk.error_message ||
                                 JSON.stringify(chunk, null, 2);

              // Yield error to UI
              yield {
                type: 'error',
                error: `Claude Code Error: ${errorMessage}`
              };

              // Also yield as text to ensure visibility
              yield {
                type: 'text',
                content: `❌ Claude Code encountered an error:\n${errorMessage}`
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
                apiKeySource: chunk.apiKeySource
              });

              // Warn if API key source is "none" - this means Claude Code didn't find credentials
              if (chunk.apiKeySource === 'none') {
                console.error('[CLAUDE-CODE] ⚠️  API Key Source is "none" - Claude Code did not detect any API key!');
                console.error('[CLAUDE-CODE] This likely means:');
                console.error('[CLAUDE-CODE]   1. Environment variable ANTHROPIC_API_KEY is not set or not visible to the spawned process');
                console.error('[CLAUDE-CODE]   2. API key in options is not being recognized by Claude Code SDK');
                console.error('[CLAUDE-CODE]   3. No stored credentials from `claude login` command');
                console.error('[CLAUDE-CODE] Subsequent API calls will likely fail with authentication errors');
              }
            } else {
              // Other system messages might be relevant
              console.log('[CLAUDE-CODE] Other system message:', chunk.subtype);
            }
            // Don't yield system messages to UI - they're internal
          } else if (chunk.type === 'user') {
            // Handle user messages (including tool results) - don't display to user
            console.log(`[CLAUDE-CODE] User chunk received (tool results, etc.):`, {
              role: chunk.role,
              contentBlocks: Array.isArray(chunk.content) ? chunk.content.length : 'not array'
            });
            // These are internal messages going back to Claude - don't display to user
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
    // Get global npm root dynamically
    let globalNpmRoot: string | null = null;
    try {
      const { execSync } = require('child_process');
      globalNpmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    } catch (error) {
      console.log(`[CLAUDE-CODE] Could not get npm root for CLI:`, error);
    }

    // Since we're dynamically loading the SDK, look for CLI in user's installation
    const possiblePaths = [
      // User's local Claude installation (primary)
      path.join(os.homedir(), '.claude', 'local', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
      // Dynamic global npm path
      ...(globalNpmRoot ? [path.join(globalNpmRoot, '@anthropic-ai', 'claude-agent-sdk', 'cli.js')] : []),
      // System-wide npm installations
      '/usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
      '/usr/lib/node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
      // Common global npm locations
      path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
      // Yarn global installation
      path.join(os.homedir(), '.config', 'yarn', 'global', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
      // Development paths (for local testing)
      path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
    ];

    // NVM installations - enumerate actual node versions
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    try {
      const nodeVersions = fs.readdirSync(nvmDir);
      for (const version of nodeVersions) {
        possiblePaths.push(
          path.join(nvmDir, version, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
        );
      }
    } catch (e) {
      // NVM directory doesn't exist
    }

    // Fallback: Try to resolve from claude CLI in PATH
    try {
      const { execSync } = require('child_process');
      const claudePath = execSync('which claude', { encoding: 'utf8' }).trim();
      if (claudePath) {
        // Resolve symlinks to find the real path
        const realPath = fs.realpathSync(claudePath);
        if (realPath.endsWith('cli.js')) {
          possiblePaths.push(realPath);
          console.log(`[CLAUDE-CODE] Added CLI path from PATH: ${realPath}`);
        }
      }
    } catch (e) {
      // CLI not in PATH or error resolving - not a problem
    }

    // Find the first path that exists
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        console.log(`[CLAUDE-CODE] Found claude-code CLI at: ${testPath}`);
        return testPath;
      }
    }

    // Last resort - try require.resolve
    try {
      const claudeAgentPath = require.resolve('@anthropic-ai/claude-agent-sdk');
      const claudeAgentDir = path.dirname(claudeAgentPath);
      const cliPath = path.join(claudeAgentDir, 'cli.js');
      console.log(`[CLAUDE-CODE] Resolved claude-agent-sdk CLI at: ${cliPath}`);
      return cliPath;
    } catch (err) {
      throw new Error('Could not find claude-agent-sdk CLI executable');
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
}
