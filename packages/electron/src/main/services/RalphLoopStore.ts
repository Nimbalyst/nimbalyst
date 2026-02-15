/**
 * RalphLoopStore - Database operations for Ralph Loops
 *
 * Manages CRUD operations for ralph_loops and ralph_iterations tables using PGLite.
 * Follows patterns from WorktreeStore.
 */

import log from 'electron-log/main';
import { toMillis } from '../utils/timestampUtils';
import type {
  RalphLoop,
  RalphIteration,
  RalphLoopWithIterations,
  RalphLoopStatus,
  RalphIterationStatus,
} from '../../shared/types/ralph';

const logger = log.scope('RalphLoopStore');

/**
 * Database row structure for ralph_loops table
 */
interface RalphLoopRow {
  id: string;
  worktree_id: string;
  task_description: string;
  title: string | null;
  status: string;
  current_iteration: number;
  max_iterations: number;
  model_id: string | null;
  completion_reason: string | null;
  is_archived: boolean | null;
  is_pinned: boolean | null;
  created_at: Date | string | number;
  updated_at: Date | string | number;
}

/**
 * Database row structure for ralph_iterations table
 */
interface RalphIterationRow {
  id: string;
  ralph_loop_id: string;
  session_id: string;
  iteration_number: number;
  status: string;
  exit_reason: string | null;
  created_at: Date | string | number;
  completed_at: Date | string | number | null;
}

/**
 * Database-like interface (matches what PGLite provides)
 */
type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

/**
 * Convert row to RalphLoop
 */
function rowToRalphLoop(row: RalphLoopRow): RalphLoop {
  return {
    id: row.id,
    worktreeId: row.worktree_id,
    taskDescription: row.task_description,
    title: row.title ?? undefined,
    status: row.status as RalphLoopStatus,
    currentIteration: row.current_iteration,
    maxIterations: row.max_iterations,
    modelId: row.model_id ?? undefined,
    completionReason: row.completion_reason ?? undefined,
    isArchived: row.is_archived ?? false,
    isPinned: row.is_pinned ?? false,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
  };
}

/**
 * Convert row to RalphIteration
 */
function rowToRalphIteration(row: RalphIterationRow): RalphIteration {
  return {
    id: row.id,
    ralphLoopId: row.ralph_loop_id,
    sessionId: row.session_id,
    iterationNumber: row.iteration_number,
    status: row.status as RalphIterationStatus,
    exitReason: row.exit_reason ?? undefined,
    createdAt: toMillis(row.created_at),
    completedAt: row.completed_at ? toMillis(row.completed_at) : undefined,
  };
}

/**
 * Create a RalphLoopStore instance
 */
export function createRalphLoopStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn) {
  const ensureReady = async () => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  return {
    // ========================================
    // Ralph Loop CRUD
    // ========================================

    /**
     * Create a new Ralph Loop
     */
    async createLoop(
      id: string,
      worktreeId: string,
      taskDescription: string,
      maxIterations: number = 20,
      modelId?: string
    ): Promise<RalphLoop> {
      await ensureReady();

      logger.info('Creating ralph loop', { id, worktreeId, maxIterations, modelId });

      const now = new Date();

      await db.query(
        `INSERT INTO ralph_loops (
          id, worktree_id, task_description, status, current_iteration, max_iterations, model_id, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'pending', 0, $4, $5, $6, $6
        )`,
        [id, worktreeId, taskDescription, maxIterations, modelId ?? null, now]
      );

      logger.info('Ralph loop created', { id });

      return {
        id,
        worktreeId,
        taskDescription,
        status: 'pending',
        currentIteration: 0,
        maxIterations,
        modelId,
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      };
    },

    /**
     * Get a Ralph Loop by ID
     */
    async getLoop(id: string): Promise<RalphLoop | null> {
      await ensureReady();

      logger.debug('Getting ralph loop', { id });

      const { rows } = await db.query<RalphLoopRow>(
        `SELECT * FROM ralph_loops WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (rows.length === 0) {
        logger.debug('Ralph loop not found', { id });
        return null;
      }

      return rowToRalphLoop(rows[0]);
    },

    /**
     * Get a Ralph Loop by worktree ID
     */
    async getLoopByWorktreeId(worktreeId: string): Promise<RalphLoop | null> {
      await ensureReady();

      logger.debug('Getting ralph loop by worktree', { worktreeId });

      const { rows } = await db.query<RalphLoopRow>(
        `SELECT * FROM ralph_loops WHERE worktree_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [worktreeId]
      );

      if (rows.length === 0) {
        logger.debug('Ralph loop not found for worktree', { worktreeId });
        return null;
      }

      return rowToRalphLoop(rows[0]);
    },

    /**
     * Get all Ralph Loops for a workspace
     */
    async listLoops(workspaceId: string): Promise<RalphLoop[]> {
      await ensureReady();

      logger.debug('Listing ralph loops', { workspaceId });

      const { rows } = await db.query<RalphLoopRow>(
        `SELECT rl.* FROM ralph_loops rl
         JOIN worktrees w ON rl.worktree_id = w.id
         WHERE w.workspace_id = $1
         ORDER BY rl.created_at DESC`,
        [workspaceId]
      );

      const loops = rows.map(rowToRalphLoop);
      logger.debug('Found ralph loops', { count: loops.length });

      return loops;
    },

    /**
     * Update Ralph Loop status
     */
    async updateLoopStatus(
      id: string,
      status: RalphLoopStatus,
      completionReason?: string
    ): Promise<void> {
      await ensureReady();

      logger.info('Updating ralph loop status', { id, status, completionReason });

      if (completionReason !== undefined) {
        await db.query(
          `UPDATE ralph_loops
           SET status = $2, completion_reason = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id, status, completionReason]
        );
      } else {
        await db.query(
          `UPDATE ralph_loops
           SET status = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id, status]
        );
      }

      logger.info('Ralph loop status updated', { id, status });
    },

    /**
     * Increment the current iteration counter
     */
    async incrementIteration(id: string): Promise<number> {
      await ensureReady();

      logger.info('Incrementing ralph loop iteration', { id });

      const { rows } = await db.query<{ current_iteration: number }>(
        `UPDATE ralph_loops
         SET current_iteration = current_iteration + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING current_iteration`,
        [id]
      );

      const newIteration = rows[0]?.current_iteration ?? 0;
      logger.info('Ralph loop iteration incremented', { id, iteration: newIteration });

      return newIteration;
    },

    /**
     * Update Ralph Loop metadata (title, archive, pin)
     */
    async updateLoop(
      id: string,
      updates: { title?: string; isArchived?: boolean; isPinned?: boolean }
    ): Promise<RalphLoop | null> {
      await ensureReady();

      logger.info('Updating ralph loop', { id, updates });

      const setClauses: string[] = [];
      const params: any[] = [id];
      let paramIndex = 2;

      if (updates.title !== undefined) {
        setClauses.push(`title = $${paramIndex++}`);
        params.push(updates.title);
      }
      if (updates.isArchived !== undefined) {
        setClauses.push(`is_archived = $${paramIndex++}`);
        params.push(updates.isArchived);
      }
      if (updates.isPinned !== undefined) {
        setClauses.push(`is_pinned = $${paramIndex++}`);
        params.push(updates.isPinned);
      }

      if (setClauses.length === 0) {
        return this.getLoop(id);
      }

      setClauses.push('updated_at = CURRENT_TIMESTAMP');

      const { rows } = await db.query<RalphLoopRow>(
        `UPDATE ralph_loops SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );

      if (rows.length === 0) {
        return null;
      }

      return rowToRalphLoop(rows[0]);
    },

    /**
     * Delete a Ralph Loop and all its iterations
     */
    async deleteLoop(id: string): Promise<void> {
      await ensureReady();

      logger.info('Deleting ralph loop', { id });

      // Iterations are deleted automatically via ON DELETE CASCADE
      await db.query('DELETE FROM ralph_loops WHERE id = $1', [id]);

      logger.info('Ralph loop deleted', { id });
    },

    // ========================================
    // Ralph Iteration CRUD
    // ========================================

    /**
     * Create a new Ralph Iteration
     */
    async createIteration(
      id: string,
      ralphLoopId: string,
      sessionId: string,
      iterationNumber: number
    ): Promise<RalphIteration> {
      await ensureReady();

      logger.info('Creating ralph iteration', { id, ralphLoopId, sessionId, iterationNumber });

      const now = new Date();

      await db.query(
        `INSERT INTO ralph_iterations (
          id, ralph_loop_id, session_id, iteration_number, status, created_at
        ) VALUES (
          $1, $2, $3, $4, 'running', $5
        )`,
        [id, ralphLoopId, sessionId, iterationNumber, now]
      );

      logger.info('Ralph iteration created', { id, iterationNumber });

      return {
        id,
        ralphLoopId,
        sessionId,
        iterationNumber,
        status: 'running',
        createdAt: now.getTime(),
      };
    },

    /**
     * Get all iterations for a Ralph Loop
     */
    async getIterations(ralphLoopId: string): Promise<RalphIteration[]> {
      await ensureReady();

      logger.debug('Getting ralph iterations', { ralphLoopId });

      const { rows } = await db.query<RalphIterationRow>(
        `SELECT * FROM ralph_iterations
         WHERE ralph_loop_id = $1
         ORDER BY iteration_number ASC`,
        [ralphLoopId]
      );

      const iterations = rows.map(rowToRalphIteration);
      logger.debug('Found ralph iterations', { count: iterations.length });

      return iterations;
    },

    /**
     * Get iteration by session ID
     */
    async getIterationBySessionId(sessionId: string): Promise<RalphIteration | null> {
      await ensureReady();

      logger.debug('Getting ralph iteration by session', { sessionId });

      const { rows } = await db.query<RalphIterationRow>(
        `SELECT * FROM ralph_iterations WHERE session_id = $1 LIMIT 1`,
        [sessionId]
      );

      if (rows.length === 0) {
        return null;
      }

      return rowToRalphIteration(rows[0]);
    },

    /**
     * Update iteration status
     */
    async updateIterationStatus(
      id: string,
      status: RalphIterationStatus,
      exitReason?: string
    ): Promise<void> {
      await ensureReady();

      logger.info('Updating ralph iteration status', { id, status, exitReason });

      if (status === 'completed' || status === 'failed') {
        await db.query(
          `UPDATE ralph_iterations
           SET status = $2, exit_reason = $3, completed_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id, status, exitReason ?? null]
        );
      } else {
        await db.query(
          `UPDATE ralph_iterations
           SET status = $2, exit_reason = $3
           WHERE id = $1`,
          [id, status, exitReason ?? null]
        );
      }

      logger.info('Ralph iteration status updated', { id, status });
    },

    // ========================================
    // Combined Queries
    // ========================================

    /**
     * Get a Ralph Loop with all its iterations
     */
    async getLoopWithIterations(id: string): Promise<RalphLoopWithIterations | null> {
      await ensureReady();

      const loop = await this.getLoop(id);
      if (!loop) {
        return null;
      }

      const iterations = await this.getIterations(id);

      return {
        ...loop,
        iterations,
      };
    },

    /**
     * Get active (running or paused) Ralph Loops
     */
    async getActiveLoops(): Promise<RalphLoop[]> {
      await ensureReady();

      logger.debug('Getting active ralph loops');

      const { rows } = await db.query<RalphLoopRow>(
        `SELECT * FROM ralph_loops
         WHERE status IN ('running', 'paused')
         ORDER BY updated_at DESC`
      );

      const loops = rows.map(rowToRalphLoop);
      logger.debug('Found active ralph loops', { count: loops.length });

      return loops;
    },

    /**
     * Mark all running iterations for a loop as failed (startup recovery)
     */
    async failOrphanedIterations(ralphLoopId: string): Promise<number> {
      await ensureReady();

      const { rows } = await db.query<{ id: string }>(
        `UPDATE ralph_iterations
         SET status = 'failed', exit_reason = 'Interrupted by app restart', completed_at = CURRENT_TIMESTAMP
         WHERE ralph_loop_id = $1 AND status = 'running'
         RETURNING id`,
        [ralphLoopId]
      );

      if (rows.length > 0) {
        logger.info('Failed orphaned iterations', { ralphLoopId, count: rows.length });
      }
      return rows.length;
    },

    /**
     * Update the max iterations for a loop
     */
    async updateMaxIterations(id: string, maxIterations: number): Promise<void> {
      await ensureReady();

      logger.info('Updating max iterations', { id, maxIterations });

      await db.query(
        `UPDATE ralph_loops
         SET max_iterations = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, maxIterations]
      );
    },
  };
}

/**
 * RalphLoopStore type
 */
export type RalphLoopStore = ReturnType<typeof createRalphLoopStore>;
