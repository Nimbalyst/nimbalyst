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

  logger.info('Worktree handlers registered');
}
