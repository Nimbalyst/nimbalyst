import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { MCPConfig, MCPServerConfig, MCPServerEnv } from '@nimbalyst/runtime/types/MCPServerConfig';
import { logger } from '../utils/logger';
import { getEnhancedPath } from './CLIManager';

/**
 * Service for managing MCP server configurations.
 *
 * Supports two scopes:
 * - User scope: Global MCP servers stored in Claude Code's standard location
 * - Workspace scope: Project-specific MCP servers in .mcp.json
 *
 * This service reads/writes Claude Code's native config files for full compatibility.
 */
export interface TestProgressCallback {
  (status: 'downloading' | 'connecting' | 'testing' | 'done', message: string): void;
}

/**
 * Get helpful error message and install URL for command not found errors.
 * Exported for use by other modules (e.g., OAuth handlers).
 */
export function getCommandNotFoundHelp(command: string): { message: string; helpUrl?: string } {
  // Map commands to their install instructions
  const commandHelp: Record<string, { message: string; helpUrl: string }> = {
    npx: {
      message: `Command 'npx' not found. Node.js needs to be installed to use this MCP server.`,
      helpUrl: 'https://nodejs.org/en/download'
    },
    node: {
      message: `Command 'node' not found. Node.js needs to be installed to use this MCP server.`,
      helpUrl: 'https://nodejs.org/en/download'
    },
    npm: {
      message: `Command 'npm' not found. Node.js needs to be installed to use this MCP server.`,
      helpUrl: 'https://nodejs.org/en/download'
    },
    uvx: {
      message: `Command 'uvx' not found. Please install uv to use this MCP server.`,
      helpUrl: 'https://docs.astral.sh/uv/getting-started/installation/'
    },
    uv: {
      message: `Command 'uv' not found. Please install uv to use this MCP server.`,
      helpUrl: 'https://docs.astral.sh/uv/getting-started/installation/'
    },
    python: {
      message: `Command 'python' not found. Python needs to be installed to use this MCP server.`,
      helpUrl: 'https://www.python.org/downloads/'
    },
    python3: {
      message: `Command 'python3' not found. Python needs to be installed to use this MCP server.`,
      helpUrl: 'https://www.python.org/downloads/'
    },
    docker: {
      message: `Command 'docker' not found. Docker Desktop needs to be installed to use this MCP server.`,
      helpUrl: 'https://www.docker.com/products/docker-desktop/'
    },
    bunx: {
      message: `Command 'bunx' not found. Bun needs to be installed to use this MCP server.`,
      helpUrl: 'https://bun.sh/docs/installation'
    },
    bun: {
      message: `Command 'bun' not found. Bun needs to be installed to use this MCP server.`,
      helpUrl: 'https://bun.sh/docs/installation'
    },
    deno: {
      message: `Command 'deno' not found. Deno needs to be installed to use this MCP server.`,
      helpUrl: 'https://docs.deno.com/runtime/getting_started/installation/'
    },
    pipx: {
      message: `Command 'pipx' not found. pipx needs to be installed to use this MCP server.`,
      helpUrl: 'https://pipx.pypa.io/stable/installation/'
    }
  };

  // Strip Windows .cmd/.exe suffixes for lookup (e.g., npx.cmd -> npx, node.exe -> node)
  const normalizedCommand = command.replace(/\.(cmd|exe)$/i, '');

  const help = commandHelp[normalizedCommand];
  if (help) {
    return help;
  }

  // Default message for unknown commands
  return {
    message: `Command '${command}' not found. Please ensure it is installed and available in your PATH.`
  };
}

export class MCPConfigService {
  private userConfigPath: string;

  private CONNECTION_TIMEOUT_MS = 30000; // Base timeout
  private DOWNLOAD_TIMEOUT_MS = 120000; // Extended timeout when downloading packages

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
   * Process a server config for runtime use.
   * On Windows, converts npm/npx/etc commands to their .cmd equivalents.
   */
  processServerConfigForRuntime(serverConfig: MCPServerConfig): MCPServerConfig {
    // Only process stdio servers with a command
    if (serverConfig.type === 'sse' || !serverConfig.command) {
      return serverConfig;
    }

    // Resolve command for current platform
    const resolvedCommand = this.resolveCommandForPlatform(serverConfig.command);

    // Return a new config with the resolved command
    return {
      ...serverConfig,
      command: resolvedCommand
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
  async testServerConnection(
    config: MCPServerConfig,
    onProgress?: TestProgressCallback
  ): Promise<{ success: boolean; error?: string; helpUrl?: string }> {
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
        return await this.testStdioConnection(config, onProgress);
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

      // Only consider 2xx responses as success
      if (response.ok) {
        logger.mcp.info('SSE endpoint reachable and responding successfully.');
        return { success: true };
      }

      // Any non-2xx response (that wasn't already caught as 401/403) is a failure
      const errorText = await response.text().catch(() => response.statusText);
      logger.mcp.error(`SSE endpoint returned error: ${response.status} ${errorText}`);
      return {
        success: false,
        error: `Server returned HTTP ${response.status}. Check your configuration and API key.`
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
   * Detects npx package downloads and reports progress.
   */
  private async testStdioConnection(
    config: MCPServerConfig,
    onProgress?: TestProgressCallback
  ): Promise<{ success: boolean; error?: string; helpUrl?: string }> {
    const { spawn } = await import('child_process');

    if (!config.command) {
      return { success: false, error: 'Command is required for stdio transport' };
    }

    return new Promise((resolve) => {
      try {
        // Expand environment variables and use enhanced PATH for GUI apps
        // (GUI apps on macOS don't inherit shell PATH, so npx/uvx/etc. may not be found)
        const enhancedPath = getEnhancedPath();
        const env: NodeJS.ProcessEnv = { ...process.env, PATH: enhancedPath };
        if (config.env) {
          for (const [key, value] of Object.entries(config.env)) {
            env[key] = this.expandEnvVar(value, env);
          }
        }

        // On Windows, use .cmd versions of npm/npx to avoid PowerShell execution policy issues
        const command = this.resolveCommandForPlatform(config.command!);

        // Expand environment variables in args as well (e.g., ${FILESYSTEM_ALLOWED_DIR})
        let expandedArgs = (config.args || []).map(arg => this.expandEnvVar(arg, env));

        // On Windows with shell:true, we need to manually quote args containing spaces
        // because windowsVerbatimArguments is automatically set to true with cmd.exe,
        // meaning no automatic escaping is done. Without quoting, cmd.exe treats
        // spaces as argument separators, breaking args like "Authorization:Bearer token"
        if (process.platform === 'win32') {
          expandedArgs = expandedArgs.map(arg => {
            // If arg contains spaces or special cmd characters, wrap in double quotes
            // Also escape any internal double quotes by doubling them
            if (arg.includes(' ') || arg.includes('&') || arg.includes('|') || arg.includes('^')) {
              return `"${arg.replace(/"/g, '""')}"`;
            }
            return arg;
          });
        }

        logger.mcp.info('[MCP Test] Starting stdio connection test');
        logger.mcp.info(`[MCP Test] Command: ${command} (original: ${config.command})`);
        logger.mcp.info(`[MCP Test] Args: ${JSON.stringify(expandedArgs)} (original: ${JSON.stringify(config.args)})`);
        logger.mcp.info(`[MCP Test] Env keys: ${Object.keys(config.env || {}).join(', ')}`);
        logger.mcp.info(`[MCP Test] Enhanced PATH (first 300 chars): ${enhancedPath.substring(0, 300)}...`);

        onProgress?.('connecting', 'Starting server...');

        // Spawn the process (command is validated above)
        // On Windows, .cmd files need shell:true to execute properly
        const child = spawn(command, expandedArgs, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32'
        });

        logger.mcp.info(`[MCP Test] Process spawned with PID: ${child.pid}`);

        let output = '';
        let errorOutput = '';
        let hasExtendedTimeout = false;
        let hasSentInitialize = false;
        let resolved = false;
        let timeoutId: NodeJS.Timeout;
        let currentTimeoutMs = this.CONNECTION_TIMEOUT_MS;

        const resolveOnce = (result: { success: boolean; error?: string; helpUrl?: string }) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            child.kill();
            onProgress?.('done', '');
            resolve(result);
          }
        };

        const resetTimeout = (newTimeoutMs: number) => {
          clearTimeout(timeoutId);
          currentTimeoutMs = newTimeoutMs;
          timeoutId = setTimeout(() => {
            if (!resolved) {
              const timeoutSec = Math.round(currentTimeoutMs / 1000);
              logger.mcp.warn(`[MCP Test] Connection timeout reached (${timeoutSec}s)`);
              logger.mcp.info(`[MCP Test] stdout so far: ${output.slice(0, 500)}`);
              logger.mcp.info(`[MCP Test] stderr so far: ${errorOutput.slice(0, 1000)}`);
              resolveOnce({ success: false, error: `Connection timeout (${timeoutSec}s)` });
            }
          }, newTimeoutMs);
        };

        // Send initialize request to test JSON-RPC communication
        const sendInitializeRequest = () => {
          if (resolved || hasSentInitialize || !child.stdin) return;

          hasSentInitialize = true;
          const initRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: {
                name: "nimbalyst-test",
                version: "1.0.0"
              }
            }
          };

          try {
            logger.mcp.info('[MCP Test] Sending initialize request');
            onProgress?.('testing', 'Testing server connection...');
            child.stdin.write(JSON.stringify(initRequest) + '\n');
          } catch (error: any) {
            logger.mcp.error('[MCP Test] Failed to send initialize request:', error);
          }
        };

        // Start with base timeout
        resetTimeout(this.CONNECTION_TIMEOUT_MS);

        child.stdout?.on('data', (data) => {
          const chunk = data.toString();
          output += chunk;
          logger.mcp.debug(`[MCP Test] stdout: ${chunk.slice(0, 200)}`);

          // Try to parse JSON-RPC responses
          // MCP servers may send multiple JSON objects separated by newlines
          const lines = output.split('\n');
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
              const msg = JSON.parse(line);

              // Check if this is a valid JSON-RPC response to our initialize request
              if (msg.jsonrpc === '2.0' && msg.id === 1) {
                if (msg.result) {
                  logger.mcp.info('[MCP Test] Received valid initialize response');
                  logger.mcp.debug(`[MCP Test] Response: ${JSON.stringify(msg.result).slice(0, 200)}`);
                  resolveOnce({ success: true });
                  return;
                } else if (msg.error) {
                  logger.mcp.error(`[MCP Test] Initialize failed: ${JSON.stringify(msg.error)}`);
                  resolveOnce({ success: false, error: msg.error.message || 'Initialize failed' });
                  return;
                }
              }

              // If we see any valid JSON-RPC on stdout, the server is responding
              // Send initialize request if we haven't already
              if (msg.jsonrpc === '2.0' && !hasSentInitialize) {
                logger.mcp.info('[MCP Test] Detected JSON-RPC output, sending initialize');
                sendInitializeRequest();
              }
            } catch (e) {
              // Not valid JSON, keep accumulating
            }
          }
        });

        child.stderr?.on('data', (data) => {
          const chunk = data.toString();
          errorOutput += chunk;
          logger.mcp.info(`[MCP Test] stderr: ${chunk.slice(0, 500)}`);

          // Detect npx/npm/uvx download progress patterns
          // Only extend timeout once to avoid race conditions
          if (!hasExtendedTimeout &&
              (chunk.includes('npm warn') || chunk.includes('npm notice') ||
              chunk.includes('added') || chunk.includes('packages in') ||
              chunk.includes('reify:') || chunk.includes('timing') ||
              chunk.includes('Resolved') || chunk.includes('Prepared') ||
              chunk.includes('Installed') || chunk.includes('Building') ||
              chunk.includes('Cloning') || chunk.includes('Fetching'))) {
            hasExtendedTimeout = true;
            logger.mcp.info('[MCP Test] Detected package download, extending timeout to 120s');
            onProgress?.('downloading', 'Downloading packages...');
            resetTimeout(this.DOWNLOAD_TIMEOUT_MS);
          }

          // After packages are downloaded or server starts logging, try to communicate
          // Look for common server startup patterns to know when to send initialize
          if (!hasSentInitialize &&
              (chunk.includes('MCP server') ||
              chunk.includes('server_lifespan') ||
              chunk.includes('Starting') ||
              chunk.includes('Listening') ||
              chunk.includes('Ready'))) {
            logger.mcp.info('[MCP Test] Server startup detected, will send initialize request');
            // Wait a moment for server to fully initialize, then send request
            setTimeout(() => {
              sendInitializeRequest();
            }, 1000);
          }

          if (chunk.includes('Connection error') || chunk.includes('Fatal error')) {
            logger.mcp.error(`[MCP Test] Connection error detected: ${chunk}`);
          }
        });

        child.on('error', (error: NodeJS.ErrnoException) => {
          logger.mcp.error('[MCP Test] Spawn error:', error);

          // Provide helpful error message for command not found
          if (error.code === 'ENOENT') {
            const commandHelp = this.getCommandNotFoundHelp(config.command || '');
            logger.mcp.error(`[MCP Test] Command not found in PATH: ${config.command}`);
            logger.mcp.error(`[MCP Test] Enhanced PATH used: ${enhancedPath.substring(0, 500)}...`);
            resolveOnce({ success: false, error: commandHelp.message, helpUrl: commandHelp.helpUrl });
          } else {
            resolveOnce({ success: false, error: error.message });
          }
        });

        child.on('exit', (code, signal) => {
          logger.mcp.info(`[MCP Test] Process exited with code: ${code}, signal: ${signal}`);
          logger.mcp.info(`[MCP Test] Final stdout length: ${output.length}`);
          logger.mcp.info(`[MCP Test] Final stderr: ${errorOutput.slice(0, 500)}`);

          if (!resolved) {
            // Process exited before we got a valid JSON-RPC response
            if (code === 0) {
              // Clean exit but no response - might be a one-shot command
              logger.mcp.info('[MCP Test] Process exited cleanly but no JSON-RPC response');
              resolveOnce({ success: false, error: 'Server exited without responding to initialize request' });
            } else {
              // Check if this is a "command not found" error from the shell
              // Windows: "'xyz' is not recognized as an internal or external command"
              // Unix: "command not found" or "not found"
              const notFoundMatch = errorOutput.match(/'([^']+)' is not recognized|(\S+): (?:command )?not found/i);
              if (notFoundMatch) {
                const cmdName = notFoundMatch[1] || notFoundMatch[2];
                const commandHelp = this.getCommandNotFoundHelp(cmdName);
                logger.mcp.warn(`[MCP Test] Command not found: ${cmdName}`);
                resolveOnce({ success: false, error: commandHelp.message, helpUrl: commandHelp.helpUrl });
              } else {
                logger.mcp.warn(`[MCP Test] Test failed: ${errorOutput || `exit code ${code}`}`);
                resolveOnce({
                  success: false,
                  error: errorOutput || `Process exited with code ${code}`
                });
              }
            }
          }
        });

        // If we haven't detected server startup patterns after a few seconds, try sending initialize anyway
        // Some servers might be ready but just not logging anything to stderr
        setTimeout(() => {
          if (!hasSentInitialize && !resolved) {
            logger.mcp.info('[MCP Test] No startup patterns detected, attempting initialize anyway');
            sendInitializeRequest();
          }
        }, 3000);

      } catch (error: any) {
        logger.mcp.error('[MCP Test] Unexpected error:', error);
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

  /**
   * Resolve command for the current platform.
   * On Windows, npm/npx need to use .cmd extension to avoid PowerShell execution policy issues.
   */
  private resolveCommandForPlatform(command: string): string {
    if (process.platform !== 'win32') {
      return command;
    }

    // On Windows, use .cmd versions to bypass PowerShell execution policy
    // PowerShell tries to run .ps1 scripts which may be blocked by security policy
    const windowsCommands: Record<string, string> = {
      'npx': 'npx.cmd',
      'npm': 'npm.cmd',
      'node': 'node.exe',
      'pnpm': 'pnpm.cmd',
      'yarn': 'yarn.cmd',
      'bun': 'bun.exe'
    };

    return windowsCommands[command] || command;
  }

  /**
   * Get helpful error message and install URL for command not found errors.
   * Delegates to the exported standalone function.
   */
  private getCommandNotFoundHelp(command: string): { message: string; helpUrl?: string } {
    return getCommandNotFoundHelp(command);
  }
}
