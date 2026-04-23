/**
 * Builds the SDK options object for a Claude Code query() call.
 *
 * Consolidates all the configuration loading, environment setup, session
 * resumption, tool restrictions, and prompt construction that happens
 * before the streaming loop begins.
 */

import type { ContentBlockParam, TextBlockParam, MessageParam } from '@anthropic-ai/sdk/resources';
import path from 'path';
import { app } from 'electron';
import { ClaudeCodeDeps } from './dependencyInjection';
import { resolveClaudeAgentCliPath } from './cliPathResolver';
import { DEFAULT_EFFORT_LEVEL } from '../../effortLevels';

type SessionMode = 'planning' | 'agent' | undefined;

type SDKUserMessage = {
  type: 'user';
  message: MessageParam;
  parent_tool_use_id: string | null;
};

export interface BuildSdkOptionsDeps {
  resolveModelVariant: () => string;
  mcpConfigService: { getMcpServersConfig: (params: { sessionId?: string; workspacePath: string }) => Promise<Record<string, any>> };
  createCanUseToolHandler: (sessionId?: string, workspacePath?: string, permissionsPath?: string) => any;
  toolHooksService: { createPreToolUseHook: () => any; createPostToolUseHook: () => any };
  teammateManager: {
    lastUsedCwd?: string | undefined;
    lastUsedSessionId?: string | undefined;
    lastUsedPermissionsPath?: string | undefined;
    packagedBuildOptions?: any;
    resolveTeamContext: (sessionId?: string) => Promise<string | undefined>;
  };
  sessions: { getSessionId: (sessionId: string) => string | null | undefined };
  config: { model?: string; apiKey?: string; effortLevel?: string };
  abortController: AbortController;
}

export interface BuildSdkOptionsParams {
  message: string;
  workspacePath: string;
  sessionId?: string;
  documentContext?: any;
  settingsEnv: Record<string, string>;
  shellEnv: Record<string, string>;
  systemPrompt: string;
  currentMode: SessionMode;
  imageContentBlocks: ContentBlockParam[];
  documentContentBlocks: ContentBlockParam[];
  permissionsPath?: string;
  mcpConfigWorkspacePath?: string;
  isMetaAgent?: boolean;
}

/**
 * Controls the lifetime of the prompt AsyncIterable so the SDK keeps the
 * binary's stdin pipe open for the duration of the turn. Calling end() lets
 * the generator return, which in turn lets the SDK close stdin normally.
 *
 * We always use an AsyncIterable prompt (never a bare string) so the SDK
 * sets isSingleUserTurn=false and does NOT preemptively close stdin when
 * `type: 'result'` arrives -- that forced close is the root cause of the
 * "Tool permission request failed: Error: Stream closed" errors on turns
 * where the binary emits a late can_use_tool after result.
 */
export interface PromptStreamController {
  end(reason: string): void;
  isEnded(): boolean;
}

export interface BuildSdkOptionsResult {
  options: any;
  promptInput: AsyncIterable<SDKUserMessage>;
  promptController: PromptStreamController;
  helperMethod: 'native' | 'custom';
}

function createPersistentPromptStream(
  initialMessage: SDKUserMessage,
): { iterable: AsyncIterable<SDKUserMessage>; controller: PromptStreamController } {
  let ended = false;
  let endResolve: (() => void) | null = null;
  const endPromise = new Promise<void>((resolve) => {
    endResolve = () => {
      ended = true;
      resolve();
    };
  });

  async function* generator(): AsyncGenerator<SDKUserMessage> {
    yield initialMessage;
    // Keep the iterator open so the SDK doesn't call transport.endInput() and
    // close the binary's stdin mid-turn. Returns only when end() is called.
    await endPromise;
  }

  return {
    iterable: generator(),
    controller: {
      end: (reason: string) => {
        if (!ended && endResolve) {
          console.log(`[CLAUDE-CODE] PromptStreamController.end(reason="${reason}")`);
          endResolve();
        }
      },
      isEnded: () => ended,
    },
  };
}

export async function buildSdkOptions(
  deps: BuildSdkOptionsDeps,
  params: BuildSdkOptionsParams
): Promise<BuildSdkOptionsResult> {
  const {
    resolveModelVariant,
    mcpConfigService,
    createCanUseToolHandler,
    toolHooksService,
    teammateManager,
    sessions,
    config,
    abortController,
  } = deps;

  const {
    message,
    workspacePath,
    sessionId,
    documentContext,
    settingsEnv,
    shellEnv,
    systemPrompt,
    currentMode,
    imageContentBlocks,
    documentContentBlocks,
    permissionsPath,
    mcpConfigWorkspacePath,
    isMetaAgent,
  } = params;

  let helperMethod: 'native' | 'custom' = 'native';

  // Determine which settings sources to use based on user preferences
  let settingSources: string[] = ['local'];
  if (ClaudeCodeDeps.claudeCodeSettingsLoader) {
    try {
      const ccSettings = await ClaudeCodeDeps.claudeCodeSettingsLoader();
      if (ccSettings.userCommandsEnabled) {
        settingSources.push('user');
      }
      if (ccSettings.projectCommandsEnabled) {
        settingSources.push('project');
      }
    } catch (error) {
      console.warn('[CLAUDE-CODE] Failed to load Claude Code settings, using defaults:', error);
      settingSources = ['user', 'project', 'local'];
    }
  } else {
    settingSources = ['user', 'project', 'local'];
  }

  // NIM-838 scope: the "let the SDK resolve the native binary" workaround
  // shipped in v0.58.1 broke packaged macOS arm64 with `spawn ENOTDIR` because
  // the SDK's require.resolve returns a path INSIDE app.asar, where the binary
  // only exists under app.asar.unpacked. resolveNativeBinaryPath() handles that
  // rewrite correctly, so we pre-resolve on every platform EXCEPT packaged
  // Windows -- the original NIM-838 resume-mismatch symptoms came from Windows
  // and the experiment of leaving pathToClaudeCodeExecutable undefined there is
  // still open.
  const skipPreResolve =
    app.isPackaged
    && !ClaudeCodeDeps.customClaudeCodePath
    && process.platform === 'win32';

  const resolvedBinaryPath = skipPreResolve
    ? undefined
    : await resolveClaudeAgentCliPath().catch(() => undefined);

  const options: any = {
    pathToClaudeCodeExecutable: ClaudeCodeDeps.customClaudeCodePath || resolvedBinaryPath,
    systemPrompt: isMetaAgent
      ? systemPrompt  // Plain string — fully replaces CC system prompt
      : {
          type: 'preset',
          preset: 'claude_code',
          append: systemPrompt
        },
    settingSources,
    mcpServers: await mcpConfigService.getMcpServersConfig({ sessionId, workspacePath: mcpConfigWorkspacePath || workspacePath }),
    cwd: workspacePath,
    abortController,
    model: resolveModelVariant(),
    // IMPORTANT: Do NOT add manual tool restrictions or prompt injections for plan mode here.
    // The SDK's `permissionMode: 'plan'` natively enforces planning restrictions (scopes
    // Write to the plan file only). Manual filtering was removed in favour of this approach.
    permissionMode: currentMode === 'planning' ? 'plan' : 'default',
    // When plan tracking is enabled, direct plan files to the project's plans folder
    // (relative to cwd). This applies whenever the agent enters plan mode, even mid-session.
    settings: {
      ...(ClaudeCodeDeps.planTrackingEnabled && { plansDirectory: 'nimbalyst-local/plans' }),
    },
    canUseTool: createCanUseToolHandler(sessionId, workspacePath, permissionsPath),
    hooks: {
      'PreToolUse': [{ hooks: [toolHooksService.createPreToolUseHook()] }],
      'PostToolUse': [{ hooks: [toolHooksService.createPostToolUseHook()] }],
    },
  };

  if (currentMode === 'planning') {
    console.log('[CLAUDE-CODE] Plan mode active: delegating tool restrictions to SDK permissionMode=plan');
  }

  // Capture lead config for teammate spawning
  teammateManager.lastUsedCwd = workspacePath;
  teammateManager.lastUsedSessionId = sessionId;
  teammateManager.lastUsedPermissionsPath = permissionsPath;

  // Load extension plugins
  if (ClaudeCodeDeps.extensionPluginsLoader) {
    try {
      const extensionPlugins = await ClaudeCodeDeps.extensionPluginsLoader(workspacePath);
      if (extensionPlugins.length > 0) {
        options.plugins = extensionPlugins;
      }
    } catch (error) {
      console.warn('[CLAUDE-CODE] Failed to load extension plugins:', error);
    }
  }

  // Add additional directories based on workspace context
  if (ClaudeCodeDeps.additionalDirectoriesLoader) {
    try {
      const additionalDirs = ClaudeCodeDeps.additionalDirectoriesLoader(workspacePath);
      if (additionalDirs.length > 0) {
        options.additionalDirectories = additionalDirs;
      }
    } catch (error) {
      console.warn('[CLAUDE-CODE] Failed to load additional directories:', error);
    }
  }

  // Set up environment variables.
  // Strip API keys from every env source we compose so we never silently use
  // a key the user didn't explicitly configure in Nimbalyst settings. A user's
  // .env file with ANTHROPIC_API_KEY was picked up here and billed their
  // personal Anthropic account $100+.
  //
  // Defense-in-depth: the main-process bootstrap already deletes these from
  // process.env before any code runs, but claude-agent-sdk 0.2.111 changed
  // options.env from "replaces process.env" to "overlays process.env". We
  // therefore also strip from every composed source and explicitly set the
  // key from config.apiKey (or empty string) at the end, so nothing the SDK
  // may inject from its own view of process.env can leak through.
  const { ANTHROPIC_API_KEY: _envAnthropicKey, OPENAI_API_KEY: _envOpenaiKey, ...sanitizedProcessEnv } = process.env;
  const { ANTHROPIC_API_KEY: _shellAnthropicKey, OPENAI_API_KEY: _shellOpenaiKey, ...sanitizedShellEnv } = shellEnv;
  const { ANTHROPIC_API_KEY: _settingsAnthropicKey, OPENAI_API_KEY: _settingsOpenaiKey, ...sanitizedSettingsEnv } = settingsEnv;

  const enableAgentTeams = sanitizedSettingsEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
  const env: any = {
    ...sanitizedProcessEnv,
    ...sanitizedShellEnv,
    ...sanitizedSettingsEnv,
    // `auto:N` defers MCP tools when their descriptions exceed N% of the
    // context window. With Opus 4.7's 1M-context default, `auto:10` means
    // ~100K tokens of tool descriptions are still loaded upfront — we saw
    // ~112K baseline usage on new sessions. `auto:2` (20K on 1M, 4K on 200K)
    // matches the previous lazy-loading behavior we had under Sonnet 4.6.
    ENABLE_TOOL_SEARCH: 'auto:2',
    // Explicitly force-clear in case the SDK overlays its own process.env view.
    // These will be re-set from config.apiKey below if the user has configured one.
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    ...(config.effortLevel && config.effortLevel !== DEFAULT_EFFORT_LEVEL && {
      CLAUDE_CODE_EFFORT_LEVEL: config.effortLevel
    }),
  };

  // NIM-838: On Windows, force HOME to mirror USERPROFILE so the native binary
  // resolves the same ~/.claude root on every spawn, regardless of whether its
  // internal logic prefers HOME (Unix-style) or USERPROFILE. process.env on
  // Windows usually has USERPROFILE but no HOME, leaving the binary to make a
  // platform-specific choice; a mismatch between turn-1 write and turn-2 read
  // would manifest exactly as the resume failures we're seeing.
  if (process.platform === 'win32') {
    const winHome = env.USERPROFILE || process.env.USERPROFILE;
    if (winHome) {
      env.HOME = winHome;
      env.USERPROFILE = winHome;
    }
  }

  if (enableAgentTeams) {
    env.CLAUDE_CODE_ENABLE_TASKS = '1';
  }

  const effectiveTeamContext = enableAgentTeams
    ? await teammateManager.resolveTeamContext(sessionId)
    : undefined;

  if (effectiveTeamContext) {
    env.CLAUDE_CODE_TEAM_NAME = effectiveTeamContext;
    env.CLAUDE_CODE_TASK_LIST_ID = effectiveTeamContext;
    env.CLAUDE_CODE_AGENT_ID = `team-lead@${effectiveTeamContext}`;
    env.CLAUDE_CODE_AGENT_NAME = 'team-lead';
    env.CLAUDE_CODE_AGENT_TYPE = 'team-lead';
  }

  // Production packaged build setup.
  // The env built above already starts from process.env (with API keys stripped).
  // The native binary only needs HOME/USERPROFILE (already in process.env) to
  // find ~/.claude/. We no longer overlay setupClaudeCodeEnvironment() because
  // it was designed for the old Node.js execution path and its Object.assign
  // clobbered our sanitized env.
  if (app.isPackaged) {
    if (ClaudeCodeDeps.customClaudeCodePath) {
      helperMethod = 'custom';
    } else if (skipPreResolve) {
      console.log(`[ClaudeCodeProvider] Windows packaged build: letting SDK resolve native binary (NIM-838 experiment)`);
    } else {
      console.log(`[ClaudeCodeProvider] Pre-resolved native binary for packaged build: ${resolvedBinaryPath ?? '(resolveClaudeAgentCliPath returned undefined)'}`);
    }

    // Share packaged-build options with TeammateManager so teammates spawn with
    // the same binary + env as the lead. TeammateManager.ts guards on
    // pathToClaudeCodeExecutable being truthy before overriding, so undefined
    // (Windows NIM-838 experiment) flows through safely.
    teammateManager.packagedBuildOptions = {
      env: env as Record<string, string | undefined>,
      pathToClaudeCodeExecutable: ClaudeCodeDeps.customClaudeCodePath || resolvedBinaryPath,
    };
  }

  // Per-session API key
  if (config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
    if (teammateManager.packagedBuildOptions?.env) {
      teammateManager.packagedBuildOptions.env.ANTHROPIC_API_KEY = config.apiKey;
    }
  }

  options.env = env;

  // Handle session resumption and branching
  if (sessionId) {
    const claudeSessionId = sessions.getSessionId(sessionId);
    if (claudeSessionId) {
      options.resume = claudeSessionId;
    } else {
      const branchedFromSessionId = documentContext?.branchedFromSessionId;
      const branchedFromProviderSessionId = documentContext?.branchedFromProviderSessionId;
      if (branchedFromSessionId && branchedFromProviderSessionId) {
        options.resume = branchedFromProviderSessionId;
        options.forkSession = true;
      } else if (branchedFromSessionId) {
        const sourceClaudeSessionId = sessions.getSessionId(branchedFromSessionId);
        if (sourceClaudeSessionId) {
          options.resume = sourceClaudeSessionId;
          options.forkSession = true;
        } else {
          console.warn('[CLAUDE-CODE] Cannot branch: source provider session ID not available. branchedFromSessionId:', branchedFromSessionId);
        }
      }
    }
  }

  // NIM-838 diagnostic: enable SDK verbose stderr when resuming, so we can see
  // what the native binary does with --resume on affected systems (Windows x64,
  // macOS arm64). Gated to resume turns to avoid noise on every request.
  // Remove once the resume regression is understood and fixed.
  if (options.resume) {
    env.DEBUG_CLAUDE_AGENT_SDK = '1';
  }

  // Build prompt input. Always use a persistent AsyncIterable (never a bare
  // string) so isSingleUserTurn=false in the SDK -- this prevents the SDK
  // from closing the binary's stdin pipe on `type: 'result'` and avoids the
  // "Stream closed" tool permission errors on long turns.
  const hasAttachmentBlocks = imageContentBlocks.length > 0 || documentContentBlocks.length > 0;
  const userContent: string | ContentBlockParam[] = hasAttachmentBlocks
    ? [
        ...imageContentBlocks,
        ...documentContentBlocks,
        { type: 'text', text: message } as TextBlockParam,
      ]
    : message;

  const initialMessage: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content: userContent as any },
    parent_tool_use_id: null,
  };

  const { iterable: promptInput, controller: promptController } =
    createPersistentPromptStream(initialMessage);

  return { options, promptInput, promptController, helperMethod };
}
