/**
 * BlitzHandlers - IPC handlers for blitz operations
 *
 * A blitz runs the same prompt across multiple worktrees simultaneously.
 * Each worktree gets its own session with a specific model assignment.
 *
 * Blitzes are modeled as ai_sessions with session_type='blitz'. The blitz
 * session stores the prompt and model config in its metadata JSONB column.
 * Child worktree sessions point back via parent_session_id.
 */

import { ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { GitWorktreeService } from '../services/GitWorktreeService';
import { createWorktreeStore } from '../services/WorktreeStore';
import { getDatabase } from '../database/initialize';
import { getQueuedPromptsStore } from '../services/RepositoryManager';
import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { ModelIdentifier, type AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import type { BlitzCreateResult, WorktreeCreateResult } from '../../shared/ipc/types';

const logger = log.scope('BlitzHandlers');

const MAX_BLITZ_WORKTREES = 10;

/**
 * Convert a model ID to a human-readable label for blitz session titles.
 * Mirrors the renderer's modelUtils.ts logic but runs in main process.
 */
function getBlitzSessionModelLabel(model: string): string {
  const CLAUDE_CODE_LABELS: Record<string, string> = {
    'opus': 'Opus 4.6',
    'sonnet': 'Sonnet 4.6',
    'haiku': 'Haiku 3.5',
  };

  // Try parsing as provider:model via ModelIdentifier
  const parsed = ModelIdentifier.tryParse(model);
  if (parsed && parsed.provider === 'claude-code') {
    const variant = parsed.baseVariant;
    return CLAUDE_CODE_LABELS[variant] || variant.charAt(0).toUpperCase() + variant.slice(1);
  }

  // For other providers, extract the model part
  if (model.includes(':')) {
    const [, modelPart] = model.split(':', 2);
    return modelPart;
  }

  return model;
}

export interface BlitzModelConfig {
  provider: string;
  model: string;
  count: number;
}

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

      const worktreeStore = createWorktreeStore(db);

      // Create blitz session (ai_session with session_type='blitz')
      const blitzId = crypto.randomUUID();
      const now = Date.now();

      await AISessionsRepository.create({
        id: blitzId,
        provider: 'system',
        sessionType: 'blitz',
        title: 'New blitz',
        workspaceId: workspacePath,
        metadata: { prompt: prompt.trim(), modelConfig },
      } as any);

      logger.info('Blitz session created', { blitzId, totalWorktrees });

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

      // Pre-compute model label counts for session title deduplication
      // If a model appears more than once, suffix with -1, -2, etc.
      const modelLabelCounts = new Map<string, number>();
      for (const a of worktreeAssignments) {
        const label = getBlitzSessionModelLabel(a.model);
        modelLabelCounts.set(label, (modelLabelCounts.get(label) || 0) + 1);
      }
      const modelLabelIndexes = new Map<string, number>();

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

          // Store worktree record
          await worktreeStore.create(gitWorktree);

          worktreeResults.push({ success: true, worktree: gitWorktree });

          // Create session for this worktree, linked to blitz via parent_session_id
          const sessionId = crypto.randomUUID();

          // Parse provider from model ID if needed
          let provider: AIProviderType = assignment.provider as AIProviderType;
          let model = assignment.model;
          const modelId = ModelIdentifier.tryParse(model);
          if (modelId) {
            provider = modelId.provider;
          }

          // Compute model-based session title with deduplication
          const baseLabel = getBlitzSessionModelLabel(assignment.model);
          const totalForLabel = modelLabelCounts.get(baseLabel) || 1;
          const labelIndex = (modelLabelIndexes.get(baseLabel) || 0) + 1;
          modelLabelIndexes.set(baseLabel, labelIndex);
          const sessionTitle = totalForLabel > 1 ? `${baseLabel}-${labelIndex}` : baseLabel;

          await AISessionsRepository.create({
            id: sessionId,
            provider,
            model,
            sessionType: 'session',
            title: sessionTitle,
            workspaceId: workspacePath,
            worktreeId: gitWorktree.id,
            parentSessionId: blitzId,
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
              worktreeName: gitWorktree.name,
            });
          } catch (queueError) {
            logger.error('Failed to queue prompt for blitz session', {
              blitzId,
              sessionId,
              error: queueError,
            });
            errors.push(`Failed to queue prompt for ${gitWorktree.name}: ${queueError instanceof Error ? queueError.message : String(queueError)}`);
          }

          logger.info('Blitz worktree created', {
            blitzId,
            worktreeIndex: i + 1,
            totalWorktrees,
            worktreeName: gitWorktree.name,
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
        blitzSessionId: blitzId,
        worktrees: worktreeResults,
        sessionIds,
        models: worktreeAssignments.map(a => a.model),
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
   * List all blitz sessions for a workspace
   */
  ipcMain.handle('blitz:list', async (_event, workspacePath: string, _includeArchived = false) => {
    try {
      const db = getDatabase();
      if (!db) throw new Error('Database not initialized');

      // Query ai_sessions with session_type='blitz' for this workspace
      const { rows } = await db.query<any>(
        `SELECT id, title, session_type, metadata, is_pinned, is_archived, created_at, updated_at
         FROM ai_sessions
         WHERE workspace_id = $1 AND session_type = 'blitz'
         ORDER BY created_at DESC`,
        [workspacePath]
      );

      const blitzes = rows.map((row: any) => {
        const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});
        return {
          id: row.id,
          prompt: metadata.prompt ?? '',
          modelConfig: metadata.modelConfig ?? [],
          displayName: row.title !== 'New blitz' ? row.title : undefined,
          isPinned: row.is_pinned ?? false,
          isArchived: row.is_archived ?? false,
          createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime(),
          updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : new Date(row.updated_at).getTime(),
        };
      });

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
      const session = await AISessionsRepository.get(blitzId);

      if (!session || session.sessionType !== 'blitz') {
        return { success: false, error: 'Blitz not found' };
      }

      const metadata = session.metadata ?? {};
      const blitz = {
        id: session.id,
        prompt: (metadata as any).prompt ?? '',
        modelConfig: (metadata as any).modelConfig ?? [],
        displayName: session.title !== 'New blitz' ? session.title : undefined,
        isPinned: session.isPinned ?? false,
        isArchived: session.isArchived ?? false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };

      return { success: true, blitz };
    } catch (error) {
      logger.error('Failed to get blitz:', error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * Archive a blitz and all its child worktree sessions
   */
  ipcMain.handle('blitz:archive', async (_event, blitzId: string, _workspacePath: string) => {
    try {
      const db = getDatabase();
      if (!db) throw new Error('Database not initialized');

      const worktreeStore = createWorktreeStore(db);

      // Find all child sessions and their worktrees
      const { rows: childSessions } = await db.query<{ id: string; worktree_id: string }>(
        `SELECT id, worktree_id FROM ai_sessions WHERE parent_session_id = $1`,
        [blitzId]
      );

      // Archive child worktrees
      const archivedWorktreeIds = new Set<string>();
      for (const child of childSessions) {
        if (child.worktree_id && !archivedWorktreeIds.has(child.worktree_id)) {
          await worktreeStore.updateArchived(child.worktree_id, true);
          archivedWorktreeIds.add(child.worktree_id);
        }
      }

      // Archive child sessions
      for (const child of childSessions) {
        await AISessionsRepository.updateMetadata(child.id, { isArchived: true });
      }

      // Archive the blitz session itself
      await AISessionsRepository.updateMetadata(blitzId, { isArchived: true });

      logger.info('Blitz archived', { blitzId, childCount: childSessions.length });
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
      await AISessionsRepository.updateMetadata(blitzId, { isPinned } as any);
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
      await AISessionsRepository.updateMetadata(blitzId, { title: displayName });
      return { success: true };
    } catch (error) {
      logger.error('Failed to update blitz display name:', error);
      return { success: false, error: String(error) };
    }
  });
}
