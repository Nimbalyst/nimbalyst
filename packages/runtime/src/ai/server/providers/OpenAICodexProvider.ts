import path from 'path';
import { BaseAIProvider } from '../AIProvider';
import { buildUserMessageAddition } from './documentContextUtils';
import { DEFAULT_MODELS } from '../../modelConstants';
import { AIToolCall, AIToolResult } from '../../types';
import {
  ProviderConfig,
  DocumentContext,
  StreamChunk,
  Message,
  ProviderCapabilities,
  AIProviderType,
  ModelIdentifier,
} from '../types';
import { AgentMessagesRepository } from '../../../storage/repositories/AgentMessagesRepository';
import {
  CodexClientLike,
  CodexSdkModuleLike,
  CodexThreadLike,
  getEventsIterable,
  getThreadIdFromRunResult,
  loadCodexSdkModule,
} from './codex/codexSdkLoader';
import { resolvePackagedCodexBinaryPath } from './codex/codexBinaryPath';
import { parseCodexEvent, ParsedCodexUsage } from './codex/codexEventParser';
import {
  PermissionMode,
  ToolPermissionScope,
  PermissionDecision,
  TrustChecker,
  PermissionPatternSaver,
  PermissionPatternChecker,
  SecurityLogger,
  ProviderPermissionMixin,
} from './ProviderPermissionMixin';
import { ProviderSessionManager } from './ProviderSessionManager';

interface OpenAICodexProviderDeps {
  loadSdkModule?: () => Promise<CodexSdkModuleLike>;
  resolveCodexPathOverride?: () => string | undefined;
}

export class OpenAICodexProvider extends BaseAIProvider {
  static readonly DEFAULT_MODEL = DEFAULT_MODELS['openai-codex'];
  private static readonly CODEX_EXECUTION_PATTERN = 'OpenAICodex(agent-run:*)';

  // Injected from Electron main process.
  private static trustChecker: TrustChecker | null = null;
  private static permissionPatternSaver: PermissionPatternSaver | null = null;
  private static permissionPatternChecker: PermissionPatternChecker | null = null;
  private static securityLogger: SecurityLogger | null = null;

  private apiKey: string;
  private abortController: AbortController | null = null;
  private codexClient: CodexClientLike | null = null;
  private codexThreads: Map<string, CodexThreadLike> = new Map();
  private readonly loadSdkModule: () => Promise<CodexSdkModuleLike>;
  private readonly resolveCodexPathOverride: () => string | undefined;

  // Shared session ID management via mixin.
  private readonly sessions = new ProviderSessionManager({ emit: this.emit.bind(this) });

  // Shared permission infrastructure via mixin.
  private readonly permissions = new ProviderPermissionMixin();

  constructor(config?: { apiKey?: string }, deps?: OpenAICodexProviderDeps) {
    super();
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
    this.loadSdkModule = deps?.loadSdkModule ?? loadCodexSdkModule;
    this.resolveCodexPathOverride = deps?.resolveCodexPathOverride ?? resolvePackagedCodexBinaryPath;
  }

  public static setTrustChecker(checker: TrustChecker | null): void {
    OpenAICodexProvider.trustChecker = checker;
  }

  public static setPermissionPatternSaver(saver: PermissionPatternSaver | null): void {
    OpenAICodexProvider.permissionPatternSaver = saver;
  }

  public static setPermissionPatternChecker(checker: PermissionPatternChecker | null): void {
    OpenAICodexProvider.permissionPatternChecker = checker;
  }

  public static setSecurityLogger(logger: SecurityLogger | null): void {
    OpenAICodexProvider.securityLogger = logger;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    if (config.apiKey) {
      this.apiKey = config.apiKey;
    }
  }

  private static readonly LEGACY_MODEL_ALIASES = new Set([
    'openai-codex:openai-codex-cli',
    'openai-codex-cli',
    'openai-codex:default',
    'default',
    'openai-codex:cli',
    'cli',
  ]);

  /**
   * Normalize a single model ID, mapping legacy aliases to the canonical form.
   */
  static normalizeModelSelection(modelId: string): string {
    const normalized = modelId.trim().toLowerCase();
    if (OpenAICodexProvider.LEGACY_MODEL_ALIASES.has(normalized) || normalized === 'gpt-5') {
      return 'openai-codex:gpt-5';
    }
    return modelId;
  }

  /**
   * Normalize an array of model IDs, deduplicating after normalization.
   */
  static normalizeModelSelections(models: string[] | undefined): string[] | undefined {
    if (!Array.isArray(models)) {
      return models;
    }
    const result: string[] = [];
    for (const modelId of models) {
      const mapped = OpenAICodexProvider.normalizeModelSelection(modelId);
      if (!result.includes(mapped)) {
        result.push(mapped);
      }
    }
    return result;
  }

  static getModels() {
    return [
      {
        id: ModelIdentifier.create('openai-codex', 'gpt-5').combined,
        name: 'GPT-5 (Codex SDK)',
        provider: 'openai-codex' as AIProviderType,
        contextWindow: 272000,
        maxTokens: 16384,
      },
    ];
  }

  static getDefaultModel() {
    return this.DEFAULT_MODEL;
  }

  getName(): string {
    return 'openai-codex';
  }

  getDisplayName(): string {
    return 'OpenAI Codex';
  }

  getDescription(): string {
    return 'OpenAI Codex SDK agent provider with tool and streaming support';
  }

  setProviderSessionData(sessionId: string, data: any): void {
    this.sessions.setProviderSessionData(sessionId, data);
  }

  getProviderSessionData(sessionId: string): any {
    const { providerSessionId } = this.sessions.getProviderSessionData(sessionId);
    return {
      providerSessionId,
      codexThreadId: providerSessionId,
    };
  }

  async handleToolCall(
    toolCall: AIToolCall,
    _options?: {
      sessionId?: string;
      workingDirectory?: string;
    }
  ): Promise<AIToolResult> {
    if (!toolCall.name) {
      return {
        success: false,
        error: 'Tool name is required',
      };
    }

    try {
      const result = await this.executeToolCall(toolCall.name, toolCall.arguments ?? {});
      return {
        success: true,
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      return {
        success: false,
        error: message,
        result: (error as any)?.toolResult,
      };
    }
  }

  async cancelStream(_sessionId?: string): Promise<void> {
    this.abort();
  }

  async *sendMessage(
    message: string,
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[],
    workspacePath?: string,
    attachments?: any[]
  ): AsyncIterableIterator<StreamChunk> {
    if (!workspacePath) {
      yield { type: 'error', error: '[OpenAICodexProvider] workspacePath is required but was not provided' };
      return;
    }

    if (!this.apiKey) {
      yield { type: 'error', error: 'OpenAI API key not configured for Codex provider' };
      return;
    }

    const systemPrompt = this.buildSystemPrompt(documentContext);
    const { userMessageAddition, messageWithContext } = buildUserMessageAddition(message, documentContext);
    const messageWithAttachmentHints = this.appendAttachmentHints(messageWithContext, attachments);

    if (sessionId && (systemPrompt || userMessageAddition || (attachments?.length ?? 0) > 0)) {
      const attachmentSummaries =
        attachments?.map((attachment) => ({
          type: attachment.type,
          filename: attachment.filename || (attachment.filepath ? path.basename(attachment.filepath) : 'unknown'),
          mimeType: attachment.mimeType,
          filepath: attachment.filepath,
        })) ?? [];
      this.emit('promptAdditions', {
        sessionId,
        systemPromptAddition: systemPrompt || null,
        userMessageAddition,
        attachments: attachmentSummaries,
        timestamp: Date.now(),
      });
    }

    const shouldBootstrapFromHistory =
      !!sessionId &&
      !this.sessions.getSessionId(sessionId) &&
      !!messages &&
      messages.length > 0;
    const prompt = this.buildCodexPrompt({
      systemPrompt,
      message: messageWithAttachmentHints,
      messages,
      shouldBootstrapFromHistory,
    });

    if (sessionId) {
      await this.logAgentMessageBestEffort(sessionId, 'input', prompt);
    }

    const permissionsPath = documentContext?.permissionsPath || workspacePath;
    const abortController = new AbortController();
    this.abortController = abortController;

    let fullText = '';
    let lastCumulativeText = '';
    let usage: ParsedCodexUsage | undefined;

    try {
      const permissionResult = await this.ensureCodexTurnPermission(
        sessionId,
        workspacePath,
        permissionsPath,
        abortController.signal
      );
      if (!permissionResult.allowed) {
        yield {
          type: 'error',
          error: permissionResult.message || 'OpenAI Codex turn denied by user',
        };
        return;
      }

      const codexThread = await this.getOrCreateThread(sessionId, workspacePath);

      const runResult = await codexThread.runStreamed(prompt, {
        signal: abortController.signal,
      });

      this.captureAndPersistThreadId(sessionId, codexThread, runResult);

      const events = getEventsIterable(runResult);
      for await (const event of events) {
        if (abortController.signal.aborted) {
          throw new Error('Operation cancelled');
        }

        const parsedEvents = parseCodexEvent(event);
        for (const parsedEvent of parsedEvents) {
          if (parsedEvent.error) {
            yield {
              type: 'error',
              error: parsedEvent.error,
            };
            continue;
          }

          if (parsedEvent.usage) {
            usage = parsedEvent.usage;
          }

          if (parsedEvent.toolCall) {
            yield {
              type: 'tool_call',
              toolCall: {
                name: parsedEvent.toolCall.name,
                arguments: parsedEvent.toolCall.arguments,
                ...(parsedEvent.toolCall.result !== undefined ? { result: parsedEvent.toolCall.result } : {}),
              },
            };
            continue;
          }

          if (parsedEvent.text) {
            // The SDK may emit cumulative text (each event contains full text so far)
            // or incremental deltas. Detect cumulative mode by checking if the new text
            // starts with what we already emitted, and extract only the delta.
            let delta: string;
            if (parsedEvent.text.startsWith(lastCumulativeText) && lastCumulativeText.length > 0) {
              delta = parsedEvent.text.slice(lastCumulativeText.length);
              lastCumulativeText = parsedEvent.text;
            } else {
              delta = parsedEvent.text;
              lastCumulativeText = parsedEvent.text;
            }
            if (delta) {
              fullText += delta;
              yield {
                type: 'text',
                content: delta,
              };
            }
          }
        }
      }

      if (sessionId && fullText.trim()) {
        await this.logAgentMessageBestEffort(sessionId, 'output', fullText);
      }

      yield {
        type: 'complete',
        content: fullText,
        isComplete: true,
        usage: usage ?? {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAbort = abortController.signal.aborted || /abort|cancel/i.test(errorMessage);
      if (!isAbort) {
        // Evict the cached thread so the next message creates a fresh one.
        if (sessionId) {
          this.codexThreads.delete(sessionId);
        }
        yield {
          type: 'error',
          error: errorMessage,
        };
      }
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  public resolveToolPermission(
    requestId: string,
    response: PermissionDecision,
    sessionId?: string,
    respondedBy: 'desktop' | 'mobile' = 'desktop'
  ): void {
    this.permissions.resolveToolPermission(
      requestId,
      response,
      (_reqId, resp, by) => {
        if (sessionId) {
          void this.logAgentMessageBestEffort(
            sessionId,
            'output',
            JSON.stringify({
              type: 'nimbalyst_tool_result',
              tool_use_id: _reqId,
              result: JSON.stringify({
                decision: resp.decision,
                scope: resp.scope,
                respondedAt: Date.now(),
                respondedBy: by,
              }),
            })
          );
        }
      },
      respondedBy
    );
  }

  public rejectToolPermission(requestId: string, error: Error, sessionId?: string): void {
    this.permissions.rejectToolPermission(requestId, error, (_reqId) => {
      if (sessionId) {
        void this.logAgentMessageBestEffort(
          sessionId,
          'output',
          JSON.stringify({
            type: 'nimbalyst_tool_result',
            tool_use_id: _reqId,
            result: JSON.stringify({
              decision: 'deny',
              scope: 'once',
              cancelled: true,
              respondedAt: Date.now(),
            }),
            is_error: true,
          })
        );
      }
    });
  }

  public rejectAllPendingPermissions(): void {
    this.permissions.rejectAllPendingPermissions();
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.rejectAllPendingPermissions();
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: true,
      mcpSupport: true,
      edits: true,
      resumeSession: true,
      supportsFileTools: true,
    };
  }

  /**
   * Release resources for a specific session (thread cache, thread ID).
   * Call this when a session is deleted or no longer needed.
   */
  cleanupSession(sessionId: string): void {
    this.codexThreads.delete(sessionId);
    this.sessions.deleteSession(sessionId);
  }

  destroy(): void {
    this.abort();
    this.codexThreads.clear();
    this.sessions.clear();
    this.codexClient = null;
    this.permissions.clearSessionCache();
    this.removeAllListeners();
  }

  private async getCodexClient(): Promise<CodexClientLike> {
    if (this.codexClient) {
      return this.codexClient;
    }

    try {
      const sdkModule = await this.loadSdkModule();
      const codexPathOverride = this.resolveCodexPathOverride();

      this.codexClient = new sdkModule.Codex({
        apiKey: this.apiKey,
        ...(codexPathOverride ? { codexPathOverride } : {}),
      });
      return this.codexClient;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize Codex SDK client: ${message}`);
    }
  }

  private static readonly MAX_CACHED_THREADS = 50;

  private async getOrCreateThread(sessionId: string | undefined, workspacePath: string): Promise<CodexThreadLike> {
    const client = await this.getCodexClient();
    const threadOptions = this.getThreadOptions(workspacePath);

    if (!sessionId) {
      return client.startThread(threadOptions);
    }

    const existingThread = this.codexThreads.get(sessionId);
    if (existingThread) {
      return existingThread;
    }

    // Evict oldest cached threads when the cache exceeds the limit.
    // Also evict the session ID mapping so resume uses the persisted database value
    // rather than a stale in-memory reference.
    if (this.codexThreads.size >= OpenAICodexProvider.MAX_CACHED_THREADS) {
      const firstKey = this.codexThreads.keys().next().value;
      if (firstKey !== undefined) {
        this.codexThreads.delete(firstKey);
        this.sessions.deleteSession(firstKey);
      }
    }

    const existingThreadId = this.sessions.getSessionId(sessionId);
    const thread = existingThreadId
      ? client.resumeThread(existingThreadId, threadOptions)
      : client.startThread(threadOptions);

    this.codexThreads.set(sessionId, thread);
    this.captureAndPersistThreadId(sessionId, thread);
    return thread;
  }

  private getThreadOptions(workspacePath: string): Record<string, unknown> {
    return {
      model: this.getConfiguredModel(),
      workingDirectory: workspacePath,
      skipGitRepoCheck: true,
      // Nimbalyst handles approvals via ToolPermission widget flow.
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write',
      modelReasoningEffort: 'high',
    };
  }

  private getConfiguredModel(): string {
    const configured = this.config?.model || OpenAICodexProvider.DEFAULT_MODEL;
    const parsed = ModelIdentifier.tryParse(configured);
    const resolved = parsed ? parsed.model : configured.replace(/^openai-codex:/, '');
    const normalized = resolved.toLowerCase();
    if (normalized === 'openai-codex-cli' || normalized === 'default' || normalized === 'cli') {
      return 'gpt-5';
    }
    return resolved;
  }

  private buildCodexPrompt(options: {
    systemPrompt: string;
    message: string;
    messages?: Message[];
    shouldBootstrapFromHistory: boolean;
  }): string {
    const parts: string[] = [];

    if (options.systemPrompt) {
      parts.push(`<SYSTEM>\n${options.systemPrompt}\n</SYSTEM>`);
    }

    if (options.shouldBootstrapFromHistory && options.messages && options.messages.length > 0) {
      const history = options.messages
        .filter((msg) => (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') && !!msg.content?.trim())
        .map((msg) => `${msg.role.toUpperCase()}: ${OpenAICodexProvider.sanitizeTagContent(msg.content || '')}`)
        .join('\n\n');
      if (history) {
        parts.push(`<CONVERSATION_HISTORY>\n${history}\n</CONVERSATION_HISTORY>`);
      }
    }

    parts.push(`USER: ${options.message}`);
    return parts.join('\n\n');
  }

  /**
   * Strip XML-like tags that could break out of structured prompt sections.
   * This prevents message content from injecting fake </CONVERSATION_HISTORY>,
   * <SYSTEM>, etc. tags that would alter the prompt structure.
   *
   * Handles bare tags, tags with attributes, and self-closing variants:
   *   <SYSTEM>, </SYSTEM>, <SYSTEM id="x">, <SYSTEM/>, etc.
   */
  private static sanitizeTagContent(content: string): string {
    return content.replace(/<\/?(?:SYSTEM|CONVERSATION_HISTORY|USER)\b[^>]*\/?>/gi, '');
  }

  private appendAttachmentHints(message: string, attachments?: any[]): string {
    if (!attachments || attachments.length === 0) {
      return message;
    }

    const attachmentList = attachments
      .map((attachment) => {
        const displayName =
          attachment.filename ||
          (attachment.filepath ? path.basename(attachment.filepath) : attachment.id || 'attachment');
        return `- ${displayName}${attachment.filepath ? ` (${attachment.filepath})` : ''}`;
      })
      .join('\n');

    return `${message}\n\nAttached files:\n${attachmentList}`;
  }

  private captureAndPersistThreadId(
    sessionId: string | undefined,
    thread: CodexThreadLike,
    runResult?: unknown
  ): void {
    if (!sessionId) {
      return;
    }

    const threadId = thread.id || getThreadIdFromRunResult(runResult);
    if (!threadId) {
      return;
    }

    // captureSessionId is idempotent - skips emit if same value already stored.
    this.sessions.captureSessionId(sessionId, threadId);
  }

  private async ensureCodexTurnPermission(
    sessionId: string | undefined,
    workspacePath: string,
    permissionsPath: string,
    signal: AbortSignal
  ): Promise<{ allowed: boolean; message?: string }> {
    const pathForTrust = permissionsPath || workspacePath;
    let trustMode: PermissionMode = null;

    if (pathForTrust && OpenAICodexProvider.trustChecker) {
      const trustStatus = OpenAICodexProvider.trustChecker(pathForTrust);
      trustMode = trustStatus.mode;

      if (!trustStatus.trusted) {
        this.logSecurity('[OpenAICodexProvider] Workspace not trusted, denying Codex turn', {
          workspacePath: pathForTrust,
        });
        return {
          allowed: false,
          message: 'Workspace is not trusted. Please trust the workspace to use AI tools.',
        };
      }

      // Trusted fast-path modes.
      if (trustStatus.mode === 'bypass-all' || trustStatus.mode === 'allow-all') {
        return { allowed: true };
      }
    }

    // If trust mode is not explicitly "ask", allow by default.
    // This keeps non-Electron/test environments functional even when loaders aren't injected.
    if (trustMode !== 'ask') {
      return { allowed: true };
    }

    const pattern = OpenAICodexProvider.CODEX_EXECUTION_PATTERN;
    if (this.permissions.sessionApprovedPatterns.has(pattern)) {
      this.logSecurity('[OpenAICodexProvider] Pattern already approved this session', { pattern });
      return { allowed: true };
    }

    if (workspacePath && OpenAICodexProvider.permissionPatternChecker) {
      try {
        const isAllowed = await OpenAICodexProvider.permissionPatternChecker(workspacePath, pattern);
        if (isAllowed) {
          this.permissions.sessionApprovedPatterns.add(pattern);
          this.logSecurity('[OpenAICodexProvider] Pattern already allowed in settings', { pattern });
          return { allowed: true };
        }
      } catch (error) {
        this.logSecurity('[OpenAICodexProvider] Failed to check persisted pattern', { error });
      }
    }

    if (!sessionId) {
      return {
        allowed: false,
        message: 'OpenAI Codex permission request requires an active session.',
      };
    }

    const requestId = `tool-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rawCommand = `Allow OpenAI Codex to run agent tools in ${workspacePath}`;
    const patternDisplayName = 'OpenAI Codex agent runs';
    const warnings = ['OpenAI Codex may run shell commands, edit files, and fetch web content during this turn.'];

    await this.logAgentMessageBestEffort(
      sessionId,
      'output',
      JSON.stringify({
        type: 'nimbalyst_tool_use',
        id: requestId,
        name: 'ToolPermission',
        input: {
          requestId,
          toolName: 'OpenAICodex',
          rawCommand,
          pattern,
          patternDisplayName,
          isDestructive: true,
          warnings,
          workspacePath,
        },
      })
    );

    const request = {
      id: requestId,
      toolName: 'OpenAICodex',
      rawCommand,
      actionsNeedingApproval: [{
        action: {
          pattern,
          displayName: patternDisplayName,
          command: rawCommand,
          isDestructive: true,
          referencedPaths: [],
          hasRedirection: false,
        },
        decision: 'ask' as const,
        reason: 'OpenAI Codex turn requires user approval',
        isDestructive: true,
        isRisky: true,
        warnings,
        outsidePaths: [],
        sensitivePaths: [],
      }],
      hasDestructiveActions: true,
      createdAt: Date.now(),
    };

    const responsePromise = new Promise<{ decision: 'allow' | 'deny'; scope: ToolPermissionScope }>((resolve, reject) => {
      this.permissions.pendingToolPermissions.set(requestId, {
        resolve,
        reject,
        request,
      });

      signal.addEventListener('abort', () => {
        this.permissions.pendingToolPermissions.delete(requestId);
        reject(new Error('Request aborted'));
      }, { once: true });
    });

    this.pollForPermissionResponse(sessionId, requestId, signal).catch(() => {
      // Polling failure does not block IPC response path.
    });

    this.emit('toolPermission:pending', {
      requestId,
      sessionId,
      workspacePath,
      request,
      timestamp: Date.now(),
    });

    try {
      const response = await responsePromise;

      if (response.decision === 'allow' && response.scope !== 'once') {
        this.permissions.sessionApprovedPatterns.add(pattern);
      }

      if (
        response.decision === 'allow' &&
        (response.scope === 'always' || response.scope === 'always-all') &&
        workspacePath &&
        OpenAICodexProvider.permissionPatternSaver
      ) {
        try {
          await OpenAICodexProvider.permissionPatternSaver(workspacePath, pattern);
        } catch (error) {
          console.error('[OPENAI-CODEX] Failed to persist permission pattern:', error);
        }
      }

      this.emit('toolPermission:resolved', {
        requestId,
        sessionId,
        response,
        timestamp: Date.now(),
      });

      if (response.decision === 'allow') {
        return { allowed: true };
      }

      return {
        allowed: false,
        message: 'OpenAI Codex turn denied by user',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Permission request cancelled';
      return {
        allowed: false,
        message,
      };
    }
  }

  private async pollForPermissionResponse(
    sessionId: string,
    requestId: string,
    signal: AbortSignal
  ): Promise<void> {
    try {
      AgentMessagesRepository.getStore();
    } catch {
      return;
    }

    const initialPollInterval = 500;
    const maxPollInterval = 5000;
    const maxPollTime = 10 * 60 * 1000;
    const startTime = Date.now();
    const pollLimit = 50;
    let currentInterval = initialPollInterval;

    while (!signal.aborted && Date.now() - startTime < maxPollTime) {
      if (!this.permissions.pendingToolPermissions.has(requestId)) {
        return;
      }

      try {
        const messages = await AgentMessagesRepository.list(sessionId, { limit: pollLimit });

        for (const msg of messages) {
          // Fast-path: skip messages that can't contain our requestId.
          if (!msg.content.includes(requestId)) {
            continue;
          }

          try {
            const content = JSON.parse(msg.content);

            if (content.type === 'nimbalyst_tool_result' && content.tool_use_id === requestId) {
              const result = typeof content.result === 'string' ? JSON.parse(content.result) : content.result;
              if (!OpenAICodexProvider.isValidPermissionResponse(result)) {
                this.logSecurity('[OpenAICodexProvider] Invalid permission response shape', { requestId, result });
                continue;
              }
              const pending = this.permissions.pendingToolPermissions.get(requestId);
              if (pending) {
                pending.resolve({ decision: result.decision, scope: result.scope });
                this.permissions.pendingToolPermissions.delete(requestId);
                this.logSecurity('[OpenAICodexProvider] Found nimbalyst_tool_result response', {
                  requestId,
                  decision: result.decision,
                  scope: result.scope,
                });
              }
              return;
            }

            // Legacy compatibility for older response message format.
            if (content.type === 'permission_response' && content.requestId === requestId) {
              if (!OpenAICodexProvider.isValidPermissionResponse(content)) {
                this.logSecurity('[OpenAICodexProvider] Invalid legacy permission response shape', { requestId, content });
                continue;
              }
              const pending = this.permissions.pendingToolPermissions.get(requestId);
              if (pending) {
                pending.resolve({ decision: content.decision, scope: content.scope });
                this.permissions.pendingToolPermissions.delete(requestId);
                this.logSecurity('[OpenAICodexProvider] Found legacy permission_response', {
                  requestId,
                  decision: content.decision,
                  scope: content.scope,
                });
              }
              return;
            }
          } catch {
            // Skip non-JSON messages.
          }
        }
      } catch (error) {
        this.logSecurity('[OpenAICodexProvider] Error polling for permission response', { error });
      }

      await new Promise(resolve => setTimeout(resolve, currentInterval));
      // Exponential backoff: user responses are fast (< 2s) or very slow (manual).
      currentInterval = Math.min(currentInterval * 1.5, maxPollInterval);
    }

    // Polling timed out - reject the pending promise so ensureCodexTurnPermission doesn't hang.
    const pending = this.permissions.pendingToolPermissions.get(requestId);
    if (pending) {
      pending.reject(new Error('Permission request timed out'));
      this.permissions.pendingToolPermissions.delete(requestId);
    }
  }

  private static readonly VALID_DECISIONS = new Set(['allow', 'deny']);
  private static readonly VALID_SCOPES = new Set(['once', 'session', 'always', 'always-all']);

  private static isValidPermissionResponse(value: unknown): value is { decision: 'allow' | 'deny'; scope: ToolPermissionScope } {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record.decision === 'string' &&
      OpenAICodexProvider.VALID_DECISIONS.has(record.decision) &&
      typeof record.scope === 'string' &&
      OpenAICodexProvider.VALID_SCOPES.has(record.scope)
    );
  }

  private logSecurity(message: string, data?: any): void {
    OpenAICodexProvider.securityLogger?.(message, data);
  }

  private async logAgentMessageBestEffort(
    sessionId: string,
    direction: 'input' | 'output',
    content: string
  ): Promise<void> {
    try {
      AgentMessagesRepository.getStore();
    } catch {
      return;
    }

    try {
      await this.logAgentMessage(sessionId, 'openai-codex', direction, content, undefined, false, undefined, true);
    } catch {
      // Runtime unit tests and some non-Electron contexts don't provide the AgentMessagesRepository adapter.
      // Logging is best-effort for this provider and should not fail the request flow.
    }
  }
}
