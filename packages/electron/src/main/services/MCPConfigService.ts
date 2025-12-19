import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { MCPConfig, MCPServerConfig, MCPServerEnv } from '@nimbalyst/runtime/types/MCPServerConfig';
import { logger } from '../utils/logger';

/**
 * Service for managing MCP server configurations.
 *
 * Supports two scopes:
 * - User scope: Global MCP servers stored in Claude Code's standard location
 * - Workspace scope: Project-specific MCP servers in .mcp.json
 *
 * This service reads/writes Claude Code's native config files for full compatibility.
 */
export class MCPConfigService {
  private userConfigPath: string;

  private CONNECTION_TIMEOUT_MS = 20000;

  constructor() {

    // Claude Code stores user-level MCP config in ~/.config/claude/mcp.json (Linux/macOS)
    // or %APPDATA%/claude/mcp.json (Windows)
    const configDir = process.platform === 'win32'
      ? path.join(process.env.APPDATA || os.homedir(), 'claude')
      : path.join(os.homedir(), '.config', 'claude');

    this.userConfigPath = path.join(configDir, 'mcp.json');
  }

  /**
   * Read user-scope MCP configuration (global servers).
   */
  async readUserMCPConfig(): Promise<MCPConfig> {
    try {
      const content = await fs.readFile(this.userConfigPath, 'utf8');
      const config = JSON.parse(content) as MCPConfig;
      return config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - return empty config
        return { mcpServers: {} };
      }
      logger.mcp.error('Failed to read user MCP config:', error);
      throw error;
    }
  }

  /**
   * Write user-scope MCP configuration.
   */
  async writeUserMCPConfig(config: MCPConfig): Promise<void> {
    try {
      // Validate config before writing
      this.validateConfig(config);

      // Ensure config directory exists
      const configDir = path.dirname(this.userConfigPath);
      await fs.mkdir(configDir, { recursive: true });

      // Write config file
      const content = JSON.stringify(config, null, 2);
      await fs.writeFile(this.userConfigPath, content, 'utf8');

      logger.mcp.info('User MCP config saved');
    } catch (error) {
      logger.mcp.error('Failed to write user MCP config:', error);
      throw error;
    }
  }

  /**
   * Read workspace-scope MCP configuration (.mcp.json in project root).
   */
  async readWorkspaceMCPConfig(workspacePath: string): Promise<MCPConfig> {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    const mcpJsonPath = path.join(workspacePath, '.mcp.json');

    try {
      const content = await fs.readFile(mcpJsonPath, 'utf8');
      const config = JSON.parse(content) as MCPConfig;
      return config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - return empty config
        return { mcpServers: {} };
      }
      logger.mcp.error('Failed to read workspace MCP config:', error);
      throw error;
    }
  }

  /**
   * Write workspace-scope MCP configuration (.mcp.json in project root).
   */
  async writeWorkspaceMCPConfig(workspacePath: string, config: MCPConfig): Promise<void> {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    // Validate config before writing
    this.validateConfig(config);

    const mcpJsonPath = path.join(workspacePath, '.mcp.json');

    try {
      const content = JSON.stringify(config, null, 2);
      await fs.writeFile(mcpJsonPath, content, 'utf8');

      logger.mcp.info('Workspace MCP config saved:', mcpJsonPath);
    } catch (error) {
      logger.mcp.error('Failed to write workspace MCP config:', error);
      throw error;
    }
  }

  /**
   * Get merged MCP configuration (User + Workspace).
   * Workspace servers override User servers with the same name.
   */
  async getMergedConfig(workspacePath?: string): Promise<MCPConfig> {
    const userConfig = await this.readUserMCPConfig();

    if (!workspacePath) {
      return userConfig;
    }

    const workspaceConfig = await this.readWorkspaceMCPConfig(workspacePath);

    // Merge: workspace overrides user
    return {
      mcpServers: {
        ...userConfig.mcpServers,
        ...workspaceConfig.mcpServers
      }
    };
  }

  /**
   * Validate MCP configuration against Claude Code schema.
   * Throws error if invalid.
   */
  validateConfig(config: MCPConfig): void {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid MCP config: must be an object');
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      throw new Error('Invalid MCP config: mcpServers must be an object');
    }

    // Validate each server
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      if (!serverName || typeof serverName !== 'string') {
        throw new Error('Invalid MCP config: server name must be a non-empty string');
      }

      if (!serverConfig || typeof serverConfig !== 'object') {
        throw new Error(`Invalid MCP config for server "${serverName}": must be an object`);
      }

      // Determine transport type (default to stdio for backward compatibility)
      const transportType = serverConfig.type || 'stdio';

      if (transportType === 'stdio') {
        // stdio transport requires command
        if (!serverConfig.command || typeof serverConfig.command !== 'string') {
          throw new Error(`Invalid MCP config for server "${serverName}": command is required for stdio transport`);
        }

        if (serverConfig.args && !Array.isArray(serverConfig.args)) {
          throw new Error(`Invalid MCP config for server "${serverName}": args must be an array`);
        }
      } else if (transportType === 'sse') {
        // SSE transport requires url
        if (!serverConfig.url || typeof serverConfig.url !== 'string') {
          throw new Error(`Invalid MCP config for server "${serverName}": url is required for SSE transport`);
        }

        // Validate URL format
        try {
          new URL(serverConfig.url);
        } catch {
          throw new Error(`Invalid MCP config for server "${serverName}": url must be a valid URL`);
        }
      } else {
        throw new Error(`Invalid MCP config for server "${serverName}": unsupported transport type "${transportType}"`);
      }

      if (serverConfig.env && typeof serverConfig.env !== 'object') {
        throw new Error(`Invalid MCP config for server "${serverName}": env must be an object`);
      }
    }
  }

  /**
   * Get the path to the user-level MCP config file.
   */
  getUserConfigPath(): string {
    return this.userConfigPath;
  }

  /**
   * Get the path to the workspace-level MCP config file.
   */
  getWorkspaceConfigPath(workspacePath: string): string {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    return path.join(workspacePath, '.mcp.json');
  }

  /**
   * Test an MCP server connection.
   * For stdio: attempts to spawn and communicate with the process.
   * For SSE: attempts to connect to the URL endpoint.
   */
  async testServerConnection(config: MCPServerConfig): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate config first
      const tempConfig: MCPConfig = {
        mcpServers: { test: config }
      };
      this.validateConfig(tempConfig);

      const transportType = config.type || 'stdio';

      if (transportType === 'sse') {
        return await this.testSSEConnection(config);
      } else {
        return await this.testStdioConnection(config);
      }
    } catch (error: any) {
      logger.mcp.error('MCP server test error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test SSE server connection by attempting to fetch from the endpoint.
   * Note: This is a basic connectivity test. Full MCP protocol validation
   * happens when the server is actually used by Claude Code.
   */
  private async testSSEConnection(config: MCPServerConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.url) {
      return { success: false, error: 'URL is required for SSE transport' };
    }

    try {
      const headers = this.getHeadersFromEnv(config.env);

      logger.mcp.debug('Testing SSE connection to:', config.url);
      logger.mcp.debug('Headers:', Object.keys(headers));

      const response = await fetch(config.url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...headers
        },
        signal: AbortSignal.timeout(this.CONNECTION_TIMEOUT_MS)
      });

      // Check for authentication errors (401/403) - these indicate auth issues
      if (response.status === 401 || response.status === 403) {
        const errorText = await response.text().catch(() => response.statusText);
        logger.mcp.error(`SSE authentication failed: ${response.status} ${errorText}`);
        return {
          success: false,
          error: `Authentication failed (${response.status}). Check your API key.`
        };
      }

      // For other errors (including 500), the server is reachable but may need
      // proper MCP protocol handshake. Consider this as potentially working.
      if (response.ok || (response.status >= 400 && response.status < 600)) {
        logger.mcp.info('SSE endpoint reachable. Full validation happens during actual use.');
        return {
          success: true,
          error: response.status >= 400
            ? `Note: Test got HTTP ${response.status}, but server is reachable. Full test happens when Claude Code connects.`
            : undefined
        };
      }

      const errorText = await response.text().catch(() => response.statusText);
      logger.mcp.error(`SSE connection failed: ${response.status} ${errorText}`);
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText || response.statusText}`
      };
    } catch (error: any) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        return { success: false, error: 'Connection timeout (5s)' };
      }
      logger.mcp.error('SSE connection error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test stdio server connection by spawning the process.
   */
  private async testStdioConnection(config: MCPServerConfig): Promise<{ success: boolean; error?: string }> {
    const { spawn } = await import('child_process');

    if (!config.command) {
      return { success: false, error: 'Command is required for stdio transport' };
    }

    return new Promise((resolve) => {
      try {
        // Expand environment variables
        const env = { ...process.env };
        if (config.env) {
          for (const [key, value] of Object.entries(config.env)) {
            env[key] = this.expandEnvVar(value, env);
          }
        }

        // Spawn the process (command is validated above)
        const child = spawn(config.command!, config.args || [], {
          env,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        let errorOutput = '';
        const timeout = setTimeout(() => {
          child.kill();
          resolve({ success: false, error: 'Connection timeout (20s)' });
        }, this.CONNECTION_TIMEOUT_MS);

        child.stdout?.on('data', (data) => {
          output += data.toString();
        });

        child.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });

        child.on('error', (error) => {
          clearTimeout(timeout);
          logger.mcp.error('MCP server spawn error:', error);
          resolve({ success: false, error: error.message });
        });

        child.on('exit', (code) => {
          clearTimeout(timeout);
          if (code === 0 || output.length > 0) {
            // If process exits cleanly or produced output, consider it a success
            resolve({ success: true });
          } else {
            resolve({
              success: false,
              error: errorOutput || `Process exited with code ${code}`
            });
          }
        });

        // Try to detect if server started successfully by looking for initialization
        setTimeout(() => {
          if (output.length > 0 || errorOutput.includes('initialize')) {
            clearTimeout(timeout);
            child.kill();
            resolve({ success: true });
          }
        }, 2000);

      } catch (error: any) {
        logger.mcp.error('MCP server test error:', error);
        resolve({ success: false, error: error.message });
      }
    });
  }

  /**
   * Extract headers from environment variables (for SSE authentication).
   * Sends API keys as Authorization Bearer tokens.
   */
  private getHeadersFromEnv(env?: MCPServerEnv): Record<string, string> {
    const headers: Record<string, string> = {};

    if (env) {
      // Expand environment variables from the config
      const processEnv: Record<string, string | undefined> = { ...process.env };

      for (const [key, value] of Object.entries(env) as [string, string][]) {
        const expandedValue = this.expandEnvVar(value, processEnv);

        // Send API keys as Authorization Bearer tokens
        if (key.endsWith('_API_KEY') && expandedValue) {
          // Don't add Bearer prefix if value already has it or if it's empty
          if (!expandedValue.startsWith('Bearer ') && expandedValue !== `\${${key}}`) {
            headers['Authorization'] = `Bearer ${expandedValue}`;
            logger.mcp.debug(`Added Authorization header from ${key}`);
          }
        }
      }
    }

    return headers;
  }

  /**
   * Expand environment variable syntax: ${VAR} and ${VAR:-default}
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
