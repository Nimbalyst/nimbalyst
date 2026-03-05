/**
 * MCP Server Configuration Types
 *
 * These types match Claude Code's .mcp.json schema for full compatibility.
 * https://docs.anthropic.com/claude/docs/claude-code
 */

/**
 * Environment variables for an MCP server.
 * Supports Claude Code's ${VAR} and ${VAR:-default} syntax.
 */
export interface MCPServerEnv {
  [key: string]: string;
}

/**
 * Configuration for a single MCP server.
 * Supports stdio (local executable), SSE (legacy remote), and HTTP (modern remote) transports.
 */
export interface MCPServerConfig {
  /**
   * Transport type:
   * - stdio: local executables communicating via stdin/stdout
   * - sse: legacy remote servers using Server-Sent Events (deprecated)
   * - http: modern remote servers using Streamable HTTP (recommended)
   */
  type?: 'stdio' | 'sse' | 'http';

  /** Command to execute the MCP server (stdio only, supports env var expansion) */
  command?: string;

  /** Arguments to pass to the command (stdio only, supports env var expansion) */
  args?: string[];

  /** Server URL for remote transport (sse or http only) */
  url?: string;

  /** Custom HTTP headers for remote transport (http only) */
  headers?: Record<string, string>;

  /** Environment variables to set (supports ${VAR} and ${VAR:-default} syntax) */
  env?: MCPServerEnv;

  /** Whether this server is disabled (default: false/enabled). @deprecated Use enabledForProviders instead. */
  disabled?: boolean;

  /**
   * Which AI agent providers this server is enabled for.
   * - undefined/absent: enabled for all providers (backward compatible default)
   * - ['claude-agent', 'codex']: enabled for all providers (explicit)
   * - ['claude-agent']: Claude Agent only
   * - ['codex']: Codex only
   * - []: disabled for all providers (equivalent to disabled: true)
   *
   * When both `disabled` and `enabledForProviders` are present, `enabledForProviders` takes priority.
   */
  enabledForProviders?: string[];
}

/** Provider IDs for enabledForProviders field */
export const MCP_PROVIDER_IDS = {
  CLAUDE_AGENT: 'claude-agent',
  CODEX: 'codex',
} as const;

export type MCPProviderId = typeof MCP_PROVIDER_IDS[keyof typeof MCP_PROVIDER_IDS];

export const ALL_MCP_PROVIDER_IDS: MCPProviderId[] = [
  MCP_PROVIDER_IDS.CLAUDE_AGENT,
  MCP_PROVIDER_IDS.CODEX,
];

/**
 * Determine if an MCP server is enabled for a given provider.
 * Handles backward compatibility with the legacy `disabled` field.
 */
export function isMCPServerEnabledForProvider(
  config: MCPServerConfig,
  providerId: MCPProviderId,
): boolean {
  if (config.enabledForProviders !== undefined) {
    return config.enabledForProviders.includes(providerId);
  }
  return !config.disabled;
}

/**
 * Root configuration object matching Claude Code's .mcp.json structure.
 */
export interface MCPConfig {
  /** Map of server name to server configuration */
  mcpServers: {
    [serverName: string]: MCPServerConfig;
  };
}

/**
 * Server configuration with its name (for UI display).
 */
export interface MCPServerWithName extends MCPServerConfig {
  name: string;
}
