import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { database } from './database/PGLiteDatabaseWorker';
import { logger } from './utils/logger';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export type SnapshotType = 'auto-save' | 'manual' | 'ai-diff' | 'pre-apply' | 'external-change';

export interface Snapshot {
  timestamp: string;
  type: SnapshotType;
  size: number;
  baseMarkdownHash: string;
  metadata?: any;
}

export class HistoryManager {
  private maxSnapshots = 50;
  private maxAgeDays = 30;

  constructor() {}

  async initialize(): Promise<void> {
    // Ensure database is initialized
    if (!database.isInitialized()) {
      await database.initialize();
    }

    // Check if we need to migrate from file-based history
    await this.migrateIfNeeded();

    await this.cleanup();
  }

  private async migrateIfNeeded(): Promise<void> {
    try {
      // Check if database has any history
      const result = await database.query('SELECT COUNT(*) as count FROM document_history');
      const dbCount = parseInt(result.rows[0].count);

      // Check if there are history files
      const historyDir = path.join(app.getPath('userData'), 'history');
      let hasHistoryFiles = false;

      try {
        const dirs = await fs.readdir(historyDir);
        hasHistoryFiles = dirs.length > 0;
      } catch {
        // No history directory
      }

      // If database is empty but we have history files, migrate
      if (dbCount === 0 && hasHistoryFiles) {
        logger.main.info('[HistoryManager] Database empty but history files exist, starting migration...');
        await this.migrateFromFiles();
      }
    } catch (error) {
      logger.main.error('[HistoryManager] Migration check failed:', error);
    }
  }

  private async migrateFromFiles(): Promise<void> {
    const historyDir = path.join(app.getPath('userData'), 'history');

    try {
      const dirs = await fs.readdir(historyDir);
      let migratedCount = 0;

      for (const dir of dirs) {
        const manifestPath = path.join(historyDir, dir, 'manifest.json');
        const snapshotsDir = path.join(historyDir, dir, 'snapshots');

        try {
          const data = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(data);
          const workspaceId = path.dirname(manifest.filePath);

          for (const snapshot of manifest.snapshots) {
            try {
              // Read the compressed content
              const snapshotPath = path.join(snapshotsDir, `${snapshot.timestamp}.lexical.gz`);
              const compressed = await fs.readFile(snapshotPath);

              // Read metadata if it exists
              let metadata = { type: snapshot.type };
              try {
                const metaPath = path.join(snapshotsDir, `${snapshot.timestamp}.meta.json`);
                const metaData = await fs.readFile(metaPath, 'utf-8');
                metadata = JSON.parse(metaData);
              } catch {
                // No metadata file
              }

              // Insert into database with actual content
              await database.query(`
                INSERT INTO document_history (
                  workspace_id, file_path, content, size_bytes,
                  timestamp, version, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              `, [
                workspaceId,
                manifest.filePath,
                compressed,
                snapshot.size,
                Date.parse(snapshot.timestamp),
                1,
                metadata
              ]);

              migratedCount++;
            } catch (error) {
              logger.main.warn(`[HistoryManager] Failed to migrate snapshot ${snapshot.timestamp}:`, error);
            }
          }
        } catch (error) {
          logger.main.warn(`[HistoryManager] Failed to migrate history for ${dir}:`, error);
        }
      }

      logger.main.info(`[HistoryManager] Migrated ${migratedCount} history snapshots to database`);
    } catch (error) {
      logger.main.error('[HistoryManager] Migration failed:', error);
    }
  }

  async createSnapshot(
    filePath: string,
    state: string,
    type: SnapshotType,
    description?: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    // Compress the state
    const compressed = await gzip(Buffer.from(state, 'utf-8'));

    // Calculate markdown hash
    const baseMarkdownHash = crypto
      .createHash('sha256')
      .update(state)
      .digest('hex');

    // Save to database
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      // Determine workspace ID
      let workspaceId: string | null = null;
      const dirPath = path.dirname(filePath);
      if (dirPath !== '/' && dirPath !== path.parse(dirPath).root) {
        workspaceId = dirPath;
      }

      await database.query(`
        INSERT INTO document_history (
          workspace_id,
          file_path,
          content,
          size_bytes,
          timestamp,
          version,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        workspaceId,
        filePath,
        compressed, // Store compressed content directly in database
        compressed.length,
        Date.now(),
        1,
        { type, description, baseMarkdownHash }
      ]);

      logger.main.debug('[HistoryManager] Saved history to database for:', filePath);
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to save history to database:', error);
      throw error; // Actually fail if we can't save
    }
  }


  async listSnapshots(filePath: string): Promise<Snapshot[]> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const result = await database.query<{
        timestamp: number;
        size_bytes: number;
        metadata: any;
      }>(`
        SELECT timestamp, size_bytes, metadata
        FROM document_history
        WHERE file_path = $1
        ORDER BY timestamp DESC
      `, [filePath]);

      return result.rows.map(row => ({
        timestamp: new Date(row.timestamp).toISOString(),
        type: row.metadata?.type || 'manual',
        size: row.size_bytes,
        baseMarkdownHash: row.metadata?.baseMarkdownHash || '',
        metadata: row.metadata
      }));
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to list snapshots:', error);
      return [];
    }
  }

  async loadSnapshot(filePath: string, timestamp: string): Promise<string> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const result = await database.query<{ content: Buffer }>(`
        SELECT content
        FROM document_history
        WHERE file_path = $1 AND timestamp = $2
        LIMIT 1
      `, [filePath, Date.parse(timestamp)]);

      if (result.rows.length === 0) {
        throw new Error('Snapshot not found');
      }

      const compressed = result.rows[0].content;
      const decompressed = await gunzip(compressed);
      return decompressed.toString('utf-8');
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to load snapshot from database:', error);
      throw error;
    }
  }

  async deleteSnapshot(filePath: string, timestamp: string): Promise<void> {
    try {
      await database.query(`
        DELETE FROM document_history
        WHERE file_path = $1 AND timestamp = $2
      `, [filePath, Date.parse(timestamp)]);
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to delete snapshot:', error);
      throw error;
    }
  }


  async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      const maxAge = this.maxAgeDays * 24 * 60 * 60 * 1000;

      // Delete old snapshots
      await database.query(`
        DELETE FROM document_history
        WHERE timestamp < $1
      `, [now - maxAge]);

      // Keep only maxSnapshots per file
      await database.query(`
        DELETE FROM document_history
        WHERE id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY timestamp DESC) as rn
            FROM document_history
          ) t
          WHERE rn <= $1
        )
      `, [this.maxSnapshots]);
    } catch (error) {
      logger.main.error('[HistoryManager] Cleanup failed:', error);
    }
  }

  /**
   * Delete all history for a workspace
   */
  async deleteWorkspaceHistory(workspacePath: string): Promise<void> {
    try {
      logger.main.info('[HistoryManager] Deleting history for workspace:', workspacePath);

      await database.query(`
        DELETE FROM document_history
        WHERE workspace_id = $1
      `, [workspacePath]);

      logger.main.info('[HistoryManager] Deleted history for workspace:', workspacePath);
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to delete workspace history:', error);
    }
  }
}

// Export singleton instance
export const historyManager = new HistoryManager();