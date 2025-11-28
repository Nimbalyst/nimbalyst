/**
 * D1 Persistence Layer
 *
 * Handles saving and loading Y.Doc snapshots to/from Cloudflare D1 database.
 */

import type { YDocSnapshot, SessionMetadata, PersistenceConfig } from './types';

// Default persistence configuration
export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  snapshotIntervalMs: 5 * 60 * 1000, // 5 minutes
  snapshotSizeThreshold: 1024 * 1024, // 1MB
};

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
      SELECT state_vector
      FROM ydoc_snapshots
      WHERE id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `
    )
    .bind(documentId)
    .first<{ state_vector: ArrayBuffer }>();

  if (result?.state_vector) {
    return new Uint8Array(result.state_vector);
  }

  return null;
}

/**
 * Save a snapshot to D1 (upsert)
 */
export async function saveSnapshot(
  db: D1Database,
  documentId: string,
  userId: string,
  sessionId: string,
  stateVector: Uint8Array
): Promise<void> {
  const now = Date.now();

  await db
    .prepare(
      `
      INSERT INTO ydoc_snapshots (id, user_id, session_id, state_vector, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state_vector = excluded.state_vector,
        updated_at = excluded.updated_at
    `
    )
    .bind(documentId, userId, sessionId, stateVector, now, now)
    .run();

  // Update session metadata
  await updateSessionMetadata(db, sessionId, userId);
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
