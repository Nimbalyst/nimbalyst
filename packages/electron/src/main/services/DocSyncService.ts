/**
 * DocSyncService
 *
 * Manages sync identity for markdown files. Each .md file that participates
 * in personal mobile sync has a `syncId` UUID stored in its YAML frontmatter.
 *
 * The syncId is used as the documentId in the DocumentRoom room ID:
 *   org:{personalOrgId}:doc:{syncId}
 *
 * This service handles:
 * - Reading syncId from a file's frontmatter
 * - Generating and writing a new syncId when one doesn't exist
 * - Providing personal sync config (encryption key, org, server URL) for the renderer
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { extractFrontmatter } from '../utils/frontmatterReader';
import { getSyncProvider } from './SyncManager';

// ============================================================================
// SyncId Management
// ============================================================================

/**
 * Read the syncId from a file's YAML frontmatter.
 * Returns null if the file has no frontmatter or no syncId field.
 */
export async function getSyncId(filePath: string): Promise<string | null> {
  const result = await extractFrontmatter(filePath);
  if (!result.data) return null;
  const syncId = result.data.syncId;
  if (typeof syncId === 'string' && syncId.length > 0) {
    return syncId;
  }
  return null;
}

/**
 * Ensure a file has a syncId in its frontmatter.
 * If one exists, returns it. If not, generates a UUID v4, writes it to
 * the frontmatter, and returns it.
 *
 * This modifies the file on disk when a new syncId is generated.
 */
export async function ensureSyncId(filePath: string): Promise<string> {
  // Try to read existing syncId first
  const existing = await getSyncId(filePath);
  if (existing) return existing;

  // Generate new syncId
  const syncId = randomUUID();

  // Read the full file content
  const content = await fs.readFile(filePath, 'utf-8');

  // Insert syncId into frontmatter
  const updated = insertSyncIdIntoContent(content, syncId);

  // Write back
  await fs.writeFile(filePath, updated, 'utf-8');
  // logger.main.info('[DocSyncService] Generated syncId for', path.basename(filePath), syncId);

  return syncId;
}

/**
 * Insert a syncId field into markdown content.
 * If the content has existing frontmatter, adds syncId as the first field.
 * If no frontmatter exists, creates a new frontmatter block with just syncId.
 */
function insertSyncIdIntoContent(content: string, syncId: string): string {
  const syncIdLine = `syncId: "${syncId}"`;

  // Check if content has frontmatter
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    // Find the closing ---
    const lineEnd = content.includes('\r\n') ? '\r\n' : '\n';
    const closingIndex = content.indexOf(`${lineEnd}---`, 4);
    if (closingIndex !== -1) {
      // Insert syncId as the first field after opening ---
      const openingEnd = content.indexOf(lineEnd) + lineEnd.length;
      return (
        content.slice(0, openingEnd) +
        syncIdLine + lineEnd +
        content.slice(openingEnd)
      );
    }
  }

  // No frontmatter -- create one
  const lineEnd = content.includes('\r\n') ? '\r\n' : '\n';
  return `---${lineEnd}${syncIdLine}${lineEnd}---${lineEnd}${content}`;
}

// ============================================================================
// File Index Push
// ============================================================================

/**
 * Push a file's metadata to the IndexRoom file index.
 * Called when a .md file is saved or modified in a sync-enabled project.
 *
 * @param filePath - Absolute path to the .md file
 * @param workspacePath - Absolute path to the workspace/project root
 */
export async function pushFileToIndex(filePath: string, workspacePath: string): Promise<void> {
  const provider = getSyncProvider();
  if (!provider?.syncFileToIndex) return;

  try {
    const syncId = await getSyncId(filePath);
    if (!syncId) return; // No syncId = not participating in sync

    const relativePath = path.relative(workspacePath, filePath);
    const title = path.basename(filePath, path.extname(filePath));
    const stat = await fs.stat(filePath);

    provider.syncFileToIndex({
      docId: syncId,
      projectId: workspacePath,
      relativePath,
      title,
      lastModifiedAt: stat.mtimeMs,
    });
  } catch (err) {
    logger.main.error('[DocSyncService] Failed to push file to index:', err);
  }
}

/**
 * Remove a file from the IndexRoom file index.
 * Called when a .md file is deleted.
 *
 * @param docId - The syncId of the deleted file
 */
export function removeFileFromIndex(docId: string): void {
  const provider = getSyncProvider();
  if (!provider?.deleteFileFromIndex) return;
  provider.deleteFileFromIndex(docId);
}
