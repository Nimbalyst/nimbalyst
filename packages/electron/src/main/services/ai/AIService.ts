/**
 * Main AI service that coordinates providers and sessions
 */

import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { SessionManager, ProviderFactory, ModelRegistry, AIProvider } from '@nimbalyst/runtime/ai/server';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { parseContextUsageMessage } from '@nimbalyst/runtime/ai/server/utils/contextUsage';
import type { SessionStore } from '@nimbalyst/runtime';
import type {
  DocumentContext,
  Message,
  ProviderConfig,
  ToolHandler,
  DiffArgs,
  DiffResult,
  AIProviderType,
  AIModel,
  SessionData,
} from '@nimbalyst/runtime/ai/server/types';
// MCP imports removed - no longer using MCP HTTP server
import { ToolExecutor, toolRegistry, BUILT_IN_TOOLS } from './tools';
import { SoundNotificationService } from '../SoundNotificationService';
import { notificationService } from '../NotificationService';
import { logger } from '../../utils/logger';
import { windowStates, findWindowByWorkspace } from '../../window/WindowManager';
import { sessionFileTracker } from '../SessionFileTracker';
import {AnalyticsService} from "../analytics/AnalyticsService.ts";
import { historyManager } from '../../HistoryManager';
import { getAIProviderOverrides, saveAIProviderOverrides, clearAIProviderOverrides, getWorkspaceState } from '../../utils/store';
import { mergeAISettings } from '../../utils/aiSettingsMerge';
import { ALL_PACKAGES } from '../../../shared/toolPackages';
import { getMessageSyncHandler, getSyncProvider } from '../SyncManager';
import * as fs from 'fs';
import * as path from 'path';

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
 * Detect if a message starts with a Nimbalyst package slash command.
 * Returns command info if found, null otherwise.
 */
function detectNimbalystSlashCommand(
  message: string,
  workspacePath: string | undefined
): { commandName: string; packageId: string } | null {
  // Message must start with a slash command
  const trimmedMessage = message.trim();
  if (!trimmedMessage.startsWith('/')) {
    return null;
  }

  // Extract the command name (everything after / until whitespace or end)
  const commandMatch = trimmedMessage.match(/^\/([^\s]+)/);
  if (!commandMatch) {
    return null;
  }
  const commandName = commandMatch[1];

  // Get installed packages for this workspace
  let installedPackageIds: string[] = [];
  if (workspacePath) {
    try {
      const workspaceState = getWorkspaceState(workspacePath);
      installedPackageIds = (workspaceState.installedPackages || [])
        .filter(pkg => pkg.enabled !== false)
        .map(pkg => pkg.packageId);
    } catch (error) {
      // Workspace state not available, check all packages
      installedPackageIds = ALL_PACKAGES.map(pkg => pkg.id);
    }
  } else {
    // No workspace, check all packages
    installedPackageIds = ALL_PACKAGES.map(pkg => pkg.id);
  }

  // Find the package that contains this command
  for (const pkg of ALL_PACKAGES) {
    // Only check installed packages
    if (!installedPackageIds.includes(pkg.id)) {
      continue;
    }

    for (const cmd of pkg.customCommands) {
      if (cmd.name === commandName) {
        return { commandName, packageId: pkg.id };
      }
    }
  }

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

      // Check file size
      const stats = fs.statSync(resolvedPath);
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
  // Store reference to sendMessage handler for queue processing
  private sendMessageHandler: ((event: Electron.IpcMainInvokeEvent, message: string, documentContext?: DocumentContext, sessionId?: string, workspacePath?: string) => Promise<{ content: string }>) | null = null;
  // NOTE: Providers are now tracked per-session in ProviderFactory, not per-window
  // This allows multiple concurrent sessions in the same window (e.g., agent mode tabs)

  // Track queued prompt IDs currently being processed to prevent duplicate execution
  // This is a backup to the atomic database claim - catches cases where claim succeeds
  // but the same prompt ID is somehow passed to sendMessage twice
  private processingQueuedPromptIds = new Set<string>();

  constructor(sessionStore: SessionStore) {
    logger.main.info('[AIService] Constructor called');
    this.sessionManager = new SessionManager(sessionStore);

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
    // console.log('[AIService] Registering built-in tools...');
    for (const tool of BUILT_IN_TOOLS) {
      toolRegistry.register(tool);
      // console.log(`[AIService] Registered tool: ${tool.name}`);
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
          // console.log('Initializing API key from environment variable');
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
      case 'claude-code':
        return globalApiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
      case 'openai':
      case 'openai-codex':
        return globalApiKeys['openai'] || process.env.OPENAI_API_KEY;
      case 'lmstudio':
        return 'not-required';
      default:
        return globalApiKeys[provider];
    }
  }

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

  private async initializeMobileSyncHandler() {
    // Listen for index changes from mobile sync and insert queuedPrompts into the database.
    // The renderer's processQueuedPrompts function handles execution from the database queue.
    // Both local queuing (via ai:createQueuedPrompt) and mobile sync use the same database queue.

    const maxRetries = 5;
    const retryDelayMs = 1000;

    logger.main.info('[AIService] Initializing mobile sync handler (metadata sync only)...');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { getSyncProvider } = await import('../SyncManager');
        const syncProvider = getSyncProvider();

        if (!syncProvider) {
          if (attempt < maxRetries) {
            logger.main.info(`[AIService] Sync not ready yet, retrying in ${retryDelayMs}ms (attempt ${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            continue;
          }
          logger.main.info('[AIService] Sync not enabled after retries, mobile sync handler not initialized');
          return;
        }

        // Listen for index changes and insert queued prompts into the queued_prompts table
        if (syncProvider.onIndexChange) {
          syncProvider.onIndexChange(async (sessionId, entry) => {
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
                    // TODO: Handle attachments and documentContext when mobile supports them
                  });
                  newPromptsCount++;
                }

                if (newPromptsCount === 0) {
                  logger.main.info('[AIService] No new prompts to process, all already exist');
                  return;
                }

                logger.main.info(`[AIService] Inserted ${newPromptsCount} new prompts into queued_prompts table`);

                // Load session to get its workspacePath
                const session = await this.sessionManager.loadSession(sessionId);
                if (!session) {
                  logger.main.warn('[AIService] Session not found for queuedPrompts:', sessionId);
                  return;
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
                  } else {
                    logger.main.warn('[AIService] No window found for workspace:', session.workspacePath);
                  }
                } else {
                  // Fallback: if no workspacePath, send to first window (legacy behavior)
                  logger.main.warn('[AIService] Session has no workspacePath, sending to first window');
                  const { BrowserWindow } = await import('electron');
                  const windows = BrowserWindow.getAllWindows();
                  if (windows.length > 0) {
                    windows[0].webContents.send('ai:queuedPromptsReceived', {
                      sessionId,
                      promptCount: newPromptsCount
                    });
                  }
                }
              } catch (err) {
                logger.main.error('[AIService] Failed to insert queuedPrompts into table:', err);
              }
            }
          });

          logger.main.info('[AIService] Mobile sync handler initialized (using queued_prompts table)');
        } else {
          logger.main.info('[AIService] onIndexChange not available, mobile sync handler not initialized');
        }

        return;
      } catch (error) {
        logger.main.error('[AIService] Failed to initialize mobile sync handler:', error);
        return;
      }
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
        event.sender.send(`ai:auto-context-${phase}`, {
          sessionId: session.id
        });
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
            // Get current session to preserve inputTokens/outputTokens from modelUsage
            // The /context command only gives us totalTokens (context window usage),
            // not the actual input/output breakdown which comes from modelUsage
            const currentSession = await this.sessionManager.loadSession(session.id, workspacePath);
            const currentUsage = currentSession?.tokenUsage;

            const tokenUsage = {
              // Preserve input/output tokens from modelUsage (set earlier in the response)
              inputTokens: currentUsage?.inputTokens ?? 0,
              outputTokens: currentUsage?.outputTokens ?? 0,
              // Use totalTokens from /context (represents current context window usage)
              totalTokens: parsedUsage.totalTokens,
              contextWindow: parsedUsage.contextWindow,
              categories: parsedUsage.categories,
              // Preserve cost and web search data from modelUsage
              costUSD: currentUsage?.costUSD,
              webSearchRequests: currentUsage?.webSearchRequests
            };

            // Persist token usage to session metadata
            await this.sessionManager.updateSessionTokenUsage(session.id, tokenUsage);

            // Also send IPC event to update UI immediately
            event.sender.send('ai:tokenUsageUpdated', {
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
    ipcMain.handle('ai:hasApiKey', async () => {  // Keeping the name for backward compatibility
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;

      // Check Claude/Claude Code (needs API key)
      const hasAnthropicKey = !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY);
      if (hasAnthropicKey) {
        // Claude Code is always available with API key
        // Regular Claude needs to be enabled with models
        const hasClaudeCode = true; // Always available with key
        const hasClaude = providerSettings['claude']?.enabled &&
                         providerSettings['claude']?.models?.length > 0;
        if (hasClaudeCode || hasClaude) return true;
      }

      // Check OpenAI (needs API key and enabled models)
      const hasOpenAIKey = !!(apiKeys['openai'] || process.env.OPENAI_API_KEY);
      if (hasOpenAIKey) {
        const hasOpenAI = providerSettings['openai']?.enabled &&
                         providerSettings['openai']?.models?.length > 0;
        if (hasOpenAI) return true;
      }

      // Check LM Studio (doesn't need API key but needs enabled models)
      const hasLMStudio = providerSettings['lmstudio']?.enabled === true &&
                         providerSettings['lmstudio']?.models?.length > 0;
      if (hasLMStudio) return true;

      return false;
    });

    // Initialize/configure AI
    ipcMain.handle('ai:initialize', async (event, provider?: string, apiKey?: string) => {
      if (apiKey) {
        // Save API key - always save as 'anthropic' since both providers use the same key
        const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
        apiKeys['anthropic'] = apiKey;
        this.getSettingsStore().set('apiKeys', apiKeys);
      }

      return { success: true };
    });

    // Create new session with provider and model selection
    ipcMain.handle('ai:createSession', async (
      event,
      provider: AIProviderType,
      documentContext?: DocumentContext,
      workspacePath?: string,
      modelId?: string,
      sessionType?: 'chat' | 'planning' | 'coding'
    ) => {
      // TODO: Debug logging - uncomment if needed
      // console.log('[AIService] ai:createSession called:', {
      //   provider,
      //   modelId,
      //   hasDocumentContext: !!documentContext,
      //   workspacePath,
      //   sessionType
      // });

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
        case 'openai-codex':
          if (!apiKey) {
            throw new Error('OpenAI API key not configured');
          }
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
        if (provider === 'claude-code') {
          providerConfig.model = model;
        } else if (model.includes(':')) {
          providerConfig.model = model.split(':').slice(1).join(':');
        } else {
          providerConfig.model = model;
        }
      } else if (provider !== 'claude-code') {
        // For other providers, fall back to settings
        const settingsModel = this.getProviderSetting(provider, 'model');
        if (settingsModel && settingsModel.includes(':')) {
          providerConfig.model = settingsModel.split(':').slice(1).join(':');
        } else {
          providerConfig.model = settingsModel;
        }
      }

      // Create session
      const session = await this.sessionManager.createSession(
        provider,
        documentContext,
        workspacePath,
        providerConfig,
        model,
        sessionType || 'chat' // Default to 'chat' if not specified
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

      // Only add model if it exists and provider isn't claude-code or openai-codex
      // Both claude-code and openai-codex manage their own model selection
      if (session.providerConfig?.model && provider !== 'openai-codex') {
        initConfig.model = session.providerConfig.model;
      }

      // Add LMStudio-specific config
      if (provider === 'lmstudio') {
        const lmstudioSettings = this.getSettingsStore().get('providerSettings.lmstudio', {}) as any;
        const storedApiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
        initConfig.baseUrl = lmstudioSettings.baseUrl || storedApiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
      }

      // Pass through allowedTools setting for Claude Code if configured
      if (provider === 'claude-code') {
        const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
        if (providerSettings?.['claude-code']?.allowedTools) {
          initConfig.allowedTools = providerSettings['claude-code'].allowedTools;
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

      this.analytics.sendEvent('create_ai_session', { provider });
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
      const attachments = (documentContext as any)?.attachments;
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
        // console.log(`[AIService] Got workspace path from window ${event.sender.id}:`, workspacePath);
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

      // console.log(`[AIService] Loaded session ${sessionId} with provider: ${session.provider}, model: ${session.model} (took ${perfLog.sessionLoadTime}ms)`);

      // Verify we got the right session
      if (session.id !== sessionId) {
        console.error(`[AIService] CRITICAL ERROR: Requested session ${sessionId} but got session ${session.id}!`);
        throw new Error(`Session mismatch: requested ${sessionId} but got ${session.id}`);
      }

      // Comprehensive logging of what we're sending to Claude
      // console.group('🤖 [AIService] Sending message to AI provider');
      // console.log('📝 User Message:', message);
      // console.log('🏢 Provider:', session.provider);
      // console.log('🤖 Model:', session.model || 'default');
      // console.log('📄 Document Context:', {
      //   hasDocument: !!documentContext,
      //   filePath: documentContext?.filePath || 'none',
      //   fileType: documentContext?.fileType || 'none',
      //   contentLength: documentContext?.content?.length || 0,
      // });

      if (documentContext?.content) {
        // console.log('📋 Document Content Preview (first 500 chars):',
        //   documentContext.content.substring(0, 500) +
        //   (documentContext.content.length > 500 ? '...' : ''));

        // Check for frontmatter
        const frontmatterMatch = documentContext.content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          // console.log('🏷️ Document Frontmatter:', frontmatterMatch[1]);
        } else {
          // console.log('⚠️ No frontmatter found in document');
        }
      }

      // Show available tools
      const tools = toolRegistry.getAll();
      // console.log('🔧 Available Tools:', tools.map(t => t.name));
      console.groupEnd();

      perfLog.provider = session.provider;
      perfLog.model = session.model || 'default';

      // Add user message to session (include attachments if present)
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: attachments && attachments.length > 0 ? attachments : undefined
      };
      await this.sessionManager.addMessage(userMessage, session.id);

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
      //   console.log('[CLAUDE-CODE-SERVICE] Getting provider for claude-code, session:', session.id);
      // }

      // console.log(`[AIService] Getting provider for: ${session.provider}, sessionId: ${session.id}`);
      let provider = ProviderFactory.getProvider(session.provider as AIProviderType, session.id);
      perfLog.getProviderTime = Date.now() - providerStartTime;

      // If provider doesn't exist, create and initialize it
      if (!provider) {
        if (isProviderClaudeCode) {
          // console.log('[CLAUDE-CODE-SERVICE] Provider not found, creating new claude-code provider');
        }
        // console.log(`[AIService] Provider not found, creating new ${session.provider} provider`);
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
          case 'openai-codex':
            apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;
            errorMessage = 'OpenAI API key not configured';
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
          // console.log('[CLAUDE-CODE-SERVICE] Creating claude-code provider instance');
        }
        provider = ProviderFactory.createProvider(session.provider, session.id);

        if (isProviderClaudeCode) {
          // console.log('[CLAUDE-CODE-SERVICE] Provider instance created, preparing config');
        }

        const reinitConfig: any = {
          apiKey,
          maxTokens: (session.providerConfig as any)?.maxTokens,
          temperature: (session.providerConfig as any)?.temperature
        };

        // Add baseUrl for LMStudio
        if (session.provider === 'lmstudio') {
          reinitConfig.baseUrl = apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
        }

        // Only add model if it exists (openai-codex manages selection itself)
        if ((session.model || session.providerConfig?.model) && session.provider !== 'openai-codex') {
          const fullModel = session.model || session.providerConfig?.model;
          // console.log('[AIService] Reinitializing provider with model:', {
          //   sessionModel: session.model,
          //   providerConfigModel: session.providerConfig?.model,
          //   fullModel,
          //   provider: session.provider
          // });

          if (fullModel) {
            if (session.provider === 'claude-code') {
              reinitConfig.model = fullModel;
            } else if (fullModel.includes(':')) {
              reinitConfig.model = fullModel.split(':').slice(1).join(':');
              // console.log('[AIService] Stripped model prefix:', {
              //   original: fullModel,
              //   stripped: reinitConfig.model
              // });
            } else {
              reinitConfig.model = fullModel;
            }
          }
        }

        if (isProviderClaudeCode) {
          const safeConfig = { ...reinitConfig, apiKey: reinitConfig.apiKey ? '***' : undefined };
          // console.log('[CLAUDE-CODE-SERVICE] About to initialize claude-code provider with config:', JSON.stringify(safeConfig, null, 2));
        }
        const safeConfig = { ...reinitConfig, apiKey: reinitConfig.apiKey ? '***' : undefined };
        // console.log('[AIService] About to initialize provider with config:', JSON.stringify(safeConfig, null, 2));
        const initStartTime = Date.now();

        try {
          await provider.initialize(reinitConfig);
          perfLog.providerInitTime = Date.now() - initStartTime;

          if (isProviderClaudeCode) {
            // console.log(`[CLAUDE-CODE-SERVICE] Provider initialization completed in ${perfLog.providerInitTime}ms`);
          }
          // console.log(`[AIService] Provider initialization took ${perfLog.providerInitTime}ms`);
        } catch (initError) {
          if (isProviderClaudeCode) {
            console.error('[CLAUDE-CODE-SERVICE] Failed to initialize provider:', initError);
            console.error('[CLAUDE-CODE-SERVICE] Init config was:', reinitConfig);
          }
          throw initError;
        }

        // CRITICAL: Restore provider session data from database
        // This is essential for session resumption (e.g., Claude Code sessions)
        if (session.providerSessionId && provider.setProviderSessionData) {
          // console.log(`[AIService] Restoring provider session data for ${session.provider}`);
          provider.setProviderSessionData(session.id, { claudeSessionId: session.providerSessionId });
        }

        // Register tool handler - targetFilePath will be determined dynamically per tool call
        const toolHandler = this.createToolHandler(event.sender, documentContext, session.id, workspacePath);
        provider.registerToolHandler(toolHandler);
      }

      // NOTE: No longer tracking provider per-window - each session has its own provider instance
      // console.log(`[AIService] Using provider for session ${session.id}: ${session.provider}`);

      // Re-register tool handler with the CURRENT document context from this message
      // This ensures applyDiff targets the correct file even when switching tabs
      // console.log(`[AIService] Re-registering tool handler with document context:`, {
      //   filePath: documentContext?.filePath,
      //   hasContext: !!documentContext
      // });
      const toolHandler = this.createToolHandler(event.sender, documentContext, session.id, workspacePath);
      provider.registerToolHandler(toolHandler);

      // Listen for message:logged events and forward to renderer to trigger UI updates
      // Skip hidden messages - they shouldn't trigger UI refreshes
      const onMessageLogged = (data: { sessionId: string; direction: string; hidden?: boolean }) => {
        if (data.hidden) return;
        event.sender.send('ai:message-logged', data);
      };
      // Remove all previous listeners to avoid duplicates
      provider.removeAllListeners('message:logged');
      provider.on('message:logged', onMessageLogged);

      // Listen for ExitPlanMode confirmation requests and forward to renderer
      const onExitPlanModeConfirm = (data: { requestId: string; sessionId: string; planSummary: string; timestamp: number }) => {
        logger.main.info('[AIService] ExitPlanMode confirmation requested:', data.requestId);
        event.sender.send('ai:exitPlanModeConfirm', data);
      };
      provider.removeAllListeners('exitPlanMode:confirm');
      provider.on('exitPlanMode:confirm', onExitPlanModeConfirm);

      // Track user @ mentions in the message
      try {
        await sessionFileTracker.trackUserMessage(
          session.id,
          workspacePath,
          message,
          session.messages.length // Current message index
        );
        // Notify renderer that files were tracked (if message had @ mentions)
        if (message.includes('@')) {
          event.sender.send('session-files:updated', session.id);
        }
      } catch (error) {
        logger.main.warn('[AIService] Failed to track user @ mentions:', error);
      }

      // Track ai_message_sent analytics event
      const slashCommandInfo = detectNimbalystSlashCommand(message, workspacePath);
      this.analytics.sendEvent('ai_message_sent', {
        provider: session.provider,
        hasDocumentContext: !!documentContext,
        hasAttachments: !!(attachments && attachments.length > 0),
        attachmentCount: attachments?.length || 0,
        messageLength: bucketMessageLength(message.length),
        // Slash command tracking - only included if a Nimbalyst package command was used
        ...(slashCommandInfo && {
          usedSlashCommand: true,
          slashCommandName: slashCommandInfo.commandName,
          slashCommandPackageId: slashCommandInfo.packageId,
        }),
      });

      // Mark session as running/active
      const stateManager = getSessionStateManager();
      let autoContextPromise: Promise<void> | null = null;
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
        const toolCalls: any[] = [];
        const edits: any[] = [];  // Track edits for the assistant message
        let hasStreamingContent = false;  // Track if we used streamContent tool
        let firstChunkTime: number | undefined;
        let chunkCount = 0;
        let textChunks = 0;
        let toolCallCount = 0;

        // Get existing messages from session for context
        const sessionMessages = session.messages || [];

        // console.log(`[AIService] Starting message stream (${sessionMessages.length} context messages)`);
        const streamStartTime = Date.now();

        // Send performance metrics to renderer
        event.sender.send('ai:performanceMetrics', {
          phase: 'start',
          provider: session.provider,
          model: session.model || 'default',
          messageLength: message.length,
          contextMessages: sessionMessages.length
        });

        // Stream the response
        const isClaudeCode = session.provider === 'claude-code';
        const logPrefix = isClaudeCode ? '[CLAUDE-CODE-SERVICE]' : '[AIService]';
        // console.log(`🚀 ${logPrefix} Starting to stream response from provider: ${session.provider}`);

        if (isClaudeCode) {
          // console.log(`[CLAUDE-CODE-SERVICE] Calling sendMessage with:`, JSON.stringify({
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

        // Add sessionType, mode, and attachments to documentContext for provider to use in system prompt
        const contextWithSession = documentContext ? {
          ...documentContext,
          sessionType: (documentContext as any)?.sessionType ?? session.sessionType,
          mode: (documentContext as any)?.mode ?? session.mode,
          attachments
        } as any : { sessionType: session.sessionType, mode: session.mode, attachments } as any;

        for await (const chunk of provider.sendMessage(messageToSend, contextWithSession, session.id, sessionMessages, workspacePath, attachments)) {
          if (!chunk) continue;
          chunkCount++;

          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            perfLog.timeToFirstChunk = firstChunkTime - startTime;
            // console.log(`${logPrefix} First chunk received after ${perfLog.timeToFirstChunk}ms`);

            // Send first chunk metrics
            event.sender.send('ai:performanceMetrics', {
              phase: 'firstChunk',
              timeToFirstChunk: perfLog.timeToFirstChunk
            });
          }
          switch (chunk.type) {
            case 'text':
              textChunks++;
              const chunkContent = chunk.content || '';
              fullResponse += chunkContent;

              // Update activity to indicate streaming
              if (textChunks === 1) {
                await stateManager.updateActivity({
                  sessionId: session.id,
                  isStreaming: true
                });
              }
              // if (isClaudeCode && textChunks <= 5) {
              //   console.log(`[CLAUDE-CODE-SERVICE] Text chunk #${textChunks}: ${chunkContent.length} chars, first 100:`, chunkContent.substring(0, 100));
              // }
              // console.log(`${logPrefix} Forwarding text chunk #${textChunks}: ${chunkContent.length} chars, total: ${fullResponse.length}`);
              // Send ACCUMULATED response to renderer (not just the chunk)
              event.sender.send('ai:streamResponse', {
                sessionId: session.id,
                partial: fullResponse,  // Send the full accumulated text
                isComplete: false
              });
              break;

            case 'tool_call':
              if (chunk.toolCall) {
                toolCallCount++;
                toolCalls.push(chunk.toolCall);
                // console.group('🔨 [AIService] Tool call received from AI');
                // console.log('Tool name:', chunk.toolCall.name);
                // console.log('Tool arguments:', chunk.toolCall.arguments);
                console.groupEnd();
                // console.log(`[AIService] Tool call #${toolCallCount}: ${chunk.toolCall.name}`);
                // console.log(`[AIService] Tool arguments:`, JSON.stringify(chunk.toolCall.arguments, null, 2));

                // Track file interactions for all tool calls
                if (workspacePath && chunk.toolCall.arguments) {
                  try {
                    await sessionFileTracker.trackToolExecution(
                      session.id,
                      workspacePath,
                      chunk.toolCall.name,
                      chunk.toolCall.arguments,
                      chunk.toolCall.result
                    );
                    // Notify renderer that files were tracked
                    event.sender.send('session-files:updated', session.id);
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

                // Save tool call as a separate message in the session
                const toolResult = chunk.toolCall.result as any;
                const isFailedResult = toolResult?.success === false;

                if (!isFailedResult) {
                  const toolMessage: Message = {
                    role: 'tool',
                    content: '',  // Tool messages don't have text content
                    timestamp: Date.now(),
                    toolCall: chunk.toolCall,
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
                    replacements: chunk.toolCall.arguments.replacements,
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

                  event.sender.send('ai:streamResponse', {
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
                  event.sender.send('ai:streamResponse', {
                    sessionId: session.id,
                    partial: '',
                    isComplete: false,
                    toolCalls: [chunk.toolCall]
                  });
                } else {
                  // For other tools, just send the tool call
                  event.sender.send('ai:streamResponse', {
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
                    arguments: chunk.toolError.arguments,
                    result: chunk.toolError.result
                  },
                  isError: true,
                  errorMessage: chunk.toolError.error
                };
                await this.sessionManager.addMessage(errorMessage, session.id);

                event.sender.send('ai:streamResponse', {
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
              // console.log('[AIService] Forwarding stream_edit_start to renderer:', chunk.config);
              event.sender.send('ai:streamEditStart', {
                sessionId: session.id,
                targetFilePath: documentContext?.filePath,
                ...chunk.config
              });
              hasStreamingContent = true;  // Mark that we're doing streaming
              break;

            case 'stream_edit_content':
              // Forward streaming content to renderer
              // console.log('[AIService] Forwarding stream_edit_content to renderer:', chunk.content?.substring(0, 50));
              event.sender.send('ai:streamEditContent', {
                sessionId: session.id,
                content: chunk.content
              });
              break;

            case 'stream_edit_end':
              // Forward streaming end event to renderer
              // console.log('[AIService] Forwarding stream_edit_end to renderer');
              event.sender.send('ai:streamEditEnd', {
                sessionId: session.id,
                ...(chunk.error ? { error: chunk.error } : {})
              });

              // Track the streamContent file interaction
              if (documentContext?.filePath && workspacePath) {
                try {
                  // console.log('[AIService] Tracking streamContent file interaction for:', documentContext.filePath);
                  await sessionFileTracker.trackToolExecution(
                    session.id,
                    workspacePath,
                    'streamContent',
                    { file_path: documentContext.filePath },
                    { success: !chunk.error }
                  );
                  // console.log('[AIService] streamContent tracking completed');
                  // Notify renderer that files were tracked
                  event.sender.send('session-files:updated', session.id);
                } catch (trackError) {
                  console.error('[AIService] Failed to track streamContent:', trackError);
                }
              }
              break;

            case 'error':
              if (isClaudeCode) {
                console.error('[CLAUDE-CODE-SERVICE] ERROR FROM PROVIDER:', chunk.error || 'Unknown error');
                console.error('[CLAUDE-CODE-SERVICE] Error context:', {
                  chunksSoFar: chunkCount,
                  textChunksSoFar: textChunks,
                  responseLengthSoFar: fullResponse.length,
                  timeElapsed: Date.now() - startTime
                });
              }
              console.error(`${logPrefix} Provider error:`, chunk.error || 'Unknown error');

              // Track stream interruption due to error
              this.analytics.sendEvent('ai_stream_interrupted', {
                provider: session.provider,
                chunksReceived: chunkCount,
                reason: 'error'
              });

              event.sender.send('ai:error', {
                sessionId: session.id,
                message: chunk.error || 'Unknown error occurred'
              });
              break;

            case 'complete':
              // if (isClaudeCode) {
              //   console.log('[CLAUDE-CODE-SERVICE] COMPLETE CHUNK RECEIVED!');
              //   console.log('[CLAUDE-CODE-SERVICE] Final response length:', fullResponse.length);
              // }
              // console.log(`${logPrefix} COMPLETE CHUNK RECEIVED! Sending completion signal to UI`);
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

              // console.log('[AIService] Stream complete - Performance metrics:', perfLog);
              // if (tokenUsage) {
              //   console.log('[AIService] Token usage:', tokenUsage);
              // }
              // if (modelUsage) {
              //   console.log('[AIService] modelUsage from claude-code:', JSON.stringify(modelUsage));
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
              event.sender.send('ai:performanceMetrics', {
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

              this.analytics.sendEvent('ai_response_received', {
                provider: session.provider,
                responseType,
                toolsUsed,
                responseTime: bucketResponseTime(perfLog.totalTime)
              });

              // Track ai_response_streamed analytics event (for streaming characteristics)
              this.analytics.sendEvent('ai_response_streamed', {
                provider: session.provider,
                chunkCount: bucketChunkCount(chunkCount),
                totalLength: bucketContentLength(fullResponse.length)
              });

              // Update session token usage if available
              // For claude-code: use modelUsage (from SDK) which has accurate input/output breakdown
              // For other providers: use tokenUsage from chunk.usage
              if (session.provider === 'claude-code' && modelUsage) {
                // Calculate totals from modelUsage (sum across all models)
                let newInputTokens = 0;
                let newOutputTokens = 0;
                let totalCostUSD = 0;
                let totalWebSearchRequests = 0;

                for (const modelName of Object.keys(modelUsage)) {
                  const stats = modelUsage[modelName];
                  newInputTokens += stats.inputTokens || 0;
                  newOutputTokens += stats.outputTokens || 0;
                  totalCostUSD += stats.costUSD || 0;
                  totalWebSearchRequests += stats.webSearchRequests || 0;
                }

                const currentUsage = session.tokenUsage ?? {
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0
                };

                const updatedUsage = {
                  inputTokens: currentUsage.inputTokens + newInputTokens,
                  outputTokens: currentUsage.outputTokens + newOutputTokens,
                  totalTokens: currentUsage.totalTokens + newInputTokens + newOutputTokens,
                  contextWindow: currentUsage.contextWindow,
                  costUSD: (currentUsage.costUSD || 0) + totalCostUSD,
                  webSearchRequests: (currentUsage.webSearchRequests || 0) + totalWebSearchRequests
                };

                await this.sessionManager.updateSessionTokenUsage(session.id, updatedUsage);

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

              // Update provider session data if available
              if (provider.getProviderSessionData) {
                const providerData = provider.getProviderSessionData(session.id);
                if (providerData?.claudeSessionId) {
                  await this.sessionManager.updateProviderSessionData(session.id, providerData.claudeSessionId);
                }
              }

              // Track Claude Code session initialization if this is the first message
              if (session.provider === 'claude-code' && session.messages.length === 0) {
                const initData = (provider as any).getInitData?.();
                if (initData) {
                  // console.log('[AIService] Tracking Claude Code session initialization:', initData);
                  this.analytics.sendEvent('claude_code_session_started', {
                    mcpServerCount: initData.mcpServerCount,
                    slashCommandCount: initData.slashCommandCount,
                    agentCount: initData.agentCount,
                    skillCount: initData.skillCount,
                    pluginCount: initData.pluginCount,
                    toolCount: initData.toolCount
                  });
                }
              }

              // Send complete response
              // console.log('[AIService] Sending FINAL ai:streamResponse with isComplete=true, content length:', fullResponse.length);
              event.sender.send('ai:streamResponse', {
                sessionId: session.id,
                content: fullResponse,
                isComplete: true,
                autoContextPending: session.provider === 'claude-code'
              });
              // console.log('[AIService] COMPLETION SIGNAL SENT TO UI!');

              // Play completion sound if enabled
              const soundService = SoundNotificationService.getInstance();
              soundService.playCompletionSound(workspacePath);

              // Show OS notification if enabled and window not focused
              const notificationBody = fullResponse.length > 0
                ? fullResponse.substring(0, 100) + (fullResponse.length > 100 ? '...' : '')
                : 'Response complete';

              // console.log('[AIService] Calling notification service for session:', session.id);
              await notificationService.showNotification({
                title: 'Nimbalyst AI Response Ready',
                body: `${session.provider}: ${notificationBody}`,
                sessionId: session.id,
                workspacePath: workspacePath,
                provider: session.provider
              });
              // console.log('[AIService] Notification service call completed');

              // AUTO-FETCH CONTEXT USAGE: For claude-code provider, automatically send /context to get accurate token usage.
              // We defer awaiting the promise until after streaming completes so that queued prompts don't start early.
              if (session.provider === 'claude-code') {
                autoContextPromise = this.runAutoContextCommand(session, workspacePath, event);
              }

              break;
          }
        }

        if (autoContextPromise) {
          try {
            await autoContextPromise;
          } catch (contextError) {
            console.error('[AIService] Auto /context fetch promise rejected:', contextError);
            logger.main.error('Auto /context fetch promise rejected', contextError);
          }
        }

        await stateManager.endSession(session.id);

        // Clear executing flag for mobile sync
        if (syncProvider) {
          syncProvider.pushChange(session.id, {
            type: 'metadata_updated',
            metadata: { isExecuting: false } as any,
          });
        }

        // Queue processing is handled by the renderer (AgenticPanel) to keep SDK instantiation in one place

        // Clean up queued prompt tracking
        if (queuedPromptId) {
          this.processingQueuedPromptIds.delete(queuedPromptId);
          logger.main.info(`[AIService] Cleared prompt tracking for ${queuedPromptId}`);
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
            responseTime: bucketResponseTime(errorTime)
          });
        }

        // Mark session as error
        if (session?.id) {
          await stateManager.updateActivity({
            sessionId: session.id,
            status: 'error'
          });

          // Clear executing flag for mobile sync on error
          if (syncProvider) {
            syncProvider.pushChange(session.id, {
              type: 'metadata_updated',
              metadata: { isExecuting: false } as any,
            });
          }
        }

        // Send error metrics
        if (event && event.sender) {
          event.sender.send('ai:performanceMetrics', {
            phase: 'error',
            errorTime,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          // Send error to renderer
          event.sender.send('ai:error', {
            sessionId: session?.id,
            message: error instanceof Error ? error.message : 'Unknown error occurred'
          });
        }

        // Clean up queued prompt tracking on error
        if (queuedPromptId) {
          this.processingQueuedPromptIds.delete(queuedPromptId);
          logger.main.info(`[AIService] Cleared prompt tracking for ${queuedPromptId} (error path)`);
        }

        throw error;
      }
    };

    // Register the handler with IPC
    ipcMain.handle('ai:sendMessage', this.sendMessageHandler);

    // Get session history
    ipcMain.handle('ai:getSessions', async (event, workspacePath?: string) => {
      return await this.sessionManager.getSessions(workspacePath);
    });

    // Load a session
    // trackAsResume: only pass true when user intentionally opens a session from history
    // (not for tab restoration, lazy loading, or session reloading)
    ipcMain.handle('ai:loadSession', async (event, sessionId: string, workspacePath?: string, trackAsResume?: boolean) => {
      const loadStart = performance.now();
      const session = await this.sessionManager.loadSession(sessionId, workspacePath);
      const loadTime = performance.now() - loadStart;
      // console.log(`[ai:loadSession] PERF: sessionManager.loadSession took ${loadTime.toFixed(1)}ms for ${sessionId}, messages: ${session?.messages?.length || 0}`);
      if (!session) {
        console.log(`[SESSION] Session not found: ${sessionId} (this is normal if the session was deleted)`);
        return null;
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
    });

    // Clear session
    ipcMain.handle('ai:clearSession', async (event, sessionId?: string) => {
      this.sessionManager.clearCurrentSession();

      // Abort any ongoing request for the specific session
      if (sessionId) {
        // Get provider from ProviderFactory using sessionId
        const session = await this.sessionManager.loadSession(sessionId);
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
    ipcMain.handle('ai:updateSessionMessages', async (
      event,
      sessionId: string,
      messages: Message[],
      workspacePath?: string
    ) => {
      const success = await this.sessionManager.updateSessionMessages(sessionId, messages, workspacePath);
      return { success };
    });

    // Update session metadata (for queue, etc.)
    ipcMain.handle('ai:updateSessionMetadata', async (
      event,
      sessionId: string,
      metadata: Record<string, any>,
      workspacePath?: string
    ) => {
      const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
      await AISessionsRepository.updateMetadata(sessionId, { metadata });
      return { success: true };
    });

    // Atomically claim a queued prompt for processing
    // Returns the prompt data if successfully claimed, null if already claimed by another instance
    // Uses the new queued_prompts table with proper row-level atomic updates
    ipcMain.handle('ai:claimQueuedPrompt', async (
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
    ipcMain.handle('ai:completeQueuedPrompt', async (
      event,
      promptId: string
    ) => {
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();
      await queueStore.complete(promptId);
      logger.main.info(`[AIService] completeQueuedPrompt: ${promptId}`);
    });

    // Mark a queued prompt as failed
    ipcMain.handle('ai:failQueuedPrompt', async (
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
    ipcMain.handle('ai:listPendingPrompts', async (
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
    ipcMain.handle('ai:createQueuedPrompt', async (
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

      return {
        id: created.id,
        prompt: created.prompt,
        timestamp: created.createdAt,
        attachments: created.attachments,
        documentContext: created.documentContext,
      };
    });

    // Delete a queued prompt (for user cancellation)
    ipcMain.handle('ai:deleteQueuedPrompt', async (
      event,
      promptId: string
    ) => {
      const { getQueuedPromptsStore } = await import('../RepositoryManager');
      const queueStore = getQueuedPromptsStore();
      await queueStore.delete(promptId);
      logger.main.info(`[AIService] deleteQueuedPrompt: deleted ${promptId}`);
      return { success: true };
    });

    // Save draft input
    ipcMain.handle('ai:saveDraftInput', async (
      event,
      sessionId: string,
      draftInput: string,
      workspacePath?: string
    ) => {
      const success = await this.sessionManager.saveDraftInput(sessionId, draftInput, workspacePath);
      return { success };
    });

    // Clean up empty messages from all sessions
    ipcMain.handle('ai:cleanupEmptyMessages', async () => {
      const cleaned = this.sessionManager.cleanupAllSessions();
      console.log(`[AIService] Manual cleanup: removed ${cleaned} empty messages`);
      return { success: true, cleaned };
    });

    // Delete session
    ipcMain.handle('ai:deleteSession', async (event, sessionId: string, workspacePath?: string) => {
      const success = await this.sessionManager.deleteSession(sessionId, workspacePath);

      // Clean up provider if it exists
      if (success) {
        ProviderFactory.destroyProvider(sessionId);
      }

      return { success };
    });

    // Handle ExitPlanMode confirmation response from renderer
    ipcMain.handle('ai:exitPlanModeConfirmResponse', async (event, requestId: string, sessionId: string, approved: boolean) => {
      logger.main.info(`[AIService] ExitPlanMode confirmation response: requestId=${requestId}, approved=${approved}`);

      // Find the session and its provider
      const session = await this.sessionManager.loadSession(sessionId);
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
        (provider as any).resolveExitPlanModeConfirmation(requestId, approved);
        return { success: true };
      } else {
        logger.main.warn(`[AIService] Provider does not support ExitPlanMode confirmation: ${session.provider}`);
        return { success: false, error: 'Provider does not support ExitPlanMode confirmation' };
      }
    });

    // Cancel current request
    ipcMain.handle('ai:cancelRequest', async (event, sessionId: string, chunksReceived?: number) => {
      // Abort the provider for the specific session
      if (!sessionId) {
        throw new Error('Session ID is required to cancel request');
      }

      const session = await this.sessionManager.loadSession(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
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
        console.log(`[AIService] Cancelled request for session ${sessionId}`);
        this.analytics.sendEvent('cancel_ai_request', {provider: providerType})
        return { success: true };
      }
      return { success: false, error: 'No active provider for session' };
    });

    // Settings handlers
    ipcMain.handle('ai:getSettings', async () => {
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
      const showToolCalls = this.getSettingsStore().get('showToolCalls', false) as boolean;
      const aiDebugLogging = this.getSettingsStore().get('aiDebugLogging', false) as boolean;

      return {
        defaultProvider: this.getSettingsStore().get('defaultProvider', 'claude-code'),
        apiKeys: this.maskApiKeys(apiKeys),
        providerSettings,
        showToolCalls,
        aiDebugLogging
      };
    });

    ipcMain.handle('ai:saveSettings', async (event, settings: any) => {
      if (settings.defaultProvider) {
        this.getSettingsStore().set('defaultProvider', settings.defaultProvider);
      }

      if (settings.apiKeys) {
        // Only update changed API keys
        const currentKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

        // Save Anthropic key
        if (settings.apiKeys.anthropic !== undefined) {
          const key = settings.apiKeys.anthropic;
          if (key && key !== this.maskApiKey(currentKeys['anthropic'] || '')) {
            currentKeys['anthropic'] = key as string;
          }
        }

        // Save OpenAI key
        if (settings.apiKeys.openai !== undefined) {
          const key = settings.apiKeys.openai;
          if (key && key !== this.maskApiKey(currentKeys['openai'] || '')) {
            currentKeys['openai'] = key as string;
          }
        }

        // Save LMStudio URL
        if (settings.apiKeys.lmstudio_url !== undefined) {
          currentKeys['lmstudio_url'] = settings.apiKeys.lmstudio_url as string;
        }

        this.getSettingsStore().set('apiKeys', currentKeys);
      }

      if (settings.providerSettings) {
        this.getSettingsStore().set('providerSettings', settings.providerSettings);
      }

      if (settings.showToolCalls !== undefined) {
        this.getSettingsStore().set('showToolCalls', settings.showToolCalls);
      }

      if (settings.aiDebugLogging !== undefined) {
        this.getSettingsStore().set('aiDebugLogging', settings.aiDebugLogging);
      }

      return { success: true };
    });

    // Test connection
    ipcMain.handle('ai:testConnection', async (event, provider: string) => {
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
        case 'openai-codex':
          apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;
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

        // For OpenAI Codex, just check if API key is present (CLI will validate on use)
        if (provider === 'openai-codex') {
          // We already checked for API key above, so just return success
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
          console.log('[AIService] testConnection - Initializing with config:', config);
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
          const baseUrl = apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
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
    ipcMain.handle('ai:getAllModels', async () => {
      // console.log('[AIService] ai:getAllModels called');

      // Clear cache to get fresh models
      ModelRegistry.clearCache();

      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      // console.log('[AIService] ai:getAllModels - API keys available:', {
      //   anthropic: !!apiKeys['anthropic'],
      //   openai: !!apiKeys['openai'],
      //   lmstudio_url: apiKeys['lmstudio_url']
      // });

      // Get all models - pass provider settings for LMStudio URL
      const modelsConfig = {
        ...apiKeys,
        lmstudio_url: providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234'
      };
      const allModels = await ModelRegistry.getAllModels(modelsConfig);

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
    ipcMain.handle('ai:clearModelCache', async () => {
      ModelRegistry.clearCache();
      return { success: true };
    });

    ipcMain.handle('ai:refreshSessionProvider', async (_event, sessionId: string) => {
      ProviderFactory.destroyProvider(sessionId);
      return { success: true };
    });

    // Get slash commands from active claude-code provider
    ipcMain.handle('ai:getSlashCommands', async (event, sessionId?: string) => {
      try {
        // console.log('[AIService] ai:getSlashCommands called with sessionId:', sessionId);

        // Get provider from session
        let provider: AIProvider | undefined;
        if (sessionId) {
          // console.log('[AIService] Getting provider from ProviderFactory with sessionId:', sessionId);
          provider = ProviderFactory.getProvider('claude-code', sessionId) ?? undefined;
          // console.log('[AIService] Provider from ProviderFactory:', provider ? 'found' : 'not found');
        }

        // Check if provider has getSlashCommands method
        if (provider) {
          // console.log('[AIService] Provider found, checking for getSlashCommands method');
          // console.log('[AIService] Has getSlashCommands:', 'getSlashCommands' in provider);

          if ('getSlashCommands' in provider && typeof (provider as any).getSlashCommands === 'function') {
            const commands = (provider as any).getSlashCommands();
            // console.log('[AIService] Retrieved slash commands from provider:', commands);

            // If commands array is empty, return empty array
            if (commands.length === 0) {
              // console.log('[AIService] Provider returned empty commands');
              return { success: true, commands: [] };
            }

            return { success: true, commands };
          } else {
            // console.log('[AIService] Provider does not have getSlashCommands method');
          }
        }

        // No provider found - return empty commands
        // console.log('[AIService] No provider found');
        return { success: true, commands: [] };
      } catch (error) {
        console.error('[AIService] Error getting slash commands:', error);
        return { success: false, commands: [], error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get ENABLED models for actual use
    ipcMain.handle('ai:getModels', async () => {
      console.log('[AIService] ai:getModels called - fetching enabled models');
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const claudeCodeSettings = providerSettings['claude-code'] || {};

      console.log('[AIService] ai:getModels - claude-code settings:', {
        enabled: claudeCodeSettings.enabled,
        models: claudeCodeSettings.models
      });

      // Get all models - pass provider settings for LMStudio URL
      const modelsConfig = {
        ...apiKeys,
        lmstudio_url: providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234'
      };
      // console.log('[AIService] ai:getModels - calling ModelRegistry.getAllModels');
      const allModels = await ModelRegistry.getAllModels(modelsConfig);

      // Log claude-code models specifically
      const claudeCodeModels = allModels.filter(m => m.provider === 'claude-code');
      console.log('[AIService] ai:getModels - claude-code models from registry:',
        claudeCodeModels.map(m => ({ id: m.id, name: m.name })));

      // Build enabled providers map
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
          enabled: providerSettings['openai-codex']?.enabled === true && !!(apiKeys['openai'] || process.env.OPENAI_API_KEY),
          models: providerSettings['openai-codex']?.models
        },
        'lmstudio': {
          enabled: providerSettings['lmstudio']?.enabled === true,
          models: providerSettings['lmstudio']?.models
        }
      };

      // Filter to only enabled models
      const enabledModels = allModels.filter(model => {
        const provider = enabledProviders[model.provider as AIProviderType];
        if (model.provider === 'openai-codex') {
          console.log('[AIService] Filtering openai-codex model:', {
            modelId: model.id,
            providerEnabled: provider?.enabled,
            selectedModels: provider?.models
          });
        }
        if (!provider?.enabled) return false;
        // If specific models are selected, filter to those
        if (provider.models && provider.models.length > 0) {
          if (model.provider === 'claude-code' && provider.models.includes('claude-code')) {
            return true;
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
    ipcMain.handle('mcp:applyDiff:result', async (event, resultChannel: string, result: any) => {
      // Forward result back through the result channel
      event.sender.send(resultChannel, result);
    });

    // ============================================================
    // Project-level AI Settings Override Handlers
    // ============================================================

    // Get project-level AI provider overrides
    ipcMain.handle('ai:getProjectSettings', async (_event, workspacePath: string) => {
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
    ipcMain.handle('ai:saveProjectSettings', async (_event, workspacePath: string, overrides: any) => {
      if (!workspacePath) {
        return { success: false, error: 'workspacePath is required' };
      }

      // If overrides is null/undefined or empty, clear the overrides
      if (!overrides || (Object.keys(overrides).length === 0)) {
        saveAIProviderOverrides(workspacePath, undefined);
      } else {
        saveAIProviderOverrides(workspacePath, overrides);
      }

      return { success: true };
    });

    // Get effective (merged) AI settings for a workspace
    ipcMain.handle('ai:getEffectiveSettings', async (_event, workspacePath?: string) => {

      // Get global settings
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
      const showToolCalls = this.getSettingsStore().get('showToolCalls', false) as boolean;
      const aiDebugLogging = this.getSettingsStore().get('aiDebugLogging', false) as boolean;
      const defaultProvider = this.getSettingsStore().get('defaultProvider', 'claude-code') as string;

      const globalSettings = {
        defaultProvider,
        apiKeys: this.maskApiKeys(apiKeys),
        providerSettings,
        showToolCalls,
        aiDebugLogging,
      };

      // Merge with project overrides
      const effective = mergeAISettings(globalSettings, workspacePath);

      return {
        success: true,
        settings: effective,
      };
    });

    // Clear project-level AI overrides
    ipcMain.handle('ai:clearProjectSettings', async (_event, workspacePath: string) => {
      if (!workspacePath) {
        return { success: false, error: 'workspacePath is required' };
      }

      clearAIProviderOverrides(workspacePath);

      return { success: true };
    });
  }

  private createToolHandler(webContents: Electron.WebContents, documentContext?: DocumentContext, sessionId?: string, workspaceId?: string): ToolHandler {
    const executor = new ToolExecutor(webContents, sessionId, workspaceId);
    // console.log(`[AIService] createToolHandler called with documentContext.filePath:`, documentContext?.filePath);

    // Capture targetFilePath from documentContext at message-send time
    // This prevents race conditions if user switches tabs while waiting for AI response
    const targetFilePath = documentContext?.filePath;

    return {
      applyDiff: async (args: DiffArgs): Promise<DiffResult> => {
        console.log(`[AIService] applyDiff called, targetFilePath from closure:`, targetFilePath);
        return executor.applyDiff({ ...args, targetFilePath });
      },
      streamContent: async (args: any): Promise<any> => {
        console.log(`[AIService] streamContent called, targetFilePath from closure:`, targetFilePath);
        return executor.streamContent({ ...args, targetFilePath });
      },
      executeTool: async (name: string, args: any): Promise<any> => {
        // For tools that need targetFilePath, inject it from the closure
        if (name === 'streamContent' || name === 'applyDiff') {
          return executor.executeTool(name, { ...args, targetFilePath });
        }
        return executor.executeTool(name, args);
      }
    };
  }

  private getProviderSetting(provider: string, key: string): any {
    const providerSettings = this.getSettingsStore().get('providerSettings', {}) as any;
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

  public destroy() {
    try {
      // Clean up all providers with error handling
      ProviderFactory.destroyAll();
    } catch (error) {
      console.error('[AIService] Error destroying providers:', error);
      // Continue destruction even if providers fail
    }

    // Clear any remaining references
    try {
      this.sessionManager = null as any;
      this.settingsStore = null;
    } catch (error) {
      console.error('[AIService] Error clearing references:', error);
    }
  }
}
