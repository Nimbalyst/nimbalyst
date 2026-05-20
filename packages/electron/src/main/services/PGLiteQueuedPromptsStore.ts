/**
 * PGLite implementation of QueuedPromptsStore
 *
 * Stores prompts queued from any device for execution.
 * Uses simple row-level atomic updates instead of JSONB array manipulation.
 */

import { toMillis } from '../utils/timestampUtils';

export interface QueuedPrompt {
  id: string;
  sessionId: string;
  prompt: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  attachments?: any[];
  documentContext?: {
    filePath?: string;
    content?: string;
    fileType?: string;
    /** Identifies the origin of this queued prompt (e.g. 'wakeup_resume' for ScheduleWakeup). */
    promptOrigin?: string;
  };
  createdAt: number;  // epoch ms
  claimedAt?: number; // epoch ms
  completedAt?: number; // epoch ms
  errorMessage?: string;
}

export interface CreateQueuedPromptInput {
  id: string;
  sessionId: string;
  prompt: string;
  attachments?: any[];
  documentContext?: {
    filePath?: string;
    content?: string;
    fileType?: string;
    /** Identifies the origin of this queued prompt (e.g. 'wakeup_resume' for ScheduleWakeup). */
    promptOrigin?: string;
  };
}

export interface QueuedPromptsStore {
  /** Create a new queued prompt */
  create(input: CreateQueuedPromptInput): Promise<QueuedPrompt>;

  /** Get a specific queued prompt by ID */
  get(id: string): Promise<QueuedPrompt | null>;

  /** List all queued prompts for a session */
  listForSession(sessionId: string, options?: { includeCompleted?: boolean }): Promise<QueuedPrompt[]>;

  /** List pending prompts for a session (ready to execute) */
  listPending(sessionId: string): Promise<QueuedPrompt[]>;

  /**
   * Atomically claim a pending prompt for execution.
   * Returns the prompt if successfully claimed, null if already claimed or not found.
   * This is the key atomic operation that prevents duplicate execution.
   */
  claim(id: string): Promise<QueuedPrompt | null>;

  /** Mark a prompt as completed */
  complete(id: string): Promise<void>;

  /** Mark a prompt as failed with an error message */
  fail(id: string, errorMessage: string): Promise<void>;

  /** Delete a queued prompt */
  delete(id: string): Promise<void>;

  /**
   * Reset any rows stuck in 'executing' back to 'pending' for the given
   * session. Used on interrupt/cancel and at app startup so a hang or
   * crash mid-execute can't leave a prompt permanently invisible to
   * listPending. Returns the number of rows that were rolled back. Pass
   * sessionId='*' (or use rollbackAllExecuting) to sweep every session.
   */
  rollbackExecuting(sessionId: string): Promise<number>;

  /**
   * Reset every row stuck in 'executing' back to 'pending'. Intended for
   * the one-shot recovery sweep at app startup.
   */
  rollbackAllExecuting(): Promise<number>;

  /**
   * Boot-time sweep over `executing` rows that distinguishes "delivered but
   * agent was still paused at quit" from "crashed before delivery."
   *
   * Why: a queued prompt is in `executing` for the entire duration of an
   * agent turn, including while the agent is paused on AskUserQuestion /
   * ExitPlanMode / permission requests. A naive rollback to `pending`
   * causes the prompt to be re-claimed and re-sent on the next session
   * activation, duplicating the original user input. We instead check
   * whether the prompt was already injected into the conversation by
   * looking for an `ai_agent_messages` input row in the same session
   * dated at or after `claimed_at`. If delivered -> mark `completed`
   * (the agent turn is no longer running, but the prompt did its job).
   * If not delivered -> roll back to `pending` so a retry can pick it
   * up (genuine crash before send).
   *
   * Returns the count of rows in each bucket.
   */
  sweepExecutingOnBoot(): Promise<{ completed: number; rolledBack: number }>;

  /**
   * Delivery-aware single-session variant of the boot sweep. Used by
   * the cancel / interrupt / mobile-sync paths instead of the bare
   * `rollbackExecuting`. Same rationale: clicking cancel mid-turn does
   * not undo the user message that has already landed in
   * `ai_agent_messages`. Rolling such a row back to `pending` causes
   * the queue trigger that follows the abort to immediately re-claim
   * and re-send it, duplicating the input. Mark delivered rows
   * `completed`; roll back only rows that never made it to the
   * conversation.
   */
  sweepExecutingForSession(sessionId: string): Promise<{ completed: number; rolledBack: number }>;

  /** Delete all completed/failed prompts older than a certain age */
  cleanup(olderThanMs: number): Promise<number>;
}

type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

function rowToQueuedPrompt(row: any): QueuedPrompt {
  // Parse JSONB fields
  let attachments = row.attachments;
  if (typeof attachments === 'string') {
    try {
      attachments = JSON.parse(attachments);
    } catch {
      attachments = undefined;
    }
  }

  let documentContext = row.document_context;
  if (typeof documentContext === 'string') {
    try {
      documentContext = JSON.parse(documentContext);
    } catch {
      documentContext = undefined;
    }
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    prompt: row.prompt,
    status: row.status,
    attachments,
    documentContext,
    createdAt: toMillis(row.created_at)!,
    claimedAt: toMillis(row.claimed_at) ?? undefined,
    completedAt: toMillis(row.completed_at) ?? undefined,
    errorMessage: row.error_message || undefined,
  };
}

export function createPGLiteQueuedPromptsStore(
  db: PGliteLike,
  ensureDbReady?: EnsureReadyFn
): QueuedPromptsStore {
  const ensureReady = async () => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  return {
    async create(input: CreateQueuedPromptInput): Promise<QueuedPrompt> {
      await ensureReady();

      const { rows } = await db.query<any>(
        `INSERT INTO queued_prompts (id, session_id, prompt, attachments, document_context)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.id,
          input.sessionId,
          input.prompt,
          input.attachments ? JSON.stringify(input.attachments) : null,
          input.documentContext ? JSON.stringify(input.documentContext) : null,
        ]
      );

      if (rows.length === 0) {
        throw new Error('Failed to create queued prompt');
      }

      console.log(`[QueuedPromptsStore] Created prompt ${input.id} for session ${input.sessionId}`);
      return rowToQueuedPrompt(rows[0]);
    },

    async get(id: string): Promise<QueuedPrompt | null> {
      await ensureReady();

      const { rows } = await db.query<any>(
        `SELECT * FROM queued_prompts WHERE id = $1`,
        [id]
      );

      return rows.length > 0 ? rowToQueuedPrompt(rows[0]) : null;
    },

    async listForSession(
      sessionId: string,
      options?: { includeCompleted?: boolean }
    ): Promise<QueuedPrompt[]> {
      await ensureReady();

      const includeCompleted = options?.includeCompleted ?? false;

      let query = `SELECT * FROM queued_prompts WHERE session_id = $1`;
      if (!includeCompleted) {
        query += ` AND status NOT IN ('completed', 'failed')`;
      }
      query += ` ORDER BY created_at ASC`;

      const { rows } = await db.query<any>(query, [sessionId]);
      return rows.map(rowToQueuedPrompt);
    },

    async listPending(sessionId: string): Promise<QueuedPrompt[]> {
      await ensureReady();

      const { rows } = await db.query<any>(
        `SELECT * FROM queued_prompts
         WHERE session_id = $1 AND status = 'pending'
         ORDER BY created_at ASC`,
        [sessionId]
      );

      return rows.map(rowToQueuedPrompt);
    },

    async claim(id: string): Promise<QueuedPrompt | null> {
      await ensureReady();

      // ATOMIC: Only update if status is still 'pending'
      // This is the key operation that prevents duplicate execution
      const { rows } = await db.query<any>(
        `UPDATE queued_prompts
         SET status = 'executing', claimed_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        console.log(`[QueuedPromptsStore] claim: prompt ${id} not found or already claimed`);
        return null;
      }

      console.log(`[QueuedPromptsStore] claim: successfully claimed prompt ${id}`);
      return rowToQueuedPrompt(rows[0]);
    },

    async complete(id: string): Promise<void> {
      await ensureReady();

      await db.query(
        `UPDATE queued_prompts
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );

      // console.log(`[QueuedPromptsStore] Marked prompt ${id} as completed`);
    },

    async fail(id: string, errorMessage: string): Promise<void> {
      await ensureReady();

      await db.query(
        `UPDATE queued_prompts
         SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = $2
         WHERE id = $1`,
        [id, errorMessage]
      );

      console.log(`[QueuedPromptsStore] Marked prompt ${id} as failed: ${errorMessage}`);
    },

    async delete(id: string): Promise<void> {
      await ensureReady();

      await db.query(
        `DELETE FROM queued_prompts WHERE id = $1`,
        [id]
      );

      console.log(`[QueuedPromptsStore] Deleted prompt ${id}`);
    },

    async rollbackExecuting(sessionId: string): Promise<number> {
      await ensureReady();

      const { rows } = await db.query<{ id: string }>(
        `UPDATE queued_prompts
         SET status = 'pending', claimed_at = NULL
         WHERE session_id = $1 AND status = 'executing'
         RETURNING id`,
        [sessionId]
      );

      if (rows.length > 0) {
        console.log(`[QueuedPromptsStore] Rolled back ${rows.length} executing prompt(s) for session ${sessionId}`);
      }
      return rows.length;
    },

    async rollbackAllExecuting(): Promise<number> {
      await ensureReady();

      const { rows } = await db.query<{ id: string }>(
        `UPDATE queued_prompts
         SET status = 'pending', claimed_at = NULL
         WHERE status = 'executing'
         RETURNING id`
      );

      if (rows.length > 0) {
        console.log(`[QueuedPromptsStore] Boot sweep: rolled back ${rows.length} executing prompt(s) across all sessions`);
      }
      return rows.length;
    },

    async sweepExecutingOnBoot(): Promise<{ completed: number; rolledBack: number }> {
      await ensureReady();

      // Pass 1: rows whose user message was already logged to
      // ai_agent_messages -- the prompt was delivered and the agent was
      // just paused (e.g. on AskUserQuestion) when the app quit. Mark
      // completed so the next session activation doesn't re-claim and
      // re-send the original prompt.
      //
      // Three branches join in this update:
      //
      // (a) `executing` rows whose input arrived after `claimed_at` --
      //     standard "delivered then paused" case.
      // (b) `pending` rows whose prompt text appears in a later input
      //     for the same session -- leftover corruption from older
      //     builds that ran the blanket `rollbackAllExecuting` sweep on
      //     boot. POSITION > 0 implies the text is already in the
      //     conversation, so the row must not be re-delivered.
      // (c) `pending` rows older than 24h -- abandoned. Catches the
      //     long-tail of (b) where the content match misses because
      //     JSON escaping (newlines, quotes, pasted attachments)
      //     differs between the queued prompt and the logged input. A
      //     legitimately-queued prompt is processed within seconds of
      //     creation; a row sitting >24h pending is effectively
      //     abandoned regardless of whether it was technically
      //     delivered.
      const completedResult = await db.query<{ id: string }>(
        `UPDATE queued_prompts
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP
         WHERE (
           (status = 'executing' AND claimed_at IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM ai_agent_messages m
              WHERE m.session_id = queued_prompts.session_id
                AND m.direction = 'input'
                AND m.created_at >= queued_prompts.claimed_at
            ))
           OR
           (status = 'pending'
            AND EXISTS (
              SELECT 1 FROM ai_agent_messages m
              WHERE m.session_id = queued_prompts.session_id
                AND m.direction = 'input'
                AND m.created_at >= queued_prompts.created_at
                AND POSITION(queued_prompts.prompt IN m.content) > 0
            ))
           OR
           (status = 'pending'
            AND created_at < NOW() - INTERVAL '1 day')
         )
         RETURNING id`
      );

      // Pass 2: anything still executing crashed before its input was
      // ever logged. Roll back to pending so it can be retried.
      const rolledBackResult = await db.query<{ id: string }>(
        `UPDATE queued_prompts
         SET status = 'pending', claimed_at = NULL
         WHERE status = 'executing'
         RETURNING id`
      );

      const completed = completedResult.rows.length;
      const rolledBack = rolledBackResult.rows.length;

      if (completed > 0 || rolledBack > 0) {
        console.log(
          `[QueuedPromptsStore] Boot sweep: marked ${completed} delivered prompt(s) completed, rolled back ${rolledBack} undelivered prompt(s)`
        );
      }

      return { completed, rolledBack };
    },

    async sweepExecutingForSession(sessionId: string): Promise<{ completed: number; rolledBack: number }> {
      await ensureReady();

      // Pass 1: same delivery check as sweepExecutingOnBoot, but scoped
      // to a single session. Used on cancel/interrupt to avoid the
      // immediate re-claim that follows when an already-delivered prompt
      // is rolled back to pending.
      const completedResult = await db.query<{ id: string }>(
        `UPDATE queued_prompts
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP
         WHERE status = 'executing'
           AND session_id = $1
           AND claimed_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM ai_agent_messages m
             WHERE m.session_id = queued_prompts.session_id
               AND m.direction = 'input'
               AND m.created_at >= queued_prompts.claimed_at
           )
         RETURNING id`,
        [sessionId]
      );

      // Pass 2: roll back anything still executing for this session that
      // never made it to the conversation.
      const rolledBackResult = await db.query<{ id: string }>(
        `UPDATE queued_prompts
         SET status = 'pending', claimed_at = NULL
         WHERE status = 'executing' AND session_id = $1
         RETURNING id`,
        [sessionId]
      );

      const completed = completedResult.rows.length;
      const rolledBack = rolledBackResult.rows.length;

      if (completed > 0 || rolledBack > 0) {
        console.log(
          `[QueuedPromptsStore] Session sweep (${sessionId}): marked ${completed} delivered prompt(s) completed, rolled back ${rolledBack} undelivered prompt(s)`
        );
      }

      return { completed, rolledBack };
    },

    async cleanup(olderThanMs: number): Promise<number> {
      await ensureReady();

      const cutoffDate = new Date(Date.now() - olderThanMs);

      const { rows } = await db.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM queued_prompts
           WHERE status IN ('completed', 'failed')
             AND completed_at < $1
           RETURNING 1
         )
         SELECT COUNT(*) as count FROM deleted`,
        [cutoffDate]
      );

      const count = parseInt(rows[0]?.count || '0', 10);
      if (count > 0) {
        console.log(`[QueuedPromptsStore] Cleaned up ${count} old prompts`);
      }

      return count;
    },
  };
}
