/**
 * KimiClaw Session Sync
 *
 * Syncs KCS swarm sessions into Nimbalyst's ai_sessions / ai_transcript_events tables.
 * Maps KCS swarm -> nimbalyst session, KCS agent events -> transcript events.
 */

import { query } from '../../../runtime/storage/db';
import type { KimiClawSwarmRecord } from './KimiClawSessionScanner';

export interface KimiClawSyncResult {
  imported: number;
  errors: number;
  sessionIds: string[];
}

/**
 * Import a KCS swarm as a nimbalyst session.
 */
export async function importKimiClawSwarm(
  workspacePath: string,
  swarm: KimiClawSwarmRecord,
): Promise<{ sessionId: string } | null> {
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO ai_sessions (provider, workspace_path, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING id`,
      ['kimiclaw', workspacePath, swarm.task, swarm.created_at],
    );

    const sessionId = result.rows[0].id;

    // Insert transcript events for the swarm
    await query(
      `INSERT INTO ai_transcript_events (session_id, event_type, payload, created_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, 'assistant_message', JSON.stringify({ text: swarm.deliverable || '[No deliverable]' }), swarm.created_at],
    );

    return { sessionId };
  } catch (error) {
    console.error('[KIMICLAW-SYNC] Failed to import swarm:', error);
    return null;
  }
}

/**
 * Sync all scanned KCS swarms.
 */
export async function syncKimiClawSessions(
  workspacePath: string,
  swarms: KimiClawSwarmRecord[],
): Promise<KimiClawSyncResult> {
  const result: KimiClawSyncResult = { imported: 0, errors: 0, sessionIds: [] };

  for (const swarm of swarms) {
    const imported = await importKimiClawSwarm(workspacePath, swarm);
    if (imported) {
      result.imported++;
      result.sessionIds.push(imported.sessionId);
    } else {
      result.errors++;
    }
  }

  return result;
}
