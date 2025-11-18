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
} from '@nimbalyst/runtime/ai/server/types';
// MCP imports removed - no longer using MCP HTTP server
import { ToolExecutor, toolRegistry, BUILT_IN_TOOLS } from './tools';
import { SoundNotificationService } from '../SoundNotificationService';
import { notificationService } from '../NotificationService';
import { logger } from '../../utils/logger';
import { windowStates } from '../../window/WindowManager';
import { sessionFileTracker } from '../SessionFileTracker';
import {AnalyticsService} from "../analytics/AnalyticsService.ts";

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

  constructor(sessionStore: SessionStore) {
    this.sessionManager = new SessionManager(sessionStore);

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
            default: {}
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

      // Get API key based on provider
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;
      let apiKey: string | undefined;

      switch (provider) {
        case 'claude':
          apiKey = apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            throw new Error('Anthropic API key not configured');
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
            throw new Error('OpenAI API key not configured');
          }
          break;
        case 'lmstudio':
          // LMStudio doesn't need an API key, just the base URL
          apiKey = 'not-required';
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }

      // Get model details if specified
      let model = modelId;
      if (!model && provider !== 'claude-code') {
        // For non-claude-code providers, try to get a default model
        model = await ModelRegistry.getDefaultModel(provider);
      }

      // For claude-code, don't pass a model at all - let it handle its own selection
      const providerConfig: any = {
        maxTokens: this.getProviderSetting(provider, 'maxTokens'),
        temperature: this.getProviderSetting(provider, 'temperature')
      };

      // Only add model to config if we have one and it's not claude-code
      if (model && provider !== 'claude-code') {
        // Strip provider prefix if present (e.g., "openai:gpt-4" -> "gpt-4")
        if (model.includes(':')) {
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
      if (session.providerConfig?.model && provider !== 'claude-code' && provider !== 'openai-codex') {
        initConfig.model = session.providerConfig.model;
      }

      // Add LMStudio-specific config
      if (provider === 'lmstudio') {
        const lmstudioSettings = this.getSettingsStore().get('providerSettings.lmstudio', {}) as any;
        initConfig.baseUrl = lmstudioSettings.baseUrl || apiKeys['lmstudio_url'] || 'http://127.0.0.1:8234';
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

      // Add user message to session
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: Date.now()
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

        // Only add model if it exists and provider isn't claude-code
        if ((session.model || session.providerConfig?.model) && session.provider !== 'claude-code') {
          const fullModel = session.model || session.providerConfig?.model;
          // console.log('[AIService] Reinitializing provider with model:', {
          //   sessionModel: session.model,
          //   providerConfigModel: session.providerConfig?.model,
          //   fullModel,
          //   provider: session.provider
          // });

          // Strip provider prefix if present (e.g., "claude:claude-sonnet-4" -> "claude-sonnet-4")
          if (fullModel && fullModel.includes(':')) {
            reinitConfig.model = fullModel.split(':').slice(1).join(':');
            // console.log('[AIService] Stripped model prefix:', {
            //   original: fullModel,
            //   stripped: reinitConfig.model
            // });
          } else {
            reinitConfig.model = fullModel;
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
      const onMessageLogged = (data: { sessionId: string; direction: string }) => {
        event.sender.send('ai:message-logged', data);
      };
      // Remove all previous listeners to avoid duplicates
      provider.removeAllListeners('message:logged');
      provider.on('message:logged', onMessageLogged);

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
      this.analytics.sendEvent('ai_message_sent', {
        provider: session.provider,
        hasDocumentContext: !!documentContext,
        hasAttachments: !!(attachments && attachments.length > 0),
        attachmentCount: attachments?.length || 0,
        messageLength: bucketMessageLength(message.length)
      });

      // Mark session as running/active
      const stateManager = getSessionStateManager();
      await stateManager.startSession({ sessionId: session.id });

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

        // Add sessionType and attachments to documentContext for provider to use in system prompt
        const contextWithSession = documentContext ? {
          ...documentContext,
          sessionType: (documentContext as any)?.sessionType ?? session.sessionType,
          attachments
        } as any : { sessionType: session.sessionType, attachments } as any;

        for await (const chunk of provider.sendMessage(message, contextWithSession, session.id, sessionMessages, workspacePath, attachments)) {
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
                  // Mark that we used streamContent - we'll handle this specially
                  hasStreamingContent = true;
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
              // Forward streaming edit start event to renderer
              // console.log('[AIService] Forwarding stream_edit_start to renderer:', chunk.config);
              event.sender.send('ai:streamEditStart', {
                sessionId: session.id,
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

              // console.log('[AIService] Stream complete - Performance metrics:', perfLog);
              // if (tokenUsage) {
              //   console.log('[AIService] Token usage:', tokenUsage);
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

              // Note: Token usage is now fetched via /context command below for Claude Code
              // This provides accurate context window usage instead of cumulative token counts
              // For Claude Code, we NEVER use chunk.usage - only /context results

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
                isComplete: true
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

              // AUTO-FETCH CONTEXT USAGE: For claude-code provider, automatically send /context to get accurate token usage
              if (session.provider === 'claude-code') {
                // console.log('[AIService] Auto-fetching context usage for claude-code session:', session.id);
                try {
                  // Get the provider
                  const contextProvider = ProviderFactory.getProvider(session.provider as AIProviderType, session.id);
                  // console.log('[AIService] Context provider retrieved:', !!contextProvider);
                  if (contextProvider) {
                    let contextResponse = '';

                    // Reload the session to get the updated messages array (including the assistant's response we just added)
                    const updatedSession = await this.sessionManager.loadSession(session.id, workspacePath);
                    if (!updatedSession) {
                      console.error('[AIService] Failed to reload session for /context command');
                      logger.main.error('Failed to reload session for /context command');
                      break;
                    }
                    // console.log('[AIService] Session reloaded, messages count:', updatedSession.messages.length);

                    // Mark messages as hidden for this auto-triggered /context command
                    // User-typed /context won't have this flag set, so they'll be visible
                    if (contextProvider.setHiddenMode) {
                      contextProvider.setHiddenMode(true);
                      // console.log('[AIService] Hidden mode set on provider');
                    }

                    // Stream the /context response
                    // The provider will log messages with hidden=true flag
                    // IMPORTANT: Pass undefined for documentContext - /context is a slash command
                    // that should return token stats, not analyze the current document
                    // console.log('[AIService] Sending /context command...');
                    for await (const chunk of contextProvider.sendMessage('/context', undefined, session.id, updatedSession.messages, workspacePath, [])) {
                      if (!chunk) continue;
                      // console.log('[AIService] /context chunk received:', chunk.type, chunk);
                      if (chunk.type === 'text') {
                        contextResponse += chunk.content || '';
                        // console.log('[AIService] Accumulated context response so far:', contextResponse);
                      } else if (chunk.type === 'complete') {
                        // Parse the context response to extract token usage and category breakdown
                        // console.log('[AIService] /context response received:', contextResponse);
                        const parsedUsage = parseContextUsageMessage(contextResponse);

                        if (parsedUsage) {
                          // Notify renderer to reload session (which will parse token usage from messages)
                          event.sender.send('ai:tokenUsageUpdated', {
                            sessionId: session.id,
                            tokenUsage: {
                              inputTokens: 0,
                              outputTokens: 0,
                              totalTokens: parsedUsage.totalTokens,
                              contextWindow: parsedUsage.contextWindow,
                              categories: parsedUsage.categories
                            }
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
                    // console.log('[AIService] Finished streaming /context response');
                  } else {
                    console.warn('[AIService] No context provider found for session:', session.id);
                  }
                } catch (contextError) {
                  console.error('[AIService] Exception while fetching context usage:', contextError);
                  logger.main.error('Failed to fetch context usage:', contextError);
                  // Don't fail the main request if context fetch fails
                }
              } else {
                // console.log('[AIService] Skipping /context auto-fetch - provider is not claude-code:', session.provider);
              }

              // Mark session as idle/complete
              await stateManager.endSession(session.id);

              break;
          }
        }

        // QUEUE PROCESSING: Check if there are queued prompts and process the next one
        // console.log(`[AIService] Message stream completed, checking for queued prompts...`);

        const reloadedSession = await this.sessionManager.loadSession(session.id, workspacePath);
        const queuedPrompts = (reloadedSession?.metadata?.queuedPrompts as any[]) || [];

        // console.log(`[AIService] Queue check: found ${queuedPrompts.length} queued prompts`);

        if (queuedPrompts.length > 0) {
          console.log(`[AIService] Processing next queued prompt...`);

          // Get the first queued prompt
          const nextPrompt = queuedPrompts[0];
          const remainingQueue = queuedPrompts.slice(1);

          // Update session metadata to remove the processed prompt from queue
          const { AISessionsRepository } = await import('@nimbalyst/runtime/storage/repositories/AISessionsRepository');
          await AISessionsRepository.updateMetadata(session.id, {
            metadata: {
              ...reloadedSession.metadata,
              queuedPrompts: remainingQueue
            }
          });

          // Notify renderer that queue was updated
          event.sender.send('ai:queue-updated', {
            sessionId: session.id,
            queueLength: remainingQueue.length
          });

          // console.log(`[AIService] Auto-processing queued prompt: ${nextPrompt.prompt.substring(0, 100)}...`);

          // Notify renderer that a queued prompt is starting
          event.sender.send('ai:queue-prompt-starting', {
            sessionId: session.id,
            message: nextPrompt.prompt
          });

          // Process the queued prompt using the stored handler
          setImmediate(() => {
            if (this.sendMessageHandler) {
              // console.log('[AIService] Invoking sendMessageHandler for queued prompt');
              this.sendMessageHandler(event, nextPrompt.prompt, nextPrompt.documentContext, session.id, workspacePath)
                .then(() => {
                  console.log('[AIService] Queued prompt completed successfully');
                })
                .catch((queueError: Error) => {
                  console.error('[AIService] Error processing queued prompt:', queueError);
                  event.sender.send('ai:error', {
                    sessionId: session.id,
                    message: `Failed to process queued prompt: ${queueError.message || 'Unknown error'}`
                  });
                });
            } else {
              console.error('[AIService] sendMessageHandler not available!');
            }
          });
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
    ipcMain.handle('ai:loadSession', async (event, sessionId: string, workspacePath?: string) => {
      const session = await this.sessionManager.loadSession(sessionId, workspacePath);
      if (!session) {
        console.log(`[SESSION] Session not found: ${sessionId} (this is normal if the session was deleted)`);
        return null;
      }

      // Track ai_session_resumed if session has previous messages
      if (session.messages && session.messages.length > 0) {
        const messageCount = session.messages.length;
        const createdAt = session.createdAt || Date.now();

        this.analytics.sendEvent('ai_session_resumed', {
          provider: session.provider,
          messageCount: bucketCount(messageCount),
          ageInDays: bucketAgeInDays(createdAt)
        });
      }

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
      console.log('[AIService] ai:getAllModels called');

      // Clear cache to get fresh models
      ModelRegistry.clearCache();

      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      console.log('[AIService] ai:getAllModels - API keys available:', {
        anthropic: !!apiKeys['anthropic'],
        openai: !!apiKeys['openai'],
        lmstudio_url: apiKeys['lmstudio_url']
      });

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
      const providerSettings = this.getSettingsStore().get('providerSettings', {}) as Record<AIProviderType, any>;
      const apiKeys = this.getSettingsStore().get('apiKeys', {}) as Record<string, string>;

      // Get all models - pass provider settings for LMStudio URL
      const modelsConfig = {
        ...apiKeys,
        lmstudio_url: providerSettings['lmstudio']?.baseUrl || 'http://127.0.0.1:8234'
      };
      const allModels = await ModelRegistry.getAllModels(modelsConfig);

      // Build enabled providers map
      const enabledProviders: Record<AIProviderType, { enabled: boolean; models?: string[] }> = {
        'claude': {
          enabled: providerSettings['claude']?.enabled === true && !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY),
          models: providerSettings['claude']?.models
        },
        'claude-code': {
          // Claude Code is always available if API key exists (it's the MCP integration)
          enabled: !!(apiKeys['anthropic'] || process.env.ANTHROPIC_API_KEY),
          models: providerSettings['claude-code']?.models
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
  }

  private createToolHandler(webContents: Electron.WebContents, documentContext?: DocumentContext, sessionId?: string, workspaceId?: string): ToolHandler {
    const executor = new ToolExecutor(webContents, sessionId, workspaceId);
    console.log(`[AIService] createToolHandler called with documentContext.filePath:`, documentContext?.filePath);

    return {
      applyDiff: async (args: DiffArgs): Promise<DiffResult> => {
        // Use the current document context file path (passed in the message)
        const targetFilePath = documentContext?.filePath;
        console.log(`[AIService] applyDiff called, targetFilePath from closure:`, targetFilePath);
        return executor.applyDiff({ ...args, targetFilePath });
      },
      executeTool: async (name: string, args: any): Promise<any> => {
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
