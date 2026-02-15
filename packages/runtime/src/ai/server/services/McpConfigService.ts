/**
 * McpConfigService - Manages MCP server configuration for AI providers
 *
 * This service handles:
 * - Loading MCP servers from user config (~/.config/claude/mcp.json)
 * - Loading workspace-specific MCP servers (.mcp.json)
 * - Merging built-in Nimbalyst MCP servers with user configs
 * - Expanding environment variables in server configurations
 * - Processing server configs for different transport types (stdio, sse)
 *
 * The service is designed to be reusable across different AI providers
 * (ClaudeCodeProvider, CodexProvider, etc.)
 */

export interface McpConfigServiceDeps {
  /** Port for the main Nimbalyst MCP server (provides capture_editor_screenshot, etc.) */
  mcpServerPort: number | null;

  /** Port for the session naming MCP server */
  sessionNamingServerPort: number | null;

  /** Port for the extension development MCP server */
  extensionDevServerPort: number | null;

  /** Loader for user and workspace MCP server configs */
  mcpConfigLoader: ((workspacePath?: string) => Promise<Record<string, any>>) | null;

  /** Loader for extension plugins (not used for MCP config, but passed for completeness) */
  extensionPluginsLoader: ((workspacePath?: string) => Promise<Array<{ type: 'local'; path: string }>>) | null;

  /** Loader for Claude settings environment variables */
  claudeSettingsEnvLoader: (() => Promise<Record<string, string>>) | null;

  /** Loader for shell environment variables */
  shellEnvironmentLoader: (() => Record<string, string> | null) | null;
}

/**
 * Service for loading and processing MCP server configurations
 */
export class McpConfigService {
  private deps: McpConfigServiceDeps;

  constructor(deps: McpConfigServiceDeps) {
    this.deps = deps;
  }

  /**
   * Get merged MCP server configuration from all sources:
   * 1. Built-in Nimbalyst MCP servers (nimbalyst-mcp, session-naming, extension-dev)
   * 2. User-level MCP servers (~/.config/claude/mcp.json)
   * 3. Workspace-level MCP servers (.mcp.json)
   *
   * Priority order: built-in < user < workspace
   *
   * @param options.sessionId - Session ID for session-specific servers
   * @param options.workspacePath - Workspace path for workspace-specific servers
   * @returns Merged MCP server configuration object
   */
  async getMcpServersConfig(options: { sessionId?: string; workspacePath?: string }): Promise<Record<string, any>> {
    const { sessionId, workspacePath } = options;
    const config: any = {};

    // Include shared MCP server if it's started (provides capture_editor_screenshot tool only)
    // applyDiff and streamContent are NOT exposed via MCP - they're only for chat providers via IPC
    if (this.deps.mcpServerPort !== null && workspacePath) {
      let mcpUrl = `http://127.0.0.1:${this.deps.mcpServerPort}/mcp?workspacePath=${encodeURIComponent(workspacePath)}`;
      if (sessionId) {
        mcpUrl += `&sessionId=${encodeURIComponent(sessionId)}`;
      }
      config['nimbalyst-mcp'] = {
        type: 'sse',
        transport: 'sse',
        url: mcpUrl,
        // Override default 60s tool timeout for Codex CLI.
        // Some tools (e.g. developer_git_commit_proposal) block indefinitely
        // waiting for user input — the user may leave and return hours or
        // days later. Use a very large value (~7 days) to effectively disable.
        tool_timeout_sec: 604800,
      };
    }

    // Include session naming MCP server if it's started
    if (this.deps.sessionNamingServerPort !== null && sessionId) {
      config['nimbalyst-session-naming'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${this.deps.sessionNamingServerPort}/mcp?sessionId=${encodeURIComponent(sessionId)}`
      };
    }

    // Include extension dev MCP server if it's started (provides build, install, reload tools)
    if (this.deps.extensionDevServerPort !== null) {
      const params = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      config['nimbalyst-extension-dev'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${this.deps.extensionDevServerPort}/mcp${params}`
      };
    }

    // Load user and workspace MCP servers using the injected loader (if available)
    // This merges user-level (global) servers with workspace-level servers
    if (this.deps.mcpConfigLoader) {
      try {
        const mergedServers = await this.deps.mcpConfigLoader(workspacePath);

        // Process each server config
        for (const [serverName, serverConfig] of Object.entries(mergedServers)) {
          const processedConfig = await this.processServerConfig(serverName, serverConfig as any);
          config[serverName] = processedConfig;
        }
      } catch (error) {
        console.error('[MCP-CONFIG] Failed to load MCP servers from config loader:', error);
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
   *
   * For stdio transport:
   * - Expands environment variables in args array
   * - Expands env object values
   *
   * For SSE transport:
   * - Converts API key env vars to Authorization headers
   * - Removes env object (not used for SSE)
   *
   * @param serverName - Name of the MCP server
   * @param serverConfig - Raw server configuration
   * @returns Processed server configuration
   */
  private async processServerConfig(serverName: string, serverConfig: any): Promise<any> {
    const processedConfig = { ...serverConfig };

    // Load environment for variable expansion
    const env = await this.loadEnvironmentForExpansion();

    // Build combined env: loaded env + config.env (config.env takes precedence)
    const combinedEnv: Record<string, string | undefined> = { ...env };
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
          const expandedValue = this.expandEnvVar(value as string, env);
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
   *
   * This method is called when the mcpConfigLoader is not available
   * or when it fails to load configs.
   *
   * @param workspacePath - Path to the workspace
   * @param config - Existing config object to merge into
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
            const processedConfig = await this.processServerConfig(serverName, serverConfig as any);
            config[serverName] = processedConfig;
          }
        }
      }
    } catch (error) {
      console.error('[MCP-CONFIG] Failed to load .mcp.json:', error);
    }
  }

  /**
   * Expand environment variable syntax: ${VAR} and ${VAR:-default}
   *
   * Supports:
   * - Simple replacement: ${HOME} -> /Users/username
   * - Default values: ${MISSING:-fallback} -> fallback
   *
   * Note: Nested defaults like ${FOO:-${HOME}} are not fully supported.
   * The outer variable will be replaced with the literal default value,
   * which may still contain unexpanded variables.
   *
   * @param value - String potentially containing env var references
   * @param env - Environment variable map
   * @returns String with env vars expanded
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
   * Load environment variables for expansion from all available sources
   *
   * Priority order:
   * 1. process.env (always available)
   * 2. Shell environment (from login shell, includes AWS_*, etc.)
   * 3. Claude settings env (from ~/.claude/settings.json)
   *
   * @returns Merged environment variable map
   */
  private async loadEnvironmentForExpansion(): Promise<Record<string, string | undefined>> {
    const env: Record<string, string | undefined> = {
      ...(process.env as Record<string, string | undefined>)
    };

    // Load shell environment if available
    if (this.deps.shellEnvironmentLoader) {
      try {
        const shellEnv = this.deps.shellEnvironmentLoader();
        if (shellEnv) {
          Object.assign(env, shellEnv);
        }
      } catch (error) {
        console.warn('[MCP-CONFIG] Failed to load shell environment:', error);
      }
    }

    // Load Claude settings env if available
    if (this.deps.claudeSettingsEnvLoader) {
      try {
        const settingsEnv = await this.deps.claudeSettingsEnvLoader();
        if (settingsEnv) {
          Object.assign(env, settingsEnv);
        }
      } catch (error) {
        console.warn('[MCP-CONFIG] Failed to load Claude settings environment:', error);
      }
    }

    return env;
  }
}
