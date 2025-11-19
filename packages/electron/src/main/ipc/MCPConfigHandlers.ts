import { ipcMain } from 'electron';
import { MCPConfigService } from '../services/MCPConfigService';
import { MCPConfig } from '@nimbalyst/runtime/types/MCPServerConfig';
import { logger } from '../utils/logger';

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
    } catch (error: any) {
      logger.main.error('[MCP] Failed to write user config:', error);
      return { success: false, error: error.message };
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
    } catch (error: any) {
      logger.main.error('[MCP] Failed to write workspace config:', error);
      return { success: false, error: error.message };
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
    } catch (error: any) {
      return { valid: false, error: error.message };
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
}
