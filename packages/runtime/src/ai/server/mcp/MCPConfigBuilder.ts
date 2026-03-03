/**
 * MCP configuration builder for Claude Agent SDK
 *
 * Builds a complete MCP server configuration by merging:
 * - Internal Nimbalyst MCP servers (nimbalyst-mcp, session-naming, extension-dev)
 * - User MCP config from ~/.config/claude/mcp.json
 * - Workspace MCP config from .mcp.json
 * - Extension plugins from the extension system
 *
 * Handles environment variable expansion and transport-specific transformations
 * (e.g., converting env vars to headers for SSE transport).
 */

import fs from 'fs';
import path from 'path';

/**
 * MCP server configuration object (raw format from config files)
 */
export interface MCPServerConfig {
  type?: 'sse' | 'stdio';
  transport?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  [key: string]: any;
}

/**
 * Internal MCP server ports
 */
export interface InternalMCPServers {
  /**
   * Port for nimbalyst-mcp server (if started)
   */
  nimbalystMcpPort?: number;

  /**
   * Port for session-naming MCP server (if started)
   */
  sessionNamingPort?: number;

  /**
   * Port for extension-dev MCP server (if started)
   */
  extensionDevPort?: number;
}

/**
 * Configuration options for MCPConfigBuilder
 */
export interface MCPConfigBuilderOptions {
  /**
   * Function to load merged MCP config (user + workspace)
   * Returns merged server configurations from both levels
   */
  mcpConfigLoader: (workspacePath?: string) => Promise<Record<string, MCPServerConfig>>;

  /**
   * Function to load extension plugins
   * Returns array of local plugin paths
   */
  extensionPluginsLoader: (workspacePath?: string) => Promise<Array<{ type: 'local'; path: string }>>;
}

/**
 * Build options for MCP configuration
 */
export interface MCPConfigBuildOptions {
  /**
   * Workspace path for workspace-specific config
   */
  workspacePath: string;

  /**
   * Optional session ID for session-specific MCP servers
   */
  sessionId?: string;

  /**
   * Internal MCP server ports
   */
  internalServers: InternalMCPServers;
}

/**
 * Built MCP configuration result
 */
export interface MCPConfig {
  /**
   * MCP server configurations
   */
  mcpServers: Record<string, MCPServerConfig>;

  /**
   * Plugin paths
   */
  plugins: Array<{ type: 'local'; path: string }>;
}

/**
 * Builds complete MCP configuration for Claude Agent SDK
 */
export class MCPConfigBuilder {
  private readonly mcpConfigLoader: (workspacePath?: string) => Promise<Record<string, MCPServerConfig>>;
  private readonly extensionPluginsLoader: (workspacePath?: string) => Promise<Array<{ type: 'local'; path: string }>>;

  constructor(options: MCPConfigBuilderOptions) {
    this.mcpConfigLoader = options.mcpConfigLoader;
    this.extensionPluginsLoader = options.extensionPluginsLoader;
  }

  /**
   * Build complete MCP configuration
   *
   * Merges internal servers with user/workspace config and loads plugins.
   *
   * @param options - Build options
   * @returns Complete MCP configuration
   */
  async buildConfig(options: MCPConfigBuildOptions): Promise<MCPConfig> {
    const { workspacePath, sessionId, internalServers } = options;
    const config: Record<string, MCPServerConfig> = {};

    // Add internal Nimbalyst MCP servers
    this.addInternalServers(config, workspacePath, sessionId, internalServers);

    // Load and merge user + workspace MCP servers
    try {
      const mergedServers = await this.mcpConfigLoader(workspacePath);

      // Process each server config (expand env vars, convert to headers for SSE, etc.)
      for (const [serverName, serverConfig] of Object.entries(mergedServers)) {
        const processedConfig = this.processServerConfig(serverName, serverConfig);
        config[serverName] = processedConfig;
      }
    } catch (error) {
      console.error('[MCPConfigBuilder] Failed to load MCP servers from config loader:', error);
      // Fall back to workspace-only loading
      await this.loadWorkspaceMcpServers(workspacePath, config);
    }

    // Load extension plugins
    const plugins = await this.extensionPluginsLoader(workspacePath);

    return {
      mcpServers: config,
      plugins,
    };
  }

  /**
   * Add internal Nimbalyst MCP servers to configuration
   *
   * @param config - Configuration object to add servers to
   * @param workspacePath - Workspace path for URL parameters
   * @param sessionId - Optional session ID for session-specific servers
   * @param internalServers - Internal server ports
   */
  private addInternalServers(
    config: Record<string, MCPServerConfig>,
    workspacePath: string,
    sessionId: string | undefined,
    internalServers: InternalMCPServers
  ): void {
    // nimbalyst-mcp server (provides capture_editor_screenshot, display_to_user, etc.)
    if (internalServers.nimbalystMcpPort && workspacePath) {
      let mcpUrl = `http://127.0.0.1:${internalServers.nimbalystMcpPort}/mcp?workspacePath=${encodeURIComponent(workspacePath)}`;
      if (sessionId) {
        mcpUrl += `&sessionId=${encodeURIComponent(sessionId)}`;
      }
      config['nimbalyst-mcp'] = {
        type: 'sse',
        transport: 'sse',
        url: mcpUrl,
      };
    }

    // session-naming server (provides update_session_meta tool)
    if (internalServers.sessionNamingPort && sessionId) {
      config['nimbalyst-session-naming'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${internalServers.sessionNamingPort}/mcp?sessionId=${encodeURIComponent(sessionId)}`,
      };
    }

    // extension-dev server (provides build, install, reload tools)
    if (internalServers.extensionDevPort) {
      const params = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      config['nimbalyst-extension-dev'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${internalServers.extensionDevPort}/mcp${params}`,
      };
    }
  }

  /**
   * Process a single MCP server config
   *
   * Applies transformations:
   * - Expand environment variables in args and env values
   * - Convert env vars to Authorization headers for SSE transport
   *
   * @param serverName - Name of the server (for logging)
   * @param serverConfig - Raw server configuration
   * @returns Processed server configuration
   */
  private processServerConfig(serverName: string, serverConfig: MCPServerConfig): MCPServerConfig {
    const processedConfig = { ...serverConfig };

    // Build combined env: process.env + config.env (config.env takes precedence)
    const combinedEnv: Record<string, string | undefined> = {
      ...process.env as Record<string, string | undefined>,
    };
    if (processedConfig.env) {
      for (const [key, value] of Object.entries(processedConfig.env)) {
        combinedEnv[key] = this.expandEnvVar(value, combinedEnv);
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
          const expandedValue = this.expandEnvVar(value, process.env as Record<string, string | undefined>);
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
   * Used when mcpConfigLoader fails or is not available.
   *
   * @param workspacePath - Workspace path
   * @param config - Configuration object to add servers to
   */
  private async loadWorkspaceMcpServers(
    workspacePath: string | undefined,
    config: Record<string, MCPServerConfig>
  ): Promise<void> {
    if (!workspacePath) return;

    try {
      const mcpJsonPath = path.join(workspacePath, '.mcp.json');

      // Check if file exists
      const exists = await fs.promises.access(mcpJsonPath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        return;
      }

      // Read and parse config file
      const mcpJsonContent = await fs.promises.readFile(mcpJsonPath, 'utf8');
      const mcpConfig = JSON.parse(mcpJsonContent);

      if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object') {
        // Process and merge workspace MCP servers with built-in servers
        for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
          const processedConfig = this.processServerConfig(serverName, serverConfig as MCPServerConfig);
          config[serverName] = processedConfig;
        }
      }
    } catch (error) {
      console.error('[MCPConfigBuilder] Failed to load .mcp.json:', error);
    }
  }

  /**
   * Expand environment variable syntax: ${VAR} and ${VAR:-default}
   *
   * Supports:
   * - ${VAR} - Simple variable expansion
   * - ${VAR:-default} - Variable with default value
   *
   * @param value - String with potential environment variable references
   * @param env - Environment variable map
   * @returns Expanded string
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
}
