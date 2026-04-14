/**
 * Team Key Envelope Endpoints
 *
 * REST API handlers for org-level ECDH key envelope management.
 * Key envelopes contain wrapped (encrypted) org encryption keys.
 * An admin wraps the org key using ECDH with each member's public key,
 * then uploads the envelope. Members fetch their own envelope and unwrap
 * with their private key.
 *
 * Envelopes are stored in the TeamRoom Durable Object (per-org SQLite).
 * REST endpoints forward to TeamRoom internal HTTP endpoints.
 */

import type { Env } from './types';
import type { AuthResult } from './auth';
import { teamRoomPost, teamRoomGet, requireAdminViaTeamRoom, requireMemberViaTeamRoom, getTeamRoomStub } from './teamRoomHelpers';
import { createLogger } from './logger';
import { validateP256PublicKey } from './validatePublicKey';

const log = createLogger('teamKeyEnvelopes');

// ============================================================================
// Helpers
// ============================================================================

function jsonHeaders(corsHeaders: Record<string, string>): Record<string, string> {
  return { ...corsHeaders, 'Content-Type': 'application/json' };
}

function jsonResponse(data: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders(corsHeaders) });
}

function errorResponse(error: string, status: number, corsHeaders: Record<string, string>): Response {
  return jsonResponse({ error }, status, corsHeaders);
}

// ============================================================================
// POST /api/teams/{orgId}/key-envelopes -- Upload a wrapped org key for a member
// ============================================================================

export async function handleUploadKeyEnvelope(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as {
      targetUserId: string;
      wrappedKey: string;
      iv: string;
      senderPublicKey: string;
    };

    if (!body.targetUserId || !body.wrappedKey || !body.iv || !body.senderPublicKey) {
      return errorResponse('targetUserId, wrappedKey, iv, and senderPublicKey are required', 400, corsHeaders);
    }

    // Validate senderPublicKey is a well-formed P-256 public key
    const keyError = validateP256PublicKey(body.senderPublicKey);
    if (keyError) {
      return errorResponse(`Invalid senderPublicKey: ${keyError}`, 400, corsHeaders);
    }

    // Upload to TeamRoom (also pushes notification to target user if connected)
    await teamRoomPost(orgId, 'upload-envelope', {
      targetUserId: body.targetUserId,
      senderUserId: auth.userId,
      wrappedKey: body.wrappedKey,
      iv: body.iv,
      senderPublicKey: body.senderPublicKey,
    }, env);

    log.info('Key envelope uploaded for user:', body.targetUserId, 'in team:', orgId);
    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Upload key envelope error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// GET /api/teams/{orgId}/key-envelope -- Get caller's own key envelope
// ============================================================================

export async function handleGetOwnKeyEnvelope(
  orgId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const memberErr = await requireMemberViaTeamRoom(orgId, auth.userId, env);
    if (memberErr) return errorResponse(memberErr, 403, corsHeaders);

    const resp = await teamRoomGet(orgId, 'get-key-envelope', env, { userId: auth.userId });
    if (!resp.ok) {
      return errorResponse('No key envelope found', 404, corsHeaders);
    }

    const data = await resp.json() as {
      wrappedKey: string;
      iv: string;
      senderPublicKey: string;
      createdAt: number;
    };

    return jsonResponse(data, 200, corsHeaders);
  } catch (err) {
    log.error('Get own key envelope error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// GET /api/teams/{orgId}/key-envelopes -- List all envelopes (admin, for rotation)
// ============================================================================

export async function handleListKeyEnvelopes(
  orgId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const resp = await teamRoomGet(orgId, 'list-key-envelopes', env);
    const data = await resp.json() as { envelopes: Array<{ targetUserId: string; createdAt: number }> };

    return jsonResponse(data, 200, corsHeaders);
  } catch (err) {
    log.error('List key envelopes error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// DELETE /api/teams/{orgId}/key-envelopes/{userId} -- Delete envelope (admin)
// ============================================================================

export async function handleDeleteKeyEnvelope(
  orgId: string,
  targetUserId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    await teamRoomPost(orgId, 'delete-envelope', { targetUserId }, env);

    log.info('Key envelope deleted for user:', targetUserId, 'in team:', orgId);
    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Delete key envelope error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// DELETE /api/teams/{orgId}/key-envelopes -- Delete ALL envelopes (admin, for rotation)
// ============================================================================

export async function handleDeleteAllKeyEnvelopes(
  orgId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    await teamRoomPost(orgId, 'delete-all-envelopes', {}, env);

    log.info('All key envelopes deleted for team:', orgId);
    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Delete all key envelopes error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// PUT /api/teams/{orgId}/org-key-fingerprint -- Set current org key fingerprint (admin)
// ============================================================================

export async function handleSetOrgKeyFingerprint(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { fingerprint: string };
    if (!body.fingerprint) {
      return errorResponse('fingerprint is required', 400, corsHeaders);
    }

    await teamRoomPost(orgId, 'set-org-key-fingerprint', { fingerprint: body.fingerprint }, env);

    log.info('Org key fingerprint set for team:', orgId);
    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Set org key fingerprint error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// GET /api/teams/{orgId}/org-key-fingerprint -- Get current org key fingerprint
// ============================================================================

export async function handleGetOrgKeyFingerprint(
  orgId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const memberErr = await requireMemberViaTeamRoom(orgId, auth.userId, env);
    if (memberErr) return errorResponse(memberErr, 403, corsHeaders);

    const resp = await teamRoomGet(orgId, 'get-org-key-fingerprint', env);
    const data = await resp.json() as { fingerprint: string | null };

    return jsonResponse(data, 200, corsHeaders);
  } catch (err) {
    log.error('Get org key fingerprint error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// POST /api/teams/{orgId}/rotation-lock -- Set or clear write barrier on all rooms
// ============================================================================

export async function handleRotationLock(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { locked: boolean };
    if (typeof body.locked !== 'boolean') {
      return errorResponse('"locked" (boolean) required', 400, corsHeaders);
    }

    // Get document IDs and team metadata from TeamRoom
    const listResp = await teamRoomGet(orgId, 'list-document-ids', env);
    const listData = await listResp.json() as { documentIds: string[]; orgId: string | null; gitRemoteHash: string | null };
    const teamOrgId = listData.orgId ?? orgId;
    const documentIds = listData.documentIds ?? [];

    const lockBody = JSON.stringify({ locked: body.locked });
    const headers = { 'Content-Type': 'application/json' };
    const failures: string[] = [];

    // Set rotation lock on all document rooms
    for (const docId of documentIds) {
      try {
        const roomId = `org:${teamOrgId}:doc:${docId}`;
        const doId = env.DOCUMENT_ROOM.idFromName(roomId);
        const doStub = env.DOCUMENT_ROOM.get(doId);
        const url = `http://internal/sync/${roomId}/internal/set-rotation-lock`;
        const resp = await doStub.fetch(new Request(url, { method: 'POST', headers, body: lockBody }));
        if (!resp.ok) failures.push(`doc:${docId} (HTTP ${resp.status})`);
      } catch (err) {
        failures.push(`doc:${docId} (${err})`);
      }
    }

    // Set rotation lock on tracker room (project ID = git remote hash)
    if (listData.gitRemoteHash) {
      try {
        const roomId = `org:${teamOrgId}:tracker:${listData.gitRemoteHash}`;
        const doId = env.TRACKER_ROOM.idFromName(roomId);
        const doStub = env.TRACKER_ROOM.get(doId);
        const url = `http://internal/sync/${roomId}/internal/set-rotation-lock`;
        const resp = await doStub.fetch(new Request(url, { method: 'POST', headers, body: lockBody }));
        if (!resp.ok) failures.push(`tracker (HTTP ${resp.status})`);
      } catch (err) {
        failures.push(`tracker (${err})`);
      }
    }

    if (failures.length > 0) {
      log.error(`Rotation lock failed on ${failures.length} room(s):`, failures);
      return errorResponse(`Lock failed on: ${failures.join(', ')}`, 500, corsHeaders);
    }

    log.info(`Rotation lock ${body.locked ? 'set' : 'cleared'} on ${documentIds.length} doc room(s) + tracker room`);
    return jsonResponse({ success: true, documentsLocked: documentIds.length }, 200, corsHeaders);
  } catch (err) {
    log.error('Rotation lock error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// POST /api/teams/{orgId}/propagate-fingerprint -- Set fingerprint on doc/tracker rooms
// ============================================================================

export async function handlePropagateFingerprint(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { fingerprint: string };
    if (!body.fingerprint) {
      return errorResponse('"fingerprint" required', 400, corsHeaders);
    }

    // Get document IDs and team metadata from TeamRoom
    const listResp = await teamRoomGet(orgId, 'list-document-ids', env);
    const listData = await listResp.json() as { documentIds: string[]; orgId: string | null; gitRemoteHash: string | null };
    const teamOrgId = listData.orgId ?? orgId;
    const documentIds = listData.documentIds ?? [];

    const fpBody = JSON.stringify({ fingerprint: body.fingerprint });
    const headers = { 'Content-Type': 'application/json' };
    const failures: string[] = [];

    // Set fingerprint on all document rooms
    for (const docId of documentIds) {
      try {
        const roomId = `org:${teamOrgId}:doc:${docId}`;
        const doId = env.DOCUMENT_ROOM.idFromName(roomId);
        const doStub = env.DOCUMENT_ROOM.get(doId);
        const url = `http://internal/sync/${roomId}/internal/set-org-key-fingerprint`;
        const resp = await doStub.fetch(new Request(url, { method: 'POST', headers, body: fpBody }));
        if (!resp.ok) failures.push(`doc:${docId} (HTTP ${resp.status})`);
      } catch (err) {
        failures.push(`doc:${docId} (${err})`);
      }
    }

    // Set fingerprint on tracker room
    if (listData.gitRemoteHash) {
      try {
        const roomId = `org:${teamOrgId}:tracker:${listData.gitRemoteHash}`;
        const doId = env.TRACKER_ROOM.idFromName(roomId);
        const doStub = env.TRACKER_ROOM.get(doId);
        const url = `http://internal/sync/${roomId}/internal/set-org-key-fingerprint`;
        const resp = await doStub.fetch(new Request(url, { method: 'POST', headers, body: fpBody }));
        if (!resp.ok) failures.push(`tracker (HTTP ${resp.status})`);
      } catch (err) {
        failures.push(`tracker (${err})`);
      }
    }

    if (failures.length > 0) {
      log.error(`Fingerprint propagation failed on ${failures.length} room(s):`, failures);
      return errorResponse(`Propagation failed on: ${failures.join(', ')}`, 500, corsHeaders);
    }

    log.info(`Fingerprint propagated to ${documentIds.length} doc room(s) + tracker room`);
    return jsonResponse({ success: true, documentsUpdated: documentIds.length }, 200, corsHeaders);
  } catch (err) {
    log.error('Propagate fingerprint error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// POST /api/teams/{orgId}/truncate-tracker-changelog -- Truncate old changelog
// ============================================================================

export async function handleTruncateTrackerChangelog(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { projectId: string };
    if (!body.projectId) {
      return errorResponse('"projectId" required', 400, corsHeaders);
    }

    // Get team org ID from metadata
    const listResp = await teamRoomGet(orgId, 'list-document-ids', env);
    const listData = await listResp.json() as { orgId: string | null };
    const teamOrgId = listData.orgId ?? orgId;

    const roomId = `org:${teamOrgId}:tracker:${body.projectId}`;
    const doId = env.TRACKER_ROOM.idFromName(roomId);
    const doStub = env.TRACKER_ROOM.get(doId);
    const url = `http://internal/sync/${roomId}/internal/truncate-changelog`;
    const truncResp = await doStub.fetch(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }));

    const result = await truncResp.json() as { success: boolean; entriesTruncated?: number };
    log.info(`Tracker changelog truncated: ${result.entriesTruncated ?? 0} entries`);
    return jsonResponse(result, 200, corsHeaders);
  } catch (err) {
    log.error('Truncate tracker changelog error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// POST /api/teams/{orgId}/rotation-compact-doc -- Upload re-encrypted doc snapshot
// ============================================================================

export async function handleRotationCompactDoc(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { documentId: string; encryptedState: string; iv: string; replacesUpTo: number };
    if (!body.documentId || !body.encryptedState || !body.iv || body.replacesUpTo == null) {
      return errorResponse('documentId, encryptedState, iv, replacesUpTo required', 400, corsHeaders);
    }

    const listResp = await teamRoomGet(orgId, 'list-document-ids', env);
    const listData = await listResp.json() as { orgId: string | null };
    const teamOrgId = listData.orgId ?? orgId;

    const roomId = `org:${teamOrgId}:doc:${body.documentId}`;
    const doId = env.DOCUMENT_ROOM.idFromName(roomId);
    const stub = env.DOCUMENT_ROOM.get(doId);
    const url = `http://internal/sync/${roomId}/internal/rotation-compact`;
    const resp = await stub.fetch(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptedState: body.encryptedState, iv: body.iv, replacesUpTo: body.replacesUpTo }),
    }));

    if (!resp.ok) {
      const errData = await resp.text();
      return errorResponse(`Compact failed: ${errData}`, resp.status, corsHeaders);
    }

    return jsonResponse(await resp.json(), 200, corsHeaders);
  } catch (err) {
    log.error('Rotation compact doc error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// POST /api/teams/{orgId}/rotation-batch-upsert-tracker -- Upload re-encrypted tracker items
// ============================================================================

export async function handleRotationBatchUpsertTracker(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { projectId: string; items: unknown[] };
    if (!body.projectId || !body.items) {
      return errorResponse('projectId and items required', 400, corsHeaders);
    }

    const listResp = await teamRoomGet(orgId, 'list-document-ids', env);
    const listData = await listResp.json() as { orgId: string | null };
    const teamOrgId = listData.orgId ?? orgId;

    const roomId = `org:${teamOrgId}:tracker:${body.projectId}`;
    const doId = env.TRACKER_ROOM.idFromName(roomId);
    const stub = env.TRACKER_ROOM.get(doId);
    const url = `http://internal/sync/${roomId}/internal/rotation-batch-upsert`;
    const resp = await stub.fetch(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: body.items }),
    }));

    if (!resp.ok) {
      const errData = await resp.text();
      return errorResponse(`Batch upsert failed: ${errData}`, resp.status, corsHeaders);
    }

    return jsonResponse(await resp.json(), 200, corsHeaders);
  } catch (err) {
    log.error('Rotation batch upsert tracker error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}
