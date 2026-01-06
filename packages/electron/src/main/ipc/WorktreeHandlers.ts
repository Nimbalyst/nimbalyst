/**
 * WorktreeHandlers - IPC handlers for git worktree operations
 *
 * Provides handlers for creating, querying, and deleting git worktrees.
 * Worktrees are stored in the database and managed via GitWorktreeService.
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import { GitWorktreeService } from '../services/GitWorktreeService';
import { WorktreeStore, createWorktreeStore } from '../services/WorktreeStore';
import { getDatabase } from '../database/initialize';

const logger = log.scope('WorktreeHandlers');

/**
 * Register worktree IPC handlers
 */
export function registerWorktreeHandlers(): void {
  const gitWorktreeService = new GitWorktreeService();

  /**
   * Create a new git worktree and store its metadata
   *
   * @param workspacePath - Path to the main git repository
   * @param name - Optional custom name for the worktree
   * @returns Worktree data including id, path, branch, etc.
   */
  ipcMain.handle('worktree:create', async (_event, workspacePath: string, name?: string) => {
    try {
      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }

      logger.info('Creating worktree', { workspacePath, name });

      // Create the git worktree
      const worktree = await gitWorktreeService.createWorktree(workspacePath, { name });

      // Store worktree metadata in database
      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const worktreeStore = createWorktreeStore(db);
      await worktreeStore.create(worktree);

      logger.info('Worktree created successfully', { id: worktree.id, path: worktree.path });

      return {
        success: true,
        worktree,
      };
    } catch (error) {
      logger.error('Failed to create worktree:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create worktree',
      };
    }
  });

  /**
   * Get git status for a worktree
   *
   * @param worktreePath - Path to the worktree directory
   * @returns Git status including uncommitted changes, commits ahead/behind, merge status
   */
  ipcMain.handle('worktree:get-status', async (_event, worktreePath: string) => {
    try {
      if (!worktreePath) {
        throw new Error('worktreePath is required');
      }

      logger.info('Getting worktree status', { worktreePath });

      const status = await gitWorktreeService.getWorktreeStatus(worktreePath);

      return {
        success: true,
        status,
      };
    } catch (error) {
      logger.error('Failed to get worktree status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get worktree status',
      };
    }
  });

  /**
   * Delete a git worktree and its database record
   *
   * @param worktreeId - ID of the worktree to delete
   * @param workspacePath - Path to the main git repository
   * @returns Success status
   */
  ipcMain.handle('worktree:delete', async (_event, worktreeId: string, workspacePath: string) => {
    try {
      if (!worktreeId) {
        throw new Error('worktreeId is required');
      }

      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }

      logger.info('Deleting worktree', { worktreeId, workspacePath });

      // Get worktree from database to find its path
      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const worktreeStore = createWorktreeStore(db);
      const worktree = await worktreeStore.get(worktreeId);

      if (!worktree) {
        throw new Error(`Worktree not found: ${worktreeId}`);
      }

      // Delete the git worktree
      await gitWorktreeService.deleteWorktree(worktree.path, workspacePath);

      // Delete the database record
      await worktreeStore.delete(worktreeId);

      logger.info('Worktree deleted successfully', { worktreeId });

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Failed to delete worktree:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete worktree',
      };
    }
  });

  /**
   * List all worktrees for a workspace
   *
   * @param workspacePath - Path to the workspace/project
   * @returns Array of worktrees
   */
  ipcMain.handle('worktree:list', async (_event, workspacePath: string) => {
    try {
      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }

      logger.info('Listing worktrees', { workspacePath });

      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const worktreeStore = createWorktreeStore(db);
      const worktrees = await worktreeStore.list(workspacePath);

      logger.info('Found worktrees', { count: worktrees.length });

      return {
        success: true,
        worktrees,
      };
    } catch (error) {
      logger.error('Failed to list worktrees:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list worktrees',
        worktrees: [],
      };
    }
  });

  /**
   * Get a single worktree by ID
   *
   * @param worktreeId - ID of the worktree
   * @returns Worktree data or null if not found
   */
  ipcMain.handle('worktree:get', async (_event, worktreeId: string) => {
    try {
      if (!worktreeId) {
        throw new Error('worktreeId is required');
      }

      logger.info('Getting worktree', { worktreeId });

      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const worktreeStore = createWorktreeStore(db);
      const worktree = await worktreeStore.get(worktreeId);

      if (!worktree) {
        logger.info('Worktree not found', { worktreeId });
        return {
          success: true,
          worktree: null,
        };
      }

      return {
        success: true,
        worktree,
      };
    } catch (error) {
      logger.error('Failed to get worktree:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get worktree',
        worktree: null,
      };
    }
  });

  /**
   * Batch fetch worktrees with their git status
   * Efficiently fetches multiple worktrees and their status in a single IPC call
   *
   * @param worktreeIds - Array of worktree IDs to fetch
   * @returns Map of worktree ID to worktree data with status
   */
  ipcMain.handle('worktree:get-batch', async (_event, worktreeIds: string[]) => {
    try {
      if (!worktreeIds || !Array.isArray(worktreeIds)) {
        throw new Error('worktreeIds must be an array');
      }

      if (worktreeIds.length === 0) {
        return {
          success: true,
          worktrees: {},
        };
      }

      logger.info('Batch fetching worktrees', { count: worktreeIds.length, ids: worktreeIds });

      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const worktreeStore = createWorktreeStore(db);
      const results: Record<string, {
        id: string;
        name: string;
        displayName?: string;
        path: string;
        branch: string;
        baseBranch: string;
        projectPath: string;
        createdAt: number;
        updatedAt?: number;
        isPinned?: boolean;
        gitStatus?: {
          ahead?: number;
          behind?: number;
          uncommitted?: boolean;
        };
      }> = {};

      // Fetch all worktrees and their statuses in parallel
      await Promise.all(
        worktreeIds.map(async (worktreeId) => {
          try {
            // Fetch worktree metadata
            const worktree = await worktreeStore.get(worktreeId);
            if (!worktree) {
              logger.warn('Worktree not found in batch fetch', { worktreeId });
              return;
            }

            // Fetch git status
            let gitStatus: { ahead?: number; behind?: number; uncommitted?: boolean } | undefined;
            try {
              const statusResult = await gitWorktreeService.getWorktreeStatus(worktree.path);
              gitStatus = {
                ahead: statusResult.commitsAhead,
                behind: statusResult.commitsBehind,
                uncommitted: statusResult.hasUncommittedChanges,
              };
            } catch (err) {
              logger.warn('Failed to get git status in batch fetch', { worktreeId, error: err });
              // Continue without git status - it's not critical
            }

            results[worktreeId] = {
              ...worktree,
              gitStatus,
            };
          } catch (err) {
            logger.error('Failed to fetch worktree in batch', { worktreeId, error: err });
            // Continue with other worktrees
          }
        })
      );

      logger.info('Batch fetch completed', { requested: worktreeIds.length, fetched: Object.keys(results).length });

      return {
        success: true,
        worktrees: results,
      };
    } catch (error) {
      logger.error('Failed to batch fetch worktrees:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to batch fetch worktrees',
        worktrees: {},
      };
    }
  });

  /**
   * Update worktree pinned status
   *
   * @param worktreeId - ID of the worktree to update
   * @param isPinned - Whether the worktree should be pinned
   * @returns Success status
   */
  ipcMain.handle('worktree:update-pinned', async (_event, worktreeId: string, isPinned: boolean) => {
    try {
      if (!worktreeId) {
        throw new Error('worktreeId is required');
      }

      logger.info('Updating worktree pinned status', { worktreeId, isPinned });

      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const worktreeStore = createWorktreeStore(db);
      await worktreeStore.updatePinned(worktreeId, isPinned);

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Failed to update worktree pinned status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update worktree pinned status',
      };
    }
  });

  /**
   * Get all changed files in a worktree compared to base branch
   *
   * @param worktreePath - Path to the worktree
   * @returns Array of changed files with their status
   */
  ipcMain.handle('worktree:get-changed-files', async (_event, worktreePath: string) => {
    try {
      if (!worktreePath) {
        throw new Error('worktreePath is required');
      }

      logger.info('Getting changed files', { worktreePath });

      const changedFiles = await gitWorktreeService.getChangedFiles(worktreePath);

      return {
        success: true,
        files: changedFiles,
      };
    } catch (error) {
      logger.error('Failed to get changed files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get changed files',
        files: [],
      };
    }
  });

  /**
   * Get diff for a specific file in a worktree
   *
   * @param worktreePath - Path to the worktree
   * @param filePath - Relative path to the file
   * @returns File diff result
   */
  ipcMain.handle('worktree:get-file-diff', async (_event, worktreePath: string, filePath: string) => {
    try {
      if (!worktreePath) {
        throw new Error('worktreePath is required');
      }
      if (!filePath) {
        throw new Error('filePath is required');
      }

      logger.info('Getting file diff', { worktreePath, filePath });

      const diff = await gitWorktreeService.getFileDiff(worktreePath, filePath);

      return {
        success: true,
        diff,
      };
    } catch (error) {
      logger.error('Failed to get file diff:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get file diff',
      };
    }
  });

  /**
   * Get commits in a worktree branch
   *
   * @param worktreePath - Path to the worktree
   * @returns Array of commits
   */
  ipcMain.handle('worktree:get-commits', async (_event, worktreePath: string) => {
    try {
      if (!worktreePath) {
        throw new Error('worktreePath is required');
      }

      logger.info('Getting worktree commits', { worktreePath });

      const commits = await gitWorktreeService.getWorktreeCommits(worktreePath);

      // Convert Date objects to ISO strings for IPC serialization
      // Date objects don't survive Electron IPC correctly in arrays
      const serializedCommits = commits.map(commit => {
        const dateValue = commit.date instanceof Date && !isNaN(commit.date.getTime())
          ? commit.date.toISOString()
          : new Date().toISOString();
        return {
          ...commit,
          date: dateValue,
        };
      });

      return {
        success: true,
        commits: serializedCommits,
      };
    } catch (error) {
      logger.error('Failed to get worktree commits:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get worktree commits',
        commits: [],
      };
    }
  });

  /**
   * Commit changes in a worktree
   *
   * @param worktreePath - Path to the worktree
   * @param message - Commit message
   * @param files - Optional array of specific files to commit
   * @returns Commit information
   */
  ipcMain.handle('worktree:commit', async (_event, worktreePath: string, message: string, files?: string[]) => {
    try {
      if (!worktreePath) {
        throw new Error('worktreePath is required');
      }
      if (!message) {
        throw new Error('message is required');
      }

      logger.info('Committing changes', { worktreePath, message, fileCount: files?.length });

      const commit = await gitWorktreeService.commitChanges(worktreePath, message, files);

      // Convert Date object to ISO string for IPC serialization
      const dateValue = commit.date instanceof Date && !isNaN(commit.date.getTime())
        ? commit.date.toISOString()
        : new Date().toISOString();
      const serializedCommit = {
        ...commit,
        date: dateValue,
      };

      return {
        success: true,
        commit: serializedCommit,
      };
    } catch (error) {
      logger.error('Failed to commit changes:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to commit changes',
      };
    }
  });

  /**
   * Merge worktree branch to main
   *
   * @param worktreePath - Path to the worktree
   * @param mainRepoPath - Path to the main repository
   * @returns Merge result
   */
  ipcMain.handle('worktree:merge', async (_event, worktreePath: string, mainRepoPath: string) => {
    try {
      if (!worktreePath) {
        throw new Error('worktreePath is required');
      }
      if (!mainRepoPath) {
        throw new Error('mainRepoPath is required');
      }

      logger.info('Merging worktree to main', { worktreePath, mainRepoPath });

      const result = await gitWorktreeService.mergeToMain(worktreePath, mainRepoPath);

      return {
        success: result.success,
        message: result.message,
        conflictedFiles: result.conflictedFiles,
      };
    } catch (error) {
      logger.error('Failed to merge to main:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to merge to main',
      };
    }
  });

  logger.info('Worktree handlers registered');
}
