/**
 * D1 Persistence Layer
 *
 * Handles saving and loading Y.Doc snapshots to/from Cloudflare D1 database.
 */

import type { YDocSnapshot, SessionMetadata, PersistenceConfig, MemoryConfig } from './types';

// Default persistence configuration
export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  snapshotIntervalMs: 5 * 60 * 1000, // 5 minutes
  snapshotSizeThreshold: 1024 * 1024, // 1MB
};

// Default memory management configuration
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxDocumentSizeBytes: 10 * 1024 * 1024, // 10MB max per document
  warnThresholdBytes: 5 * 1024 * 1024, // 5MB warning threshold
  evictionTimeoutMs: 5 * 60 * 1000, // 5 minutes idle before eviction
  enableLazyLoading: true, // Load on-demand by default
};

// D1/SQLite limits
// D1 has a maximum BLOB size of 2MB (2,000,000 bytes).
// This is MUCH smaller than standard SQLite's 1GB limit.
// See: https://developers.cloudflare.com/d1/platform/limits/
const MAX_D1_BLOB_SIZE = 2 * 1024 * 1024; // 2MB hard limit (D1 constraint)
const WARN_D1_BLOB_SIZE = 1.5 * 1024 * 1024; // 1.5MB warning threshold

/**
 * Compress data using gzip compression
 */
async function compressData(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const compressedBlob = await new Response(compressedStream).blob();
  return new Uint8Array(await compressedBlob.arrayBuffer());
}

/**
 * Decompress gzip-compressed data
 */
async function decompressData(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const decompressedBlob = await new Response(decompressedStream).blob();
  return new Uint8Array(await decompressedBlob.arrayBuffer());
}

/**
 * Load the latest snapshot for a document from D1
 */
export async function loadSnapshot(
  db: D1Database,
  documentId: string
): Promise<Uint8Array | null> {
  const result = await db
    .prepare(
      `
      SELECT state_vector, compressed
      FROM ydoc_snapshots
      WHERE id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `
    )
    .bind(documentId)
    .first<{ state_vector: ArrayBuffer; compressed: number }>();

  if (result?.state_vector) {
    const data = new Uint8Array(result.state_vector);

    // Decompress if needed (compressed flag = 1)
    if (result.compressed === 1) {
      return await decompressData(data);
    }

    return data;
  }

  return null;
}

/**
 * Save a snapshot to D1 (upsert)
 *
 * Automatically compresses large snapshots to fit within D1's 2MB BLOB limit.
 *
 * @throws Error if the state vector exceeds D1's BLOB size limits even after compression
 */
export async function saveSnapshot(
  db: D1Database,
  documentId: string,
  userId: string,
  sessionId: string,
  stateVector: Uint8Array
): Promise<void> {
  const originalSizeBytes = stateVector.length;
  const originalSizeMB = (originalSizeBytes / (1024 * 1024)).toFixed(2);

  console.log(`[PERSIST] saveSnapshot called for ${documentId}`);
  console.log(`[PERSIST] Original size: ${originalSizeBytes} bytes (${originalSizeMB}MB)`);
  console.log(`[PERSIST] D1 limit: ${MAX_D1_BLOB_SIZE} bytes (${(MAX_D1_BLOB_SIZE / (1024 * 1024)).toFixed(2)}MB)`);

  let dataToSave = stateVector;
  let compressed = 0;

  // Try compression if data is large or exceeds the limit
  if (originalSizeBytes > WARN_D1_BLOB_SIZE || originalSizeBytes > MAX_D1_BLOB_SIZE) {
    console.log(`[PERSIST] Attempting compression (threshold: ${WARN_D1_BLOB_SIZE} bytes)`);
    try {
      const compressedData = await compressData(stateVector);
      const compressedSizeBytes = compressedData.length;
      const compressedSizeMB = (compressedSizeBytes / (1024 * 1024)).toFixed(2);
      const compressionRatio = ((1 - compressedSizeBytes / originalSizeBytes) * 100).toFixed(1);

      console.log(
        `[PERSIST] Compressed snapshot for ${documentId}: ${originalSizeMB}MB → ${compressedSizeMB}MB (${compressionRatio}% reduction)`
      );

      // Use compressed data if it's smaller and fits
      if (compressedSizeBytes < originalSizeBytes && compressedSizeBytes <= MAX_D1_BLOB_SIZE) {
        dataToSave = compressedData;
        compressed = 1;
        console.log(`[PERSIST] Using compressed data`);
      } else {
        console.log(`[PERSIST] Compression didn't help enough, using original`);
      }
    } catch (compressionError) {
      console.warn(`[PERSIST] Compression failed for ${documentId}:`, compressionError);
      // Fall through to use uncompressed data
    }
  }

  const finalSizeBytes = dataToSave.length;
  const finalSizeMB = (finalSizeBytes / (1024 * 1024)).toFixed(2);

  console.log(`[PERSIST] Final size to save: ${finalSizeBytes} bytes (${finalSizeMB}MB), compressed: ${compressed}`);

  // Check if final data still exceeds D1 BLOB size limit
  if (finalSizeBytes > MAX_D1_BLOB_SIZE) {
    const errorMsg = `Cannot save snapshot for ${documentId}: size ${finalSizeMB}MB exceeds D1 BLOB limit of ${(MAX_D1_BLOB_SIZE / (1024 * 1024)).toFixed(0)}MB even after compression`;
    console.error(`[PERSIST] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Warn if approaching the limit
  if (finalSizeBytes > WARN_D1_BLOB_SIZE) {
    console.warn(
      `[PERSIST] Large snapshot for ${documentId}: ${finalSizeMB}MB (approaching D1 limit of ${(MAX_D1_BLOB_SIZE / (1024 * 1024)).toFixed(0)}MB)${compressed ? ' [compressed]' : ''}`
    );
  }

  const now = Date.now();

  console.log(`[PERSIST] Executing D1 INSERT/UPDATE query...`);
  try {
    await db
      .prepare(
        `
      INSERT INTO ydoc_snapshots (id, user_id, session_id, state_vector, compressed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state_vector = excluded.state_vector,
        compressed = excluded.compressed
        -- IMPORTANT: Do NOT update updated_at on conflict
        -- updated_at should only change when actual content changes (new messages, draft updates)
        -- not when Y.js persists its CRDT state for sync purposes
    `
      )
      .bind(documentId, userId, sessionId, dataToSave, compressed, now, now)
      .run();

    console.log(`[PERSIST] D1 query successful`);
  } catch (dbError) {
    console.error(`[PERSIST] D1 query failed:`, dbError);
    throw dbError;
  }

  // Update session metadata
  console.log(`[PERSIST] Updating session metadata...`);
  await updateSessionMetadata(db, sessionId, userId);
  console.log(`[PERSIST] saveSnapshot complete`);
}

/**
 * Update session metadata after sync activity
 */
async function updateSessionMetadata(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<void> {
  const now = Date.now();

  await db
    .prepare(
      `
      INSERT INTO session_metadata (session_id, user_id, created_at, last_synced_at, device_count, snapshot_count)
      VALUES (?, ?, ?, ?, 1, 1)
      ON CONFLICT(session_id) DO UPDATE SET
        last_synced_at = excluded.last_synced_at,
        snapshot_count = snapshot_count + 1
    `
    )
    .bind(sessionId, userId, now, now)
    .run();
}

/**
 * Delete a snapshot from D1
 */
export async function deleteSnapshot(
  db: D1Database,
  documentId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM ydoc_snapshots WHERE id = ?')
    .bind(documentId)
    .run();
}

/**
 * List sessions for a user
 */
export async function listUserSessions(
  db: D1Database,
  userId: string,
  limit = 100,
  offset = 0
): Promise<SessionMetadata[]> {
  const results = await db
    .prepare(
      `
      SELECT session_id, user_id, title, created_at, last_synced_at, device_count, snapshot_count
      FROM session_metadata
      WHERE user_id = ?
      ORDER BY last_synced_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .bind(userId, limit, offset)
    .all<SessionMetadata>();

  return results.results || [];
}

/**
 * Update session title
 */
export async function updateSessionTitle(
  db: D1Database,
  sessionId: string,
  title: string
): Promise<void> {
  await db
    .prepare('UPDATE session_metadata SET title = ? WHERE session_id = ?')
    .bind(title, sessionId)
    .run();
}

/**
 * Increment device count for a session
 */
export async function incrementDeviceCount(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE session_metadata SET device_count = device_count + 1 WHERE session_id = ?'
    )
    .bind(sessionId)
    .run();
}

/**
 * Decrement device count for a session
 */
export async function decrementDeviceCount(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE session_metadata SET device_count = MAX(device_count - 1, 0) WHERE session_id = ?'
    )
    .bind(sessionId)
    .run();
}

/**
 * Check if snapshot should be saved based on config
 */
export function shouldSnapshot(
  lastSnapshotTime: number,
  documentSizeBytes: number,
  config: PersistenceConfig = DEFAULT_PERSISTENCE_CONFIG
): boolean {
  const timeSinceSnapshot = Date.now() - lastSnapshotTime;

  return (
    timeSinceSnapshot >= config.snapshotIntervalMs ||
    documentSizeBytes >= config.snapshotSizeThreshold
  );
}
