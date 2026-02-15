/**
 * RalphLoopHandlers - IPC handlers for Ralph Loop operations
 *
 * Provides handlers for creating, starting, pausing, stopping, and querying Ralph Loops.
 * Ralph Loops automatically create their own worktree when created.
 */

import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { getRalphLoopService } from '../services/RalphLoopService';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import type { RalphLoopConfig } from '../../shared/types/ralph';
import { GitWorktreeService } from '../services/GitWorktreeService';
import { createWorktreeStore } from '../services/WorktreeStore';
import { getDatabase } from '../database/initialize';

const logger = log.scope('RalphLoopHandlers');

let handlersRegistered = false;

/**
 * Register Ralph Loop IPC handlers
 */
export function registerRalphLoopHandlers(): void {
  if (handlersRegistered) {
    logger.info('Ralph loop handlers already registered');
    return;
  }

  const ralphService = getRalphLoopService();

  /**
   * Create a new Ralph Loop
   *
   * Automatically creates a dedicated worktree for the Ralph Loop.
   *
   * @param workspacePath - Path to the main git repository
   * @param taskDescription - Description of the task for the loop
   * @param config - Optional configuration (maxIterations, etc.)
   */
  safeHandle('ralph:create', async (
    _event,
    workspacePath: string,
    taskDescription: string,
    config?: RalphLoopConfig
  ) => {
    try {
      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }
      if (!taskDescription || taskDescription.trim().length === 0) {
        throw new Error('taskDescription is required');
      }

      logger.info('Creating ralph loop with auto-worktree', {
        workspacePath,
        taskDescriptionLength: taskDescription.length,
      });

      // Step 1: Create a dedicated worktree for this Ralph Loop
      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const gitWorktreeService = new GitWorktreeService();
      const worktreeStore = createWorktreeStore(db);

      // Gather existing names for deduplication
      const [dbNames, filesystemNames, branchNames] = await Promise.all([
        worktreeStore.getAllNames(),
        Promise.resolve(gitWorktreeService.getExistingWorktreeDirectories(workspacePath)),
        gitWorktreeService.getAllBranchNames(workspacePath),
      ]);

      const existingNames = new Set<string>();
      for (const name of dbNames) existingNames.add(name);
      for (const name of filesystemNames) existingNames.add(name);
      for (const name of branchNames) existingNames.add(name);

      // Generate a unique worktree name
      const worktreeName = gitWorktreeService.generateUniqueWorktreeName(existingNames);

      logger.info('Creating worktree for ralph loop', { workspacePath, worktreeName });

      // Create the git worktree
      const worktree = await gitWorktreeService.createWorktree(workspacePath, { name: worktreeName });

      // Store worktree metadata in database
      await worktreeStore.create(worktree);

      logger.info('Worktree created for ralph loop', {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
      });

      // Step 2: Create the Ralph Loop associated with this worktree
      const loop = await ralphService.createLoop(worktree.id, taskDescription, config);

      // Step 3: Auto-start the loop (the UI button says "Create & Start")
      // We await the start so we can report errors to the UI
      try {
        await ralphService.startLoop(loop.id);
      } catch (startErr) {
        logger.error('Failed to auto-start ralph loop:', startErr);
        // Return success for creation, but include start error
        return {
          success: true,
          loop,
          worktree,
          startError: startErr instanceof Error ? startErr.message : 'Failed to start loop',
        };
      }

      return {
        success: true,
        loop,
        worktree,
      };
    } catch (error) {
      logger.error('Failed to create ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create ralph loop',
      };
    }
  });

  /**
   * Start or resume a Ralph Loop
   */
  safeHandle('ralph:start', async (_event, ralphId: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Starting ralph loop', { ralphId });

      await ralphService.startLoop(ralphId);

      return { success: true };
    } catch (error) {
      logger.error('Failed to start ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start ralph loop',
      };
    }
  });

  /**
   * Pause a running Ralph Loop
   */
  safeHandle('ralph:pause', async (_event, ralphId: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Pausing ralph loop', { ralphId });

      await ralphService.pauseLoop(ralphId);

      return { success: true };
    } catch (error) {
      logger.error('Failed to pause ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pause ralph loop',
      };
    }
  });

  /**
   * Stop a Ralph Loop
   */
  safeHandle('ralph:stop', async (_event, ralphId: string, reason?: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Stopping ralph loop', { ralphId, reason });

      await ralphService.stopLoop(ralphId, reason);

      return { success: true };
    } catch (error) {
      logger.error('Failed to stop ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop ralph loop',
      };
    }
  });

  /**
   * Continue a blocked Ralph Loop with user-provided feedback
   */
  safeHandle('ralph:continue-blocked', async (_event, ralphId: string, userFeedback: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }
      if (!userFeedback || userFeedback.trim().length === 0) {
        throw new Error('userFeedback is required');
      }

      logger.info('Continuing blocked ralph loop', { ralphId, feedbackLength: userFeedback.length });

      await ralphService.continueBlockedLoop(ralphId, userFeedback);

      return { success: true };
    } catch (error) {
      logger.error('Failed to continue blocked ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to continue blocked loop',
      };
    }
  });

  /**
   * Force-resume a completed/failed/blocked Ralph Loop
   */
  safeHandle('ralph:force-resume', async (
    _event,
    ralphId: string,
    options?: { bumpMaxIterations?: number; resetCompletionSignal?: boolean }
  ) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Force-resuming ralph loop', { ralphId, options });

      await ralphService.forceResumeLoop(ralphId, options);

      return { success: true };
    } catch (error) {
      logger.error('Failed to force-resume ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to force-resume ralph loop',
      };
    }
  });

  /**
   * Get a Ralph Loop by ID
   */
  safeHandle('ralph:get', async (_event, ralphId: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Getting ralph loop', { ralphId });

      const loop = await ralphService.getLoop(ralphId);

      return {
        success: true,
        loop,
      };
    } catch (error) {
      logger.error('Failed to get ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get ralph loop',
        loop: null,
      };
    }
  });

  /**
   * Get a Ralph Loop by worktree ID
   */
  safeHandle('ralph:get-by-worktree', async (_event, worktreeId: string) => {
    try {
      if (!worktreeId) {
        throw new Error('worktreeId is required');
      }

      logger.info('Getting ralph loop by worktree', { worktreeId });

      const loop = await ralphService.getLoopByWorktreeId(worktreeId);

      return {
        success: true,
        loop,
      };
    } catch (error) {
      logger.error('Failed to get ralph loop by worktree:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get ralph loop',
        loop: null,
      };
    }
  });

  /**
   * Get a Ralph Loop with all iterations
   */
  safeHandle('ralph:get-with-iterations', async (_event, ralphId: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Getting ralph loop with iterations', { ralphId });

      const loop = await ralphService.getLoopWithIterations(ralphId);

      return {
        success: true,
        loop,
      };
    } catch (error) {
      logger.error('Failed to get ralph loop with iterations:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get ralph loop',
        loop: null,
      };
    }
  });

  /**
   * Get all Ralph Loops for a workspace
   */
  safeHandle('ralph:list', async (_event, workspaceId: string) => {
    try {
      if (!workspaceId) {
        throw new Error('workspaceId is required');
      }

      logger.info('Listing ralph loops', { workspaceId });

      const loops = await ralphService.listLoops(workspaceId);

      return {
        success: true,
        loops,
      };
    } catch (error) {
      logger.error('Failed to list ralph loops:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list ralph loops',
        loops: [],
      };
    }
  });

  /**
   * Update Ralph Loop metadata (title, archive, pin)
   */
  safeHandle('ralph:update', async (
    _event,
    ralphId: string,
    updates: { title?: string; isArchived?: boolean; isPinned?: boolean }
  ) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Updating ralph loop', { ralphId, updates });

      const loop = await ralphService.updateLoop(ralphId, updates);

      return {
        success: true,
        loop,
      };
    } catch (error) {
      logger.error('Failed to update ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update ralph loop',
      };
    }
  });

  /**
   * Delete a Ralph Loop
   */
  safeHandle('ralph:delete', async (_event, ralphId: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      logger.info('Deleting ralph loop', { ralphId });

      await ralphService.deleteLoop(ralphId);

      return { success: true };
    } catch (error) {
      logger.error('Failed to delete ralph loop:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete ralph loop',
      };
    }
  });

  /**
   * Get runner state (for UI to show current status)
   */
  safeHandle('ralph:get-runner-state', async (_event, ralphId: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      const state = ralphService.getRunnerState(ralphId);

      return {
        success: true,
        state: state ? {
          isRunning: !state.isPaused && !state.isStopped,
          isPaused: state.isPaused,
          currentIteration: state.loop.currentIteration,
          maxIterations: state.loop.maxIterations,
          currentSessionId: state.currentSessionId,
        } : null,
      };
    } catch (error) {
      logger.error('Failed to get runner state:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get runner state',
        state: null,
      };
    }
  });

  /**
   * Get the progress file for a Ralph Loop
   */
  safeHandle('ralph:get-progress', async (_event, ralphId: string) => {
    try {
      if (!ralphId) {
        throw new Error('ralphId is required');
      }

      const progress = await ralphService.getProgressFile(ralphId);

      return {
        success: true,
        progress,
      };
    } catch (error) {
      logger.error('Failed to get ralph progress:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get ralph progress',
        progress: null,
      };
    }
  });

  /**
   * Notify that a session has completed (called from renderer)
   */
  safeOn('ralph:session-complete', async (_event, sessionId: string, success?: boolean) => {
    logger.info('Ralph session complete notification', { sessionId, success });
    ralphService.notifySessionComplete(sessionId, success ?? true);
  });

  handlersRegistered = true;
  logger.info('Ralph loop handlers registered');
}
