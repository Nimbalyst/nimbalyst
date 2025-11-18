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
