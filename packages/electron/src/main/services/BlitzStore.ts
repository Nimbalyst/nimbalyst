/**
 * BlitzStore - Database operations for blitz metadata
 *
 * Manages CRUD operations for blitzes table using PGLite.
 * A blitz runs the same prompt across multiple worktrees simultaneously.
 * Follows patterns from WorktreeStore.
 */

import log from 'electron-log/main';

const logger = log.scope('BlitzStore');

export interface BlitzModelConfig {
  provider: string;
  model: string;
  count: number;
}

export interface Blitz {
  id: string;
  workspaceId: string;
  prompt: string;
  modelConfig: BlitzModelConfig[];
  displayName?: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

interface BlitzRow {
  id: string;
  workspace_id: string;
  prompt: string;
  model_config: BlitzModelConfig[] | string;
  display_name?: string;
  is_pinned?: boolean;
  is_archived?: boolean;
  created_at: Date | string | number;
  updated_at: Date | string | number;
}

type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

/**
 * Convert database timestamp to milliseconds (handles PGLite timezone issues)
 */
function toMillis(value: unknown): number {
  if (!value) return Date.now();
  if (typeof value === 'number') return value;

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = value.getMonth();
    const day = value.getDate();
    const hour = value.getHours();
    const minute = value.getMinutes();
    const second = value.getSeconds();
    const ms = value.getMilliseconds();
    return Date.UTC(year, month, day, hour, minute, second, ms);
  }

  const str = String(value).trim();
  const hasTimezone = str.endsWith('Z') || str.includes('+') || /[0-9]-\d{2}:\d{2}$/.test(str);
  const utcStr = hasTimezone ? str : str.replace(' ', 'T') + 'Z';
  const parsed = new Date(utcStr).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function rowToBlitz(row: BlitzRow): Blitz {
  const modelConfig = typeof row.model_config === 'string'
    ? JSON.parse(row.model_config)
    : row.model_config;

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    prompt: row.prompt,
    modelConfig,
    displayName: row.display_name ?? undefined,
    isPinned: row.is_pinned ?? false,
    isArchived: row.is_archived ?? false,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
  };
}

/**
 * Create a BlitzStore instance
 */
export function createBlitzStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn) {
  const ensureReady = async () => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  return {
    async create(blitz: Blitz): Promise<void> {
      await ensureReady();

      logger.info('Creating blitz record', { id: blitz.id });

      const createdAt = new Date(blitz.createdAt);
      const updatedAt = new Date(blitz.updatedAt || blitz.createdAt);

      await db.query(
        `INSERT INTO blitzes (
          id, workspace_id, prompt, model_config, display_name,
          is_pinned, is_archived, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          blitz.id,
          blitz.workspaceId,
          blitz.prompt,
          JSON.stringify(blitz.modelConfig),
          blitz.displayName || null,
          blitz.isPinned,
          blitz.isArchived,
          createdAt,
          updatedAt,
        ]
      );

      logger.info('Blitz record created', { id: blitz.id });
    },

    async get(id: string): Promise<Blitz | null> {
      await ensureReady();

      const { rows } = await db.query<BlitzRow>(
        `SELECT * FROM blitzes WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (rows.length === 0) return null;
      return rowToBlitz(rows[0]);
    },

    async list(workspaceId: string, includeArchived = false): Promise<Blitz[]> {
      await ensureReady();

      const archiveFilter = includeArchived ? '' : 'AND (is_archived = FALSE OR is_archived IS NULL)';
      const { rows } = await db.query<BlitzRow>(
        `SELECT * FROM blitzes
         WHERE workspace_id = $1 ${archiveFilter}
         ORDER BY created_at DESC`,
        [workspaceId]
      );

      return rows.map(rowToBlitz);
    },

    async updatePinned(id: string, isPinned: boolean): Promise<void> {
      await ensureReady();

      await db.query(
        `UPDATE blitzes SET is_pinned = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, isPinned]
      );
    },

    async updateDisplayName(id: string, displayName: string): Promise<void> {
      await ensureReady();

      await db.query(
        `UPDATE blitzes SET display_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, displayName]
      );
    },

    /**
     * Update display name only if it hasn't been set yet (atomic conditional update).
     * Used to set the blitz's display name from the first session that gets named.
     *
     * @returns true if the display name was updated, false if it was already set
     */
    async updateDisplayNameIfEmpty(id: string, displayName: string): Promise<boolean> {
      await ensureReady();

      logger.info('Updating blitz display name if empty', { id, displayName });

      const { rows } = await db.query<{ affected: number }>(
        `UPDATE blitzes
         SET display_name = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND display_name IS NULL
         RETURNING 1 as affected`,
        [id, displayName]
      );

      const updated = rows.length > 0;
      if (updated) {
        logger.info('Blitz display name set', { id, displayName });
      }
      return updated;
    },

    async updateArchived(id: string, isArchived: boolean): Promise<void> {
      await ensureReady();

      await db.query(
        `UPDATE blitzes SET is_archived = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, isArchived]
      );
    },

    async delete(id: string): Promise<void> {
      await ensureReady();

      await db.query('DELETE FROM blitzes WHERE id = $1', [id]);
    },
  };
}

export type BlitzStore = ReturnType<typeof createBlitzStore>;
