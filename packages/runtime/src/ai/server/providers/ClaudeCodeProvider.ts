/**
 * Claude Code provider using claude-agent-sdk with MCP support
 * Uses bundled SDK from package dependencies
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Query interface not properly exported by SDK, so we define it inline
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  streamInput(stream: AsyncIterable<any>): Promise<void>;
}
import { parse as parseShellCommand } from 'shell-quote';
import type { MessageParam, ImageBlockParam, TextBlockParam, ContentBlockParam, DocumentBlockParam } from '@anthropic-ai/sdk/resources';
import { BaseAgentProvider } from './BaseAgentProvider';
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
  CLAUDE_CODE_VARIANTS,
  ModelIdentifier,
  resolveClaudeCodeModelVariant,
} from '../types';
import { isBedrockToolSearchError } from '../utils/errorDetection';
import { AgentMessagesRepository } from '../../../storage/repositories/AgentMessagesRepository';
import { TeammateManager } from './TeammateManager';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';
import { buildClaudeCodeSystemPrompt } from '../../prompt';
import { setupClaudeCodeEnvironment, getClaudeCodeExecutableOptions, getClaudeCodeSpawnFunction, ClaudeHelperMethod } from '../../../electron/claudeCodeEnvironment';
import { SessionManager } from '../SessionManager';
import { parseBashForFileOps, hasShellChainingOperators, splitOnShellOperators } from '../permissions/BashCommandAnalyzer';
import { DEFAULT_EFFORT_LEVEL } from '../effortLevels';
import { ToolPermissionService } from '../permissions/ToolPermissionService';
import { buildToolDescription, generateToolPattern } from '../permissions/toolPermissionHelpers';
import { AgentToolHooks } from '../permissions/AgentToolHooks';
import { McpConfigService } from '../services/McpConfigService';
import { historyManager } from '../../../../../electron/src/main/HistoryManager';

/**
 * SDK-native tools that are executed by the Claude Code SDK itself (not by Nimbalyst).
 * AskUserQuestion is included because we handle it in canUseTool (user input, not local execution).
 * This list is the single source of truth — used for planning-mode filtering, tool_use logging, and tool_result logging.
 */
const SDK_NATIVE_TOOLS: readonly string[] = [
  'Read', 'Write', 'Edit', 'MultiEdit',
  'Glob', 'Grep', 'LS',
  'Bash',
  'WebFetch', 'WebSearch',
  'Task', 'Agent',  // Agent is the renamed Task tool (SDK 0.2.x+)
  'TaskOutput', 'TaskStop', 'ExitPlanMode', 'AskUserQuestion',
  'EnterPlanMode', 'EnterWorktree', 'Skill',
  'NotebookRead', 'NotebookEdit',
  'TodoRead', 'TodoWrite',
  // Task management tools (SDK-internal)
  'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList',
  // Agent Teams tools (SDK-internal, executed by CLI subprocess)
  'TeammateTool', 'SendMessage', 'TeamCreate', 'TeamDelete',
];

/**
 * Track changes in the agent-sdk and claude-code itself here:
 * https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md
 * https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
 */
type ClaudeCodeVariant = typeof CLAUDE_CODE_VARIANTS[number];

// Map variants to their current version numbers
// These correspond to the underlying Claude models used by Claude Code
const CLAUDE_CODE_VARIANT_VERSIONS: Record<ClaudeCodeVariant, string> = {
  opus: '4.6',
  sonnet: '4.6',
  haiku: '3.5'
};

const CLAUDE_CODE_MODEL_LABELS: Record<ClaudeCodeVariant, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku'
};

export class ClaudeCodeProvider extends BaseAgentProvider {
  private currentMode?: 'planning' | 'agent'; // Track session mode for prompt customization and tool filtering
  private slashCommands: string[] = []; // Available slash commands from SDK
  private markMessagesAsHidden: boolean = false; // Flag to mark next messages as hidden
  private helperMethod: ClaudeHelperMethod = 'electron'; // Track which helper method is being used

  // Lead query reference for interruptWithMessage support
  private leadQuery: Query | null = null;
  // Flag: set when a teammate:messageWhileIdle has been emitted but sendMessage hasn't
  // started yet. Prevents interruptWithMessage from emitting duplicate events.
  private teammateIdleMessagePending: boolean = false;
  // Flag: set when streamInput fails due to dead transport, used in finally block
  private transportDied: boolean = false;
  // Flag: set when interrupt() is called on the lead query. After interrupt(),
  // the transport is dead and streamInput will always fail, so skip the while loop.
  private wasInterrupted: boolean = false;
  // Guard: prevents infinite continuation loops when the lead's turn keeps ending
  // with active teammates. Incremented on each continuation, reset when a real
  // teammate message arrives or teammates complete. Abandon after MAX_CONTINUATIONS.
  private continuationCount: number = 0;
  private static readonly MAX_CONTINUATIONS = 3;
  // Resolve function to break the for-await loop immediately when interrupt is called.
  // Racing this against .next() lets us unblock without waiting for the SDK transport.
  private interruptResolve: (() => void) | null = null;

  // Teammate management: spawning, messaging, lifecycle, config I/O
  private teammateManager: TeammateManager;

  // SDK-native sub-agent task tracking (task_started/task_progress/task_notification)
  private activeTasks = new Map<string, {
    taskId: string;
    description: string;
    taskType?: string;
    status: 'running' | 'completed' | 'failed' | 'stopped';
    startedAt: number;
    toolUseId?: string;
    toolCount: number;
    tokenCount: number;
    durationMs: number;
    lastToolName?: string;
    summary?: string;
  }>();

  // Permission service for tool permission handling
  private permissionService: ToolPermissionService | null = null;

  // Tool hooks service for pre/post tool execution and file tracking
  private toolHooksService: AgentToolHooks | null = null;

  // MCP configuration service for loading and processing MCP server configs
  private mcpConfigService: McpConfigService;

  // Setting for using standalone binary (injected from electron main process)
  // When true, use Bun-compiled standalone binary on macOS to hide dock icon
  private static useStandaloneBinary: boolean = false;

  // Custom Claude Code executable path (injected from electron main process)
  // When set, overrides the bundled CLI and standalone binary
  private static customClaudeCodePath: string = '';

  /**
   * Set whether to use the standalone binary for spawning Claude Code.
   * When true on macOS, uses the Bun-compiled binary to avoid dock icons.
   */
  public static setUseStandaloneBinary(enabled: boolean): void {
    ClaudeCodeProvider.useStandaloneBinary = enabled;
  }

  /**
   * Set a custom path to the Claude Code executable.
   * When set, this overrides the bundled CLI and standalone binary.
   * Used for corporate SSO wrappers or custom Claude installations.
   */
  public static setCustomClaudeCodePath(path: string): void {
    ClaudeCodeProvider.customClaudeCodePath = path;
  }

  constructor() {
    super();
    this.teammateManager = new TeammateManager({
      logNonBlocking: (sessionId, source, direction, content, metadata) =>
        this.logAgentMessageNonBlocking(sessionId, source, direction, content, metadata),
      emit: (event, payload) => this.emit(event, payload),
      createPreToolUseHook: (cwd, sessionId, permissionsPath, context) => {
        // Create AgentToolHooks instance for teammate
        const teammateHooks = this.createTeammateToolHooksService(cwd, sessionId, permissionsPath, context?.isTeammateSession || false);
        return teammateHooks.createPreToolUseHook();
      },
      createPostToolUseHook: (cwd, sessionId) => {
        // Create AgentToolHooks instance for teammate
        const teammateHooks = this.createTeammateToolHooksService(cwd, sessionId, undefined, true);
        return teammateHooks.createPostToolUseHook();
      },
      getAbortSignal: () => this.abortController?.signal,
      interruptWithMessage: (message) => this.interruptWithMessage(message),
      createCanUseToolHandler: (sessionId, workspacePath, permissionsPath, teammateName) =>
        this.createCanUseToolHandler(sessionId, workspacePath, permissionsPath, teammateName),
    });

    // Initialize permission service if all dependencies are available
    // For Claude Code, these dependencies are optional since permission handling
    // can fall back to inline logic if not configured (e.g., in tests)
    if (
      BaseAgentProvider.trustChecker &&
      ClaudeCodeProvider.claudeSettingsPatternSaver &&
      ClaudeCodeProvider.claudeSettingsPatternChecker
    ) {
      this.permissionService = new ToolPermissionService({
        trustChecker: BaseAgentProvider.trustChecker,
        patternSaver: ClaudeCodeProvider.claudeSettingsPatternSaver,
        patternChecker: ClaudeCodeProvider.claudeSettingsPatternChecker,
        securityLogger: BaseAgentProvider.securityLogger ?? undefined,
        emit: this.emit.bind(this),
      });
    }

    // Initialize MCP configuration service
    this.mcpConfigService = new McpConfigService({
      mcpServerPort: ClaudeCodeProvider.mcpServerPort,
      sessionNamingServerPort: ClaudeCodeProvider.sessionNamingServerPort,
      extensionDevServerPort: ClaudeCodeProvider.extensionDevServerPort,
      superLoopProgressServerPort: null, // Disabled - was leaking into non-super-loop sessions
      sessionContextServerPort: ClaudeCodeProvider.sessionContextServerPort,
      mcpConfigLoader: ClaudeCodeProvider.mcpConfigLoader,
      extensionPluginsLoader: ClaudeCodeProvider.extensionPluginsLoader,
      claudeSettingsEnvLoader: ClaudeCodeProvider.claudeSettingsEnvLoader,
      shellEnvironmentLoader: ClaudeCodeProvider.shellEnvironmentLoader,
    });
  }

  getProviderName(): string {
    return 'claude-code';
  }

  /**
   * Create AgentToolHooks service for teammate sessions
   * Teammates need separate hook instances with isTeammateSession: true
   */
  private createTeammateToolHooksService(
    workspacePath: string,
    sessionId: string | undefined,
    permissionsPath: string | undefined,
    isTeammateSession: boolean
  ): AgentToolHooks {
    return new AgentToolHooks({
      workspacePath,
      sessionId,
      emit: this.emit.bind(this),
      logAgentMessage: this.logAgentMessage.bind(this),
      logSecurity: this.logSecurity.bind(this),
      trustChecker: BaseAgentProvider.trustChecker || undefined,
      patternChecker: ClaudeCodeProvider.claudeSettingsPatternChecker || undefined,
      patternSaver: ClaudeCodeProvider.claudeSettingsPatternSaver || undefined,
      extensionFileTypesLoader: ClaudeCodeProvider.extensionFileTypesLoader || undefined,
      getCurrentMode: () => this.currentMode,
      setCurrentMode: (mode) => { this.currentMode = mode; },
      getPendingExitPlanModeConfirmations: () => this.pendingExitPlanModeConfirmations,
      getSessionApprovedPatterns: () => this.permissions.sessionApprovedPatterns,
      getPendingToolPermissions: () => this.permissions.pendingToolPermissions,
      teammatePreToolHandler: async (toolName, toolInput, toolUseID, sessionId) =>
        this.teammateManager.handlePreToolUse(toolName, toolInput, toolUseID, sessionId),
      isTeammateSession,
      permissionsPath,
      historyManager: {
        createSnapshot: async (filePath: string, content: string, snapshotType: string, message: string, metadata?: any) => {
          await historyManager.createSnapshot(filePath, content, snapshotType as any, message, metadata);
        },
        getPendingTags: async (filePath: string) => {
          const tags = await historyManager.getPendingTags(filePath);
          return tags.map(tag => ({
            id: tag.id,
            createdAt: tag.createdAt,
            sessionId: tag.sessionId
          }));
        },
        tagFile: async (filePath: string, tagId: string, content: string, metadata?: any) => {
          await historyManager.createTag(
            filePath,
            tagId,
            content,
            metadata?.sessionId || 'unknown',
            metadata?.toolUseId || ''
          );
        },
        updateTagStatus: async (filePath: string, tagId: string, status: string) => {
          await historyManager.updateTagStatus(filePath, tagId, status as any);
        }
      },
    });
  }

  // ExitPlanMode confirmation response type
  private pendingExitPlanModeConfirmations: Map<string, {
    resolve: (response: { approved: boolean; clearContext?: boolean; feedback?: string }) => void;
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

  // Shared MCP server port (injected from electron main process)
  // This server provides capture_editor_screenshot tool only.
  // applyDiff and streamContent are NOT exposed via MCP - they're only for chat providers via IPC.
  private static mcpServerPort: number | null = null;

  // Session naming MCP server port (injected from electron main process)
  private static sessionNamingServerPort: number | null = null;

  // Extension dev MCP server port (injected from electron main process)
  // Provides tools for building, installing, and reloading extensions
  private static extensionDevServerPort: number | null = null;

  // Super Loop progress MCP server port (injected from electron main process)
  private static superLoopProgressServerPort: number | null = null;

  // Session context MCP server port (injected from electron main process)
  // Provides session summary, workstream overview, and recent sessions tools
  private static sessionContextServerPort: number | null = null;

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

  // Claude settings env vars loader (injected from electron main process)
  // Returns env vars from ~/.claude/settings.json to pass directly to the SDK
  private static claudeSettingsEnvLoader: (() => Promise<Record<string, string>>) | null = null;

  // Shell environment loader (injected from electron main process)
  // Returns full env vars from user's login shell (e.g., AWS_*, NODE_EXTRA_CA_CERTS)
  // Ensures env vars are available even when launched from Dock/Finder
  private static shellEnvironmentLoader: (() => Record<string, string> | null) | null = null;

  // Additional directories loader (injected from electron main process)
  // Returns additional directories Claude should have access to based on workspace context
  // (e.g., SDK docs when working on an extension project)
  private static additionalDirectoriesLoader: ((workspacePath: string) => string[]) | null = null;

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

  // Image compressor (injected from electron main process)
  // Compresses images to fit within API limits before sending
  private static imageCompressor: ((
    buffer: Buffer,
    mimeType: string,
    options?: { targetSizeBytes?: number }
  ) => Promise<{ buffer: Buffer; mimeType: string; wasCompressed: boolean }>) | null = null;

  // Extension file types loader (injected from electron main process)
  // Returns file extensions that have custom editors registered via extensions
  // Used in planning mode to allow editing extension-registered file types (e.g., .mockup.html)
  private static extensionFileTypesLoader: (() => Set<string>) | null = null;

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
   * Set the Super Loop progress MCP server port (called from electron main process)
   * This provides the super_loop_progress_update tool for Super Loop iterations
   */
  public static setSuperLoopProgressServerPort(port: number | null): void {
    ClaudeCodeProvider.superLoopProgressServerPort = port;
  }

  /**
   * Set the session context MCP server port (called from electron main process)
   * This provides session summary, workstream overview, and recent sessions tools
   */
  public static setSessionContextServerPort(port: number | null): void {
    ClaudeCodeProvider.sessionContextServerPort = port;
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
   * Set the env vars loader function (called from electron main process)
   * Returns env vars from ~/.claude/settings.json to pass directly to the SDK env option.
   * This ensures experimental feature flags like CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
   * are passed both via settings.json AND the SDK env for maximum reliability.
   */
  public static setClaudeSettingsEnvLoader(loader: (() => Promise<Record<string, string>>) | null): void {
    ClaudeCodeProvider.claudeSettingsEnvLoader = loader;
  }

  /**
   * Set the shell environment loader (called from electron main process).
   * Provides the full set of env vars from the user's login shell (excluding PATH).
   * This ensures env vars like AWS credentials, NODE_EXTRA_CA_CERTS, etc.
   * are available to the Claude Code subprocess even when launched from Dock/Finder.
   */
  public static setShellEnvironmentLoader(loader: (() => Record<string, string> | null) | null): void {
    ClaudeCodeProvider.shellEnvironmentLoader = loader;
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
    BaseAgentProvider.setSecurityLogger(logger);
  }

  /**
   * Set the image compressor function (called from electron main process)
   * Compresses images to fit within API limits before sending
   */
  public static setImageCompressor(compressor: ((
    buffer: Buffer,
    mimeType: string,
    options?: { targetSizeBytes?: number }
  ) => Promise<{ buffer: Buffer; mimeType: string; wasCompressed: boolean }>) | null): void {
    ClaudeCodeProvider.imageCompressor = compressor;
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
   * Checks if a workspace is trusted before allowing tool execution.
   * NOTE: For worktree sessions, the caller should pass the parent project path.
   */
  public static setTrustChecker(checker: ((
    workspacePath: string
  ) => { trusted: boolean; mode: 'ask' | 'allow-all' | 'bypass-all' | null }) | null): void {
    BaseAgentProvider.setTrustChecker(checker);
  }

  /**
   * Set the extension file types loader function (called from electron main process)
   * Returns file extensions that have custom editors registered via extensions.
   * Used in planning mode to allow editing extension-registered file types.
   */
  public static setExtensionFileTypesLoader(loader: (() => Set<string>) | null): void {
    ClaudeCodeProvider.extensionFileTypesLoader = loader;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    const safeConfig = { ...config, apiKey: config.apiKey ? '***' : undefined };
    //   model: config.model,
    //   configKeys: Object.keys(config),
    //   config: safeConfig
    // }, null, 2));

    this.config = config;

    // Claude Code manages its own authentication - do not require or use API key
  }

  /**
   * Mark the next sendMessage call's logged messages as hidden
   * Used for auto-triggered commands like /context that shouldn't appear in UI
   * Flag is automatically reset after sendMessage completes
   */
  public setHiddenMode(hidden: boolean): void {
    this.markMessagesAsHidden = hidden;
  }

  private resolveModelVariant(): string {
    return resolveClaudeCodeModelVariant(this.config.model, ClaudeCodeProvider.DEFAULT_MODEL);
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

    // CRITICAL: Capture hidden mode flag at START and reset immediately
    // This prevents race conditions when concurrent sendMessage calls overlap
    // (e.g., auto-context /context command running while a queued prompt fires)
    const hideMessages = this.markMessagesAsHidden;
    this.markMessagesAsHidden = false;

    // Track session mode for MCP server configuration and tool filtering
    this.currentMode = (documentContext as any)?.mode || 'agent';

    // Threshold for large text attachments that should be written to /tmp instead of sent inline
    // This reduces initial token usage for very large attachments
    const LARGE_ATTACHMENT_CHAR_THRESHOLD = 10000;

    // Build content blocks for attachments (sent directly to Claude, not via file paths)
    const imageContentBlocks: ImageBlockParam[] = [];
    const documentContentBlocks: DocumentBlockParam[] = [];
    // Track large text attachments that will be written to /tmp and referenced in the system message
    const largeAttachmentFilePaths: { filename: string; filepath: string }[] = [];
    // Debug logging - uncomment if needed for attachment troubleshooting
    if (attachments && attachments.length > 0) {

      for (const attachment of attachments) {
        if (attachment.type === 'image' && attachment.filepath) {
          try {
            // Read image file
            let imageData = await fs.promises.readFile(attachment.filepath);
            let mimeType = attachment.mimeType || 'image/png';

            // Compress if needed to fit within API limits (5MB base64)
            if (ClaudeCodeProvider.imageCompressor) {
              const compressed = await ClaudeCodeProvider.imageCompressor(imageData, mimeType);
              imageData = Buffer.from(compressed.buffer);
              mimeType = compressed.mimeType;
            }

            const base64Data = imageData.toString('base64');

            // Determine media type for API
            let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
            const normalizedMime = mimeType.toLowerCase();
            if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') {
              mediaType = 'image/jpeg';
            } else if (normalizedMime === 'image/gif') {
              mediaType = 'image/gif';
            } else if (normalizedMime === 'image/webp') {
              mediaType = 'image/webp';
            } else if (normalizedMime === 'image/png') {
              mediaType = 'image/png';
            }

            imageContentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            });
          } catch (error) {
            console.error(`[CLAUDE-CODE] Failed to read image attachment:`, error);
          }
        } else if (attachment.type === 'pdf' && attachment.filepath) {
          // Read PDF files and send as document content blocks with base64 encoding
          try {
            const pdfData = await fs.promises.readFile(attachment.filepath);
            const base64Data = pdfData.toString('base64');
            const filename = attachment.filename || path.basename(attachment.filepath);
            documentContentBlocks.push({
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Data
              },
              title: filename
            } as DocumentBlockParam);
          } catch (error) {
            console.error(`[CLAUDE-CODE] Failed to read PDF attachment:`, error);
          }
        } else if (attachment.type === 'document' && attachment.filepath) {
          // Read text/document files - small ones sent inline, large ones written to /tmp
          try {
            const textContent = await fs.promises.readFile(attachment.filepath, 'utf-8');
            const filename = attachment.filename || path.basename(attachment.filepath);

            if (textContent.length > LARGE_ATTACHMENT_CHAR_THRESHOLD) {
              // Large attachment - write to /tmp and reference in system message
              // Claude can use the Read tool to access the content when needed
              const tmpFilePath = path.join('/tmp', `nimbalyst-attachment-${Date.now()}-${filename}`);
              await fs.promises.writeFile(tmpFilePath, textContent, 'utf-8');
              largeAttachmentFilePaths.push({ filename, filepath: tmpFilePath });
            } else {
              // Small attachment - send inline as document content block
              documentContentBlocks.push({
                type: 'document',
                source: {
                  type: 'text',
                  media_type: 'text/plain',
                  data: textContent
                },
                title: filename
              });
            }
          } catch (error) {
            console.error(`[CLAUDE-CODE] Failed to read document attachment:`, error);
          }
        }
      }
    }

    // Abort any existing request before starting a new one
    if (this.abortController) {
      this.abortController.abort();
    }

    // Create abort controller for this request
    this.abortController = new AbortController();

    // For worktree sessions, use the parent project path for permission lookups
    // This is passed via documentContext.permissionsPath from AIService
    const permissionsPath = (documentContext as any)?.permissionsPath || workspacePath;

    // Create tool hooks service for this turn
    // This service manages pre/post hooks, file tagging, and snapshot creation
    this.toolHooksService = new AgentToolHooks({
      workspacePath: workspacePath!,
      sessionId,
      emit: this.emit.bind(this),
      logAgentMessage: this.logAgentMessage.bind(this),
      logSecurity: this.logSecurity.bind(this),
      trustChecker: BaseAgentProvider.trustChecker || undefined,
      patternChecker: ClaudeCodeProvider.claudeSettingsPatternChecker || undefined,
      patternSaver: ClaudeCodeProvider.claudeSettingsPatternSaver || undefined,
      extensionFileTypesLoader: ClaudeCodeProvider.extensionFileTypesLoader || undefined,
      getCurrentMode: () => this.currentMode,
      setCurrentMode: (mode) => { this.currentMode = mode; },
      getPendingExitPlanModeConfirmations: () => this.pendingExitPlanModeConfirmations,
      getSessionApprovedPatterns: () => this.permissions.sessionApprovedPatterns,
      getPendingToolPermissions: () => this.permissions.pendingToolPermissions,
      teammatePreToolHandler: async (toolName, toolInput, toolUseID, sessionId) =>
        this.teammateManager.handlePreToolUse(toolName, toolInput, toolUseID, sessionId),
      isTeammateSession: false,
      permissionsPath,
      historyManager: {
        createSnapshot: async (filePath: string, content: string, snapshotType: string, message: string, metadata?: any) => {
          await historyManager.createSnapshot(filePath, content, snapshotType as any, message, metadata);
        },
        getPendingTags: async (filePath: string) => {
          const tags = await historyManager.getPendingTags(filePath);
          return tags.map(tag => ({
            id: tag.id,
            createdAt: tag.createdAt,
            sessionId: tag.sessionId
          }));
        },
        tagFile: async (filePath: string, tagId: string, content: string, metadata?: any) => {
          await historyManager.createTag(
            filePath,
            tagId,
            content,
            metadata?.sessionId || 'unknown',
            metadata?.toolUseId || ''
          );
        },
        updateTagStatus: async (filePath: string, tagId: string, status: string) => {
          await historyManager.updateTagStatus(filePath, tagId, status as any);
        }
      },
    });

    // Clear edited files tracker for new turn
    this.toolHooksService.clearEditedFiles();

    try {
      // Append document context to message using pre-built prompts from DocumentContextService
      // Skip adding system message if the prompt starts with a slash command
      const isSlashCommand = message.trimStart().startsWith('/');
      const documentContextPrompt = (documentContext as any)?.documentContextPrompt;
      const editingInstructions = (documentContext as any)?.editingInstructions;

      // Build user message addition from pre-built prompts
      let userMessageAddition: string | null = null;
      if (!isSlashCommand) {
        const parts: string[] = [];

        // Add document context prompt (file path, cursor, selection, content/diff, transitions)
        if (documentContextPrompt) {
          parts.push(documentContextPrompt);
        }

        // Add one-time editing instructions (only on first message with document open)
        if (editingInstructions) {
          parts.push(editingInstructions);
        }

        if (parts.length > 0) {
          userMessageAddition = parts.join('\n\n');
          message = `${message}\n\n<NIMBALYST_SYSTEM_MESSAGE>\n${userMessageAddition}\n</NIMBALYST_SYSTEM_MESSAGE>`;
        }
      }

      // Add large attachment file paths to system message
      // These are text attachments over 10k chars that were written to /tmp
      if (largeAttachmentFilePaths.length > 0) {
        const attachmentSection = largeAttachmentFilePaths.map(
          ({ filename, filepath }) => `- ${filename}: ${filepath}`
        ).join('\n');

        const attachmentInstructions = `<LARGE_ATTACHMENTS>\nThe following attached files are too large to include inline. Use the Read tool to access their contents:\n${attachmentSection}\n</LARGE_ATTACHMENTS>`;

        if (message.includes('</NIMBALYST_SYSTEM_MESSAGE>')) {
          // Insert before closing tag
          message = message.replace(
            '</NIMBALYST_SYSTEM_MESSAGE>',
            `\n\n${attachmentInstructions}\n</NIMBALYST_SYSTEM_MESSAGE>`
          );
        } else {
          // No existing system message - create one
          message = `${message}\n\n<NIMBALYST_SYSTEM_MESSAGE>\n${attachmentInstructions}\n</NIMBALYST_SYSTEM_MESSAGE>`;
        }
      }

      // Load env vars from ~/.claude/settings.json early so they're available for both
      // system prompt building (agent teams flag) and SDK environment setup
      let settingsEnv: Record<string, string> = {};
      if (ClaudeCodeProvider.claudeSettingsEnvLoader) {
        try {
          settingsEnv = await ClaudeCodeProvider.claudeSettingsEnvLoader();
        } catch (error) {
          console.warn('[CLAUDE-CODE] Failed to load settings env vars:', error);
        }
      }

      // Load shell environment vars (AWS credentials, NODE_EXTRA_CA_CERTS, etc.)
      // These fill in env vars that are missing from Electron's minimal environment
      // when launched from Dock/Finder instead of terminal
      let shellEnv: Record<string, string> = {};
      if (ClaudeCodeProvider.shellEnvironmentLoader) {
        try {
          shellEnv = ClaudeCodeProvider.shellEnvironmentLoader() || {};
        } catch (error) {
          console.warn('[CLAUDE-CODE] Failed to load shell environment:', error);
        }
      }

      // Build system prompt (no longer contains document context)
      const promptBuildStart = Date.now();
      // console.log('[CLAUDE-CODE] sendMessage - documentContext keys:', documentContext ? Object.keys(documentContext) : 'undefined');
      // console.log('[CLAUDE-CODE] sendMessage - documentContext.sessionType:', (documentContext as any)?.sessionType);
      const enableAgentTeams = settingsEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
      const systemPrompt = this.buildSystemPrompt(documentContext, enableAgentTeams);

      // Note: Attachments (images/documents) are NOT added to the message text.
      // They're sent as separate content blocks via the API's multimodal format.
      // We only show what's actually appended to the user's text message.

      // Emit prompt additions for debugging UI
      // Only emit for user-initiated messages, not hidden/auto-triggered commands like /context
      // This prevents auto-commands from overwriting the user's prompt additions data
      const hasAttachments = attachments && attachments.length > 0;
      if (!hideMessages && sessionId && (systemPrompt || userMessageAddition || hasAttachments)) {
        // Build attachment summaries (don't include full base64 data, just metadata)
        const attachmentSummaries = attachments?.map(att => ({
          type: att.type,
          filename: att.filename || (att.filepath ? path.basename(att.filepath) : 'unknown'),
          mimeType: att.mimeType,
          filepath: att.filepath
        })) || [];

        this.emit('promptAdditions', {
          sessionId,
          systemPromptAddition: systemPrompt || null,
          userMessageAddition: userMessageAddition,
          attachments: attachmentSummaries,
          timestamp: Date.now()
        });
      }

      // Require workspace path
      if (!workspacePath) {
        throw new Error('[CLAUDE-CODE] workspacePath is required but was not provided');
      }

      // Build options for claude-code SDK

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

      // Log the complete system prompt being sent to SDK for debugging
      // console.log('[CLAUDE-CODE] ========================================');
      // console.log('[CLAUDE-CODE] COMPLETE SYSTEM PROMPT BEING APPENDED TO SDK:');
      // console.log('[CLAUDE-CODE] Length:', systemPrompt.length, 'characters');
      // console.log('[CLAUDE-CODE] ========================================');
      // console.log(systemPrompt);
      // console.log('[CLAUDE-CODE] ========================================');

      const options: any = {
        // Custom path takes priority over bundled CLI
        pathToClaudeCodeExecutable: ClaudeCodeProvider.customClaudeCodePath || await this.findCliPath().catch(() => undefined),
        // BREAKING CHANGE: Claude Agent SDK requires explicit system prompt preset
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPrompt
        },
        // BREAKING CHANGE: Claude Agent SDK requires explicit settings sources
        settingSources,
        mcpServers: await this.mcpConfigService.getMcpServersConfig({ sessionId, workspacePath }),
        cwd: workspacePath,
        abortController: this.abortController,
        // Model variant includes [1m] suffix when extended context is selected,
        // which tells the SDK to auto-detect the 1M beta (--betas is ignored for OAuth users)
        model: this.resolveModelVariant(),
        // Use 'default' permission mode so canUseTool fires for AskUserQuestion and Bash
        // We auto-approve most tools in canUseTool, but check permissions for Bash
        permissionMode: 'default',
        // canUseTool callback handles permission requests
        // Auto-approves most tools, but checks Bash commands and blocks on AskUserQuestion
        canUseTool: this.createCanUseToolHandler(sessionId, workspacePath, permissionsPath),
        // PHASE 3: PreToolUse hook for tagging "before" state
        // PostToolUse hook for triggering file watcher (no snapshot creation)
        hooks: {
          'PreToolUse': [
            {
              hooks: [this.toolHooksService!.createPreToolUseHook()]
            }
          ],
          'PostToolUse': [
            {
              hooks: [this.toolHooksService!.createPostToolUseHook()]
            }
          ]
        },
        // API key is passed via environment variable if configured (see env setup below)
      };

      // Capture lead config for teammate spawning
      this.teammateManager.lastUsedCwd = workspacePath;
      this.teammateManager.lastUsedSessionId = sessionId;
      this.teammateManager.lastUsedPermissionsPath = permissionsPath;

      // Load extension plugins if available
      // These are Claude SDK plugins bundled with Nimbalyst extensions
      // Also includes CLI-installed plugins from ~/.claude/plugins/
      if (ClaudeCodeProvider.extensionPluginsLoader) {
        try {
          const extensionPlugins = await ClaudeCodeProvider.extensionPluginsLoader(workspacePath);
          if (extensionPlugins.length > 0) {
            options.plugins = extensionPlugins;
            // console.log(`[CLAUDE-CODE] Loaded ${extensionPlugins.length} extension plugin(s):`, extensionPlugins.map(p => p.path));
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
            // console.log(`[CLAUDE-CODE] Added ${additionalDirs.length} additional directory(ies):`, additionalDirs);
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
        'TodoRead', 'Task', 'Agent',
        'ExitPlanMode', 'EnterPlanMode'
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


      // Set up environment variables for the SDK
      // shellEnv and settingsEnv were loaded earlier (before system prompt build) and are reused here
      const env: any = {
        ...process.env,
        // Shell env vars fill in what's missing from Dock-launched Electron
        ...shellEnv,
        // ~/.claude/settings.json env vars override shell env (explicit user config wins)
        ...settingsEnv,
        // Enable MCP tool search when MCP tools exceed 10% of context (same as CLI default)
        // Options: 'auto' (10%), 'auto:N' (custom N%), 'true' (always), 'false' (never)
        ENABLE_TOOL_SEARCH: 'auto:10',
        // Set effort level for adaptive reasoning (same as CLI's /model effort slider)
        // Only set when not 'high' (the default) to avoid overriding CLI defaults
        ...(this.config.effortLevel && this.config.effortLevel !== DEFAULT_EFFORT_LEVEL && {
          CLAUDE_CODE_EFFORT_LEVEL: this.config.effortLevel
        }),
      };

      // Task tools are disabled by default in non-interactive SDK sessions.
      // Enable them so TeamCreate/TaskCreate/TaskList/TaskUpdate flows work in Nimbalyst.
      if (enableAgentTeams) {
        env.CLAUDE_CODE_ENABLE_TASKS = '1';
      }

      const effectiveTeamContext = enableAgentTeams
        ? await this.teammateManager.resolveTeamContext(sessionId)
        : undefined;

      // Preserve team context across lead query turns so TeamDelete/broadcast work
      // even after the TeamCreate call happened in a previous query process.
      if (effectiveTeamContext) {
        env.CLAUDE_CODE_TEAM_NAME = effectiveTeamContext;
        env.CLAUDE_CODE_TASK_LIST_ID = effectiveTeamContext;
        env.CLAUDE_CODE_AGENT_ID = `team-lead@${effectiveTeamContext}`;
        env.CLAUDE_CODE_AGENT_NAME = 'team-lead';
        env.CLAUDE_CODE_AGENT_TYPE = 'team-lead';
      }

      if (this.config.apiKey) {
        env.ANTHROPIC_API_KEY = this.config.apiKey;
      } else {
      }

      // In production, we need to spawn claude-code differently
      // The SDK expects to spawn with 'node', but we need to use Electron in node mode
      if (app.isPackaged) {
        // Use shared environment setup utility
        const packagedEnv = setupClaudeCodeEnvironment();
        Object.assign(env, packagedEnv);

        // Custom executable path is a standalone binary that runs directly -
        // skip Electron/standalone binary options to avoid overwriting pathToClaudeCodeExecutable
        if (!ClaudeCodeProvider.customClaudeCodePath) {
          // Set executable options (macOS can use standalone binary if enabled)
          const { options: executableOptions, method } = getClaudeCodeExecutableOptions(
            ClaudeCodeProvider.useStandaloneBinary,
            (message, data) => console.log(`[ClaudeCodeProvider] ${message}`, data || '')
          );
          Object.assign(options, executableOptions);
          this.helperMethod = method;
        }

        // Set custom spawn function (Windows uses windowsHide to hide console)
        const spawnFunction = getClaudeCodeSpawnFunction();
        if (spawnFunction) {
          (options as any).spawnClaudeCodeProcess = spawnFunction;
        }

        // Share packaged-build options with TeammateManager so sub-agents
        // can also spawn Claude Code subprocesses in production builds
        const executableOptionsForTeammates = ClaudeCodeProvider.customClaudeCodePath
          ? { pathToClaudeCodeExecutable: ClaudeCodeProvider.customClaudeCodePath }
          : getClaudeCodeExecutableOptions(
              ClaudeCodeProvider.useStandaloneBinary,
              (message, data) => console.log(`[ClaudeCodeProvider] ${message}`, data || '')
            ).options;
        this.teammateManager.packagedBuildOptions = {
          env: packagedEnv as Record<string, string | undefined>,
          ...executableOptionsForTeammates,
          ...(spawnFunction ? { spawnClaudeCodeProcess: spawnFunction } : {}),
        };
      }

      options.env = env;

      // Handle session resumption and branching
      if (sessionId) {
        const claudeSessionId = this.sessions.getSessionId(sessionId);
        if (claudeSessionId) {
          options.resume = claudeSessionId;
        } else {
          // Check if this is a branched session (forked from another session)
          const branchedFromSessionId = (documentContext as any)?.branchedFromSessionId;
          const branchedFromProviderSessionId = (documentContext as any)?.branchedFromProviderSessionId;
          if (branchedFromSessionId && branchedFromProviderSessionId) {
            // Resume from source session's provider session ID and fork it
            options.resume = branchedFromProviderSessionId;
            options.forkSession = true;
          } else if (branchedFromSessionId) {
            // Fallback: try the in-memory map (if source was used in this app session)
            const sourceClaudeSessionId = this.sessions.getSessionId(branchedFromSessionId);
            if (sourceClaudeSessionId) {
              options.resume = sourceClaudeSessionId;
              options.forkSession = true;
            } else {
              console.warn('[CLAUDE-CODE] Cannot branch: source provider session ID not available. branchedFromSessionId:', branchedFromSessionId);
            }
          }
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

      const queryStartTime = Date.now();


      // Log the raw input to the SDK (include attachments and mode in metadata for UI restoration)
      // CRITICAL: Must await to ensure user message is persisted before proceeding
      // Mark as searchable so user prompts are included in FTS index
      if (sessionId) {
        const metadataToLog: Record<string, any> = {};
        if (attachments && attachments.length > 0) {
          metadataToLog.attachments = attachments;
        }
        if (documentContext?.mode) {
          metadataToLog.mode = documentContext.mode;
        }
        // Detect teammate messages by content pattern and tag metadata for UI reconstruction
        const teammateMatch = message.match(/^\[Teammate message from "([^"]+)"\]/);
        if (teammateMatch) {
          metadataToLog.messageType = 'teammate_message_injected';
          metadataToLog.teammateName = teammateMatch[1];
        }
        await this.logAgentMessage(sessionId, 'claude-code', 'input', JSON.stringify({
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
        }), metadataToLog, hideMessages, undefined, true /* searchable */);
      }

      // TODO: Debug logging - uncomment if needed for MCP troubleshooting
      // Log MCP servers being passed to SDK (CONTAINS SENSITIVE CONFIG - commented out for production)

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
          yield msg;
        }

        promptInput = createStreamingInput();
      } else {
        // Simple string prompt when no attachments
        promptInput = message;
      }

      // console.log('[CLAUDE-CODE] Calling SDK query() - this spawns the claude process...');
      const queryCallStart = Date.now();
      const leadQuery = query({
        prompt: promptInput as any,
        options
      });
      this.leadQuery = leadQuery as unknown as Query;
      this.teammateIdleMessagePending = false;
      const queryIterator = leadQuery as AsyncIterable<any>;
      const queryCallDuration = Date.now() - queryCallStart;
      // console.log(`[CLAUDE-CODE] SDK query() returned iterator in ${queryCallDuration}ms`);
      if (queryCallDuration > 5000) {
        console.warn(`[CLAUDE-CODE] SDK query() took ${queryCallDuration}ms to return iterator (>5s threshold) - possible Windows Defender/antivirus delay`);
      }


      let fullContent = '';
      let chunkCount = 0;
      let firstChunkTime: number | undefined;
      let toolCallCount = 0;
      let receivedCompactBoundary = false;
      // Track tool calls by ID so we can update them with results
      const toolCallsById: Map<string, any> = new Map();
      // Track usage data from the SDK (gets overwritten by cumulative result.usage)
      let usageData: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      } | undefined;
      // Track the last assistant message's usage separately (per-step, not cumulative).
      // Used for context window fill calculation: input + cacheRead + cacheCreation = actual context size.
      let lastAssistantUsage: typeof usageData | undefined;
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


      // Stream the response
      try {
        // Use manual iteration with Promise.race so interruptWithMessage() can
        // break the loop immediately without waiting for the SDK subprocess.
        const iterator = (queryIterator as AsyncIterable<any>)[Symbol.asyncIterator]();
        let interruptPromise = new Promise<'interrupted'>(resolve => {
          this.interruptResolve = () => resolve('interrupted');
        });
        while (true) {
          // Check for abort signal before each iteration
          if (this.abortController?.signal.aborted) {
            console.log('[CLAUDE-CODE] Abort signal detected in streaming loop, breaking out');
            break;
          }

          // Race the next chunk against the interrupt signal
          const nextPromise = iterator.next();
          const raceResult = await Promise.race([nextPromise, interruptPromise]);

          if (raceResult === 'interrupted') {
            console.log('[CLAUDE-CODE] Interrupt signal received, breaking streaming loop');
            break;
          }

          const iterResult = raceResult as IteratorResult<any>;
          if (iterResult.done) break;
          const rawChunk = iterResult.value;

          const chunk = rawChunk as any;
          chunkCount++;

          // Log raw SDK chunks to database (non-blocking for streaming performance)
          // Extract SDK-provided uuid for deduplication in sync
          if (sessionId) {
            const rawChunkJson = typeof chunk === 'string'
              ? JSON.stringify({ type: 'text', content: chunk })
              : JSON.stringify(chunk);
            // Non-string chunks from SDK have a uuid field we can use for deduplication
            const providerMessageId = typeof chunk !== 'string' ? chunk.uuid : undefined;

            // Determine if this chunk should be searchable (assistant text without tool content)
            // Only assistant messages with text content (no tool_use/tool_result) are searchable
            let isSearchable = false;
            if (typeof chunk === 'object' && chunk.type === 'assistant' && chunk.message?.content) {
              const content = chunk.message.content;
              if (Array.isArray(content)) {
                const hasText = content.some((block: any) => block.type === 'text');
                const hasTool = content.some((block: any) => block.type === 'tool_use' || block.type === 'tool_result');
                isSearchable = hasText && !hasTool;
              }
            }

            this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', rawChunkJson, undefined, hideMessages, providerMessageId, isSearchable);
          }

          // if (chunkCount <= 5) {
          //     typeof chunk === 'string'
          //       ? { type: 'string', length: chunk.length, preview: chunk.substring(0, 100) }
          //       : JSON.stringify(chunk, null, 2)
          //   );
          // }

          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            const timeToFirstChunk = firstChunkTime - queryStartTime;
            // console.log(`[CLAUDE-CODE] First chunk received in ${timeToFirstChunk}ms from query start`);
            if (timeToFirstChunk > 10000) {
              console.warn(`[CLAUDE-CODE] Time to first chunk was ${timeToFirstChunk}ms (>10s threshold) - possible Windows Defender/antivirus delay during subprocess spawn`);
            }
          }
          if (typeof chunk === 'string') {
            // Text chunk - always display it
            // if (chunkCount <= 3) {
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
            // }

            if (chunk.session_id && sessionId) {
              this.sessions.captureSessionId(sessionId, chunk.session_id);
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
              // Track per-step usage from assistant messages (not overwritten by cumulative result.usage)
              lastAssistantUsage = chunk.message.usage;
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

                  const toolName = block.name;
                  const toolArgs = block.input;
                  const isMcpTool = toolName?.startsWith('mcp__');

                  // Detect TodoWrite tool invocations and extract todos
                  if (toolName === 'TodoWrite' && toolArgs && toolArgs.todos) {
                    // Emit todo update event to renderer via IPC (don't await - let it happen async)
                    this.emitTodoUpdate(sessionId, toolArgs.todos).catch(err => {
                      console.error('[CLAUDE-CODE] Failed to emit todo update:', err);
                    });
                  }

                  // SDK-native tools that are executed by the Claude Code SDK itself
                  // AskUserQuestion is included because we handle it in canUseTool (user input, not local execution)
                  const isSdkNativeTool = SDK_NATIVE_TOOLS.includes(toolName);

                  let executionResult: any | undefined;

                  if (!toolName) {
                  } else if (isMcpTool) {
                    // MCP tools are handled by the SDK, but we need to log the tool_use for reconstruction
                    // The result will come later in a tool_result block (non-blocking for streaming)
                    if (sessionId) {
                      this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
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
                    }
                  } else if (isSdkNativeTool) {
                    // SDK executes these tools itself, result will come in a tool_result block
                  } else if (this.toolHandler) {
                    const toolStartTime = Date.now();
                    try {
                      executionResult = await this.executeToolCall(toolName, toolArgs);
                      // if (executionResult !== undefined) {
                      //   try {
                      //   } catch (stringifyError) {
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
                    // Log tool call and result to database in format that UI can reconstruct (non-blocking for streaming)
                    if (sessionId) {
                      // Log the tool_use block
                      this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
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
                      this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
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
                  }
                } else if (block.type === 'tool_result') {
                  // Handle tool results from Claude Code SDK
                  const toolResultId = block.tool_use_id || block.id;
                  const toolResult = block.content;
                  const isError = block.is_error || false;

                  //   typeof toolResult === 'string'
                  //     ? toolResult.substring(0, 500)
                  //     : JSON.stringify(toolResult, null, 2).substring(0, 500)
                  // );

                  // Find the corresponding tool call and update it with result
                  const toolCall = toolCallsById.get(toolResultId);
                  if (toolCall) {
                    // Check if tool already has a result - if so, skip duplicate
                    if (toolCall.result !== undefined) {
                      continue; // Skip this tool_result block
                    }

                    toolCall.result = toolResult;

                    // Check if this is an error - either explicit is_error flag or error in content
                    const hasErrorFlag = isError === true;
                    const hasErrorContent = typeof toolResult === 'string' &&
                      (toolResult.includes('<tool_use_error>') || toolResult.startsWith('Error:'));

                    if (hasErrorFlag || hasErrorContent) {
                      toolCall.isError = true;
                    }

                    // CRITICAL FIX: For Edit tools, ensure diff information is preserved in the result
                    // The UI extraction function needs old_string/new_string to show red/green diffs
                    // The SDK returns a simple success message, but we need to preserve the original arguments
                    if (toolCall.name === 'Edit' && toolCall.arguments && !toolCall.isError) {
                      const args = toolCall.arguments as any;
                      if (args.old_string !== undefined || args.new_string !== undefined) {
                        // Ensure result is an object that includes both the success message and diff fields
                        const resultMessage = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                        toolCall.result = {
                          message: resultMessage,
                          file_path: args.file_path,
                          old_string: args.old_string,
                          new_string: args.new_string
                        };
                      }
                    }

                    // Teammate side-effects (shutdown detection, team context tracking)
                    this.processTeammateToolResult(sessionId, toolCall.name, toolCall.arguments, toolResult, toolCall.isError === true, toolCall.id);

                    // Log ONLY the tool_result block to database (non-blocking for streaming)
                    // The tool_use block was already logged by raw chunk logging at line 264
                    if (sessionId) {
                      this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
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

            const toolName = toolChunk.name || 'unknown';
            const toolArgs = toolChunk.input;
            const isMcpTool = toolName.startsWith('mcp__');

            const isSdkNativeTool = SDK_NATIVE_TOOLS.includes(toolName);

            let executionResult: any | undefined;

            if (isMcpTool) {
              // MCP tools are handled by the SDK, but we need to log the tool_use for reconstruction
              // The result will come later in a tool_result block (non-blocking for streaming)
              if (sessionId) {
                const mcpToolId = toolChunk.id || `tool-${toolCallCount}`;
                this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
                  type: 'assistant',
                  message: {
                    content: [{
                      type: 'tool_use',
                      id: mcpToolId,
                      name: toolName,
                      input: toolArgs
                    }]
                  }
                }));
              }
            } else if (isSdkNativeTool) {
              // SDK executes these tools itself, we just observe them
            } else if (this.toolHandler) {
              const toolStartTime = Date.now();
              try {
                executionResult = await this.executeToolCall(toolName, toolArgs);
                // if (executionResult !== undefined) {
                //   try {
                //   } catch (stringifyError) {
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
              // Log tool call and result to database in format that UI can reconstruct (non-blocking for streaming)
              if (sessionId) {
                // Log the tool_use block
                this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
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
                this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
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

              // Check if this is an expired/missing session error
              // This happens when trying to resume an old session that Claude Code SDK has purged
              const isExpiredSessionError = (
                lowerError.includes('no conversation found') ||
                lowerError.includes('session not found') ||
                lowerError.includes('conversation not found')
              );

              // If it's an expired session error, clear the stored session ID and provide guidance
              if (isExpiredSessionError && sessionId) {
                console.log(`[CLAUDE-CODE] Detected expired session error for session ${sessionId}, clearing providerSessionId`);
                this.sessions.expireSession(sessionId);
                // Provide user-friendly error message
                errorMessage = 'Your previous conversation session has expired and can no longer be resumed. Please send a new message to start a fresh conversation - your chat history is still visible but the AI will start with a clean context.';
              }

              // Check if this is a 500/internal server error (Claude may be down)
              const isServerError = (
                lowerError.includes('internal server error') ||
                lowerError.includes('500') ||
                (typeof errorMessage === 'string' && errorMessage.includes('"type":"api_error"'))
              );

              // Check if this is a Bedrock tool search incompatibility error
              const isBedrockToolError = isBedrockToolSearchError(errorMessage);

              // If it's a server error, suggest checking status page
              if (isServerError) {
                errorMessage = `${errorMessage}\n\nClaude may be experiencing issues. Check https://status.anthropic.com for service status.`;
              }

              // If it's a Bedrock tool error, provide helpful guidance
              if (isBedrockToolError) {
                const settingsShortcut = process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,';
                errorMessage = [
                  `MCP Tool Error: ${errorMessage}`,
                  '',
                  'This error occurs because some alternative AI providers don\'t fully support deferred tool loading (tool search).',
                  '',
                  'To fix this:',
                  `1. Open Settings (${settingsShortcut})`,
                  '2. Go to "Claude Code" panel',
                  '3. In the "Environment Variables" section, add:',
                  '   ENABLE_TOOL_SEARCH = false',
                  '4. Save and retry your request',
                  '',
                  'This will load all MCP tools upfront instead of deferring them.'
                ].join('\n');
              }

              // Log error to database (as 'output' since errors are provider responses)
              const errorType = isAuthError ? 'authentication_error' : isBedrockToolError ? 'bedrock_tool_error' : isExpiredSessionError ? 'expired_session_error' : 'api_error';
              this.logError(sessionId, 'claude-code', new Error(errorMessage), 'result_chunk', errorType, hideMessages);

              // Yield error to UI with appropriate flags
              yield {
                type: 'error',
                error: errorMessage,
                ...(isAuthError && { isAuthError: true }),
                ...(isBedrockToolError && { isBedrockToolError: true }),
                ...(isExpiredSessionError && { isExpiredSessionError: true }),
                ...(isServerError && { isServerError: true })
              };

              // CRITICAL: Send completion and break on result errors (like "prompt too long")
              // Without this, the UI thinks the agent is still processing and /compact won't work
              await this.flushPendingWrites();
              yield {
                type: 'complete',
                isComplete: true
              };

              // Break out of the loop since we have an error
              break;
            }

            // For slash commands, the result contains the command output directly
            // (e.g., /context returns context usage in chunk.result)
            // In SDK 0.2.x, slash command output comes via result.result instead of user message with <local-command-stdout>
            if (isSlashCommand && chunk.result && typeof chunk.result === 'string' && chunk.result.trim().length > 0) {
              fullContent = chunk.result;
              yield {
                type: 'text',
                content: chunk.result,
                isSystem: true
              };
            }
            // Don't yield result content as text for non-slash commands - it's already been sent in the assistant message
            // Only errors need to be displayed from result chunks
          } else if (chunk.type === 'system') {
            // Handle system messages from Claude Code (initialization, etc.)
            // console.log(`[CLAUDE-CODE] System chunk subtype=${chunk.subtype}${chunk.task_id ? ` task_id=${chunk.task_id}` : ''}`);

            // Store session_id if present
            if (chunk.session_id && sessionId) {
              this.sessions.captureSessionId(sessionId, chunk.session_id);
            }

            // System messages like 'init' are informational - don't display to user
            if (chunk.subtype === 'init') {
              // Clean up stale "running" tasks from previous sessions/restarts.
              // The activeTasks Map is in-memory only, so after restart any
              // previously-running tasks in metadata are orphaned.
              if (sessionId && this.activeTasks.size === 0) {
                (async () => {
                  try {
                    const { AISessionsRepository } = await import('../../../storage/repositories/AISessionsRepository');
                    const currentSession = await AISessionsRepository.get(sessionId);
                    const tasks = currentSession?.metadata?.currentTasks;
                    if (Array.isArray(tasks) && tasks.some((t: any) => t.status === 'running')) {
                      const cleaned = tasks.map((t: any) =>
                        t.status === 'running' ? { ...t, status: 'stopped' } : t
                      );
                      await AISessionsRepository.updateMetadata(sessionId, {
                        metadata: { ...currentSession?.metadata, currentTasks: cleaned }
                      });
                      this.emit('message:logged', { sessionId, direction: 'output' });
                      console.log(`[CLAUDE-CODE] Cleaned up ${tasks.filter((t: any) => t.status === 'running').length} stale running tasks`);
                    }
                  } catch (e) {
                    // Non-critical cleanup, don't block init
                  }
                })();
              }
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

              // Capture available slash commands
              if (chunk.slash_commands && Array.isArray(chunk.slash_commands)) {
                this.slashCommands = chunk.slash_commands;
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

              //   mcpServerCount,
              //   slashCommandCount,
              //   agentCount,
              //   skillCount,
              //   pluginCount,
              //   toolCount: chunk.tools?.length || 0
              // });

              // Warn if API key source is "none" - this means Claude Code didn't find credentials
              if (chunk.apiKeySource === 'none') {
              }
            } else if (chunk.subtype === 'task_started') {
              // SDK-native sub-agent started
              const taskChunk = chunk as any;
              this.activeTasks.set(taskChunk.task_id, {
                taskId: taskChunk.task_id,
                description: taskChunk.description || '',
                taskType: taskChunk.task_type,
                status: 'running',
                startedAt: Date.now(),
                toolUseId: taskChunk.tool_use_id,
                toolCount: 0,
                tokenCount: 0,
                durationMs: 0,
              });
              this.emitTaskUpdate(sessionId).catch(() => {});
            } else if (chunk.subtype === 'task_progress') {
              // SDK-native sub-agent progress update
              const taskChunk = chunk as any;
              const existing = this.activeTasks.get(taskChunk.task_id);
              if (existing) {
                existing.toolCount = taskChunk.usage?.tool_uses ?? existing.toolCount;
                existing.tokenCount = taskChunk.usage?.total_tokens ?? existing.tokenCount;
                existing.durationMs = taskChunk.usage?.duration_ms ?? existing.durationMs;
                existing.lastToolName = taskChunk.last_tool_name ?? existing.lastToolName;
                this.emitTaskUpdate(sessionId).catch(() => {});
              }
            } else if (chunk.subtype === 'task_notification') {
              // SDK-native sub-agent completed/failed/stopped
              const taskChunk = chunk as any;
              const existing = this.activeTasks.get(taskChunk.task_id);
              if (existing) {
                existing.status = taskChunk.status || 'completed';
                existing.summary = taskChunk.summary;
                if (taskChunk.usage) {
                  existing.toolCount = taskChunk.usage.tool_uses ?? existing.toolCount;
                  existing.tokenCount = taskChunk.usage.total_tokens ?? existing.tokenCount;
                  existing.durationMs = taskChunk.usage.duration_ms ?? existing.durationMs;
                }
                this.emitTaskUpdate(sessionId).catch(() => {});
              }
            } else if (chunk.subtype === 'compact_boundary') {
              // Handle /compact command response
              //   pre_tokens: chunk.compact_metadata?.pre_tokens,
              //   trigger: chunk.compact_metadata?.trigger
              // });

              // Mark that we received a compact boundary (prevents false "no output" error)
              receivedCompactBoundary = true;

              // Reset lastAssistantUsage so we don't report stale pre-compaction context fill.
              // The compaction turn has no assistant message, so this will be undefined,
              // and we won't emit contextFillTokens. The next real turn will have accurate data.
              lastAssistantUsage = undefined;

              // Display compact completion message to user
              const preTokens = chunk.compact_metadata?.pre_tokens || 'unknown';
              yield {
                type: 'text',
                content: `✓ Conversation compacted (was ${preTokens} tokens)`
              };
            } else {
              // Other system messages might be relevant

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

            const content = chunk.message?.content;

            // Check if content is an array (typical for tool results)
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  // Handle tool results from Claude Code SDK
                  const toolResultId = block.tool_use_id || block.id;
                  const toolResult = block.content;
                  const isError = block.is_error || false;

                  //   typeof toolResult === 'string'
                  //     ? toolResult.substring(0, 500)
                  //     : JSON.stringify(toolResult, null, 2).substring(0, 500)
                  // );

                  // Find the corresponding tool call and update it with result
                  const toolCall = toolCallsById.get(toolResultId);
                  if (toolCall) {
                    // Check if tool already has a result - if so, skip duplicate
                    if (toolCall.result !== undefined) {
                      continue; // Skip this tool_result
                    }

                    toolCall.result = toolResult;

                    // Check if this is an error - either explicit is_error flag or error in content
                    const hasErrorFlag = isError === true;
                    const hasErrorContent = typeof toolResult === 'string' &&
                      (toolResult.includes('<tool_use_error>') || toolResult.startsWith('Error:'));

                    if (hasErrorFlag || hasErrorContent) {
                      toolCall.isError = true;
                    }

                    // CRITICAL FIX: For Edit tools, ensure diff information is preserved in the result
                    // The UI extraction function needs old_string/new_string to show red/green diffs
                    // The SDK returns a simple success message, but we need to preserve the original arguments
                    if (toolCall.name === 'Edit' && toolCall.arguments && !toolCall.isError) {
                      const args = toolCall.arguments as any;
                      if (args.old_string !== undefined || args.new_string !== undefined) {
                        // Ensure result is an object that includes both the success message and diff fields
                        const resultMessage = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                        toolCall.result = {
                          message: resultMessage,
                          file_path: args.file_path,
                          old_string: args.old_string,
                          new_string: args.new_string
                        };
                      }
                    }

                    // Check if this tool result completes a tracked sub-agent task.
                    // Background agents deliver results as tool_results matching the Agent tool_use_id.
                    if (toolResultId) {
                      for (const task of this.activeTasks.values()) {
                        if (task.toolUseId === toolResultId && task.status === 'running') {
                          task.status = toolCall.isError ? 'failed' : 'completed';
                          if (typeof toolResult === 'string') {
                            task.summary = toolResult.substring(0, 200);
                          }
                          this.emitTaskUpdate(sessionId).catch(() => {});
                          break;
                        }
                      }
                    }

                    // Teammate side-effects (shutdown detection, team context tracking)
                    this.processTeammateToolResult(sessionId, toolCall.name, toolCall.arguments, toolResult, toolCall.isError === true, toolCall.id);

                    // Log ONLY the tool_result block to database (non-blocking for streaming)
                    // The tool_use block was already logged when the tool was first called
                    if (sessionId) {
                      this.logAgentMessageNonBlocking(sessionId, 'claude-code', 'output', JSON.stringify({
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

                // Track that we received content (prevents false "no output" error)
                fullContent += commandOutput;

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

              // Always yield summaries to the UI with context
              const displayMessage = summary ?
                `[Claude Agent]: ${summary}` :
                `[Claude Agent]: ${JSON.stringify(chunk)}`;

              yield {
                type: 'text',
                content: displayMessage
              };
            }
          } else if (chunk.type === 'tool_progress') {
            // Tool progress updates (elapsed time for long-running tools) - informational only
            // These are handled visually through the tool call streaming in the transcript
          } else if (chunk.type === 'tool_use_summary') {
            // Summary of tool use activity (common in agent teams) - informational only
            // The individual tool calls are already rendered in the transcript hierarchy
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
          } else if (chunk.type === 'rate_limit_event') {
            // Handle rate limit events from the Claude Code SDK
            // Statuses: "allowed" (ok), "allowed_warning" (approaching limit), blocked/rate_limited (hit limit)
            const info = chunk.rate_limit_info;
            if (!info) {
              // No info, silently skip
            } else if (info.status === 'allowed') {
              // All good, silently consume - the sidebar usage indicator handles display
            } else {
              // Either a warning (allowed_warning) or an actual block - show in transcript
              // Pass resetsAt as Unix timestamp (seconds) to avoid timezone issues with ISO string parsing
              const resetsAtUnix = info.resetsAt || null;
              const limitType = info.rateLimitType === 'five_hour' ? '5-hour session' : info.rateLimitType || 'unknown';
              const utilization = info.utilization != null ? Math.round(info.utilization * 100) : null;
              const isWarning = info.status === 'allowed_warning';
              const marker = isWarning ? '[RATE_LIMIT_WARNING]' : '[RATE_LIMIT]';
              const utilizationStr = utilization != null ? ` usage=${utilization}` : '';
              // Yield as text (not error) so it doesn't interrupt the stream or trigger error handling
              yield {
                type: 'text',
                content: `\n\n<!-- ${marker} limitType=${limitType} resetsAtUnix=${resetsAtUnix || 'unknown'}${utilizationStr} -->\n\n`
              };
            }
          } else {
            // Unknown chunk type - display it anyway so nothing is lost

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
              yield {
                type: 'text',
                content: extractedContent
              };
            }

            // Also check if this looks like an error
            const chunkStr = JSON.stringify(chunk).toLowerCase();
            if (chunkStr.includes('error') || chunkStr.includes('fail') || chunkStr.includes('invalid')) {
            }
          }
          }
        }
      } catch (iterError) {
        // Don't log abort errors - they're expected when user cancels
        const errMessage = (iterError as Error).message || '';
        const isAbort = (iterError as any).name === 'AbortError' || errMessage.includes('aborted');
        if (!isAbort) {
          console.error('[CLAUDE-CODE] Error during iteration:', iterError);
          console.error('[CLAUDE-CODE] Error stack:', (iterError as Error).stack);
        }
        throw iterError;
      }

      // ── Process queued teammate messages via streamInput ──────────────
      // After the main loop exits naturally, drain any pending teammate-to-lead
      // messages. Each is injected as a new user turn on the existing query via
      // streamInput. Skip if the query was interrupted — after interrupt() the
      // transport is dead and streamInput will always fail. Messages stay queued
      // for the finally block to re-trigger via a fresh sendMessage.
      while (this.teammateManager.hasPendingTeammateMessages() && this.leadQuery && !this.wasInterrupted) {
        const nextMsg = this.teammateManager.drainNextTeammateMessage();
        if (!nextMsg) break;

        const formattedMessage = `[Teammate message from "${nextMsg.teammateName}"]\n\n${nextMsg.content}`;
        console.log(`[CLAUDE-CODE] Processing queued teammate message via streamInput: "${nextMsg.summary}"`);

        // Log the injected user message to the DB so the conversation is complete.
        // Uses non-blocking since we're mid-turn and don't need to await persistence.
        if (sessionId) {
          this.logAgentMessageNonBlocking(
            sessionId, 'claude-code', 'input',
            JSON.stringify({ prompt: formattedMessage }),
            { messageType: 'teammate_message_injected', teammateName: nextMsg.teammateName }
          );
        }

        try {
          await this.leadQuery.streamInput(
            this.teammateManager.createInjectedUserMessageStream(formattedMessage)
          );
        } catch (streamErr) {
          console.warn('[CLAUDE-CODE] streamInput failed for teammate message:', streamErr);
          // Lead transport is dead. Re-queue the message so the finally block
          // can re-trigger delivery via a fresh sendMessage call.
          this.teammateManager.requeueTeammateMessage(nextMsg);
          this.transportDied = true;
          break;
        }

        // Consume output from the new turn (same chunk processing)
        try {
          for await (const rawChunk of (this.leadQuery as AsyncIterable<any>)) {
            if (this.abortController?.signal.aborted) {
              console.log('[CLAUDE-CODE] Abort signal detected during teammate message processing');
              break;
            }
            const chunk = typeof rawChunk === 'string' ? rawChunk : rawChunk;

            if (typeof chunk === 'string') {
              fullContent += chunk;
              yield { type: 'text', content: chunk };
            } else if (chunk && typeof chunk === 'object') {
              if (chunk.type === 'result') {
                if (chunk.usage) {
                  usageData = {
                    ...(usageData || {}),
                    input_tokens: (usageData?.input_tokens || 0) + (chunk.usage.input_tokens || 0),
                    output_tokens: (usageData?.output_tokens || 0) + (chunk.usage.output_tokens || 0),
                  };
                }
              } else if (chunk.type === 'assistant' && chunk.message?.content) {
                for (const block of chunk.message.content) {
                  if (block.type === 'text' && block.text) {
                    fullContent += block.text;
                    yield { type: 'text', content: block.text };
                  } else if (block.type === 'tool_use') {
                    toolCallCount++;
                    if (sessionId) {
                      this.logAgentMessageNonBlocking(
                        sessionId, 'claude-code', 'output',
                        JSON.stringify(block),
                        { messageType: 'tool_use', toolName: block.name }
                      );
                    }
                  } else if (block.type === 'tool_result') {
                    if (sessionId) {
                      this.logAgentMessageNonBlocking(
                        sessionId, 'claude-code', 'output',
                        JSON.stringify(block),
                        { messageType: 'tool_result' }
                      );
                    }
                  }
                }
              }
            }
          }
        } catch (iterError) {
          const errMessage = (iterError as Error).message || '';
          const isAbort = (iterError as any).name === 'AbortError' || errMessage.includes('aborted');
          if (!isAbort) {
            console.error('[CLAUDE-CODE] Error during teammate message iteration:', iterError);
          }
          throw iterError;
        }
      }

      // Check if this was a slash command that returned no output
      // This helps users understand when a command doesn't exist or failed silently
      // Skip this check if we received a compact_boundary (compact outputs via system message, not fullContent)
      if (isSlashCommand && fullContent.trim().length === 0 && toolCallCount === 0 && !receivedCompactBoundary) {
        // Extract the command name from the message for the error message
        const commandMatch = message.trimStart().match(/^\/(\S+)/);
        const commandName = commandMatch ? commandMatch[1] : 'unknown';

        const errorMessage = `The command "/${commandName}" did not produce any output. This command may not exist or may have failed silently. Try typing "/" to see available commands.`;
        // console.error(`[CLAUDE-CODE] Slash command /${commandName} returned no output`);

        // Log error to database for persistence
        // The logError call saves the message to the database and emits 'message:logged'
        // which triggers a session reload in the UI, displaying the error
        // Do NOT yield an error chunk here - that would cause duplicate display via ai:error IPC
        // Pass hideMessages so /context errors (auto-triggered) stay hidden
        this.logError(sessionId, 'claude-code', new Error(errorMessage), 'slash_command', 'slash_command_error', hideMessages);
      }

      // Send completion event
      const totalTime = Date.now() - startTime;

      // Flush all pending non-blocking DB writes before signaling completion.
      // Without this, the UI receives session:completed and reloads from DB
      // before the final messages (e.g. compact_boundary, continuation, result)
      // have been committed, causing a stale transcript.
      await this.flushPendingWrites();

      // Create snapshots for all files edited during this turn
      if (this.toolHooksService && this.toolHooksService.getEditedFiles().size > 0) {
        await this.toolHooksService.createTurnEndSnapshots();
      }

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

      // Compute context fill from last assistant message's usage (not cumulative result.usage).
      // Formula: input_tokens + cache_read_input_tokens + cache_creation_input_tokens
      // This reflects actual tokens in context window and updates after compaction.
      // CRITICAL: Use lastAssistantUsage, NOT usageData (which gets overwritten by cumulative result.usage).
      const lastMessageContextTokens = lastAssistantUsage
        ? (lastAssistantUsage.input_tokens || 0)
          + (lastAssistantUsage.cache_read_input_tokens || 0)
          + (lastAssistantUsage.cache_creation_input_tokens || 0)
        : undefined;

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
        ...(modelUsageData ? { modelUsage: modelUsageData } : {}),
        // Context fill from last assistant message (for context window display)
        ...(lastMessageContextTokens !== undefined ? { contextFillTokens: lastMessageContextTokens } : {}),
        // Signal that compaction happened so AIService clears stale currentContext
        ...(receivedCompactBoundary ? { contextCompacted: true } : {})
      };


    } catch (error: any) {
      const errorTime = Date.now() - startTime;
      const isAbort = error.name === 'AbortError' || error.message?.includes('aborted');

      // Only log details for non-abort errors
      if (!isAbort) {
        console.error(`[CLAUDE-CODE] ========== ERROR in sendMessage ==========`);
        console.error(`[CLAUDE-CODE] Error occurred after ${errorTime}ms`);
        console.error(`[CLAUDE-CODE] Error name: ${error.name}`);
        console.error(`[CLAUDE-CODE] Error message: ${error.message}`);
        console.error(`[CLAUDE-CODE] Error stack:`, error.stack);
      }

      if (isAbort) {
        // Abort is expected - user cancelled, don't log as error
        await this.flushPendingWrites();
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error(`[CLAUDE-CODE] Error occurred`);

        // If we were trying to resume a session, check if it's missing
        const resumeSessionId = sessionId ? this.sessions.getSessionId(sessionId) : null;
        if (resumeSessionId) {
          const sessionExists = await this.checkSessionExists(resumeSessionId);
          if (!sessionExists) {
            console.error(`[CLAUDE-CODE] Session ${resumeSessionId} not found - user needs to create new session`);
            this.sessions.deleteSession(sessionId!);

            yield {
              type: 'error',
              error: 'Your previous conversation session has expired or been cleaned up. Please create a new session to continue.'
            };

            // CRITICAL: Always send completion after error to clean up UI state
            await this.flushPendingWrites();
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
        await this.flushPendingWrites();
        yield {
          type: 'complete'
        };
      }
    } finally {
      this.leadQuery = null;
      this.abortController = null;
      this.wasInterrupted = false;
      this.interruptResolve = null;
      // Note: markMessagesAsHidden is reset at the START of sendMessage to prevent race conditions

      // If teammate messages are still queued (e.g. streamInput failed for a drained
      // message), re-trigger delivery now that leadQuery is null. This mirrors the
      // "lead is idle" path in interruptWithMessage.
      if (this.teammateManager.hasPendingTeammateMessages()) {
        // Drain ALL pending messages into a single formatted prompt
        const messages: Array<{teammateName: string; content: string; summary: string}> = [];
        while (this.teammateManager.hasPendingTeammateMessages()) {
          const msg = this.teammateManager.drainNextTeammateMessage();
          if (msg) messages.push(msg);
          else break;
        }
        if (messages.length > 0) {
          const formatted = messages
            .map(msg => `[Teammate message from "${msg.teammateName}"]\n\n${msg.content}`)
            .join('\n\n---\n\n');
          const summaries = messages.map(msg => msg.summary).join(', ');
          console.log(`[CLAUDE-CODE] Re-triggering ${messages.length} teammate message(s) after sendMessage exit: "${summaries}"`);
          this.teammateIdleMessagePending = true;
          this.emit('teammate:messageWhileIdle', {
            sessionId: this.teammateManager.lastUsedSessionId,
            message: formatted,
          });
        }
      } else if (this.transportDied) {
        // Transport died and no pending messages to re-trigger.
        // Abandon idle teammates since they can't be resumed.
        this.teammateManager.abandonIdleTeammates(sessionId);
      } else if (this.teammateManager.hasActiveTeammates() && !hideMessages) {
        // Skip for hidden commands (e.g., /context auto-fetch) — those are internal
        // bookkeeping calls that shouldn't drive teammate lifecycle.
        if (this.teammateManager.hasOnlyBackgroundAgents()) {
          // Only background agents (sub-agents) remain — no idle teammates to manage.
          // Don't trigger a continuation; the lead can't do anything useful for sub-agents.
          // The session stays deferred; teammates:allCompleted will fire when they finish
          // and deliverMessageToLead will restart the lead if there are results to deliver.
          console.log(`[CLAUDE-CODE] Lead turn ended with ${this.teammateManager.getActiveAgentCount()} background agent(s) still running, waiting for completion`);
          this.continuationCount = 0;
        } else if (this.teammateManager.hasPendingTeammateMessages()) {
          // Messages arrived while we were in the finally block (race between
          // streaming loop exit and interruptWithMessage). Drain and deliver them
          // instead of triggering a continuation or abandoning.
          const messages: Array<{teammateName: string; content: string; summary: string}> = [];
          while (this.teammateManager.hasPendingTeammateMessages()) {
            const msg = this.teammateManager.drainNextTeammateMessage();
            if (msg) messages.push(msg);
            else break;
          }
          if (messages.length > 0) {
            const formatted = messages
              .map(msg => `[Teammate message from "${msg.teammateName}"]\n\n${msg.content}`)
              .join('\n\n---\n\n');
            const summaries = messages.map(msg => msg.summary).join(', ');
            console.log(`[CLAUDE-CODE] Finally block found ${messages.length} pending teammate message(s), delivering: "${summaries}"`);
            this.continuationCount = 0;
            this.teammateIdleMessagePending = true;
            this.emit('teammate:messageWhileIdle', {
              sessionId: this.teammateManager.lastUsedSessionId,
              message: formatted,
            });
          }
        } else if (this.continuationCount < ClaudeCodeProvider.MAX_CONTINUATIONS) {
          // The lead's turn ended naturally but idle teammates exist that need managing.
          // Trigger a continuation so the lead gets another turn.
          // Guard: continuationCount prevents infinite loops if the lead's
          // continuation turns keep ending without resolving agents.
          console.log(`[CLAUDE-CODE] Lead turn ended with active agents, triggering continuation (${this.continuationCount + 1}/${ClaudeCodeProvider.MAX_CONTINUATIONS})`);
          this.continuationCount++;
          this.teammateIdleMessagePending = true;
          this.emit('teammate:messageWhileIdle', {
            sessionId: this.teammateManager.lastUsedSessionId,
            message: '[System: Your previous turn ended but you still have active agents. Wait for their results, or take other actions as needed.]',
          });
        } else {
          // Max continuations exhausted and the lead still didn't resolve teammates.
          // Abandon idle teammates to unstick the session.
          console.log(`[CLAUDE-CODE] Lead exhausted ${ClaudeCodeProvider.MAX_CONTINUATIONS} continuations without resolving teammates, abandoning idle teammates`);
          this.teammateManager.abandonIdleTeammates(sessionId);
          this.continuationCount = 0;
        }
      }

      this.transportDied = false;
    }
  }

  abort(): void {
    console.log('[CLAUDE-CODE] Abort called, abortController:', this.abortController ? 'exists' : 'NULL');

    // Resolve the interrupt promise so the Promise.race in the streaming loop
    // settles immediately, preventing the loop from hanging on a dead transport.
    if (this.interruptResolve) {
      this.interruptResolve();
      this.interruptResolve = null;
    }

    // Call base class abort (handles abortController and rejectAllPendingPermissions)
    super.abort();

    // Clean up Claude Code-specific pending user interactions
    this.rejectAllPendingConfirmations();
    this.rejectAllPendingQuestions();

    // Abort all managed teammates
    this.teammateManager.killAll();
  }

  /**
   * Interrupt the lead agent's current turn and queue a teammate message
   * to be delivered as a new user turn via streamInput.
   *
   * - If the lead is idle (no active query): stores the message for the next
   *   sendMessage() call and emits an event so AIService can trigger processing.
   * - If the lead has an active query: attempts interrupt() so the sendMessage()
   *   loop can inject the message via streamInput on the live transport. If the
   *   transport is already dead (turn finished but generator hasn't reached
   *   finally yet), interrupt() will fail gracefully and the message stays
   *   queued for the finally block to handle via resume.
   */
  async interruptWithMessage(message: string): Promise<void> {
    // A real teammate message arrived — reset the continuation guard so
    // the lead can get another continuation if its next turn also ends
    // with active teammates.
    this.continuationCount = 0;

    if (!this.leadQuery) {
      // Guard against duplicate idle triggers: if a teammate:messageWhileIdle event
      // was already emitted but sendMessage hasn't started yet, don't drain another.
      // The pending sendMessage will process the queue via its while loop.
      if (this.teammateIdleMessagePending) {
        console.log('[CLAUDE-CODE] interruptWithMessage: idle message already pending, skipping duplicate trigger');
        return;
      }

      // Drain ALL pending messages into a single formatted prompt
      const messages: Array<{teammateName: string; content: string; summary: string; teammateAgentId: string}> = [];
      while (this.teammateManager.hasPendingTeammateMessages()) {
        const msg = this.teammateManager.drainNextTeammateMessage();
        if (msg) messages.push(msg);
        else break;
      }
      if (messages.length === 0) return;

      const formatted = messages
        .map(msg => `[Teammate message from "${msg.teammateName}"]\n\n${msg.content}`)
        .join('\n\n---\n\n');
      const summaries = messages.map(msg => msg.summary).join(', ');
      console.log(`[CLAUDE-CODE] interruptWithMessage: lead is idle, triggering sendMessage for ${messages.length} message(s): "${summaries}"`);
      this.teammateIdleMessagePending = true;
      this.emit('teammate:messageWhileIdle', {
        sessionId: this.teammateManager.lastUsedSessionId,
        message: formatted,
      });
      return;
    }

    // Interrupt the lead query. After interrupt(), the transport is dead and
    // streamInput will always fail. Set wasInterrupted so the while loop after
    // the for-await skips streamInput and lets the finally block re-trigger
    // delivery via a fresh sendMessage call.
    console.log('[CLAUDE-CODE] interruptWithMessage: interrupting active lead query');
    this.wasInterrupted = true;

    // Resolve the interrupt promise FIRST so the Promise.race in the streaming
    // loop settles immediately — this unblocks the JS side without waiting for
    // the SDK subprocess to acknowledge the interrupt.
    if (this.interruptResolve) {
      this.interruptResolve();
      this.interruptResolve = null;
    }

    try {
      await this.leadQuery.interrupt();
    } catch (err) {
      console.warn('[CLAUDE-CODE] interruptWithMessage: interrupt() failed (transport may be closed):', err);
    }
  }

  /**
   * Clean up provider resources including active subprocess
   * Called when provider is destroyed (e.g., app quit, session cleanup)
   */
  destroy(): void {
    console.log('[CLAUDE-CODE] Destroying provider');

    // Clean up permission service
    if (this.permissionService) {
      this.permissionService.clearSessionCache();
      this.permissionService.rejectAllPending();
    }

    // Abort any active SDK subprocess and reject all pending user interactions
    // Base class destroy() calls abort(), sessions.clear(), permissions.clearSessionCache(), and removeAllListeners()
    super.destroy();
  }

  /**
   * Stop a specific managed teammate by name
   */
  public stopManagedTeammate(name: string): boolean {
    return this.teammateManager.stop(name);
  }

  /**
   * Check if any teammates are still active (running or idle).
   * Used by AIService to decide whether to defer endSession().
   */
  public hasActiveTeammates(): boolean {
    return this.teammateManager.hasActiveTeammates();
  }

  /**
   * Check if the lead is currently processing or about to process a message.
   * True when leadQuery is set (actively streaming) or when a
   * teammate:messageWhileIdle event was emitted but sendMessage hasn't started yet.
   * Used by the teammates:allCompleted handler to avoid ending the session
   * while the lead is mid-turn.
   */
  public isLeadBusy(): boolean {
    return this.leadQuery !== null || this.teammateIdleMessagePending;
  }

  /**
   * Check if the lead will resume after the current query completes.
   * Unlike isLeadBusy(), this does NOT check leadQuery (which is still set
   * when called from inside the generator's for-await loop). Checks both:
   * - teammateIdleMessagePending: a re-trigger event was already emitted
   * - hasPendingTeammateMessages: messages are queued but not yet triggered
   *   (e.g., interruptWithMessage queued a message and called interrupt(),
   *   but the finally block hasn't run yet to re-trigger delivery)
   * Used by AIService's 'complete' chunk handler.
   */
  public willResumeAfterCompletion(): boolean {
    return this.teammateIdleMessagePending || this.teammateManager.hasPendingTeammateMessages();
  }

  /**
   * Process teammate-related side-effects after a tool_result is received.
   * Called from both chunk-processing paths to avoid duplication.
   */
  private processTeammateToolResult(
    sessionId: string | undefined,
    toolName: string,
    toolArguments: Record<string, unknown> | undefined,
    toolResult: unknown,
    isError: boolean,
    toolUseId?: string,
  ): void {
    // Detect shutdown_request results from SDK-handled SendMessage.
    // Skip if handlePreToolUse already handled this shutdown (resumed the teammate
    // for approval handshake) — otherwise we'd redundantly abort the just-resumed teammate.
    if (toolName === 'SendMessage' && toolArguments?.type === 'shutdown_request') {
      if (!this.teammateManager.consumeHandledShutdown(toolUseId)) {
        const shutdownRecipient = toolArguments.recipient;
        if (typeof shutdownRecipient === 'string' && shutdownRecipient) {
          this.teammateManager.handleShutdownResult(sessionId, shutdownRecipient);
        }
      }
    }

    // Track team context from TeamCreate/TeamDelete results
    this.teammateManager.updateTeamContextFromToolResult(
      toolName,
      toolArguments,
      toolResult,
      isError,
    );
  }

  /**
   * Update session metadata with current todos
   * Uses the existing metadata update mechanism instead of custom IPC events
   */
  private async emitTodoUpdate(sessionId: string | undefined, todos: any[]): Promise<void> {

    if (!sessionId) {
      return;
    }

    try {
      // Update session metadata with the current todos
      // This will trigger session reloads which will update the UI

      // Import AISessionsRepository dynamically
      const { AISessionsRepository } = await import('../../../storage/repositories/AISessionsRepository');

      // Get current session to merge metadata
      const currentSession = await AISessionsRepository.get(sessionId);

      const currentMetadata = currentSession?.metadata || {};

      await AISessionsRepository.updateMetadata(sessionId, {
        metadata: {
          ...currentMetadata,
          currentTodos: todos
        }
      });


      // Emit message:logged event to trigger UI reload
      // This will cause the AgenticPanel to reload the session and pick up the new todos
      this.emit('message:logged', {
        sessionId,
        direction: 'output'
      });
    } catch (error) {
      console.error('[CLAUDE-CODE] Failed to update session metadata with todos:', error);
      console.error('[CLAUDE-CODE] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    }
  }

  private async emitTaskUpdate(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;

    try {
      const { AISessionsRepository } = await import('../../../storage/repositories/AISessionsRepository');
      const currentSession = await AISessionsRepository.get(sessionId);
      const currentMetadata = currentSession?.metadata || {};

      await AISessionsRepository.updateMetadata(sessionId, {
        metadata: {
          ...currentMetadata,
          currentTasks: Array.from(this.activeTasks.values()),
        }
      });

      this.emit('message:logged', { sessionId, direction: 'output' });
    } catch (error) {
      console.error('[CLAUDE-CODE] Failed to update session metadata with tasks:', error);
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

  getProviderSessionData(sessionId: string): any {
    const { providerSessionId } = this.sessions.getProviderSessionData(sessionId);
    return {
      claudeSessionId: providerSessionId,
    };
  }

  /**
   * Resolve a pending ExitPlanMode confirmation request
   * Called by AIService when renderer responds to confirmation prompt
   * @param requestId - Unique ID for this confirmation request
   * @param response - User's response containing:
   *   - approved: Whether to exit plan mode
   *   - clearContext: If true, clear the session context for a fresh start
   *   - feedback: Optional feedback message when denying (continue planning)
   */
  public resolveExitPlanModeConfirmation(
    requestId: string,
    response: { approved: boolean; clearContext?: boolean; feedback?: string },
    sessionId?: string,
    respondedBy: 'desktop' | 'mobile' = 'desktop'
  ): void {
    const pending = this.pendingExitPlanModeConfirmations.get(requestId);
    if (pending) {
      pending.resolve(response);
      this.pendingExitPlanModeConfirmations.delete(requestId);

      // Persist the response as a message for sync and audit trail
      if (sessionId) {
        const responseContent = {
          type: 'exit_plan_mode_response' as const,
          requestId,
          approved: response.approved,
          clearContext: response.clearContext,
          feedback: response.feedback,
          respondedAt: Date.now(),
          respondedBy,
        };
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify(responseContent),
          { messageType: 'exit_plan_mode_response' }
        ).catch(err => {
          console.error('[CLAUDE-CODE] Failed to persist ExitPlanMode response:', err);
        });
      }
      // TODO: Debug logging - uncomment if needed
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
  ): boolean {
    const pending = this.pendingAskUserQuestions.get(questionId);
    if (pending) {
      pending.resolve(answers);
      this.pendingAskUserQuestions.delete(questionId);

      // Log as nimbalyst_tool_result to complete the tool call
      // This sets toolCall.result which changes widget from interactive to completed
      if (sessionId) {
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify({
            type: 'nimbalyst_tool_result',
            tool_use_id: questionId,
            result: JSON.stringify({ answers, respondedAt: Date.now(), respondedBy })
          })
        ).catch(err => {
          console.error('[CLAUDE-CODE] Failed to persist AskUserQuestion response:', err);
        });
      }
      return true;
    } else {
      console.warn(`[CLAUDE-CODE] No pending AskUserQuestion found for questionId: ${questionId}`);
      return false;
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

      // Log as nimbalyst_tool_result with error flag to mark as cancelled
      if (sessionId && sessionId !== 'unknown') {
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify({
            type: 'nimbalyst_tool_result',
            tool_use_id: questionId,
            result: JSON.stringify({ cancelled: true, respondedAt: Date.now() }),
            is_error: true
          })
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
    // Try ToolPermissionService first (primary path when service is available)
    if (this.permissionService) {
      this.permissionService.resolvePermission(requestId, response);
    }

    // Also check the inline pending map (used by AgentToolHooks compound bash checks,
    // including those from teammate sessions which create promises in this map)
    if (this.permissions.pendingToolPermissions.has(requestId)) {
      this.permissions.resolveToolPermission(
        requestId,
        response,
        (_reqId, resp, by) => {
          if (sessionId) {
            this.logAgentMessage(
              sessionId,
              'claude-code',
              'output',
              this.createPermissionResultMessage(_reqId, resp, by)
            ).catch(err => {
              console.error('[CLAUDE-CODE] Failed to persist permission response:', err);
            });
          }
        },
        respondedBy
      );
      return;
    }

    // Persist the response as nimbalyst_tool_result for widget rendering
    if (this.permissionService && sessionId) {
      this.logAgentMessage(
        sessionId,
        'claude-code',
        'output',
        this.createPermissionResultMessage(requestId, response, respondedBy)
      ).catch(err => {
        console.error('[CLAUDE-CODE] Failed to persist permission response:', err);
      });
      return;
    }

    // Fallback: resolve via the mixin's pending map (for tests or when service not available)
    this.permissions.resolveToolPermission(
      requestId,
      response,
      (_reqId, resp, by) => {
        if (sessionId) {
          this.logAgentMessage(
            sessionId,
            'claude-code',
            'output',
            this.createPermissionResultMessage(_reqId, resp, by)
          ).catch(err => {
            console.error('[CLAUDE-CODE] Failed to persist permission response:', err);
          });
        }
      },
      respondedBy
    );
  }

  /**
   * Reject a pending tool permission request (e.g., on cancel/abort)
   * @param sessionId - Session ID for persisting the cancellation message
   */
  public rejectToolPermission(requestId: string, error: Error, sessionId?: string): void {
    // Try ToolPermissionService first (primary path)
    if (this.permissionService) {
      this.permissionService.rejectPermission(requestId, error);
      if (sessionId) {
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          this.createPermissionCancellationMessage(requestId)
        ).catch(err => {
          console.error('[CLAUDE-CODE] Failed to persist permission cancellation:', err);
        });
      }
      return;
    }

    // Fallback: reject via the mixin's pending map
    this.permissions.rejectToolPermission(requestId, error, (_reqId) => {
      if (sessionId) {
        this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          this.createPermissionCancellationMessage(_reqId)
        ).catch(err => {
          console.error('[CLAUDE-CODE] Failed to persist permission cancellation:', err);
        });
      }
    });
  }

  /**
   * Reject all pending tool permission requests (e.g., on abort)
   */
  public rejectAllPendingPermissions(): void {
    this.permissions.rejectAllPendingPermissions();
  }

  /**
   * Poll for a permission response message in the session.
   * This enables mobile and cross-session responses.
   * When a response is found, it resolves the pending permission promise.
   */
  protected async pollForPermissionResponse(
    sessionId: string,
    requestId: string,
    signal: AbortSignal
  ): Promise<void> {
    const pollInterval = 500; // ms
    const maxPollTime = 10 * 60 * 1000; // 10 minutes max
    const startTime = Date.now();

    while (!signal.aborted && Date.now() - startTime < maxPollTime) {
      // Check if request was already resolved (e.g., via IPC)
      if (!this.permissions.pendingToolPermissions.has(requestId)) {
        return; // Already resolved, stop polling
      }

      try {
        // Get recent messages for this session
        const messages = await AgentMessagesRepository.list(sessionId, { limit: 50 });

        // Look for a nimbalyst_tool_result that matches our requestId
        for (const msg of messages) {
          try {
            const content = JSON.parse(msg.content);
            // Check for new nimbalyst_tool_result format
            if (content.type === 'nimbalyst_tool_result' && content.tool_use_id === requestId) {
              // Found a response - parse the result and resolve
              const result = typeof content.result === 'string' ? JSON.parse(content.result) : content.result;
              const pending = this.permissions.pendingToolPermissions.get(requestId);
              if (pending && result.decision) {
                pending.resolve({
                  decision: result.decision,
                  scope: result.scope
                });
                this.permissions.pendingToolPermissions.delete(requestId);
                this.logSecurity('[pollForPermissionResponse] Found nimbalyst_tool_result:', {
                  requestId,
                  decision: result.decision,
                  scope: result.scope,
                  respondedBy: result.respondedBy
                });
              }
              return;
            }
            // Legacy: also check for permission_response (for backwards compatibility)
            if (content.type === 'permission_response' && content.requestId === requestId) {
              const pending = this.permissions.pendingToolPermissions.get(requestId);
              if (pending) {
                pending.resolve({
                  decision: content.decision,
                  scope: content.scope
                });
                this.permissions.pendingToolPermissions.delete(requestId);
                this.logSecurity('[pollForPermissionResponse] Found legacy permission_response:', {
                  requestId,
                  decision: content.decision,
                  scope: content.scope,
                  respondedBy: content.respondedBy
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


  /**
   * Build a human-readable description of a tool call for permission checking.
   * For Bash, the command itself is used. For other tools, we create a descriptive string.
   */

  /**
   * Create canUseTool handler for permission requests.
   * The SDK evaluates settings.json rules first. This handler is only called when:
   * 1. No matching rule was found in settings.json
   * 2. The tool needs user approval
   *
   * Our job is to show UI, wait for user response, and save patterns if "Always" is chosen.
   */
  private createCanUseToolHandler(sessionId?: string, workspacePath?: string, permissionsPath?: string, teammateName?: string) {
    // Use permissionsPath for trust checks (parent project for worktrees), workspacePath for everything else
    const pathForTrust = permissionsPath || workspacePath;

    return async (
      toolName: string,
      input: any,
      options: { signal: AbortSignal; suggestions?: any[]; toolUseID?: string }
    ): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }> => {
      // Log all tool permission checks (verbose - uncomment for debugging)
      // this.logSecurity('[canUseTool] Tool call received:', {
      //   toolName,
      //   workspacePath: workspacePath?.slice(-30),
      //   permissionsPath: permissionsPath?.slice(-30),
      // });

      // Internal Nimbalyst MCP tools that should always be allowed without permission prompts.
      // These are either read-only, display-only, or interactive widgets where the user
      // confirms/denies the action within the widget itself (e.g., commit proposal).
      const internalMcpTools = [
        'mcp__nimbalyst-session-naming__update_session_meta',
        'mcp__nimbalyst-mcp__capture_editor_screenshot',
        'mcp__nimbalyst-mcp__display_to_user',
        'mcp__nimbalyst-mcp__voice_agent_speak',
        'mcp__nimbalyst-mcp__voice_agent_stop',
        'mcp__nimbalyst-mcp__get_session_edited_files',
        'mcp__nimbalyst-mcp__developer_git_commit_proposal',
        'mcp__nimbalyst-mcp__developer_git_log',
        'mcp__nimbalyst-session-context__get_session_summary',
        'mcp__nimbalyst-session-context__get_workstream_overview',
        'mcp__nimbalyst-session-context__list_recent_sessions',
        'mcp__nimbalyst-session-context__get_workstream_edited_files',
      ];

      if (internalMcpTools.includes(toolName)) {
        // this.logSecurity('[canUseTool] Auto-allowing internal MCP tool:', { toolName });
        return { behavior: 'allow', updatedInput: input };
      }

      // Handle AskUserQuestion separately - it's about getting user input, not permission
      if (toolName === 'AskUserQuestion') {
        return this.handleAskUserQuestion(sessionId, input, options, options.toolUseID);
      }

      // ExitPlanMode is handled by our PreToolUse hook with a custom widget.
      // Auto-allow here to prevent the SDK from showing a generic permission dialog
      // if our hook times out or the SDK falls back to canUseTool.
      if (toolName === 'ExitPlanMode') {
        return { behavior: 'allow', updatedInput: input };
      }

      // Agent Teams tools should always be allowed without prompts
      // These are SDK-native tools for team coordination and task management
      const teamTools = ['SendMessage', 'TaskCreate', 'TaskList', 'TaskUpdate', 'TaskGet', 'TeamCreate', 'TeamDelete', 'TeammateTool', 'TodoRead', 'TodoWrite'];
      if (teamTools.includes(toolName)) {
        if (toolName === 'TeamDelete') {
          const hasExplicitTeam =
            typeof input?.team_name === 'string' && input.team_name.trim().length > 0;

          // TeamDelete can be called without args and relies on ambient team context.
          // Rehydrate context and inject team_name when available to avoid no-op deletes.
          if (!hasExplicitTeam) {
            const inferredTeam = await this.teammateManager.resolveTeamContext(sessionId);
            if (inferredTeam) {
              return {
                behavior: 'allow',
                updatedInput: {
                  ...input,
                  team_name: inferredTeam,
                }
              };
            }
          }
        }

        // this.logSecurity('[canUseTool] Auto-allowing team tool:', { toolName });
        return { behavior: 'allow', updatedInput: input };
      }

      // Check workspace trust before allowing any tools
      // Use permissionsPath (parent project for worktrees) for trust checks
      if (pathForTrust && BaseAgentProvider.trustChecker) {
        const trustStatus = BaseAgentProvider.trustChecker(pathForTrust);
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
          // this.logSecurity('[canUseTool] Bypass-all mode, auto-approving:', { toolName });
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

      // Use ToolPermissionService if available, otherwise fall back to inline logic
      if (this.permissionService && sessionId && workspacePath) {
        try {
          const requestId = `tool-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const pattern = generateToolPattern(toolName, input);
          const toolDescription = buildToolDescription(toolName, input);
          const isDestructive = ['Write', 'Edit', 'MultiEdit', 'Bash'].includes(toolName);
          const patternDisplay = getPatternDisplayName(pattern);

          this.logSecurity('[canUseTool] Requesting permission via ToolPermissionService:', {
            toolName,
            pattern,
            requestId,
          });

          // Log as nimbalyst_tool_use for UI widget rendering
          await this.logAgentMessage(
            sessionId,
            'claude-code',
            'output',
            JSON.stringify({
              type: 'nimbalyst_tool_use',
              id: requestId,
              name: 'ToolPermission',
              input: {
                requestId,
                toolName,
                rawCommand: toolName === 'Bash' ? input?.command || '' : toolDescription,
                pattern,
                patternDisplayName: patternDisplay,
                isDestructive,
                warnings: [],
                workspacePath,
                ...(teammateName && { teammateName }),
              }
            })
          );

          // Request permission via service
          const response = await this.permissionService.requestToolPermission({
            requestId,
            sessionId,
            workspacePath,
            permissionsPath: permissionsPath || workspacePath,
            toolName,
            toolInput: input,
            pattern,
            patternDisplayName: patternDisplay,
            toolDescription,
            isDestructive,
            warnings: [],
            signal: options.signal,
            teammateName,
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
      }

      // Fallback: inline permission logic (for tests or when service not available)
      // This path is kept for backwards compatibility and testing
      const pattern = generateToolPattern(toolName, input);
      if (this.permissions.sessionApprovedPatterns.has(pattern)) {
        this.logSecurity('[canUseTool] Pattern already approved this session:', { pattern, toolName });
        return { behavior: 'allow', updatedInput: input };
      }
      if (toolName === 'WebFetch' && this.permissions.sessionApprovedPatterns.has('WebFetch')) {
        this.logSecurity('[canUseTool] WebFetch wildcard approved this session:', { toolName });
        return { behavior: 'allow', updatedInput: input };
      }

      const requestId = `tool-${sessionId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toolDescription = buildToolDescription(toolName, input);
      const isDestructive = ['Write', 'Edit', 'MultiEdit', 'Bash'].includes(toolName);
      const rawCommand = toolName === 'Bash' ? input?.command || '' : toolDescription;
      const patternDisplay = getPatternDisplayName(pattern);

      this.logSecurity('[canUseTool] Showing permission prompt (fallback):', {
        toolName,
        toolDescription: toolDescription.slice(0, 100),
        requestId,
      });

      if (sessionId) {
        await this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify({
            type: 'nimbalyst_tool_use',
            id: requestId,
            name: 'ToolPermission',
            input: {
              requestId,
              toolName,
              rawCommand,
              pattern,
              patternDisplayName: patternDisplay,
              isDestructive,
              warnings: [],
              workspacePath,
            }
          })
        );
      }

      const request = {
        id: requestId,
        toolName,
        rawCommand,
        actionsNeedingApproval: [{
          action: {
            pattern,
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

      const responsePromise = new Promise<{ decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' }>((resolve, reject) => {
        this.permissions.pendingToolPermissions.set(requestId, {
          resolve,
          reject,
          request
        });

        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            this.permissions.pendingToolPermissions.delete(requestId);
            reject(new Error('Request aborted'));
          }, { once: true });
        }
      });

      if (sessionId) {
        this.pollForPermissionResponse(sessionId, requestId, options.signal).catch(() => {});
      }

      this.emit('toolPermission:pending', {
        requestId,
        sessionId,
        workspacePath,
        request,
        timestamp: Date.now()
      });

      try {
        const response = await responsePromise;

        this.logSecurity('[canUseTool] User response received (fallback):', {
          toolName,
          decision: response.decision,
          scope: response.scope,
        });

        const isCompoundCommand = pattern.startsWith('Bash:compound:');
        if (response.decision === 'allow' && response.scope !== 'once' && !isCompoundCommand) {
          if (response.scope === 'always-all' && toolName === 'WebFetch') {
            this.permissions.sessionApprovedPatterns.add('WebFetch');
            this.logSecurity('[canUseTool] Added wildcard pattern to session cache:', { pattern: 'WebFetch', scope: response.scope });
          } else {
            this.permissions.sessionApprovedPatterns.add(pattern);
            this.logSecurity('[canUseTool] Added pattern to session cache:', { pattern, scope: response.scope });
          }
        }

        if (response.decision === 'allow' && (response.scope === 'always' || response.scope === 'always-all') && workspacePath && !isCompoundCommand) {
          if (ClaudeCodeProvider.claudeSettingsPatternSaver) {
            try {
              const patternToSave = (response.scope === 'always-all' && toolName === 'WebFetch') ? 'WebFetch' : pattern;
              await ClaudeCodeProvider.claudeSettingsPatternSaver(workspacePath, patternToSave);
              this.logSecurity('[canUseTool] Saved pattern to Claude settings:', { pattern: patternToSave });
            } catch (saveError) {
              console.error('[CLAUDE-CODE] Failed to save pattern:', saveError);
            }
          }
        }

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
        // Emit resolved event on error path so the "waiting for input" indicator is cleared
        this.emit('toolPermission:resolved', {
          requestId,
          sessionId,
          response: { decision: 'deny', scope: 'once' },
          timestamp: Date.now()
        });
        this.logSecurity('[canUseTool] Permission request failed (fallback):', {
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
   *
   * The toolUseID is the SDK's ID for this tool call. We use it so our synthetic
   * tool_use message has the same ID the SDK will use, allowing the widget to
   * correlate the pending question with the eventual tool_result.
   */
  private async handleAskUserQuestion(
    sessionId: string | undefined,
    input: any,
    options: { signal: AbortSignal },
    toolUseID?: string
  ): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }> {
      // Debug logging - uncomment if needed

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

      // Use the SDK's tool_use ID so our message can correlate with SDK events
      const questionId = toolUseID || `ask-${sessionId || 'unknown'}-${Date.now()}`;

      // Log as nimbalyst_tool_use - our own message type that won't conflict with SDK messages
      // SessionManager recognizes this type and creates a toolCall property for widget rendering
      // The widget will show interactive UI while !toolCall.result, completed UI when answered
      if (sessionId) {
        await this.logAgentMessage(
          sessionId,
          'claude-code',
          'output',
          JSON.stringify({
            type: 'nimbalyst_tool_use',
            id: questionId,
            name: 'AskUserQuestion',
            input: { questions }
          })
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

        // Verify the SDK directory specifically
        const unpackedSdkDir = path.join(unpackedNodeModules, '@anthropic-ai', 'claude-agent-sdk');
        if (!fs.existsSync(unpackedSdkDir)) {
          const error = `SDK directory not found at: ${unpackedSdkDir}. ` +
                       `Build must unpack @anthropic-ai/claude-agent-sdk package.`;
          console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
          throw new Error(error);
        }

        cliPath = unpackedCliPath;
      }

      if (!fs.existsSync(cliPath)) {
        throw new Error(`CLI not found at expected path: ${cliPath}`);
      }

      return cliPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not find claude-agent-sdk CLI: ${message}`);
    }
  }

  protected buildSystemPrompt(documentContext?: DocumentContext, enableAgentTeams?: boolean): string {
    const hasSessionNaming = ClaudeCodeProvider.sessionNamingServerPort !== null;
    const worktreePath = documentContext?.worktreePath;
    const isVoiceMode = (documentContext as any)?.isVoiceMode;
    const voiceModeCodingAgentPrompt = (documentContext as any)?.voiceModeCodingAgentPrompt;

    const prompt = buildClaudeCodeSystemPrompt({
      hasSessionNaming,
      worktreePath,
      isVoiceMode,
      voiceModeCodingAgentPrompt,
      enableAgentTeams,
    });

    // console.log('[CLAUDE-CODE] Built system prompt - length:', prompt.length, 'characters');
    return prompt;
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
   * Get Claude Code models.
   * Returns standard models plus Sonnet 1M variant (access controlled by Anthropic).
   */
  static async getModels(): Promise<AIModel[]> {
    const models: AIModel[] = [];

    // Add models in desired order
    for (const variant of CLAUDE_CODE_VARIANTS) {
      // Add base model
      models.push({
        id: ModelIdentifier.create('claude-code', variant).combined,
        name: `Claude Agent · ${CLAUDE_CODE_MODEL_LABELS[variant]} ${CLAUDE_CODE_VARIANT_VERSIONS[variant]}`,
        provider: 'claude-code' as const,
        maxTokens: 8192,
        contextWindow: 200000
      });

      // Add 1M variants right after Sonnet
      // Access is controlled by Anthropic via account permissions
      // If user doesn't have access, the SDK will return an error when they try to use it
      if (variant === 'sonnet') {
        models.push({
          id: ModelIdentifier.create('claude-code', 'sonnet-1m').combined,
          name: 'Claude Agent · Sonnet 4.6 (1M)',
          provider: 'claude-code' as const,
          maxTokens: 8192,
          contextWindow: 1000000
        });
        // Sonnet 4.5 1M — uses a full model ID to pin to 4.5
        models.push({
          id: 'claude-code:sonnet-4.5-1m',
          name: 'Claude Agent · Sonnet 4.5 (1M)',
          provider: 'claude-code' as const,
          maxTokens: 8192,
          contextWindow: 1000000
        });
      }
    }

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
   * Returns counts for MCP servers, slash commands, agents, skills, plugins, tools, and helper method
   */
  getInitData(): {
    mcpServerCount: number;
    slashCommandCount: number;
    agentCount: number;
    skillCount: number;
    pluginCount: number;
    toolCount: number;
    helperMethod: ClaudeHelperMethod;
  } | null {
    const baseData = (this as any)._initData;
    if (!baseData) return null;
    return {
      ...baseData,
      helperMethod: this.helperMethod
    };
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
