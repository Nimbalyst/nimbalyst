/**
 * WorktreeStore - Database operations for worktree metadata
 *
 * Manages CRUD operations for worktrees table using PGLite.
 * Follows patterns from PGLiteSessionStore and PGLiteAgentMessagesStore.
 */

import log from 'electron-log';

const logger = log.scope('WorktreeStore');

/**
 * Worktree data structure (matches runtime types and GitWorktreeService)
 */
export interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  projectPath: string; // Maps to workspace_id in database
  createdAt: number;
  updatedAt?: number;
}

/**
 * Database-like interface (matches what PGLite provides)
 */
type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

/**
 * Convert database timestamp to milliseconds (handles PGLite timezone issues)
 * See CLAUDE.md "CRITICAL: Date/Timestamp Handling" for details
 */
function toMillis(value: unknown): number {
  if (!value) return Date.now();
  if (typeof value === 'number') return value;

  if (value instanceof Date) {
    // Get the components as if they were UTC
    const year = value.getFullYear();
    const month = value.getMonth();
    const day = value.getDate();
    const hour = value.getHours();
    const minute = value.getMinutes();
    const second = value.getSeconds();
    const ms = value.getMilliseconds();

    // Create a UTC date from those components
    return Date.UTC(year, month, day, hour, minute, second, ms);
  }

  // Fallback for string timestamps
  const str = String(value).trim();
  const hasTimezone = str.endsWith('Z') || str.includes('+') || /[0-9]-\d{2}:\d{2}$/.test(str);
  const utcStr = hasTimezone ? str : str.replace(' ', 'T') + 'Z';
  const parsed = new Date(utcStr).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * Create a WorktreeStore instance
 */
export function createWorktreeStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn) {
  const ensureReady = async () => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  return {
    /**
     * Create a new worktree record
     */
    async create(worktree: Worktree): Promise<void> {
      await ensureReady();

      logger.info('Creating worktree record', { id: worktree.id, name: worktree.name, path: worktree.path });

      // Check for duplicate path
      const existingWorktree = await this.getByPath(worktree.path);
      if (existingWorktree) {
        throw new Error(`Worktree with path already exists in database: ${worktree.path}`);
      }

      const createdAt = new Date(worktree.createdAt);
      const updatedAt = new Date(worktree.updatedAt || worktree.createdAt);

      await db.query(
        `INSERT INTO worktrees (
          id, workspace_id, name, path, branch, base_branch, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )`,
        [
          worktree.id,
          worktree.projectPath, // workspace_id in database
          worktree.name,
          worktree.path,
          worktree.branch,
          worktree.baseBranch,
          createdAt,
          updatedAt,
        ]
      );

      logger.info('Worktree record created', { id: worktree.id });
    },

    /**
     * Get a worktree by ID
     */
    async get(id: string): Promise<Worktree | null> {
      await ensureReady();

      logger.info('Getting worktree', { id });

      const { rows } = await db.query<any>(
        `SELECT * FROM worktrees WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (rows.length === 0) {
        logger.info('Worktree not found', { id });
        return null;
      }

      const row = rows[0];
      const worktree: Worktree = {
        id: row.id,
        name: row.name,
        path: row.path,
        branch: row.branch,
        baseBranch: row.base_branch,
        projectPath: row.workspace_id,
        createdAt: toMillis(row.created_at),
        updatedAt: toMillis(row.updated_at),
      };

      return worktree;
    },

    /**
     * Get a worktree by path
     */
    async getByPath(path: string): Promise<Worktree | null> {
      await ensureReady();

      logger.info('Getting worktree by path', { path });

      const { rows } = await db.query<any>(
        `SELECT * FROM worktrees WHERE path = $1 LIMIT 1`,
        [path]
      );

      if (rows.length === 0) {
        logger.info('Worktree not found', { path });
        return null;
      }

      const row = rows[0];
      const worktree: Worktree = {
        id: row.id,
        name: row.name,
        path: row.path,
        branch: row.branch,
        baseBranch: row.base_branch,
        projectPath: row.workspace_id,
        createdAt: toMillis(row.created_at),
        updatedAt: toMillis(row.updated_at),
      };

      return worktree;
    },

    /**
     * List all worktrees for a workspace/project
     */
    async list(workspaceId: string): Promise<Worktree[]> {
      await ensureReady();

      logger.info('Listing worktrees', { workspaceId });

      const { rows } = await db.query<any>(
        `SELECT * FROM worktrees
         WHERE workspace_id = $1
         ORDER BY created_at DESC`,
        [workspaceId]
      );

      const worktrees = rows.map(row => ({
        id: row.id,
        name: row.name,
        path: row.path,
        branch: row.branch,
        baseBranch: row.base_branch,
        projectPath: row.workspace_id,
        createdAt: toMillis(row.created_at),
        updatedAt: toMillis(row.updated_at),
      }));

      logger.info('Found worktrees', { count: worktrees.length });
      return worktrees;
    },

    /**
     * Update a worktree record
     */
    async update(id: string, updates: Partial<Omit<Worktree, 'id' | 'createdAt'>>): Promise<void> {
      await ensureReady();

      logger.info('Updating worktree', { id, updates });

      const fields: string[] = [];
      const values: any[] = [id];

      if (updates.name !== undefined) {
        fields.push(`name = $${values.length + 1}`);
        values.push(updates.name);
      }

      if (updates.path !== undefined) {
        fields.push(`path = $${values.length + 1}`);
        values.push(updates.path);
      }

      if (updates.branch !== undefined) {
        fields.push(`branch = $${values.length + 1}`);
        values.push(updates.branch);
      }

      if (updates.baseBranch !== undefined) {
        fields.push(`base_branch = $${values.length + 1}`);
        values.push(updates.baseBranch);
      }

      if (updates.projectPath !== undefined) {
        fields.push(`workspace_id = $${values.length + 1}`);
        values.push(updates.projectPath);
      }

      // Always update updated_at timestamp
      fields.push('updated_at = CURRENT_TIMESTAMP');

      if (fields.length === 1) {
        // Only updated_at, nothing else to update
        logger.info('No fields to update besides timestamp', { id });
      }

      const sql = `UPDATE worktrees SET ${fields.join(', ')} WHERE id = $1`;
      await db.query(sql, values);

      logger.info('Worktree updated', { id });
    },

    /**
     * Delete a worktree record
     */
    async delete(id: string): Promise<void> {
      await ensureReady();

      logger.info('Deleting worktree record', { id });

      await db.query('DELETE FROM worktrees WHERE id = $1', [id]);

      logger.info('Worktree record deleted', { id });
    },

    /**
     * Delete a worktree record by path
     */
    async deleteByPath(path: string): Promise<void> {
      await ensureReady();

      logger.info('Deleting worktree record by path', { path });

      await db.query('DELETE FROM worktrees WHERE path = $1', [path]);

      logger.info('Worktree record deleted', { path });
    },

    /**
     * Check if a worktree exists by path
     */
    async exists(path: string): Promise<boolean> {
      await ensureReady();

      const { rows } = await db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM worktrees WHERE path = $1`,
        [path]
      );

      return (rows[0]?.count || 0) > 0;
    },

    /**
     * Get all sessions associated with a worktree
     */
    async getWorktreeSessions(worktreeId: string): Promise<string[]> {
      await ensureReady();

      logger.info('Getting sessions for worktree', { worktreeId });

      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM ai_sessions WHERE worktree_id = $1 ORDER BY created_at DESC`,
        [worktreeId]
      );

      const sessionIds = rows.map(row => row.id);
      logger.info('Found sessions for worktree', { worktreeId, count: sessionIds.length });

      return sessionIds;
    },
  };
}

/**
 * WorktreeStore type
 */
export type WorktreeStore = ReturnType<typeof createWorktreeStore>;
