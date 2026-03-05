import path from 'path';
import crypto from 'crypto';
import OpenAI from 'openai';
import { BaseAgentProvider } from './BaseAgentProvider';
import { buildUserMessageAddition } from './documentContextUtils';
import { buildClaudeCodeSystemPrompt } from '../../prompt';
import { DEFAULT_MODELS } from '../../modelConstants';
import { AIToolCall, AIToolResult } from '../../types';
import {
  ProviderConfig,
  DocumentContext,
  StreamChunk,
  Message,
  ProviderCapabilities,
  AIModel,
  AIProviderType,
  ModelIdentifier,
  ChatAttachment,
} from '../types';
import { CodexSDKProtocol } from '../protocols/CodexSDKProtocol';
import { ProtocolEvent, ProtocolSession } from '../protocols/ProtocolInterface';
import { ToolPermissionService } from '../permissions/ToolPermissionService';
import { PermissionMode, TrustChecker, PermissionPatternSaver, PermissionPatternChecker, SecurityLogger } from './ProviderPermissionMixin';
import { CodexSdkModuleLike, loadCodexSdkModule } from './codex/codexSdkLoader';
import { resolvePackagedCodexBinaryPath } from './codex/codexBinaryPath';
import { McpConfigService } from '../services/McpConfigService';
import { MCPServerConfig } from '../../../types/MCPServerConfig';
import { safeJSONSerialize } from '../../../utils/serialization';
import { AskUserQuestionPrompt, AskUserQuestionPromptOption } from './shared/askUserQuestionTypes';

interface OpenAICodexProviderDeps {
  protocol?: CodexSDKProtocol;
  permissionService?: ToolPermissionService;
  // Legacy: for existing tests that mock the SDK loader
  loadSdkModule?: () => Promise<CodexSdkModuleLike>;
  resolveCodexPathOverride?: () => string | undefined;
}

interface OpenAICodexModelDiscoveryDeps {
  loadSdkModule?: () => Promise<CodexSdkModuleLike>;
}

interface PendingAskUserQuestionEntry {
  questions: AskUserQuestionPrompt[];
  sessionId: string;
}

export class OpenAICodexProvider extends BaseAgentProvider {
  static readonly DEFAULT_MODEL = DEFAULT_MODELS['openai-codex'];
  private static readonly CODEX_EXECUTION_PATTERN = 'OpenAICodex(agent-run:*)';
  private static readonly SESSION_NAMING_REMINDER_PROMPT =
    'Reminder: call the session metadata tool now before continuing. ' +
    'Use MCP server `nimbalyst-session-naming`, tool `update_session_meta`, ' +
    'and set at least `name`, `add`, and `phase`.';
  private static readonly FALLBACK_MODELS: ReadonlyArray<{
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
  }> = [
    { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 400000, maxTokens: 128000 },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', contextWindow: 400000, maxTokens: 128000 },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', contextWindow: 400000, maxTokens: 128000 },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', contextWindow: 400000, maxTokens: 128000 },
    { id: 'gpt-5.2', name: 'GPT-5.2', contextWindow: 128000, maxTokens: 128000 },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', contextWindow: 400000, maxTokens: 128000 },
  ];
  private static readonly MODEL_FALLBACK_PRIORITY: ReadonlyArray<string> = [
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'gpt-5.2',
  ];
  private static readonly FALLBACK_MODELS_SET = new Set(
    OpenAICodexProvider.FALLBACK_MODELS.map((model) => model.id)
  );
  private static readonly FALLBACK_MODELS_BY_ID = new Map(
    OpenAICodexProvider.FALLBACK_MODELS.map((model) => [model.id, model])
  );
  private static readonly MODEL_ID_CACHE_DURATION_MS = 5 * 60 * 1000;
  private static readonly MODEL_ID_CACHE_MAX_SIZE = 100;
  private static readonly MODEL_ID_CACHE = new Map<string, { fetchedAt: number; ids: Set<string> }>();

  private readonly apiKey: string;
  private readonly protocol: CodexSDKProtocol;
  private readonly permissionService: ToolPermissionService;
  private readonly mcpConfigService: McpConfigService;
  private readonly pendingAskUserQuestions = new Map<string, PendingAskUserQuestionEntry>();

  // Analytics initialization data, captured during first sendMessage call
  private _initData: {
    model: string;
    mcpServerCount: number;
    isResumedThread: boolean;
    permissionMode: string | null;
  } | null = null;

  // Shared MCP server port (injected from electron main process)
  // This server provides capture_editor_screenshot tool.
  private static mcpServerPort: number | null = null;

  // Session naming MCP server port (injected from electron main process)
  private static sessionNamingServerPort: number | null = null;

  // Extension dev MCP server port (injected from electron main process)
  private static extensionDevServerPort: number | null = null;

  // Super Loop progress MCP server port (injected from electron main process)
  private static superLoopProgressServerPort: number | null = null;

  // Session context MCP server port (injected from electron main process)
  private static sessionContextServerPort: number | null = null;

  // MCP config loader (injected from electron main process)
  // Returns merged user + workspace MCP servers
  private static mcpConfigLoader: ((workspacePath?: string) => Promise<Record<string, MCPServerConfig>>) | null = null;

  // Claude settings env vars loader (injected from electron main process)
  // Reused by MCP config expansion logic for ${VAR} interpolation
  private static claudeSettingsEnvLoader: (() => Promise<Record<string, string>>) | null = null;

  // Shell environment loader (injected from electron main process)
  // Reused by MCP config expansion logic for ${VAR} interpolation
  private static shellEnvironmentLoader: (() => Record<string, string> | null) | null = null;

  // Enhanced PATH loader (injected from electron main process)
  // Returns a PATH string that includes common CLI installation locations
  // (Homebrew, nvm, volta, etc.) that are missing from Electron's minimal GUI PATH
  private static enhancedPathLoader: (() => string) | null = null;

  // SDK module loader (injected from electron main process for packaged builds)
  // In packaged builds, dynamic import('@openai/codex-sdk') fails because the
  // package isn't resolvable from within app.asar. This loader provides an
  // alternative resolution path using process.resourcesPath.
  private static sdkModuleLoader: (() => Promise<CodexSdkModuleLike>) | null = null;

  constructor(config?: { apiKey?: string }, deps?: OpenAICodexProviderDeps) {
    super();
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
    this.apiKey = apiKey;

    // Initialize protocol (or use injected for testing)
    // Support legacy loadSdkModule and resolveCodexPathOverride for existing tests
    if (deps?.protocol) {
      this.protocol = deps.protocol;
    } else if (deps?.loadSdkModule || deps?.resolveCodexPathOverride) {
      const loadSdk = deps.loadSdkModule ?? loadCodexSdkModule;
      const resolveCodexPath = deps.resolveCodexPathOverride ?? resolvePackagedCodexBinaryPath;
      this.protocol = new CodexSDKProtocol(apiKey, loadSdk, resolveCodexPath);
    } else {
      this.protocol = new CodexSDKProtocol(
        apiKey,
        OpenAICodexProvider.sdkModuleLoader ?? loadCodexSdkModule,
        resolvePackagedCodexBinaryPath
      );
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
      // TypeScript doesn't understand that the throw statements guarantee non-null here
      // Use type assertions after validation
      this.permissionService = new ToolPermissionService({
        trustChecker: BaseAgentProvider.trustChecker as TrustChecker,
        patternSaver: BaseAgentProvider.permissionPatternSaver as PermissionPatternSaver,
        patternChecker: BaseAgentProvider.permissionPatternChecker as PermissionPatternChecker,
        securityLogger: BaseAgentProvider.securityLogger ?? undefined,
        emit: this.emit.bind(this),
      });
    }

    this.mcpConfigService = new McpConfigService({
      mcpServerPort: OpenAICodexProvider.mcpServerPort,
      sessionNamingServerPort: OpenAICodexProvider.sessionNamingServerPort,
      extensionDevServerPort: OpenAICodexProvider.extensionDevServerPort,
      superLoopProgressServerPort: null, // Disabled - was leaking into non-super-loop sessions
      sessionContextServerPort: OpenAICodexProvider.sessionContextServerPort,
      mcpConfigLoader: OpenAICodexProvider.mcpConfigLoader,
      extensionPluginsLoader: null,
      claudeSettingsEnvLoader: OpenAICodexProvider.claudeSettingsEnvLoader,
      shellEnvironmentLoader: OpenAICodexProvider.shellEnvironmentLoader,
    });
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

  public static setMcpServerPort(port: number | null): void {
    OpenAICodexProvider.mcpServerPort = port;
  }

  public static setSessionNamingServerPort(port: number | null): void {
    OpenAICodexProvider.sessionNamingServerPort = port;
  }

  public static setExtensionDevServerPort(port: number | null): void {
    OpenAICodexProvider.extensionDevServerPort = port;
  }

  public static setSuperLoopProgressServerPort(port: number | null): void {
    OpenAICodexProvider.superLoopProgressServerPort = port;
  }

  public static setSessionContextServerPort(port: number | null): void {
    OpenAICodexProvider.sessionContextServerPort = port;
  }

  public static setMCPConfigLoader(loader: ((workspacePath?: string) => Promise<Record<string, MCPServerConfig>>) | null): void {
    OpenAICodexProvider.mcpConfigLoader = loader;
  }

  public static setClaudeSettingsEnvLoader(loader: (() => Promise<Record<string, string>>) | null): void {
    OpenAICodexProvider.claudeSettingsEnvLoader = loader;
  }

  public static setShellEnvironmentLoader(loader: (() => Record<string, string> | null) | null): void {
    OpenAICodexProvider.shellEnvironmentLoader = loader;
  }

  public static setEnhancedPathLoader(loader: (() => string) | null): void {
    OpenAICodexProvider.enhancedPathLoader = loader;
  }

  public static setSdkModuleLoader(loader: (() => Promise<CodexSdkModuleLike>) | null): void {
    OpenAICodexProvider.sdkModuleLoader = loader;
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
  private static readonly MODEL_REPLACEMENTS = new Map<string, string>([
    ['gpt-5', 'gpt-5.2'],
    ['gpt-5-codex', 'gpt-5.4'],
    ['gpt-5.4-codex', 'gpt-5.4'],
    ['gpt-5-codex-mini', 'gpt-5.1-codex-mini'],
    ['gpt-5.2-codex-mini', 'gpt-5.2-codex'],
    ['gpt-5.2-codex-max', 'gpt-5.2-codex'],
    ['gpt-5-codex-max', 'gpt-5.1-codex-max'],
    ['gpt-5.1-codex', 'gpt-5.2-codex'],
    ['gpt-5.3-codex-mini', 'gpt-5.3-codex'],
    ['gpt-5.3-codex-max', 'gpt-5.3-codex'],
    ['codex-mini-latest', 'gpt-5.1-codex-mini'],
  ]);

  /**
   * Normalize a single model ID, mapping legacy aliases to the canonical form.
   */
  static normalizeModelSelection(modelId: string): string {
    const normalized = modelId.trim().toLowerCase();
    if (OpenAICodexProvider.LEGACY_MODEL_ALIASES.has(normalized)) {
      return 'openai-codex:gpt-5.4';
    }

    const parsed = ModelIdentifier.tryParse(modelId);
    const rawModelId = parsed && parsed.provider === 'openai-codex'
      ? parsed.model
      : modelId.replace(/^openai-codex:/, '');
    const replacement = OpenAICodexProvider.MODEL_REPLACEMENTS.get(rawModelId.toLowerCase());
    if (replacement) {
      return ModelIdentifier.create('openai-codex', replacement).combined;
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

  static async getModels(
    apiKey?: string,
    deps?: OpenAICodexModelDiscoveryDeps,
  ): Promise<AIModel[]> {
    const sdkModels = await OpenAICodexProvider.getModelsFromSdk(apiKey, deps);
    const apiModels = await OpenAICodexProvider.getModelsFromOpenAI(apiKey);
    return OpenAICodexProvider.getPreferredModels(sdkModels, apiModels);
  }

  private static getFallbackModels() {
    return OpenAICodexProvider.FALLBACK_MODELS.map((model) => ({
      id: ModelIdentifier.create('openai-codex', model.id).combined,
      name: model.name,
      provider: 'openai-codex' as AIProviderType,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }));
  }

  private static getPreferredModels(...sourceLists: AIModel[][]): AIModel[] {
    const metadataById = new Map<string, AIModel>();

    for (const sourceModels of sourceLists) {
      for (const sourceModel of sourceModels) {
        const rawId = OpenAICodexProvider.toRawModelId(sourceModel.id);
        if (!rawId) {
          continue;
        }
        if (!OpenAICodexProvider.FALLBACK_MODELS_SET.has(rawId)) {
          continue;
        }
        if (!metadataById.has(rawId)) {
          metadataById.set(rawId, sourceModel);
        }
      }
    }

    return OpenAICodexProvider.FALLBACK_MODELS.map((fallbackModel) => {
      const discovered = metadataById.get(fallbackModel.id);
      return {
        id: ModelIdentifier.create('openai-codex', fallbackModel.id).combined,
        name: discovered?.name || fallbackModel.name,
        provider: 'openai-codex' as AIProviderType,
        contextWindow: discovered?.contextWindow ?? fallbackModel.contextWindow,
        maxTokens: discovered?.maxTokens ?? fallbackModel.maxTokens,
      };
    });
  }

  private static async getModelsFromSdk(
    apiKey?: string,
    deps?: OpenAICodexModelDiscoveryDeps,
  ): Promise<AIModel[]> {
    const loadSdk = deps?.loadSdkModule ?? OpenAICodexProvider.sdkModuleLoader ?? loadCodexSdkModule;

    try {
      const sdkModule = await loadSdk();
      const sdkAsAny = sdkModule as any;
      const fetchers: Array<() => Promise<unknown>> = [];

      if (typeof sdkAsAny.listModels === 'function') {
        fetchers.push(() => Promise.resolve(sdkAsAny.listModels()));
      }
      if (typeof sdkAsAny.getModels === 'function') {
        fetchers.push(() => Promise.resolve(sdkAsAny.getModels()));
      }

      try {
        const codex = new sdkModule.Codex(apiKey ? { apiKey } : undefined) as any;
        if (typeof codex?.listModels === 'function') {
          fetchers.push(() => Promise.resolve(codex.listModels()));
        }
        if (typeof codex?.getModels === 'function') {
          fetchers.push(() => Promise.resolve(codex.getModels()));
        }
        if (codex?.models && typeof codex.models.list === 'function') {
          fetchers.push(() => Promise.resolve(codex.models.list()));
        }
      } catch {
        // Client construction can fail when the Codex CLI binary is unavailable.
      }

      // Try all fetchers in parallel, return first successful result
      const results = await Promise.allSettled(fetchers.map((fn) => fn()));
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const mapped = OpenAICodexProvider.mapSdkModelResult(result.value);
          if (mapped.length > 0) {
            return mapped;
          }
        }
      }
    } catch {
      // SDK is optional and may be unavailable in some environments.
      return [];
    }

    return [];
  }

  private static async getModelsFromOpenAI(apiKey?: string): Promise<AIModel[]> {
    if (!apiKey) {
      return [];
    }

    try {
      const availableIds = await OpenAICodexProvider.getAvailableModelIds(apiKey);
      if (availableIds.size === 0) {
        return [];
      }

      const models: AIModel[] = [];

      for (const fallbackModel of OpenAICodexProvider.FALLBACK_MODELS) {
        if (!availableIds.has(fallbackModel.id)) {
          continue;
        }
        models.push({
          id: ModelIdentifier.create('openai-codex', fallbackModel.id).combined,
          name: fallbackModel.name,
          provider: 'openai-codex' as AIProviderType,
          contextWindow: fallbackModel.contextWindow,
          maxTokens: fallbackModel.maxTokens,
        });
      }

      const extraCodexModelIds = Array.from(availableIds)
        .filter((id) => id.toLowerCase().includes('codex') && !OpenAICodexProvider.FALLBACK_MODELS_BY_ID.has(id))
        .sort((a, b) => a.localeCompare(b));

      for (const modelId of extraCodexModelIds) {
        models.push({
          id: ModelIdentifier.create('openai-codex', modelId).combined,
          name: modelId,
          provider: 'openai-codex' as AIProviderType,
        });
      }

      return models;
    } catch {
      // API model listing is best-effort; fall back to static catalog when unavailable.
      return [];
    }
  }

  private static async getAvailableModelIds(apiKey: string): Promise<Set<string>> {
    const cacheKey = OpenAICodexProvider.hashApiKey(apiKey);
    const now = Date.now();
    const cached = OpenAICodexProvider.MODEL_ID_CACHE.get(cacheKey);
    if (cached && now - cached.fetchedAt < OpenAICodexProvider.MODEL_ID_CACHE_DURATION_MS) {
      return cached.ids;
    }

    const openai = new OpenAI({ apiKey });
    const response = await openai.models.list();
    const ids = new Set(response.data.map((model) => model.id));

    // Implement LRU eviction
    if (OpenAICodexProvider.MODEL_ID_CACHE.size >= OpenAICodexProvider.MODEL_ID_CACHE_MAX_SIZE) {
      const oldestKey = OpenAICodexProvider.MODEL_ID_CACHE.keys().next().value;
      if (oldestKey) {
        OpenAICodexProvider.MODEL_ID_CACHE.delete(oldestKey);
      }
    }

    OpenAICodexProvider.MODEL_ID_CACHE.set(cacheKey, { fetchedAt: now, ids });
    return ids;
  }

  private static hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  private static mapSdkModelResult(rawModels: unknown): AIModel[] {
    const candidates = OpenAICodexProvider.extractModelCandidates(rawModels);
    const seen = new Set<string>();
    const models: AIModel[] = [];

    for (const candidate of candidates) {
      const normalized = OpenAICodexProvider.normalizeModelCandidate(candidate);
      if (!normalized) {
        continue;
      }
      if (seen.has(normalized.id)) {
        continue;
      }
      seen.add(normalized.id);
      models.push(normalized);
    }

    return models;
  }

  private static toRawModelId(modelId: string): string | null {
    const normalizedSelection = OpenAICodexProvider.normalizeModelSelection(modelId);
    const parsed = ModelIdentifier.tryParse(normalizedSelection);
    const rawModelId = parsed && parsed.provider === 'openai-codex'
      ? parsed.model
      : normalizedSelection.replace(/^openai-codex:/, '');
    return rawModelId || null;
  }

  private static extractModelCandidates(rawModels: unknown): unknown[] {
    if (Array.isArray(rawModels)) {
      return rawModels;
    }

    if (rawModels && typeof rawModels === 'object') {
      const container = rawModels as Record<string, unknown>;
      const candidateKeys = ['data', 'models', 'items'];
      for (const key of candidateKeys) {
        if (Array.isArray(container[key])) {
          return container[key] as unknown[];
        }
      }
    }

    return [];
  }

  private static normalizeModelCandidate(candidate: unknown): AIModel | null {
    const MAX_STRING_LENGTH = 256;
    const MAX_CONTEXT_WINDOW = 10_000_000;
    const MAX_TOKENS = 10_000_000;

    let modelId: string | undefined;
    let modelName: string | undefined;
    let contextWindow: number | undefined;
    let maxTokens: number | undefined;

    if (typeof candidate === 'string') {
      modelId = candidate;
    } else if (candidate && typeof candidate === 'object') {
      const entry = candidate as Record<string, unknown>;
      modelId = OpenAICodexProvider.readStringField(entry, ['id', 'model']);
      modelName = OpenAICodexProvider.readStringField(entry, ['displayName', 'display_name', 'name']);
      contextWindow = OpenAICodexProvider.readNumberField(entry, [
        'contextWindow',
        'context_window',
        'inputTokenLimit',
        'input_token_limit',
      ]);
      maxTokens = OpenAICodexProvider.readNumberField(entry, [
        'maxTokens',
        'max_tokens',
        'outputTokenLimit',
        'output_token_limit',
      ]);
    }

    if (!modelId) {
      return null;
    }

    const trimmed = modelId.trim();
    if (!trimmed || trimmed.length > MAX_STRING_LENGTH) {
      return null;
    }

    const parsed = ModelIdentifier.tryParse(trimmed);
    const rawId = parsed && parsed.provider === 'openai-codex'
      ? parsed.model
      : trimmed.replace(/^openai-codex:/, '');
    if (!rawId || rawId.length > MAX_STRING_LENGTH) {
      return null;
    }

    const validatedName = modelName?.trim();
    if (validatedName && validatedName.length > MAX_STRING_LENGTH) {
      return null;
    }

    if (contextWindow !== undefined && (contextWindow < 0 || contextWindow > MAX_CONTEXT_WINDOW)) {
      return null;
    }

    if (maxTokens !== undefined && (maxTokens < 0 || maxTokens > MAX_TOKENS)) {
      return null;
    }

    return {
      id: ModelIdentifier.create('openai-codex', rawId).combined,
      name: validatedName || rawId,
      provider: 'openai-codex' as AIProviderType,
      contextWindow,
      maxTokens,
    };
  }

  private static readStringField(
    source: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return undefined;
  }

  private static readNumberField(
    source: Record<string, unknown>,
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return undefined;
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

  /**
   * Get initialization data for analytics tracking.
   * Returns session init properties captured during the most recent sendMessage call.
   */
  getInitData(): {
    model: string;
    mcpServerCount: number;
    isResumedThread: boolean;
    permissionMode: string | null;
  } | null {
    return this._initData;
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
    attachments?: ChatAttachment[]
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
          error: permissionDecision.reason || 'OpenAI Codex turn denied',
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

      const mcpServers = await this.mcpConfigService.getMcpServersConfig({ sessionId, workspacePath });
      const hasSessionNamingServer = Object.prototype.hasOwnProperty.call(mcpServers, 'nimbalyst-session-naming');
      let usedSessionNamingToolThisTurn = false;

      // Build environment for the Codex CLI binary.
      // Electron GUI apps have a minimal process.env (missing docker, homebrew, nvm, etc.).
      // Merge in shell env vars and the enhanced PATH so the Codex agent can see system tools.
      const codexEnv = OpenAICodexProvider.buildCodexEnvironment();

      const resolvedModel = await this.getConfiguredModel();

      const sessionOptions = {
        workspacePath,
        model: resolvedModel,
        ...(permissionDecision.permissionMode ? { permissionMode: permissionDecision.permissionMode } : {}),
        mcpServers,
        raw: {
          systemPrompt,
          abortSignal: abortController.signal,
          codexConfigOverrides: this.buildCodexConfigOverrides(mcpServers),
          ...(codexEnv ? { codexEnv } : {}),
          ...(this.config?.effortLevel ? { effortLevel: this.config.effortLevel } : {}),
        },
      };

      const isResumedThread = !!existingSessionId;
      const session = isResumedThread
        ? await this.protocol.resumeSession(existingSessionId, sessionOptions)
        : await this.protocol.createSession(sessionOptions);

      // Store initialization data for analytics (picked up by AIService)
      this._initData = {
        model: resolvedModel,
        mcpServerCount: Object.keys(mcpServers).length,
        isResumedThread,
        permissionMode: permissionDecision.permissionMode ?? null,
      };

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
        } else if (event.type === 'raw_event') {
          // Raw SDK events are persisted for audit/history but not rendered directly.
        } else if (event.type === 'reasoning') {
          // Don't yield reasoning events - they're stored but not part of the visible stream
        } else if (event.type === 'text') {
          fullText += event.content;
          yield { type: 'text', content: event.content };
        } else if (event.type === 'tool_call') {
          if (event.toolCall) {
            if (OpenAICodexProvider.isSessionNamingToolCall(event.toolCall.name)) {
              usedSessionNamingToolThisTurn = true;
            }
            this.handleAskUserQuestionToolCall(event.toolCall, sessionId);
            yield { type: 'tool_call', toolCall: event.toolCall };
          }
        } else if (event.type === 'complete') {
          yield {
            type: 'complete',
            content: event.content,
            isComplete: true,
            usage: event.usage,
            ...(event.contextFillTokens !== undefined ? { contextFillTokens: event.contextFillTokens } : {}),
            ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}),
          };
        }
      }

      // Capture session ID after stream completes
      // The protocol layer captures thread ID from thread.started event during streaming
      if (sessionId && session.id) {
        if (session.id !== existingSessionId) {
          console.log('[CODEX] Saving new thread ID:', {
            nimbalystSessionId: sessionId,
            codexThreadId: session.id
          });
          this.sessions.captureSessionId(sessionId, session.id);
        } else {
          console.log('[CODEX] Thread ID unchanged:', session.id);
        }
      } else if (sessionId && !session.id) {
        console.error('[CODEX] WARNING: Stream completed but thread ID was never captured!');
      }

      if (
        sessionId &&
        !isResumedThread &&
        hasSessionNamingServer &&
        !usedSessionNamingToolThisTurn &&
        !abortController.signal.aborted
      ) {
        await this.sendSessionNamingReminder(session, sessionId);
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

  public resolveAskUserQuestion(
    questionId: string,
    answers: Record<string, string>,
    sessionId?: string,
    respondedBy: 'desktop' | 'mobile' = 'desktop'
  ): boolean {
    const pending = this.pendingAskUserQuestions.get(questionId);
    if (!pending) {
      return false;
    }

    this.pendingAskUserQuestions.delete(questionId);
    this.emit('askUserQuestion:answered', {
      questionId,
      sessionId: sessionId ?? pending.sessionId,
      questions: pending.questions,
      answers,
      respondedBy,
      timestamp: Date.now(),
    });
    return true;
  }

  public rejectAskUserQuestion(questionId: string, _error: Error): void {
    const pending = this.pendingAskUserQuestions.get(questionId);
    if (!pending) {
      return;
    }

    this.pendingAskUserQuestions.delete(questionId);
    this.emit('askUserQuestion:answered', {
      questionId,
      sessionId: pending.sessionId,
      questions: pending.questions,
      answers: {},
      cancelled: true,
      timestamp: Date.now(),
    });
  }

  private handleAskUserQuestionToolCall(
    toolCall: { id?: string; name: string; arguments?: Record<string, unknown>; result?: unknown },
    sessionId?: string
  ): void {
    const normalizedName = OpenAICodexProvider.normalizeMcpToolName(toolCall.name);
    if (normalizedName !== 'AskUserQuestion') {
      return;
    }

    if (!toolCall.id) {
      return;
    }

    const questionId = toolCall.id;
    const questions = OpenAICodexProvider.parseAskUserQuestionQuestions(toolCall.arguments);
    const hasResult = toolCall.result !== undefined && toolCall.result !== null;

    if (!hasResult) {
      if (this.pendingAskUserQuestions.has(questionId)) {
        return;
      }

      this.pendingAskUserQuestions.set(questionId, {
        questions,
        sessionId: sessionId ?? 'unknown',
      });
      this.emit('askUserQuestion:pending', {
        questionId,
        sessionId: sessionId ?? 'unknown',
        questions,
        timestamp: Date.now(),
      });
      return;
    }

    const pending = this.pendingAskUserQuestions.get(questionId);
    if (!pending) {
      return;
    }

    this.pendingAskUserQuestions.delete(questionId);
    this.emit('askUserQuestion:answered', {
      questionId,
      sessionId: sessionId ?? pending.sessionId,
      questions: pending.questions,
      answers: OpenAICodexProvider.extractAskUserQuestionAnswers(toolCall.result),
      cancelled: OpenAICodexProvider.isCancelledAskUserQuestionResult(toolCall.result),
      timestamp: Date.now(),
    });
  }

  private static parseAskUserQuestionQuestions(input: unknown): AskUserQuestionPrompt[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return [];
    }

    const rawQuestions = (input as Record<string, unknown>).questions;
    if (!Array.isArray(rawQuestions)) {
      return [];
    }

    const parsed: AskUserQuestionPrompt[] = [];
    for (const question of rawQuestions) {
      if (!question || typeof question !== 'object' || Array.isArray(question)) {
        continue;
      }

      const record = question as Record<string, unknown>;
      const header = typeof record.header === 'string' ? record.header : '';
      const text = typeof record.question === 'string' ? record.question : '';
      const multiSelect = record.multiSelect === true;
      const rawOptions = Array.isArray(record.options) ? record.options : [];

      if (!header || !text || rawOptions.length === 0) {
        continue;
      }

      const options: AskUserQuestionPromptOption[] = [];
      for (const option of rawOptions) {
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
          continue;
        }
        const optionRecord = option as Record<string, unknown>;
        const label = typeof optionRecord.label === 'string' ? optionRecord.label : '';
        const description =
          typeof optionRecord.description === 'string' ? optionRecord.description : '';
        if (!label) {
          continue;
        }
        options.push({ label, description });
      }

      if (options.length === 0) {
        continue;
      }

      parsed.push({
        question: text,
        header,
        options,
        multiSelect,
      });
    }

    return parsed;
  }

  private static extractAskUserQuestionAnswers(result: unknown): Record<string, string> {
    if (!result) {
      return {};
    }

    if (typeof result === 'string') {
      try {
        return OpenAICodexProvider.extractAskUserQuestionAnswers(JSON.parse(result));
      } catch {
        return {};
      }
    }

    if (typeof result !== 'object' || Array.isArray(result)) {
      return {};
    }

    const record = result as Record<string, unknown>;
    if (record.answers && typeof record.answers === 'object' && !Array.isArray(record.answers)) {
      const parsedAnswers: Record<string, string> = {};
      for (const [key, value] of Object.entries(record.answers as Record<string, unknown>)) {
        if (typeof value === 'string') {
          parsedAnswers[key] = value;
        }
      }
      if (Object.keys(parsedAnswers).length > 0) {
        return parsedAnswers;
      }
    }

    if (record.result !== undefined) {
      const nested = OpenAICodexProvider.extractAskUserQuestionAnswers(record.result);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }

    if (record.content !== undefined) {
      const nested = OpenAICodexProvider.extractAskUserQuestionAnswers(record.content);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }

    return {};
  }

  private static isCancelledAskUserQuestionResult(result: unknown): boolean {
    if (!result) {
      return false;
    }

    if (typeof result === 'string') {
      try {
        return OpenAICodexProvider.isCancelledAskUserQuestionResult(JSON.parse(result));
      } catch {
        return /cancelled|canceled/i.test(result);
      }
    }

    if (typeof result !== 'object' || Array.isArray(result)) {
      return false;
    }

    const record = result as Record<string, unknown>;
    if (record.cancelled === true || record.canceled === true) {
      return true;
    }

    if (record.result !== undefined && OpenAICodexProvider.isCancelledAskUserQuestionResult(record.result)) {
      return true;
    }

    if (record.content !== undefined && OpenAICodexProvider.isCancelledAskUserQuestionResult(record.content)) {
      return true;
    }

    return false;
  }

  private static normalizeMcpToolName(toolName: string): string {
    return toolName.replace(/^mcp__.+?__/, '');
  }

  private static isSessionNamingToolCall(toolName: string): boolean {
    const normalized = OpenAICodexProvider.normalizeMcpToolName(toolName);
    return normalized === 'update_session_meta' || normalized === 'name_session';
  }

  private async sendSessionNamingReminder(
    session: ProtocolSession,
    sessionId: string
  ): Promise<void> {
    console.log('[CODEX] First turn completed without session naming; sending reminder instruction');

    await this.logAgentMessageBestEffort(
      sessionId,
      'input',
      OpenAICodexProvider.SESSION_NAMING_REMINDER_PROMPT
    );

    let reminderTriggeredNaming = false;

    for await (const reminderEvent of this.protocol.sendMessage(session, {
      content: OpenAICodexProvider.SESSION_NAMING_REMINDER_PROMPT,
    })) {
      await this.storeRawEventIfPresent(reminderEvent, sessionId);

      if (reminderEvent.type === 'tool_call' && reminderEvent.toolCall) {
        if (OpenAICodexProvider.isSessionNamingToolCall(reminderEvent.toolCall.name)) {
          reminderTriggeredNaming = true;
        }
        this.handleAskUserQuestionToolCall(reminderEvent.toolCall, sessionId);
      }
    }

    if (!reminderTriggeredNaming) {
      console.warn('[CODEX] Session naming reminder turn completed without update_session_meta call');
    }
  }

  abort(): void {
    this.pendingAskUserQuestions.clear();
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

  /**
   * Build system prompt for Codex using the same addendum as Claude Code.
   * Uses buildClaudeCodeSystemPrompt to include Nimbalyst-specific instructions
   * for visual tools, worktrees, session naming, etc.
   */
  protected buildSystemPrompt(documentContext?: DocumentContext): string {
    const hasSessionNaming = OpenAICodexProvider.sessionNamingServerPort !== null;
    const worktreePath = documentContext?.worktreePath;
    const isVoiceMode = (documentContext as any)?.isVoiceMode;
    const voiceModeCodingAgentPrompt = (documentContext as any)?.voiceModeCodingAgentPrompt;
    // Note: Agent teams are not currently supported for Codex
    const enableAgentTeams = false;

    return buildClaudeCodeSystemPrompt({
      hasSessionNaming,
      toolReferenceStyle: 'codex',
      worktreePath,
      isVoiceMode,
      voiceModeCodingAgentPrompt,
      enableAgentTeams,
    });
  }

  private async getConfiguredModel(): Promise<string> {
    const configured = this.config?.model || OpenAICodexProvider.DEFAULT_MODEL;
    const parsed = ModelIdentifier.tryParse(configured);
    const resolved = parsed ? parsed.model : configured.replace(/^openai-codex:/, '');
    const normalized = resolved.toLowerCase();
    if (normalized === 'openai-codex-cli' || normalized === 'default' || normalized === 'cli') {
      return 'gpt-5.4';
    }

    // Pass the model directly to the Codex SDK without pre-validation.
    // The openai.models.list() API does not include all Codex-available models
    // (e.g., gpt-5.4 works via the SDK but isn't listed in the API).
    // The SDK itself will fail with a proper error if the model doesn't exist.
    return OpenAICodexProvider.MODEL_REPLACEMENTS.get(normalized) || resolved;
  }

  private buildCodexPrompt(options: {
    systemPrompt: string;
    message: string;
    messages?: Message[];
    shouldBootstrapFromHistory: boolean;
  }): string {
    // Note: System prompt is now passed via developer_instructions in thread options.
    // Codex SDK handles message formatting internally, so we just pass the raw content.

    // For now, conversation history bootstrapping is always disabled (shouldBootstrapFromHistory = false)
    // because the Codex SDK maintains thread state automatically.
    // If we need history bootstrapping in the future, we can add it here.

    return options.message;
  }

  /**
   * Build a complete environment for the Codex CLI binary.
   * Merges process.env with shell env vars and enhanced PATH so the agent
   * can access system tools (docker, homebrew, nvm, etc.) that are missing
   * from Electron's minimal GUI environment.
   *
   * Returns null if no enhancement is needed (no loaders configured).
   */
  private static buildCodexEnvironment(): Record<string, string> | null {
    let shellEnv: Record<string, string> | null = null;
    let enhancedPath: string | null = null;

    if (OpenAICodexProvider.shellEnvironmentLoader) {
      try {
        shellEnv = OpenAICodexProvider.shellEnvironmentLoader();
      } catch (error) {
        console.warn('[CODEX] Failed to load shell environment:', error);
      }
    }

    if (OpenAICodexProvider.enhancedPathLoader) {
      try {
        enhancedPath = OpenAICodexProvider.enhancedPathLoader();
      } catch (error) {
        console.warn('[CODEX] Failed to load enhanced PATH:', error);
      }
    }

    // Only build custom env if we have something to enhance
    if (!shellEnv && !enhancedPath) {
      return null;
    }

    const env: Record<string, string> = {};

    // Start with process.env (Electron's minimal environment)
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Layer shell env vars on top (AWS creds, NODE_EXTRA_CA_CERTS, etc.)
    if (shellEnv) {
      Object.assign(env, shellEnv);
    }

    // Set enhanced PATH (includes homebrew, nvm, docker, etc.)
    if (enhancedPath) {
      env.PATH = enhancedPath;
    }

    return env;
  }

  private buildCodexConfigOverrides(
    mcpServers: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    const codexMcpServers: Record<string, Record<string, unknown>> = {};

    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      const converted = this.convertServerConfigToCodex(serverConfig as Record<string, unknown>);
      if (converted) {
        // Sanitize server names: dots in TOML keys are interpreted as nested tables
        // (e.g., "customer.io" becomes [mcp_servers.customer.io] -> nested "customer" -> "io")
        // Replace dots with hyphens to prevent TOML parsing errors
        const safeServerName = serverName.replace(/\./g, '-');
        codexMcpServers[safeServerName] = converted;
      }
    }

    if (Object.keys(codexMcpServers).length === 0) {
      return undefined;
    }

    return {
      mcp_servers: codexMcpServers,
    };
  }

  private convertServerConfigToCodex(serverConfig: Record<string, unknown>): Record<string, unknown> | null {
    const configTypeRaw = typeof serverConfig.type === 'string'
      ? serverConfig.type.toLowerCase()
      : (typeof serverConfig.transport === 'string' ? serverConfig.transport.toLowerCase() : '');

    const isRemoteServer = configTypeRaw === 'sse' || configTypeRaw === 'http' || typeof serverConfig.url === 'string';
    if (isRemoteServer) {
      if (typeof serverConfig.url !== 'string' || serverConfig.url.length === 0) {
        return null;
      }

      const remoteConfig: Record<string, unknown> = {
        url: serverConfig.url,
      };

      const headers = this.toCodexStringMap((serverConfig.http_headers ?? serverConfig.headers) as unknown);
      if (headers && Object.keys(headers).length > 0) {
        remoteConfig.http_headers = headers;
      }

      if (typeof serverConfig.bearer_token_env_var === 'string' && serverConfig.bearer_token_env_var.length > 0) {
        remoteConfig.bearer_token_env_var = serverConfig.bearer_token_env_var;
      }

      if (typeof serverConfig.startup_timeout_sec === 'number') {
        remoteConfig.startup_timeout_sec = serverConfig.startup_timeout_sec;
      }

      if (typeof serverConfig.tool_timeout_sec === 'number') {
        remoteConfig.tool_timeout_sec = serverConfig.tool_timeout_sec;
      }

      return remoteConfig;
    }

    if (typeof serverConfig.command !== 'string' || serverConfig.command.length === 0) {
      return null;
    }

    const stdioConfig: Record<string, unknown> = {
      command: serverConfig.command,
    };

    if (Array.isArray(serverConfig.args)) {
      stdioConfig.args = serverConfig.args.filter((arg): arg is string => typeof arg === 'string');
    }

    const env = this.toCodexStringMap(serverConfig.env as unknown);
    if (env && Object.keys(env).length > 0) {
      stdioConfig.env = env;
    }

    if (typeof serverConfig.cwd === 'string' && serverConfig.cwd.length > 0) {
      stdioConfig.cwd = serverConfig.cwd;
    }

    if (typeof serverConfig.startup_timeout_sec === 'number') {
      stdioConfig.startup_timeout_sec = serverConfig.startup_timeout_sec;
    }

    if (typeof serverConfig.tool_timeout_sec === 'number') {
      stdioConfig.tool_timeout_sec = serverConfig.tool_timeout_sec;
    }

    return stdioConfig;
  }

  private toCodexStringMap(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const result: Record<string, string> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (typeof entryValue === 'string') {
        result[key] = entryValue;
      }
    }
    return result;
  }

  /**
   * Strip XML-like tags that could break out of structured prompt sections.
   * This prevents message content from injecting fake </CONVERSATION_HISTORY>,
   * <USER>, etc. tags that would alter the prompt structure.
   *
   * Handles bare tags, tags with attributes, and self-closing variants:
   *   <USER>, </USER>, <USER id="x">, <USER/>, etc.
   */
  private static sanitizeTagContent(content: string): string {
    return content.replace(/<\/?(?:CONVERSATION_HISTORY|USER)\b[^>]*\/?>/gi, '');
  }

  private appendAttachmentHints(message: string, attachments?: ChatAttachment[]): string {
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
    if (event.type !== 'raw_event' || !event.metadata?.rawEvent) {
      return;
    }

    const { content, usedFallback } = this.serializeRawCodexEvent(event.metadata.rawEvent);
    const rawEventType = this.getRawEventType(event.metadata.rawEvent);

    await this.logAgentMessage(
      sessionId,
      this.getProviderName(),
      'output',
      content,
      {
        eventType: rawEventType,
        codexProvider: true,
        rawEventSerializationFallback: usedFallback,
      },
      false, // not hidden
      undefined, // no provider message ID
      false // not searchable - raw events are not for search
    );
  }

  private getRawEventType(rawEvent: unknown): string {
    if (rawEvent && typeof rawEvent === 'object') {
      const eventType = (rawEvent as Record<string, unknown>).type;
      if (typeof eventType === 'string' && eventType.trim().length > 0) {
        return eventType;
      }
    }
    return 'unknown';
  }

  private serializeRawCodexEvent(rawEvent: unknown): { content: string; usedFallback: boolean } {
    const result = safeJSONSerialize(rawEvent);

    // If the generic fallback was used, enhance it with the raw event type
    if (result.usedFallback) {
      return {
        content: JSON.stringify({
          type: this.getRawEventType(rawEvent),
          valueType: typeof rawEvent,
          fallback: true,
        }),
        usedFallback: true,
      };
    }

    return result;
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
  ): Promise<{ decision: 'allow' | 'deny'; reason?: string; permissionMode?: PermissionMode }> {
    const pathForTrust = permissionsPath || workspacePath;

    // Check trust status
    if (pathForTrust && BaseAgentProvider.trustChecker) {
      const trustStatus = BaseAgentProvider.trustChecker(pathForTrust);

      if (!trustStatus.trusted) {
        this.logSecurity('[OpenAICodexProvider] Workspace not trusted, denying Codex turn', {
          workspacePath: pathForTrust,
        });
        return {
          decision: 'deny',
          reason: 'Workspace is not trusted. Please trust this workspace to use OpenAI Codex.'
        };
      }

      // IMPORTANT: Codex can only be used in "allow-all" or "bypass-all" mode
      // The Codex SDK does not support tool-level permission checks (no canUseTool callback)
      // We can only approve/deny entire turns, not individual tools
      // Therefore, we require users to explicitly opt-in to unrestricted mode
      if (trustStatus.mode === 'bypass-all' || trustStatus.mode === 'allow-all') {
        return { decision: 'allow', permissionMode: trustStatus.mode };
      }

      // Deny Codex in "ask" mode - tool-level permissions are not supported
      this.logSecurity('[OpenAICodexProvider] Codex requires "Allow Edits" permission mode', {
        currentMode: trustStatus.mode,
        workspacePath: pathForTrust,
      });
      return {
        decision: 'deny',
        reason: 'OpenAI Codex requires "Allow Edits" permission mode in Nimbalyst. Please change the permission mode in workspace settings to use Codex.'
      };
    }

    // No trust checker - allow by default (non-Electron environments)
    return { decision: 'allow' };
  }

}
