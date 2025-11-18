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

export type SnapshotType = 'auto-save' | 'manual' | 'ai-diff' | 'pre-apply' | 'external-change' | 'ai-edit' | 'incremental-approval';

export interface Snapshot {
  timestamp: string;
  type: SnapshotType;
  size: number;
  baseMarkdownHash: string;
  metadata?: any;
}

export type TagStatus = 'pending-review' | 'reviewed' | 'archived';

export interface HistoryTag {
  id: string;                    // "pre-ai-edit-${sessionId}-${toolUseId}"
  filePath: string;
  content: string;               // The tagged content
  type: 'pre-edit' | 'incremental-approval';  // Tag type
  status: TagStatus;
  sessionId: string;
  toolUseId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class HistoryManager {
  private maxSnapshots = 250;
  private maxAgeDays = 30;
  private pendingSnapshots = new Map<string, { promise: Promise<void>; timestamp: number }>(); // Track in-flight snapshot creations
  private readonly DEDUP_WINDOW_MS = 1500; // Only deduplicate within 1500ms window

  constructor() {}

  async initialize(): Promise<void> {
    // Ensure database is initialized
    if (!database.isInitialized()) {
      await database.initialize();
    }

    await this.cleanup();
  }


  async createSnapshot(
    filePath: string,
    state: string,
    type: SnapshotType,
    description?: string
  ): Promise<void> {
    // Calculate markdown hash first
    const baseMarkdownHash = crypto
      .createHash('sha256')
      .update(state)
      .digest('hex');

    // Create a unique key for this snapshot (file + hash)
    const snapshotKey = `${filePath}:${baseMarkdownHash}`;
    const now = Date.now();

    // If there's already a pending snapshot with the same content within dedup window, wait for it and skip
    const existing = this.pendingSnapshots.get(snapshotKey);
    if (existing) {
      const timeSinceStart = now - existing.timestamp;
      if (timeSinceStart < this.DEDUP_WINDOW_MS) {
        logger.main.debug('[HistoryManager] Skipping duplicate snapshot (already in progress, within dedup window):', snapshotKey);
        await existing.promise; // Wait for the existing one to complete
        return;
      } else {
        // Outside dedup window - this is a legitimate re-save of same content
        logger.main.debug('[HistoryManager] Allowing snapshot (outside dedup window):', snapshotKey);
      }
    }

    // Create a promise for this snapshot operation
    const snapshotPromise = this._createSnapshotImpl(filePath, state, type, description, baseMarkdownHash);
    this.pendingSnapshots.set(snapshotKey, { promise: snapshotPromise, timestamp: now });

    try {
      await snapshotPromise;
    } finally {
      // Clean up the pending snapshot entry
      this.pendingSnapshots.delete(snapshotKey);
    }
  }

  private async _createSnapshotImpl(
    filePath: string,
    state: string,
    type: SnapshotType,
    description: string | undefined,
    baseMarkdownHash: string
  ): Promise<void> {
    // Check for duplicate: if the most recent snapshot has the same content hash, skip
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      // Get the most recent snapshot for this file
      const recentResult = await database.query<{ metadata: any }>(`
        SELECT metadata
        FROM document_history
        WHERE file_path = $1
        ORDER BY timestamp DESC
        LIMIT 1
      `, [filePath]);

      if (recentResult.rows.length > 0) {
        const recentMetadata = recentResult.rows[0].metadata;
        if (recentMetadata?.baseMarkdownHash === baseMarkdownHash) {
          logger.main.debug('[HistoryManager] Skipping duplicate snapshot (same content hash in DB):', filePath);
          return; // Skip creating duplicate
        }
      }
    } catch (error) {
      // If deduplication check fails, continue with snapshot creation
      logger.main.warn('[HistoryManager] Deduplication check failed, creating snapshot anyway:', error);
    }

    // Compress the state
    const compressed = await gzip(Buffer.from(state, 'utf-8'));

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
      // Use CTE to avoid race conditions with corrupted data
      await database.query(`
        WITH ids_to_keep AS (
          SELECT id
          FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY timestamp DESC) as rn
            FROM document_history
          ) t
          WHERE rn <= $1
        ),
        ids_to_delete AS (
          SELECT id FROM document_history WHERE id NOT IN (SELECT id FROM ids_to_keep)
        )
        DELETE FROM document_history
        WHERE id IN (SELECT id FROM ids_to_delete)
        AND EXISTS (SELECT 1 FROM document_history dh WHERE dh.id = document_history.id)
      `, [this.maxSnapshots]);
    } catch (error: any) {
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

  /**
   * Create a tag for a document version (Phase 1 of file-watcher diff approval)
   * Tags are permanent records that mark specific document states
   */
  async createTag(
    filePath: string,
    tagId: string,
    content: string,
    sessionId: string,
    toolUseId: string
  ): Promise<void> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const now = Date.now();
      const compressed = await gzip(Buffer.from(content, 'utf-8'));

      // Determine workspace ID
      let workspaceId: string | null = null;
      const dirPath = path.dirname(filePath);
      if (dirPath !== '/' && dirPath !== path.parse(dirPath).root) {
        workspaceId = dirPath;
      }

      // CRITICAL: Mark any existing pending tags as reviewed
      // The unique index ensures only ONE can be pending-review at a time
      // When starting a new AI edit (creating pre-edit tag), any previous pending
      // incremental-approval tag should be marked as reviewed since the user is
      // moving forward with new edits
      await database.query(`
        UPDATE document_history
        SET metadata = jsonb_set(metadata, '{status}', to_jsonb('reviewed'::text))
        WHERE file_path = $1
          AND metadata->>'status' = 'pending-review'
      `, [filePath]);

      // Store tag as a special history entry with tag metadata
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
        compressed,
        compressed.length,
        now,
        1,
        {
          type: 'pre-edit',
          tagId,
          status: 'pending-review' as TagStatus,
          sessionId,
          toolUseId,
          createdAt: now,
          updatedAt: now
        }
      ]);

      logger.main.info('[HistoryManager] Created tag:', { filePath, tagId, sessionId, toolUseId });
    } catch (error: any) {
      // Check if this is a unique constraint violation (duplicate pending pre-edit tag)
      if (error.code === '23505' || error.message?.includes('idx_history_pending_pre_edit_per_file')) {
        logger.main.info('[HistoryManager] Skipping tag creation - file already has pending pre-edit tag:', { filePath });
        // This is expected when AI makes multiple rapid edits - silently ignore
        return;
      }

      logger.main.error('[HistoryManager] Failed to create tag:', error);
      throw error;
    }
  }

  /**
   * Get a specific tag by ID
   */
  async getTag(filePath: string, tagId: string): Promise<HistoryTag | null> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const result = await database.query<{
        content: Buffer;
        metadata: any;
      }>(`
        SELECT content, metadata
        FROM document_history
        WHERE file_path = $1
          AND metadata->>'tagId' = $2
          AND metadata->>'type' = 'pre-edit'
        ORDER BY timestamp DESC
        LIMIT 1
      `, [filePath, tagId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const compressed = row.content;
      const decompressed = await gunzip(compressed);
      const content = decompressed.toString('utf-8');

      return {
        id: tagId,
        filePath,
        content,
        status: row.metadata.status,
        sessionId: row.metadata.sessionId,
        toolUseId: row.metadata.toolUseId,
        createdAt: new Date(row.metadata.createdAt),
        updatedAt: new Date(row.metadata.updatedAt)
      };
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to get tag:', error);
      return null;
    }
  }

  /**
   * Update tag content (used during incremental accept/reject)
   */
  async updateTagContent(filePath: string, tagId: string, newContent: string): Promise<void> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const compressed = await gzip(Buffer.from(newContent, 'utf-8'));
      const now = Date.now();

      await database.query(`
        UPDATE document_history
        SET content = $1,
            size_bytes = $2,
            metadata = jsonb_set(metadata, '{updatedAt}', to_jsonb($3::bigint))
        WHERE file_path = $4
          AND metadata->>'tagId' = $5
          AND metadata->>'type' = 'pre-edit'
      `, [compressed, compressed.length, now, filePath, tagId]);

      logger.main.debug('[HistoryManager] Updated tag content:', { filePath, tagId });
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to update tag content:', error);
      throw error;
    }
  }

  /**
   * Update tag status (pending-review -> reviewed -> archived)
   * Works for both pre-edit and incremental-approval tags
   */
  async updateTagStatus(filePath: string, tagId: string, status: TagStatus): Promise<void> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const now = Date.now();

      // logger.main.info('[HistoryManager] BEFORE updateTagStatus:', { filePath, tagId, status });

      const result = await database.query(`
        UPDATE document_history
        SET metadata = jsonb_set(
              jsonb_set(metadata, '{status}', to_jsonb($1::text)),
              '{updatedAt}', to_jsonb($2::bigint)
            )
        WHERE file_path = $3
          AND metadata->>'tagId' = $4
      `, [status, now, filePath, tagId]);

      // logger.main.info('[HistoryManager] AFTER updateTagStatus - rows affected:', (result as any).rowCount || 0);

      // Verify the update worked
      const checkResult = await database.query(`
        SELECT metadata->>'status' as status, metadata->>'tagId' as tag_id, metadata->>'type' as type
        FROM document_history
        WHERE file_path = $1
          AND (metadata->>'type' = 'pre-edit' OR metadata->>'type' = 'incremental-approval')
      `, [filePath]);

      // logger.main.info('[HistoryManager] All tags for file after update:',
      //   checkResult.rows.map((r: any) => ({ tagId: r.tag_id, type: r.type, status: r.status }))
      // );
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to update tag status:', error);
      throw error;
    }
  }

  /**
   * Get all pending tags (status='pending-review') for a file or all files
   */
  async getPendingTags(filePath?: string): Promise<HistoryTag[]> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const query = filePath
        ? `
          SELECT file_path, content, metadata
          FROM document_history
          WHERE file_path = $1
            AND metadata->>'status' = 'pending-review'
          ORDER BY timestamp DESC
        `
        : `
          SELECT file_path, content, metadata
          FROM document_history
          WHERE metadata->>'status' = 'pending-review'
          ORDER BY timestamp DESC
        `;

      const params = filePath ? [filePath] : [];
      const result = await database.query<{
        file_path: string;
        content: Buffer;
        metadata: any;
      }>(query, params);

      const tags: HistoryTag[] = [];
      for (const row of result.rows) {
        const compressed = row.content;
        const decompressed = await gunzip(compressed);
        const content = decompressed.toString('utf-8');

        tags.push({
          id: row.metadata.tagId,
          filePath: row.file_path,
          content,
          type: row.metadata.type,
          status: row.metadata.status,
          sessionId: row.metadata.sessionId,
          toolUseId: row.metadata.toolUseId,
          createdAt: new Date(row.metadata.createdAt),
          updatedAt: new Date(row.metadata.updatedAt)
        });
      }

      // PRODUCTION LOG: Track pending tag queries to diagnose missing diff display
      if (filePath && tags.length === 0) {
        // console.log('[TAG CHECK] No pending tags found for file:', filePath);
      } else if (filePath && tags.length > 0) {
        console.log('[TAG CHECK] Found pending tag:', JSON.stringify({
          file: path.basename(filePath),
          tagId: tags[0].id,
          status: tags[0].status,
          age: Date.now() - tags[0].createdAt.getTime() + 'ms',
        }));
      }

      return tags;
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to get pending tags:', error);
      return [];
    }
  }

  /**
   * Check if a tag exists
   */
  async hasTag(filePath: string, tagId: string): Promise<boolean> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const result = await database.query<{ count: number }>(`
        SELECT COUNT(*) as count
        FROM document_history
        WHERE file_path = $1
          AND metadata->>'tagId' = $2
          AND metadata->>'type' = 'pre-edit'
      `, [filePath, tagId]);

      return result.rows[0]?.count > 0;
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to check tag existence:', error);
      return false;
    }
  }

  /**
   * Create an incremental-approval tag marking a partial accept/reject during AI session
   * These tags form a chain of user decisions, updating the baseline for remaining diffs
   */
  async createIncrementalApprovalTag(
    filePath: string,
    content: string,
    sessionId: string,
    metadata?: { acceptedGroups?: string[], rejectedGroups?: string[], remainingGroups?: string[] }
  ): Promise<string> {
    try {
      // Ensure database is initialized
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const now = Date.now();
      const compressed = await gzip(Buffer.from(content, 'utf-8'));

      // Generate unique tag ID
      const tagId = `incremental-${sessionId}-${now}`;

      // Determine workspace ID
      let workspaceId: string | null = null;
      const dirPath = path.dirname(filePath);
      if (dirPath !== '/' && dirPath !== path.parse(dirPath).root) {
        workspaceId = dirPath;
      }

      // CRITICAL: Mark any existing pending tag as reviewed
      // The unique index ensures only ONE can be pending-review at a time
      // When creating a new incremental-approval, the previous state (whether pre-edit or
      // previous incremental-approval) has been reviewed and accepted by the user
      await database.query(`
        UPDATE document_history
        SET metadata = jsonb_set(metadata, '{status}', to_jsonb('reviewed'::text))
        WHERE file_path = $1
          AND metadata->>'status' = 'pending-review'
      `, [filePath]);

      // Store as history entry with incremental-approval type and status = pending-review
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
        compressed,
        compressed.length,
        now,
        1,
        {
          type: 'incremental-approval',
          tagId,
          status: 'pending-review',
          sessionId,
          createdAt: now,
          updatedAt: now,
          ...metadata
        }
      ]);

      logger.main.info('[HistoryManager] Created incremental-approval tag:', { filePath, sessionId, tagId });
      return tagId;
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to create incremental-approval tag:', error);
      throw error;
    }
  }

  /**
   * Get the baseline content for diff comparison
   * With the unique constraint, there's only ONE pending tag per file.
   * It will be either a pre-edit tag or an incremental-approval tag.
   */
  async getDiffBaseline(filePath: string): Promise<{ content: string; tagType: 'pre-edit' | 'incremental-approval' } | null> {
    try {
      // SIMPLIFIED: With the unique constraint, there's only ONE pending tag per file
      // It will be either:
      // - A pre-edit tag (if no acceptances have happened yet)
      // - An incremental-approval tag (if user has accepted some changes)
      // Just return whichever one is pending
      const pendingTags = await this.getPendingTags(filePath);
      if (pendingTags.length === 0) {
        return null; // No AI session in progress
      }

      const pendingTag = pendingTags[0];
      return {
        content: pendingTag.content,
        tagType: pendingTag.type as 'pre-edit' | 'incremental-approval'
      };
    } catch (error) {
      logger.main.error('[HistoryManager] Failed to get diff baseline:', error);
      return null;
    }
  }
}

// Export singleton instance
export const historyManager = new HistoryManager();
