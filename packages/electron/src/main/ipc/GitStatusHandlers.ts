import { ipcMain } from 'electron';
import { GitStatusService } from '../services/GitStatusService';

const gitStatusService = new GitStatusService();

export function registerGitStatusHandlers(): void {
  /**
   * Get git status for a list of files
   *
   * @param workspacePath The workspace/repository path
   * @param filePaths Array of file paths to check
   * @returns Git status for each file
   */
  ipcMain.handle('git:get-file-status', async (_event, workspacePath: string, filePaths: string[]) => {
    try {
      const status = await gitStatusService.getFileStatus(workspacePath, filePaths);
      return { success: true, status };
    } catch (error) {
      console.error('[GitStatusHandlers] Failed to get file status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get file status'
      };
    }
  });

  /**
   * Get all uncommitted files in the workspace
   * Returns files that are untracked or modified (not committed)
   *
   * @param workspacePath The workspace/repository path
   * @returns Array of file paths with uncommitted changes
   */
  ipcMain.handle('git:get-uncommitted-files', async (_event, workspacePath: string) => {
    try {
      const files = await gitStatusService.getUncommittedFiles(workspacePath);
      return { success: true, files };
    } catch (error) {
      console.error('[GitStatusHandlers] Failed to get uncommitted files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get uncommitted files',
        files: []
      };
    }
  });

  /**
   * Check if a workspace is a git repository
   *
   * @param workspacePath The workspace path to check
   * @returns Boolean indicating if workspace is a git repository
   */
  ipcMain.handle('git:is-repo', async (_event, workspacePath: string) => {
    try {
      const isRepo = await gitStatusService.isGitRepo(workspacePath);
      return { success: true, isRepo };
    } catch (error) {
      console.error('[GitStatusHandlers] Failed to check if git repo:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check if git repo',
        isRepo: false
      };
    }
  });

  /**
   * Check if a workspace is a git worktree
   *
   * @param workspacePath The workspace path to check
   * @returns Boolean indicating if workspace is a git worktree
   */
  ipcMain.handle('git:is-worktree', async (_event, workspacePath: string) => {
    try {
      const isWorktree = await gitStatusService.isGitWorktree(workspacePath);
      return { success: true, isWorktree };
    } catch (error) {
      console.error('[GitStatusHandlers] Failed to check if git worktree:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check if git worktree',
        isWorktree: false
      };
    }
  });

  /**
   * Get all files modified in the worktree relative to the main repository branch
   * Returns files that differ between the worktree branch and the main repo branch
   *
   * @param workspacePath The worktree path
   * @returns Array of file paths with modifications
   */
  ipcMain.handle('git:get-worktree-modified-files', async (_event, workspacePath: string) => {
    try {
      const files = await gitStatusService.getWorktreeModifiedFiles(workspacePath);
      return { success: true, files };
    } catch (error) {
      console.error('[GitStatusHandlers] Failed to get worktree modified files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get worktree modified files',
        files: []
      };
    }
  });

  /**
   * Clear the git status cache for a workspace
   *
   * @param workspacePath Optional workspace path (clears all if not specified)
   */
  ipcMain.handle('git:clear-status-cache', async (_event, workspacePath?: string) => {
    try {
      gitStatusService.clearCache(workspacePath);
      return { success: true };
    } catch (error) {
      console.error('[GitStatusHandlers] Failed to clear cache:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear cache'
      };
    }
  });
}

/**
 * Clear cache for a specific workspace (utility function)
 * Called by other parts of the system when git operations occur
 */
export function clearGitStatusCache(workspacePath?: string): void {
  gitStatusService.clearCache(workspacePath);
}
