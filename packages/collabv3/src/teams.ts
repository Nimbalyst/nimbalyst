/**
 * Team Management Endpoints
 *
 * REST API handlers for team CRUD operations. Each team maps to a Stytch B2B
 * Organization. Team metadata (name, git remote hash) and member roles are
 * stored in the org's TeamRoom Durable Object (isolated per-org SQLite).
 *
 * The Worker handles Stytch API calls (org creation, invites, member removal)
 * then forwards mutations to the TeamRoom DO via internal HTTP endpoints.
 * The DO broadcasts changes to all connected members via WebSocket.
 *
 * Cross-org queries (handleListTeams) use the Stytch B2B Discovery API.
 *
 * Stytch Management API calls use Basic auth with project_id:secret_key.
 */

import type { Env } from './types';
import type { AuthResult } from './auth';
import { teamRoomPost, teamRoomGet, requireAdminViaTeamRoom, getTeamRoomStub } from './teamRoomHelpers';
import { createLogger } from './logger';

const log = createLogger('teams');

// ============================================================================
// Stytch API Helpers
// ============================================================================

function getStytchApiBase(env: Env): string {
  const isTest = env.STYTCH_PROJECT_ID?.startsWith('project-test-');
  return isTest ? 'https://test.stytch.com/v1/b2b' : 'https://api.stytch.com/v1/b2b';
}

function getStytchAuth(env: Env): string {
  return `Basic ${btoa(`${env.STYTCH_PROJECT_ID}:${env.STYTCH_SECRET_KEY}`)}`;
}

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
// POST /api/teams - Create a new team (Stytch org + D1 metadata)
// ============================================================================

export async function handleCreateTeam(
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return errorResponse('Stytch not configured', 500, corsHeaders);
  }

  try {
    const body = await request.json() as { name: string; gitRemoteHash?: string };

    if (!body.name || !body.name.trim()) {
      return errorResponse('name is required', 400, corsHeaders);
    }

    const teamName = body.name.trim();
    const apiBase = getStytchApiBase(env);
    const stytchAuth = getStytchAuth(env);

    // Step 1: Create Stytch organization
    const slug = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const createOrgResponse = await fetch(`${apiBase}/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': stytchAuth,
      },
      body: JSON.stringify({
        organization_name: teamName,
        organization_slug: `${slug}-${Date.now().toString(36)}`,
        // Allow all auth methods so session exchange works regardless of how the user signed in
        // (magic_link, google_oauth, etc.). Without this, Stytch rejects session exchange with
        // "Unknown token type: multi_tenant_magic_links".
        auth_methods: 'ALL_ALLOWED',
        email_invites: 'ALL_ALLOWED',
      }),
    });

    if (!createOrgResponse.ok) {
      const errData = await createOrgResponse.json().catch(() => ({})) as { error_message?: string };
      log.error('Stytch org creation failed:', createOrgResponse.status, errData.error_message);
      return errorResponse(errData.error_message || 'Failed to create organization', createOrgResponse.status, corsHeaders);
    }

    const orgData = await createOrgResponse.json() as {
      organization?: { organization_id: string; organization_name: string };
    };

    const newOrgId = orgData.organization?.organization_id;
    if (!newOrgId) {
      return errorResponse('Failed to get organization ID from Stytch', 500, corsHeaders);
    }

    // Step 2: Add the creator as a member of the new org
    // We need their email - look it up from the current org's member record
    const memberLookupResponse = await fetch(`${apiBase}/organizations/members/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': stytchAuth,
      },
      body: JSON.stringify({
        organization_ids: [auth.orgId],
        limit: 1,
        query: {
          operator: 'AND',
          operands: [{ filter_name: 'member_ids', filter_value: [auth.userId] }],
        },
      }),
    });

    let creatorEmail = '';
    if (memberLookupResponse.ok) {
      const lookupData = await memberLookupResponse.json() as {
        members?: Array<{ email_address?: string }>;
      };
      creatorEmail = lookupData.members?.[0]?.email_address || '';
    }

    if (!creatorEmail) {
      // Clean up: delete the org we just created
      await fetch(`${apiBase}/organizations/${newOrgId}`, {
        method: 'DELETE',
        headers: { 'Authorization': stytchAuth },
      });
      return errorResponse('Could not determine creator email', 500, corsHeaders);
    }

    // Add creator to the new org
    const addMemberResponse = await fetch(`${apiBase}/organizations/${newOrgId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': stytchAuth,
      },
      body: JSON.stringify({
        email_address: creatorEmail,
      }),
    });

    if (!addMemberResponse.ok) {
      const errData = await addMemberResponse.json().catch(() => ({})) as { error_message?: string };
      log.error('Failed to add creator to new org:', errData.error_message);
      // Clean up: delete the org
      await fetch(`${apiBase}/organizations/${newOrgId}`, {
        method: 'DELETE',
        headers: { 'Authorization': stytchAuth },
      });
      return errorResponse('Failed to add creator to team', 500, corsHeaders);
    }

    const addMemberData = await addMemberResponse.json() as {
      member?: { member_id: string };
    };
    const newMemberId = addMemberData.member?.member_id || auth.userId;

    // Step 3: Store team metadata in TeamRoom DO
    await teamRoomPost(newOrgId, 'set-metadata', {
      orgId: newOrgId,
      name: teamName,
      gitRemoteHash: body.gitRemoteHash || null,
      createdBy: auth.userId,
    }, env);

    // Step 4: Set creator as admin in TeamRoom DO
    await teamRoomPost(newOrgId, 'add-member', {
      userId: newMemberId,
      role: 'admin',
      email: creatorEmail.toLowerCase(),
    }, env);

    // Step 5: Write to D1 org_discovery for cross-org git remote hash lookup
    // (This is the only D1 table -- everything else lives in the TeamRoom DO)
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO org_discovery (org_id, git_remote_hash, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (org_id) DO UPDATE SET git_remote_hash = excluded.git_remote_hash`
    ).bind(newOrgId, body.gitRemoteHash || null, now).run();

    log.info('Team created:', teamName, 'orgId:', newOrgId, 'by:', auth.userId);

    return jsonResponse({
      orgId: newOrgId,
      name: teamName,
      creatorMemberId: newMemberId,
    }, 201, corsHeaders);
  } catch (err) {
    log.error('Team creation error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// GET /api/teams - List teams the caller belongs to
// ============================================================================

export async function handleListTeams(
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return errorResponse('Stytch not configured', 500, corsHeaders);
  }

  try {
    log.info('listTeams called by userId:', auth.userId, 'orgId:', auth.orgId);

    // Extract the raw session JWT from the request to use with discovery endpoint.
    const authHeader = request.headers.get('Authorization');
    const sessionJwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!sessionJwt) {
      return errorResponse('Session JWT required for team discovery', 401, corsHeaders);
    }

    // Use Stytch B2B Discovery to find all orgs this user belongs to.
    // This endpoint takes a session_jwt and returns all discovered organizations
    // with membership type (active_member, pending_member, invited_member, etc.).
    const apiBase = getStytchApiBase(env);
    const stytchAuth = getStytchAuth(env);

    const discoveryResponse = await fetch(`${apiBase}/discovery/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': stytchAuth,
      },
      body: JSON.stringify({
        session_jwt: sessionJwt,
      }),
    });

    if (!discoveryResponse.ok) {
      const errBody = await discoveryResponse.text().catch(() => '');
      log.error('listTeams: Stytch discovery failed:', discoveryResponse.status, errBody);
      return errorResponse('Failed to discover organizations', 500, corsHeaders);
    }

    const discoveryData = await discoveryResponse.json() as {
      email_address?: string;
      discovered_organizations?: Array<{
        organization?: {
          organization_id: string;
          organization_name: string;
        };
        membership?: {
          type: string;
          member?: {
            member_id: string;
          };
        };
      }>;
    };

    const callerEmail = discoveryData.email_address || '';

    // Filter to team orgs only, exclude personal orgs.
    // Include active_member, pending_member, and invited_member so that
    // invited users see pending invites in the UI and can join directly.
    // We cannot use auth.orgId to identify the personal org because the JWT
    // may be scoped to a team org (e.g., after accepting an invite deep link).
    // Instead, filter by organization name -- personal orgs are named "Personal-<userId>".
    const allowedMembershipTypes = new Set(['active_member', 'pending_member', 'invited_member']);
    const teamOrgs = (discoveryData.discovered_organizations || [])
      .filter(d =>
        d.organization?.organization_id &&
        !d.organization.organization_name?.startsWith('Personal-') &&
        d.membership?.type &&
        allowedMembershipTypes.has(d.membership.type)
      );

    if (teamOrgs.length === 0) {
      log.info('listTeams result: 0 team(s) for email:', callerEmail);
      return jsonResponse({ teams: [] }, 200, corsHeaders);
    }

    // For each team org, query the TeamRoom DO for metadata and the caller's role
    const teams = await Promise.all(teamOrgs.map(async (d) => {
      const orgId = d.organization!.organization_id;
      const membershipType = d.membership?.type || 'active_member';
      const memberId = d.membership?.member?.member_id || '';
      try {
        const [metaResp, roleResp] = await Promise.all([
          teamRoomGet(orgId, 'get-metadata', env),
          teamRoomGet(orgId, 'get-member-role', env, { userId: memberId }),
        ]);

        // Skip orgs whose TeamRoom hasn't been initialized (stale Stytch orgs)
        if (!metaResp.ok) {
          log.debug('listTeams: skipping org with no TeamRoom metadata:', orgId);
          return null;
        }

        const meta = await metaResp.json() as { name: string; gitRemoteHash: string | null; createdAt: number };
        const roleData = roleResp.ok
          ? await roleResp.json() as { role: string }
          : null;

        return {
          orgId,
          name: meta.name || d.organization?.organization_name || 'Unknown Team',
          gitRemoteHash: meta.gitRemoteHash || null,
          createdAt: meta.createdAt ? new Date(meta.createdAt).toISOString() : '',
          role: roleData?.role || 'member',
          membershipType,
        };
      } catch (err) {
        log.warn('listTeams: failed to query TeamRoom for org:', orgId, err);
        return null;
      }
    }));

    const validTeams = teams.filter((t): t is NonNullable<typeof t> => t !== null);

    log.info('listTeams result:', validTeams.length, 'team(s) for email:', callerEmail);

    return jsonResponse({ teams: validTeams }, 200, corsHeaders);
  } catch (err) {
    log.error('List teams error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// GET /api/teams/{orgId}/members - List members with roles
// ============================================================================

export async function handleListMembers(
  orgId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return errorResponse('Stytch not configured', 500, corsHeaders);
  }

  try {
    // Verify caller is a member of this team via TeamRoom
    const callerRoleResp = await teamRoomGet(orgId, 'get-member-role', env, { userId: auth.userId });
    if (!callerRoleResp.ok) {
      return errorResponse('Not a member of this team', 403, corsHeaders);
    }
    const callerRoleData = await callerRoleResp.json() as { role: string };

    // Fetch members from Stytch (for display names, email, status)
    const apiBase = getStytchApiBase(env);
    const stytchAuth = getStytchAuth(env);

    const searchResponse = await fetch(`${apiBase}/organizations/members/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': stytchAuth,
      },
      body: JSON.stringify({
        organization_ids: [orgId],
        limit: 100,
      }),
    });

    if (!searchResponse.ok) {
      const errData = await searchResponse.json().catch(() => ({})) as { error_message?: string };
      log.error('Stytch member search failed:', errData.error_message);
      return errorResponse('Failed to fetch members', searchResponse.status, corsHeaders);
    }

    const searchData = await searchResponse.json() as {
      members?: Array<{
        member_id: string;
        email_address: string;
        name: string;
        status: string;
        created_at: string;
      }>;
    };

    // Fetch roles from TeamRoom
    const rolesResp = await teamRoomGet(orgId, 'list-members', env);
    const rolesData = await rolesResp.json() as { members: Array<{ userId: string; role: string }> };

    const roleMap = new Map<string, string>();
    for (const m of rolesData.members || []) {
      roleMap.set(m.userId, m.role);
    }

    const members = (searchData.members || []).map(m => ({
      memberId: m.member_id,
      email: m.email_address,
      name: m.name || '',
      status: m.status,
      role: roleMap.get(m.member_id) || 'member',
      createdAt: m.created_at,
    }));

    return jsonResponse({
      members,
      callerRole: callerRoleData.role,
      callerMemberId: auth.userId,
    }, 200, corsHeaders);
  } catch (err) {
    log.error('List members error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// POST /api/teams/{orgId}/invite - Invite a member by email
// ============================================================================

export async function handleInviteMember(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return errorResponse('Stytch not configured', 500, corsHeaders);
  }

  try {
    // Check caller is admin via TeamRoom
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { email: string };
    if (!body.email || !body.email.trim()) {
      return errorResponse('email is required', 400, corsHeaders);
    }

    const email = body.email.trim().toLowerCase();
    const apiBase = getStytchApiBase(env);
    const stytchAuth = getStytchAuth(env);

    // Send invite via Stytch magic link
    const inviteResponse = await fetch(`${apiBase}/magic_links/email/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': stytchAuth,
      },
      body: JSON.stringify({
        organization_id: orgId,
        email_address: email,
      }),
    });

    if (!inviteResponse.ok) {
      const errData = await inviteResponse.json().catch(() => ({})) as { error_message?: string };
      log.error('Stytch invite failed:', errData.error_message);
      return errorResponse(errData.error_message || 'Failed to send invite', inviteResponse.status, corsHeaders);
    }

    const inviteData = await inviteResponse.json() as {
      member?: { member_id: string };
    };

    // Add member to TeamRoom (default role: member)
    if (inviteData.member?.member_id) {
      await teamRoomPost(orgId, 'add-member', {
        userId: inviteData.member.member_id,
        role: 'member',
        email,
      }, env);
    }

    log.info('Invite sent:', email, 'to team:', orgId);

    return jsonResponse({ success: true, email }, 200, corsHeaders);
  } catch (err) {
    log.error('Invite member error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// DELETE /api/teams/{orgId}/members/{memberId} - Remove a member
// ============================================================================

export async function handleRemoveMember(
  orgId: string,
  memberId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return errorResponse('Stytch not configured', 500, corsHeaders);
  }

  try {
    // Check caller is admin via TeamRoom
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    // Don't allow removing yourself
    if (memberId === auth.userId) {
      return errorResponse('Cannot remove yourself. Use leave team instead.', 400, corsHeaders);
    }

    const apiBase = getStytchApiBase(env);
    const stytchAuth = getStytchAuth(env);

    // Remove from Stytch
    const deleteResponse = await fetch(`${apiBase}/organizations/${orgId}/members/${memberId}`, {
      method: 'DELETE',
      headers: { 'Authorization': stytchAuth },
    });

    if (!deleteResponse.ok) {
      const errData = await deleteResponse.json().catch(() => ({})) as { error_message?: string };
      log.error('Stytch member removal failed:', errData.error_message);
      return errorResponse(errData.error_message || 'Failed to remove member', deleteResponse.status, corsHeaders);
    }

    // Remove member from TeamRoom (also deletes their key envelope and identity key)
    await teamRoomPost(orgId, 'remove-member', { userId: memberId }, env);

    log.info('Member removed:', memberId, 'from team:', orgId);

    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Remove member error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// PUT /api/teams/{orgId}/members/{memberId} - Update member role
// ============================================================================

export async function handleUpdateMemberRole(
  orgId: string,
  memberId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Check caller is admin via TeamRoom
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { role: string };
    if (!body.role || !['admin', 'member'].includes(body.role)) {
      return errorResponse('role must be "admin" or "member"', 400, corsHeaders);
    }

    // Update role in TeamRoom (broadcasts to all connected members)
    await teamRoomPost(orgId, 'update-role', { userId: memberId, role: body.role }, env);

    log.info('Role updated:', memberId, '->', body.role, 'in team:', orgId);

    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Update role error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// PUT /api/teams/{orgId}/project-identity - Set git remote hash (admin only)
// ============================================================================

export async function handleSetProjectIdentity(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Check caller is admin via TeamRoom
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const body = await request.json() as { gitRemoteHash: string };
    if (!body.gitRemoteHash || !body.gitRemoteHash.trim()) {
      return errorResponse('gitRemoteHash is required', 400, corsHeaders);
    }

    const hash = body.gitRemoteHash.trim();

    // Update git remote hash in TeamRoom
    await teamRoomPost(orgId, 'set-metadata', { gitRemoteHash: hash }, env);

    // Update org_discovery for cross-org git remote hash lookup
    await env.DB.prepare(
      `INSERT INTO org_discovery (org_id, git_remote_hash, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (org_id) DO UPDATE SET git_remote_hash = excluded.git_remote_hash`
    ).bind(orgId, hash, new Date().toISOString()).run();

    log.info('Project identity set for team:', orgId);

    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Set project identity error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// DELETE /api/teams/{orgId}/project-identity - Clear project identity (admin only)
// ============================================================================

export async function handleClearProjectIdentity(
  orgId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Check caller is admin via TeamRoom
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    // Clear git remote hash in TeamRoom
    await teamRoomPost(orgId, 'set-metadata', { gitRemoteHash: null }, env);

    // Clear in org_discovery
    await env.DB.prepare(
      `UPDATE org_discovery SET git_remote_hash = NULL WHERE org_id = ?`
    ).bind(orgId).run();

    log.info('Project identity cleared for team:', orgId);

    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Clear project identity error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// DELETE /api/teams/{orgId} - Delete a team (admin only)
// ============================================================================

export async function handleDeleteTeam(
  orgId: string,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return errorResponse('Stytch not configured', 500, corsHeaders);
  }

  try {
    // Check caller is admin via TeamRoom
    const adminErr = await requireAdminViaTeamRoom(orgId, auth.userId, env);
    if (adminErr) return errorResponse(adminErr, 403, corsHeaders);

    const apiBase = getStytchApiBase(env);
    const stytchAuth = getStytchAuth(env);

    // Step 1: Delete the Stytch organization
    const deleteOrgResponse = await fetch(`${apiBase}/organizations/${orgId}`, {
      method: 'DELETE',
      headers: { 'Authorization': stytchAuth },
    });

    if (!deleteOrgResponse.ok) {
      const errData = await deleteOrgResponse.json().catch(() => ({})) as { error_message?: string };
      log.error('Stytch org deletion failed:', errData.error_message);
      return errorResponse(errData.error_message || 'Failed to delete team from Stytch', deleteOrgResponse.status, corsHeaders);
    }

    // Step 2: Clear D1 org_discovery row
    await env.DB.prepare(
      `DELETE FROM org_discovery WHERE org_id = ?`
    ).bind(orgId).run();

    // Step 3: Nuke the TeamRoom DO state (reuse the delete-account path)
    const stub = getTeamRoomStub(orgId, env);
    const roomId = `org:${orgId}:team`;
    await stub.fetch(new Request(`http://internal/sync/${roomId}/delete-account`, {
      method: 'DELETE',
    }));

    log.info('Team deleted:', orgId, 'by:', auth.userId);

    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (err) {
    log.error('Delete team error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}

// ============================================================================
// POST /api/teams/{orgId}/switch - Switch session to a different org
// ============================================================================

export async function handleOrgSwitch(
  orgId: string,
  request: Request,
  auth: AuthResult,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!env.STYTCH_PROJECT_ID || !env.STYTCH_SECRET_KEY) {
    return errorResponse('Stytch not configured', 500, corsHeaders);
  }

  try {
    const body = await request.json() as { sessionToken: string };
    if (!body.sessionToken) {
      return errorResponse('sessionToken is required', 400, corsHeaders);
    }

    const apiBase = getStytchApiBase(env);
    const stytchAuth = getStytchAuth(env);

    // Exchange session for the target org
    const exchangeResponse = await fetch(`${apiBase}/sessions/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': stytchAuth,
      },
      body: JSON.stringify({
        session_token: body.sessionToken,
        organization_id: orgId,
        session_duration_minutes: 60 * 24 * 7, // 1 week
      }),
    });

    if (!exchangeResponse.ok) {
      const errData = await exchangeResponse.json().catch(() => ({})) as { error_message?: string };
      log.error('Session exchange failed:', errData.error_message);
      return errorResponse(errData.error_message || 'Failed to switch organization', exchangeResponse.status, corsHeaders);
    }

    const exchangeData = await exchangeResponse.json() as {
      member?: { member_id: string; email_address?: string };
      member_session?: { expires_at: string };
      organization?: { organization_id: string };
      session_token?: string;
      session_jwt?: string;
    };

    return jsonResponse({
      sessionToken: exchangeData.session_token || '',
      sessionJwt: exchangeData.session_jwt || '',
      userId: exchangeData.member?.member_id || '',
      email: exchangeData.member?.email_address || '',
      expiresAt: exchangeData.member_session?.expires_at || '',
      orgId: exchangeData.organization?.organization_id || '',
    }, 200, corsHeaders);
  } catch (err) {
    log.error('Org switch error:', err);
    return errorResponse('Internal server error', 500, corsHeaders);
  }
}
