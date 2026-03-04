/**
 * Main AI service that coordinates providers and sessions
 */

import { BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { safeHandle } from '../../utils/ipcRegistry';
import Store from 'electron-store';
import { SessionManager, ProviderFactory, ModelRegistry, AIProvider, isAskUserQuestionProvider, ClaudeCodeProvider, OpenAICodexProvider } from '@nimbalyst/runtime/ai/server';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { parseContextUsageMessage } from '@nimbalyst/runtime/ai/server/utils/contextUsage';
import { isBedrockToolSearchError } from '@nimbalyst/runtime/ai/server/utils/errorDetection';
import { parseEffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';
import type { SessionStore } from '@nimbalyst/runtime';
import {
  CLAUDE_CODE_VARIANTS,
  AI_PROVIDER_TYPES,
  ModelIdentifier,
  type DocumentContext,
  type Message,
  type ProviderConfig,
  type ToolHandler,
  type DiffArgs,
  type DiffResult,
  type ToolResult,
  type AIProviderType,
  type AIModel,
  type SessionData,
  type SessionType,
} from '@nimbalyst/runtime/ai/server/types';
// MCP imports removed - no longer using MCP HTTP server
import { ToolExecutor, toolRegistry, BUILT_IN_TOOLS } from './tools';
import { initMobileSessionControlHandler } from './MobileSessionControlHandler';
import { SoundNotificationService } from '../SoundNotificationService';
import { notificationService } from '../NotificationService';
import { TrayManager } from '../../tray/TrayManager';
import { logger } from '../../utils/logger';
import { windowStates, findWindowByWorkspace, getWindowId } from '../../window/WindowManager';
import { sessionFileTracker } from '../SessionFileTracker';
import { toolCallMatcher, unwrapShellCommand } from '../ToolCallMatcher';
import { workspaceFileEditAttributionService } from '../WorkspaceFileEditAttributionService';
import {AnalyticsService} from "../analytics/AnalyticsService.ts";
import { historyManager } from '../../HistoryManager';
import { FileSnapshotCache } from '../../file/FileSnapshotCache';
import { SessionFileWatcher } from '../../file/SessionFileWatcher';
import { addGitignoreBypass } from '../../file/WorkspaceEventBus';
import {
  getAIProviderOverrides,
  saveAIProviderOverrides,
  clearAIProviderOverrides,
  getWorkspaceState,
  getDefaultAIModel,
  incrementCompletedSessionsWithTools,
  markCommunityPopupShown,
  shouldShowCommunityPopup,
  wasCommunityPopupShownThisLaunch
} from '../../utils/store';
import { mergeAISettings } from '../../utils/aiSettingsMerge';
import { DocumentContextService, type RawDocumentContext, type PreparedDocumentContext } from '@nimbalyst/runtime';
import { getMessageSyncHandler, getSyncProvider } from '../SyncManager';
import { normalizeCodexProviderConfig, omitModelsField, stripTransientProviderFields } from '@nimbalyst/runtime/ai/server/utils/modelConfigUtils';
import { isFileInWorkspaceOrWorktree, resolveProjectPath } from '../../utils/workspaceDetection';
import { SessionFilesRepository } from '@nimbalyst/runtime';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/** Read file content as UTF-8. Returns '' for missing files, null for other errors. */
async function readFileContentOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (error: any) {
    return error?.code === 'ENOENT' ? '' : null;
  }
}

function isCreateLikeChangeKind(kind: string | undefined): boolean {
  if (!kind) return false;
  const normalized = kind.toLowerCase();
  return normalized === 'create' || normalized === 'add' || normalized === 'new';
}

/**
 * Best-effort fallback baseline for files missing cache baseline (commonly gitignored files).
 * Prefers non-tag snapshots and skips snapshots that match current on-disk content.
 */
async function recoverBaselineFromHistory(
  filePath: string,
  currentContent: string | null
): Promise<string | null> {
  try {
    const snapshots = await historyManager.listSnapshots(filePath);
    if (snapshots.length === 0) {
      return null;
    }

    // If there's a reviewed tag for this file, skip any snapshot older than
    // the review timestamp. This prevents returning stale pre-edit baselines
    // from before previously-accepted changes (tag resurrection bug).
    const lastReviewedAt = await historyManager.getLastReviewedTimestamp(filePath);

    const nonTagSnapshots = snapshots.filter((snapshot) => {
      const type = String(snapshot.metadata?.type ?? snapshot.type ?? '').toLowerCase();
      return type !== 'pre-edit' && type !== 'incremental-approval';
    });
    const orderedCandidates = [...nonTagSnapshots, ...snapshots];

    const seenTimestamps = new Set<string>();
    let checked = 0;
    for (const snapshot of orderedCandidates) {
      if (checked >= 8) break;
      if (seenTimestamps.has(snapshot.timestamp)) continue;
      seenTimestamps.add(snapshot.timestamp);
      checked++;

      // Skip snapshots from before the last review — they represent
      // pre-acceptance state and would cause baseline drift.
      if (lastReviewedAt !== null) {
        const snapshotTs = typeof snapshot.timestamp === 'string'
          ? parseInt(snapshot.timestamp, 10)
          : snapshot.timestamp;
        if (snapshotTs < lastReviewedAt) {
          continue;
        }
      }

      const candidateContent = await historyManager.loadSnapshot(filePath, snapshot.timestamp);
      if (currentContent !== null && candidateContent === currentContent) {
        continue;
      }
      return candidateContent;
    }

    return null;
  } catch (error) {
    logger.ai.debug('[AIService] Failed recovering baseline from history', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const LOG_PREVIEW_LENGTH = 400;

function previewForLog(value?: string, max: number = LOG_PREVIEW_LENGTH): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Helper functions for bucketing analytics values
function bucketMessageLength(length: number): 'short' | 'medium' | 'long' {
  if (length < 100) return 'short';
  if (length < 500) return 'medium';
  return 'long';
}

function bucketResponseTime(ms: number): 'fast' | 'medium' | 'slow' {
  if (ms < 2000) return 'fast';
  if (ms < 5000) return 'medium';
  return 'slow';
}

function bucketChunkCount(count: number): string {
  if (count < 10) return '0-9';
  if (count < 50) return '10-49';
  if (count < 100) return '50-99';
  return '100+';
}

function bucketContentLength(length: number): string {
  if (length < 100) return '0-99';
  if (length < 500) return '100-499';
  if (length < 1000) return '500-999';
  return '1000+';
}

function bucketCount(count: number): string {
  if (count === 0) return '0';
  if (count === 1) return '1';
  if (count < 5) return '2-4';
  if (count < 10) return '5-9';
  return '10+';
}

function bucketAgeInDays(timestampMs: number): string {
  const ageMs = Date.now() - timestampMs;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageDays === 0) return 'today';
  if (ageDays === 1) return '1-day';
  if (ageDays < 7) return '2-6-days';
  if (ageDays < 30) return '1-4-weeks';
  if (ageDays < 90) return '1-3-months';
  return '3-months-plus';
}

/**
 * Detects the configured AI provider based on environment variables.
 * Returns the provider identifier or null if no known provider is detected.
 *
 * Checks providers in order of specificity:
 * 1. Claude Code specific flags (Bedrock, Vertex) - most specific
 * 2. Other AI provider API keys
 * 3. Anthropic API key - checked last as it's the default/fallback
 */
function detectConfiguredAIProvider(): string | null {
  // Claude Code specific providers (most specific - explicit flags)
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') return 'aws-bedrock';
  if (process.env.CLAUDE_CODE_USE_VERTEX === '1') return 'google-vertex';

  // Other AI providers (check before Anthropic as they're more specific)
  if (process.env.XAI_API_KEY) return 'xai';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.AZURE_OPENAI_API_KEY) return 'azure-openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.MISTRAL_API_KEY) return 'mistral';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.COHERE_API_KEY) return 'cohere';

  // Anthropic direct API (check last as it's the default)
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';

  return null;
}

/**
 * Safely send a message to a WebContents from an IPC event.
 * Returns false if the sender was destroyed (e.g., window was refreshed/navigated).
 * This prevents "Object has been destroyed" errors when the renderer context
 * that initiated the request no longer exists.
 */
function safeSend(event: Electron.IpcMainInvokeEvent, channel: string, ...args: unknown[]): boolean {
  if (event.sender.isDestroyed()) {
    logger.main.debug(`[AIService] Skipping ${channel} - WebContents destroyed`);
    return false;
  }
  event.sender.send(channel, ...args);
  return true;
}

/**
 * Extract file extension from a file path for analytics.
 * Handles compound extensions like .mockup.html
 */
function getFileExtensionForAnalytics(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;

  const lowerPath = filePath.toLowerCase();

  // Check for known compound extensions first
  if (lowerPath.endsWith('.mockup.html')) {
    return '.mockup.html';
  }

  // Standard single extension
  const lastDot = filePath.lastIndexOf('.');
  return lastDot >= 0 ? filePath.substring(lastDot).toLowerCase() : undefined;
}

/**
 * Extract the model part from a full model ID for passing to provider APIs.
 * For claude-code, returns the full model (with suffix if any).
 * For other providers, strips the provider prefix.
 *
 * Returns null if the model is a Claude Code variant being used with a non-claude-code provider
 * (which indicates corrupt/migrated session data).
 */
function extractModelForProvider(
  fullModel: string,
  provider: AIProviderType
): string | null {
  if (provider === 'openai-codex') {
    const parsed = ModelIdentifier.tryParse(fullModel);
    const rawModel = parsed ? parsed.model : fullModel;
    const normalized = OpenAICodexProvider.normalizeModelSelection(rawModel);
    return normalized.replace(/^openai-codex:/, '');
  }

  // Claude Code keeps the full model ID (including suffix like -1m)
  if (provider === 'claude-code') {
    return fullModel;
  }

  // Try parsing with ModelIdentifier
  const parsed = ModelIdentifier.tryParse(fullModel);
  if (parsed) {
    // Check for provider mismatch - Claude Code variant with non-claude-code provider
    // Note: provider cannot be 'claude-code' here due to early return above
    if (parsed.provider === 'claude-code') {
      logger.main.warn(`[AIService] Session has Claude Code model "${fullModel}" with ${provider} provider - using default model`);
      return null;
    }
    // Validate that we're not just returning a provider name as a model
    if (!parsed.model || parsed.model === parsed.provider) {
      logger.main.warn(`[AIService] Model "${fullModel}" appears to be just a provider name - using default model`);
      return null;
    }
    return parsed.model;
  }

  // Not a combined format - check for bare Claude Code variants with wrong provider
  if (provider === 'claude' && (CLAUDE_CODE_VARIANTS as readonly string[]).includes(fullModel.toLowerCase())) {
    logger.main.warn(`[AIService] Session has Claude Code variant "${fullModel}" with claude provider - using default model`);
    return null;
  }

  // Check if the fullModel is just a provider name (invalid)
  if ((AI_PROVIDER_TYPES as readonly string[]).includes(fullModel.toLowerCase())) {
    logger.main.warn(`[AIService] Model "${fullModel}" is just a provider name, not a valid model ID - using default model`);
    return null;
  }

  // Return as-is for non-combined formats (e.g., raw model IDs)
  return fullModel;
}

/**
 * Detect if a message starts with a Nimbalyst package slash command.
 * Returns command info if found, null otherwise.
 *
 * NOTE: Tool packages have been replaced by extension-based Claude plugins.
 * This function now always returns null. Slash commands are handled by extensions.
 */
function detectNimbalystSlashCommand(
  message: string,
  workspacePath: string | undefined
): { commandName: string; packageId: string } | null {
  // Tool packages have been deprecated and replaced by extension-based Claude plugins
  return null;
}

/**
 * Extract file paths from @ mentions in a message
 * Returns array of file paths mentioned with @
 */
function extractFileMentions(message: string): string[] {
  // Match @ mentions followed by file path patterns
  // Supports: @file.md, @path/to/file.ts, @"path with spaces/file.md"
  const mentionRegex = /@(?:"([^"]+)"|([^\s]+))/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(message)) !== null) {
    const filePath = match[1] || match[2]; // Quoted or unquoted path
    if (filePath) {
      mentions.push(filePath);
    }
  }

  return mentions;
}

/**
 * Check if a file is binary by reading its first chunk
 */
function isBinaryFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath);
    const chunkSize = Math.min(512, buffer.length);

    // Check for null bytes or high proportion of non-text bytes
    for (let i = 0; i < chunkSize; i++) {
      const byte = buffer[i];
      if (byte === 0) return true; // Null byte = binary
      // Control characters except whitespace
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false; // If we can't read it, treat as text and let read fail later
  }
}

/**
 * Attach file contents for @ mentions in non-agent providers
 * For providers that don't support file tools (supportsFileTools: false),
 * automatically read and attach @ referenced files to the message
 */
async function attachMentionedFiles(
  message: string,
  workspacePath: string,
  provider: AIProvider
): Promise<{ enhancedMessage: string; attachedFiles: Array<{ path: string; size: number }> }> {
  const capabilities = provider.getCapabilities();

  // If provider supports file tools, don't auto-attach files
  if (capabilities.supportsFileTools) {
    return { enhancedMessage: message, attachedFiles: [] };
  }

  // Extract file mentions
  const mentions = extractFileMentions(message);
  if (mentions.length === 0) {
    return { enhancedMessage: message, attachedFiles: [] };
  }

  logger.main.info(`[AIService] Found ${mentions.length} file @ mentions for non-agent provider`, { mentions });

  const MAX_FILE_SIZE = 1024 * 1024; // 1MB limit
  const attachedFiles: Array<{ path: string; size: number }> = [];
  const fileContents: Array<{ path: string; content: string }> = [];

  for (const mentionedPath of mentions) {
    try {
      // Resolve relative path to workspace
      const fullPath = path.isAbsolute(mentionedPath)
        ? mentionedPath
        : path.join(workspacePath, mentionedPath);

      // Security: Ensure file is within workspace
      const resolvedPath = path.resolve(fullPath);
      const resolvedWorkspace = path.resolve(workspacePath);
      if (!resolvedPath.startsWith(resolvedWorkspace)) {
        logger.main.warn(`[AIService] Skipping @ mention outside workspace: ${mentionedPath}`);
        continue;
      }

      // Check if file exists
      if (!fs.existsSync(resolvedPath)) {
        logger.main.warn(`[AIService] @ mentioned file not found: ${mentionedPath}`);
        continue;
      }

      // Check file size and type
      const stats = fs.statSync(resolvedPath);
      if (stats.isDirectory()) {
        // Directory mentions are handled by agent providers via MCP tools
        continue;
      }
      if (stats.size > MAX_FILE_SIZE) {
        logger.main.warn(`[AIService] @ mentioned file too large (${stats.size} bytes): ${mentionedPath}`);
        continue;
      }

      // Check if binary
      if (isBinaryFile(resolvedPath)) {
        logger.main.warn(`[AIService] @ mentioned file is binary, skipping: ${mentionedPath}`);
        continue;
      }

      // Read file content
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      fileContents.push({ path: mentionedPath, content });
      attachedFiles.push({ path: mentionedPath, size: stats.size });

      logger.main.info(`[AIService] Attached @ mentioned file: ${mentionedPath} (${stats.size} bytes)`);
    } catch (error) {
      logger.main.error(`[AIService] Error reading @ mentioned file ${mentionedPath}:`, error);
    }
  }

  // If no files were attached, return original message
  if (fileContents.length === 0) {
    return { enhancedMessage: message, attachedFiles: [] };
  }

  // Format enhanced message with file contents inline
  let enhancedMessage = '';

  // Add file contents at the beginning
  for (const { path: filePath, content } of fileContents) {
    enhancedMessage += `[File: ${filePath}]\n\`\`\`\n${content}\n\`\`\`\n\n`;
  }

  // Add original message
  enhancedMessage += message;

  return { enhancedMessage, attachedFiles };
}

/**
 * Tag file before edit for non-agentic providers (OpenAI, LMStudio, etc.)
 * Creates a pre-edit tag in the history database with pending-review status
 * This enables diff visualization and persistence across app restarts
 */
async function tagFileBeforeEdit(
  filePath: string,
  sessionId: string,
  toolUseId: string
): Promise<void> {
  try {
    // Check if there are already pending tags for this file
    // If yes, skip creating a new tag - we want to show ALL edits together as one diff
    const pendingTags = await historyManager.getPendingTags(filePath);

    if (pendingTags && pendingTags.length > 0) {
      // Tag already exists, don't create a new one
      logger.ai.debug('[AIService] Pre-edit tag already exists, skipping', {
        file: path.basename(filePath),
        existingTagId: pendingTags[0].id,
      });
      return;
    }

    // No pending tags - create the first one for this edit session
    const tagId = `ai-edit-pending-${sessionId}-${toolUseId}`;
    logger.ai.info('[AIService] Creating pre-edit tag', {
      file: path.basename(filePath),
      tagId,
    });

    // Read current file content
    const content = fs.readFileSync(filePath, 'utf-8');

    await historyManager.createTag(
      filePath,
      tagId,
      content,
      sessionId,
      toolUseId
    );

    // Small delay to ensure tag is committed to database
    await new Promise(resolve => setTimeout(resolve, 10));
  } catch (error) {
    // Check if this is a unique constraint violation (expected if tag already exists)
    const errorStr = String(error);
    if (errorStr.includes('unique') || errorStr.includes('UNIQUE') || errorStr.includes('duplicate')) {
      // This is fine - means another rapid edit already created the tag
      return;
    }
    logger.ai.error('[AIService] Failed to create pre-edit tag:', error);
    // Don't throw - allow the edit to proceed even if tagging fails
  }
}

// Helper function to categorize AI errors
function categorizeAIError(error: any): string {
  const message = error?.message?.toLowerCase() || String(error).toLowerCase();
  if (message.includes('network') || message.includes('econnrefused') || message.includes('fetch')) return 'network';
  if (message.includes('api key') || message.includes('unauthorized') || message.includes('authentication')) return 'auth';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'rate_limit';
  if (message.includes('overloaded') || message.includes('capacity')) return 'overloaded';
  return 'unknown';
}

export class AIService {
  private sessionManager: SessionManager;
  private settingsStore: Store<Record<string, unknown>> | null = null;
  private readonly analytics = AnalyticsService.getInstance();
  private cachedNormalizedProviderSettings: Record<string, any> | null = null;
  // Store reference to sendMessage handler for queue processing
  private sendMessageHandler: ((event: Electron.IpcMainInvokeEvent, message: string, documentContext?: DocumentContext, sessionId?: string, workspacePath?: string) => Promise<{ content: string }>) | null = null;
  // NOTE: Providers are now tracked per-session in ProviderFactory, not per-window
  // This allows multiple concurrent sessions in the same window (e.g., agent mode tabs)

  // Track queued prompt IDs currently being processed to prevent duplicate execution
  // This is a backup to the atomic database claim - catches cases where claim succeeds
  // but the same prompt ID is somehow passed to sendMessage twice
  private processingQueuedPromptIds = new Set<string>();

  // File snapshot caches and watchers for agentic sessions (diff support).
  // Active for openai-codex and claude-code providers.
  // Stopped when sessions complete, error, or are deleted. Multiple sessions on the
  // same workspace share a single chokidar instance (ref-counted inside SessionFileWatcher).
  private codexSessionWatchers = new Map<string, { cache: FileSnapshotCache; watcher: SessionFileWatcher; workspacePath: string }>();
  // Pending delayed-stop timers for codex session watchers (keyed by sessionId).
  // Used to cancel the stop if a new turn starts before the timer fires.
  private codexStopTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Debounced tool call matching during active sessions.
  // After each tool execution is tracked, we schedule matchSession with a short delay
  // so file edits are linked to tool calls promptly (not just at session end).
  private matchDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Track sessions currently processing a queued prompt to prevent concurrent execution.
  // Without this, the completion handler and triggerQueueProcessing IPC can race,
  // each claiming a different prompt and sending both to the AI concurrently.
  private sessionsProcessingQueue = new Set<string>();

  // Track mobile session creation requests to prevent duplicate processing
  // (can happen if the same request is delivered multiple times)
  private processingMobileSessionRequests = new Set<string>();

  // Service for preparing document context (transition detection, diff computation, etc.)
  private documentContextService = new DocumentContextService();

  constructor(sessionStore: SessionStore) {
    logger.main.info('[AIService] Constructor called');
    this.sessionManager = new SessionManager(sessionStore);

    // Set up persistence callback for DocumentContextService
    // Use AISessionsRepository directly since SessionManager doesn't have a generic updateMetadata
    this.documentContextService.setPersistCallback(async (sessionId, state) => {
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      await AISessionsRepository.updateMetadata(sessionId, {
        lastDocumentState: state,
      });
    });

    // Initialize mobile sync handler if sync is enabled
    this.initializeMobileSyncHandler().catch(err => {
      logger.main.error('[AIService] initializeMobileSyncHandler threw:', err);
    });

    // Initialize SessionStateManager with the database worker
    // Import dynamically to avoid circular dependencies
    import('../../database/PGLiteDatabaseWorker').then(({ database }) => {
      const stateManager = getSessionStateManager();
      stateManager.setDatabase(database);
    }).catch(err => {
      console.error('[AIService] Failed to initialize SessionStateManager:', err);
    });

    // Register built-in tools (which now includes file tools)
    for (const tool of BUILT_IN_TOOLS) {
      toolRegistry.register(tool);
    }

    // Delay initialization until first use
    this.initializeApiKeys();
    this.setupIpcHandlers();

    // Clean up any empty messages from existing sessions on startup
    const cleaned = this.sessionManager.cleanupAllSessions();
    if (cleaned > 0) {
      console.log(`[AIService] Cleaned ${cleaned} empty messages from existing sessions on startup`);
    }
  }

  private getSettingsStore(): Store<Record<string, unknown>> {
    if (!this.settingsStore) {
      this.settingsStore = new Store<Record<string, unknown>>({
        name: 'ai-settings',
        schema: {
          defaultProvider: {
            type: 'string',
            default: 'claude-code'
          },
          apiKeys: {
            type: 'object',
            default: {}
          },
          providerSettings: {
            type: 'object',
            default: {
              claude: {
                enabled: false,
                testStatus: "idle",
              },
              'claude-code': {
                enabled: true,
                testStatus: "idle",
                installStatus: "not-installed",
                models: ["claude-code:opus", "claude-code:sonnet", "claude-code:haiku"]
              },
              openai: {
                enabled: false,
                testStatus: "idle",
              },
              'openai-codex': {
                enabled: false,
                testStatus: "idle",
                installStatus: "not-installed",
              },
              lmstudio: {
                enabled: false,
                testStatus: "idle",
                baseUrl: "http://127.0.0.1:8234"
              }
            }
          },
          showToolCalls: {
            type: 'boolean',
            default: false  // Hidden by default, developer mode only
          },
          aiDebugLogging: {
            type: 'boolean',
            default: false  // Hidden by default, developer mode only
          }
        }
      });
    }
    return this.settingsStore;
  }

  private initializeApiKeys() {
    // Delay initialization to avoid accessing store before app is ready
    process.nextTick(() => {
      try {
        // Check if we have API key stored
        const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

        // If we have an env variable and no stored key, save it
        if (process.env.ANTHROPIC_API_KEY && !apiKeys['anthropic']) {
          apiKeys['anthropic'] = process.env.ANTHROPIC_API_KEY;
          this.getSettingsStore().set('apiKeys', apiKeys);
        }
      } catch (error) {
        console.error('[AIService] Error initializing API keys:', error);
      }
    });
  }

  /**
   * Get API key for a provider, considering project-level overrides.
   * Project-specific API keys take precedence over global keys.
   */
  private getApiKeyForProvider(provider: string, workspacePath?: string): string | undefined {
    const globalApiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

    // Check for project-level API key override
    if (workspacePath) {
      const overrides = getAIProviderOverrides(workspacePath);
      if (overrides?.providers?.[provider]?.apiKey) {
        return overrides.providers[provider].apiKey;
      }
    }

    // Fall back to global API key
    switch (provider) {
      case 'claude':
        return globalApiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
      case 'claude-code':
        // Claude Code has its own auth (SSO login) - never use the Claude Chat API key
        return globalApiKeys['claude-code'];
      case 'openai':
        return globalApiKeys['openai'] || process.env.OPENAI_API_KEY;
      case 'openai-codex':
        return globalApiKeys['openai-codex'];
      case 'lmstudio':
        return 'not-required';
      default:
        return globalApiKeys[provider];
    }
  }

  /**
   * Compute document transition and diff by comparing incoming content with stored state.
   * The renderer always sends full content - we compute optimization here on the backend.
   *
   * @param documentContext - The context received from renderer (always full content)
   * @param sessionId - The session ID for looking up last document state
   * @returns Context with transition info and optional diff for prompt optimization
   */

  /**
   * Check if a provider is enabled for a workspace, considering project-level overrides.
   */
  private isProviderEnabledForWorkspace(provider: string, workspacePath?: string): boolean {
    const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;

    // Claude Code is enabled by default (undefined means enabled).
    // This matches the logic in ai:getModels which uses `claudeCodeSettings.enabled !== false`.
    // Other providers require explicit enabling (undefined means disabled).
    const globalEnabled = provider === 'claude-code'
      ? providerSettings[provider]?.enabled !== false
      : providerSettings[provider]?.enabled ?? false;

    // Check for project-level override
    if (workspacePath) {
      const overrides = getAIProviderOverrides(workspacePath);
      if (overrides?.providers?.[provider]?.enabled !== undefined) {
        return overrides.providers[provider].enabled;
      }
    }

    return globalEnabled;
  }

  private mobileSyncHandlerInitialized = false;
  private syncStatusUnsubscribe: (() => void) | null = null;

  /**
   * Process the next queued prompt for a session.
   * Called from mobile sync handler to ensure prompts are processed even when session isn't open.
   * Also used by the ai:triggerQueueProcessing IPC handler.
   */
  private async processQueuedPrompt(sessionId: string, workspacePath: string, targetWindow: Electron.BrowserWindow): Promise<boolean> {
    // Prevent concurrent queue processing for the same session.
    // Multiple callers (completion handler, triggerQueueProcessing IPC, mobile sync)
    // can race here - only one should process at a time.
    if (this.sessionsProcessingQueue.has(sessionId)) {
      logger.main.info(`[AIService] processQueuedPrompt: session ${sessionId} already processing a queued prompt, skipping`);
      return false;
    }

    const { getQueuedPromptsStore } = await import('../RepositoryManager');
    const queueStore = getQueuedPromptsStore();
    const pendingPrompts = await queueStore.listPending(sessionId);

    if (pendingPrompts.length === 0) {
      logger.main.info(`[AIService] processQueuedPrompt: no pending prompts for session ${sessionId}`);
      return false;
    }

    const nextPrompt = pendingPrompts[0];
    logger.main.info(`[AIService] processQueuedPrompt: processing prompt ${nextPrompt.id} for session ${sessionId}`);

    // Claim the prompt atomically
    const claimed = await queueStore.claim(nextPrompt.id);
    if (!claimed) {
      logger.main.info(`[AIService] processQueuedPrompt: prompt ${nextPrompt.id} already claimed`);
      return false;
    }

    // Mark session as processing before the setImmediate
    this.sessionsProcessingQueue.add(sessionId);

    // Notify renderer that prompt was claimed (so UI removes it from queue list)
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('ai:promptClaimed', {
        sessionId,
        promptId: claimed.id,
      });
    }

    // Build document context for the queued prompt
    const docContext = {
      ...claimed.documentContext,
      queuedPromptId: claimed.id,
      attachments: claimed.attachments,
    };

    // Process the prompt via sendMessage
    setImmediate(async () => {
      try {
        if (!this.sendMessageHandler) {
          throw new Error('sendMessageHandler not initialized');
        }
        // Create a mock event with the target window's webContents
        const mockEvent = {
          sender: targetWindow.webContents,
          senderFrame: targetWindow.webContents.mainFrame,
        } as Electron.IpcMainInvokeEvent;

        await this.sendMessageHandler(mockEvent, claimed.prompt, docContext as any, sessionId, workspacePath);
        // Mark as completed
        await queueStore.complete(claimed.id);
      } catch (queueError) {
        logger.main.error(`[AIService] Failed to process queued prompt ${claimed.id}:`, queueError);
        await queueStore.fail(claimed.id, queueError instanceof Error ? queueError.message : 'Unknown error');
      } finally {
        this.sessionsProcessingQueue.delete(sessionId);

        // Check for more pending prompts after clearing the processing guard.
        // The completion handler inside sendMessageHandler skips queue chaining
        // when sessionsProcessingQueue is set (which it is during mobile-initiated
        // processing). We must check here to avoid leaving prompts stuck as 'pending'.
        try {
          const pendingPrompts = await queueStore.listPending(sessionId);
          if (pendingPrompts.length > 0 && targetWindow && !targetWindow.isDestroyed()) {
            logger.main.info(`[AIService] processQueuedPrompt finally: ${pendingPrompts.length} pending prompts remain, triggering next`);
            this.processQueuedPrompt(sessionId, workspacePath, targetWindow);
          }
        } catch (chainErr) {
          logger.main.error('[AIService] processQueuedPrompt finally: error checking for pending prompts:', chainErr);
        }
      }
    });

    return true;
  }

  private async initializeMobileSyncHandler() {
    // Listen for index changes from mobile sync and insert queuedPrompts into the database.
    // The renderer's processQueuedPrompts function handles execution from the database queue.
    // Both local queuing (via ai:createQueuedPrompt) and mobile sync use the same database queue.

    // If already initialized, don't do it again
    if (this.mobileSyncHandlerInitialized) {
      logger.main.info('[AIService] Mobile sync handler already initialized, skipping');
      return;
    }

    logger.main.info('[AIService] Initializing mobile sync handler (metadata sync only)...');

    // First, subscribe to sync status changes so we can initialize later if sync becomes available
    if (!this.syncStatusUnsubscribe) {
      const { onSyncStatusChange } = await import('../SyncManager');
      this.syncStatusUnsubscribe = onSyncStatusChange((status) => {
        if (status.connected && !this.mobileSyncHandlerInitialized) {
          logger.main.info('[AIService] Sync connected, attempting to initialize mobile sync handler...');
          this.tryInitializeMobileSyncHandler();
        }
      });
    }

    // Try to initialize immediately
    await this.tryInitializeMobileSyncHandler();
  }

  private async tryInitializeMobileSyncHandler() {
    // If already initialized, don't do it again
    if (this.mobileSyncHandlerInitialized) {
      return;
    }

    try {
      const syncProvider = getSyncProvider();

      if (!syncProvider) {
        logger.main.info('[AIService] Sync provider not available yet');
        return;
      }

      // Listen for index changes and insert queued prompts into the queued_prompts table
      if (syncProvider.onIndexChange) {
        syncProvider.onIndexChange(async (sessionId, entry) => {
            // Notify renderer about session list changes
            // This ensures new sessions from mobile appear immediately in the UI
            // Use getCachedIndexEntry to get projectId without database lookup
            if (syncProvider.getCachedIndexEntry) {
              const cachedEntry = syncProvider.getCachedIndexEntry(sessionId);
              if (cachedEntry?.projectId) {
                const targetWindow = findWindowByWorkspace(cachedEntry.projectId);
                if (targetWindow && !targetWindow.isDestroyed()) {
                  targetWindow.webContents.send('sessions:refresh-list', {
                    workspacePath: cachedEntry.projectId,
                    sessionId
                  });

                  // Forward lastReadAt from sync for cross-device read state
                  if (entry.lastReadAt) {
                    targetWindow.webContents.send('sessions:sync-read-state', {
                      sessionId,
                      lastReadAt: entry.lastReadAt,
                      lastMessageAt: entry.lastMessageAt,
                    });
                  }

                  // Forward draftInput from remote device
                  if (entry.draftInput !== undefined) {
                    logger.main.info('[AIService] Forwarding draftInput to renderer:', { sessionId, draftInput: entry.draftInput });
                    targetWindow.webContents.send('sessions:sync-draft-input', {
                      sessionId,
                      draftInput: entry.draftInput ?? '',
                      draftUpdatedAt: entry.draftUpdatedAt,
                    });
                  }
                } else {
                  if (entry.draftInput !== undefined) {
                    logger.main.info('[AIService] DEBUG: draftInput present but no targetWindow for projectId:', cachedEntry.projectId);
                  }
                }
              } else {
                if (entry.draftInput !== undefined) {
                  logger.main.info('[AIService] DEBUG: draftInput present but no projectId in cachedEntry for session:', sessionId);
                }
              }
            }

            // Only process if there are queuedPrompts in the broadcast
            if (entry.queuedPrompts && entry.queuedPrompts.length > 0) {
              logger.main.info('[AIService] Received queuedPrompts from mobile via onIndexChange:', {
                sessionId,
                count: entry.queuedPrompts.length,
                promptIds: entry.queuedPrompts.map(p => p.id)
              });

              try {
                // Insert prompts into the queued_prompts table
                const { getQueuedPromptsStore } = await import('../RepositoryManager');
                const queueStore = getQueuedPromptsStore();

                let newPromptsCount = 0;
                for (const prompt of entry.queuedPrompts) {
                  // Skip prompts that were created locally (echoed back via Y.js sync)
                  // Local prompts have IDs starting with 'local-'
                  if (prompt.id.startsWith('local-')) {
                    logger.main.info(`[AIService] Prompt ${prompt.id} is a local prompt echoed via sync, skipping`);
                    continue;
                  }

                  // Check if prompt already exists
                  const existing = await queueStore.get(prompt.id);
                  if (existing) {
                    logger.main.info(`[AIService] Prompt ${prompt.id} already exists, skipping`);
                    continue;
                  }

                  // Create the prompt in the queued_prompts table
                  await queueStore.create({
                    id: prompt.id,
                    sessionId,
                    prompt: prompt.prompt,
                    attachments: prompt.attachments,
                  });
                  newPromptsCount++;
                }

                if (newPromptsCount === 0) {
                  logger.main.info('[AIService] No new prompts to process, all already exist');
                  return;
                }

                logger.main.info(`[AIService] Inserted ${newPromptsCount} new prompts into queued_prompts table`);

                // Load session to get its workspacePath for window routing
                // Use repository directly since we just need metadata, not full session load
                const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
                const session = await AISessionsRepository.get(sessionId);
                if (!session) {
                  logger.main.warn('[AIService] Session not found for queuedPrompts:', sessionId);
                  return;
                }

                // Track ai_message_queued analytics event for each prompt from mobile
                // Note: Mobile doesn't currently support attachments or documentContext
                for (let i = 0; i < newPromptsCount; i++) {
                  AnalyticsService.getInstance().sendEvent('ai_message_queued', {
                    provider: session.provider,
                    source: 'mobile',
                    hasDocumentContext: false,
                    hasAttachments: false,
                  });
                }

                // Only notify the window that owns this session's workspace
                // This prevents duplicate execution when multiple windows are open
                if (session.workspacePath) {
                  const targetWindow = findWindowByWorkspace(session.workspacePath);
                  if (targetWindow && !targetWindow.isDestroyed()) {
                    logger.main.info('[AIService] Notifying window to process queue for workspace:', session.workspacePath);
                    targetWindow.webContents.send('ai:queuedPromptsReceived', {
                      sessionId,
                      promptCount: newPromptsCount,
                      workspacePath: session.workspacePath  // Include for renderer-side filtering
                    });

                    // Directly trigger queue processing from main process
                    // This ensures mobile messages are processed even when the session isn't open in the UI
                    logger.main.info('[AIService] Triggering queue processing for mobile prompt');
                    this.processQueuedPrompt(sessionId, session.workspacePath, targetWindow);
                  } else {
                    logger.main.warn('[AIService] No window found for workspace:', session.workspacePath);
                  }
                } else {
                  // Sessions MUST have a workspacePath - this indicates a data integrity issue
                  logger.main.error('[AIService] Session has no workspacePath - cannot route queued prompts. SessionId:', sessionId);
                  // Do NOT fall back to windows[0] - that masks the real bug
                }
              } catch (err) {
                logger.main.error('[AIService] Failed to insert queuedPrompts into table:', err);
              }
            }
          });

        this.mobileSyncHandlerInitialized = true;
        logger.main.info('[AIService] Mobile sync handler initialized (using queued_prompts table)');
      } else {
        logger.main.info('[AIService] onIndexChange not available on sync provider');
      }

      // Listen for session creation requests from mobile
      if (syncProvider.onCreateSessionRequest) {
        syncProvider.onCreateSessionRequest(async (request) => {
          logger.main.info('[AIService] Received create session request from mobile:', {
            requestId: request.requestId,
            projectId: request.projectId,
            hasInitialPrompt: !!request.initialPrompt
          });

          // Deduplicate requests - same request can be delivered multiple times
          if (this.processingMobileSessionRequests.has(request.requestId)) {
            logger.main.info('[AIService] Ignoring duplicate session creation request:', request.requestId);
            return;
          }
          this.processingMobileSessionRequests.add(request.requestId);
          // Clean up after 60 seconds to prevent memory leak
          setTimeout(() => {
            this.processingMobileSessionRequests.delete(request.requestId);
          }, 60000);

          try {
            // Find a window for this project/workspace
            const { BrowserWindow } = await import('electron');
            const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());

            if (windows.length === 0) {
              logger.main.warn('[AIService] No windows available to create session');
              if (syncProvider.sendCreateSessionResponse) {
                syncProvider.sendCreateSessionResponse({
                  requestId: request.requestId,
                  success: false,
                  error: 'No desktop windows available'
                });
              }
              return;
            }

            // Mobile MUST provide a valid projectId - sessions cannot be created without a workspace
            if (!request.projectId || request.projectId === 'default') {
              logger.main.error('[AIService] Mobile session request missing valid projectId:', request.projectId);
              if (syncProvider.sendCreateSessionResponse) {
                syncProvider.sendCreateSessionResponse({
                  requestId: request.requestId,
                  success: false,
                  error: 'projectId is required - cannot create session without workspace'
                });
              }
              return;
            }

            // Find the window that matches this project's workspace path
            let targetWindow: BrowserWindow | undefined;
            let workspacePath: string | undefined;

            // Try to find a window with this workspace using findWindowByWorkspace
            const matchedWindow = findWindowByWorkspace(request.projectId);
            if (matchedWindow) {
              targetWindow = matchedWindow;
              workspacePath = request.projectId;
            } else {
              // Try to find by project name (last path component)
              for (const win of windows) {
                const state = windowStates.get(win.id);
                if (state?.workspacePath) {
                  const pathBasename = state.workspacePath.split(/[\\/]/).pop();
                  if (pathBasename === request.projectId || state.workspacePath.includes(request.projectId)) {
                    targetWindow = win;
                    workspacePath = state.workspacePath;
                    break;
                  }
                }
              }
            }

            // FAIL if no matching window found - do NOT fall back to windows[0]
            if (!targetWindow || !workspacePath) {
              logger.main.error('[AIService] No window found for projectId:', request.projectId);
              if (syncProvider.sendCreateSessionResponse) {
                syncProvider.sendCreateSessionResponse({
                  requestId: request.requestId,
                  success: false,
                  error: `No open window found for project: ${request.projectId}`
                });
              }
              return;
            }

            // Create the session using the SessionManager
            // Use mobile's provider/model selection if provided, otherwise fall back to desktop defaults
            const resolvedProvider = (request.provider || 'claude-code') as import('@nimbalyst/runtime/ai/server/types').AIProviderType;
            const resolvedModel = request.model || getDefaultAIModel() || 'claude-code:opus';
            const resolvedSessionType = (request.sessionType || 'session') as import('@nimbalyst/runtime/ai/server/types').SessionType;
            const session = await this.sessionManager.createSession(
              resolvedProvider,        // provider - from mobile or default
              undefined,               // documentContext
              workspacePath,           // workspacePath
              undefined,               // providerConfig
              resolvedModel,           // model - from mobile or desktop default
              resolvedSessionType,     // sessionType - from mobile request
              'agent'                  // mode
            );

            // If a parentSessionId was provided, set it on the session
            if (request.parentSessionId && session) {
              const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
              await AISessionsRepository.updateMetadata(session.id, { parentSessionId: request.parentSessionId });
            }

            logger.main.info('[AIService] Created session for mobile request:', {
              requestId: request.requestId,
              sessionId: session.id,
              workspacePath
            });
            if (session && syncProvider.syncSessionsToIndex) {
              logger.main.info('[AIService] Syncing new session to index:', session.id);
              syncProvider.syncSessionsToIndex([{
                id: session.id,
                title: session.title ?? 'Untitled',
                provider: session.provider,
                model: session.model,
                mode: session.mode,
                workspaceId: session.workspacePath,
                workspacePath: session.workspacePath,
                messageCount: session.messages.length,
                updatedAt: session.updatedAt,
                createdAt: session.createdAt
              }]);
            } else {
              logger.main.warn('[AIService] Cannot sync session - syncSessionsToIndex not available');
            }

            // Notify renderer to refresh session list
            if (targetWindow && !targetWindow.isDestroyed()) {
              logger.main.info('[AIService] Notifying renderer to refresh session list after mobile session creation');
              targetWindow.webContents.send('sessions:refresh-list', {
                workspacePath,
                sessionId: session.id
              });
            }

            // Send success response
            if (syncProvider.sendCreateSessionResponse) {
              logger.main.info('[AIService] Sending success response to mobile for:', request.requestId);
              syncProvider.sendCreateSessionResponse({
                requestId: request.requestId,
                success: true,
                sessionId: session.id
              });
            } else {
              logger.main.warn('[AIService] Cannot send response - sendCreateSessionResponse not available');
            }

            // If there's an initial prompt, queue it for execution
            if (request.initialPrompt && session) {
              const promptId = `mobile-create-prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const { getQueuedPromptsStore } = await import('../RepositoryManager');
              const queueStore = getQueuedPromptsStore();

              await queueStore.create({
                id: promptId,
                sessionId: session.id,
                prompt: request.initialPrompt
              });

              logger.main.info('[AIService] Queued initial prompt from mobile:', {
                sessionId: session.id,
                promptId
              });

              // Notify the window to process the queue
              if (targetWindow && !targetWindow.isDestroyed()) {
                targetWindow.webContents.send('ai:queuedPromptsReceived', {
                  sessionId: session.id,
                  promptCount: 1,
                  workspacePath
                });
              }
            }

            // Notify the window to show the new session
            if (targetWindow && !targetWindow.isDestroyed()) {
              targetWindow.webContents.send('ai:sessionCreatedFromMobile', {
                sessionId: session.id,
                requestId: request.requestId
              });
            }
          } catch (error) {
            logger.main.error('[AIService] Failed to create session from mobile:', error);
            if (syncProvider.sendCreateSessionResponse) {
              syncProvider.sendCreateSessionResponse({
                requestId: request.requestId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
        });

        logger.main.info('[AIService] Session creation request handler initialized');
      } else {
        logger.main.info('[AIService] onCreateSessionRequest not available on sync provider');
      }

      // Handle worktree creation requests from mobile
      // Mirrors the desktop worktree:create IPC handler + AgentMode session creation exactly
      if (syncProvider.onCreateWorktreeRequest) {
        syncProvider.onCreateWorktreeRequest(async (request) => {
          logger.main.info('[AIService] Received worktree creation request from mobile:', request.requestId, 'projectId:', request.projectId);
          try {
            // Step 1: Create git worktree with name deduplication (same as worktree:create handler)
            const { GitWorktreeService } = await import('../GitWorktreeService');
            const { createWorktreeStore } = await import('../WorktreeStore');
            const { getDatabase } = await import('../../database/initialize');
            const { gitRefWatcher } = await import('../../file/GitRefWatcher');

            const gitWorktreeService = new GitWorktreeService();
            const db = getDatabase();
            if (!db) throw new Error('Database not initialized');
            const worktreeStore = createWorktreeStore(db);

            // Deduplicate name across DB, filesystem, and branches (same as worktree:create)
            const [dbNames, filesystemNames, branchNames] = await Promise.all([
              worktreeStore.getAllNames(),
              Promise.resolve(gitWorktreeService.getExistingWorktreeDirectories(request.projectId)),
              gitWorktreeService.getAllBranchNames(request.projectId),
            ]);
            const existingNames = new Set<string>();
            for (const n of dbNames) existingNames.add(n);
            for (const n of filesystemNames) existingNames.add(n);
            for (const n of branchNames) existingNames.add(n);
            const finalName = gitWorktreeService.generateUniqueWorktreeName(existingNames);

            // Create the git worktree
            const worktree = await gitWorktreeService.createWorktree(request.projectId, { name: finalName });

            // Store in WorktreeStore (same as worktree:create)
            await worktreeStore.create(worktree);

            // Start git ref watcher (same as worktree:create)
            gitRefWatcher.start(worktree.path).catch((err: Error) => {
              logger.main.error('[AIService] Failed to start GitRefWatcher for worktree:', err);
            });

            logger.main.info('[AIService] Worktree created from mobile:', worktree.id, 'name:', worktree.name, 'branch:', worktree.branch);

            // Step 2: Create session with worktreeId (same as AgentMode + sessions:create)
            const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
            const { randomUUID } = await import('crypto');
            const defaultModel = getDefaultAIModel() || 'claude-code:opus';
            const sessionId = randomUUID();
            const sessionTitle = `Worktree: ${worktree.name}`;

            await AISessionsRepository.create({
              id: sessionId,
              provider: 'claude-code',
              model: defaultModel,
              title: sessionTitle,
              workspaceId: request.projectId,
              worktreeId: worktree.id,
            });
            logger.main.info('[AIService] Worktree session created:', sessionId, 'worktreeId:', worktree.id);

            // Step 3: Notify renderer to refresh and set workstream state
            const targetWindow = findWindowByWorkspace(request.projectId);
            if (targetWindow && !targetWindow.isDestroyed()) {
              targetWindow.webContents.send('sessions:refresh-list', {
                workspacePath: request.projectId,
                sessionId,
              });
              targetWindow.webContents.send('worktree:session-created', {
                sessionId,
                worktreeId: worktree.id,
              });
            }

            // Step 4: Sync to index so iOS sees it
            if (syncProvider.syncSessionsToIndex) {
              const now = Date.now();
              syncProvider.syncSessionsToIndex([{
                id: sessionId,
                title: sessionTitle,
                provider: 'claude-code',
                model: defaultModel,
                mode: 'agent',
                workspaceId: request.projectId,
                workspacePath: request.projectId,
                messageCount: 0,
                updatedAt: now,
                createdAt: now,
              }]);
            }

            if (syncProvider.sendCreateWorktreeResponse) {
              syncProvider.sendCreateWorktreeResponse({
                requestId: request.requestId,
                success: true,
              });
            }
          } catch (error) {
            logger.main.error('[AIService] Failed to create worktree from mobile:', error);
            if (syncProvider.sendCreateWorktreeResponse) {
              syncProvider.sendCreateWorktreeResponse({
                requestId: request.requestId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        });
        logger.main.info('[AIService] Worktree creation request handler initialized');
      }

      // Initialize mobile session control handler (cancel, question responses, etc.)
      // This is in a separate module to keep AIService focused
      initMobileSessionControlHandler(syncProvider, findWindowByWorkspace);
    } catch (error) {
      logger.main.error('[AIService] Failed to initialize mobile sync handler:', error);
    }
  }

  private async getProviderForSession(session: SessionData): Promise<AIProvider | null> {
    const providerType = session.provider as AIProviderType;

    // Try to get existing provider first
    let provider = ProviderFactory.getProvider(providerType, session.id);

    // If no existing provider, create one
    if (!provider) {
      logger.main.info('[AIService] Creating new provider for session:', session.id, 'type:', providerType);
      try {
        provider = ProviderFactory.createProvider(providerType, session.id);
      } catch (error) {
        logger.main.error('[AIService] Failed to create provider:', providerType, error);
        return null;
      }
    }

    // NOTE: Message sync is handled automatically by SyncedAgentMessagesStore

    return provider;
  }

  /**
   * Automatically runs the /context command for claude-code sessions to fetch accurate token usage.
   * @param session The AI session
   * @param workspacePath The workspace path to use (should be worktree path for worktree sessions)
   * @param event The IPC event for sending updates
   */
  private async runAutoContextCommand(
    session: SessionData,
    workspacePath: string,
    event: Electron.IpcMainInvokeEvent
  ): Promise<void> {
    if (session.provider !== 'claude-code') {
      return;
    }

    const sendAutoContextEvent = (phase: 'start' | 'end') => {
      try {
        // console.log(`[AIService] Sending ai:auto-context-${phase} event for session:`, session.id);
        safeSend(event, `ai:auto-context-${phase}`, {
          sessionId: session.id
        });
        // console.log(`[AIService] Successfully sent ai:auto-context-${phase} event`);
      } catch (err) {
        console.error('[AIService] Failed to send auto-context lifecycle event:', err);
      }
    };

    sendAutoContextEvent('start');

    try {
      const contextProvider = ProviderFactory.getProvider(session.provider as AIProviderType, session.id);
      if (!contextProvider) {
        console.warn('[AIService] No context provider found for session:', session.id);
        return;
      }

      const updatedSession = await this.sessionManager.loadSession(session.id, workspacePath);
      if (!updatedSession) {
        console.error('[AIService] Failed to reload session for /context command');
        logger.main.error('Failed to reload session for /context command');
        return;
      }

      if (contextProvider.setHiddenMode) {
        contextProvider.setHiddenMode(true);
      }

      let contextResponse = '';
      for await (const chunk of contextProvider.sendMessage('/context', undefined, session.id, updatedSession.messages, workspacePath, [])) {
        if (!chunk) continue;

        if (chunk.type === 'text') {
          contextResponse += chunk.content || '';
        } else if (chunk.type === 'complete') {
          const parsedUsage = parseContextUsageMessage(contextResponse);

          if (parsedUsage) {
            // Get current session to preserve cumulative tokens
            const currentSession = await this.sessionManager.loadSession(session.id, workspacePath);
            const currentUsage = currentSession?.tokenUsage ?? {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0
            };

            // Store /context data in currentContext (snapshot of context window)
            // Preserve cumulative input/output tokens from modelUsage
            const tokenUsage = {
              inputTokens: currentUsage.inputTokens,
              outputTokens: currentUsage.outputTokens,
              totalTokens: currentUsage.totalTokens,
              costUSD: currentUsage.costUSD,
              // Legacy fields for backward compatibility
              contextWindow: parsedUsage.contextWindow,
              categories: parsedUsage.categories,
              // New field for context window snapshot
              currentContext: {
                tokens: parsedUsage.totalTokens,
                contextWindow: parsedUsage.contextWindow,
                categories: parsedUsage.categories,
                rawResponse: contextResponse  // Store raw markdown for display on session reload
              }
            };

            // Persist token usage to session metadata
            await this.sessionManager.updateSessionTokenUsage(session.id, tokenUsage);

            // Push context usage to mobile sync
            const syncProvider = getSyncProvider();
            if (syncProvider) {
              syncProvider.pushChange(session.id, {
                type: 'metadata_updated',
                metadata: {
                  currentContext: {
                    tokens: parsedUsage.totalTokens,
                    contextWindow: parsedUsage.contextWindow,
                  },
                  updatedAt: Date.now(),
                } as any,
              });
            }

            // Also send IPC event to update UI immediately
            safeSend(event, 'ai:tokenUsageUpdated', {
              sessionId: session.id,
              tokenUsage
            });
          } else {
            console.error('[AIService] Failed to parse /context response for token usage. Full response:', contextResponse);
            logger.main.warn('Failed to parse /context response for token usage');
          }

          break;
        } else if (chunk.type === 'error') {
          console.error('[AIService] Error chunk from /context:', chunk.error || 'Unknown error');
          logger.main.error('Error fetching context:', chunk.error || 'Unknown error');
          break;
        }
      }
    } catch (contextError) {
      console.error('[AIService] Exception while fetching context usage:', contextError);
      logger.main.error('Failed to fetch context usage:', contextError);
      // Don't fail the main request if context fetch fails
    } finally {
      sendAutoContextEvent('end');
    }
  }

  private setupIpcHandlers() {
    // Check if any AI provider is configured with usable models
    safeHandle('ai:hasApiKey', async () => {  // Keeping the name for backward compatibility
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getNormalizedProviderSettings() as any;

      // Claude Code uses its own auth (SSO) - always available if enabled
      const claudeCodeEnabled = providerSettings['claude-code']?.enabled !== false;
      if (claudeCodeEnabled) return true;

      // Claude Chat needs an Anthropic API key and enabled models
      const hasAnthropicKey = !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY);
      if (hasAnthropicKey) {
        const hasClaude = providerSettings['claude']?.enabled &&
                         providerSettings['claude']?.models?.length > 0;
        if (hasClaude) return true;
      }

      // Check OpenAI (needs API key and enabled models)
      const hasOpenAIKey = !!(apiKeys['openai'] || process.env.OPENAI_API_KEY);
      if (hasOpenAIKey) {
        const hasOpenAI = providerSettings['openai']?.enabled &&
                         providerSettings['openai']?.models?.length > 0;
        if (hasOpenAI) return true;
      }

      // Check OpenAI Codex (uses its own auth, doesn't need API key in settings)
      const hasCodex = providerSettings['openai-codex']?.enabled === true;
      if (hasCodex) return true;

      // Check LM Studio (doesn't need API key but needs enabled models)
      const hasLMStudio = providerSettings['lmstudio']?.enabled === true &&
                         providerSettings['lmstudio']?.models?.length > 0;
      if (hasLMStudio) return true;

      return false;
    });

    // Initialize/configure AI
    safeHandle('ai:initialize', async (event, provider?: string, apiKey?: string) => {
      if (apiKey) {
        // Save API key for the Claude Chat provider only
        // Claude Code has its own auth (SSO) and should never use this key
        const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
        apiKeys['anthropic'] = apiKey;
        this.getSettingsStore().set('apiKeys', apiKeys);
      }

      return { success: true };
    });

    // Create new session with provider and model selection
    safeHandle('ai:createSession', async (
      event,
      provider: AIProviderType,
      documentContext?: DocumentContext,
      workspacePath?: string,
      modelId?: string,
      sessionType?: string,
      worktreeId?: string
    ) => {
      // TODO: Debug logging - uncomment if needed
      //   provider,
      //   modelId,
      //   hasDocumentContext: !!documentContext,
      //   workspacePath,
      //   sessionType,
      //   worktreeId
      // });

      // If worktreeId is provided, fetch the worktree data to get its path and project path
      let worktreePath: string | undefined;
      let worktreeProjectPath: string | undefined;
      if (worktreeId) {
        const { getDatabase } = await import('../../database/initialize');
        const { createWorktreeStore } = await import('../WorktreeStore');
        const db = getDatabase();
        if (!db) {
          throw new Error('Database not initialized');
        }
        const worktreeStore = createWorktreeStore(db);
        const worktree = await worktreeStore.get(worktreeId);
        if (!worktree) {
          throw new Error(`Worktree ${worktreeId} not found in database`);
        }

        // Validate that the worktree directory actually exists
        if (!fs.existsSync(worktree.path)) {
          throw new Error(
            `Worktree directory does not exist: ${worktree.path}\n` +
            `The worktree may have been deleted manually. Please remove the worktree from the UI and create a new one.`
          );
        }

        worktreePath = worktree.path;
        worktreeProjectPath = worktree.projectPath;  // Store for permission lookups
      }

      // Check if provider is enabled for this workspace (considers project overrides)
      if (!this.isProviderEnabledForWorkspace(provider, workspacePath)) {
        throw new Error(`Provider ${provider} is not enabled for this workspace`);
      }

      // Get API key using project-aware helper (considers project overrides)
      let apiKey = this.getApiKeyForProvider(provider, workspacePath);

      // Validate API key requirement based on provider
      switch (provider) {
        case 'claude':
          if (!apiKey) {
            throw new Error('Anthropic API key not configured');
          }
          break;
        case 'claude-code':
          // Claude Code: API key is optional, uses SSO login if not provided
          // No error if missing - will use SSO login
          break;
        case 'openai':
          if (!apiKey) {
            throw new Error('OpenAI API key not configured');
          }
          break;
        case 'openai-codex':
          // Codex SDK uses its own auth (codex auth login), API key is optional
          break;
        case 'lmstudio':
          // LMStudio doesn't need an API key, just the base URL
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }

      // Get model details if specified
      let model = modelId;
      if (!model) {
        // Use provider defaults when no explicit model is supplied
        model = await ModelRegistry.getDefaultModel(provider);
      }

      // For claude-code, don't pass a model at all - let it handle its own selection
      const providerConfig: any = {
        maxTokens: this.getProviderSetting(provider, 'maxTokens'),
        temperature: this.getProviderSetting(provider, 'temperature')
      };

      // Only add model to config if we have one and it's not claude-code
      if (model) {
        const modelForProvider = extractModelForProvider(model, provider);
        if (modelForProvider !== null) {
          providerConfig.model = modelForProvider;
        } else if (provider !== 'claude-code') {
          // extractModelForProvider returned null (invalid model) - fall back to default
          const defaultModel = await ModelRegistry.getDefaultModel(provider);
          if (defaultModel) {
            const defaultModelForProvider = extractModelForProvider(defaultModel, provider);
            if (defaultModelForProvider !== null) {
              providerConfig.model = defaultModelForProvider;
              logger.main.info(`[AIService] Fell back to default model "${defaultModel}" for provider ${provider}`);
            }
          }
        }
      } else if (provider !== 'claude-code') {
        // For other providers, fall back to settings
        const settingsModel = this.getProviderSetting(provider, 'model');
        if (settingsModel) {
          const modelForProvider = extractModelForProvider(settingsModel, provider);
          if (modelForProvider !== null) {
            providerConfig.model = modelForProvider;
          }
        }
        // If still no model, get provider default
        if (!providerConfig.model) {
          const defaultModel = await ModelRegistry.getDefaultModel(provider);
          if (defaultModel) {
            const defaultModelForProvider = extractModelForProvider(defaultModel, provider);
            if (defaultModelForProvider !== null) {
              providerConfig.model = defaultModelForProvider;
            }
          }
        }
      }

      // Create session with worktree association
      const session = await this.sessionManager.createSession(
        provider,
        documentContext,
        workspacePath,
        providerConfig,
        model,
        (sessionType || 'session') as SessionType, // Default to 'session' if not specified
        undefined, // mode
        worktreeId,
        worktreePath,
        worktreeProjectPath
      );

      // Track AI chat feature first use
      const { FeatureTrackingService } = await import('../analytics/FeatureTrackingService');
      const { AnalyticsService } = await import('../analytics/AnalyticsService');
      const featureTracking = FeatureTrackingService.getInstance();
      if (featureTracking.isFirstUse('ai_chat')) {
        const daysSinceInstall = featureTracking.getDaysSinceInstall();
        AnalyticsService.getInstance().sendEvent('feature_first_use', {
          feature: 'ai_chat',
          daysSinceInstall,
        });
      }

      // Create and initialize provider
      const providerInstance = ProviderFactory.createProvider(provider, session.id);

      // Build config based on provider type
      const initConfig: any = {
        maxTokens: (session.providerConfig as any)?.maxTokens,
        temperature: (session.providerConfig as any)?.temperature
      };

      // Claude Code manages its own authentication - do not pass API key
      if (provider !== 'claude-code') {
        initConfig.apiKey = apiKey;
      }

      // Only skip explicit model assignment for claude-code (it manages variants internally)
      // Check both session.model (set via UI) and providerConfig.model (set at creation)
      if ((session.model || session.providerConfig?.model) && provider !== 'claude-code') {
        const fullModel = session.model || session.providerConfig?.model;
        if (fullModel) {
          const modelForProvider = extractModelForProvider(fullModel, provider);
          if (modelForProvider !== null) {
            initConfig.model = modelForProvider;
          } else {
            // extractModelForProvider returned null - fall back to default
            const defaultModel = await ModelRegistry.getDefaultModel(provider);
            if (defaultModel) {
              const defaultModelForProvider = extractModelForProvider(defaultModel, provider);
              if (defaultModelForProvider !== null) {
                initConfig.model = defaultModelForProvider;
                logger.main.info(`[AIService] Fell back to default model "${defaultModel}" for provider ${provider}`);
              }
            }
          }
        }
      } else if (provider !== 'claude-code') {
        // No model specified - get default
        const defaultModel = await ModelRegistry.getDefaultModel(provider);
        if (defaultModel) {
          const defaultModelForProvider = extractModelForProvider(defaultModel, provider);
          if (defaultModelForProvider !== null) {
            initConfig.model = defaultModelForProvider;
          }
        }
      }

      // Add LMStudio-specific config
      if (provider === 'lmstudio') {
        const lmstudioSettings = this.getSettingsStore().get('providerSettings.lmstudio', {}) as any;
        const storedApiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
        initConfig.baseUrl = lmstudioSettings.baseUrl || storedApiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
      }

      // Pass through allowedTools and effort level settings for Claude Code
      if (provider === 'claude-code') {
        const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
        if (providerSettings?.['claude-code']?.allowedTools) {
          initConfig.allowedTools = providerSettings['claude-code'].allowedTools;
        }
        // Pass effort level from session metadata (Opus 4.6 adaptive reasoning)
        if ((session.metadata as any)?.effortLevel) {
          initConfig.effortLevel = parseEffortLevel((session.metadata as any).effortLevel);
        }
      }

      await providerInstance.initialize(initConfig);

      // Register tool handler - targetFilePath will be determined dynamically per tool call
      const toolHandler = this.createToolHandler(event.sender, documentContext, session.id, workspacePath);
      providerInstance.registerToolHandler(toolHandler);

      // NOTE: No longer tracking provider per-window - ProviderFactory handles per-session tracking
      // This allows multiple concurrent sessions in the same window

      // NOTE: Mobile message handling is done via startIndexListener() which watches
      // the index for pendingExecution flags. We do NOT call watchSession() here because
      // it creates a WebSocket connection per session, causing performance issues.

      this.analytics.sendEvent('create_ai_session', {
        provider,
        is_worktree_session: !!session.worktreeId,
        is_workstream_child: !!session.parentSessionId,
      });
      return session;
    });

    // Send message to AI - store handler for queue processing
    this.sendMessageHandler = async (
      event,
      message: string,
      documentContext?: DocumentContext,
      sessionId?: string,
      workspacePath?: string
    ) => {
      // Check for queued prompt deduplication - prevents duplicate execution from multiple renderer panels
      const queuedPromptId = (documentContext as any)?.queuedPromptId as string | undefined;
      if (queuedPromptId) {
        if (this.processingQueuedPromptIds.has(queuedPromptId)) {
          logger.main.info(`[AIService] SKIPPING duplicate queued prompt: ${queuedPromptId}`);
          return { content: '' }; // Already being processed, return empty response
        }

        // Mark prompt ID as processing
        // Note: session lock is already set in claimQueuedPrompt handler, no need to check here
        this.processingQueuedPromptIds.add(queuedPromptId);
        logger.main.info(`[AIService] Processing queued prompt: ${queuedPromptId}, session: ${sessionId}, total prompts in progress: ${this.processingQueuedPromptIds.size}`);
      }

      // Extract attachments from documentContext if present
      // Mobile attachments arrive as EncryptedAttachment[] (with encryptedData/iv fields)
      // and need decryption + temp file writing before they can be used as ChatAttachments
      let attachments = (documentContext as any)?.attachments;
      if (attachments && attachments.length > 0 && attachments[0].encryptedData && workspacePath) {
        try {
          const { decryptMobileAttachments } = await import('../SyncManager');
          attachments = await decryptMobileAttachments(attachments, workspacePath, sessionId!);
          logger.main.info(`[AIService] Decrypted ${attachments.length} mobile attachments`);
        } catch (err) {
          logger.main.error('[AIService] Failed to decrypt mobile attachments:', err);
          attachments = undefined;
        }
      }
      const startTime = Date.now();
      const perfLog: any = {
        startTime,
        provider: '',
        model: '',
        messageLength: message.length,
        hasDocumentContext: !!documentContext
      };

      // ALWAYS load session by ID - never use "current" session (causes cross-window issues)
      if (!sessionId) {
        throw new Error('No session ID provided - cannot send message');
      }

      // Get workspace path from window state if not provided
      if (!workspacePath) {
        const windowState = windowStates.get(event.sender.id);
        workspacePath = windowState?.workspacePath || undefined;
      }

      // Require workspace path for AI operations
      if (!workspacePath) {
        throw new Error('No workspace path available - AI operations require an open workspace');
      }

      const loadStartTime = Date.now();
      const session = await this.sessionManager.loadSession(sessionId, workspacePath);
      perfLog.sessionLoadTime = Date.now() - loadStartTime;

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }


      // Verify we got the right session
      if (session.id !== sessionId) {
        console.error(`[AIService] CRITICAL ERROR: Requested session ${sessionId} but got session ${session.id}!`);
        throw new Error(`Session mismatch: requested ${sessionId} but got ${session.id}`);
      }

      // CRITICAL: If session has a worktree, use its path instead of workspace path
      // This ensures Claude Code runs in the worktree directory
      let effectiveWorkspacePath = session.worktreePath || workspacePath;

      // For worktree sessions, use the parent project path for permission lookups
      // This is passed through documentContext to avoid changing sendMessage signature
      let permissionsPath = session.worktreeProjectPath || effectiveWorkspacePath;
      if (session.provider === 'openai-codex') {
        await this.ensureCodexSessionWatcher(session.id, effectiveWorkspacePath, event);
      }

      // Comprehensive logging of what we're sending to Claude
      //   hasDocument: !!documentContext,
      //   filePath: documentContext?.filePath || 'none',
      //   fileType: documentContext?.fileType || 'none',
      //   contentLength: documentContext?.content?.length || 0,
      // });

      if (documentContext?.content) {
        //   documentContext.content.substring(0, 500) +
        //   (documentContext.content.length > 500 ? '...' : ''));

        // Check for frontmatter
        const frontmatterMatch = documentContext.content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
        } else {
        }
      }

      // Show available tools
      const tools = toolRegistry.getAll();
      console.groupEnd();

      perfLog.provider = session.provider;
      perfLog.model = session.model || 'default';

      // Add user message to session (include attachments if present)
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        mode: documentContext?.mode,
      };
      // logger.main.info(`[AIService] Adding user message to session ${session.id}: "${message.substring(0, 50)}..." (queuedPromptId: ${queuedPromptId || 'none'}, mode: ${documentContext?.mode})`);
      await this.sessionManager.addMessage(userMessage, session.id);
      // logger.main.info(`[AIService] User message added successfully to session ${session.id}`);

      // Update session title if this is the first user message
      if (session.messages.length === 0 || (session.messages.length === 1 && session.messages[0].role === 'user')) {
        // Generate a provisional title from the first message without locking out auto-naming
        const title = message.length > 100 ? message.substring(0, 97) + '...' : message;
        await this.sessionManager.updateSessionTitle(session.id, title, {
          force: true,
          markAsNamed: false,
        });
      }

      // Get or create provider for this session
      const providerStartTime = Date.now();
      const isProviderClaudeCode = session.provider === 'claude-code';

      // if (isProviderClaudeCode) {
      // }

      let provider = ProviderFactory.getProvider(session.provider as AIProviderType, session.id);
      perfLog.getProviderTime = Date.now() - providerStartTime;

      // If provider doesn't exist, create and initialize it
      if (!provider) {
        if (isProviderClaudeCode) {
        }
        const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

        // Get the correct API key based on provider
        let apiKey: string | undefined;
        let errorMessage = 'API key not configured';
        let requiresApiKey = true;
        switch (session.provider) {
          case 'claude':
            apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
            errorMessage = 'Anthropic API key not configured';
            break;
          case 'claude-code':
            // Claude Code: API key is optional, uses SSO login if not provided
            apiKey = apiKeys['claude-code'];
            requiresApiKey = false;
            break;
          case 'openai':
            apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;
            errorMessage = 'OpenAI API key not configured';
            break;
          case 'openai-codex':
            // Codex SDK uses its own auth (codex auth login), API key is optional
            apiKey = apiKeys['openai-codex'];
            requiresApiKey = false;
            break;
          case 'lmstudio':
            // LMStudio doesn't need an API key, just the base URL
            apiKey = 'not-required'; // Dummy value since LMStudio doesn't need a key
            break;
          default:
            throw new Error(`Unknown provider: ${session.provider}`);
        }

        if (!apiKey && requiresApiKey) {
          throw new Error(errorMessage);
        }

        // Create the provider
        if (isProviderClaudeCode) {
        }
        provider = ProviderFactory.createProvider(session.provider, session.id);

        if (isProviderClaudeCode) {
        }

        const reinitConfig: any = {
          apiKey,
          maxTokens: (session.providerConfig as any)?.maxTokens,
          temperature: (session.providerConfig as any)?.temperature,
          // Pass effort level from session metadata (Opus 4.6 adaptive reasoning)
          ...((session.metadata as any)?.effortLevel && {
            effortLevel: parseEffortLevel((session.metadata as any).effortLevel),
          }),
        };

        // Add baseUrl for LMStudio
        if (session.provider === 'lmstudio') {
          const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
          reinitConfig.baseUrl = providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234';
        }

        // Pass model to provider config for all providers including claude-code
        // Claude Code uses the model field to select variants (opus/sonnet/haiku)
        if (session.model || session.providerConfig?.model) {
          const fullModel = session.model || session.providerConfig?.model;

          if (fullModel) {
            // For claude-code, pass the full model ID (e.g., "claude-code:opus")
            // For other providers, extract the model-only part
            if (isProviderClaudeCode) {
              reinitConfig.model = fullModel;
            } else {
              const modelForProvider = extractModelForProvider(fullModel, session.provider as AIProviderType);
              if (modelForProvider !== null) {
                reinitConfig.model = modelForProvider;
              } else {
                // extractModelForProvider returned null - fall back to default
                const defaultModel = await ModelRegistry.getDefaultModel(session.provider as AIProviderType);
                if (defaultModel) {
                  const defaultModelForProvider = extractModelForProvider(defaultModel, session.provider as AIProviderType);
                  if (defaultModelForProvider !== null) {
                    reinitConfig.model = defaultModelForProvider;
                    logger.main.info(`[AIService] Fell back to default model "${defaultModel}" for provider ${session.provider}`);
                  }
                }
              }
            }
          }
        } else {
          // No model specified - get default
          const defaultModel = await ModelRegistry.getDefaultModel(session.provider as AIProviderType);
          if (defaultModel) {
            if (isProviderClaudeCode) {
              reinitConfig.model = defaultModel;
            } else {
              const defaultModelForProvider = extractModelForProvider(defaultModel, session.provider as AIProviderType);
              if (defaultModelForProvider !== null) {
                reinitConfig.model = defaultModelForProvider;
              }
            }
          }
        }

        if (isProviderClaudeCode) {
          const safeConfig = { ...reinitConfig, apiKey: reinitConfig.apiKey ? '***' : undefined };
        }
        const safeConfig = { ...reinitConfig, apiKey: reinitConfig.apiKey ? '***' : undefined };
        const initStartTime = Date.now();

        try {
          await provider.initialize(reinitConfig);
          perfLog.providerInitTime = Date.now() - initStartTime;

          if (isProviderClaudeCode) {
          }
        } catch (initError: any) {
          if (isProviderClaudeCode) {
            console.error('[CLAUDE-CODE-SERVICE] Failed to initialize provider:', initError);
            console.error('[CLAUDE-CODE-SERVICE] Init config was:', reinitConfig);
          }

          // Add provider initialization error as an assistant message in the conversation
          // This provides better UX than showing a generic "Failed to load session" error
          const errorMessage: Message = {
            role: 'assistant',
            content: `I encountered an error connecting to ${session.provider}:\n\n${initError.message || String(initError)}`,
            timestamp: Date.now()
          };

          await this.sessionManager.addMessage(errorMessage, session.id);

          // Clean up processing state
          if (queuedPromptId) {
            this.processingQueuedPromptIds.delete(queuedPromptId);
          }

          // Return empty response instead of throwing - the error message is now in the conversation
          return { content: '' };
        }

        // CRITICAL: Restore provider session data from database
        // This is essential for session resumption (e.g., Claude Code sessions)
        if (session.providerSessionId && provider.setProviderSessionData) {
          provider.setProviderSessionData(session.id, {
            providerSessionId: session.providerSessionId,
            // Backward-compatible keys for existing providers
            claudeSessionId: session.providerSessionId,
            codexThreadId: session.providerSessionId,
          });
        }

        // Register tool handler - targetFilePath will be determined dynamically per tool call
        const toolHandler = this.createToolHandler(event.sender, documentContext, session.id, effectiveWorkspacePath);
        provider.registerToolHandler(toolHandler);
      }

      // NOTE: No longer tracking provider per-window - each session has its own provider instance

      // Re-register tool handler with the CURRENT document context from this message
      // This ensures applyDiff targets the correct file even when switching tabs
      //   filePath: documentContext?.filePath,
      //   hasContext: !!documentContext
      // });
      const toolHandler = this.createToolHandler(event.sender, documentContext, session.id, effectiveWorkspacePath);
      provider.registerToolHandler(toolHandler);

      // Listen for message:logged events and forward to renderer to trigger UI updates
      // Skip hidden messages - they shouldn't trigger UI refreshes
      const onMessageLogged = (data: { sessionId: string; direction: string; hidden?: boolean }) => {
        if (data.hidden) return;
        safeSend(event, 'ai:message-logged', data);
      };
      // Remove all previous listeners to avoid duplicates
      provider.removeAllListeners('message:logged');
      provider.on('message:logged', onMessageLogged);

      // Helper to sync pending prompt state to mobile
      const syncPendingPrompt = (sessionId: string, hasPendingPrompt: boolean) => {
        const sp = getSyncProvider();
        if (sp) {
          sp.pushChange(sessionId, {
            type: 'metadata_updated',
            metadata: { hasPendingPrompt, updatedAt: Date.now() },
          });
        }
      };

      // Listen for ExitPlanMode confirmation requests and forward to renderer
      const onExitPlanModeConfirm = (data: { requestId: string; sessionId: string; planSummary: string; timestamp: number }) => {
        logger.main.info('[AIService] ExitPlanMode confirmation requested:', data.requestId);
        safeSend(event, 'ai:exitPlanModeConfirm', data);
        syncPendingPrompt(data.sessionId, true);
        TrayManager.getInstance().onPromptCreated(data.sessionId);

        // Show OS notification if app is backgrounded
        const sessionTitle = session.title || 'AI Session';
        notificationService.showBlockedNotification(
          data.sessionId,
          sessionTitle,
          'plan_approval',
          effectiveWorkspacePath
        );
      };
      provider.removeAllListeners('exitPlanMode:confirm');
      provider.on('exitPlanMode:confirm', onExitPlanModeConfirm);

      // Listen for AskUserQuestion requests and forward to renderer
      const onAskUserQuestion = (data: { questionId: string; sessionId: string; questions: any[]; timestamp: number }) => {
        // logger.main.info('[AIService] AskUserQuestion requested:', data.questionId);
        safeSend(event, 'ai:askUserQuestion', data);
        syncPendingPrompt(data.sessionId, true);
        TrayManager.getInstance().onPromptCreated(data.sessionId);

        // Show OS notification if app is backgrounded
        const sessionTitle = session.title || 'AI Session';
        notificationService.showBlockedNotification(
          data.sessionId,
          sessionTitle,
          'question',
          effectiveWorkspacePath
        );
      };
      provider.removeAllListeners('askUserQuestion:pending');
      provider.on('askUserQuestion:pending', onAskUserQuestion);

      // Listen for AskUserQuestion answers and forward to renderer to update tool call display
      const onAskUserQuestionAnswered = (data: { questionId: string; sessionId: string; questions: any[]; answers: Record<string, string>; timestamp: number }) => {
        // logger.main.info('[AIService] AskUserQuestion answered:', data.questionId);
        safeSend(event, 'ai:askUserQuestionAnswered', data);
        syncPendingPrompt(data.sessionId, false);
        TrayManager.getInstance().onPromptResolved(data.sessionId);
      };
      provider.removeAllListeners('askUserQuestion:answered');
      provider.on('askUserQuestion:answered', onAskUserQuestionAnswered);

      // Listen for tool permission requests and forward to renderer
      const onToolPermissionPending = (data: { requestId: string; sessionId: string; workspacePath: string; request: any; timestamp: number }) => {
        logger.main.info('[AIService] Tool permission requested:', data.requestId);
        safeSend(event, 'ai:toolPermission', data);
        syncPendingPrompt(data.sessionId, true);
        TrayManager.getInstance().onPromptCreated(data.sessionId);

        // Show OS notification if app is backgrounded
        const sessionTitle = session.title || 'AI Session';
        notificationService.showBlockedNotification(
          data.sessionId,
          sessionTitle,
          'permission',
          data.workspacePath
        );

        // Play permission request sound
        const soundService = SoundNotificationService.getInstance();
        soundService.playPermissionSound(data.workspacePath);
      };
      provider.removeAllListeners('toolPermission:pending');
      provider.on('toolPermission:pending', onToolPermissionPending);

      // Listen for tool permission resolved and forward to renderer
      const onToolPermissionResolved = (data: { requestId: string; sessionId: string; response: any; timestamp: number }) => {
        logger.main.info('[AIService] Tool permission resolved:', data.requestId);
        safeSend(event, 'ai:toolPermissionResolved', data);
        syncPendingPrompt(data.sessionId, false);
        TrayManager.getInstance().onPromptResolved(data.sessionId);
      };
      provider.removeAllListeners('toolPermission:resolved');
      provider.on('toolPermission:resolved', onToolPermissionResolved);

      // Listen for prompt additions and forward to renderer for debug display
      const onPromptAdditions = (data: {
        sessionId: string;
        systemPromptAddition: string | null;
        userMessageAddition: string | null;
        attachments?: Array<{ type: string; filename: string; mimeType?: string; filepath?: string }>;
        timestamp: number;
      }) => {
        safeSend(event, 'ai:promptAdditions', data);
      };
      provider.removeAllListeners('promptAdditions');
      provider.on('promptAdditions', onPromptAdditions);

      // Listen for expired session events and clear the providerSessionId from database
      // This ensures subsequent messages start fresh even after app restart
      const onProviderSessionExpired = async (data: { sessionId: string }) => {
        logger.main.info(`[AIService] Provider session expired for ${data.sessionId}, clearing providerSessionId from database`);
        try {
          await this.sessionManager.updateProviderSessionData(data.sessionId, undefined);
        } catch (error) {
          logger.main.error('[AIService] Failed to clear expired providerSessionId:', error);
        }
      };
      provider.removeAllListeners('session:providerSessionExpired');
      provider.on('session:providerSessionExpired', onProviderSessionExpired);

      // Listen for provider session ID received and persist immediately
      // This ensures session can be resumed even if interrupted/cancelled
      const onProviderSessionReceived = async (data: { sessionId: string; providerSessionId: string }) => {
        try {
          await this.sessionManager.updateProviderSessionData(data.sessionId, data.providerSessionId);
        } catch (error) {
          logger.main.error('[AIService] Failed to persist providerSessionId:', error);
        }
      };
      provider.removeAllListeners('session:providerSessionReceived');
      provider.on('session:providerSessionReceived', onProviderSessionReceived);

      // Listen for teammate messages when the lead is idle (no active query).
      // When the lead is active, messages are delivered via interrupt + streamInput
      // inside ClaudeCodeProvider.sendMessage(). This handler covers the idle case
      // by triggering a new sendMessage call with the teammate's message.
      const onTeammateMessageWhileIdle = async (data: {
        sessionId: string;
        message: string;
      }) => {
        if (!data.sessionId) {
          logger.main.warn('[AIService] teammate:messageWhileIdle with no sessionId');
          return;
        }
        // Guard: don't trigger sendMessage if session was already ended
        // (e.g., all teammates completed between message queue and this handler)
        const sessionStateManager = getSessionStateManager();
        if (!sessionStateManager.isSessionActive(data.sessionId)) {
          logger.main.info(`[AIService] Ignoring teammate message for ended session ${data.sessionId}`);
          return;
        }
        logger.main.info(`[AIService] Teammate message while lead idle, triggering sendMessage for session ${data.sessionId}`);
        try {
          // Ensure the session is marked as running so the UI shows the stop button.
          // sendMessageHandler also calls startSession, but there can be a gap between
          // the setImmediate and when that runs. Re-calling startSession is safe (idempotent).
          await sessionStateManager.startSession({ sessionId: data.sessionId });

          const targetWindow = findWindowByWorkspace(effectiveWorkspacePath);
          if (targetWindow && !targetWindow.isDestroyed()) {
            // Create a mock event and call sendMessage directly
            const mockEvent = {
              sender: targetWindow.webContents,
              senderFrame: targetWindow.webContents.mainFrame,
            } as Electron.IpcMainInvokeEvent;

            if (this.sendMessageHandler) {
              // Fire-and-forget: sendMessage will stream results to the renderer
              setImmediate(async () => {
                try {
                  await this.sendMessageHandler!(mockEvent, data.message, {} as any, data.sessionId, effectiveWorkspacePath);
                } catch (err) {
                  logger.main.error('[AIService] Failed to process teammate message while idle:', err);
                }
              });
            }
          }
        } catch (error) {
          logger.main.error('[AIService] Failed to handle teammate message while idle:', error);
        }
      };
      provider.removeAllListeners('teammate:messageWhileIdle');
      provider.on('teammate:messageWhileIdle', onTeammateMessageWhileIdle);

      // Listen for all teammates completing. When the lead finished but teammates
      // were still active, endSession was deferred. Now that all teammates are
      // done, end the session and play the completion sound.
      const onTeammatesAllCompleted = async (data: { sessionId: string }) => {
        if (!data.sessionId) return;
        // Only end the session if it's still tracked as active (lead deferred ending)
        if (stateManager.isSessionActive(data.sessionId)) {
          // Don't end the session if the lead is currently processing or about to
          // process a message. The lead's sendMessage completion will handle endSession.
          // This prevents a race where teammates:allCompleted fires while the lead's
          // resumed CLI subprocess is still spawning (can take 10+ seconds).
          const isLeadBusy = typeof (provider as any).isLeadBusy === 'function'
            && (provider as any).isLeadBusy();
          if (isLeadBusy) {
            logger.main.info(`[AIService] All teammates completed for ${data.sessionId}, but lead is busy — deferring endSession to sendMessage completion`);
            return;
          }

          logger.main.info(`[AIService] All teammates completed for session ${data.sessionId}, ending deferred session`);
          await stateManager.endSession(data.sessionId);
          // Stop file watcher - session is fully complete (teammates done)
          await this.stopCodexSessionWatcher(data.sessionId);

          // Play completion sound now that the session is truly done
          const soundService = SoundNotificationService.getInstance();
          soundService.playCompletionSound(workspacePath);
        }
      };
      provider.removeAllListeners('teammates:allCompleted');
      provider.on('teammates:allCompleted', onTeammatesAllCompleted);

      // Track user @ mentions in the message
      try {
        await sessionFileTracker.trackUserMessage(
          session.id,
          effectiveWorkspacePath,
          message,
          session.messages.length // Current message index
        );
        // Notify renderer that files were tracked (if message had @ mentions)
        if (message.includes('@')) {
          safeSend(event, 'session-files:updated', session.id);
        }
      } catch (error) {
        logger.main.warn('[AIService] Failed to track user @ mentions:', error);
      }

      // Track ai_message_sent analytics event
      const slashCommandInfo = detectNimbalystSlashCommand(message, effectiveWorkspacePath);
      const contentMode = (documentContext as any)?.contentMode;
      const fileExtension = getFileExtensionForAnalytics(documentContext?.filePath);
      this.analytics.sendEvent('ai_message_sent', {
        provider: session.provider,
        hasDocumentContext: !!documentContext,
        hasAttachments: !!(attachments && attachments.length > 0),
        attachmentCount: attachments?.length || 0,
        messageLength: bucketMessageLength(message.length),
        contentMode: contentMode || 'unknown',
        // Include session mode (planning/agent) when available
        ...(session.mode && { sessionMode: session.mode }),
        // Include file extension when document context is present
        ...(fileExtension && { fileExtension }),
        // Slash command tracking - only included if a Nimbalyst package command was used
        ...(slashCommandInfo && {
          usedSlashCommand: true,
          slashCommandName: slashCommandInfo.commandName,
          slashCommandPackageId: slashCommandInfo.packageId,
        }),
      });

      // Mark session as running/active
      const stateManager = getSessionStateManager();
      await stateManager.startSession({ sessionId: session.id });

      // Mark session as executing for mobile sync (shows "Running" indicator)
      const syncProvider = getSyncProvider();
      if (syncProvider) {
        syncProvider.pushChange(session.id, {
          type: 'metadata_updated',
          metadata: { isExecuting: true } as any,
        });
      }

      try {
        let fullResponse = '';
        let lastTextSection = '';  // Track text after the last tool call (for notifications)
        const toolCalls: any[] = [];
        const edits: any[] = [];  // Track edits for the assistant message
        let hasStreamingContent = false;  // Track if we used streamContent tool
        let hadError = false;  // Track if an error occurred during the stream
        let firstChunkTime: number | undefined;
        let chunkCount = 0;
        let textChunks = 0;
        let toolCallCount = 0;
        const processedBashCommandItemIds = new Set<string>();
        const bashCommandOccurrences = new Map<string, number>();
        const pendingBashCommands = new Map<string, string>();

        // Get existing messages from session for context
        const sessionMessages = session.messages || [];

        const streamStartTime = Date.now();

        // Send performance metrics to renderer
        safeSend(event, 'ai:performanceMetrics', {
          phase: 'start',
          provider: session.provider,
          model: session.model || 'default',
          messageLength: message.length,
          contextMessages: sessionMessages.length
        });

        // Stream the response
        const isClaudeCode = session.provider === 'claude-code';
        const logPrefix = isClaudeCode ? '[CLAUDE-CODE-SERVICE]' : '[AIService]';

        if (isClaudeCode) {
          //   messageLength: message.length,
          //   hasContext: !!documentContext,
          //   sessionId: session.id,
          //   sessionMessages: sessionMessages.length,
          //   workspacePath
          // }, null, 2));

          // Session naming is now handled automatically via MCP URL parameters
          // No need to configure per-session context
        }

        // Attach @ mentioned files for non-agent providers
        const { enhancedMessage, attachedFiles } = await attachMentionedFiles(message, workspacePath, provider);
        const messageToSend = enhancedMessage;

        if (attachedFiles.length > 0) {
          logger.main.info(`[AIService] Attached ${attachedFiles.length} files via @ mentions`, {
            files: attachedFiles.map(f => ({ path: f.path, size: f.size }))
          });
        }

        // Prepare document context using the service (handles transition detection, diff computation, etc.)
        const rawContext: RawDocumentContext | undefined = documentContext ? {
          filePath: documentContext.filePath,
          fileType: documentContext.fileType,
          content: documentContext.content || '',
          cursorPosition: documentContext.cursorPosition,
          selection: documentContext.selection,
          textSelection: documentContext.textSelection,
          textSelectionTimestamp: documentContext.textSelectionTimestamp,
          mockupSelection: (documentContext as any).mockupSelection,
          mockupDrawing: (documentContext as any).mockupDrawing,
        } : undefined;

        const { documentContext: preparedContext, userMessageAdditions } = this.documentContextService.prepareContext(
          rawContext,
          session.id,
          session.provider as AIProviderType,
          undefined // No mode transition for now - will be added when integrating with SessionTranscript
        );

        // Merge prepared document context with session metadata
        const effectiveMode = documentContext?.mode ?? session.mode;

        const contextWithSession: DocumentContext = {
          // Document fields from prepared context
          filePath: preparedContext.filePath,
          fileType: preparedContext.fileType,
          content: preparedContext.content,  // Omitted when transition is 'none' (content unchanged)
          documentDiff: preparedContext.documentDiff,
          documentTransition: preparedContext.documentTransition,
          previousFilePath: preparedContext.previousFilePath,

          // Selection fields
          textSelection: preparedContext.textSelection,

          // Legacy fields (keep for backward compatibility)
          selection: documentContext?.selection,
          textSelectionTimestamp: documentContext?.textSelectionTimestamp,
          cursorPosition: documentContext?.cursorPosition,

          // Session metadata
          sessionType: documentContext?.sessionType ?? session.sessionType,
          mode: effectiveMode,
          permissionsPath,  // For worktree sessions, this is the parent project path
          attachments,

          // Worktree context
          worktreeId: session.worktreeId,
          worktreePath: session.worktreePath,
          worktreeProjectPath: session.worktreeProjectPath,

          // Branch tracking for session forking
          branchedFromSessionId: session.branchedFromSessionId,
          branchedFromProviderSessionId: session.branchedFromProviderSessionId,

          // Pre-built prompts from DocumentContextService (for user message additions)
          documentContextPrompt: userMessageAdditions.documentContextPrompt,
          editingInstructions: userMessageAdditions.editingInstructions,
        };

        // Update MCP document state for Claude Code provider so it knows which tools to show
        // Always update with workspacePath, even if no file is open, so global-scoped tools are available
        if (isClaudeCode && effectiveWorkspacePath) {
          const { updateDocumentState, registerWorkspaceWindow } = await import('../../mcp/httpServer');
          updateDocumentState({
            filePath: contextWithSession?.filePath,
            workspacePath: effectiveWorkspacePath,
            fileType: contextWithSession?.fileType
          }, session.id);

          // Also register the workspace->window mapping so MCP tools can route to the correct window
          const { BrowserWindow } = await import('electron');
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            registerWorkspaceWindow(effectiveWorkspacePath, window.id);
          }
        }

        // Start file snapshot cache + watcher for agentic sessions (diff support)
        // Only start once per session; persists across turns
        if ((session.provider === 'openai-codex' || session.provider === 'claude-code')
          && effectiveWorkspacePath
        ) {
          try {
            await this.ensureCodexSessionWatcher(session.id, effectiveWorkspacePath, event);
          } catch (watcherError) {
            logger.main.error('[AIService] Failed to start Codex file cache:', watcherError);
          }
        }

        for await (const chunk of provider.sendMessage(messageToSend, contextWithSession, session.id, sessionMessages, effectiveWorkspacePath, attachments)) {
          if (!chunk) continue;
          chunkCount++;

          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            perfLog.timeToFirstChunk = firstChunkTime - startTime;

            // Send first chunk metrics
            safeSend(event, 'ai:performanceMetrics', {
              phase: 'firstChunk',
              timeToFirstChunk: perfLog.timeToFirstChunk
            });
          }
          switch (chunk.type) {
            case 'text':
              textChunks++;
              const chunkContent = chunk.content || '';
              fullResponse += chunkContent;
              lastTextSection += chunkContent;  // Accumulate for notification (reset on tool calls)

              // Update activity to indicate streaming
              if (textChunks === 1) {
                await stateManager.updateActivity({
                  sessionId: session.id,
                  isStreaming: true
                });
              }
              // if (isClaudeCode && textChunks <= 5) {
              // }
              // Send ACCUMULATED response to renderer (not just the chunk)
              safeSend(event, 'ai:streamResponse', {
                sessionId: session.id,
                partial: fullResponse,  // Send the full accumulated text
                isComplete: false
              });
              break;

            case 'tool_call':
              if (chunk.toolCall) {
                toolCallCount++;
                toolCalls.push(chunk.toolCall);
                lastTextSection = '';  // Reset so notification shows text after last tool call
                console.groupEnd();

                // Track file interactions for all tool calls
                // Also attach file watchers for edited files to detect subsequent changes
                // Note: Codex command_execution events have arguments=undefined (command is in name),
                // so we cannot guard on chunk.toolCall.arguments being truthy.
                if (effectiveWorkspacePath) {
                  try {
                    // Get window from event sender to enable file watcher attachment
                    const window = BrowserWindow.fromWebContents(event.sender);

                    // Normalize Codex command_execution tool names to 'Bash' so the
                    // tracker's existing shell-command file extraction logic applies.
                    // Codex emits these with the raw command as the tool name (e.g. "/bin/zsh -lc ls").
                    // Unwrap the shell wrapper to get the inner command for file path extraction.
                    let trackToolName = chunk.toolCall.name;
                    let trackArgs = chunk.toolCall.arguments;
                    if (/^\/(?:bin|usr\/bin)\//.test(trackToolName) || /\/(?:bash|zsh|sh)\b/.test(trackToolName) || /(?:powershell|pwsh|cmd)(?:\.exe)?\b/i.test(trackToolName)) {
                      trackArgs = { command: unwrapShellCommand(trackToolName) };
                      trackToolName = 'Bash';
                    }

                    if (trackToolName === 'Bash' && typeof trackArgs?.command === 'string') {
                      const inferredWorktreePath = this.inferWorktreePathFromCommand(trackArgs.command, workspacePath);
                      if (inferredWorktreePath) {
                        await this.adoptWorktreeForSession(session, inferredWorktreePath, event);
                        effectiveWorkspacePath = session.worktreePath || effectiveWorkspacePath;
                        permissionsPath = session.worktreeProjectPath || permissionsPath;
                      }
                    }

                    // Codex reuses item IDs across turns, so we normally avoid storing
                    // provider IDs as toolUseId. Exception: file_change events need
                    // stable per-item IDs so `session-files:get-tool-call-diffs` can
                    // resolve the exact file_change call that produced a diff.
                    const providerToolUseId = typeof (chunk.toolCall as any)?.toolUseId === 'string'
                      ? (chunk.toolCall as any).toolUseId
                      : (typeof chunk.toolCall.id === 'string' ? chunk.toolCall.id : undefined);
                    const toolUseId = session.provider === 'openai-codex'
                      ? (trackToolName === 'file_change' ? providerToolUseId : undefined)
                      : providerToolUseId;

                    await sessionFileTracker.trackToolExecution(
                      session.id,
                      effectiveWorkspacePath,
                      trackToolName,
                      trackArgs,
                      chunk.toolCall.result,
                      toolUseId,
                      window  // Pass window to enable file watcher attachment for edited files
                    );

                    // Fallback for Bash edits in ignored/unwatched paths.
                    // Codex emits both item.started and item.completed for command_execution;
                    // run fallback on the second occurrence (usually completed) so we diff
                    // against post-command file content.
                    if (trackToolName === 'Bash' && typeof trackArgs?.command === 'string') {
                      const commandItemId = typeof chunk.toolCall.id === 'string'
                        ? chunk.toolCall.id
                        : `${trackArgs.command.slice(0, 200)}:${toolCallCount}`;
                      const seenCount = (bashCommandOccurrences.get(commandItemId) ?? 0) + 1;
                      bashCommandOccurrences.set(commandItemId, seenCount);
                      pendingBashCommands.set(commandItemId, trackArgs.command);

                      if (seenCount >= 2 && !processedBashCommandItemIds.has(commandItemId)) {
                        const tracked = await this.trackBashFileEditsFromCommand(
                          session,
                          workspacePath,
                          trackArgs.command,
                          commandItemId
                        );
                        if (tracked) {
                          processedBashCommandItemIds.add(commandItemId);
                        }
                      }
                    }

                    // Notify renderer that files were tracked
                    safeSend(event, 'session-files:updated', session.id);

                    // Schedule debounced tool call matching so file edits are linked
                    // to tool calls promptly during the session, not just at the end.
                    const existingTimer = this.matchDebounceTimers.get(session.id);
                    if (existingTimer) clearTimeout(existingTimer);
                    this.matchDebounceTimers.set(session.id, setTimeout(() => {
                      this.matchDebounceTimers.delete(session.id);
                      toolCallMatcher.matchSession(session.id).then(count => {
                        if (count > 0) {
                          safeSend(event, 'session-files:updated', session.id);
                        }
                      }).catch(() => {
                        // Non-critical - end-of-session matching will retry
                      });
                    }, 1000));
                  } catch (trackError) {
                    console.error('[AIService] Failed to track tool call:', trackError);
                  }
                }

                const toolName = chunk.toolCall.name;
                const toolArgs = chunk.toolCall.arguments as Record<string, unknown> | undefined;
                const replacementCount = Array.isArray((toolArgs as any)?.replacements)
                  ? (toolArgs as any).replacements.length
                  : undefined;
                // logger.ai.info('[AIService] Tool call received', {
                //   name: toolName,
                //   replacements: replacementCount,
                //   argKeys: toolArgs ? Object.keys(toolArgs) : []
                // });

                if (toolName === 'applyDiff' && (replacementCount === undefined || replacementCount === 0)) {
                  const rawArgs = toolArgs ? JSON.stringify(toolArgs) : 'null';
                  logger.ai.warn('[AIService] applyDiff payload missing replacements', previewForLog(rawArgs));
                }

                // Snapshot file contents for file_change events before saving
                if (toolName === 'file_change' && toolArgs?.changes) {
                  const rawChanges = toolArgs.changes as Array<{ path: string; kind?: string }>;

                  for (const change of rawChanges) {
                    if (!change?.path) continue;
                    const candidatePath = path.isAbsolute(change.path)
                      ? path.normalize(change.path)
                      : path.resolve(effectiveWorkspacePath, change.path);
                    const inferredWorktreePath = this.inferWorktreePathFromFilePath(workspacePath, candidatePath);
                    if (inferredWorktreePath) {
                      await this.adoptWorktreeForSession(session, inferredWorktreePath, event);
                      effectiveWorkspacePath = session.worktreePath || effectiveWorkspacePath;
                      permissionsPath = session.worktreeProjectPath || permissionsPath;
                      break;
                    }
                  }

                  const changes = rawChanges
                    .filter((change): change is { path: string; kind?: string } => !!change?.path)
                    .map((change) => ({
                      ...change,
                      path: path.isAbsolute(change.path)
                        ? path.normalize(change.path)
                        : path.resolve(effectiveWorkspacePath, change.path),
                    }));

                  // Register gitignore bypass for all changed files immediately.
                  // Codex writes files before emitting file_change events, so the
                  // fs.watch event may have already fired and been buffered. The bypass
                  // triggers replay of any buffered events.
                  for (const change of changes) {
                    if (change?.path && effectiveWorkspacePath) {
                      addGitignoreBypass(effectiveWorkspacePath, change.path);
                    }
                  }

                  const fileSnapshots: Record<string, { content: string | null; error?: string; isBinary?: boolean; truncated?: boolean }> = {};
                  const MAX_SNAPSHOT_SIZE = 100_000; // 100KB per file

                  // Proactive pre-edit snapshot: capture the before-state from the
                  // FileSnapshotCache BEFORE reading current (post-edit) content.
                  // The file has already been modified by Codex, so disk reads give
                  // after-state. The cache holds the content as of session start.
                  const watcherEntry = this.codexSessionWatchers.get(session.id);
                  if (watcherEntry) {
                    for (const change of changes) {
                      if (!change?.path || change.kind === 'delete') continue;
                      try {
                        const currentContentForCheck = await readFileContentOrNull(change.path);
                        let beforeContent = await watcherEntry.cache.getBeforeState(change.path);
                        if (beforeContent === null) {
                          // Ensure apply_patch edits still create pending-review tags when
                          // the snapshot cache has no baseline (new/ignored files).
                          // Skip binary files to avoid invalid diff baselines.
                          if (isBinaryFile(change.path)) {
                            continue;
                          }
                          if (!isCreateLikeChangeKind(change.kind)) {
                            const recoveredBaseline = await recoverBaselineFromHistory(change.path, currentContentForCheck);
                            if (recoveredBaseline !== null) {
                              beforeContent = recoveredBaseline;
                            } else {
                              // Last-resort fallback: keep diff mode functional even when we
                              // cannot reconstruct precise pre-edit content (e.g. ignored files
                              // with no prior snapshots).
                              logger.ai.warn('[AIService] Missing baseline for non-create change; using empty fallback baseline', {
                                filePath: change.path,
                                kind: change.kind,
                                sessionId: session.id,
                              });
                              beforeContent = '';
                            }
                          } else {
                            beforeContent = '';
                          }
                        }

                        // Guard against stale cache baselines that already match post-edit
                        // disk content. In that case, watcher attribution will provide a
                        // better before-state; creating a tag here would produce no visible diff.
                        if (currentContentForCheck !== null && beforeContent === currentContentForCheck) {
                          continue;
                        }

                        const toolUseId =
                          typeof chunk.toolCall.id === 'string'
                            ? chunk.toolCall.id
                            : `codex-file-change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        const tagId = `ai-edit-pending-${session.id}-${toolUseId}`;
                        await historyManager.createTag(
                          change.path,
                          tagId,
                          beforeContent,
                          session.id,
                          toolUseId
                        );
                        // Track the file edit so getDiffsFromToolCallContent can find it
                        await sessionFileTracker.trackToolExecution(
                          session.id,
                          effectiveWorkspacePath,
                          'file_change',
                          { changes: [change] },
                          undefined,
                          toolUseId,
                          null  // Watcher already running for this session
                        );
                      } catch (preEditError) {
                        const errorStr = String(preEditError);
                        if (!errorStr.includes('unique') && !errorStr.includes('UNIQUE') && !errorStr.includes('duplicate')) {
                          logger.ai.error('[AIService] Failed to create pre-edit snapshot for file_change:', preEditError);
                        }
                      }
                    }
                  }

                  for (const change of changes) {
                    if (!change?.path) continue;
                    if (change.kind === 'delete') {
                      fileSnapshots[change.path] = { content: null };
                      continue;
                    }
                    try {
                      const buffer = fs.readFileSync(change.path);
                      // Binary detection: check for null bytes in first 8KB
                      const sampleSize = Math.min(buffer.length, 8192);
                      let isBinary = false;
                      for (let i = 0; i < sampleSize; i++) {
                        if (buffer[i] === 0) { isBinary = true; break; }
                      }
                      if (isBinary) {
                        fileSnapshots[change.path] = { content: null, isBinary: true };
                      } else if (buffer.length > MAX_SNAPSHOT_SIZE) {
                        fileSnapshots[change.path] = { content: buffer.toString('utf-8', 0, MAX_SNAPSHOT_SIZE), truncated: true };
                      } else {
                        fileSnapshots[change.path] = { content: buffer.toString('utf-8') };
                      }
                    } catch (err) {
                      fileSnapshots[change.path] = { content: null, error: err instanceof Error ? err.message : String(err) };
                    }
                  }

                  // Attach snapshots to the tool call result
                  if (typeof chunk.toolCall.result === 'object' && chunk.toolCall.result !== null) {
                    (chunk.toolCall.result as any).fileSnapshots = fileSnapshots;
                  } else {
                    chunk.toolCall.result = { success: true, fileSnapshots };
                  }
                }

                // Save tool call as a separate message in the session
                const toolResult = chunk.toolCall.result as any;
                const isFailedResult = toolResult?.success === false;

                if (!isFailedResult) {
                  const toolMessage: Message = {
                    role: 'tool',
                    content: '',  // Tool messages don't have text content
                    timestamp: Date.now(),
                    toolCall: {
                      ...chunk.toolCall,
                      arguments: chunk.toolCall.arguments as Record<string, unknown> | undefined,
                      result: chunk.toolCall.result as string | ToolResult | undefined
                    },
                    ...(toolResult !== undefined ? { errorMessage: toolResult?.error, isError: toolResult?.success === false } : {})
                  };
                  await this.sessionManager.addMessage(toolMessage, session.id);
                }

                // Send tool call to renderer
                // For applyDiff (including MCP variants), include it as BOTH an edit AND a toolCall
                if (toolName === 'applyDiff' || toolName?.endsWith('__applyDiff')) {
                  // Create pre-edit tag BEFORE applying diff (for non-agentic providers)
                  // This enables diff visualization and persistence across app restarts
                  if (documentContext?.filePath && session.provider !== 'claude-code') {
                    const toolUseId = chunk.toolCall.id || `diff-${Date.now()}`;
                    await tagFileBeforeEdit(documentContext.filePath, session.id, toolUseId);
                  }

                  const edit = {
                    type: 'diff',
                    replacements: (chunk.toolCall.arguments as any)?.replacements,
                    // MCP edits are applied automatically by the MCP server
                    applied: toolName?.endsWith('__applyDiff')
                  };
                  edits.push(edit);  // Save edit for the assistant message

                  if (!Array.isArray(edit.replacements) || edit.replacements.length === 0) {
                    logger.ai.warn('[AIService] Forwarding applyDiff edit without replacements');
                  } else {
                    logger.ai.info('[AIService] Forwarding applyDiff edit', {
                      count: edit.replacements.length
                    });
                  }

                  safeSend(event, 'ai:streamResponse', {
                    sessionId: session.id,
                    partial: '',
                    isComplete: false,
                    edits: [edit],
                    toolCalls: [chunk.toolCall]  // Also send as toolCall so it displays in chat
                  });
                } else if (chunk.toolCall.name === 'streamContent') {
                  // Mark that we used streamContent AND track the tool call
                  hasStreamingContent = true;
                  toolCallCount++;
                  toolCalls.push(chunk.toolCall);
                  // Send to renderer so it displays in chat transcript
                  safeSend(event, 'ai:streamResponse', {
                    sessionId: session.id,
                    partial: '',
                    isComplete: false,
                    toolCalls: [chunk.toolCall]
                  });
                } else {
                  // For other tools, just send the tool call
                  safeSend(event, 'ai:streamResponse', {
                    sessionId: session.id,
                    partial: '',
                    isComplete: false,
                    toolCalls: [chunk.toolCall]
                  });
                }
              }
              break;

            case 'tool_error':
              if (chunk.toolError) {
                logger.ai.warn('[AIService] Tool error reported', {
                  name: chunk.toolError.name,
                  error: chunk.toolError.error
                });

                const errorMessage: Message = {
                  role: 'tool',
                  content: '',
                  timestamp: Date.now(),
                  toolCall: {
                    name: chunk.toolError.name,
                    arguments: chunk.toolError.arguments as Record<string, unknown> | undefined,
                    result: chunk.toolError.result as string | ToolResult | undefined
                  },
                  isError: true,
                  errorMessage: chunk.toolError.error
                };
                await this.sessionManager.addMessage(errorMessage, session.id);

                safeSend(event, 'ai:streamResponse', {
                  sessionId: session.id,
                  partial: '',
                  isComplete: false,
                  toolError: chunk.toolError
                });
              }
              break;

            case 'stream_edit_start':
              // Create pre-edit tag BEFORE streaming content (for non-agentic providers)
              // This enables diff visualization and persistence across app restarts
              if (documentContext?.filePath && session.provider !== 'claude-code') {
                // Generate a tool use ID based on session and timestamp
                const streamToolUseId = `stream-${Date.now()}`;
                await tagFileBeforeEdit(documentContext.filePath, session.id, streamToolUseId);
              }

              // Forward streaming edit start event to renderer
              // Include targetFilePath so renderer knows which file to edit
              safeSend(event, 'ai:streamEditStart', {
                sessionId: session.id,
                targetFilePath: documentContext?.filePath,
                ...(chunk.config as Record<string, unknown> || {})
              });
              hasStreamingContent = true;  // Mark that we're doing streaming
              break;

            case 'stream_edit_content':
              // Forward streaming content to renderer
              safeSend(event, 'ai:streamEditContent', {
                sessionId: session.id,
                content: chunk.content
              });
              break;

            case 'stream_edit_end':
              // Forward streaming end event to renderer
              safeSend(event, 'ai:streamEditEnd', {
                sessionId: session.id,
                ...(chunk.error ? { error: chunk.error } : {})
              });

              // Track the streamContent file interaction
              // Also attach file watcher for the edited file
              if (documentContext?.filePath && effectiveWorkspacePath) {
                try {
                  // Get window from event sender to enable file watcher attachment
                  const window = BrowserWindow.fromWebContents(event.sender);
                  await sessionFileTracker.trackToolExecution(
                    session.id,
                    effectiveWorkspacePath,
                    'streamContent',
                    { file_path: documentContext.filePath },
                    { success: !chunk.error },
                    undefined,
                    window  // Pass window to enable file watcher attachment for edited files
                  );
                  // Notify renderer that files were tracked
                  safeSend(event, 'session-files:updated', session.id);
                } catch (trackError) {
                  console.error('[AIService] Failed to track streamContent:', trackError);
                }
              }
              break;

            case 'error':
              hadError = true;  // Mark that an error occurred to skip auto /context
              if (isClaudeCode) {
                console.error('[CLAUDE-CODE-SERVICE] ERROR FROM PROVIDER:', chunk.error || 'Unknown error');
                console.error('[CLAUDE-CODE-SERVICE] Error context:', {
                  chunksSoFar: chunkCount,
                  textChunksSoFar: textChunks,
                  responseLengthSoFar: fullResponse.length,
                  timeElapsed: Date.now() - startTime,
                  isAuthError: chunk.isAuthError || false
                });
              }
              console.error(`${logPrefix} Provider error:`, chunk.error || 'Unknown error');

              // Track stream interruption due to error
              this.analytics.sendEvent('ai_stream_interrupted', {
                provider: session.provider,
                chunksReceived: chunkCount,
                reason: 'error'
              });

              // Detect Bedrock tool search error even if runtime didn't flag it
              const errorMsg = chunk.error || 'Unknown error occurred';
              const isBedrockToolError = chunk.isBedrockToolError || isBedrockToolSearchError(errorMsg);
              const isServerError = chunk.isServerError || false;

              safeSend(event, 'ai:error', {
                sessionId: session.id,
                message: errorMsg,
                isAuthError: chunk.isAuthError || false,
                isBedrockToolError,
                isServerError
              });
              break;

            case 'complete':
              // if (isClaudeCode) {
              // }
              perfLog.totalTime = Date.now() - startTime;
              perfLog.streamTime = Date.now() - streamStartTime;
              perfLog.chunkCount = chunkCount;
              perfLog.textChunks = textChunks;
              perfLog.toolCallCount = toolCallCount;
              perfLog.responseLength = fullResponse.length;

              // Capture token usage if available
              const tokenUsage = chunk.usage;
              // Capture modelUsage for claude-code provider (provides per-model breakdown with input/output tokens)
              const modelUsage = chunk.modelUsage;
              // Context fill from last assistant message (actual tokens in context window)
              const contextFillTokens: number | undefined = chunk.contextFillTokens;
              // Whether context was compacted this turn (clear stale currentContext)
              const contextCompacted: boolean = chunk.contextCompacted === true;

              // if (tokenUsage) {
              // }
              // if (modelUsage) {
              // }
              if (fullResponse) {
                logger.ai.info('[AIService] Assistant final response', {
                  length: fullResponse.length,
                  preview: previewForLog(fullResponse)
                });
              } else {
                logger.ai.info('[AIService] Assistant response empty', {
                  edits: edits.length,
                  streamed: hasStreamingContent,
                  toolCalls: toolCallCount
                });
              }
              if (edits.length > 0) {
                logger.ai.info('[AIService] Collected edits', {
                  editCount: edits.length,
                  replacementCounts: edits.map(edit => Array.isArray(edit.replacements) ? edit.replacements.length : 0)
                });
              }

              // Send completion metrics with token usage if available
              safeSend(event, 'ai:performanceMetrics', {
                phase: 'complete',
                totalTime: perfLog.totalTime,
                streamTime: perfLog.streamTime,
                chunkCount: chunkCount,
                textChunks: textChunks,
                toolCallCount: toolCallCount,
                responseLength: fullResponse.length,
                ...(tokenUsage && { tokenUsage })
              });

              // Track ai_response_received analytics event
              const hasError = false; // If we got here, no error occurred
              const responseType = toolCallCount > 0 ? 'tool_use' : 'text';
              const toolsUsed = toolCalls.map(tc => tc.name).filter((name, index, self) => self.indexOf(name) === index);
              const usedChartTool = toolsUsed.some(name => name === 'display_chart' || name === 'mcp__nimbalyst__display_chart');

              this.analytics.sendEvent('ai_response_received', {
                provider: session.provider,
                responseType,
                toolsUsed,
                usedChartTool,
                responseTime: bucketResponseTime(perfLog.totalTime)
              });

              // Track ai_response_streamed analytics event (for streaming characteristics)
              this.analytics.sendEvent('ai_response_streamed', {
                provider: session.provider,
                chunkCount: bucketChunkCount(chunkCount),
                totalLength: bucketContentLength(fullResponse.length)
              });

              // Update session token usage if available
              // For claude-code: use modelUsage for cumulative tokens and contextWindow
              // For other providers: use tokenUsage from chunk.usage
              if (session.provider === 'claude-code' && modelUsage) {
                // For claude-code, accumulate tokens from modelUsage (SDK provides per-model breakdown)
                const currentUsage = session.tokenUsage ?? {
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0
                };

                // Sum up tokens from all models in modelUsage and extract contextWindow
                // Note: modelUsage tokens are CUMULATIVE across all steps (for billing).
                // For context window display, use contextFillTokens from last assistant message.
                let newInputTokens = 0;
                let newOutputTokens = 0;
                let newCostUSD = 0;
                let contextWindowFromResult: number | undefined;
                for (const modelName of Object.keys(modelUsage)) {
                  const modelStats = modelUsage[modelName];
                  newInputTokens += modelStats.inputTokens || 0;
                  newOutputTokens += modelStats.outputTokens || 0;
                  newCostUSD += modelStats.costUSD || 0;
                  // The SDK provides contextWindow per-model in modelUsage
                  if (modelStats.contextWindow) {
                    contextWindowFromResult = modelStats.contextWindow;
                  }
                }

                const updatedUsage: NonNullable<SessionData['tokenUsage']> = {
                  inputTokens: currentUsage.inputTokens + newInputTokens,
                  outputTokens: currentUsage.outputTokens + newOutputTokens,
                  totalTokens: currentUsage.totalTokens + newInputTokens + newOutputTokens,
                  costUSD: (currentUsage.costUSD || 0) + newCostUSD,
                  // Use contextWindow from modelUsage (replaces broken /context command)
                  contextWindow: contextWindowFromResult || currentUsage.contextWindow,
                  // contextFillTokens = input + cacheRead + cacheCreation from last assistant message
                  // This is the actual context fill, not cumulative - updates correctly after compaction
                  // After compaction, clear stale currentContext (next real turn will set accurate value)
                  currentContext: contextCompacted
                    ? undefined
                    : (contextFillTokens !== undefined && contextWindowFromResult)
                      ? { tokens: contextFillTokens, contextWindow: contextWindowFromResult }
                      : currentUsage.currentContext,
                };

                await this.sessionManager.updateSessionTokenUsage(session.id, updatedUsage);

                // Send IPC event to update UI immediately
                safeSend(event, 'ai:tokenUsageUpdated', {
                  sessionId: session.id,
                  tokenUsage: updatedUsage
                });

                // Push context usage to mobile sync
                if (contextFillTokens !== undefined && contextWindowFromResult) {
                  const syncProvider = getSyncProvider();
                  if (syncProvider) {
                    syncProvider.pushChange(session.id, {
                      type: 'metadata_updated',
                      metadata: {
                        currentContext: {
                          tokens: contextFillTokens,
                          contextWindow: contextWindowFromResult,
                        },
                        updatedAt: Date.now(),
                      } as any,
                    });
                  }
                }

                // Update local session reference for next iteration
                session.tokenUsage = updatedUsage;
              } else if (tokenUsage && session.provider !== 'claude-code') {
                // For non-claude-code providers, use tokenUsage from chunk
                const currentUsage = session.tokenUsage ?? {
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0
                };

                // Calculate new tokens for this message
                const newInputTokens = (tokenUsage.input_tokens || 0);
                const newOutputTokens = tokenUsage.output_tokens || 0;
                const newTotalTokens = newInputTokens + newOutputTokens;

                const updatedUsage = {
                  inputTokens: currentUsage.inputTokens + newInputTokens,
                  outputTokens: currentUsage.outputTokens + newOutputTokens,
                  totalTokens: currentUsage.totalTokens + newTotalTokens,
                  contextWindow: currentUsage.contextWindow
                };

                await this.sessionManager.updateSessionTokenUsage(session.id, updatedUsage);

                // Update local session reference for next iteration
                session.tokenUsage = updatedUsage;
              }

              // Only add assistant message if there's actual content or edits
              if (fullResponse && fullResponse.trim() !== '') {
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: fullResponse,
                  timestamp: Date.now(),
                  ...(edits.length > 0 && { edits }),  // Include edits if any
                  // CRITICAL: Don't include tokenUsage from chunk.usage for claude-code provider
                  // Token usage for claude-code comes ONLY from /context command below
                  ...(tokenUsage && session.provider !== 'claude-code' && { tokenUsage })
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (edits.length > 0) {
                // If there were edits but no text response
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '',  // Empty content since the action was just edits
                  timestamp: Date.now(),
                  edits,
                  // CRITICAL: Don't include tokenUsage from chunk.usage for claude-code provider
                  // Token usage for claude-code comes ONLY from /context command below
                  ...(tokenUsage && session.provider !== 'claude-code' && { tokenUsage })
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (hasStreamingContent) {
                // If we used streamContent, add a message to track it
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '',  // Content was streamed directly to editor
                  timestamp: Date.now(),
                  isStreamingStatus: true,
                  streamingData: {
                    position: 'document',
                    mode: 'after',
                    content: '[Content streamed to editor]',
                    isActive: false
                  },
                  // CRITICAL: Don't include tokenUsage from chunk.usage for claude-code provider
                  // Token usage for claude-code comes ONLY from /context command below
                  ...(tokenUsage && session.provider !== 'claude-code' && { tokenUsage })
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              } else if (toolCalls.length > 0) {
                // If there were only other tool calls and no text
                const assistantMessage: Message = {
                  role: 'assistant',
                  content: '[Tool calls executed]',
                  timestamp: Date.now(),
                  // CRITICAL: Don't include tokenUsage from chunk.usage for claude-code provider
                  // Token usage for claude-code comes ONLY from /context command below
                  ...(tokenUsage && session.provider !== 'claude-code' && { tokenUsage })
                };
                await this.sessionManager.addMessage(assistantMessage, session.id);
              }

              // Update provider session data if available (redundant safety net)
              // NOTE: providerSessionId is now saved immediately when received via session:providerSessionReceived event
              // This completion-time save is kept as a fallback in case the early save was missed
              if (provider.getProviderSessionData) {
                const providerData = provider.getProviderSessionData(session.id);
                const providerSessionId =
                  providerData?.providerSessionId ||
                  providerData?.claudeSessionId ||
                  providerData?.codexThreadId;
                if (providerSessionId) {
                  await this.sessionManager.updateProviderSessionData(session.id, providerSessionId);
                }
              }

              // Track Claude Code session initialization if this is the first message
              if (session.provider === 'claude-code' && session.messages.length === 0) {
                const initData = (provider as any).getInitData?.();
                if (initData) {
                  const configuredProvider = detectConfiguredAIProvider();
                  this.analytics.sendEvent('claude_code_session_started', {
                    mcpServerCount: initData.mcpServerCount,
                    slashCommandCount: initData.slashCommandCount,
                    agentCount: initData.agentCount,
                    skillCount: initData.skillCount,
                    pluginCount: initData.pluginCount,
                    toolCount: initData.toolCount,
                    helperMethod: initData.helperMethod,
                    ...(configuredProvider && { configuredProvider })
                  });
                }
              }

              // Track Codex session initialization if this is the first message
              if (session.provider === 'openai-codex' && session.messages.length === 0) {
                const initData = (provider as any).getInitData?.();
                if (initData) {
                  this.analytics.sendEvent('codex_session_started', {
                    model: initData.model,
                    mcpServerCount: initData.mcpServerCount,
                    isResumedThread: initData.isResumedThread,
                    ...(initData.permissionMode && { permissionMode: initData.permissionMode })
                  });
                }
              }

              // Send complete response
              safeSend(event, 'ai:streamResponse', {
                sessionId: session.id,
                content: fullResponse,
                lastTextSection: lastTextSection.trim(),
                isComplete: true,
                autoContextPending: session.provider === 'claude-code'
              });

              // Mark session as complete so UI shows agent is ready.
              // Skip if teammates are still active OR if the lead will resume
              // after this query completes (e.g., pending teammate messages).
              // NOTE: Use willResumeAfterCompletion() here, NOT isLeadBusy().
              // isLeadBusy() checks leadQuery which is still set at this point
              // (we're inside the generator's for-await, before the finally block
              // clears it). willResumeAfterCompletion() only checks the pending
              // re-trigger flag.
              const hasTeammates = session.provider === 'claude-code'
                && typeof (provider as any).hasActiveTeammates === 'function'
                && (provider as any).hasActiveTeammates();
              const willResume = session.provider === 'claude-code'
                && typeof (provider as any).willResumeAfterCompletion === 'function'
                && (provider as any).willResumeAfterCompletion();
              if (hasTeammates || willResume) {
                logger.main.info(`[AIService] Deferring endSession for ${session.id} - ${hasTeammates ? 'teammates still active' : 'lead resuming'}`);
              } else {
                await stateManager.endSession(session.id);
                // Stop file watcher after a brief delay to let pending
                // watcher events drain through WorkspaceFileEditAttributionService.
                // Store the timer handle so ensureCodexSessionWatcher can cancel it
                // if a new turn starts before the timer fires.
                const sessionIdForCleanup = session.id;
                const stopTimer = setTimeout(() => {
                  this.codexStopTimers.delete(sessionIdForCleanup);
                  this.stopCodexSessionWatcher(sessionIdForCleanup);
                }, 500);
                this.codexStopTimers.set(sessionIdForCleanup, stopTimer);

                // Play completion sound if enabled
                const soundService = SoundNotificationService.getInstance();
                soundService.playCompletionSound(workspacePath);

                // Show OS notification if enabled and window not focused
                // Use lastTextSection (text after last tool call) for more relevant notification content
                const notificationText = lastTextSection.trim() || fullResponse;
                const notificationBody = notificationText.length > 0
                  ? notificationText.substring(0, 100) + (notificationText.length > 100 ? '...' : '')
                  : 'Response complete';

                await notificationService.showNotification({
                  title: 'Nimbalyst AI Response Ready',
                  body: `${session.provider}: ${notificationBody}`,
                  sessionId: session.id,
                  workspacePath: workspacePath,
                  provider: session.provider
                });

                // Request mobile push notification for agent completion
                if (syncProvider) {
                  // logger.main.info('[AIService] Requesting mobile push for session:', session.id, 'hasMethod:', !!syncProvider.requestMobilePush);
                  syncProvider.requestMobilePush?.(
                    session.id,
                    session.title || 'AI Session',
                    notificationBody
                  );
                } else {
                  logger.main.info('[AIService] No syncProvider for mobile push');
                }

                // Show community popup after 3 completed sessions that used tools.
                if (!hadError && toolCallCount > 0) {
                  const count = incrementCompletedSessionsWithTools();
                  if (count === 3 && shouldShowCommunityPopup() && !wasCommunityPopupShownThisLaunch()) {
                    const senderWindow = BrowserWindow.fromWebContents(event.sender);
                    if (senderWindow && !senderWindow.isDestroyed()) {
                      setTimeout(() => {
                        if (senderWindow.isDestroyed() || wasCommunityPopupShownThisLaunch()) {
                          return;
                        }
                        senderWindow.webContents.send('show-discord-invitation');
                        markCommunityPopupShown();
                      }, 2000);
                    }
                  }
                }

                // AUTO-FETCH CONTEXT USAGE: Previously used /context command to get token usage.
                // Now context window data comes from modelUsage in the result chunk (set above),
                // so /context is no longer needed. The SDK's /context command no longer returns
                // parseable output as of agent-sdk 0.2.x.
                // Kept as commented code for reference in case /context is restored in a future SDK version.
                // if (session.provider === 'claude-code' && !hadError) {
                //   autoContextPromise = this.runAutoContextCommand(session, effectiveWorkspacePath, event);
                // }
              }

              // Match file edits to tool calls now that all messages are flushed.
              // Cancel any pending incremental match timer - we'll do a final pass now.
              const pendingMatchTimer = this.matchDebounceTimers.get(session.id);
              if (pendingMatchTimer) {
                clearTimeout(pendingMatchTimer);
                this.matchDebounceTimers.delete(session.id);
              }
              // Delay briefly to let non-blocking message writes complete.
              if (effectiveWorkspacePath) {
                const matchSessionId = session.id;
                setTimeout(() => {
                  toolCallMatcher.matchSession(matchSessionId).then(count => {
                    if (count > 0) {
                      safeSend(event, 'session-files:updated', matchSessionId);
                    }
                  }).catch(err =>
                    logger.main.error(`[AIService] Tool call matching failed for session ${matchSessionId}:`, err)
                  );
                }, 2000);
              }

              break;
          }
        }

        // Flush any Bash commands that only emitted one observable tool event
        // so they still get pending-review tags and tool-call-linked diffs.
        for (const [commandItemId, command] of pendingBashCommands.entries()) {
          if (processedBashCommandItemIds.has(commandItemId)) continue;
          try {
            const tracked = await this.trackBashFileEditsFromCommand(
              session,
              workspacePath,
              command,
              commandItemId
            );
            if (tracked) {
              processedBashCommandItemIds.add(commandItemId);
              // Ensure renderer updates immediately when bash fallback tracking
              // adds late session_files rows (single-event command_execution cases).
              safeSend(event, 'session-files:updated', session.id);
            }
          } catch (bashFallbackError) {
            logger.main.error('[AIService] Failed to flush Bash fallback edits:', bashFallbackError);
          }
        }

        // Clear executing and pending prompt flags for mobile sync
        if (syncProvider) {
          syncProvider.pushChange(session.id, {
            type: 'metadata_updated',
            metadata: { isExecuting: false, hasPendingPrompt: false, updatedAt: Date.now() },
          });
        }

        // TESTING: Queue processing from main process instead of renderer
        // OLD: Queue processing is handled by the renderer (AgenticPanel) to keep SDK instantiation in one place
        try {
          // Check the per-session guard before processing - triggerQueueProcessing IPC may already be handling this
          if (!this.sessionsProcessingQueue.has(session.id)) {
            const { getQueuedPromptsStore } = await import('../RepositoryManager');
            const queueStore = getQueuedPromptsStore();
            const pendingPrompts = await queueStore.listPending(session.id);

            if (pendingPrompts.length > 0) {
              const nextPrompt = pendingPrompts[0];
              logger.main.info(`[AIService] Processing next queued prompt from main process: ${nextPrompt.id} for session ${session.id}`);

              // Claim the prompt atomically
              const claimed = await queueStore.claim(nextPrompt.id);
              if (claimed) {
                // Mark session as processing before the setImmediate
                this.sessionsProcessingQueue.add(session.id);

                // Notify renderer that prompt was claimed (so UI removes it from queue list)
                safeSend(event, 'ai:promptClaimed', {
                  sessionId: session.id,
                  promptId: claimed.id,
                });

                // Recursively call sendMessage with the queued prompt
                const docContext = {
                  ...claimed.documentContext,
                  queuedPromptId: claimed.id,
                  attachments: claimed.attachments,
                };

                // Use setImmediate to avoid stack overflow and let this response complete first
                setImmediate(async () => {
                  try {
                    await this.sendMessageHandler!(event, claimed.prompt, docContext as any, session.id, workspacePath);
                    // Mark as completed
                    await queueStore.complete(claimed.id);
                  } catch (queueError) {
                    logger.main.error(`[AIService] Failed to process queued prompt ${claimed.id}:`, queueError);
                    await queueStore.fail(claimed.id, queueError instanceof Error ? queueError.message : 'Unknown error');
                  } finally {
                    this.sessionsProcessingQueue.delete(session.id);
                  }
                });
              }
            }
          } else {
            logger.main.info(`[AIService] Skipping completion-handler queue processing for session ${session.id} - already processing`);
          }
        } catch (queueError) {
          logger.main.error('[AIService] Error checking queued prompts:', queueError);
        }

        // Clean up queued prompt tracking
        if (queuedPromptId) {
          this.processingQueuedPromptIds.delete(queuedPromptId);
          // logger.main.info(`[AIService] Cleared prompt tracking for ${queuedPromptId}`);
        }

        return { content: fullResponse };
      } catch (error) {
        const errorTime = Date.now() - startTime;
        const isClaudeCode = session?.provider === 'claude-code';
        const logPrefix = isClaudeCode ? '[CLAUDE-CODE-SERVICE]' : '[AIService]';

        if (isClaudeCode) {
          console.error('[CLAUDE-CODE-SERVICE] ====== CRITICAL ERROR ======');
          console.error('[CLAUDE-CODE-SERVICE] Error caught in stream handler:', error);
          console.error('[CLAUDE-CODE-SERVICE] Error type:', error instanceof Error ? error.constructor.name : typeof error);
          console.error('[CLAUDE-CODE-SERVICE] Error message:', error instanceof Error ? error.message : String(error));
          console.error('[CLAUDE-CODE-SERVICE] Error stack:', error instanceof Error ? error.stack : 'No stack');
          console.error('[CLAUDE-CODE-SERVICE] Context:', {
            errorTime
          });
        }

        console.error(`${logPrefix} Error after ${errorTime}ms:`, error);

        // Track AI request failure (only if we have session info)
        if (session) {
          this.analytics.sendEvent('ai_request_failed', {
            provider: session.provider,
            errorType: categorizeAIError(error),
            retryAttempt: 0  // We don't currently track retry attempts
          });

          // Track ai_response_received with error
          this.analytics.sendEvent('ai_response_received', {
            provider: session.provider,
            responseType: 'error',
            toolsUsed: [],
            usedChartTool: false,
            responseTime: bucketResponseTime(errorTime)
          });
        }

        // Mark session as error and end it
        if (session?.id) {
          await stateManager.updateActivity({
            sessionId: session.id,
            status: 'error'
          });

          // End the session to remove it from active sessions.
          // Skip if teammates are still active or lead is resuming - deferred to teammates:allCompleted.
          // NOTE: Use willResumeAfterCompletion() not isLeadBusy() — we're inside the
          // generator's for-await so leadQuery is still set (same issue as 'complete' handler).
          const hasTeammatesOnError = session.provider === 'claude-code'
            && typeof (provider as any).hasActiveTeammates === 'function'
            && (provider as any).hasActiveTeammates();
          const willResumeOnError = session.provider === 'claude-code'
            && typeof (provider as any).willResumeAfterCompletion === 'function'
            && (provider as any).willResumeAfterCompletion();
          if (hasTeammatesOnError || willResumeOnError) {
            logger.main.info(`[AIService] Deferring endSession for ${session.id} on error - ${hasTeammatesOnError ? 'teammates still active' : 'lead resuming'}`);
          } else {
            await stateManager.endSession(session.id);
            // Stop file watcher - session ended on error
            await this.stopCodexSessionWatcher(session.id);
          }

          // Clear executing and pending prompt flags for mobile sync on error
          if (syncProvider) {
            syncProvider.pushChange(session.id, {
              type: 'metadata_updated',
              metadata: { isExecuting: false, hasPendingPrompt: false, updatedAt: Date.now() },
            });

            // Request mobile push notification for agent error
            syncProvider.requestMobilePush?.(
              session.id,
              session.title || 'AI Session',
              'Error occurred'
            );
          }
        }

        // Send error metrics
        if (event && event.sender) {
          safeSend(event, 'ai:performanceMetrics', {
            phase: 'error',
            errorTime,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          // Send error to renderer
          safeSend(event, 'ai:error', {
            sessionId: session?.id,
            message: error instanceof Error ? error.message : 'Unknown error occurred'
          });
        }

        // Clean up queued prompt tracking on error
        if (queuedPromptId) {
          this.processingQueuedPromptIds.delete(queuedPromptId);
          logger.main.info(`[AIService] Cleared prompt tracking for ${queuedPromptId} (error path)`);
        }

        // Process next queued prompt even on error/abort
        // This ensures queued prompts fire when user cancels a question
        if (session?.id && event?.sender && !this.sessionsProcessingQueue.has(session.id)) {
          try {
            const { getQueuedPromptsStore } = await import('../RepositoryManager');
            const queueStore = getQueuedPromptsStore();
            const pendingPrompts = await queueStore.listPending(session.id);

            if (pendingPrompts.length > 0) {
              const nextPrompt = pendingPrompts[0];
              logger.main.info(`[AIService] Processing next queued prompt after error/abort: ${nextPrompt.id} for session ${session.id}`);

              // Claim the prompt atomically
              const claimed = await queueStore.claim(nextPrompt.id);
              if (claimed) {
                // Mark session as processing before the setImmediate
                this.sessionsProcessingQueue.add(session.id);

                // Notify renderer that prompt was claimed (so UI removes it from queue list)
                safeSend(event, 'ai:promptClaimed', {
                  sessionId: session.id,
                  promptId: claimed.id,
                });

                // Recursively call sendMessage with the queued prompt
                const docContext = {
                  ...claimed.documentContext,
                  queuedPromptId: claimed.id,
                  attachments: claimed.attachments,
                };

                // Use setImmediate to avoid stack overflow and let this response complete first
                setImmediate(async () => {
                  try {
                    await this.sendMessageHandler!(event, claimed.prompt, docContext as any, session.id, workspacePath);
                    // Mark as completed
                    await queueStore.complete(claimed.id);
                  } catch (queueError) {
                    logger.main.error(`[AIService] Failed to process queued prompt ${claimed.id}:`, queueError);
                    await queueStore.fail(claimed.id, queueError instanceof Error ? queueError.message : 'Unknown error');
                  } finally {
                    this.sessionsProcessingQueue.delete(session.id);
                  }
                });
              }
            }
          } catch (queueError) {
            logger.main.error('[AIService] Error checking queued prompts after error/abort:', queueError);
          }
        }

        throw error;
      }
    };

    // Register the handler with IPC
    safeHandle('ai:sendMessage', this.sendMessageHandler);

    // Get session history (full session data with messages - slow)
    safeHandle('ai:getSessions', async (event, workspacePath?: string) => {
      return await this.sessionManager.getSessions(workspacePath);
    });

    // Get session list (lightweight - just metadata, no messages)
    safeHandle('ai:getSessionList', async (event, workspacePath?: string) => {
      return await this.sessionManager.getSessionList(workspacePath);
    });

    // Load a session
    // trackAsResume: only pass true when user intentionally opens a session from history
    // (not for tab restoration, lazy loading, or session reloading)
    // Deduplicate: if a load is already in-flight for the same sessionId, reuse the promise
    // to avoid queuing redundant heavy DB queries in PGLite's single-threaded worker
    const loadSessionInFlight = new Map<string, Promise<any>>();
    safeHandle('ai:loadSession', async (event, sessionId: string, workspacePath?: string, trackAsResume?: boolean) => {
      const existing = loadSessionInFlight.get(sessionId);
      if (existing && !trackAsResume) {
        return existing;
      }

      const loadPromise = (async () => {
      const loadStart = performance.now();
      const session = await this.sessionManager.loadSession(sessionId, workspacePath);
      const loadTime = performance.now() - loadStart;
      if (!session) {
        console.log(`[SESSION] Session not found: ${sessionId} (this is normal if the session was deleted)`);
        return null;
      }

      // Restore document context state from persisted data (if available)
      // This enables transition detection across app restarts
      if (session.lastDocumentState) {
        this.documentContextService.loadPersistedState(sessionId, session.lastDocumentState);
      }

      // Track ai_session_resumed only when user intentionally opens a session from history
      // Skip for: app startup tab restoration, tab switching (lazy load), session reloading
      if (trackAsResume && session.messages && session.messages.length > 0) {
        const messageCount = session.messages.length;
        const createdAt = session.createdAt || Date.now();

        this.analytics.sendEvent('ai_session_resumed', {
          provider: session.provider,
          messageCount: bucketCount(messageCount),
          ageInDays: bucketAgeInDays(createdAt)
        });
      }

      // NOTE: Mobile message handling is done via startIndexListener() which watches
      // the index for pendingExecution flags. We do NOT call watchSession() here because
      // it creates a WebSocket connection per session, causing performance issues.

      return session;
      })();

      loadSessionInFlight.set(sessionId, loadPromise);
      try {
        return await loadPromise;
      } finally {
        loadSessionInFlight.delete(sessionId);
      }
    });

    // Clear session
    safeHandle('ai:clearSession', async (event, sessionId?: string) => {
      this.sessionManager.clearCurrentSession();

      // Abort any ongoing request for the specific session
      if (sessionId) {
        // Use repository directly - we just need session metadata (provider type)
        const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
        const session = await AISessionsRepository.get(sessionId);
        if (session) {
          const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
          if (provider) {
            provider.abort();
            console.log(`[AIService] Aborted provider for session ${sessionId}`);
          }
        }
      }

      return { success: true };
    });

    // Update session messages
    safeHandle('ai:updateSessionMessages', async (
      event,
      sessionId: string,
      messages: Message[],
      workspacePath?: string
    ) => {
      const success = await this.sessionManager.updateSessionMessages(sessionId, messages, workspacePath);
      return { success };
    });

    // Update session metadata (for queue, etc.)
    safeHandle('ai:updateSessionMetadata', async (
      event,
      sessionId: string,
      metadata: Record<string, any>,
      workspacePath?: string
    ) => {
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      await AISessionsRepository.updateMetadata(sessionId, { metadata });

      // Notify TrayManager when hasUnread state changes so the tray menu stays in sync
      if (metadata.metadata?.hasUnread !== undefined) {
        TrayManager.getInstance().onSessionUnread(sessionId, !!metadata.metadata.hasUnread);
      }

      // If lastReadAt is being updated, also push through sync for cross-device read state
      // NOTE: Do NOT include updatedAt here. Reading a session is not meaningful activity
      // and should not cause the session to resort to the top of the list on other devices.
      const syncProvider = getSyncProvider();
      if (metadata.metadata?.lastReadAt && syncProvider) {
        syncProvider.pushChange(sessionId, {
          type: 'metadata_updated',
          metadata: {
            lastReadAt: metadata.metadata.lastReadAt,
          },
        });
      }

      return { success: true };
    });

    // Atomically claim a queued prompt for processing
    // Returns the prompt data if successfully claimed, null if already claimed by another instance
    // Uses the new queued_prompts table with proper row-level atomic updates
    safeHandle('ai:claimQueuedPrompt', async (
      event,
      sessionId: string,
      promptId: string
    ) => {
      // Use the new QueuedPromptsStore for atomic claim
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();

      // Atomic claim - only succeeds if status is still 'pending'
      const claimed = await queueStore.claim(promptId);

      if (claimed) {
        logger.main.info(`[AIService] claimQueuedPrompt: claimed ${promptId} for session ${sessionId}`);
        // Return in the format expected by the renderer
        return {
          id: claimed.id,
          prompt: claimed.prompt,
          timestamp: claimed.createdAt,
          attachments: claimed.attachments,
          documentContext: claimed.documentContext,
        };
      }

      logger.main.info(`[AIService] claimQueuedPrompt: prompt ${promptId} not found or already claimed`);
      return null;
    });

    // Mark a queued prompt as completed
    safeHandle('ai:completeQueuedPrompt', async (
      event,
      promptId: string
    ) => {
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();
      await queueStore.complete(promptId);
      logger.main.info(`[AIService] completeQueuedPrompt: ${promptId}`);
    });

    // Mark a queued prompt as failed
    safeHandle('ai:failQueuedPrompt', async (
      event,
      promptId: string,
      errorMessage: string
    ) => {
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();
      await queueStore.fail(promptId, errorMessage);
      logger.main.info(`[AIService] failQueuedPrompt: ${promptId} - ${errorMessage}`);
    });

    // List pending prompts for a session
    safeHandle('ai:listPendingPrompts', async (
      event,
      sessionId: string
    ) => {
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();
      const pending = await queueStore.listPending(sessionId);
      return pending.map(p => ({
        id: p.id,
        prompt: p.prompt,
        timestamp: p.createdAt,
        attachments: p.attachments,
        documentContext: p.documentContext,
      }));
    });

    // Create a new queued prompt (for local queuing)
    safeHandle('ai:createQueuedPrompt', async (
      event,
      sessionId: string,
      prompt: string,
      attachments?: any[],
      documentContext?: any
    ) => {
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();

      // Generate a unique ID with 'local-' prefix to identify locally-created prompts
      // This prevents the mobile sync handler from re-broadcasting these prompts
      const promptId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const created = await queueStore.create({
        id: promptId,
        sessionId,
        prompt,
        attachments,
        documentContext,
      });

      logger.main.info(`[AIService] createQueuedPrompt: created ${promptId} for session ${sessionId}`);

      // Track ai_message_queued analytics event
      try {
        const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
        const session = await AISessionsRepository.get(sessionId);
        if (session) {
          const fileExtension = getFileExtensionForAnalytics(documentContext?.filePath);
          AnalyticsService.getInstance().sendEvent('ai_message_queued', {
            provider: session.provider,
            source: 'local',
            hasDocumentContext: !!documentContext,
            hasAttachments: !!(attachments && attachments.length > 0),
            ...(fileExtension && { fileExtension }),
          });
        }
      } catch (analyticsError) {
        logger.main.warn('[AIService] Failed to track ai_message_queued:', analyticsError);
      }

      // Notify the renderer to update the queue list UI
      // This ensures locally-queued prompts are visible (same as mobile sync path)
      safeSend(event, 'ai:queuedPromptsReceived', {
        sessionId,
        promptCount: 1
      });

      return {
        id: created.id,
        prompt: created.prompt,
        timestamp: created.createdAt,
        attachments: created.attachments,
        documentContext: created.documentContext,
      };
    });

    // Delete a queued prompt (for user cancellation)
    safeHandle('ai:deleteQueuedPrompt', async (
      event,
      promptId: string
    ) => {
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();
      await queueStore.delete(promptId);
      logger.main.info(`[AIService] deleteQueuedPrompt: deleted ${promptId}`);
      return { success: true };
    });

    // Trigger queue processing for a session (e.g., when voice command queued while AI is idle)
    safeHandle('ai:triggerQueueProcessing', async (
      event,
      sessionId: string,
      workspacePath: string
    ) => {
      // Check per-session guard - the completion handler may already be processing for this session
      if (this.sessionsProcessingQueue.has(sessionId)) {
        logger.main.info(`[AIService] triggerQueueProcessing: session ${sessionId} already processing a queued prompt, skipping`);
        return { processed: false };
      }

      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();
      const pendingPrompts = await queueStore.listPending(sessionId);

      if (pendingPrompts.length === 0) {
        logger.main.info(`[AIService] triggerQueueProcessing: no pending prompts for session ${sessionId}`);
        return { processed: false };
      }

      const nextPrompt = pendingPrompts[0];
      logger.main.info(`[AIService] triggerQueueProcessing: processing prompt ${nextPrompt.id} for session ${sessionId}`);

      // Claim the prompt atomically
      const claimed = await queueStore.claim(nextPrompt.id);
      if (!claimed) {
        logger.main.info(`[AIService] triggerQueueProcessing: prompt ${nextPrompt.id} already claimed`);
        return { processed: false };
      }

      // Mark session as processing before the setImmediate
      this.sessionsProcessingQueue.add(sessionId);

      // Notify renderer that prompt was claimed (so UI removes it from queue list)
      safeSend(event, 'ai:promptClaimed', {
        sessionId,
        promptId: claimed.id,
      });

      // Build document context for the queued prompt
      const docContext = {
        ...claimed.documentContext,
        queuedPromptId: claimed.id,
        attachments: claimed.attachments,
      };

      // Process the prompt via sendMessage
      setImmediate(async () => {
        try {
          await this.sendMessageHandler!(event, claimed.prompt, docContext as any, sessionId, workspacePath);
          // Mark as completed
          await queueStore.complete(claimed.id);
        } catch (queueError) {
          logger.main.error(`[AIService] Failed to process queued prompt ${claimed.id}:`, queueError);
          await queueStore.fail(claimed.id, queueError instanceof Error ? queueError.message : 'Unknown error');
        } finally {
          this.sessionsProcessingQueue.delete(sessionId);
        }
      });

      return { processed: true };
    });

    // Save draft input
    safeHandle('ai:saveDraftInput', async (
      event,
      sessionId: string,
      draftInput: string,
      workspacePath?: string
    ) => {
      const success = await this.sessionManager.saveDraftInput(sessionId, draftInput, workspacePath);
      return { success };
    });

    // Clean up empty messages from all sessions
    safeHandle('ai:cleanupEmptyMessages', async () => {
      const cleaned = this.sessionManager.cleanupAllSessions();
      console.log(`[AIService] Manual cleanup: removed ${cleaned} empty messages`);
      return { success: true, cleaned };
    });

    // Delete session
    safeHandle('ai:deleteSession', async (event, sessionId: string, workspacePath?: string) => {
      const success = await this.sessionManager.deleteSession(sessionId, workspacePath);

      // Clean up provider if it exists
      if (success) {
        ProviderFactory.destroyProvider(sessionId);
        // Clean up document state tracking
        this.documentContextService.clearSessionState(sessionId);
        // Clean up Codex file watcher if active
        await this.stopCodexSessionWatcher(sessionId);
      }

      return { success };
    });

    // Handle ExitPlanMode confirmation response from renderer
    safeHandle('ai:exitPlanModeConfirmResponse', async (event, requestId: string, sessionId: string, response: { approved: boolean; clearContext?: boolean; feedback?: string }) => {
      logger.main.info(`[AIService] ExitPlanMode confirmation response: requestId=${requestId}, approved=${response.approved}, clearContext=${response.clearContext}, hasFeedback=${!!response.feedback}`);

      // Use repository directly - we just need session metadata (provider type),
      // not the full session load with messages
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(sessionId);
      if (!session) {
        logger.main.warn(`[AIService] Session not found for ExitPlanMode response: ${sessionId}`);
        return { success: false, error: 'Session not found' };
      }

      const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
      if (!provider) {
        logger.main.warn(`[AIService] Provider not found for ExitPlanMode response: ${sessionId}`);
        return { success: false, error: 'Provider not found' };
      }

      // Check if this is a ClaudeCodeProvider with the resolve method
      if (typeof (provider as any).resolveExitPlanModeConfirmation === 'function') {
        (provider as any).resolveExitPlanModeConfirmation(requestId, response, sessionId, 'desktop');

        // If approved, update the session mode to 'agent' in the database
        // This ensures the mode persists across session switches and app restarts
        if (response.approved) {
          await AISessionsRepository.updateMetadata(sessionId, { mode: 'agent' });
          logger.main.info(`[AIService] Session ${sessionId} mode updated to 'agent' after ExitPlanMode approval`);
        }

        // Emit resolved event so the sidebar indicator updates and UI syncs mode change
        const { BrowserWindow } = await import('electron');
        const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
        for (const win of windows) {
          if (!win.webContents.isDestroyed()) {
            win.webContents.send('ai:exitPlanModeResolved', { sessionId, approved: response.approved });
          }
        }

        // Clear pending prompt state for mobile sync and tray
        TrayManager.getInstance().onPromptResolved(sessionId);
        const syncProvider = getSyncProvider();
        if (syncProvider) {
          syncProvider.pushChange(sessionId, {
            type: 'metadata_updated',
            metadata: { hasPendingPrompt: false, updatedAt: Date.now() },
          });
        }

        return { success: true };
      } else {
        logger.main.warn(`[AIService] Provider does not support ExitPlanMode confirmation: ${session.provider}`);
        return { success: false, error: 'Provider does not support ExitPlanMode confirmation' };
      }
    });

    // Handle AskUserQuestion answer response from renderer
    // Used when Claude's AskUserQuestion tool needs user input
    safeHandle('claude-code:answer-question', async (event, { questionId, answers, sessionId }: { questionId: string; answers: Record<string, string>; sessionId?: string }) => {
      // logger.main.info(`[AIService] AskUserQuestion answer received: questionId=${questionId}`);

      // sessionId can be passed directly or extracted from legacy questionId format (ask-{sessionId}-{timestamp})
      let resolvedSessionId = sessionId;
      if (!resolvedSessionId) {
        const sessionIdMatch = questionId.match(/^ask-(.+)-\d+$/);
        if (sessionIdMatch && sessionIdMatch[1] !== 'unknown') {
          resolvedSessionId = sessionIdMatch[1];
        }
      }

      if (!resolvedSessionId) {
        logger.main.warn(`[AIService] No sessionId for AskUserQuestion: ${questionId}`);
        return { success: false, error: 'Session ID required' };
      }

      // Use repository directly - we just need session metadata (provider type),
      // not the full session load with messages
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(resolvedSessionId);
      if (!session) {
        logger.main.warn(`[AIService] Session not found for AskUserQuestion: ${resolvedSessionId}`);
        return { success: false, error: 'Session not found' };
      }

      const provider = ProviderFactory.getProvider(session.provider as AIProviderType, resolvedSessionId);
      if (!provider) {
        logger.main.warn(`[AIService] Provider not found for AskUserQuestion: ${resolvedSessionId}`);
        return { success: false, error: 'Provider not found' };
      }

      // Check if this is a provider that supports AskUserQuestion (e.g., ClaudeCodeProvider)
      if (isAskUserQuestionProvider(provider)) {
        // Pass sessionId for response message persistence
        // Provider logs warning if question not found - no need to duplicate here
        const resolved = provider.resolveAskUserQuestion(questionId, answers, resolvedSessionId, 'desktop');
        return resolved ? { success: true } : { success: false, error: 'Question not found' };
      } else {
        logger.main.warn(`[AIService] Provider does not support AskUserQuestion: ${session.provider}`);
        return { success: false, error: 'Provider does not support AskUserQuestion' };
      }
    });

    // Handle AskUserQuestion cancel from renderer
    // Rejects the pending promise and aborts the AI request
    safeHandle('claude-code:cancel-question', async (event, { questionId, sessionId }: { questionId: string; sessionId?: string }) => {
      logger.main.info(`[AIService] AskUserQuestion cancel received: questionId=${questionId}`);

      // sessionId can be passed directly or extracted from legacy questionId format (ask-{sessionId}-{timestamp})
      let resolvedSessionId = sessionId;
      if (!resolvedSessionId) {
        const sessionIdMatch = questionId.match(/^ask-(.+)-\d+$/);
        if (sessionIdMatch && sessionIdMatch[1] !== 'unknown') {
          resolvedSessionId = sessionIdMatch[1];
        }
      }

      if (!resolvedSessionId) {
        logger.main.warn(`[AIService] No sessionId for AskUserQuestion cancel: ${questionId}`);
        return { success: false, error: 'Session ID required' };
      }

      // Use repository directly - we just need session metadata (provider type),
      // not the full session load with messages
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(resolvedSessionId);
      if (!session) {
        logger.main.warn(`[AIService] Session not found for AskUserQuestion cancel: ${resolvedSessionId}`);
        return { success: false, error: 'Session not found' };
      }

      const provider = ProviderFactory.getProvider(session.provider as AIProviderType, resolvedSessionId);
      if (!provider) {
        logger.main.warn(`[AIService] Provider not found for AskUserQuestion cancel: ${resolvedSessionId}`);
        return { success: false, error: 'Provider not found' };
      }

      // Check if this is a ClaudeCodeProvider with the reject method
      if (typeof (provider as any).rejectAskUserQuestion === 'function') {
        (provider as any).rejectAskUserQuestion(questionId, new Error('User cancelled'));
        // Also abort the provider to stop the AI request
        provider.abort();
        return { success: true };
      } else {
        logger.main.warn(`[AIService] Provider does not support AskUserQuestion cancel: ${resolvedSessionId}`);
        return { success: false, error: 'Provider does not support AskUserQuestion cancel' };
      }
    });

    // Handle tool permission response from renderer
    // Used when a tool requires user approval
    safeHandle('claude-code:answer-tool-permission', async (event, {
      requestId,
      sessionId,
      response
    }: {
      requestId: string;
      sessionId: string;
      response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' }
    }) => {
      logger.main.info(`[AIService] Tool permission response received: requestId=${requestId}, decision=${response.decision}, scope=${response.scope}`);

      if (sessionId === 'unknown') {
        logger.main.warn(`[AIService] Unknown session for tool permission: ${requestId}`);
        return { success: false, error: 'Unknown session' };
      }

      // Use repository directly - we just need session metadata (provider type),
      // not the full session load with messages
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(sessionId);
      if (!session) {
        logger.main.warn(`[AIService] Session not found for tool permission: ${sessionId}`);
        return { success: false, error: 'Session not found' };
      }

      const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
      if (!provider) {
        logger.main.warn(`[AIService] Provider not found for tool permission: ${sessionId}`);
        return { success: false, error: 'Provider not found' };
      }

      // Check if this is a ClaudeCodeProvider with the resolve method
      if (typeof (provider as any).resolveToolPermission === 'function') {
        // Pass sessionId for response message persistence
        (provider as any).resolveToolPermission(requestId, response, sessionId, 'desktop');
        return { success: true };
      } else {
        logger.main.warn(`[AIService] Provider does not support tool permission: ${session.provider}`);
        return { success: false, error: 'Provider does not support tool permission' };
      }
    });

    // Handle tool permission cancel from renderer
    // Rejects the pending promise and aborts the AI request
    safeHandle('claude-code:cancel-tool-permission', async (event, {
      requestId,
      sessionId
    }: {
      requestId: string;
      sessionId: string;
    }) => {
      logger.main.info(`[AIService] Tool permission cancel received: requestId=${requestId}`);

      if (sessionId === 'unknown') {
        logger.main.warn(`[AIService] Unknown session for tool permission cancel: ${requestId}`);
        return { success: false, error: 'Unknown session' };
      }

      // Use repository directly - we just need session metadata (provider type),
      // not the full session load with messages
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(sessionId);
      if (!session) {
        logger.main.warn(`[AIService] Session not found for tool permission cancel: ${sessionId}`);
        return { success: false, error: 'Session not found' };
      }

      const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
      if (!provider) {
        logger.main.warn(`[AIService] Provider not found for tool permission cancel: ${sessionId}`);
        return { success: false, error: 'Provider not found' };
      }

      // Check if this is a ClaudeCodeProvider with the reject method
      if (typeof (provider as any).rejectToolPermission === 'function') {
        (provider as any).rejectToolPermission(requestId, new Error('User cancelled'));
        // Also abort the provider to stop the AI request
        provider.abort();
        return { success: true };
      } else {
        logger.main.warn(`[AIService] Provider does not support tool permission cancel: ${session.provider}`);
        return { success: false, error: 'Provider does not support tool permission cancel' };
      }
    });

    // Cancel current request
    safeHandle('ai:cancelRequest', async (event, sessionId: string, chunksReceived?: number) => {
      // console.log(`[AIService] ai:cancelRequest received for sessionId: ${sessionId}`);
      // Abort the provider for the specific session
      if (!sessionId) {
        throw new Error('Session ID is required to cancel request');
      }

      // Use repository directly - we just need session metadata (provider type),
      // not the full session load with messages
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(sessionId);
      if (!session) {
        console.warn(`[AIService] Cancel failed - session not found: ${sessionId}`);
        return { success: false, error: 'Session not found' };
      }

      // console.log(`[AIService] Session found, provider type: ${session.provider}`);
      const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
      // console.log(`[AIService] Provider lookup result: ${provider ? 'found' : 'NOT FOUND'}`);
      if (provider) {
        // Get provider type
        const providerType = (provider as any).providerType || 'unknown';

        // Track stream interruption
        this.analytics.sendEvent('ai_stream_interrupted', {
          provider: providerType,
          chunksReceived: chunksReceived || 0,
          reason: 'user_cancel'
        });

        provider.abort();
        // console.log(`[AIService] Cancelled request for session ${sessionId}`);
        this.analytics.sendEvent('cancel_ai_request', {provider: providerType})
        return { success: true };
      }
      console.warn(`[AIService] Cancel failed - no active provider for session: ${sessionId}`);
      return { success: false, error: 'No active provider for session' };
    });

    // Settings handlers
    safeHandle('ai:getSettings', async () => {
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getNormalizedProviderSettings();
      const showToolCalls = this.getSettingsStore().get('showToolCalls', false) as boolean;
      const aiDebugLogging = this.getSettingsStore().get('aiDebugLogging', false) as boolean;
      const showPromptAdditions = this.getSettingsStore().get('showPromptAdditions', false) as boolean;
      const showUsageIndicator = this.getSettingsStore().get('showUsageIndicator', true) as boolean;
      const showCodexUsageIndicator = this.getSettingsStore().get('showCodexUsageIndicator', true) as boolean;
      const useStandaloneBinary = this.getSettingsStore().get('useStandaloneBinary', false) as boolean;
      const customClaudeCodePath = this.getSettingsStore().get('customClaudeCodePath', '') as string;
      const autoCommitEnabled = this.getSettingsStore().get('autoCommitEnabled', false) as boolean;
      const showExtendedContextModels = this.getSettingsStore().get('showExtendedContextModels', false) as boolean;

      return {
        defaultProvider: this.getSettingsStore().get('defaultProvider', 'claude-code'),
        apiKeys: this.maskApiKeys(apiKeys),
        providerSettings,
        showToolCalls,
        aiDebugLogging,
        showPromptAdditions,
        showUsageIndicator,
        showCodexUsageIndicator,
        useStandaloneBinary,
        customClaudeCodePath,
        autoCommitEnabled,
        showExtendedContextModels,
      };
    });

    safeHandle('ai:saveSettings', async (event, settings: any) => {
      if (settings.defaultProvider) {
        this.getSettingsStore().set('defaultProvider', settings.defaultProvider);
      }

      if (settings.apiKeys) {
        // Only update changed API keys
        const currentKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

        // Save Anthropic key
        if (settings.apiKeys.anthropic !== undefined) {
          const key = settings.apiKeys.anthropic;
          if (!key) {
            delete currentKeys['anthropic'];
          } else if (key !== this.maskApiKey(currentKeys['anthropic'] || '')) {
            currentKeys['anthropic'] = key as string;
          }
        }

        // Save OpenAI key
        if (settings.apiKeys.openai !== undefined) {
          const key = settings.apiKeys.openai;
          if (!key) {
            delete currentKeys['openai'];
          } else if (key !== this.maskApiKey(currentKeys['openai'] || '')) {
            currentKeys['openai'] = key as string;
            // Sync to mobile devices for voice mode
            import('../SyncManager').then(({ syncSettingsToMobile }) => {
              syncSettingsToMobile(key as string);
            }).catch(() => {
              // Sync manager may not be available
            });
          }
        }

        // Save OpenAI Codex key
        if (settings.apiKeys['openai-codex'] !== undefined) {
          const key = settings.apiKeys['openai-codex'];
          if (!key) {
            delete currentKeys['openai-codex'];
          } else if (key !== this.maskApiKey(currentKeys['openai-codex'] || '')) {
            currentKeys['openai-codex'] = key as string;
          }
        }

        // Save LMStudio URL
        if (settings.apiKeys.lmstudio_url !== undefined) {
          currentKeys['lmstudio_url'] = settings.apiKeys.lmstudio_url as string;
        }

        this.getSettingsStore().set('apiKeys', currentKeys);
      }

      if (settings.providerSettings) {
        this.cachedNormalizedProviderSettings = null;
        this.getSettingsStore().set('providerSettings', this.normalizeProviderSettings(settings.providerSettings));
      }

      if (settings.showToolCalls !== undefined) {
        this.getSettingsStore().set('showToolCalls', settings.showToolCalls);
      }

      if (settings.aiDebugLogging !== undefined) {
        this.getSettingsStore().set('aiDebugLogging', settings.aiDebugLogging);
      }

      if (settings.showPromptAdditions !== undefined) {
        this.getSettingsStore().set('showPromptAdditions', settings.showPromptAdditions);
      }

      if (settings.showUsageIndicator !== undefined) {
        this.getSettingsStore().set('showUsageIndicator', settings.showUsageIndicator);
      }

      if (settings.showCodexUsageIndicator !== undefined) {
        this.getSettingsStore().set('showCodexUsageIndicator', settings.showCodexUsageIndicator);
      }

      if (settings.useStandaloneBinary !== undefined) {
        this.getSettingsStore().set('useStandaloneBinary', settings.useStandaloneBinary);
        // Update ClaudeCodeProvider immediately so new sessions use the updated setting
        ClaudeCodeProvider.setUseStandaloneBinary(settings.useStandaloneBinary);
      }

      if (settings.customClaudeCodePath !== undefined) {
        this.getSettingsStore().set('customClaudeCodePath', settings.customClaudeCodePath);
        ClaudeCodeProvider.setCustomClaudeCodePath(settings.customClaudeCodePath);
      }

      if (settings.autoCommitEnabled !== undefined) {
        this.getSettingsStore().set('autoCommitEnabled', settings.autoCommitEnabled);
      }

      if (settings.showExtendedContextModels !== undefined) {
        this.getSettingsStore().set('showExtendedContextModels', settings.showExtendedContextModels);
        // Clear model cache so the model selector picks up the change immediately
        ModelRegistry.clearCache();
      }

      return { success: true };
    });

    // Check if standalone binary is available (macOS only, packaged builds only)
    safeHandle('ai:isStandaloneBinaryAvailable', async () => {
      const { isStandaloneBinaryAvailable } = await import('@nimbalyst/runtime/electron/claudeCodeEnvironment');
      return isStandaloneBinaryAvailable();
    });

    // Test connection
    safeHandle('ai:testConnection', async (event, provider: string, workspacePath?: string) => {
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      // Get the appropriate API key based on provider
      let apiKey: string | undefined;
      switch (provider) {
        case 'claude':
          apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            return { success: false, error: 'Anthropic API key not configured' };
          }
          break;
        case 'claude-code':
          // Claude Code: API key is optional, uses SSO login if not provided
          apiKey = apiKeys['claude-code'];
          // No error if missing - will use SSO login
          break;
        case 'openai':
          apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;
          if (!apiKey) {
            return { success: false, error: 'OpenAI API key not configured' };
          }
          break;
        case 'openai-codex':
          apiKey = apiKeys['openai-codex'];
          if (!apiKey) {
            return { success: false, error: 'OpenAI API key not configured' };
          }
          break;
        case 'lmstudio':
          // LMStudio doesn't need an API key, just test the connection
          apiKey = 'not-required';
          break;
        default:
          return { success: false, error: `Unknown provider: ${provider}` };
      }

      try {
        // For OpenAI, just try to list models as a connection test
        if (provider === 'openai') {
          const models = await ModelRegistry.getModelsForProvider('openai', apiKey);
          return { success: models.length > 0, provider };
        }

        // For OpenAI Codex, run a real SDK request to validate credentials and connectivity
        if (provider === 'openai-codex') {
          const defaultModel = await ModelRegistry.getDefaultModel('openai-codex');
          const testProvider = new OpenAICodexProvider();
          const windowState = windowStates.get(event.sender.id);
          const effectiveWorkspacePath =
            workspacePath || windowState?.workspacePath;

          if (!effectiveWorkspacePath) {
            return {
              success: false,
              error: 'Open a workspace and trust it to test OpenAI Codex.',
            };
          }

          await testProvider.initialize({
            apiKey,
            model: defaultModel,
            maxTokens: 256,
          });

          let sawResponse = false;
          const response = testProvider.sendMessage(
            'Reply with exactly "ok".',
            undefined,
            undefined,
            [],
            effectiveWorkspacePath
          );

          for await (const chunk of response) {
            if (!chunk) continue;
            if (chunk.type === 'error') {
              throw new Error(chunk.error || 'Unknown Codex error');
            }
            if (chunk.type === 'text' && (chunk.content || '').trim().length > 0) {
              sawResponse = true;
            }
            if (chunk.type === 'complete') {
              break;
            }
          }

          testProvider.destroy();
          if (!sawResponse) {
            throw new Error('No response content received from Codex SDK');
          }

          return { success: true, provider };
        }

        // For Claude providers, test the API connection
        if (provider === 'claude') {
          console.log('[AIService] testConnection - Testing provider:', provider);

          // Create provider with appropriate config
          const config: any = { apiKey };

          const testProvider = new (await import('@nimbalyst/runtime/ai/server/providers/ClaudeProvider')).ClaudeProvider();

          // Use the provider's default model for testing (already includes prefix)
          const defaultModel = await ModelRegistry.getDefaultModel('claude');
          console.log('[AIService] testConnection - Got default model:', defaultModel);
          config.model = defaultModel;
          console.log('[AIService] testConnection - Initializing with config:', { hasApiKey: !!config.apiKey, model: config.model });
          await testProvider.initialize(config);

          console.log('[AIService] Testing connection by sending a simple message...');
          // Try a simple message
          const response = testProvider.sendMessage('Say "Hello" in one word');
          for await (const chunk of response) {
            if (!chunk) continue;
            if (chunk.type === 'error') {
              throw new Error(chunk.error || 'Unknown error');
            }
          }
          testProvider.destroy();
        }

        // For Claude Code, just verify the API key works with the regular Claude API
        if (provider === 'claude-code') {
          console.log('[AIService] testConnection - Testing Claude Code provider');

          // Test using the regular Claude API to verify the key
          const testProvider = new (await import('@nimbalyst/runtime/ai/server/providers/ClaudeProvider')).ClaudeProvider();
          const config: any = {
            apiKey,
            model: 'claude-3-5-sonnet-20241022'
          };

          await testProvider.initialize(config);

          // Quick test message
          const response = testProvider.sendMessage('Say "Hello" in one word');
          for await (const chunk of response) {
            if (!chunk) continue;
            if (chunk.type === 'error') {
              throw new Error(chunk.error || 'Unknown error');
            }
            // Exit after first response
            if (chunk.type === 'text') {
              break;
            }
          }
          testProvider.destroy();
        }

        // For LMStudio, test the endpoint
        if (provider === 'lmstudio') {
          const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
          const baseUrl = providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234';
          const response = await fetch(`${baseUrl}/v1/models`);
          if (!response.ok) {
            throw new Error(`LMStudio server not responding at ${baseUrl}`);
          }
        }

        return { success: true, provider };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Get ALL available models for configuration UI
    safeHandle('ai:getAllModels', async () => {
      // Clear cache to get fresh models
      ModelRegistry.clearCache();

      const providerSettings = this.getNormalizedProviderSettings() as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      // Only fetch from providers that are enabled (skip LMStudio network call when disabled)
      const enabledSet = new Set<AIProviderType>();
      if (providerSettings['claude']?.enabled === true && !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY)) enabledSet.add('claude');
      if (providerSettings['claude-code']?.enabled !== false) enabledSet.add('claude-code');
      if (providerSettings['openai']?.enabled === true && !!(apiKeys['openai'] || process.env.OPENAI_API_KEY)) enabledSet.add('openai');
      if (providerSettings['openai-codex']?.enabled === true) enabledSet.add('openai-codex');
      if (providerSettings['lmstudio']?.enabled === true) enabledSet.add('lmstudio');

      const modelsConfig = {
        ...apiKeys,
        lmstudio_url: providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234'
      };
      const allModels = await ModelRegistry.getAllModels(modelsConfig, enabledSet);

      // Group ALL models by provider (for configuration UI)
      const grouped: Record<string, any[]> = {};
      for (const model of allModels) {
        if (!grouped[model.provider]) {
          grouped[model.provider] = [];
        }
        grouped[model.provider].push(model);
      }

      return {
        success: true,
        models: allModels,
        grouped
      };
    });

    // Clear model cache
    safeHandle('ai:clearModelCache', async () => {
      ModelRegistry.clearCache();
      return { success: true };
    });

    safeHandle('ai:refreshSessionProvider', async (_event, sessionId: string) => {
      ProviderFactory.destroyProvider(sessionId);
      return { success: true };
    });

    // Get slash commands from active claude-code provider
    safeHandle('ai:getSlashCommands', async (event, sessionId?: string) => {
      try {

        // Get provider from session
        let provider: AIProvider | undefined;
        if (sessionId) {
          provider = ProviderFactory.getProvider('claude-code', sessionId) ?? undefined;
        }

        // Check if provider has getSlashCommands method
        if (provider) {

          if ('getSlashCommands' in provider && typeof (provider as any).getSlashCommands === 'function') {
            const commands = (provider as any).getSlashCommands();

            // If commands array is empty, return empty array
            if (commands.length === 0) {
              return { success: true, commands: [] };
            }

            return { success: true, commands };
          } else {
          }
        }

        // No provider found - return empty commands
        return { success: true, commands: [] };
      } catch (error) {
        console.error('[AIService] Error getting slash commands:', error);
        return { success: false, commands: [], error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get ENABLED models for actual use
    safeHandle('ai:getModels', async () => {
      // console.log('[AIService] ai:getModels called - fetching enabled models');
      const providerSettings = this.getNormalizedProviderSettings() as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const claudeCodeSettings = providerSettings['claude-code'] || {};

      // console.log('[AIService] ai:getModels - claude-code settings:', {
      //   enabled: claudeCodeSettings.enabled,
      //   models: claudeCodeSettings.models
      // });

      // Build enabled providers map (needed before fetching to skip disabled providers)
      const enabledProviders: Record<AIProviderType, { enabled: boolean; models?: string[] }> = {
        'claude': {
          enabled: providerSettings['claude']?.enabled === true && !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY),
          models: providerSettings['claude']?.models
        },
        'claude-code': {
          // Respect the user's toggle but don't require an API key—Claude Code uses CLI auth
          enabled: claudeCodeSettings.enabled !== false,
          models: claudeCodeSettings.models
        },
        'openai': {
          enabled: providerSettings['openai']?.enabled === true && !!(apiKeys['openai'] || process.env.OPENAI_API_KEY),
          models: providerSettings['openai']?.models
        },
        'openai-codex': {
          // Codex SDK uses its own auth (codex auth login), API key is optional
          enabled: providerSettings['openai-codex']?.enabled === true,
        },
        'lmstudio': {
          enabled: providerSettings['lmstudio']?.enabled === true,
          models: providerSettings['lmstudio']?.models
        }
      };

      // Only fetch models from enabled providers (avoids network errors for disabled ones like LMStudio)
      const enabledProviderSet = new Set(
        (Object.entries(enabledProviders) as [AIProviderType, { enabled: boolean }][])
          .filter(([, v]) => v.enabled)
          .map(([k]) => k)
      );
      const modelsConfig = {
        ...apiKeys,
        lmstudio_url: providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234'
      };
      const allModels = await ModelRegistry.getAllModels(modelsConfig, enabledProviderSet);

      // const claudeCodeModels = allModels.filter(m => m.provider === 'claude-code');
      // console.log('[AIService] ai:getModels - claude-code models from registry:',
      //   claudeCodeModels.map(m => ({ id: m.id, name: m.name })));

      // Check if extended context (1M) models should be shown
      const showExtendedContextModels = this.getSettingsStore().get('showExtendedContextModels', false) as boolean;

      // Filter to only enabled models
      const enabledModels = allModels.filter(model => {
        // Hide 1M models unless the setting is enabled
        if (!showExtendedContextModels && model.provider === 'claude-code' && (model.id.endsWith('-1m') || model.id.includes('-1m'))) {
          return false;
        }
        const provider = enabledProviders[model.provider as AIProviderType];
        // if (model.provider === 'openai-codex') {
        //   console.log('[AIService] Filtering openai-codex model:', {
        //     modelId: model.id,
        //     providerEnabled: provider?.enabled,
        //     selectedModels: provider?.models
        //   });
        // }
        if (!provider?.enabled) return false;
        // If specific models are selected, filter to those
        if (provider.models && provider.models.length > 0) {
          if (model.provider === 'claude-code' && provider.models.includes('claude-code')) {
            return true;
          }
          // For Claude Code: if base model is selected, also include 1M variants
          // e.g., if 'claude-code:sonnet' is selected, also include 'claude-code:sonnet-1m' and 'claude-code:sonnet-4.5-1m'
          if (model.provider === 'claude-code' && model.id.includes('-1m')) {
            const baseModelId = model.id.replace(/-1m$/, '');
            if (provider.models.includes(baseModelId)) {
              return true;
            }
            // Also check if the base variant (e.g., 'claude-code:sonnet') is selected
            // for pinned models like 'claude-code:sonnet-4.5-1m'
            if (model.id === 'claude-code:sonnet-4.5-1m' && provider.models.includes('claude-code:sonnet')) {
              return true;
            }
          }
          return provider.models.includes(model.id);
        }
        // Otherwise include all models for this provider
        return true;
      });

      // Group ENABLED models by provider (not all models)
      const grouped: Record<string, any[]> = {};
      for (const model of enabledModels) {
        if (!grouped[model.provider]) {
          grouped[model.provider] = [];
        }
        grouped[model.provider].push(model);
      }

      // Log final claude-code models being returned
      const enabledClaudeCodeModels = enabledModels.filter(m => m.provider === 'claude-code');
      console.log('[AIService] ai:getModels - returning enabled claude-code models:',
        enabledClaudeCodeModels.map(m => ({ id: m.id, name: m.name })));

      return {
        success: true,
        models: enabledModels.map(m => ({
          id: m.id,
          display_name: m.name,
          provider: m.provider,
          maxTokens: m.maxTokens
        })),
        grouped,  // This now contains only enabled models
        providers: enabledProviders
      };
    });

    // MCP integration for applyDiff results
    safeHandle('mcp:applyDiff:result', async (event, resultChannel: string, result: any) => {
      // Forward result back through the result channel
      safeSend(event, resultChannel, result);
    });

    // ============================================================
    // Project-level AI Settings Override Handlers
    // ============================================================

    // Get project-level AI provider overrides
    safeHandle('ai:getProjectSettings', async (_event, workspacePath: string) => {
      if (!workspacePath) {
        return { success: false, error: 'workspacePath is required' };
      }

      const overrides = getAIProviderOverrides(workspacePath);

      return {
        success: true,
        overrides: overrides || null,
      };
    });

    // Save project-level AI provider overrides
    safeHandle('ai:saveProjectSettings', async (_event, workspacePath: string, overrides: any) => {
      if (!workspacePath) {
        return { success: false, error: 'workspacePath is required' };
      }

      const normalizedOverrides = this.normalizeProjectOverrides(overrides);

      // If overrides is null/undefined or empty, clear the overrides
      if (!normalizedOverrides || (Object.keys(normalizedOverrides).length === 0)) {
        saveAIProviderOverrides(workspacePath, undefined);
      } else {
        saveAIProviderOverrides(workspacePath, normalizedOverrides);
      }

      return { success: true };
    });

    // Get effective (merged) AI settings for a workspace
    safeHandle('ai:getEffectiveSettings', async (_event, workspacePath?: string) => {

      // Get global settings
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
      const showToolCalls = this.getSettingsStore().get('showToolCalls', false) as boolean;
      const aiDebugLogging = this.getSettingsStore().get('aiDebugLogging', false) as boolean;
      const showPromptAdditions = this.getSettingsStore().get('showPromptAdditions', false) as boolean;
      const defaultProvider = this.getSettingsStore().get('defaultProvider', 'claude-code') as string;

      const globalSettings = {
        defaultProvider,
        apiKeys: this.maskApiKeys(apiKeys),
        providerSettings,
        showToolCalls,
        aiDebugLogging,
        showPromptAdditions,
      };

      // Merge with project overrides
      const effective = mergeAISettings(globalSettings, workspacePath);

      return {
        success: true,
        settings: effective,
      };
    });

    // Clear project-level AI overrides
    safeHandle('ai:clearProjectSettings', async (_event, workspacePath: string) => {
      if (!workspacePath) {
        return { success: false, error: 'workspacePath is required' };
      }

      clearAIProviderOverrides(workspacePath);

      return { success: true };
    });

    // Extension SDK: Send a prompt and wait for the full response
    safeHandle('extensions:ai-send-prompt', async (
      event,
      options: { prompt: string; sessionName?: string; provider?: string; model?: string }
    ) => {
      const { prompt, sessionName } = options;
      const provider = (options.provider || 'claude-code') as AIProviderType;
      if (!prompt) {
        throw new Error('prompt is required');
      }

      // Get workspace path from window state using BrowserWindow lookup
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      let workspacePath: string | undefined;
      if (browserWindow) {
        const windowId = getWindowId(browserWindow);
        if (windowId !== null) {
          const windowState = windowStates.get(windowId);
          workspacePath = windowState?.workspacePath || undefined;
        }
      }
      if (!workspacePath) {
        throw new Error('No workspace path available for extension AI prompt');
      }

      // Validate provider is enabled and has required credentials
      if (!this.isProviderEnabledForWorkspace(provider, workspacePath)) {
        throw new Error(`Provider ${provider} is not enabled for this workspace`);
      }

      // Check API key (claude-code uses SSO, so key is optional)
      if (provider !== 'claude-code') {
        const apiKey = this.getApiKeyForProvider(provider, workspacePath);
        if (!apiKey) {
          throw new Error(`API key not configured for provider ${provider}. Configure it in Settings > AI.`);
        }
      }

      // Use explicitly requested model, or fall back to provider default
      const model = options.model || await ModelRegistry.getDefaultModel(provider);
      const providerConfig: any = {
        maxTokens: this.getProviderSetting(provider, 'maxTokens'),
        temperature: this.getProviderSetting(provider, 'temperature'),
      };

      // For non-claude-code providers, set the model in provider config
      if (model && provider !== 'claude-code') {
        const modelForProvider = extractModelForProvider(model, provider);
        if (modelForProvider !== null) {
          providerConfig.model = modelForProvider;
        }
      }

      const session = await this.sessionManager.createSession(
        provider,
        undefined, // no document context
        workspacePath,
        providerConfig,
        model,
        'session',
      );

      // Set session title
      if (sessionName) {
        await this.sessionManager.updateSessionTitle(session.id, sessionName, { force: true, markAsNamed: true });
      }

      // Notify renderer to refresh session list so the new session appears
      safeSend(event, 'sessions:refresh-list', { workspacePath, sessionId: session.id });

      // Send the prompt via the existing sendMessage handler
      if (!this.sendMessageHandler) {
        throw new Error('sendMessageHandler not initialized');
      }

      const result = await this.sendMessageHandler(event, prompt, undefined, session.id, workspacePath);
      const response = result?.content || '';

      return { sessionId: session.id, response };
    });

    // Advance the FileSnapshotCache baseline after diff acceptance/rejection
    safeHandle('ai:advance-diff-baseline', async (_event, sessionId: string, filePath: string, content: string) => {
      this.advanceDiffBaseline(sessionId, filePath, content);
    });
  }

  private createToolHandler(webContents: Electron.WebContents, documentContext?: DocumentContext, sessionId?: string, workspaceId?: string): ToolHandler {
    const executor = new ToolExecutor(webContents, sessionId, workspaceId);

    // Capture targetFilePath from documentContext at message-send time
    // This prevents race conditions if user switches tabs while waiting for AI response
    const targetFilePath = documentContext?.filePath;

    const handler: ToolHandler = {
      applyDiff: async (args: DiffArgs): Promise<DiffResult> => {
        console.log(`[AIService] applyDiff called, targetFilePath from closure:`, targetFilePath);
        return executor.applyDiff({ ...args, targetFilePath });
      },
      streamContent: async (args: unknown): Promise<unknown> => {
        console.log(`[AIService] streamContent called, targetFilePath from closure:`, targetFilePath);
        return executor.streamContent({ ...(args as any), targetFilePath });
      },
      executeTool: async (name: string, args: unknown): Promise<unknown> => {
        // For tools that need targetFilePath, inject it from the closure
        if (name === 'streamContent' || name === 'applyDiff') {
          return executor.executeTool(name, { ...(args as any), targetFilePath });
        }
        return executor.executeTool(name, args);
      }
    };
    return handler;
  }

  private getNormalizedProviderSettings(): Record<string, any> {
    if (this.cachedNormalizedProviderSettings) {
      return this.cachedNormalizedProviderSettings;
    }
    const providerSettings = this.getSettingsStore().get('providerSettings', {}) as Record<string, any>;
    const normalized = this.normalizeProviderSettings(providerSettings);
    if (normalized !== providerSettings) {
      this.getSettingsStore().set('providerSettings', normalized);
    }
    this.cachedNormalizedProviderSettings = normalized;
    return normalized;
  }

  private normalizeProviderSettings(providerSettings: Record<string, any>): Record<string, any> {
    return normalizeCodexProviderConfig(
      stripTransientProviderFields(providerSettings)
    );
  }

  private normalizeProjectOverrides(overrides: any): any {
    if (!overrides || typeof overrides !== 'object') {
      return overrides;
    }

    const providers = overrides.providers;
    if (!providers || typeof providers !== 'object') {
      return overrides;
    }

    const normalizedProviders = normalizeCodexProviderConfig(providers);
    const codexConfig = normalizedProviders['openai-codex'];

    // Remove empty codex config
    if (codexConfig && Object.keys(codexConfig).length === 0) {
      const { 'openai-codex': _removed, ...restProviders } = normalizedProviders;
      if (Object.keys(restProviders).length === 0) {
        const { providers: _unusedProviders, ...restOverrides } = overrides;
        return Object.keys(restOverrides).length > 0 ? restOverrides : undefined;
      }
      return { ...overrides, providers: restProviders };
    }

    return { ...overrides, providers: normalizedProviders };
  }

  private getProviderSetting(provider: string, key: string): any {
    const providerSettings = this.getNormalizedProviderSettings() as any;
    return providerSettings[provider]?.[key];
  }

  private maskApiKey(key: string): string {
    if (!key || key.length <= 20) return key;
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  }

  private maskApiKeys(keys: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [provider, key] of Object.entries(keys)) {
      masked[provider] = this.maskApiKey(key);
    }
    return masked;
  }

  private inferWorktreePathFromFilePath(workspacePath: string, filePath: string): string | null {
    if (!workspacePath || !filePath) return null;
    const normalizedWorkspace = path.normalize(workspacePath);
    const normalizedFile = path.normalize(filePath);
    const worktreePrefix = `${normalizedWorkspace}_worktrees${path.sep}`;
    if (!normalizedFile.startsWith(worktreePrefix)) return null;

    const remainder = normalizedFile.slice(worktreePrefix.length);
    const worktreeName = remainder.split(path.sep)[0];
    if (!worktreeName || worktreeName.includes('..')) return null;

    const worktreePath = path.resolve(path.join(`${normalizedWorkspace}_worktrees`, worktreeName));
    if (!worktreePath.startsWith(worktreePrefix.slice(0, -1))) return null;
    return worktreePath;
  }

  private inferWorktreePathFromCommand(command: string | undefined, workspacePath: string): string | null {
    if (!command || !workspacePath) return null;
    const normalizedWorkspace = path.normalize(workspacePath);
    const worktreePrefix = `${normalizedWorkspace}_worktrees${path.sep}`;
    const normalizedCommand = command.replace(/\\/g, path.sep);
    const idx = normalizedCommand.indexOf(worktreePrefix);
    if (idx === -1) return null;

    const after = normalizedCommand.slice(idx + worktreePrefix.length);
    const worktreeName = after.split(/[\s'"\r\n\\/]/)[0];
    if (!worktreeName || worktreeName.includes('..')) return null;

    const result = path.resolve(path.join(`${normalizedWorkspace}_worktrees`, worktreeName));
    if (!result.startsWith(worktreePrefix.slice(0, -1))) return null;
    return result;
  }

  private async ensureCodexSessionWatcher(
    sessionId: string,
    workspacePath: string,
    event: Electron.IpcMainInvokeEvent
  ): Promise<void> {
    // Cancel any pending delayed-stop timer so it doesn't destroy the watcher
    // we're about to reuse (race: new turn starts within the 500ms drain delay).
    const pendingTimer = this.codexStopTimers.get(sessionId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.codexStopTimers.delete(sessionId);
    }

    const existing = this.codexSessionWatchers.get(sessionId);
    if (existing && existing.workspacePath === workspacePath) {
      return;
    }

    if (existing) {
      try {
        await existing.watcher.stop();
        existing.cache.stopSession();
      } catch (error) {
        logger.main.error('[AIService] Failed to stop existing Codex file watcher:', error);
      }
      this.codexSessionWatchers.delete(sessionId);
    }

    const cache = new FileSnapshotCache();
    const watcher = new SessionFileWatcher();
    await cache.startSession(workspacePath, sessionId);

    // Seed the cache with current disk content for files that have prior tags
    // from this session but aren't in the cache (e.g., gitignored files).
    // Without this, the proactive file_change handler would fall through to
    // recoverBaselineFromHistory and potentially use a stale pre-edit baseline.
    try {
      const taggedFiles = await historyManager.getTaggedFilesForSession(workspacePath, sessionId);
      const MAX_SEED_FILES = 50;
      let seeded = 0;
      for (const filePath of taggedFiles) {
        if (seeded >= MAX_SEED_FILES) break;
        const existing = await cache.getBeforeState(filePath);
        if (existing !== null) continue; // already in cache (e.g., dirty tracked file)
        const content = await readFileContentOrNull(filePath);
        if (content !== null) {
          cache.updateSnapshot(filePath, content);
          seeded++;
        }
      }
      if (seeded > 0) {
        logger.main.info('[AIService] Seeded cache with historical files:', { sessionId, seeded, total: taggedFiles.length });
      }
    } catch (seedError) {
      logger.main.warn('[AIService] Failed to seed cache with historical files:', seedError);
    }

    await watcher.start(
      workspacePath,
      sessionId,
      cache,
      async (watchEvent) => {
        workspaceFileEditAttributionService.ingestWatcherEvent({
          workspacePath: watchEvent.workspacePath,
          filePath: watchEvent.filePath,
          timestamp: watchEvent.timestamp,
          beforeContent: watchEvent.beforeContent,
        });
        safeSend(event, 'session-files:updated', sessionId);
      }
    );
    this.codexSessionWatchers.set(sessionId, { cache, watcher, workspacePath });
    // logger.main.info('[AIService] Started Codex file watcher for session:', sessionId, { workspacePath });
  }

  /**
   * Advance the FileSnapshotCache baseline for a file after a diff is accepted/rejected.
   * This ensures subsequent AI edits use the post-review content as the diff baseline,
   * preventing "baseline drift" where already-accepted changes reappear in future diffs.
   */
  advanceDiffBaseline(sessionId: string, filePath: string, content: string): void {
    const entry = this.codexSessionWatchers.get(sessionId);
    if (!entry) {
      // Watcher may have been stopped between turns — not an error
      return;
    }
    entry.cache.updateSnapshot(filePath, content);
    logger.main.debug('[AIService] Advanced diff baseline:', { sessionId, filePath, contentLength: content.length });
  }

  private async adoptWorktreeForSession(
    session: SessionData,
    worktreePath: string,
    event: Electron.IpcMainInvokeEvent
  ): Promise<void> {
    if (!worktreePath || session.worktreePath === worktreePath) {
      return;
    }

    const worktreeProjectPath = resolveProjectPath(worktreePath);
    const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
    await AISessionsRepository.updateMetadata(session.id, {
      worktreePath,
      worktreeProjectPath,
    });

    session.worktreePath = worktreePath;
    session.worktreeProjectPath = worktreeProjectPath;
    await this.ensureCodexSessionWatcher(session.id, worktreePath, event);

    logger.main.info('[AIService] Adopted worktree path for session:', {
      sessionId: session.id,
      worktreePath,
      worktreeProjectPath,
    });
  }

  private async extractFilePathsFromCommand(command: string, workspacePath: string, cwd: string): Promise<string[]> {
    const results = new Set<string>();
    const normalizedCommand = command.replace(/\\/g, path.sep);

    const resolveAndCheck = async (candidate: string): Promise<void> => {
      try {
        // Resolve symlinks so boundary check cannot be bypassed via symlinks
        const realPath = await fs.promises.realpath(candidate);
        if (isFileInWorkspaceOrWorktree(realPath, workspacePath)) {
          results.add(realPath);
        }
      } catch {
        // File does not exist or is inaccessible - skip
      }
    };

    const candidates: string[] = [];

    const absoluteMatches = [
      ...(normalizedCommand.match(/\/[^\s'"]+/g) || []),
      ...(normalizedCommand.match(/[A-Za-z]:[\\\/][^\s'"]+/g) || []),
    ];
    for (const raw of absoluteMatches) {
      const cleaned = raw.replace(/[);:,]+$/, '');
      if (!cleaned) continue;
      candidates.push(path.normalize(cleaned));
    }

    const tokens = normalizedCommand.split(/\s+/);
    for (const token of tokens) {
      if (!token) continue;
      const cleaned = token.replace(/^['"]|['"]$/g, '').replace(/[);:,]+$/, '');
      if (!cleaned || path.isAbsolute(cleaned)) continue;
      if (!cleaned.includes(path.sep) && !cleaned.includes('/')) continue;
      candidates.push(path.normalize(path.resolve(cwd, cleaned)));
    }

    await Promise.all(candidates.map(c => resolveAndCheck(c)));
    return [...results];
  }

  private async trackBashFileEditsFromCommand(
    session: SessionData,
    workspacePath: string,
    command: string,
    commandItemId?: string
  ): Promise<boolean> {
    const effectivePath = session.worktreePath || workspacePath;
    const watcherEntry = this.codexSessionWatchers.get(session.id);
    const filePaths = await this.extractFilePathsFromCommand(command, workspacePath, effectivePath);
    if (filePaths.length === 0) return false;

    let trackedAny = false;

    // Register gitignore bypass for Bash-edited files so watcher events fire
    for (const fp of filePaths) {
      addGitignoreBypass(effectivePath, fp);
    }

    for (const filePath of filePaths) {
      try {
        await fs.promises.access(filePath);
        if (isBinaryFile(filePath)) continue;
      } catch {
        // File does not exist - proceed (it may be a new file)
      }

      const currentContentResult = await readFileContentOrNull(filePath);
      if (currentContentResult === null) {
        logger.main.warn('[AIService] Failed to read current Bash content:', {
          sessionId: session.id,
          filePath,
        });
        continue;
      }
      const currentContent = currentContentResult;

      const pendingTags = await historyManager.getPendingTags(filePath);
      const existingTag = pendingTags?.find(t => t.sessionId === session.id);
      if (existingTag && existingTag.content.length > 0) {
        // Tag already exists with real content - nothing to do
        watcherEntry?.cache.updateSnapshot(filePath, currentContent);
        continue;
      }

      let beforeContent: string | null = null;

      // Prefer the same cache/history baseline strategy as file_change tracking.
      // This avoids whole-file green diffs for gitignored/untracked bash edits.
      if (watcherEntry) {
        try {
          beforeContent = await watcherEntry.cache.getBeforeState(filePath);
        } catch {
          // Best-effort; we'll continue with history/git fallbacks.
        }
      }

      if (beforeContent === null) {
        const recoveredBaseline = await recoverBaselineFromHistory(filePath, currentContent);
        if (recoveredBaseline !== null) {
          beforeContent = recoveredBaseline;
        }
      }

      // Last-resort fallback to git HEAD when cache/history are unavailable.
      if (beforeContent === null) {
        try {
          const relativePath = path.relative(effectivePath, filePath);
          if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath) && !relativePath.startsWith(':')) {
            const { stdout } = await execFileAsync(
              'git',
              ['show', `HEAD:${relativePath}`],
              { cwd: effectivePath, encoding: 'utf-8' }
            );
            beforeContent = stdout;
          }
        } catch {
          // File may be untracked/new. Keep null and fall back to empty baseline.
        }
      }

      const resolvedBeforeContent = beforeContent ?? '';

      // If baseline equals current content, command did not materially change this file.
      if (resolvedBeforeContent === currentContent) {
        watcherEntry?.cache.updateSnapshot(filePath, currentContent);
        continue;
      }

      // If an existing tag with empty content was found earlier, upgrade it
      // instead of creating a new tag (defense-in-depth for Fix 2)
      if (existingTag && existingTag.content.length === 0 && resolvedBeforeContent.length > 0) {
        await historyManager.createTag(
          filePath,
          existingTag.id,
          resolvedBeforeContent,
          session.id,
          existingTag.toolUseId,
        );
        logger.main.info('[AIService] Upgraded empty bash tag with baseline:', {
          sessionId: session.id, filePath, tagId: existingTag.id,
        });
        watcherEntry?.cache.updateSnapshot(filePath, currentContent);
        continue;
      }

      const toolUseId = commandItemId || `codex-bash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tagId = `ai-edit-pending-${session.id}-${toolUseId}`;

      await historyManager.createTag(
        filePath,
        tagId,
        resolvedBeforeContent,
        session.id,
        toolUseId
      );

      await SessionFilesRepository.addFileLink({
        sessionId: session.id,
        workspaceId: effectivePath,
        filePath,
        linkType: 'edited',
        timestamp: Date.now(),
        metadata: {
          toolName: 'Bash',
          operation: 'bash',
          toolUseId,
          bashCommand: command.slice(0, 500),
        },
      });
      watcherEntry?.cache.updateSnapshot(filePath, currentContent);
      trackedAny = true;
    }

    return trackedAny;
  }

  private async stopCodexSessionWatcher(sessionId: string): Promise<void> {
    // Clear any pending delayed-stop timer (belt-and-suspenders)
    const pendingTimer = this.codexStopTimers.get(sessionId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.codexStopTimers.delete(sessionId);
    }

    const entry = this.codexSessionWatchers.get(sessionId);
    if (entry) {
      try {
        await entry.watcher?.stop();
        entry.cache.stopSession();
        this.codexSessionWatchers.delete(sessionId);
        // logger.main.info('[AIService] Stopped Codex file watcher for session:', sessionId);
      } catch (error) {
        logger.main.error('[AIService] Error stopping Codex file watcher:', error);
        this.codexSessionWatchers.delete(sessionId);
      }
    }
  }

  public destroy() {
    try {
      // Clean up all providers with error handling
      ProviderFactory.destroyAll();
    } catch (error) {
      console.error('[AIService] Error destroying providers:', error);
      // Continue destruction even if providers fail
    }

    // Cancel all pending delayed-stop timers
    for (const timer of this.codexStopTimers.values()) {
      clearTimeout(timer);
    }
    this.codexStopTimers.clear();

    // Stop all Codex file watchers
    for (const [sessionId, entry] of this.codexSessionWatchers) {
      try {
        entry.watcher?.stop();
        entry.cache.stopSession();
      } catch (error) {
        console.error(`[AIService] Error stopping Codex watcher for ${sessionId}:`, error);
      }
    }
    this.codexSessionWatchers.clear();

    // Clear any pending match debounce timers
    for (const timer of this.matchDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.matchDebounceTimers.clear();

    // Clear any remaining references
    try {
      this.sessionManager = null as any;
      this.settingsStore = null;
    } catch (error) {
      console.error('[AIService] Error clearing references:', error);
    }
  }
}
