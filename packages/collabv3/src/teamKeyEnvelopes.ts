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
import { teamRoomPost, teamRoomGet, requireAdminViaTeamRoom, requireMemberViaTeamRoom } from './teamRoomHelpers';
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
