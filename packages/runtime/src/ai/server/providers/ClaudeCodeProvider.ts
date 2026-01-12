/**
 * Claude Code provider using claude-agent-sdk with MCP support
 * Uses bundled SDK from package dependencies
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { parse as parseShellCommand } from 'shell-quote';
import type { MessageParam, ImageBlockParam, TextBlockParam, ContentBlockParam, DocumentBlockParam } from '@anthropic-ai/sdk/resources';
import { BaseAIProvider } from '../AIProvider';
import {
  DocumentContext,
  ProviderConfig,
  ProviderCapabilities,
  StreamChunk,
  AIModel,
  Message,
  PermissionRequestContent,
  PermissionResponseContent,
  AskUserQuestionRequestContent,
  AskUserQuestionResponseContent,
  getPatternDisplayName,
} from '../types';
import { AgentMessagesRepository } from '../../../storage/repositories/AgentMessagesRepository';
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
const CLAUDE_CODE_VARIANTS = ['opus', 'sonnet', 'haiku'] as const;
type ClaudeCodeVariant = typeof CLAUDE_CODE_VARIANTS[number];

// Map variants to their current version numbers
// These correspond to the underlying Claude models used by Claude Code
const CLAUDE_CODE_VARIANT_VERSIONS: Record<ClaudeCodeVariant, string> = {
  opus: '4.5',
  sonnet: '4.5',
  haiku: '3.5'
};

const CLAUDE_CODE_MODEL_LABELS: Record<ClaudeCodeVariant, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku'
};

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

  // AskUserQuestion tool - stores pending question resolvers
  // When Claude calls AskUserQuestion, we block until the UI provides answers via IPC
  private pendingAskUserQuestions: Map<string, {
    resolve: (answers: Record<string, string>) => void;
    reject: (error: Error) => void;
    questions: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description: string }>;
      multiSelect: boolean;
    }>;
  }> = new Map();

  // Tool permission requests - stores pending permission resolvers
  // When a tool requires approval, we block until the UI provides a response via IPC
  private pendingToolPermissions: Map<string, {
    resolve: (response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' }) => void;
    reject: (error: Error) => void;
    request: any; // PermissionRequest
  }> = new Map();

  // Session-level permission cache - patterns approved with 'session' or 'always' scope
  // This prevents re-prompting for the same pattern within a session, since the SDK
  // doesn't hot-reload settings files mid-session
  private sessionApprovedPatterns: Set<string> = new Set();

  // Shared MCP server port (injected from electron main process)
  // This server provides capture_mockup_screenshot tool only.
  // applyDiff and streamContent are NOT exposed via MCP - they're only for chat providers via IPC.
  private static mcpServerPort: number | null = null;

  // Session naming MCP server port (injected from electron main process)
  private static sessionNamingServerPort: number | null = null;

  // Extension dev MCP server port (injected from electron main process)
  // Provides tools for building, installing, and reloading extensions
  private static extensionDevServerPort: number | null = null;

  // MCP config loader (injected from electron main process)
  // Returns merged user + workspace MCP servers
  private static mcpConfigLoader: ((workspacePath?: string) => Promise<Record<string, any>>) | null = null;

  // Extension plugins loader (injected from electron main process)
  // Returns plugin paths from enabled extensions with Claude plugins
  // Accepts optional workspace path to include project-scoped CLI plugins
  private static extensionPluginsLoader: ((workspacePath?: string) => Promise<Array<{ type: 'local'; path: string }>>) | null = null;

  // Claude Code settings loader (injected from electron main process)
  // Returns settings for project/user commands
  private static claudeCodeSettingsLoader: (() => Promise<{ projectCommandsEnabled: boolean; userCommandsEnabled: boolean }>) | null = null;

  // Additional directories loader (injected from electron main process)
  // Returns additional directories Claude should have access to based on workspace context
  // (e.g., SDK docs when working on an extension project)
  private static additionalDirectoriesLoader: ((workspacePath: string) => string[]) | null = null;

  // Security logging callback (injected from electron main process)
  // Only enabled in dev mode for reviewing agent security checks
  private static securityLogger: ((message: string, data?: any) => void) | null = null;

  // Claude settings pattern saver (injected from electron main process)
  // Writes tool patterns to .claude/settings.local.json when user approves with "Always"
  private static claudeSettingsPatternSaver: ((
    workspacePath: string,
    pattern: string
  ) => Promise<void>) | null = null;

  // Claude settings pattern checker (injected from electron main process)
  // Checks if a pattern is in the allow list of .claude/settings.local.json
  private static claudeSettingsPatternChecker: ((
    workspacePath: string,
    pattern: string
  ) => Promise<boolean>) | null = null;

  // Trust checker (injected from electron main process)
  // Checks if a workspace is trusted before allowing tool execution
  // Modes: 'ask' = prompt for each command, 'allow-all' = auto-approve file edits, 'bypass-all' = auto-approve everything
  private static trustChecker: ((
    workspacePath: string
  ) => { trusted: boolean; mode: 'ask' | 'allow-all' | 'bypass-all' | null }) | null = null;

  static readonly DEFAULT_MODEL = 'claude-code:sonnet';

  /**
   * Set the shared MCP server port (called from electron main process)
   * This allows the runtime package to use the MCP server without directly depending on electron code
   */
  public static setMcpServerPort(port: number | null): void {
    ClaudeCodeProvider.mcpServerPort = port;
  }

  /**
   * Set the session naming MCP server port (called from electron main process)
   * This allows the runtime package to use the MCP server without directly depending on electron code
   */
  public static setSessionNamingServerPort(port: number | null): void {
    ClaudeCodeProvider.sessionNamingServerPort = port;
  }

  /**
   * Set the extension dev MCP server port (called from electron main process)
   * This provides build, install, reload, and uninstall tools for extension development
   */
  public static setExtensionDevServerPort(port: number | null): void {
    ClaudeCodeProvider.extensionDevServerPort = port;
  }

  /**
   * Set the MCP config loader function (called from electron main process)
   * This allows the runtime package to load merged user + workspace MCP configs
   * without directly depending on electron code
   */
  public static setMCPConfigLoader(loader: ((workspacePath?: string) => Promise<Record<string, any>>) | null): void {
    ClaudeCodeProvider.mcpConfigLoader = loader;
  }

  /**
   * Set the extension plugins loader function (called from electron main process)
   * This allows the runtime package to load Claude SDK plugins from extensions
   * without directly depending on electron extension loader code
   */
  public static setExtensionPluginsLoader(loader: ((workspacePath?: string) => Promise<Array<{ type: 'local'; path: string }>>) | null): void {
    ClaudeCodeProvider.extensionPluginsLoader = loader;
  }

  /**
   * Set the Claude Code settings loader function (called from electron main process)
   * This allows the runtime package to get user/project command settings
   */
  public static setClaudeCodeSettingsLoader(loader: (() => Promise<{ projectCommandsEnabled: boolean; userCommandsEnabled: boolean }>) | null): void {
    ClaudeCodeProvider.claudeCodeSettingsLoader = loader;
  }

  /**
   * Set the additional directories loader function (called from electron main process)
   * This allows the runtime package to get additional directories Claude should have access to
   * based on workspace context (e.g., SDK docs when working on an extension project)
   */
  public static setAdditionalDirectoriesLoader(loader: ((workspacePath: string) => string[]) | null): void {
    ClaudeCodeProvider.additionalDirectoriesLoader = loader;
  }

  /**
   * Set the security logger function (called from electron main process)
   * Only enabled in dev mode for reviewing permission decisions
   */
  public static setSecurityLogger(logger: ((message: string, data?: any) => void) | null): void {
    ClaudeCodeProvider.securityLogger = logger;
  }

  /**
   * Set the Claude settings pattern saver function (called from electron main process)
   * Writes tool patterns to .claude/settings.local.json when user approves with "Always"
   */
  public static setClaudeSettingsPatternSaver(saver: ((
    workspacePath: string,
    pattern: string
  ) => Promise<void>) | null): void {
    ClaudeCodeProvider.claudeSettingsPatternSaver = saver;
  }

  /**
   * Set the Claude settings pattern checker function (called from electron main process)
   * Checks if a pattern is in the allow list of Claude settings files
   */
  public static setClaudeSettingsPatternChecker(checker: ((
    workspacePath: string,
    pattern: string
  ) => Promise<boolean>) | null): void {
    ClaudeCodeProvider.claudeSettingsPatternChecker = checker;
  }

  /**
   * Set the trust checker function (called from electron main process)
   * Checks if a workspace is trusted before allowing tool execution
   */
  public static setTrustChecker(checker: ((
    workspacePath: string
  ) => { trusted: boolean; mode: 'ask' | 'allow-all' | 'bypass-all' | null }) | null): void {
    ClaudeCodeProvider.trustChecker = checker;
  }

  /**
   * Log a security-related message (only if security logger is configured)
   */
  private logSecurity(message: string, data?: any): void {
    if (ClaudeCodeProvider.securityLogger) {
      ClaudeCodeProvider.securityLogger(message, data);
    }
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

  private resolveModelVariant(): ClaudeCodeVariant {
    const fallback: ClaudeCodeVariant = 'sonnet';
    const configured = this.config.model || ClaudeCodeProvider.DEFAULT_MODEL;
    const raw = configured.includes(':') ? configured.split(':').pop()! : configured;
    const normalized = raw?.toLowerCase();

    if (normalized && (CLAUDE_CODE_VARIANTS as readonly string[]).includes(normalized)) {
      return normalized as ClaudeCodeVariant;
    }

    return fallback;
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

    // CRITICAL: Capture hidden mode flag at START and reset immediately
    // This prevents race conditions when concurrent sendMessage calls overlap
    // (e.g., auto-context /context command running while a queued prompt fires)
    const hideMessages = this.markMessagesAsHidden;
    this.markMessagesAsHidden = false;

    // Track session mode for MCP server configuration and tool filtering
    this.currentMode = (documentContext as any)?.mode || 'agent';
    // console.log(`[CLAUDE-CODE] Session mode: ${this.currentMode}`);

    // Build content blocks for attachments (sent directly to Claude, not via file paths)
    const imageContentBlocks: ImageBlockParam[] = [];
    const documentContentBlocks: DocumentBlockParam[] = [];
    // Debug logging - uncomment if needed for attachment troubleshooting
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
            console.error(`[CLAUDE-CODE] Failed to read image attachment:`, error);
          }
        } else if (attachment.type === 'document' && attachment.filepath) {
          // Read text/document files and send as document content blocks
          try {
            const textContent = await fs.promises.readFile(attachment.filepath, 'utf-8');
            const filename = attachment.filename || path.basename(attachment.filepath);
            documentContentBlocks.push({
              type: 'document',
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: textContent
              },
              title: filename
            });
            // console.log(`[CLAUDE-CODE] Created document content block for ${filename}, ${textContent.length} chars`);
          } catch (error) {
            console.error(`[CLAUDE-CODE] Failed to read document attachment:`, error);
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
      const mockupDrawing = (documentContext as any)?.mockupDrawing;
      const fileType = (documentContext as any)?.fileType;
      const hasMockupAnnotations = mockupDrawing && fileType === 'mockup';

      // Build system message content based on context
      if (!isSlashCommand && (currentDocPath || hasMockupAnnotations)) {
        let systemMessageContent = '';

        if (currentDocPath) {
          const fileName = path.basename(currentDocPath) || currentDocPath;
          systemMessageContent += `The user is currently viewing this document:\n<current_open_document>${fileName}</current_open_document>`;
        }

        if (hasMockupAnnotations) {
          if (systemMessageContent) {
            systemMessageContent += '\n\n';
          }
          systemMessageContent += 'IMPORTANT: The user has drawn annotations on the mockup to show you what they want. Use the mcp__nimbalyst-mcp__capture_mockup_screenshot tool to see their annotations before responding.';
        }

        message = `${message}\n\n<NIMBALYST_SYSTEM_MESSAGE>\n${systemMessageContent}\n</NIMBALYST_SYSTEM_MESSAGE>`;
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

      // Determine which settings sources to use based on user preferences
      // 'local' is always included (machine-level settings)
      // 'user' includes ~/.claude/commands/
      // 'project' includes .claude/commands/ in workspace
      let settingSources: string[] = ['local'];
      if (ClaudeCodeProvider.claudeCodeSettingsLoader) {
        try {
          const ccSettings = await ClaudeCodeProvider.claudeCodeSettingsLoader();
          if (ccSettings.userCommandsEnabled) {
            settingSources.push('user');
          }
          if (ccSettings.projectCommandsEnabled) {
            settingSources.push('project');
          }
        } catch (error) {
          // Fall back to all sources enabled
          console.warn('[CLAUDE-CODE] Failed to load Claude Code settings, using defaults:', error);
          settingSources = ['user', 'project', 'local'];
        }
      } else {
        // No loader configured, enable all sources
        settingSources = ['user', 'project', 'local'];
      }

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
        settingSources,
        mcpServers: await this.getMcpServersConfig(sessionId, workspacePath),
        cwd: workspacePath,
        abortController: this.abortController,
        model: this.resolveModelVariant(),
        // Use 'default' permission mode so canUseTool fires for AskUserQuestion and Bash
        // We auto-approve most tools in canUseTool, but check permissions for Bash
        permissionMode: 'default',
        // canUseTool callback handles permission requests
        // Auto-approves most tools, but checks Bash commands and blocks on AskUserQuestion
        canUseTool: this.createCanUseToolHandler(sessionId, workspacePath),
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

      // Load extension plugins if available
      // These are Claude SDK plugins bundled with Nimbalyst extensions
      // Also includes CLI-installed plugins from ~/.claude/plugins/
      if (ClaudeCodeProvider.extensionPluginsLoader) {
        try {
          const extensionPlugins = await ClaudeCodeProvider.extensionPluginsLoader(workspacePath);
          if (extensionPlugins.length > 0) {
            options.plugins = extensionPlugins;
            console.log(`[CLAUDE-CODE] Loaded ${extensionPlugins.length} extension plugin(s):`, extensionPlugins.map(p => p.path));
          }
        } catch (error) {
          console.warn('[CLAUDE-CODE] Failed to load extension plugins:', error);
          // Continue without extension plugins
        }
      }

      // Add additional directories based on workspace context
      // (e.g., SDK docs when working on an extension project)
      if (ClaudeCodeProvider.additionalDirectoriesLoader) {
        try {
          const additionalDirs = ClaudeCodeProvider.additionalDirectoriesLoader(workspacePath);
          if (additionalDirs.length > 0) {
            options.additionalDirectories = additionalDirs;
            console.log(`[CLAUDE-CODE] Added ${additionalDirs.length} additional directory(ies):`, additionalDirs);
          }
        } catch (error) {
          console.warn('[CLAUDE-CODE] Failed to load additional directories:', error);
          // Continue without additional directories
        }
      }

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

      // In planning mode, enforce read-only toolset
      // In agent mode, we do NOT set allowedTools so that tools flow through to canUseTool
      // where our permission system can prompt the user
      if (this.currentMode === 'planning') {
        (options as any).allowedTools = DEFAULT_PLANNING_TOOLS;
        // Workaround for SDK bug: also pass all disallowed tools explicitly
        const disallowed = SDK_NATIVE_TOOLS.filter(t => !DEFAULT_PLANNING_TOOLS.includes(t));
        (options as any).disallowedTools = disallowed;
        (options as any).blockedTools = disallowed;
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
        }), metadataToLog, hideMessages);
      }

      // TODO: Debug logging - uncomment if needed for MCP troubleshooting
      // Log MCP servers being passed to SDK (CONTAINS SENSITIVE CONFIG - commented out for production)
      // console.log('[CLAUDE-CODE] Final MCP config for SDK:', JSON.stringify(options.mcpServers, null, 2));

      // Build the prompt - use streaming input mode when we have attachments (images or documents)
      // This allows us to send content directly as content blocks instead of file paths
      // See: https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
      type SDKUserMessage = {
        type: 'user';
        message: MessageParam;
        parent_tool_use_id: string | null;
      };

      let promptInput: string | AsyncIterable<SDKUserMessage>;

      const hasAttachmentBlocks = imageContentBlocks.length > 0 || documentContentBlocks.length > 0;

      if (hasAttachmentBlocks) {
        // Use streaming input mode with content blocks for attachments + text
        const contentBlocks: ContentBlockParam[] = [
          ...imageContentBlocks,
          ...documentContentBlocks,
          { type: 'text', text: message } as TextBlockParam
        ];

        // Debug logging - uncomment if needed for troubleshooting
        // console.log(`[CLAUDE-CODE] Content blocks structure:`, JSON.stringify(contentBlocks.map(b => ({
        //   type: b.type,
        //   ...(b.type === 'image' ? { media_type: (b as any).source?.media_type, data_length: (b as any).source?.data?.length } : {}),
        //   ...(b.type === 'document' ? { title: (b as any).title, data_length: (b as any).source?.data?.length } : {}),
        //   ...(b.type === 'text' ? { text_length: (b as any).text?.length } : {})
        // })), null, 2));

        // Create an async generator that yields a single user message with the content blocks
        async function* createStreamingInput(): AsyncGenerator<SDKUserMessage> {
          const msg: SDKUserMessage = {
            type: 'user',
            message: {
              role: 'user',
              content: contentBlocks
            },
            parent_tool_use_id: null
          };
          // console.log(`[CLAUDE-CODE] Yielding streaming message with ${contentBlocks.length} content blocks`);
          yield msg;
        }

        promptInput = createStreamingInput();
        // console.log(`[CLAUDE-CODE] Using streaming input with ${imageContentBlocks.length} image(s), ${documentContentBlocks.length} document(s) + text`);
      } else {
        // Simple string prompt when no attachments
        promptInput = message;
      }

      const queryIterator = query({
        prompt: promptInput as any,
        options
      }) as AsyncIterable<any>;

      // console.log('[CLAUDE-CODE] Query iterator created, type:', typeof queryIterator);
      // console.log('[CLAUDE-CODE] Has Symbol.asyncIterator:', !!queryIterator?.[Symbol.asyncIterator]);

      let fullContent = '';
      let chunkCount = 0;
      let firstChunkTime: number | undefined;
      let toolCallCount = 0;
      let receivedCompactBoundary = false;
      // Track tool calls by ID so we can update them with results
      const toolCallsById: Map<string, any> = new Map();
      // Track usage data from the SDK
      let usageData: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      } | undefined;
      // Track per-model usage from SDK result (contains inputTokens, outputTokens, costUSD, etc.)
      let modelUsageData: Record<string, {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadInputTokens?: number;
        cacheCreationInputTokens?: number;
        costUSD?: number;
        contextWindow?: number;
        webSearchRequests?: number;
      }> | undefined;
      // Track whether any displayable content was yielded during this request
      // Used to detect when a slash command returns no output
      let hasYieldedContent = false;
      let hasYieldedError = false;

      // console.log('[CLAUDE-CODE] Starting to iterate over query response...');

      // Stream the response
      try {
        for await (const rawChunk of queryIterator) {
          const chunk = rawChunk as any;
          chunkCount++;

          // Log raw SDK chunks to database
          // Extract SDK-provided uuid for deduplication in sync
          if (sessionId) {
            const rawChunkJson = typeof chunk === 'string'
              ? JSON.stringify({ type: 'text', content: chunk })
              : JSON.stringify(chunk);
            // Non-string chunks from SDK have a uuid field we can use for deduplication
            const providerMessageId = typeof chunk !== 'string' ? chunk.uuid : undefined;
            this.logAgentMessage(sessionId, 'claude-code', 'output', rawChunkJson, undefined, hideMessages, providerMessageId);
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
            // Check for SDK-detected authentication error (first-class detection)
            // This is much more reliable than string matching in message content
            if (chunk.error === 'authentication_failed') {
              console.error('[CLAUDE-CODE] Authentication error detected via SDK error field');
              this.logError(sessionId, 'claude-code', new Error('Authentication failed'), 'assistant_chunk', 'authentication_error', hideMessages);
              yield {
                type: 'error',
                error: 'Authentication failed. Please log in to continue.',
                isAuthError: true
              };
              yield { type: 'complete', isComplete: true };
              break;
            }

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
                      }), undefined, hideMessages);

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
                      }), undefined, hideMessages);
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
                      }), undefined, hideMessages);
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
                }), undefined, hideMessages);

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
                }), undefined, hideMessages);
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

            // The result chunk often has the most complete usage data
            if (chunk.usage) {
              usageData = chunk.usage;
            }

            // Capture modelUsage which has per-model breakdown with inputTokens, outputTokens, costUSD, etc.
            if (chunk.modelUsage) {
              modelUsageData = chunk.modelUsage;
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

              // Check if this is an authentication error
              const lowerError = (typeof errorMessage === 'string' ? errorMessage : '').toLowerCase();
              const isAuthError = (
                lowerError.includes('invalid api key') ||
                lowerError.includes('authentication') ||
                lowerError.includes('unauthorized') ||
                lowerError.includes('401')
              );

              // Log error to database (as 'output' since errors are provider responses)
              this.logError(sessionId, 'claude-code', new Error(errorMessage), 'result_chunk', isAuthError ? 'authentication_error' : 'api_error', hideMessages);

              // Yield error to UI with isAuthError flag if applicable
              yield {
                type: 'error',
                error: errorMessage,
                ...(isAuthError && { isAuthError: true })
              };

              // CRITICAL: Send completion and break on result errors (like "prompt too long")
              // Without this, the UI thinks the agent is still processing and /compact won't work
              yield {
                type: 'complete',
                isComplete: true
              };

              // Break out of the loop since we have an error
              break;
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

              // Mark that we received a compact boundary (prevents false "no output" error)
              receivedCompactBoundary = true;

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
                      }), undefined, hideMessages);
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

            // Check if this is a slash command error result with <local-command-stderr>
            if (typeof content === 'string' && content.includes('<local-command-stderr>')) {
              // Extract and display the command error
              const match = content.match(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/);
              if (match && match[1]) {
                const commandError = match[1].trim();
                console.error('[CLAUDE-CODE] Slash command error detected:', commandError);

                // Log error to database for persistence
                // The logError call saves the message to the database and emits 'message:logged'
                // which triggers a session reload in the UI, displaying the error
                // Do NOT yield an error chunk here - that would cause duplicate display via ai:error IPC
                // Pass hideMessages so /context errors (auto-triggered) stay hidden
                this.logError(sessionId, 'claude-code', new Error(commandError), 'slash_command_stderr', 'slash_command_error', hideMessages);
              }
            }
            // Other user messages are internal - don't display
          } else if (chunk.type === 'summary') {
            // Handle summary messages from Claude Code
            const summary = chunk.summary || '';

            // Check if this is an authentication-related error summary
            // IMPORTANT: Only match specific authentication error patterns, NOT generic words like 'error' or 'failed'
            // Those broad patterns were causing false positives (e.g., "I fixed the error" would trigger login widget)
            const lowerSummary = summary.toLowerCase();
            const isAuthenticationError = (
              lowerSummary.includes('invalid api key') ||
              lowerSummary.includes('please run /login') ||
              // Match "401 unauthorized" or "unauthorized error" but not just "unauthorized" alone
              lowerSummary.includes('401 unauthorized') ||
              lowerSummary.includes('unauthorized error') ||
              lowerSummary.includes('oauth token has expired') ||
              lowerSummary.includes('token has expired') ||
              lowerSummary.includes('expired token') ||
              lowerSummary.includes('please obtain a new token') ||
              lowerSummary.includes('refresh your existing token') ||
              lowerSummary.includes('authentication_error') ||
              lowerSummary.includes('authentication required') ||
              // Match "/login" only at word boundary (not in URLs like "example.com/login-page")
              /\b\/login\b/.test(lowerSummary)
            );

            if (isAuthenticationError) {
              console.error('[CLAUDE-CODE] Authentication error detected in summary:', summary);
              console.error('[CLAUDE-CODE] Full summary chunk:', JSON.stringify(chunk, null, 2));

              // Pass through the error message directly
              // The LoginRequiredWidget in MessageSegment will handle displaying a proper UI
              const errorMessage = summary;

              // Log error to database (as 'output' since errors are provider responses)
              this.logError(sessionId, 'claude-code', new Error(errorMessage), 'summary_chunk', 'authentication_error', hideMessages);

              // Yield error to UI with isAuthError flag for structured detection
              yield {
                type: 'error',
                error: errorMessage,
                isAuthError: true
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
                `[Claude Agent]: ${summary}` :
                `[Claude Agent]: ${JSON.stringify(chunk)}`;

              yield {
                type: 'text',
                content: displayMessage
              };
            }
          } else if (chunk.type === 'auth_status') {
            // Handle SDK auth status messages (first-class authentication detection)
            // This is the preferred way to detect auth issues rather than string matching
            if (chunk.error || chunk.isAuthenticating === false) {
              const errorMessage = chunk.error || 'Authentication required';
              console.error('[CLAUDE-CODE] Auth status error:', errorMessage);
              this.logError(sessionId, 'claude-code', new Error(errorMessage), 'auth_status_chunk', 'authentication_error', hideMessages);
              yield {
                type: 'error',
                error: errorMessage,
                isAuthError: true
              };
              // Don't break here - auth_status might be informational during auth flow
            }
            // Log auth output for debugging (but don't display to user)
            if (chunk.output && chunk.output.length > 0) {
              console.log('[CLAUDE-CODE] Auth status output:', chunk.output.join('\n'));
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

      // Check if this was a slash command that returned no output
      // This helps users understand when a command doesn't exist or failed silently
      // Skip this check if we received a compact_boundary (compact outputs via system message, not fullContent)
      if (isSlashCommand && fullContent.trim().length === 0 && toolCallCount === 0 && !receivedCompactBoundary) {
        // Extract the command name from the message for the error message
        const commandMatch = message.trimStart().match(/^\/(\S+)/);
        const commandName = commandMatch ? commandMatch[1] : 'unknown';

        const errorMessage = `The command "/${commandName}" did not produce any output. This command may not exist or may have failed silently. Try typing "/" to see available commands.`;
        console.error(`[CLAUDE-CODE] Slash command /${commandName} returned no output`);

        // Log error to database for persistence
        // The logError call saves the message to the database and emits 'message:logged'
        // which triggers a session reload in the UI, displaying the error
        // Do NOT yield an error chunk here - that would cause duplicate display via ai:error IPC
        // Pass hideMessages so /context errors (auto-triggered) stay hidden
        this.logError(sessionId, 'claude-code', new Error(errorMessage), 'slash_command', 'slash_command_error', hideMessages);
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

      // Calculate total input/output tokens from modelUsage if available (more accurate than usageData)
      let totalInputTokens = usageData?.input_tokens || 0;
      let totalOutputTokens = usageData?.output_tokens || 0;
      let totalCostUSD = 0;

      if (modelUsageData) {
        // Sum up tokens from all models (in case multiple models were used)
        totalInputTokens = 0;
        totalOutputTokens = 0;
        for (const modelName of Object.keys(modelUsageData)) {
          const modelStats = modelUsageData[modelName];
          totalInputTokens += modelStats.inputTokens || 0;
          totalOutputTokens += modelStats.outputTokens || 0;
          totalCostUSD += modelStats.costUSD || 0;
        }
      }

      yield {
        type: 'complete',
        // Don't send content here - it's already been sent in chunks
        // The AIService accumulates the chunks itself
        isComplete: true,
        ...(usageData || modelUsageData ? {
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            cache_read_input_tokens: usageData?.cache_read_input_tokens || 0,
            cache_creation_input_tokens: usageData?.cache_creation_input_tokens || 0,
            total_tokens: totalInputTokens + totalOutputTokens
          }
        } : {}),
        // Include modelUsage for detailed per-model breakdown and cost tracking
        ...(modelUsageData ? { modelUsage: modelUsageData } : {})
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
          this.logError(sessionId, 'claude-code', error, 'catch_block', 'exception', hideMessages);
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
      // Note: markMessagesAsHidden is reset at the START of sendMessage to prevent race conditions
    }
  }

  abort(): void {
    console.log('[CLAUDE-CODE] Abort called, abortController:', this.abortController ? 'exists' : 'NULL');
    if (this.abortController) {
      console.log('[CLAUDE-CODE] Aborting active request');
      this.abortController.abort();
      this.abortController = null;
    } else {
      console.warn('[CLAUDE-CODE] No active request to abort - abortController is null!');
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
      resumeSession: true,  // Can resume Claude Code sessions
      supportsFileTools: true  // Uses tools to access files (Read, Glob, etc.)
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

  /**
   * Resolve a pending AskUserQuestion request with user's answers
   * Called by IPC handler when renderer provides answers
   * @param sessionId - Session ID for persisting the response message
   * @param respondedBy - Device that responded ('desktop' or 'mobile')
   */
  public resolveAskUserQuestion(
    questionId: string,
    answers: Record<string, string>,
    sessionId?: string,
    respondedBy: 'desktop' | 'mobile' = 'desktop'
  ): void {
    const pending = this.pendingAskUserQuestions.get(questionId);
    if (pending) {
      pending.resolve(answers);
      this.pendingAskUserQuestions.delete(questionId);

      // Persist the response as a message for sync and audit trail
      if (sessionId) {
        const responseContent: AskUserQuestionResponseContent = {
          type: 'ask_user_question_response',
          questionId,
          answers,
          respondedAt: Date.now(),
          respondedBy,
        };
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify(responseContent),
          { messageType: 'ask_user_question_response' }
        ).catch(err => {
          console.error('[CLAUDE-CODE] Failed to persist AskUserQuestion response:', err);
        });
      }
      // Debug logging - uncomment if needed
      // console.log(`[CLAUDE-CODE] AskUserQuestion resolved for ID: ${questionId}`);
    } else {
      console.warn(`[CLAUDE-CODE] No pending AskUserQuestion found for questionId: ${questionId}`);
    }
  }

  /**
   * Reject a pending AskUserQuestion request (e.g., on cancel/abort)
   */
  public rejectAskUserQuestion(questionId: string, error: Error): void {
    const pending = this.pendingAskUserQuestions.get(questionId);
    if (pending) {
      pending.reject(error);
      this.pendingAskUserQuestions.delete(questionId);

      // Extract sessionId from questionId (format: ask-{sessionId}-{timestamp})
      const sessionIdMatch = questionId.match(/^ask-(.+)-\d+$/);
      const sessionId = sessionIdMatch?.[1];

      // Persist cancelled response for sync (so mobile knows it was cancelled)
      if (sessionId && sessionId !== 'unknown') {
        const responseContent: AskUserQuestionResponseContent = {
          type: 'ask_user_question_response',
          questionId,
          answers: {},
          cancelled: true,
          respondedAt: Date.now(),
          respondedBy: 'desktop',
        };
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify(responseContent),
          { messageType: 'ask_user_question_response' }
        ).catch(err => {
          console.error('[CLAUDE-CODE] Failed to persist AskUserQuestion cancel:', err);
        });
      }
    }
  }

  /**
   * Reject all pending AskUserQuestion requests (e.g., on abort)
   */
  public rejectAllPendingQuestions(): void {
    for (const [questionId, pending] of this.pendingAskUserQuestions) {
      pending.reject(new Error('Request aborted'));
    }
    this.pendingAskUserQuestions.clear();
  }

  /**
   * Resolve a pending Bash permission request with user's response
   * Called by IPC handler when renderer provides a permission response
   * @param sessionId - Session ID for persisting the response message
   * @param respondedBy - Device that responded ('desktop' or 'mobile')
   */
  public resolveToolPermission(
    requestId: string,
    response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' },
    sessionId?: string,
    respondedBy: 'desktop' | 'mobile' = 'desktop'
  ): void {
    const pending = this.pendingToolPermissions.get(requestId);
    if (pending) {
      pending.resolve(response);
      this.pendingToolPermissions.delete(requestId);

      // Persist the response as a message for sync and audit trail
      if (sessionId) {
        const responseContent: PermissionResponseContent = {
          type: 'permission_response',
          requestId,
          decision: response.decision,
          scope: response.scope,
          respondedAt: Date.now(),
          respondedBy,
        };
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify(responseContent),
          { messageType: 'permission_response' }
        ).catch(err => {
          console.error('[CLAUDE-CODE] Failed to persist permission response:', err);
        });
      }
      // console.log(`[CLAUDE-CODE] Tool permission resolved for ID: ${requestId}`);
    } else {
      console.warn(`[CLAUDE-CODE] No pending tool permission found for requestId: ${requestId}`);
    }
  }

  /**
   * Reject a pending tool permission request (e.g., on cancel/abort)
   */
  public rejectToolPermission(requestId: string, error: Error): void {
    const pending = this.pendingToolPermissions.get(requestId);
    if (pending) {
      pending.reject(error);
      this.pendingToolPermissions.delete(requestId);
    }
  }

  /**
   * Reject all pending tool permission requests (e.g., on abort)
   */
  public rejectAllPendingPermissions(): void {
    for (const [requestId, pending] of this.pendingToolPermissions) {
      pending.reject(new Error('Request aborted'));
    }
    this.pendingToolPermissions.clear();
  }

  /**
   * Poll for a permission response message in the session.
   * This enables mobile and cross-session responses.
   * When a response is found, it resolves the pending permission promise.
   */
  private async pollForPermissionResponse(
    sessionId: string,
    requestId: string,
    signal: AbortSignal
  ): Promise<void> {
    const pollInterval = 500; // ms
    const maxPollTime = 10 * 60 * 1000; // 10 minutes max
    const startTime = Date.now();

    while (!signal.aborted && Date.now() - startTime < maxPollTime) {
      // Check if request was already resolved (e.g., via IPC)
      if (!this.pendingToolPermissions.has(requestId)) {
        return; // Already resolved, stop polling
      }

      try {
        // Get recent messages for this session
        const messages = await AgentMessagesRepository.list(sessionId, { limit: 50 });

        // Look for a permission_response that matches our requestId
        for (const msg of messages) {
          try {
            const content = JSON.parse(msg.content);
            if (content.type === 'permission_response' && content.requestId === requestId) {
              // Found a response - resolve the pending promise
              const response: PermissionResponseContent = content;
              const pending = this.pendingToolPermissions.get(requestId);
              if (pending) {
                pending.resolve({
                  decision: response.decision,
                  scope: response.scope
                });
                this.pendingToolPermissions.delete(requestId);
                this.logSecurity('[pollForPermissionResponse] Found response message:', {
                  requestId,
                  decision: response.decision,
                  scope: response.scope,
                  respondedBy: response.respondedBy
                });
              }
              return;
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      } catch (error) {
        // Log but continue polling
        console.error('[CLAUDE-CODE] Error polling for permission response:', error);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout - don't reject, let IPC path handle it or let it stay pending
    this.logSecurity('[pollForPermissionResponse] Polling timed out:', { requestId });
  }

  /**
   * Poll for an AskUserQuestion response message in the session.
   * This enables mobile and cross-session responses.
   * When a response is found, it resolves the pending question promise.
   */
  private async pollForAskUserQuestionResponse(
    sessionId: string,
    questionId: string,
    signal: AbortSignal
  ): Promise<void> {
    const pollInterval = 500; // ms
    const maxPollTime = 10 * 60 * 1000; // 10 minutes max
    const startTime = Date.now();

    while (!signal.aborted && Date.now() - startTime < maxPollTime) {
      // Check if request was already resolved (e.g., via IPC)
      if (!this.pendingAskUserQuestions.has(questionId)) {
        return; // Already resolved, stop polling
      }

      try {
        // Get recent messages for this session
        const messages = await AgentMessagesRepository.list(sessionId, { limit: 50 });

        // Look for an ask_user_question_response that matches our questionId
        for (const msg of messages) {
          try {
            const content = JSON.parse(msg.content);
            if (content.type === 'ask_user_question_response' && content.questionId === questionId) {
              // Found a response
              const response: AskUserQuestionResponseContent = content;
              const pending = this.pendingAskUserQuestions.get(questionId);
              if (pending) {
                if (response.cancelled) {
                  // User cancelled - reject the promise
                  pending.reject(new Error('User cancelled the question'));
                  this.pendingAskUserQuestions.delete(questionId);
                  this.logSecurity('[pollForAskUserQuestionResponse] Question cancelled:', {
                    questionId,
                    respondedBy: response.respondedBy
                  });
                } else {
                  // Normal response - resolve with answers
                  pending.resolve(response.answers);
                  this.pendingAskUserQuestions.delete(questionId);
                  this.logSecurity('[pollForAskUserQuestionResponse] Found response message:', {
                    questionId,
                    answersCount: Object.keys(response.answers).length,
                    respondedBy: response.respondedBy
                  });
                }
              }
              return;
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      } catch (error) {
        // Log but continue polling
        console.error('[CLAUDE-CODE] Error polling for AskUserQuestion response:', error);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout - don't reject, let IPC path handle it or let it stay pending
    this.logSecurity('[pollForAskUserQuestionResponse] Polling timed out:', { questionId });
  }

  private async getMcpServersConfig(sessionId?: string, workspacePath?: string) {
    // Load MCP servers from user config (~/.config/claude/mcp.json) and workspace config (.mcp.json)
    // and merge with built-in Nimbalyst MCP servers
    const config: any = {};

    // Include shared MCP server if it's started (provides capture_mockup_screenshot tool only)
    // applyDiff and streamContent are NOT exposed via MCP - they're only for chat providers via IPC
    if (ClaudeCodeProvider.mcpServerPort !== null && workspacePath) {
      config['nimbalyst-mcp'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${ClaudeCodeProvider.mcpServerPort}/mcp?workspacePath=${encodeURIComponent(workspacePath)}`
      };
      // console.log('[CLAUDE-CODE] Shared MCP server configured on port', ClaudeCodeProvider.mcpServerPort, 'for workspace', workspacePath);
    }

    // Include session naming MCP server if it's started
    if (ClaudeCodeProvider.sessionNamingServerPort !== null && sessionId) {
      config['nimbalyst-session-naming'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${ClaudeCodeProvider.sessionNamingServerPort}/mcp?sessionId=${encodeURIComponent(sessionId)}`
      };
      // console.log('[CLAUDE-CODE] Session naming MCP server configured on port', ClaudeCodeProvider.sessionNamingServerPort, 'for session', sessionId);
    }

    // Include extension dev MCP server if it's started (provides build, install, reload tools)
    if (ClaudeCodeProvider.extensionDevServerPort !== null) {
      const params = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      config['nimbalyst-extension-dev'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${ClaudeCodeProvider.extensionDevServerPort}/mcp${params}`
      };
      console.log('[CLAUDE-CODE] Extension dev MCP server configured on port', ClaudeCodeProvider.extensionDevServerPort);
    }

    // Load user and workspace MCP servers using the injected loader (if available)
    // This merges user-level (global) servers with workspace-level servers
    if (ClaudeCodeProvider.mcpConfigLoader) {
      try {
        const mergedServers = await ClaudeCodeProvider.mcpConfigLoader(workspacePath);
        // console.log('[CLAUDE-CODE] Loaded MCP servers from config loader:', Object.keys(mergedServers));

        // Process each server config
        for (const [serverName, serverConfig] of Object.entries(mergedServers)) {
          const processedConfig = this.processServerConfig(serverName, serverConfig as any);
          config[serverName] = processedConfig;
        }
      } catch (error) {
        console.error('[CLAUDE-CODE] Failed to load MCP servers from config loader:', error);
        // Fall back to workspace-only loading
        await this.loadWorkspaceMcpServers(workspacePath, config);
      }
    } else {
      // Fallback: Load from workspace .mcp.json only (legacy behavior)
      await this.loadWorkspaceMcpServers(workspacePath, config);
    }

    return config;
  }

  /**
   * Process a single MCP server config, expanding env vars and converting to headers where needed
   */
  private processServerConfig(serverName: string, serverConfig: any): any {
    const processedConfig = { ...serverConfig };

    // Build combined env: process.env + config.env (config.env takes precedence)
    const combinedEnv: Record<string, string | undefined> = {
      ...process.env as Record<string, string | undefined>
    };
    if (processedConfig.env) {
      for (const [key, value] of Object.entries(processedConfig.env)) {
        combinedEnv[key] = this.expandEnvVar(value as string, combinedEnv);
      }
    }

    // For stdio transport, expand env vars in args
    // This is critical for Windows where shell doesn't expand ${VAR} syntax
    if (processedConfig.type !== 'sse' && processedConfig.args && Array.isArray(processedConfig.args)) {
      processedConfig.args = processedConfig.args.map((arg: string) =>
        typeof arg === 'string' ? this.expandEnvVar(arg, combinedEnv) : arg
      );
    }

    // For SSE transport, convert env vars to headers (SDK requirement)
    if (processedConfig.type === 'sse' && processedConfig.env) {
      processedConfig.headers = processedConfig.headers || {};

      // Convert API keys from env to Authorization headers
      for (const [key, value] of Object.entries(processedConfig.env)) {
        if (key.endsWith('_API_KEY')) {
          // Expand environment variable if needed
          const expandedValue = this.expandEnvVar(value as string, process.env as Record<string, string | undefined>);
          if (expandedValue && !expandedValue.startsWith('${')) {
            processedConfig.headers['Authorization'] = `Bearer ${expandedValue}`;
          }
        }
      }

      // Remove env from SSE config (not used for SSE transport)
      delete processedConfig.env;
    }

    return processedConfig;
  }

  /**
   * Load MCP servers from workspace .mcp.json only (legacy fallback)
   */
  private async loadWorkspaceMcpServers(workspacePath: string | undefined, config: any): Promise<void> {
    if (!workspacePath) return;

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
            const processedConfig = this.processServerConfig(serverName, serverConfig as any);
            config[serverName] = processedConfig;
          }
        }
      }
    } catch (error) {
      console.error('[CLAUDE-CODE] Failed to load .mcp.json:', error);
    }
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
   * Build a human-readable description of a tool call for permission checking.
   * For Bash, the command itself is used. For other tools, we create a descriptive string.
   */
  private buildToolDescription(toolName: string, input: any): string {
    switch (toolName) {
      case 'Read':
        return input?.file_path ? `read ${input.file_path}` : '';
      case 'Write':
        return input?.file_path ? `write ${input.file_path}` : '';
      case 'Edit':
        return input?.file_path ? `edit ${input.file_path}` : '';
      case 'MultiEdit':
        return input?.edits?.length ? `multi-edit ${input.edits.length} files` : '';
      case 'Glob':
        return input?.pattern ? `glob ${input.pattern}` : '';
      case 'Grep':
        return input?.pattern ? `grep ${input.pattern}` : '';
      case 'Task':
        return input?.description || input?.prompt?.slice(0, 50) || 'spawn task';
      case 'WebFetch':
        return input?.url ? `fetch ${input.url}` : '';
      case 'WebSearch':
        return input?.query ? `search "${input.query}"` : '';
      case 'TodoWrite':
        return 'update todos';
      case 'KillShell':
        return input?.shell_id ? `kill shell ${input.shell_id}` : '';
      case 'MCPSearch':
        return input?.query ? `search MCP tools: ${input.query}` : '';
      default:
        // For MCP tools (mcp__*) and other unknown tools, create a generic description
        if (toolName.startsWith('mcp__')) {
          const parts = toolName.split('__');
          const serverName = parts[1] || 'unknown';
          const mcpToolName = parts[2] || 'unknown';
          return `${serverName}:${mcpToolName}`;
        }
        // For completely unknown tools, just return the tool name
        return toolName;
    }
  }

  /**
   * Check if a command contains shell chaining operators (&&, ||, ;)
   * Uses shell-quote library for proper parsing that handles quotes and heredocs
   */
  private hasShellChainingOperators(command: string): boolean {
    try {
      const parsed = parseShellCommand(command);
      // shell-quote returns operators as { op: '&&' } objects
      return parsed.some(token =>
        typeof token === 'object' &&
        token !== null &&
        'op' in token &&
        ['&&', '||', ';'].includes(token.op)
      );
    } catch {
      // If parsing fails, fall back to simple regex (less accurate but safe)
      return /\s*&&\s*|\s*\|\|\s*|\s*;\s*/.test(command);
    }
  }

  /**
   * Split a command on shell chaining operators (&&, ||, ;)
   * Uses shell-quote library for proper parsing that handles quotes and heredocs
   * Returns array of individual commands
   */
  private splitOnShellOperators(command: string): string[] {
    try {
      const parsed = parseShellCommand(command);
      const commands: string[] = [];
      let currentTokens: string[] = [];

      for (const token of parsed) {
        if (typeof token === 'object' && token !== null && 'op' in token) {
          // This is an operator
          if (['&&', '||', ';'].includes(token.op)) {
            // Chaining operator - flush current command
            if (currentTokens.length > 0) {
              commands.push(currentTokens.join(' '));
              currentTokens = [];
            }
          } else {
            // Other operators (|, >, <, etc.) - keep as part of current command
            currentTokens.push(token.op);
          }
        } else if (typeof token === 'string') {
          currentTokens.push(token);
        }
        // Skip other token types (comments, etc.)
      }

      // Don't forget the last command
      if (currentTokens.length > 0) {
        commands.push(currentTokens.join(' '));
      }

      return commands.length > 0 ? commands : [command];
    } catch {
      // If parsing fails, return original command as single element
      return [command];
    }
  }

  /**
   * Generate a tool pattern for Claude Code's allowedTools format.
   * These patterns are written to .claude/settings.local.json when user approves with "Always".
   *
   * Pattern strategy:
   * - git: include subcommand for granularity (git diff, git commit, etc.)
   * - npm/npx: include subcommand (npm run, npm test, npx vitest, etc.)
   * - everything else: just base command (ls, cat, grep, etc.)
   *
   * We never include paths/filenames - patterns match any invocation of the command.
   */
  private generateToolPattern(toolName: string, input: any): string {
    switch (toolName) {
      case 'Bash': {
        const command = (input?.command as string) || '';

        // Detect compound commands - these should not be cached
        // because approving "git add" shouldn't auto-approve "git add && git commit"
        // Use quote-aware detection to avoid false positives on heredocs/quoted strings
        if (this.hasShellChainingOperators(command)) {
          // Return a unique pattern that won't match future commands
          return `Bash:compound:${Date.now()}`;
        }

        const words = command.trim().split(/\s+/);

        if (words.length === 0 || !words[0]) {
          return 'Bash';
        }

        const baseCommand = words[0];

        // For git, find the subcommand (skip flags like -C, --no-pager)
        // "git -C /path diff" -> "Bash(git diff:*)"
        // "git commit -m 'msg'" -> "Bash(git commit:*)"
        if (baseCommand === 'git') {
          for (let i = 1; i < words.length; i++) {
            const word = words[i];
            if (word.startsWith('-')) {
              // Skip flags that take arguments
              if (['-C', '-c', '--git-dir', '--work-tree'].includes(word)) {
                i++;
              }
              continue;
            }
            // First non-flag is the subcommand
            return `Bash(git ${word}:*)`;
          }
          return `Bash(git:*)`;
        }

        // For npm/npx, find the subcommand (skip flags like --prefix)
        if (baseCommand === 'npm' || baseCommand === 'npx') {
          for (let i = 1; i < words.length; i++) {
            const word = words[i];
            if (word.startsWith('-')) {
              if (['--prefix', '-w', '--workspace'].includes(word)) {
                i++;
              }
              continue;
            }
            return `Bash(${baseCommand} ${word}:*)`;
          }
          return `Bash(${baseCommand}:*)`;
        }

        // For everything else, just the base command
        // "ls -la /some/path" -> "Bash(ls:*)"
        // "cat /etc/passwd" -> "Bash(cat:*)"
        return `Bash(${baseCommand}:*)`;
      }

      case 'WebFetch': {
        // Extract domain for pattern matching
        const url = (input?.url as string) || '';
        try {
          const parsedUrl = new URL(url);
          return `WebFetch(domain:${parsedUrl.hostname})`;
        } catch {
          return 'WebFetch';
        }
      }

      case 'WebSearch':
        return 'WebSearch';

      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'Glob':
      case 'Grep':
      case 'LS':
      case 'TodoRead':
      case 'TodoWrite':
      case 'Task':
      case 'NotebookRead':
      case 'NotebookEdit':
      case 'ExitPlanMode':
        return toolName;

      default:
        // MCP tools: mcp__server__tool - use as-is
        if (toolName.startsWith('mcp__')) {
          return toolName;
        }
        return toolName;
    }
  }

  /**
   * Create canUseTool handler for permission requests.
   * The SDK evaluates settings.json rules first. This handler is only called when:
   * 1. No matching rule was found in settings.json
   * 2. The tool needs user approval
   *
   * Our job is to show UI, wait for user response, and save patterns if "Always" is chosen.
   */
  private createCanUseToolHandler(sessionId?: string, workspacePath?: string) {
    return async (
      toolName: string,
      input: any,
      options: { signal: AbortSignal; suggestions?: any[] }
    ): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }> => {
      // Log all tool permission checks
      this.logSecurity('[canUseTool] Tool call received:', {
        toolName,
        workspacePath: workspacePath?.slice(-30),
      });

      // Internal Nimbalyst MCP tools that should always be allowed without permission prompts
      const internalMcpTools = [
        'mcp__nimbalyst-session-naming__name_session',
        'mcp__nimbalyst-mcp__capture_mockup_screenshot',
        'mcp__nimbalyst-mcp__capture_editor_screenshot',
      ];

      if (internalMcpTools.includes(toolName)) {
        this.logSecurity('[canUseTool] Auto-allowing internal MCP tool:', { toolName });
        return { behavior: 'allow', updatedInput: input };
      }

      // Handle AskUserQuestion separately - it's about getting user input, not permission
      if (toolName === 'AskUserQuestion') {
        return this.handleAskUserQuestion(sessionId, input, options);
      }

      // Check workspace trust before allowing any tools
      if (workspacePath && ClaudeCodeProvider.trustChecker) {
        const trustStatus = ClaudeCodeProvider.trustChecker(workspacePath);
        if (!trustStatus.trusted) {
          this.logSecurity('[canUseTool] Workspace not trusted, denying tool:', { toolName });
          return {
            behavior: 'deny',
            message: 'Workspace is not trusted. Please trust the workspace to use AI tools.'
          };
        }

        // Bypass-all mode: auto-approve everything without prompting
        // This is dangerous and should only be used for testing or trusted environments
        if (trustStatus.mode === 'bypass-all') {
          this.logSecurity('[canUseTool] Bypass-all mode, auto-approving:', { toolName });
          return { behavior: 'allow', updatedInput: input };
        }

        // Allow-all mode: auto-approve file edit operations without prompting
        // Bash commands and web requests still require approval
        if (trustStatus.mode === 'allow-all') {
          const fileEditTools = ['Edit', 'Write', 'MultiEdit', 'Read', 'Glob', 'Grep', 'LS', 'NotebookEdit'];
          if (fileEditTools.includes(toolName)) {
            this.logSecurity('[canUseTool] Allow-all mode, auto-approving file tool:', { toolName });
            return { behavior: 'allow', updatedInput: input };
          }
        }
      }

      // The SDK has already evaluated settings.json rules.
      // If we're here, it means the SDK needs user approval for this tool.

      // Check session-level cache first - if user already approved this pattern in this session,
      // auto-approve without prompting again (SDK doesn't hot-reload settings files mid-session)
      const pattern = this.generateToolPattern(toolName, input);
      if (this.sessionApprovedPatterns.has(pattern)) {
        this.logSecurity('[canUseTool] Pattern already approved this session:', { pattern, toolName });
        return { behavior: 'allow', updatedInput: input };
      }
      // Also check for wildcard patterns (e.g., 'WebFetch' matches any WebFetch call)
      if (toolName === 'WebFetch' && this.sessionApprovedPatterns.has('WebFetch')) {
        this.logSecurity('[canUseTool] WebFetch wildcard approved this session:', { toolName });
        return { behavior: 'allow', updatedInput: input };
      }

      // Show permission UI and wait for user response.
      const requestId = `tool-${sessionId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toolDescription = this.buildToolDescription(toolName, input);
      const isDestructive = ['Write', 'Edit', 'MultiEdit', 'Bash'].includes(toolName);
      const rawCommand = toolName === 'Bash' ? input?.command || '' : toolDescription;
      const patternDisplay = getPatternDisplayName(pattern);

      this.logSecurity('[canUseTool] Showing permission prompt:', {
        toolName,
        toolDescription: toolDescription.slice(0, 100),
        requestId,
      });

      // Create the permission request content for persisting as a message
      const permissionRequestContent: PermissionRequestContent = {
        type: 'permission_request',
        requestId,
        toolName,
        rawCommand,
        pattern,
        patternDisplayName: patternDisplay,
        isDestructive,
        warnings: [],
        timestamp: Date.now(),
        status: 'pending',
      };

      // Persist permission request as a message for mobile compatibility
      // This allows any device (desktop or mobile) to see and respond to the request
      if (sessionId) {
        await this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify(permissionRequestContent),
          { messageType: 'permission_request' }
        );
      }

      // Create a simplified permission request for the legacy UI (backwards compatibility)
      const request = {
        id: requestId,
        toolName,
        rawCommand,
        actionsNeedingApproval: [{
          action: {
            pattern, // The actual pattern (e.g., 'Bash(git commit:*)') for display and saving
            displayName: toolDescription,
            command: toolName === 'Bash' ? input?.command || '' : '',
            isDestructive,
            referencedPaths: [],
            hasRedirection: false,
          },
          decision: 'ask' as const,
          reason: 'Tool requires user approval',
          isDestructive,
          isRisky: toolName === 'Bash',
          warnings: [],
          outsidePaths: [],
          sensitivePaths: [],
        }],
        hasDestructiveActions: isDestructive,
        createdAt: Date.now(),
      };

      // Create promise that will be resolved when user responds
      // Response can come from either IPC (desktop) or message polling (mobile/cross-session)
      const responsePromise = new Promise<{ decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' }>((resolve, reject) => {
        this.pendingToolPermissions.set(requestId, {
          resolve,
          reject,
          request
        });

        // Set up abort handler
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            this.pendingToolPermissions.delete(requestId);
            reject(new Error('Request aborted'));
          }, { once: true });
        }
      });

      // Start polling for message-based responses in parallel with IPC
      // This enables mobile/cross-session responses
      if (sessionId) {
        this.pollForPermissionResponse(sessionId, requestId, options.signal).catch(() => {
          // Polling error - IPC path may still work
        });
      }

      // Emit event to notify renderer to show permission UI (legacy IPC path)
      this.emit('toolPermission:pending', {
        requestId,
        sessionId,
        workspacePath,
        request,
        timestamp: Date.now()
      });

      try {
        // Wait for user to respond (via IPC or message polling)
        const response = await responsePromise;

        this.logSecurity('[canUseTool] User response received:', {
          toolName,
          decision: response.decision,
          scope: response.scope,
        });

        // Cache approval for this session (for 'session', 'always', and 'always-all' scopes)
        // This prevents re-prompting since the SDK doesn't hot-reload settings mid-session
        // Skip caching compound commands - they must be approved each time
        const isCompoundCommand = pattern.startsWith('Bash:compound:');
        if (response.decision === 'allow' && response.scope !== 'once' && !isCompoundCommand) {
          if (response.scope === 'always-all' && toolName === 'WebFetch') {
            // For "Allow All WebFetches", cache a wildcard pattern
            this.sessionApprovedPatterns.add('WebFetch');
            this.logSecurity('[canUseTool] Added wildcard pattern to session cache:', { pattern: 'WebFetch', scope: response.scope });
          } else {
            this.sessionApprovedPatterns.add(pattern);
            this.logSecurity('[canUseTool] Added pattern to session cache:', { pattern, scope: response.scope });
          }
        }

        // If user approved with "Always" or "Always All", save the pattern to .claude/settings.local.json
        // Skip saving compound commands - they can't be meaningfully cached
        if (response.decision === 'allow' && (response.scope === 'always' || response.scope === 'always-all') && workspacePath && !isCompoundCommand) {
          if (ClaudeCodeProvider.claudeSettingsPatternSaver) {
            try {
              // For "Always All WebFetches", save the wildcard pattern
              const patternToSave = (response.scope === 'always-all' && toolName === 'WebFetch') ? 'WebFetch' : pattern;
              await ClaudeCodeProvider.claudeSettingsPatternSaver(workspacePath, patternToSave);
              this.logSecurity('[canUseTool] Saved pattern to Claude settings:', { pattern: patternToSave });
            } catch (saveError) {
              console.error('[CLAUDE-CODE] Failed to save pattern:', saveError);
              // Don't fail the tool call if saving fails
            }
          }
        }

        // Emit event so UI can update
        this.emit('toolPermission:resolved', {
          requestId,
          sessionId,
          response,
          timestamp: Date.now()
        });

        if (response.decision === 'allow') {
          return { behavior: 'allow', updatedInput: input };
        } else {
          return {
            behavior: 'deny',
            message: 'Tool call denied by user'
          };
        }
      } catch (error) {
        this.logSecurity('[canUseTool] Permission request failed:', {
          toolName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return {
          behavior: 'deny',
          message: error instanceof Error ? error.message : 'Permission request cancelled'
        };
      }
    };
  }

  /**
   * Handle AskUserQuestion tool - get user input for questions
   */
  private async handleAskUserQuestion(
    sessionId: string | undefined,
    input: any,
    options: { signal: AbortSignal }
  ): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }> {
      // Debug logging - uncomment if needed
      // console.log('[CLAUDE-CODE] AskUserQuestion tool invoked, waiting for user answers');

      const questions = input?.questions || [];
      if (questions.length === 0) {
        console.warn('[CLAUDE-CODE] AskUserQuestion called with no questions');
        return {
          behavior: 'allow',
          updatedInput: {
            ...input,
            answers: {}
          }
        };
      }

      // Generate unique ID for this question set
      const questionId = `ask-${sessionId || 'unknown'}-${Date.now()}`;

      // Create the AskUserQuestion request content for persisting as a message
      const askUserQuestionContent: AskUserQuestionRequestContent = {
        type: 'ask_user_question_request',
        questionId,
        questions,
        timestamp: Date.now(),
        status: 'pending',
      };

      // Persist the question request as a message for mobile compatibility
      // This allows any device (desktop or mobile) to see and respond to the questions
      if (sessionId) {
        await this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify(askUserQuestionContent),
          { messageType: 'ask_user_question_request' }
        );
      }

      // Create promise that will be resolved when user provides answers
      const answersPromise = new Promise<Record<string, string>>((resolve, reject) => {
        this.pendingAskUserQuestions.set(questionId, {
          resolve,
          reject,
          questions
        });

        // Set up abort handler
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            this.pendingAskUserQuestions.delete(questionId);
            reject(new Error('Request aborted'));
          }, { once: true });
        }
      });

      // Start polling for message-based responses in parallel with IPC
      // This enables mobile/cross-session responses
      if (sessionId) {
        this.pollForAskUserQuestionResponse(sessionId, questionId, options.signal).catch(() => {
          // Polling error - IPC path may still work
        });
      }

      // Emit event to notify renderer to show question UI (legacy IPC path)
      // The widget will be rendered when the tool_use block is processed
      // We store the questionId so the widget knows which pending question to resolve
      this.emit('askUserQuestion:pending', {
        questionId,
        sessionId,
        questions,
        timestamp: Date.now()
      });

      try {
        // Wait for user to provide answers
        const answers = await answersPromise;

        // Debug logging - uncomment if needed
        // console.log('[CLAUDE-CODE] AskUserQuestion answered:', answers);

        // Emit event with answers so UI can update the tool call display
        this.emit('askUserQuestion:answered', {
          questionId,
          sessionId,
          questions,
          answers,
          timestamp: Date.now()
        });

        // Return with answers populated
        return {
          behavior: 'allow',
          updatedInput: {
            ...input,
            answers
          }
        };
      } catch (error) {
        console.error('[CLAUDE-CODE] AskUserQuestion failed:', error);

        // On abort/error, deny the tool use
        return {
          behavior: 'deny',
          message: error instanceof Error ? error.message : 'Question cancelled'
        };
      }
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

      // SECURITY: Check each part of compound Bash commands separately
      // Claude's pattern matching (e.g., Bash(git add:*)) can be bypassed with chained commands
      // like "git add file && rm -rf /". PreToolUse runs BEFORE SDK's allow rules, so we can catch this.
      // See: https://github.com/anthropics/claude-code/issues/4956
      if (toolName === 'Bash') {
        // In bypass-all mode, skip compound command checking entirely
        if (workspacePath && ClaudeCodeProvider.trustChecker) {
          const trustStatus = ClaudeCodeProvider.trustChecker(workspacePath);
          if (trustStatus.trusted && trustStatus.mode === 'bypass-all') {
            this.logSecurity(`[PreToolUse] Bypass-all mode, skipping compound command check`);
            return {};
          }
        }

        const command = (toolInput?.command as string) || '';
        // Use quote-aware detection to avoid false positives on heredocs/quoted strings
        if (this.hasShellChainingOperators(command)) {
          this.logSecurity(`[PreToolUse] Compound Bash command detected, checking each part:`, { command: command.slice(0, 100) });

          // Split on unquoted &&, ||, ; while respecting quotes and heredocs
          const subCommands = this.splitOnShellOperators(command);

          // Check each sub-command
          for (const subCommand of subCommands) {
            const subPattern = this.generateToolPattern('Bash', { command: subCommand });

            // Skip if already approved in session
            if (this.sessionApprovedPatterns.has(subPattern)) {
              this.logSecurity(`[PreToolUse] Sub-command already approved in session:`, { subCommand: subCommand.slice(0, 50), pattern: subPattern });
              continue;
            }

            // Also check if pattern is in Claude settings file (would be auto-approved by SDK)
            if (workspacePath && ClaudeCodeProvider.claudeSettingsPatternChecker) {
              try {
                const isAllowed = await ClaudeCodeProvider.claudeSettingsPatternChecker(workspacePath, subPattern);
                if (isAllowed) {
                  this.logSecurity(`[PreToolUse] Sub-command allowed by Claude settings:`, { subCommand: subCommand.slice(0, 50), pattern: subPattern });
                  // Add to session cache so we don't check file again
                  this.sessionApprovedPatterns.add(subPattern);
                  continue;
                }
              } catch (e) {
                // If check fails, proceed to ask user
                this.logSecurity(`[PreToolUse] Failed to check Claude settings:`, { error: e });
              }
            }

            // Need to check this sub-command - use our permission flow
            this.logSecurity(`[PreToolUse] Sub-command needs approval:`, { subCommand: subCommand.slice(0, 50), pattern: subPattern });

            const requestId = `compound-${sessionId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const subDescription = `Part of compound command: ${subCommand.slice(0, 60)}${subCommand.length > 60 ? '...' : ''}`;

            // Create permission request for this sub-command
            const request = {
              id: requestId,
              toolName: 'Bash',
              rawCommand: subCommand,
              actionsNeedingApproval: [{
                action: {
                  pattern: subPattern,
                  displayName: subDescription,
                  command: subCommand,
                  isDestructive: true,
                  referencedPaths: [],
                  hasRedirection: false,
                },
                decision: 'ask' as const,
                reason: 'Sub-command of compound command requires approval',
                isDestructive: true,
                isRisky: true,
                warnings: ['This is part of a compound command - each part is checked separately'],
                outsidePaths: [],
                sensitivePaths: [],
              }],
              hasDestructiveActions: true,
              createdAt: Date.now(),
            };

            // Wait for user approval
            const responsePromise = new Promise<{ decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' }>((resolve, reject) => {
              this.pendingToolPermissions.set(requestId, { resolve, reject, request });
            });

            // Emit event to show permission UI
            this.emit('toolPermission:pending', {
              requestId,
              sessionId,
              workspacePath,
              request,
              timestamp: Date.now()
            });

            try {
              const response = await responsePromise;

              if (response.decision === 'deny') {
                this.logSecurity(`[PreToolUse] Sub-command denied:`, { subCommand: subCommand.slice(0, 50) });
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    errorMessage: `Command denied: ${subCommand.slice(0, 50)}`
                  }
                };
              }

              // Cache approval if not 'once'
              if (response.scope !== 'once') {
                this.sessionApprovedPatterns.add(subPattern);
                this.logSecurity(`[PreToolUse] Sub-command approved and cached:`, { pattern: subPattern, scope: response.scope });
              }

              // Save to settings if 'always'
              if (response.scope === 'always' && workspacePath && ClaudeCodeProvider.claudeSettingsPatternSaver) {
                try {
                  await ClaudeCodeProvider.claudeSettingsPatternSaver(workspacePath, subPattern);
                } catch (e) {
                  console.error('[CLAUDE-CODE] Failed to save pattern:', e);
                }
              }
            } catch (error) {
              this.logSecurity(`[PreToolUse] Sub-command permission failed:`, { error });
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'deny' as const,
                  errorMessage: `Permission check failed for: ${subCommand.slice(0, 50)}`
                }
              };
            }
          }

          // All sub-commands approved, allow the compound command
          this.logSecurity(`[PreToolUse] All sub-commands approved, allowing compound command`);
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'allow' as const
            }
          };
        }
      }

      // WebFetch/WebSearch: Let SDK handle via canUseTool
      // The SDK reads settings.json and calls canUseTool when permission is needed
      if (toolName === 'WebFetch' || toolName === 'WebSearch') {
        this.logSecurity(`[PreToolUse] ${toolName} - deferring to SDK/canUseTool`);
        return {};
      }

      // Handle non-file-editing tools (except ExitPlanMode which is handled above)
      // Return empty object to let the request continue through permission flow to canUseTool
      if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'MultiEdit') {
        // console.log(`[CLAUDE-CODE] PreToolUse: Not a file editing tool, deferring to canUseTool`);
        return {};
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

          // Create unique tag ID for this edit
          const actualToolUseId = toolUseID || `tool-${Date.now()}`;

          // Read current file content (if file exists)
          // For new files, we create a pre-edit tag with empty content to enable diff mode
          try {
            fs.readFileSync(filePath, 'utf-8');
            // File exists - tag with current content
            await this.tagFileBeforeEdit(filePath, workspacePath!, sessionId, actualToolUseId);
          } catch (error) {
            // File doesn't exist yet (Write tool creating new file)
            // Create a pre-edit tag with empty content so diff mode shows the full new file
            await this.tagFileBeforeEdit(filePath, workspacePath!, sessionId, actualToolUseId, true);
          }
        }

      } catch (error) {
        console.error('[CLAUDE-CODE] PreToolUse hook error:', error);
        // Don't block the edit if tagging fails
      }

      // Return empty object to let the request continue through permission flow to canUseTool
      // This allows our permission engine to check workspace trust and ask for approval
      return {};
    };
  }

  /**
   * Tag a file's current state before an AI edit
   * @param isNewFile - If true, the file doesn't exist yet (being created), so use empty content
   */
  private async tagFileBeforeEdit(
    filePath: string,
    workspacePath: string,
    sessionId: string | undefined,
    toolUseId: string,
    isNewFile: boolean = false
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
          const existingTag = pendingTags[0];
          const tagAge = Date.now() - existingTag.createdAt.getTime();

          // Check if the pending tag is from the current session
          if (existingTag.sessionId === sessionId) {
            // Same session - skip creating another (existing behavior)
            console.log('[PRE-EDIT SKIP]', JSON.stringify({
              file: path.basename(filePath),
              existingTagAge: tagAge + 'ms',
              existingTagId: existingTag.id,
              reason: 'same_session_tag',
            }));
            return;
          }

          // Different session - clear the old tag and create a new one
          // This prevents edits from multiple sessions accumulating into one diff
          console.log('[PRE-EDIT CLEAR]', JSON.stringify({
            file: path.basename(filePath),
            clearedTagId: existingTag.id,
            clearedSessionId: existingTag.sessionId,
            newSessionId: sessionId,
            reason: 'different_session',
          }));
          await historyManager.updateTagStatus(filePath, existingTag.id, 'reviewed');
        }

        // PRODUCTION LOG: Track when new tag is created
        const tagId = `ai-edit-pending-${sessionId || 'unknown'}-${toolUseId}`;
        console.log('[PRE-EDIT TAG]', JSON.stringify({
          file: path.basename(filePath),
          tagId,
          isNewFile,
        }));

        // Get content: empty for new files, current content for existing files
        const content = isNewFile ? '' : fs.readFileSync(filePath, 'utf-8');

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
        // The sessionId is stored in snapshot metadata so the HistoryDialog can display
        // which AI session made the edit and provide a clickable link to open that session
        try {
          const { historyManager } = await import('../../../../../electron/src/main/HistoryManager');
          await historyManager.createSnapshot(
            filePath,
            finalContent,
            'ai-edit',
            `AI edit turn complete (session: ${sessionId || 'unknown'})`,
            sessionId ? { sessionId } : undefined
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
      let prompt = `You are an AI assistant integrated into the Nimbalyst editor's agentic coding workspace.
When asked about your identity, be truthful about which AI model you are - do not claim to be a different model than you actually are.`;

      // Add session naming instructions if MCP server is available
      if (ClaudeCodeProvider.sessionNamingServerPort !== null) {
        prompt += `

## Session Naming

You have access to a special tool called \`mcp__nimbalyst-session-naming__name_session\` that allows you to name this conversation session.

IMPORTANT: Call the \`mcp__nimbalyst-session-naming__name_session\` tool ONCE at the very start of this conversation, as soon as you understand the user's task or goal. The name should be:
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
    // console.log('[ClaudeCodeProvider.getModels] Building models from CLAUDE_CODE_VARIANTS:', CLAUDE_CODE_VARIANTS);
    const models = CLAUDE_CODE_VARIANTS.map(variant => ({
      id: `claude-code:${variant}`,
      name: `Claude Agent · ${CLAUDE_CODE_MODEL_LABELS[variant]} ${CLAUDE_CODE_VARIANT_VERSIONS[variant]}`,
      provider: 'claude-code' as const,
      maxTokens: 8192,
      contextWindow: 200000
    }));
    // console.log('[ClaudeCodeProvider.getModels] Returning models:', models.map(m => ({ id: m.id, name: m.name })));
    return models;
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
