/**
 * Account Deletion Handler
 *
 * Implements the server-side cascade for deleting a user's account and all
 * associated data. Required for Apple App Store compliance (guideline 5.1.1).
 *
 * Deletion order:
 * 1. Get session list from PersonalIndexRoom DO
 * 2. Delete each PersonalSessionRoom DO's data
 * 3. Delete PersonalIndexRoom DO's data (sessions, projects, devices, push tokens)
 * 4. Delete D1 shared_sessions rows and R2 share objects
 * 5. Delete Stytch B2B member (last - invalidates the JWT)
 */

import type { Env } from './types';
import type { AuthResult } from './auth';
import { createLogger } from './logger';

const log = createLogger('accountDeletion');

interface DeletionResult {
  sessionsDeleted: number;
  sharesDeleted: number;
  stytchMemberDeleted: boolean;
}

/**
 * Handle account deletion request.
 * Cascades deletes across all storage layers, then deletes the Stytch member.
 */
export async function handleAccountDeletion(
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  log.info('Account deletion started for user:', auth.userId, 'org:', auth.orgId);

  try {
    const result: DeletionResult = {
      sessionsDeleted: 0,
      sharesDeleted: 0,
      stytchMemberDeleted: false,
    };

    // Step 1: Get session list from PersonalIndexRoom and purge it
    let sessionIds: string[] = [];
    try {
      const indexId = env.INDEX_ROOM.idFromName(`user:${auth.userId}:index`);
      const indexStub = env.INDEX_ROOM.get(indexId);

      const indexResponse = await indexStub.fetch(
        new Request('https://internal/delete-account', { method: 'DELETE' })
      );

      if (indexResponse.ok) {
        const data = await indexResponse.json() as { sessionIds?: string[] };
        sessionIds = data.sessionIds ?? [];
        log.info('PersonalIndexRoom purged, found', sessionIds.length, 'sessions to clean up');
      } else {
        log.warn('PersonalIndexRoom deletion returned', indexResponse.status);
      }
    } catch (err) {
      log.error('PersonalIndexRoom deletion failed (continuing):', err);
    }

    // Step 2: Delete each PersonalSessionRoom's data
    for (const sessionId of sessionIds) {
      try {
        const roomId = `org:${auth.orgId}:user:${auth.userId}:session:${sessionId}`;
        const sessionRoomId = env.SESSION_ROOM.idFromName(roomId);
        const sessionStub = env.SESSION_ROOM.get(sessionRoomId);

        const sessionResponse = await sessionStub.fetch(
          new Request('https://internal/delete-account', { method: 'DELETE' })
        );

        if (sessionResponse.ok) {
          result.sessionsDeleted++;
        } else {
          log.warn('PersonalSessionRoom deletion failed for', sessionId, ':', sessionResponse.status);
        }
      } catch (err) {
        log.error('PersonalSessionRoom deletion failed for', sessionId, '(continuing):', err);
      }
    }
    log.info('Deleted', result.sessionsDeleted, '/', sessionIds.length, 'PersonalSessionRooms');

    // Step 3: Delete D1 shared_sessions and R2 objects
    try {
      // Get all shares for this user (including soft-deleted ones)
      const sharesResult = await env.DB.prepare(
        `SELECT id, r2_key FROM shared_sessions WHERE user_id = ?`
      ).bind(auth.userId).all();

      const shares = sharesResult.results || [];

      // Delete R2 objects
      for (const share of shares) {
        try {
          const r2Key = (share as { r2_key: string }).r2_key;
          if (r2Key) {
            await env.SESSION_SHARES.delete(r2Key);
          }
        } catch (err) {
          log.error('R2 deletion failed for share (continuing):', err);
        }
      }

      // Delete all D1 rows for this user (hard delete, not soft delete)
      await env.DB.prepare(
        `DELETE FROM shared_sessions WHERE user_id = ?`
      ).bind(auth.userId).run();

      result.sharesDeleted = shares.length;
      log.info('Deleted', shares.length, 'shares from D1/R2');
    } catch (err) {
      log.error('Share deletion failed (continuing):', err);
    }

    // Step 4: Delete Stytch B2B member (LAST - invalidates JWT)
    if (env.STYTCH_PROJECT_ID && env.STYTCH_SECRET_KEY) {
      try {
        const isTest = env.STYTCH_PROJECT_ID.startsWith('project-test-');
        const apiBase = isTest ? 'https://test.stytch.com' : 'https://api.stytch.com';

        const stytchResponse = await fetch(
          `${apiBase}/v1/b2b/organizations/${auth.orgId}/members/${auth.userId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`,
            },
          }
        );

        if (stytchResponse.ok) {
          result.stytchMemberDeleted = true;
          log.info('Stytch member deleted:', auth.userId);
        } else {
          const errData = await stytchResponse.json().catch(() => ({})) as { error_message?: string };
          log.error('Stytch member deletion failed:', stytchResponse.status, errData.error_message);
          // Don't fail the overall deletion if Stytch fails - data is already gone
        }
      } catch (err) {
        log.error('Stytch member deletion error (continuing):', err);
      }
    } else {
      log.warn('Stytch not configured, skipping member deletion');
    }

    log.info('Account deletion completed for user:', auth.userId, result);

    return new Response(
      JSON.stringify({
        deleted: true,
        sessionsDeleted: result.sessionsDeleted,
        sharesDeleted: result.sharesDeleted,
        stytchMemberDeleted: result.stytchMemberDeleted,
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err) {
    log.error('Account deletion failed:', err);
    return new Response(
      JSON.stringify({ error: 'Account deletion failed' }),
      { status: 500, headers: jsonHeaders }
    );
  }
}
