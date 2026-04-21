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
import { resolveNativeBinaryPath } from '../../../../electron/claudeCodeEnvironment';
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

export interface BuildSdkOptionsResult {
  options: any;
  promptInput: string | AsyncIterable<SDKUserMessage>;
  helperMethod: 'native' | 'custom';
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

  const options: any = {
    pathToClaudeCodeExecutable: ClaudeCodeDeps.customClaudeCodePath || await resolveClaudeAgentCliPath().catch(() => undefined),
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
  // clobbered our sanitized env (re-introducing stripped API keys, rewriting
  // PATH unnecessarily, etc.).
  if (app.isPackaged) {
    // Resolve native binary path for packaged builds.
    // The SDK resolves its own binary via require.resolve, but in asar-unpacked
    // builds that may not work. We resolve it explicitly and pass as override.
    if (!ClaudeCodeDeps.customClaudeCodePath) {
      const nativeBinaryPath = resolveNativeBinaryPath();
      if (nativeBinaryPath) {
        options.pathToClaudeCodeExecutable = nativeBinaryPath;
        console.log(`[ClaudeCodeProvider] Using SDK native binary: ${nativeBinaryPath}`);
      } else {
        console.warn('[ClaudeCodeProvider] Native binary not found, SDK will attempt its own resolution');
      }
    } else {
      helperMethod = 'custom';
    }

    // Share packaged-build options with TeammateManager
    teammateManager.packagedBuildOptions = {
      env: env as Record<string, string | undefined>,
      pathToClaudeCodeExecutable: ClaudeCodeDeps.customClaudeCodePath || options.pathToClaudeCodeExecutable,
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

  // Build prompt input
  let promptInput: string | AsyncIterable<SDKUserMessage>;
  const hasAttachmentBlocks = imageContentBlocks.length > 0 || documentContentBlocks.length > 0;

  if (hasAttachmentBlocks) {
    const contentBlocks: ContentBlockParam[] = [
      ...imageContentBlocks,
      ...documentContentBlocks,
      { type: 'text', text: message } as TextBlockParam
    ];

    async function* createStreamingInput(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user',
        message: { role: 'user', content: contentBlocks },
        parent_tool_use_id: null
      };
    }

    promptInput = createStreamingInput();
  } else {
    promptInput = message;
  }

  return { options, promptInput, helperMethod };
}
