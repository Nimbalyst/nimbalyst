/**
 * Permission Service for Agent Tool Calls
 *
 * Manages workspace trust for AI agents. Pattern storage is now handled by
 * Claude Code's native settings files (.claude/settings.local.json).
 */

import {
  getAgentPermissions,
  saveAgentPermissions,
} from '../utils/store';
import { logger } from '../utils/logger';

type PermissionMode = 'ask' | 'allow-all';

/**
 * Permission Service singleton
 *
 * Only handles workspace trust management. Pattern evaluation and storage
 * is now handled by the Claude Agent SDK and ClaudeSettingsManager.
 */
export class PermissionService {
  private static instance: PermissionService;

  private constructor() {}

  public static getInstance(): PermissionService {
    if (!PermissionService.instance) {
      PermissionService.instance = new PermissionService();
    }
    return PermissionService.instance;
  }

  /**
   * Trust a workspace (enable agent operations)
   * @param mode - The permission mode to set (defaults to 'ask')
   */
  public trustWorkspace(workspacePath: string, mode: PermissionMode = 'ask'): void {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    logger.main.info(`[PermissionService:${workspaceName}] Trusting workspace with mode: ${mode}`);

    const stored = getAgentPermissions(workspacePath) || { permissionMode: null };
    stored.permissionMode = mode;
    saveAgentPermissions(workspacePath, stored);
  }

  /**
   * Revoke workspace trust
   */
  public revokeWorkspaceTrust(workspacePath: string): void {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    logger.main.info(`[PermissionService:${workspaceName}] Revoking workspace trust`);

    const stored = getAgentPermissions(workspacePath) || { permissionMode: null };
    stored.permissionMode = null;
    saveAgentPermissions(workspacePath, stored);
  }

  /**
   * Check if a workspace is trusted
   */
  public isWorkspaceTrusted(workspacePath: string): boolean {
    const stored = getAgentPermissions(workspacePath);
    return stored?.permissionMode !== null && stored?.permissionMode !== undefined;
  }

  /**
   * Get the permission mode (null if untrusted)
   */
  public getPermissionMode(workspacePath: string): PermissionMode | null {
    const stored = getAgentPermissions(workspacePath);
    return stored?.permissionMode ?? null;
  }

  /**
   * Set the permission mode (setting to null revokes trust)
   */
  public setPermissionMode(workspacePath: string, mode: PermissionMode | null): void {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    logger.main.info(`[PermissionService:${workspaceName}] Setting permission mode: ${mode}`);

    const stored = getAgentPermissions(workspacePath) || { permissionMode: null };
    stored.permissionMode = mode;
    saveAgentPermissions(workspacePath, stored);
  }
}

// Export singleton instance getter
export function getPermissionService(): PermissionService {
  return PermissionService.getInstance();
}
