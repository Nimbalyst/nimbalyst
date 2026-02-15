/**
 * Git IPC Handlers
 *
 * Handles git operations from the renderer process.
 */

import { ipcMain } from 'electron';
import simpleGit, { SimpleGit } from 'simple-git';
import log from 'electron-log/main';
import { existsSync } from 'fs';
import { join, relative, isAbsolute } from 'path';
import { gitOperationLock } from '../services/GitOperationLock';

function isGitRepository(workspacePath: string): boolean {
  try {
    return existsSync(join(workspacePath, '.git'));
  } catch {
    return false;
  }
}

/**
 * Check if the repository has any commits (HEAD exists).
 * In a fresh repo, HEAD doesn't exist and commands like `git reset HEAD` or `git diff HEAD` will fail.
 */
async function hasCommits(git: SimpleGit): Promise<boolean> {
  try {
    await git.revparse(['HEAD']);
    return true;
  } catch {
    return false;
  }
}

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

    if (!isGitRepository(workspacePath)) {
      return { branch: '', ahead: 0, behind: 0, hasUncommitted: false };
    }

    // Use lock to prevent racing with git:commit and other write operations.
    // simple-git's git.status() refreshes the index (creates index.lock),
    // which races with concurrent git add/commit/reset operations.
    return gitOperationLock.withLock(workspacePath, 'git:status', async () => {
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

      if (!isGitRepository(workspacePath)) {
        return [];
      }

      try {
        const git: SimpleGit = simpleGit(workspacePath);

        if (!(await hasCommits(git))) {
          return [];
        }

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

      if (!isGitRepository(workspacePath)) {
        return '';
      }

      try {
        const git: SimpleGit = simpleGit(workspacePath);

        // In a fresh repo with no commits, diff against an empty tree instead of HEAD
        if (!(await hasCommits(git))) {
          const diff = await git.diff(['--cached', '--', filePath]);
          return diff;
        }

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
    ): Promise<{ success: boolean; commitHash?: string; commitDate?: string; error?: string }> => {
      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }
      if (!message) {
        throw new Error('message is required');
      }

      if (!isGitRepository(workspacePath)) {
        return { success: false, error: 'Not a git repository' };
      }

      // Use centralized lock to prevent concurrent commit/staging operations
      return gitOperationLock.withLock(workspacePath, 'git:commit', async () => {
        try {
          const git: SimpleGit = simpleGit(workspacePath);
          const repoHasCommits = await hasCommits(git);
          log.info(`[git:commit] Starting commit in ${workspacePath} with ${filesToStage?.length || 0} files (hasCommits: ${repoHasCommits})`);

          // Convert a file path (possibly absolute) to a git-relative path with forward slashes.
          // git.status() returns relative paths with forward slashes, but filesToStage
          // may contain absolute paths (from renderer). On Windows, path.relative()
          // returns backslashes, so normalize to forward slashes.
          const toGitPath = (f: string) => {
            const rel = isAbsolute(f) ? relative(workspacePath, f) : f;
            return rel.replace(/\\/g, '/');
          };

          // Track originally staged files so we can restore them after commit
          const initialStatus = await git.status();
          const originallyStaged = new Set([...initialStatus.staged, ...initialStatus.created]);
          log.info(`[git:commit] Originally staged files: ${originallyStaged.size}`);

          // Stage files
          if (filesToStage && filesToStage.length > 0) {
            // First, unstage all files to ensure we only commit what the user selected
            // This prevents previously-staged files from being included in the commit
            log.info(`[git:commit] Resetting staging area before staging selected files`);
            if (repoHasCommits) {
              await git.reset(['HEAD']);
            } else {
              // In a fresh repo with no commits, HEAD doesn't exist.
              // Use `git rm --cached` to unstage files instead.
              if (originallyStaged.size > 0) {
                await git.raw(['rm', '--cached', '-r', '.']);
              }
            }

            const filesToStageRelative = filesToStage.map(toGitPath);
            log.info(`[git:commit] Staging files (raw): ${filesToStage.join(', ')}`);
            log.info(`[git:commit] Staging files (git-relative): ${filesToStageRelative.join(', ')}`);

            // Check which files actually exist on disk before staging
            const fileExistence = filesToStage.map((f) => {
              const absPath = isAbsolute(f) ? f : join(workspacePath, f);
              return { path: f, exists: existsSync(absPath) };
            });
            const missingOnDisk = fileExistence.filter((f) => !f.exists);
            if (missingOnDisk.length > 0) {
              log.warn(`[git:commit] Files missing on disk: ${missingOnDisk.map((f) => f.path).join(', ')}`);
            }

            await git.add(filesToStage);

            // Verify only the selected files are staged
            const status = await git.status();
            const stagedFiles = new Set([...status.staged, ...status.created]);
            log.info(`[git:commit] After staging - staged files: [${[...status.staged].join(', ')}], created files: [${[...status.created].join(', ')}]`);
            log.info(`[git:commit] Full status - modified: [${status.modified.join(', ')}], not_added: [${status.not_added.join(', ')}], deleted: [${status.deleted.join(', ')}], renamed: [${status.renamed.map((r) => `${r.from}->${r.to}`).join(', ')}], conflicted: [${status.conflicted.join(', ')}]`);

            if (stagedFiles.size === 0) {
              log.warn(`[git:commit] No files were staged despite add() succeeding. Requested: [${filesToStage.join(', ')}], git-relative: [${filesToStageRelative.join(', ')}]`);
              // Restore originally staged files before returning
              if (originallyStaged.size > 0) {
                await git.add(Array.from(originallyStaged));
              }
              return {
                success: false,
                error: 'No files were staged. The files may not exist or have no changes.',
              };
            }

            const filesToStageRelSet = new Set(filesToStageRelative);
            const unexpectedFiles = Array.from(stagedFiles).filter(f => !filesToStageRelSet.has(f));
            const missingFiles = filesToStageRelative.filter(f => !stagedFiles.has(f));

            if (unexpectedFiles.length > 0) {
              log.error(`[git:commit] Unexpected files staged: ${unexpectedFiles.join(', ')}`);
              // Restore original state and abort
              if (repoHasCommits) {
                await git.reset(['HEAD']);
              } else {
                await git.raw(['rm', '--cached', '-r', '.']);
              }
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
          const committedFilesSet = new Set((filesToStage || []).map(toGitPath));
          const filesToRestage = Array.from(originallyStaged).filter(f => !committedFilesSet.has(f));
          if (filesToRestage.length > 0) {
            log.info(`[git:commit] Restoring ${filesToRestage.length} originally staged files`);
            await git.add(filesToRestage);
          }

          log.info(`[git:commit] Successfully committed: ${result.commit}`);

          // Get the actual commit date from git
          let commitDate: string | undefined;
          try {
            const showResult = await git.show([result.commit, '--no-patch', '--format=%aI']);
            commitDate = showResult.trim();
          } catch {
            // Non-critical - fall through without date
          }

          return {
            success: true,
            commitHash: result.commit,
            commitDate,
          };
        } catch (error) {
          log.error('[git:commit] Failed to commit:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    }
  );

  log.info('Git IPC handlers registered');
}
