import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { MCPConfig, MCPServerConfig } from '@nimbalyst/runtime/types/MCPServerConfig';
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

      if (!serverConfig.command || typeof serverConfig.command !== 'string') {
        throw new Error(`Invalid MCP config for server "${serverName}": command is required and must be a string`);
      }

      if (serverConfig.args && !Array.isArray(serverConfig.args)) {
        throw new Error(`Invalid MCP config for server "${serverName}": args must be an array`);
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
}
