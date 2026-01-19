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

  /** Environment variables to set (supports ${VAR} and ${VAR:-default} syntax) */
  env?: MCPServerEnv;

  /** Whether this server is disabled (default: false/enabled) */
  disabled?: boolean;
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
