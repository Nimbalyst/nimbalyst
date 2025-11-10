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
