/**
 * Permission Service for Agent Tool Calls
 *
 * Manages workspace trust for AI agents. Pattern storage is now handled by
 * Claude Code's native settings files (.claude/settings.local.json).
 *
 * WORKTREE SUPPORT: When a workspace is a git worktree, permissions are looked up
 * using the parent project path. This ensures worktrees inherit trust from their
 * parent project. Use resolveWorkspacePathForPermissions() to resolve paths.
 */

import {
  getAgentPermissions,
  saveAgentPermissions,
} from '../utils/store';
import { logger } from '../utils/logger';
import { getDatabase } from '../database/initialize';
import { createWorktreeStore } from './WorktreeStore';
import { resolveProjectPath } from '../utils/workspaceDetection';

type PermissionMode = 'ask' | 'allow-all' | 'bypass-all';

/**
 * Resolve a workspace path for permission lookups.
 * If the path is a worktree, returns the parent project path.
 * Otherwise returns the original path.
 *
 * This ensures worktrees share permissions with their parent project.
 *
 * @throws Error if database is not initialized
 * @returns The parent project path for worktrees, or the original path for regular workspaces
 */
export async function resolveWorkspacePathForPermissions(workspacePath: string): Promise<string> {
  const db = getDatabase();
  if (!db) {
    throw new Error('Database not initialized - cannot resolve worktree path for permissions');
  }

  const worktreeStore = createWorktreeStore(db);
  const worktree = await worktreeStore.getByPath(workspacePath);

  if (worktree) {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    logger.main.info(`[PermissionService:${workspaceName}] Resolved worktree to parent project: ${worktree.projectPath}`);
    return worktree.projectPath;
  }

  // Not a worktree, return original path
  return workspacePath;
}

/**
 * Check if a test permission mode is set via environment variable.
 * This is used by E2E tests to bypass the project trust toast.
 */
function getTestPermissionMode(): PermissionMode | null {
  const envMode = process.env.NIMBALYST_PERMISSION_MODE;
  if (envMode === 'ask' || envMode === 'allow-all' || envMode === 'bypass-all') {
    return envMode;
  }
  return null;
}

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
    // Resolve worktree paths to parent project so trust is shared
    const projectPath = resolveProjectPath(workspacePath);
    const workspaceName = projectPath.split('/').pop() || projectPath;
    logger.main.info(`[PermissionService:${workspaceName}] Trusting workspace with mode: ${mode}`);

    const stored = getAgentPermissions(projectPath) || { permissionMode: null };
    stored.permissionMode = mode;
    saveAgentPermissions(projectPath, stored);
  }

  /**
   * Revoke workspace trust
   */
  public revokeWorkspaceTrust(workspacePath: string): void {
    // Resolve worktree paths to parent project so trust is shared
    const projectPath = resolveProjectPath(workspacePath);
    const workspaceName = projectPath.split('/').pop() || projectPath;
    logger.main.info(`[PermissionService:${workspaceName}] Revoking workspace trust`);

    const stored = getAgentPermissions(projectPath) || { permissionMode: null };
    stored.permissionMode = null;
    saveAgentPermissions(projectPath, stored);
  }

  /**
   * Check if a workspace is trusted
   */
  public isWorkspaceTrusted(workspacePath: string): boolean {
    // Resolve worktree paths to parent project so trust is shared
    const projectPath = resolveProjectPath(workspacePath);
    const stored = getAgentPermissions(projectPath);
    return stored?.permissionMode !== null && stored?.permissionMode !== undefined;
  }

  /**
   * Get the permission mode (null if untrusted)
   * If NIMBALYST_PERMISSION_MODE env var is set, always returns that mode (for E2E tests)
   */
  public getPermissionMode(workspacePath: string): PermissionMode | null {
    // E2E test override - always return the test mode if set
    const testMode = getTestPermissionMode();
    if (testMode) {
      return testMode;
    }

    // Resolve worktree paths to parent project so trust is shared
    const projectPath = resolveProjectPath(workspacePath);
    const stored = getAgentPermissions(projectPath);
    return stored?.permissionMode ?? null;
  }

  /**
   * Set the permission mode (setting to null revokes trust)
   */
  public setPermissionMode(workspacePath: string, mode: PermissionMode | null): void {
    // Resolve worktree paths to parent project so trust is shared
    const projectPath = resolveProjectPath(workspacePath);
    const workspaceName = projectPath.split('/').pop() || projectPath;
    logger.main.info(`[PermissionService:${workspaceName}] Setting permission mode: ${mode}`);

    const stored = getAgentPermissions(projectPath) || { permissionMode: null };
    stored.permissionMode = mode;
    saveAgentPermissions(projectPath, stored);
  }
}

// Export singleton instance getter
export function getPermissionService(): PermissionService {
  return PermissionService.getInstance();
}
