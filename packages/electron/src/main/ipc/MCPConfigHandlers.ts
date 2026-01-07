import { ipcMain, BrowserWindow, shell } from 'electron';
import { MCPConfigService, TestProgressCallback } from '../services/MCPConfigService';
import { getEnhancedPath } from '../services/CLIManager';
import { MCPConfig } from '@nimbalyst/runtime/types/MCPServerConfig';
import { logger } from '../utils/logger';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

const mcpConfigService = new MCPConfigService();

export function registerMCPConfigHandlers() {
  // Read user-scope MCP configuration
  ipcMain.handle('mcp-config:read-user', async () => {
    try {
      return await mcpConfigService.readUserMCPConfig();
    } catch (error) {
      logger.main.error('[MCP] Failed to read user config:', error);
      throw error;
    }
  });

  // Write user-scope MCP configuration
  ipcMain.handle('mcp-config:write-user', async (_event, config: MCPConfig) => {
    try {
      await mcpConfigService.writeUserMCPConfig(config);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[MCP] Failed to write user config:', error);
      return { success: false, error: message };
    }
  });

  // Read workspace-scope MCP configuration
  ipcMain.handle('mcp-config:read-workspace', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      return await mcpConfigService.readWorkspaceMCPConfig(workspacePath);
    } catch (error) {
      logger.main.error('[MCP] Failed to read workspace config:', error);
      throw error;
    }
  });

  // Write workspace-scope MCP configuration
  ipcMain.handle('mcp-config:write-workspace', async (_event, workspacePath: string, config: MCPConfig) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      await mcpConfigService.writeWorkspaceMCPConfig(workspacePath, config);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[MCP] Failed to write workspace config:', error);
      return { success: false, error: message };
    }
  });

  // Get merged configuration (User + Workspace)
  ipcMain.handle('mcp-config:get-merged', async (_event, workspacePath?: string) => {
    try {
      return await mcpConfigService.getMergedConfig(workspacePath);
    } catch (error) {
      logger.main.error('[MCP] Failed to get merged config:', error);
      throw error;
    }
  });

  // Validate configuration
  ipcMain.handle('mcp-config:validate', async (_event, config: MCPConfig) => {
    try {
      mcpConfigService.validateConfig(config);
      return { valid: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  });

  // Get config file paths
  ipcMain.handle('mcp-config:get-user-path', () => {
    return mcpConfigService.getUserConfigPath();
  });

  ipcMain.handle('mcp-config:get-workspace-path', (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    return mcpConfigService.getWorkspaceConfigPath(workspacePath);
  });

  // Test MCP server connection with progress updates
  ipcMain.handle('mcp-config:test-server', async (event, config: any) => {
    try {
      // Get the window that sent this request to send progress updates
      const window = BrowserWindow.fromWebContents(event.sender);

      const onProgress: TestProgressCallback = (status, message) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('mcp-config:test-progress', { status, message });
        }
      };

      const result = await mcpConfigService.testServerConnection(config, onProgress);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[MCP] Failed to test server:', error);
      return { success: false, error: message };
    }
  });

  // Check OAuth authorization status for mcp-remote servers
  ipcMain.handle('mcp-config:check-oauth-status', async (_event, serverUrl: string) => {
    try {
      const status = await checkMcpRemoteAuthStatus(serverUrl);
      return status;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[MCP] Failed to check OAuth status:', error);
      return { authorized: false, error: message };
    }
  });

  // Trigger OAuth authorization for mcp-remote servers
  ipcMain.handle('mcp-config:trigger-oauth', async (_event, serverUrl: string) => {
    try {
      const result = await triggerMcpRemoteOAuth(serverUrl);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[MCP] Failed to trigger OAuth:', error);
      return { success: false, error: message };
    }
  });

  // Revoke OAuth authorization (clear tokens)
  ipcMain.handle('mcp-config:revoke-oauth', async (_event, serverUrl: string) => {
    try {
      const result = await revokeMcpRemoteOAuth(serverUrl);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[MCP] Failed to revoke OAuth:', error);
      return { success: false, error: message };
    }
  });
}

/**
 * Get the mcp-remote auth directory path
 */
function getMcpAuthDir(): string {
  return process.env.MCP_REMOTE_CONFIG_DIR || path.join(os.homedir(), '.mcp-auth');
}

/**
 * Generate hashes that mcp-remote might use for token file naming
 * mcp-remote uses MD5 hash of the server URL
 */
function getServerHashes(serverUrl: string): string[] {
  // mcp-remote uses MD5 hash of the server URL
  const md5Hash = crypto.createHash('md5').update(serverUrl).digest('hex');
  // Also try SHA256 in case different versions use different hashes
  const sha256Hash = crypto.createHash('sha256').update(serverUrl).digest('hex').substring(0, 32);
  return [md5Hash, sha256Hash];
}

/**
 * Check if OAuth tokens exist for a given server URL
 * mcp-remote stores tokens in versioned directories like ~/.mcp-auth/mcp-remote-0.1.36/
 */
async function checkMcpRemoteAuthStatus(serverUrl: string): Promise<{ authorized: boolean; tokenPath?: string }> {
  const authDir = getMcpAuthDir();
  const serverHashes = getServerHashes(serverUrl);

  try {
    // First, find all mcp-remote version directories
    const entries = await fs.promises.readdir(authDir, { withFileTypes: true });
    const versionDirs = entries
      .filter(e => e.isDirectory() && e.name.startsWith('mcp-remote-'))
      .map(e => e.name)
      .sort()
      .reverse(); // Check newest versions first

    // Search in each version directory
    for (const versionDir of versionDirs) {
      const versionPath = path.join(authDir, versionDir);
      try {
        const files = await fs.promises.readdir(versionPath);
        for (const file of files) {
          // Check if this file matches any of our hashes and is a token file
          if (file.endsWith('_tokens.json')) {
            const fileHash = file.replace('_tokens.json', '');
            if (serverHashes.includes(fileHash)) {
              const tokenPath = path.join(versionPath, file);
              try {
                const content = await fs.promises.readFile(tokenPath, 'utf-8');
                const tokens = JSON.parse(content);
                if (tokens.access_token || tokens.accessToken) {
                  logger.main.info('[MCP] Found OAuth tokens at:', tokenPath);
                  return { authorized: true, tokenPath };
                }
              } catch {
                // Invalid JSON, continue
              }
            }
          }
        }
      } catch {
        // Can't read version directory, continue
      }
    }

    // Also check root auth dir for older formats
    for (const hash of serverHashes) {
      const possibleFiles = [
        path.join(authDir, `${hash}_tokens.json`),
        path.join(authDir, `${hash}.json`),
      ];
      for (const tokenPath of possibleFiles) {
        try {
          const content = await fs.promises.readFile(tokenPath, 'utf-8');
          const tokens = JSON.parse(content);
          if (tokens.access_token || tokens.accessToken) {
            return { authorized: true, tokenPath };
          }
        } catch {
          // File doesn't exist or isn't readable
        }
      }
    }
  } catch {
    // Auth directory doesn't exist
  }

  return { authorized: false };
}

/**
 * Trigger OAuth flow for mcp-remote
 * This spawns mcp-remote which will open a browser for OAuth
 */
async function triggerMcpRemoteOAuth(serverUrl: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.main.info('[MCP] Triggering OAuth for:', serverUrl);

    // On Windows, use npx.cmd with shell:true to avoid PowerShell execution policy issues
    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    // Spawn npx - use shell on Windows for .cmd files to execute properly
    // Use enhanced PATH for GUI apps (they don't inherit shell PATH on macOS/Windows)
    const child = spawn(npxCommand, ['-y', 'mcp-remote', serverUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: getEnhancedPath() },
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        child.kill();
      }
    };

    // Set a timeout - OAuth should complete within 60 seconds
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ success: false, error: 'OAuth flow timed out. Please try again.' });
    }, 60000);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
      logger.main.debug('[MCP OAuth] stdout:', data.toString());

      // Look for success indicators in the output
      if (stdout.includes('authorized') || stdout.includes('success') || stdout.includes('token')) {
        clearTimeout(timeout);
        cleanup();
        resolve({ success: true });
      }
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
      logger.main.debug('[MCP OAuth] stderr:', data.toString());
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      cleanup();
      resolve({ success: false, error: error.message });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        // Check if tokens were created (success even if process exited)
        checkMcpRemoteAuthStatus(serverUrl).then((status) => {
          if (status.authorized) {
            resolve({ success: true });
          } else if (code === 0) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: stderr || `Process exited with code ${code}` });
          }
        });
      }
    });

    // Write to stdin to trigger the process, then close it
    // mcp-remote expects to run as a stdio server, so we need to send something
    try {
      if (child.stdin) {
        child.stdin.write('{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}\n');
      } else {
        logger.main.warn('[MCP OAuth] stdin not available for writing');
      }
    } catch (error) {
      logger.main.warn('[MCP OAuth] Failed to write to stdin:', error);
    }

    // Give it a moment to start the OAuth flow, then check status periodically
    const checkInterval = setInterval(async () => {
      if (resolved) {
        clearInterval(checkInterval);
        return;
      }
      const status = await checkMcpRemoteAuthStatus(serverUrl);
      if (status.authorized) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        cleanup();
        resolve({ success: true });
      }
    }, 2000);
  });
}

/**
 * Revoke OAuth authorization by deleting token files
 */
async function revokeMcpRemoteOAuth(serverUrl: string): Promise<{ success: boolean; error?: string }> {
  const authDir = getMcpAuthDir();
  const serverHashes = getServerHashes(serverUrl);

  try {
    // Find all mcp-remote version directories
    const entries = await fs.promises.readdir(authDir, { withFileTypes: true });
    const versionDirs = entries
      .filter(e => e.isDirectory() && e.name.startsWith('mcp-remote-'))
      .map(e => e.name);

    // Delete token files from each version directory
    for (const versionDir of versionDirs) {
      const versionPath = path.join(authDir, versionDir);
      try {
        const files = await fs.promises.readdir(versionPath);
        for (const file of files) {
          // Check if this file matches any of our hashes
          for (const hash of serverHashes) {
            if (file.startsWith(hash)) {
              const filePath = path.join(versionPath, file);
              try {
                await fs.promises.unlink(filePath);
                logger.main.info('[MCP] Deleted token file:', filePath);
              } catch (err) {
                logger.main.warn('[MCP] Failed to delete:', filePath, err);
              }
            }
          }
        }
      } catch {
        // Can't read version directory, continue
      }
    }

    // Also check root auth dir for older formats
    for (const hash of serverHashes) {
      const possibleFiles = [
        path.join(authDir, `${hash}_tokens.json`),
        path.join(authDir, `${hash}.json`),
        path.join(authDir, `${hash}_client_info.json`),
        path.join(authDir, `${hash}_code_verifier.txt`),
        path.join(authDir, `${hash}_lock.json`),
      ];
      for (const filePath of possibleFiles) {
        try {
          await fs.promises.unlink(filePath);
          logger.main.info('[MCP] Deleted token file:', filePath);
        } catch {
          // File doesn't exist, that's fine
        }
      }
    }

    return { success: true };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // Auth directory doesn't exist, nothing to revoke
      return { success: true };
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}
