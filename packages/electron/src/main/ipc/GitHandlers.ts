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
        log.info(`[git:commit] Starting commit in ${workspacePath} with ${filesToStage?.length || 0} files`);

        // Track originally staged files so we can restore them after commit
        const initialStatus = await git.status();
        const originallyStaged = new Set([...initialStatus.staged, ...initialStatus.created]);
        log.info(`[git:commit] Originally staged files: ${originallyStaged.size}`);

        // Stage files
        if (filesToStage && filesToStage.length > 0) {
          // First, unstage all files to ensure we only commit what the user selected
          // This prevents previously-staged files from being included in the commit
          log.info(`[git:commit] Resetting staging area before staging selected files`);
          await git.reset(['HEAD']);

          log.info(`[git:commit] Staging files: ${filesToStage.join(', ')}`);
          await git.add(filesToStage);

          // Verify only the selected files are staged
          const status = await git.status();
          const stagedFiles = new Set([...status.staged, ...status.created]);
          log.info(`[git:commit] After staging - staged: ${stagedFiles.size}, created: ${status.created.length}`);

          if (stagedFiles.size === 0) {
            log.warn(`[git:commit] No files were staged despite add() succeeding`);
            // Restore originally staged files before returning
            if (originallyStaged.size > 0) {
              await git.add(Array.from(originallyStaged));
            }
            return {
              success: false,
              error: 'No files were staged. The files may not exist or have no changes.',
            };
          }

          // Verify staged files match selected files exactly
          const filesToStageSet = new Set(filesToStage);
          const unexpectedFiles = Array.from(stagedFiles).filter(f => !filesToStageSet.has(f));
          const missingFiles = filesToStage.filter(f => !stagedFiles.has(f));

          if (unexpectedFiles.length > 0) {
            log.error(`[git:commit] Unexpected files staged: ${unexpectedFiles.join(', ')}`);
            // Restore original state and abort
            await git.reset(['HEAD']);
            if (originallyStaged.size > 0) {
              await git.add(Array.from(originallyStaged));
            }
            return {
              success: false,
              error: `Unexpected files were staged: ${unexpectedFiles.join(', ')}. Commit aborted.`,
            };
          }

          if (missingFiles.length > 0) {
            log.warn(`[git:commit] Some selected files were not staged: ${missingFiles.join(', ')}`);
          }
        }

        // Commit
        const result = await git.commit(message);
        log.info(`[git:commit] Commit result: hash=${result.commit || 'empty'}, changes=${result.summary?.changes || 0}`);

        // simple-git returns empty commit hash if nothing was committed
        if (!result.commit) {
          log.warn(`[git:commit] Commit returned empty hash - nothing was committed`);
          // Restore originally staged files before returning
          if (originallyStaged.size > 0) {
            await git.add(Array.from(originallyStaged));
          }
          return {
            success: false,
            error: 'No changes were committed. Files may not have been staged correctly.',
          };
        }

        // Restore originally staged files that weren't part of this commit
        const committedFilesSet = new Set(filesToStage || []);
        const filesToRestage = Array.from(originallyStaged).filter(f => !committedFilesSet.has(f));
        if (filesToRestage.length > 0) {
          log.info(`[git:commit] Restoring ${filesToRestage.length} originally staged files`);
          await git.add(filesToRestage);
        }

        log.info(`[git:commit] Successfully committed: ${result.commit}`);
        return {
          success: true,
          commitHash: result.commit,
        };
      } catch (error) {
        log.error('[git:commit] Failed to commit:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  log.info('Git IPC handlers registered');
}
