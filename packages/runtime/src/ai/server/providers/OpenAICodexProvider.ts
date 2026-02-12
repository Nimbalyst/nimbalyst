import path from 'path';
import { BaseAgentProvider } from './BaseAgentProvider';
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
import { CodexSDKProtocol } from '../protocols/CodexSDKProtocol';
import { ProtocolEvent } from '../protocols/ProtocolInterface';
import { ToolPermissionService } from '../permissions/ToolPermissionService';
import { PermissionMode, TrustChecker, PermissionPatternSaver, PermissionPatternChecker, SecurityLogger } from './ProviderPermissionMixin';
import { CodexSdkModuleLike, loadCodexSdkModule } from './codex/codexSdkLoader';
import { resolvePackagedCodexBinaryPath } from './codex/codexBinaryPath';

interface OpenAICodexProviderDeps {
  protocol?: CodexSDKProtocol;
  permissionService?: ToolPermissionService;
  // Legacy: for existing tests that mock the SDK loader
  loadSdkModule?: () => Promise<CodexSdkModuleLike>;
  resolveCodexPathOverride?: () => string | undefined;
}

export class OpenAICodexProvider extends BaseAgentProvider {
  static readonly DEFAULT_MODEL = DEFAULT_MODELS['openai-codex'];
  private static readonly CODEX_EXECUTION_PATTERN = 'OpenAICodex(agent-run:*)';

  private readonly protocol: CodexSDKProtocol;
  private readonly permissionService: ToolPermissionService;

  constructor(config?: { apiKey?: string }, deps?: OpenAICodexProviderDeps) {
    super();
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';

    // Initialize protocol (or use injected for testing)
    // Support legacy loadSdkModule and resolveCodexPathOverride for existing tests
    if (deps?.protocol) {
      this.protocol = deps.protocol;
    } else if (deps?.loadSdkModule || deps?.resolveCodexPathOverride) {
      const loadSdk = deps.loadSdkModule ?? loadCodexSdkModule;
      const resolveCodexPath = deps.resolveCodexPathOverride ?? resolvePackagedCodexBinaryPath;
      this.protocol = new CodexSDKProtocol(apiKey, loadSdk, resolveCodexPath);
    } else {
      this.protocol = new CodexSDKProtocol(apiKey);
    }

    // Initialize permission service (or use injected for testing)
    if (deps?.permissionService) {
      this.permissionService = deps.permissionService;
    } else {
      // Validate required dependencies
      if (!BaseAgentProvider.trustChecker) {
        throw new Error('[OpenAICodexProvider] trustChecker must be set via setTrustChecker() before creating provider instances');
      }
      if (!BaseAgentProvider.permissionPatternSaver) {
        throw new Error('[OpenAICodexProvider] permissionPatternSaver must be set via setPermissionPatternSaver() before creating provider instances');
      }
      if (!BaseAgentProvider.permissionPatternChecker) {
        throw new Error('[OpenAICodexProvider] permissionPatternChecker must be set via setPermissionPatternChecker() before creating provider instances');
      }
      if (!BaseAgentProvider.securityLogger) {
        throw new Error('[OpenAICodexProvider] securityLogger must be set via setSecurityLogger() before creating provider instances');
      }

      // TypeScript doesn't understand that the throw statements guarantee non-null here
      // Use type assertions after validation
      this.permissionService = new ToolPermissionService({
        trustChecker: BaseAgentProvider.trustChecker as TrustChecker,
        patternSaver: BaseAgentProvider.permissionPatternSaver as PermissionPatternSaver,
        patternChecker: BaseAgentProvider.permissionPatternChecker as PermissionPatternChecker,
        securityLogger: BaseAgentProvider.securityLogger as SecurityLogger,
        emit: this.emit.bind(this),
      });
    }
  }

  getProviderName(): string {
    return 'openai-codex';
  }

  public static setTrustChecker(checker: TrustChecker | null): void {
    BaseAgentProvider.setTrustChecker(checker);
  }

  public static setPermissionPatternSaver(saver: PermissionPatternSaver | null): void {
    BaseAgentProvider.setPermissionPatternSaver(saver);
  }

  public static setPermissionPatternChecker(checker: PermissionPatternChecker | null): void {
    BaseAgentProvider.setPermissionPatternChecker(checker);
  }

  public static setSecurityLogger(logger: SecurityLogger | null): void {
    BaseAgentProvider.setSecurityLogger(logger);
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    // Note: API key is set during construction and managed by the protocol
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

    const systemPrompt = this.buildSystemPrompt(documentContext);
    const { userMessageAddition, messageWithContext } = buildUserMessageAddition(message, documentContext);
    const messageWithAttachmentHints = this.appendAttachmentHints(messageWithContext, attachments);

    // Emit prompt additions for UI
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

    // Build prompt with system prompt and user message
    // Note: Never include conversation history when resuming threads - the SDK maintains thread state
    const prompt = this.buildCodexPrompt({
      systemPrompt,
      message: messageWithAttachmentHints,
      messages,
      shouldBootstrapFromHistory: false, // Always false - Codex SDK maintains thread history
    });

    if (sessionId) {
      await this.logAgentMessageBestEffort(sessionId, 'input', prompt);
    }

    const permissionsPath = documentContext?.permissionsPath || workspacePath;
    const abortController = new AbortController();
    this.abortController = abortController;

    let fullText = '';

    try {
      // Check permission using ToolPermissionService
      const permissionDecision = await this.requestCodexTurnPermission(
        sessionId,
        workspacePath,
        permissionsPath,
        abortController.signal
      );

      if (permissionDecision.decision !== 'allow') {
        yield {
          type: 'error',
          error: 'OpenAI Codex turn denied by user',
        };
        return;
      }

      // Get or create protocol session
      const existingSessionId = this.sessions.getSessionId(sessionId || '');
      console.log('[CODEX] Session lookup:', {
        sessionId,
        existingSessionId,
        action: existingSessionId ? 'RESUME' : 'CREATE'
      });

      const session = existingSessionId
        ? await this.protocol.resumeSession(existingSessionId, {
            workspacePath,
            model: this.getConfiguredModel(),
            raw: {
              systemPrompt,
              abortSignal: abortController.signal,
            },
          })
        : await this.protocol.createSession({
            workspacePath,
            model: this.getConfiguredModel(),
            raw: {
              systemPrompt,
              abortSignal: abortController.signal,
            },
          });

      console.log('[CODEX] Session after create/resume:', {
        sessionId,
        protocolSessionId: session.id,
        existingSessionId
      });

      // Send message using protocol
      for await (const event of this.protocol.sendMessage(session, { content: prompt })) {
        if (abortController.signal.aborted) {
          throw new Error('Operation cancelled');
        }

        // Store EACH raw event immediately as a separate database row
        if (sessionId) {
          await this.storeRawEventIfPresent(event, sessionId);
        }

        // Convert protocol events to stream chunks
        if (event.type === 'error') {
          yield { type: 'error', error: event.error };
        } else if (event.type === 'reasoning') {
          // Don't yield reasoning events - they're stored but not part of the visible stream
        } else if (event.type === 'text') {
          fullText += event.content;
          yield { type: 'text', content: event.content };
        } else if (event.type === 'tool_call') {
          yield { type: 'tool_call', toolCall: event.toolCall };
        } else if (event.type === 'complete') {
          yield {
            type: 'complete',
            content: event.content,
            isComplete: true,
            usage: event.usage,
          };
        }
      }

      // Capture session ID after stream completes (thread ID is only available after first run)
      if (sessionId && session.id && session.id !== existingSessionId) {
        console.log('[CODEX] Capturing session ID after stream:', {
          nimbalystSessionId: sessionId,
          codexThreadId: session.id
        });
        this.sessions.captureSessionId(sessionId, session.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAbort = abortController.signal.aborted || /abort|cancel/i.test(errorMessage);
      if (!isAbort) {
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

  /**
   * Resolve a pending tool permission request
   * Delegates to ToolPermissionService
   */
  resolveToolPermission(
    requestId: string,
    response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' },
    sessionId?: string,
    respondedBy: 'desktop' | 'mobile' = 'desktop'
  ): void {
    // Resolve via service
    this.permissionService.resolvePermission(requestId, response);

    // Log result for mobile/cross-device polling
    if (sessionId) {
      void this.logAgentMessageBestEffort(
        sessionId,
        'output',
        this.createPermissionResultMessage(requestId, response, respondedBy)
      );
    }
  }

  abort(): void {
    // Reject all pending permissions via service
    this.permissionService.rejectAllPending();
    // Call base class abort (handles abortController)
    super.abort();
  }

  /**
   * Release resources for a specific session.
   * Call this when a session is deleted or no longer needed.
   */
  cleanupSession(sessionId: string): void {
    this.sessions.deleteSession(sessionId);
  }

  destroy(): void {
    // Clear permission service caches
    this.permissionService.clearSessionCache();
    // Call base class destroy (calls abort, sessions.clear, permissions.clearSessionCache, removeAllListeners)
    super.destroy();
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

  /**
   * Store a raw protocol event to the database if present in event metadata.
   * Each raw event is stored as a separate database row for Codex event tracking.
   */
  private async storeRawEventIfPresent(
    event: ProtocolEvent,
    sessionId: string
  ): Promise<void> {
    if (event.metadata?.rawEvent) {
      await this.logAgentMessage(
        sessionId,
        this.getProviderName(),
        'output',
        JSON.stringify(event.metadata.rawEvent),
        {
          eventType: event.type,
          codexProvider: true,
        },
        false, // not hidden
        undefined, // no provider message ID
        false // not searchable - raw events are not for search
      );
    }
  }


  /**
   * Request permission for an OpenAI Codex agent turn
   *
   * Uses ToolPermissionService to handle the full permission flow.
   */
  private async requestCodexTurnPermission(
    sessionId: string | undefined,
    workspacePath: string,
    permissionsPath: string,
    signal: AbortSignal
  ): Promise<{ decision: 'allow' | 'deny' }> {
    const pathForTrust = permissionsPath || workspacePath;

    // Check trust status
    if (pathForTrust && BaseAgentProvider.trustChecker) {
      const trustStatus = BaseAgentProvider.trustChecker(pathForTrust);

      if (!trustStatus.trusted) {
        this.logSecurity('[OpenAICodexProvider] Workspace not trusted, denying Codex turn', {
          workspacePath: pathForTrust,
        });
        return { decision: 'deny' };
      }

      // Trusted fast-path modes
      if (trustStatus.mode === 'bypass-all' || trustStatus.mode === 'allow-all') {
        return { decision: 'allow' };
      }

      // If trust mode is not explicitly "ask", allow by default
      if (trustStatus.mode !== 'ask') {
        return { decision: 'allow' };
      }
    } else {
      // No trust checker - allow by default (non-Electron environments)
      return { decision: 'allow' };
    }

    const pattern = OpenAICodexProvider.CODEX_EXECUTION_PATTERN;

    // Check if pattern already approved
    if (await this.permissionService.isPatternApproved(workspacePath, pattern)) {
      this.logSecurity('[OpenAICodexProvider] Pattern already approved', { pattern });
      return { decision: 'allow' };
    }

    if (!sessionId) {
      this.logSecurity('[OpenAICodexProvider] No session ID for permission request', {});
      return { decision: 'deny' };
    }

    // Request permission via service
    const requestId = `tool-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rawCommand = `Allow OpenAI Codex to run agent tools in ${workspacePath}`;
    const patternDisplayName = 'OpenAI Codex agent runs';
    const warnings = ['OpenAI Codex may run shell commands, edit files, and fetch web content during this turn.'];

    // Log tool use for UI
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

    // Create request structure for UI widget
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

    // Emit pending event for UI
    this.emit('toolPermission:pending', {
      requestId,
      sessionId,
      workspacePath,
      request,
      timestamp: Date.now(),
    });

    try {
      // Request permission via service
      const response = await this.permissionService.requestPermission({
        requestId,
        sessionId,
        workspacePath,
        permissionsPath,
        pattern,
        patternDisplayName,
        rawCommand,
        warnings,
        isDestructive: true,
        signal,
      });

      // Emit resolved event for UI
      this.emit('toolPermission:resolved', {
        requestId,
        sessionId,
        response,
        timestamp: Date.now(),
      });

      return { decision: response.decision };
    } catch (error) {
      this.logSecurity('[OpenAICodexProvider] Permission request failed', { error });
      return { decision: 'deny' };
    }
  }

}
