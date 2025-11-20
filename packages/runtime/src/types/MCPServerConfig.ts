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
 * Supports both stdio (local executable) and SSE (remote server) transports.
 */
export interface MCPServerConfig {
  /** Transport type: stdio for local executables, sse for remote servers */
  type?: 'stdio' | 'sse';

  /** Command to execute the MCP server (stdio only, supports env var expansion) */
  command?: string;

  /** Arguments to pass to the command (stdio only, supports env var expansion) */
  args?: string[];

  /** Server URL for SSE transport (sse only) */
  url?: string;

  /** Environment variables to set (supports ${VAR} and ${VAR:-default} syntax) */
  env?: MCPServerEnv;
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
