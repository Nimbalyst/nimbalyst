/**
 * Git IPC Handlers
 *
 * Handles git operations from the renderer process.
 */

import { ipcMain } from 'electron';
import simpleGit, { SimpleGit } from 'simple-git';
import log from 'electron-log/main';

interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  hasUncommitted: boolean;
  baseBranch?: string;
  isMerged?: boolean;
}

interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Register all git-related IPC handlers
 */
export function registerGitHandlers(): void {
  /**
   * Get git status for a workspace or worktree
   */
  ipcMain.handle('git:status', async (_event, workspacePath: string): Promise<GitStatusResult> => {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    try {
      const git: SimpleGit = simpleGit(workspacePath);
      const status = await git.status();
      const branch = status.current || 'HEAD';

      return {
        branch,
        ahead: status.ahead || 0,
        behind: status.behind || 0,
        hasUncommitted: !status.isClean(),
      };
    } catch (error) {
      log.error('Failed to get git status:', error);
      throw error;
    }
  });

  /**
   * Get recent commits
   */
  ipcMain.handle(
    'git:log',
    async (_event, workspacePath: string, limit: number = 10): Promise<GitCommit[]> => {
      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }

      try {
        const git: SimpleGit = simpleGit(workspacePath);
        const gitLog = await git.log({ maxCount: Math.min(limit, 50) });

        return gitLog.all.map((commit) => ({
          hash: commit.hash,
          message: commit.message,
          author: commit.author_name,
          date: commit.date,
        }));
      } catch (error) {
        log.error('Failed to get git log:', error);
        throw error;
      }
    }
  );

  /**
   * Get file diff
   */
  ipcMain.handle(
    'git:diff',
    async (_event, workspacePath: string, filePath: string): Promise<string> => {
      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }
      if (!filePath) {
        throw new Error('filePath is required');
      }

      try {
        const git: SimpleGit = simpleGit(workspacePath);
        const diff = await git.diff(['HEAD', '--', filePath]);
        return diff;
      } catch (error) {
        log.error('Failed to get file diff:', error);
        throw error;
      }
    }
  );

  /**
   * Execute git commit
   */
  ipcMain.handle(
    'git:commit',
    async (
      _event,
      workspacePath: string,
      message: string,
      filesToStage: string[]
    ): Promise<{ success: boolean; commitHash?: string; error?: string }> => {
      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }
      if (!message) {
        throw new Error('message is required');
      }

      try {
        const git: SimpleGit = simpleGit(workspacePath);

        // Stage files
        if (filesToStage && filesToStage.length > 0) {
          await git.add(filesToStage);
        }

        // Commit
        const result = await git.commit(message);

        return {
          success: true,
          commitHash: result.commit,
        };
      } catch (error) {
        log.error('Failed to commit:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  log.info('Git IPC handlers registered');
}
