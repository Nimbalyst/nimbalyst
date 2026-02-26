/**
 * TeamRoom DO Helper Functions
 *
 * Utilities for REST handlers to forward mutations and queries to the
 * TeamRoom Durable Object. Extracted to avoid circular imports between
 * index.ts and teams.ts/teamKeyEnvelopes.ts.
 */

import type { Env } from './types';

/**
 * Get a TeamRoom DO stub for a given org ID.
 * The room ID format is `org:{orgId}:team`, matching the WebSocket routing.
 */
export function getTeamRoomStub(orgId: string, env: Env): DurableObjectStub {
  const roomId = `org:${orgId}:team`;
  const id = env.TEAM_ROOM.idFromName(roomId);
  return env.TEAM_ROOM.get(id);
}

/**
 * Forward an internal POST mutation to the TeamRoom DO.
 * Used by REST handlers (teams.ts, teamKeyEnvelopes.ts) after Stytch API calls.
 */
export async function teamRoomPost(
  orgId: string,
  internalPath: string,
  body: Record<string, unknown>,
  env: Env
): Promise<Response> {
  const stub = getTeamRoomStub(orgId, env);
  const roomId = `org:${orgId}:team`;
  const url = `http://internal/sync/${roomId}/internal/${internalPath}`;
  return stub.fetch(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

/**
 * Forward an internal GET query to the TeamRoom DO.
 * Used by REST handlers to check roles, fetch envelopes, etc.
 */
export async function teamRoomGet(
  orgId: string,
  internalPath: string,
  env: Env,
  params?: Record<string, string>
): Promise<Response> {
  const stub = getTeamRoomStub(orgId, env);
  const roomId = `org:${orgId}:team`;
  const url = new URL(`http://internal/sync/${roomId}/internal/${internalPath}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return stub.fetch(new Request(url.toString(), { method: 'GET' }));
}

/**
 * Check if a user has admin role in the TeamRoom.
 * Returns null if admin, or error message string if not.
 */
export async function requireAdminViaTeamRoom(
  orgId: string,
  userId: string,
  env: Env
): Promise<string | null> {
  const resp = await teamRoomGet(orgId, 'get-member-role', env, { userId });
  if (!resp.ok) return 'Not a member of this team';
  const data = await resp.json() as { role: string };
  if (data.role !== 'admin') return 'Only admins can perform this action';
  return null;
}

/**
 * Check if a user is a member of the team (any role).
 * Returns null if member, or error message string if not.
 */
export async function requireMemberViaTeamRoom(
  orgId: string,
  userId: string,
  env: Env
): Promise<string | null> {
  const resp = await teamRoomGet(orgId, 'get-member-role', env, { userId });
  if (!resp.ok) return 'Not a member of this team';
  return null;
}
