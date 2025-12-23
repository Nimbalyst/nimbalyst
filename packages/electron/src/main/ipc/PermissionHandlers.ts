/**
 * IPC handlers for agent permission settings
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { getPermissionService } from '../services/PermissionService';
import { logger } from '../utils/logger';

/**
 * Broadcast permission changes to all renderer processes
 */
function broadcastPermissionChange(workspacePath: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    window.webContents.send('permissions:changed', { workspacePath });
  }
}

export function registerPermissionHandlers(): void {
  const permissionService = getPermissionService();

  // Open directory dialog for selecting additional directories
  ipcMain.handle('dialog:openDirectory', async (event, options?: { title?: string; buttonLabel?: string }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = {
      title: options?.title || 'Select Directory',
      buttonLabel: options?.buttonLabel || 'Select',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result;
  });

  // Get workspace permissions (trust status, allowed/denied patterns, mode, directories)
  ipcMain.handle('permissions:getWorkspacePermissions', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    const workspaceName = workspacePath.split('/').pop() || workspacePath;

    try {
      const allowedPatterns = permissionService.getAllowedPatterns(workspacePath);
      const deniedPatterns = permissionService.getDeniedPatterns(workspacePath);
      const permissionMode = permissionService.getPermissionMode(workspacePath);
      const additionalDirectories = permissionService.getAdditionalDirectories(workspacePath);
      const allowedUrlPatterns = permissionService.getAllowedUrlPatterns(workspacePath);

      // isTrusted is derived from permissionMode (null = not trusted)
      const isTrusted = permissionMode !== null;

      logger.main.info(`[PermissionHandlers:${workspaceName}] getWorkspacePermissions:`, {
        workspace: workspacePath,
        isTrusted,
        permissionMode,
        allowedPatternsCount: allowedPatterns.length,
        deniedPatternsCount: deniedPatterns.length,
        additionalDirectoriesCount: additionalDirectories.length,
        allowedUrlPatternsCount: allowedUrlPatterns.length,
      });

      return {
        isTrusted,
        allowedPatterns,
        deniedPatterns,
        permissionMode,
        additionalDirectories,
        allowedUrlPatterns,
      };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to get workspace permissions:', error);
      throw error;
    }
  });

  // Trust a workspace for agent operations
  ipcMain.handle('permissions:trustWorkspace', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      permissionService.trustWorkspace(workspacePath);
      logger.main.info('[PermissionHandlers] Workspace trusted:', workspacePath);
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to trust workspace:', error);
      throw error;
    }
  });

  // Revoke workspace trust
  ipcMain.handle('permissions:revokeWorkspaceTrust', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      permissionService.revokeWorkspaceTrust(workspacePath);
      logger.main.info('[PermissionHandlers] Workspace trust revoked:', workspacePath);
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to revoke workspace trust:', error);
      throw error;
    }
  });

  // Remove a pattern rule
  ipcMain.handle('permissions:removePattern', async (_event, workspacePath: string, pattern: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!pattern) {
      throw new Error('pattern is required');
    }

    try {
      permissionService.removePatternRule(workspacePath, pattern);
      logger.main.info('[PermissionHandlers] Pattern removed:', pattern);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to remove pattern:', error);
      throw error;
    }
  });

  // Reset permissions to defaults
  ipcMain.handle('permissions:resetToDefaults', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      permissionService.resetPermissions(workspacePath);
      logger.main.info('[PermissionHandlers] Permissions reset to defaults:', workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to reset permissions:', error);
      throw error;
    }
  });

  // Add an allowed pattern manually
  ipcMain.handle('permissions:addAllowedPattern', async (_event, workspacePath: string, pattern: string, displayName: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!pattern) {
      throw new Error('pattern is required');
    }

    try {
      permissionService.addAllowedPattern(workspacePath, pattern, displayName || pattern);
      logger.main.info('[PermissionHandlers] Allowed pattern added:', pattern);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to add allowed pattern:', error);
      throw error;
    }
  });

  // Add a denied pattern manually
  ipcMain.handle('permissions:addDeniedPattern', async (_event, workspacePath: string, pattern: string, displayName: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!pattern) {
      throw new Error('pattern is required');
    }

    try {
      permissionService.addDeniedPattern(workspacePath, pattern, displayName || pattern);
      logger.main.info('[PermissionHandlers] Denied pattern added:', pattern);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to add denied pattern:', error);
      throw error;
    }
  });

  // Set permission mode
  ipcMain.handle('permissions:setPermissionMode', async (_event, workspacePath: string, mode: 'ask' | 'allow-all') => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (mode !== 'ask' && mode !== 'allow-all') {
      throw new Error('mode must be "ask" or "allow-all"');
    }

    try {
      permissionService.setPermissionMode(workspacePath, mode);
      logger.main.info('[PermissionHandlers] Permission mode set:', mode);
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to set permission mode:', error);
      throw error;
    }
  });

  // Add an additional directory
  ipcMain.handle('permissions:addAdditionalDirectory', async (_event, workspacePath: string, dirPath: string, canWrite: boolean) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!dirPath) {
      throw new Error('dirPath is required');
    }

    try {
      permissionService.addAdditionalDirectory(workspacePath, dirPath, canWrite);
      logger.main.info('[PermissionHandlers] Additional directory added:', dirPath, 'canWrite:', canWrite);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to add additional directory:', error);
      throw error;
    }
  });

  // Remove an additional directory
  ipcMain.handle('permissions:removeAdditionalDirectory', async (_event, workspacePath: string, dirPath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!dirPath) {
      throw new Error('dirPath is required');
    }

    try {
      permissionService.removeAdditionalDirectory(workspacePath, dirPath);
      logger.main.info('[PermissionHandlers] Additional directory removed:', dirPath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to remove additional directory:', error);
      throw error;
    }
  });

  // Update an additional directory's write access
  ipcMain.handle('permissions:updateAdditionalDirectoryAccess', async (_event, workspacePath: string, dirPath: string, canWrite: boolean) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!dirPath) {
      throw new Error('dirPath is required');
    }

    try {
      permissionService.updateAdditionalDirectoryWriteAccess(workspacePath, dirPath, canWrite);
      logger.main.info('[PermissionHandlers] Additional directory access updated:', dirPath, 'canWrite:', canWrite);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to update additional directory access:', error);
      throw error;
    }
  });

  // Get allowed URL patterns
  ipcMain.handle('permissions:getAllowedUrlPatterns', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      return permissionService.getAllowedUrlPatterns(workspacePath);
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to get allowed URL patterns:', error);
      throw error;
    }
  });

  // Add an allowed URL pattern
  ipcMain.handle('permissions:addAllowedUrlPattern', async (_event, workspacePath: string, pattern: string, description: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!pattern) {
      throw new Error('pattern is required');
    }

    try {
      permissionService.addAllowedUrlPattern(workspacePath, pattern, description || '');
      logger.main.info('[PermissionHandlers] Allowed URL pattern added:', pattern);
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to add allowed URL pattern:', error);
      throw error;
    }
  });

  // Remove an allowed URL pattern
  ipcMain.handle('permissions:removeAllowedUrlPattern', async (_event, workspacePath: string, pattern: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!pattern) {
      throw new Error('pattern is required');
    }

    try {
      permissionService.removeAllowedUrlPattern(workspacePath, pattern);
      logger.main.info('[PermissionHandlers] Allowed URL pattern removed:', pattern);
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to remove allowed URL pattern:', error);
      throw error;
    }
  });

  // Check if all URLs are allowed (wildcard pattern)
  ipcMain.handle('permissions:isAllUrlsAllowed', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      return permissionService.isAllUrlsAllowed(workspacePath);
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to check all URLs allowed:', error);
      throw error;
    }
  });

  // Allow all URLs (add wildcard pattern)
  ipcMain.handle('permissions:allowAllUrls', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      permissionService.allowAllUrls(workspacePath);
      logger.main.info('[PermissionHandlers] All URLs allowed for workspace');
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to allow all URLs:', error);
      throw error;
    }
  });

  // Revoke "allow all URLs" permission
  ipcMain.handle('permissions:revokeAllUrlsPermission', async (_event, workspacePath: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      permissionService.revokeAllUrlsPermission(workspacePath);
      logger.main.info('[PermissionHandlers] All URLs permission revoked');
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to revoke all URLs permission:', error);
      throw error;
    }
  });

  // Evaluate a tool command and return the permission decision (for testing)
  ipcMain.handle('permissions:evaluateCommand', async (_event, workspacePath: string, sessionId: string, toolName: string, toolDescription: string) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!toolName) {
      throw new Error('toolName is required');
    }

    try {
      const result = await permissionService.evaluateCommand(workspacePath, sessionId, toolName, toolDescription);
      logger.main.info('[PermissionHandlers] Command evaluated:', { toolName, decision: result.decision });
      return result;
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to evaluate command:', error);
      throw error;
    }
  });

  // Apply a permission response (for testing)
  ipcMain.handle('permissions:applyResponse', async (_event, workspacePath: string, sessionId: string, requestId: string, response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' }) => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }
    if (!requestId) {
      throw new Error('requestId is required');
    }

    try {
      permissionService.applyPermissionResponse(workspacePath, sessionId, requestId, response);
      logger.main.info('[PermissionHandlers] Permission response applied:', { requestId, decision: response.decision, scope: response.scope });
      broadcastPermissionChange(workspacePath);
      return { success: true };
    } catch (error) {
      logger.main.error('[PermissionHandlers] Failed to apply permission response:', error);
      throw error;
    }
  });

  logger.main.info('[PermissionHandlers] Permission handlers registered');
}
