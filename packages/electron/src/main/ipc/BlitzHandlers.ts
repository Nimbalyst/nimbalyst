/**
 * BlitzHandlers - IPC handlers for blitz operations
 *
 * A blitz runs the same prompt across multiple worktrees simultaneously.
 * Each worktree gets its own session with a specific model assignment.
 */

import { ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { GitWorktreeService } from '../services/GitWorktreeService';
import { createWorktreeStore, type Worktree } from '../services/WorktreeStore';
import { createBlitzStore } from '../services/BlitzStore';
import type { BlitzModelConfig } from '../services/BlitzStore';
import { getDatabase } from '../database/initialize';
import { getQueuedPromptsStore } from '../services/RepositoryManager';
import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { ModelIdentifier, type AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import type { BlitzCreateResult, WorktreeCreateResult } from '../../shared/ipc/types';

const logger = log.scope('BlitzHandlers');

const MAX_BLITZ_WORKTREES = 10;

/**
 * Emit blitz:created event to all windows
 */
function emitBlitzCreated(blitzId: string, workspacePath: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send('blitz:created', { blitzId, workspacePath });
    }
  }
}

/**
 * Register blitz IPC handlers
 */
export function registerBlitzHandlers(): void {
  const gitWorktreeService = new GitWorktreeService();

  /**
   * Create a new blitz: multiple worktrees with the same prompt
   */
  ipcMain.handle('blitz:create', async (
    _event,
    payload: {
      workspacePath: string;
      prompt: string;
      modelConfig: BlitzModelConfig[];
    }
  ): Promise<BlitzCreateResult> => {
    const startTime = Date.now();

    try {
      const { workspacePath, prompt, modelConfig } = payload;

      if (!workspacePath) {
        throw new Error('workspacePath is required');
      }
      if (!prompt || !prompt.trim()) {
        throw new Error('prompt is required');
      }
      if (!modelConfig || modelConfig.length === 0) {
        throw new Error('At least one model must be selected');
      }

      const totalWorktrees = modelConfig.reduce((sum, m) => sum + m.count, 0);
      if (totalWorktrees > MAX_BLITZ_WORKTREES) {
        throw new Error(`Total worktrees (${totalWorktrees}) exceeds maximum of ${MAX_BLITZ_WORKTREES}`);
      }

      const db = getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      const blitzStore = createBlitzStore(db);
      const worktreeStore = createWorktreeStore(db);

      // Create blitz record
      const blitzId = crypto.randomUUID();
      const now = Date.now();
      const blitz = {
        id: blitzId,
        workspaceId: workspacePath,
        prompt: prompt.trim(),
        modelConfig,
        isPinned: false,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      };

      await blitzStore.create(blitz);
      logger.info('Blitz record created', { blitzId, totalWorktrees });

      // Create worktrees and sessions sequentially (git operations need serialization)
      const worktreeResults: WorktreeCreateResult[] = [];
      const sessionIds: string[] = [];
      const errors: string[] = [];

      // Flatten model config into individual worktree assignments
      const worktreeAssignments: { provider: string; model: string }[] = [];
      for (const config of modelConfig) {
        for (let i = 0; i < config.count; i++) {
          worktreeAssignments.push({ provider: config.provider, model: config.model });
        }
      }

      // Gather existing names once for de-duplication across all worktrees
      const [dbNames, filesystemNames, branchNames] = await Promise.all([
        worktreeStore.getAllNames(),
        Promise.resolve(gitWorktreeService.getExistingWorktreeDirectories(workspacePath)),
        gitWorktreeService.getAllBranchNames(workspacePath),
      ]);

      const existingNames = new Set<string>();
      for (const n of dbNames) existingNames.add(n);
      for (const n of filesystemNames) existingNames.add(n);
      for (const n of branchNames) existingNames.add(n);

      for (let i = 0; i < worktreeAssignments.length; i++) {
        const assignment = worktreeAssignments[i];

        try {
          // Generate unique name (adding each created name to the set to prevent collisions)
          const worktreeName = gitWorktreeService.generateUniqueWorktreeName(existingNames);
          existingNames.add(worktreeName);

          // Create git worktree (createWorktree handles locking internally)
          const gitWorktree = await gitWorktreeService.createWorktree(workspacePath, { name: worktreeName });

          // Store worktree with blitz association
          const worktree: Worktree = { ...gitWorktree, blitzId };
          await worktreeStore.create(worktree);

          worktreeResults.push({ success: true, worktree });

          // Create session for this worktree using AISessionsRepository directly
          const sessionId = crypto.randomUUID();

          // Parse provider from model ID if needed
          let provider: AIProviderType = assignment.provider as AIProviderType;
          let model = assignment.model;
          const modelId = ModelIdentifier.tryParse(model);
          if (modelId) {
            provider = modelId.provider;
          }

          await AISessionsRepository.create({
            id: sessionId,
            provider,
            model,
            title: `Session ${i + 1}`,
            workspaceId: workspacePath,
            worktreeId: worktree.id,
          });

          sessionIds.push(sessionId);

          // Queue the prompt for this session
          try {
            const queueStore = getQueuedPromptsStore();
            await queueStore.create({
              id: `blitz-prompt-${blitzId}-${sessionId}`,
              sessionId,
              prompt: prompt.trim(),
            });

            logger.info('Queued prompt for blitz session', {
              blitzId,
              sessionId,
              worktreeName: worktree.name,
            });
          } catch (queueError) {
            logger.error('Failed to queue prompt for blitz session', {
              blitzId,
              sessionId,
              error: queueError,
            });
            errors.push(`Failed to queue prompt for ${worktree.name}: ${queueError instanceof Error ? queueError.message : String(queueError)}`);
          }

          logger.info('Blitz worktree created', {
            blitzId,
            worktreeIndex: i + 1,
            totalWorktrees,
            worktreeName: worktree.name,
            model: assignment.model,
          });
        } catch (worktreeError) {
          const errorMsg = `Failed to create worktree ${i + 1}/${totalWorktrees}: ${worktreeError instanceof Error ? worktreeError.message : String(worktreeError)}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
          worktreeResults.push({ success: false, error: errorMsg });
        }
      }

      // Trigger queue processing for all created sessions
      for (const sessionId of sessionIds) {
        const windows = BrowserWindow.getAllWindows();
        for (const window of windows) {
          if (!window.isDestroyed()) {
            window.webContents.send('blitz:session-ready', {
              blitzId,
              sessionId,
              workspacePath,
            });
          }
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Blitz creation completed', {
        blitzId,
        totalWorktrees,
        successCount: worktreeResults.filter(r => r.success).length,
        errorCount: errors.length,
        durationMs: duration,
      });

      // Track analytics
      const analyticsService = AnalyticsService.getInstance();
      analyticsService.sendEvent('blitz_created', {
        worktree_count: totalWorktrees,
        model_count: modelConfig.length,
        prompt_length: prompt.trim().length,
        duration_ms: duration,
        error_count: errors.length,
      });

      // Emit event to renderer
      emitBlitzCreated(blitzId, workspacePath);

      return {
        success: true,
        blitz,
        worktrees: worktreeResults,
        sessionIds,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      logger.error('Failed to create blitz:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create blitz',
      };
    }
  });

  /**
   * List all blitzes for a workspace
   */
  ipcMain.handle('blitz:list', async (_event, workspacePath: string, includeArchived = false) => {
    try {
      const db = getDatabase();
      if (!db) throw new Error('Database not initialized');

      const blitzStore = createBlitzStore(db);
      const blitzes = await blitzStore.list(workspacePath, includeArchived);

      return { success: true, blitzes };
    } catch (error) {
      logger.error('Failed to list blitzes:', error);
      return { success: false, error: String(error), blitzes: [] };
    }
  });

  /**
   * Get a single blitz by ID
   */
  ipcMain.handle('blitz:get', async (_event, blitzId: string) => {
    try {
      const db = getDatabase();
      if (!db) throw new Error('Database not initialized');

      const blitzStore = createBlitzStore(db);
      const blitz = await blitzStore.get(blitzId);

      if (!blitz) {
        return { success: false, error: 'Blitz not found' };
      }

      // Also get associated worktrees
      const worktreeStore = createWorktreeStore(db);
      const worktrees = await worktreeStore.listByBlitz(blitzId);

      return { success: true, blitz, worktrees };
    } catch (error) {
      logger.error('Failed to get blitz:', error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * Archive a blitz and all its worktrees
   */
  ipcMain.handle('blitz:archive', async (_event, blitzId: string, workspacePath: string) => {
    try {
      const db = getDatabase();
      if (!db) throw new Error('Database not initialized');

      const blitzStore = createBlitzStore(db);
      const worktreeStore = createWorktreeStore(db);

      // Archive all child worktrees
      const worktrees = await worktreeStore.listByBlitz(blitzId);
      for (const worktree of worktrees) {
        if (!worktree.isArchived) {
          await worktreeStore.updateArchived(worktree.id, true);
        }
      }

      // Archive the blitz itself
      await blitzStore.updateArchived(blitzId, true);

      logger.info('Blitz archived', { blitzId, worktreeCount: worktrees.length });
      return { success: true };
    } catch (error) {
      logger.error('Failed to archive blitz:', error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * Update blitz pinned status
   */
  ipcMain.handle('blitz:update-pinned', async (_event, blitzId: string, isPinned: boolean) => {
    try {
      const db = getDatabase();
      if (!db) throw new Error('Database not initialized');

      const blitzStore = createBlitzStore(db);
      await blitzStore.updatePinned(blitzId, isPinned);

      return { success: true };
    } catch (error) {
      logger.error('Failed to update blitz pinned status:', error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * Update blitz display name
   */
  ipcMain.handle('blitz:update-display-name', async (_event, blitzId: string, displayName: string) => {
    try {
      const db = getDatabase();
      if (!db) throw new Error('Database not initialized');

      const blitzStore = createBlitzStore(db);
      await blitzStore.updateDisplayName(blitzId, displayName);

      return { success: true };
    } catch (error) {
      logger.error('Failed to update blitz display name:', error);
      return { success: false, error: String(error) };
    }
  });
}
