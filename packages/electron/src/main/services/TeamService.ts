/**
 * TeamService - Manages team CRUD operations via collabv3 REST API.
 *
 * Architecture: Per-workspace org context. The user's personal org (global auth)
 * is NEVER replaced. Team operations use org-scoped JWTs obtained via Stytch
 * session exchange, cached per-org with TTL. Different projects can use different
 * orgs simultaneously.
 *
 * This service handles:
 * - Creating teams (new Stytch orgs + D1 metadata)
 * - Listing team members with roles
 * - Inviting/removing members
 * - Per-org JWT caching via session exchange
 * - Git remote detection for workspace identity
 *
 * Follows the TrackerSyncManager pattern:
 * - Module-level functions (no class)
 * - safeHandle() for IPC registration
 * - REST calls with JWT auth to collabv3
 */

import { net } from 'electron';
import { createHash } from 'crypto';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { getNormalizedGitRemote } from '../utils/gitUtils';
import { getSessionSyncConfig } from '../utils/store';
import {
  getAccounts,
  getSessionJwt,
  getSessionJwtForAccount,
  getSessionToken,
  getSessionTokenForAccount,
  isAuthenticated,
  refreshSession,
  refreshSessionForAccount,
  onAuthStateChange,
  updateSessionToken,
} from './StytchAuthService';
import {
  getOrCreateIdentityKeyPair,
  uploadIdentityKeyToOrg,
  generateAndStoreOrgKey,
  wrapOrgKeyForMember,
  uploadEnvelope,
  exportPublicKeyJwk,
  fetchMemberPublicKey,
  deleteEnvelope,
  deleteAllEnvelopes,
  fetchAllEnvelopes,
  hasOrgKey,
  fetchAndUnwrapOrgKey,
  fetchOwnEnvelope,
} from './OrgKeyService';

// ============================================================================
// Server URL Helper
// ============================================================================

const PRODUCTION_COLLAB_URL = 'https://sync.nimbalyst.com';
const DEVELOPMENT_COLLAB_URL = 'http://localhost:8790';

/**
 * Derive the collab server HTTP URL from environment.
 * Unlike SyncManager, this does NOT require sync to be enabled --
 * team operations should work as long as the user is authenticated.
 */
function getCollabServerUrl(): string {
  const config = getSessionSyncConfig();
  const isDev = process.env.NODE_ENV !== 'production';
  const env = isDev ? config?.environment : undefined;
  return env === 'development' ? DEVELOPMENT_COLLAB_URL : PRODUCTION_COLLAB_URL;
}

// ============================================================================
// Types
// ============================================================================

interface TeamDetails {
  orgId: string;
  name: string;
  gitRemoteHash: string | null;
  createdAt: string;
  role: string;
  /** Stytch membership type: active_member, pending_member, or invited_member */
  membershipType?: string;
}

interface TeamMember {
  memberId: string;
  email: string;
  name: string;
  status: string;
  role: string;
  createdAt: string;
}

// ============================================================================
// Per-Org JWT Cache
// ============================================================================

interface CachedOrgJwt {
  jwt: string;
  expiresAt: number;
}

/** Cache of org-scoped JWTs. Key is orgId. */
const orgJwtCache = new Map<string, CachedOrgJwt>();

/** Buffer before JWT exp to refresh early (60 seconds). */
const JWT_REFRESH_BUFFER_MS = 60 * 1000;

/**
 * Extract the `exp` claim from a JWT without verifying it.
 * Returns epoch seconds, or null if parsing fails.
 */
function getJwtExp(jwt: string): number | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Get an org-scoped JWT via session exchange. Caches per-org.
 * This does NOT touch the global auth state -- the personal org session is preserved.
 *
 * Cache TTL is derived from the actual JWT `exp` claim (minus a 60s buffer)
 * so we never serve an expired token.
 */
export async function getOrgScopedJwt(orgId: string, accountOrgId?: string): Promise<string> {
  // Check cache
  const cached = orgJwtCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.jwt;
  }
  // logger.main.info(`[TeamService] Org JWT cache miss for ${orgId}, exchanging session...`);

  // Need to exchange -- use the correct account's session token
  const sessionToken = accountOrgId
    ? getSessionTokenForAccount(accountOrgId)
    : getSessionToken();
  if (!sessionToken) {
    logger.main.warn('[TeamService] getOrgScopedJwt: no session token available');
    throw new Error('Not authenticated. Sign in first.');
  }

  const httpUrl = getCollabServerUrl();

  // Use the correct account's JWT to authenticate the exchange request
  const personalJwt = accountOrgId
    ? getSessionJwtForAccount(accountOrgId)
    : getSessionJwt();
  if (!personalJwt) {
    throw new Error('Not authenticated. Sign in first.');
  }

  const response = await net.fetch(`${httpUrl}/api/teams/${orgId}/switch`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${personalJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionToken }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
    throw new Error(errData.error || `Failed to get org-scoped JWT: ${response.status}`);
  }

  const data = await response.json() as {
    sessionJwt: string;
    sessionToken: string;
  };

  if (!data.sessionJwt) {
    throw new Error('Session exchange returned no JWT');
  }

  // Stytch session exchange replaces the session token -- the old one is now
  // invalid. We MUST persist the new token so that refreshSession() and
  // getSessionToken() continue to work.
  // BUT: only update the global token when operating under the primary account.
  // Secondary account exchanges must NOT overwrite the primary's token.
  if (data.sessionToken && !accountOrgId) {
    updateSessionToken(data.sessionToken);
  }

  // Derive cache TTL from the actual JWT exp claim (with 60s buffer).
  // Fall back to 5 minutes if we can't parse it.
  const exp = getJwtExp(data.sessionJwt);
  const expiresAt = exp
    ? (exp * 1000) - JWT_REFRESH_BUFFER_MS
    : Date.now() + 5 * 60 * 1000;

  // Cache the org-scoped JWT (do NOT update global auth state -- the global
  // session JWT stays personal-org-scoped, only the token is shared)
  orgJwtCache.set(orgId, {
    jwt: data.sessionJwt,
    expiresAt,
  });

  // logger.main.info('[TeamService] Obtained org-scoped JWT for:', orgId, 'expires in', Math.round((expiresAt - Date.now()) / 1000), 's');
  return data.sessionJwt;
}

// ============================================================================
// REST API Helper
// ============================================================================

/**
 * Make an authenticated REST call to the collabv3 team API.
 * Uses the personal org JWT for team-listing endpoints.
 * Uses org-scoped JWT when orgId is provided (for member operations).
 * When accountOrgId is provided, uses that account's JWT instead of the primary.
 */
async function fetchTeamApi(path: string, method: string, body?: unknown, orgId?: string, accountOrgId?: string): Promise<any> {
  const httpUrl = getCollabServerUrl();

  const jwtSource = orgId ? 'org-scoped' : 'personal';
  // logger.main.info(`[TeamService] ${method} ${path} (jwt: ${jwtSource}${orgId ? `, org: ${orgId}` : ''}${accountOrgId ? `, account: ${accountOrgId}` : ''})`);

  const makeRequest = async (jwt: string) => {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${jwt}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    return net.fetch(`${httpUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  // Use org-scoped JWT if orgId provided, otherwise personal JWT
  // When accountOrgId is set, use that specific account's JWT
  let jwt = orgId
    ? await getOrgScopedJwt(orgId)
    : accountOrgId
      ? getSessionJwtForAccount(accountOrgId)
      : getSessionJwt();
  if (!jwt) {
    logger.main.warn(`[TeamService] No JWT available (source: ${jwtSource})`);
    throw new Error('Not authenticated. Sign in first.');
  }

  let response = await makeRequest(jwt);

  // On 401, retry once: refresh personal session or re-exchange org JWT
  if (response.status === 401) {
    if (accountOrgId && !orgId) {
      // Non-primary account JWT rejected -- try refreshing the secondary account's session
      logger.main.info(`[TeamService] Got 401 on account JWT for ${accountOrgId}, attempting refresh...`);
      const freshJwt = await refreshSessionForAccount(accountOrgId);
      if (freshJwt) {
        logger.main.info(`[TeamService] Secondary account ${accountOrgId} refreshed, retrying request...`);
        response = await makeRequest(freshJwt);
      } else {
        logger.main.warn(`[TeamService] Secondary account ${accountOrgId} refresh failed`);
      }
    } else if (!orgId) {
      logger.main.info('[TeamService] Got 401 on personal JWT, refreshing session...');
      let refreshed = false;
      try {
        refreshed = await refreshSession();
      } catch {
        // Network error -- can't retry
      }
      if (refreshed) {
        const freshJwt = getSessionJwt();
        if (freshJwt) {
          logger.main.info('[TeamService] Session refreshed, retrying request...');
          response = await makeRequest(freshJwt);
        } else {
          logger.main.warn('[TeamService] Session refreshed but getSessionJwt() returned null');
        }
      } else {
        logger.main.warn('[TeamService] Session refresh failed, cannot retry');
      }
    } else {
      // Org-scoped JWT rejected -- invalidate cache and re-exchange
      logger.main.info(`[TeamService] Got 401 on org-scoped JWT for ${orgId}, invalidating cache and re-exchanging...`);
      orgJwtCache.delete(orgId);
      try {
        const freshOrgJwt = await getOrgScopedJwt(orgId);
        logger.main.info('[TeamService] Org JWT re-exchanged, retrying request...');
        response = await makeRequest(freshOrgJwt);
      } catch (exchangeErr) {
        logger.main.error('[TeamService] Org JWT re-exchange failed:', exchangeErr);
      }
    }
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errMsg: string;
    try {
      const errData = JSON.parse(errText) as { error?: string };
      errMsg = errData.error || `HTTP ${response.status}`;
    } catch {
      errMsg = `HTTP ${response.status}${errText ? `: ${errText.slice(0, 200)}` : ''}`;
    }
    logger.main.error(`[TeamService] ${method} ${path} failed: ${response.status} - ${errMsg}`);
    throw new Error(errMsg);
  }

  return response.json();
}

// ============================================================================
// Git Remote Detection
// ============================================================================

/**
 * Hash a git remote URL with SHA-256 for server-side lookup.
 * The server never sees the plaintext remote URL -- only the hex digest.
 */
function hashGitRemote(remote: string): string {
  return createHash('sha256').update(remote).digest('hex');
}

/**
 * Extract the member ID (sub claim) from a Stytch B2B JWT.
 * The JWT is a standard 3-part base64url-encoded token.
 */
function getMemberIdFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return payload.sub || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * List all teams the current user belongs to, across all signed-in accounts.
 * Queries each account's teams and deduplicates by orgId.
 */
async function listTeams(): Promise<TeamDetails[]> {
  if (!isAuthenticated()) {
    logger.main.info('[TeamService] listTeams: not authenticated, skipping');
    return [];
  }

  const allAccounts = getAccounts();
  const seenOrgIds = new Set<string>();
  const allTeams: TeamDetails[] = [];

  // Query teams for each signed-in account in parallel
  const results = await Promise.allSettled(
    allAccounts.map(async (account) => {
      try {
        const data = await fetchTeamApi('/api/teams', 'GET', undefined, undefined, account.personalOrgId) as { teams: TeamDetails[] };
        return data.teams || [];
      } catch (err) {
        logger.main.error(`[TeamService] listTeams error for account ${account.email}:`, err);
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const team of result.value) {
        if (!seenOrgIds.has(team.orgId)) {
          seenOrgIds.add(team.orgId);
          allTeams.push(team);
        }
      }
    }
  }

  // logger.main.info(`[TeamService] listTeams: found ${allTeams.length} team(s)`, allTeams.map(t => ({ orgId: t.orgId, name: t.name, hash: t.gitRemoteHash?.substring(0, 8) })));
  return allTeams;
}

/**
 * Get a specific team's details by orgId.
 */
async function getTeamByOrgId(orgId: string): Promise<TeamDetails | null> {
  if (!isAuthenticated()) return null;

  try {
    const teams = await listTeams();
    return teams.find(t => t.orgId === orgId) || null;
  } catch (err) {
    logger.main.error('[TeamService] getTeamByOrgId error:', err);
    return null;
  }
}

/**
 * Find a team matching a workspace's git remote.
 * Pass precomputedRemote to skip the git spawn when the caller already has it.
 */
export async function findTeamForWorkspace(workspacePath: string, precomputedRemote?: string): Promise<TeamDetails | null> {
  if (!isAuthenticated()) {
    // logger.main.info('[TeamService] findTeamForWorkspace: not authenticated');
    return null;
  }

  const remote = precomputedRemote ?? await getNormalizedGitRemote(workspacePath);
  if (!remote) {
    // logger.main.info('[TeamService] findTeamForWorkspace: no git remote for', workspacePath);
    return null;
  }

  const remoteHash = hashGitRemote(remote);

  try {
    const teams = await listTeams();
    // Only match teams where the user is an active member -- never auto-join
    // invited or pending teams without explicit user consent.
    const activeTeams = teams.filter(t => !t.membershipType || t.membershipType === 'active_member');
    const match = activeTeams.find(t => t.gitRemoteHash === remoteHash) || null;
    if (match) {
      // logger.main.info('[TeamService] findTeamForWorkspace: matched team:', match.name, 'orgId:', match.orgId, 'for workspace:', workspacePath);
    } else if (teams.length > 0) {
      logger.main.info('[TeamService] findTeamForWorkspace: no hash match. workspace hash:', remoteHash, 'team hashes:', teams.map(t => ({ orgId: t.orgId, name: t.name, hash: t.gitRemoteHash, membership: t.membershipType })));
    }
    return match;
  } catch (err) {
    logger.main.error('[TeamService] findTeamForWorkspace error:', err);
    return null;
  }
}

/**
 * Find a pending invite matching a workspace's git remote.
 * Used by the UI to show "Join Team" for invites that match the current project.
 */
export async function findPendingInviteForWorkspace(workspacePath: string): Promise<TeamDetails | null> {
  if (!isAuthenticated()) return null;

  const remote = await getNormalizedGitRemote(workspacePath);
  if (!remote) return null;

  const remoteHash = hashGitRemote(remote);

  try {
    const teams = await listTeams();
    const pendingTeams = teams.filter(t => t.membershipType && t.membershipType !== 'active_member');
    const match = pendingTeams.find(t => t.gitRemoteHash === remoteHash) || null;
    if (match) {
      logger.main.info('[TeamService] findPendingInviteForWorkspace: matched pending invite:', match.name, 'orgId:', match.orgId, 'membershipType:', match.membershipType);
    }
    return match;
  } catch (err) {
    logger.main.error('[TeamService] findPendingInviteForWorkspace error:', err);
    return null;
  }
}

/**
 * Create a new team (Stytch org + D1 metadata + encryption key setup).
 * Returns the new team details. Does NOT modify global auth state.
 */
async function createTeam(name: string, workspacePath?: string, accountOrgId?: string): Promise<TeamDetails> {
  let gitRemoteHash: string | undefined;
  if (workspacePath) {
    const remote = await getNormalizedGitRemote(workspacePath);
    if (remote) {
      gitRemoteHash = hashGitRemote(remote);
    }
  }

  // Create team using the specified account's JWT (or primary if not specified)
  const result = await fetchTeamApi('/api/teams', 'POST', {
    name,
    gitRemoteHash,
  }, undefined, accountOrgId) as { orgId: string; name: string; creatorMemberId: string };

  logger.main.info('[TeamService] Team created:', result.orgId, name);

  // Set up encryption: identity key + org key + self-wrap
  try {
    const orgJwt = await getOrgScopedJwt(result.orgId, accountOrgId);

    // 1. Ensure identity key pair exists
    await getOrCreateIdentityKeyPair();

    // 2. Upload public key to the new team org
    await uploadIdentityKeyToOrg(orgJwt);

    // 3. Generate org encryption key
    await generateAndStoreOrgKey(result.orgId);

    // 4. Wrap org key for self and upload envelope
    const myPublicKeyJwk = await exportPublicKeyJwk();
    const envelope = await wrapOrgKeyForMember(result.orgId, myPublicKeyJwk);
    await uploadEnvelope(result.orgId, result.creatorMemberId, envelope, orgJwt);

    logger.main.info('[TeamService] Encryption set up for team:', result.orgId);
  } catch (err) {
    // Team was created but encryption setup failed -- log but don't fail
    logger.main.error('[TeamService] Encryption setup failed for team:', result.orgId, err);
  }

  return {
    orgId: result.orgId,
    name: result.name,
    gitRemoteHash: gitRemoteHash || null,
    createdAt: new Date().toISOString(),
    role: 'admin',
  };
}

/**
 * Accept a pending team invite. Exchanges the personal session for an
 * org-scoped session (promoting the user from pending/invited to active
 * in Stytch automatically), then sets up encryption keys.
 */
async function acceptInvite(orgId: string): Promise<TeamDetails> {
  // 1. Exchange session for the team org -- Stytch promotes pending -> active_member
  const orgJwt = await getOrgScopedJwt(orgId);

  // 2. Set up encryption: identity key + fetch org key
  try {
    await getOrCreateIdentityKeyPair();
    await uploadIdentityKeyToOrg(orgJwt);

    // Try to fetch and unwrap org key (admin may not have wrapped it yet)
    await fetchAndUnwrapOrgKey(orgId, orgJwt);
    logger.main.info('[TeamService] Encryption set up after accepting invite for:', orgId);
  } catch (err) {
    // Encryption setup can fail if admin hasn't shared key yet -- that's OK
    logger.main.warn('[TeamService] Encryption setup after invite accept (non-fatal):', err);
  }

  // 3. Fetch team details now that we're an active member
  const teams = await listTeams();
  const team = teams.find(t => t.orgId === orgId);
  if (!team) {
    throw new Error('Joined team but could not find it in team list');
  }

  logger.main.info('[TeamService] Accepted invite for team:', team.name, 'orgId:', orgId);
  return team;
}

/**
 * List members of a team. Requires explicit orgId.
 */
async function listMembers(orgId: string): Promise<{ members: TeamMember[]; callerRole: string }> {
  const data = await fetchTeamApi(`/api/teams/${orgId}/members`, 'GET', undefined, orgId) as {
    members: TeamMember[];
    callerRole: string;
  };
  return data;
}

/**
 * Invite a member to a team by email. Requires explicit orgId.
 */
async function inviteMember(orgId: string, email: string): Promise<void> {
  await fetchTeamApi(`/api/teams/${orgId}/invite`, 'POST', { email }, orgId);
}

/**
 * Remove a member from a team. Requires explicit orgId.
 * Triggers key rotation: new org key, delete old envelopes, re-wrap for remaining.
 */
async function removeMember(orgId: string, memberId: string): Promise<void> {
  // Remove from Stytch + D1
  await fetchTeamApi(`/api/teams/${orgId}/members/${memberId}`, 'DELETE', undefined, orgId);

  // Key rotation: generate new org key, re-wrap for remaining members
  try {
    const orgJwt = await getOrgScopedJwt(orgId);

    // Delete all existing envelopes (old key)
    await deleteAllEnvelopes(orgId, orgJwt);

    // Generate new org encryption key
    await generateAndStoreOrgKey(orgId);

    // Get remaining members and wrap new key for each
    const { members } = await listMembers(orgId);
    for (const member of members) {
      if (member.status === 'pending') continue; // Skip pending invites
      try {
        const memberPubKey = await fetchMemberPublicKey(member.memberId, orgJwt);
        const envelope = await wrapOrgKeyForMember(orgId, memberPubKey);
        await uploadEnvelope(orgId, member.memberId, envelope, orgJwt);
      } catch (wrapErr) {
        // Member may not have uploaded their public key yet
        logger.main.warn('[TeamService] Could not wrap key for member:', member.memberId, wrapErr);
      }
    }

    logger.main.info('[TeamService] Key rotation complete after removing:', memberId);
  } catch (err) {
    logger.main.error('[TeamService] Key rotation failed after member removal:', err);
  }
}

/**
 * Delete a team entirely. Admin only.
 * Deletes Stytch org, D1 metadata, and TeamRoom DO state.
 */
async function deleteTeam(orgId: string): Promise<void> {
  await fetchTeamApi(`/api/teams/${orgId}`, 'DELETE', undefined, orgId);
  // Clear cached org JWT since the org no longer exists
  orgJwtCache.delete(orgId);
  logger.main.info('[TeamService] Team deleted:', orgId);
}

/**
 * Update a member's role in a team. Requires explicit orgId.
 */
async function updateMemberRole(orgId: string, memberId: string, role: string): Promise<void> {
  await fetchTeamApi(`/api/teams/${orgId}/members/${memberId}`, 'PUT', { role }, orgId);
}

/**
 * Set the project identity (git remote hash) for a team. Admin only.
 */
async function setProjectIdentity(orgId: string, gitRemoteHash: string): Promise<void> {
  await fetchTeamApi(`/api/teams/${orgId}/project-identity`, 'PUT', { gitRemoteHash }, orgId);
}

/**
 * Clear the project identity for a team. Admin only.
 */
async function clearProjectIdentity(orgId: string): Promise<void> {
  await fetchTeamApi(`/api/teams/${orgId}/project-identity`, 'DELETE', undefined, orgId);
}

/**
 * Re-share the org encryption key with a specific member.
 * Admin-only: fetches the member's current public key and wraps the org key for them.
 * Used when a member's identity key pair was regenerated (new device, corrupted safeStorage).
 */
async function reshareKeyForMember(orgId: string, memberId: string): Promise<void> {
  const orgJwt = await getOrgScopedJwt(orgId);

  // Delete stale envelope for this member (if any)
  try {
    await deleteEnvelope(orgId, memberId, orgJwt);
  } catch {
    // May not exist -- that's fine
  }

  // Fetch the member's current public key and wrap the org key for them
  const memberPubKey = await fetchMemberPublicKey(memberId, orgJwt);
  const envelope = await wrapOrgKeyForMember(orgId, memberPubKey);
  await uploadEnvelope(orgId, memberId, envelope, orgJwt);

  logger.main.info('[TeamService] Re-shared org key for member:', memberId);
}

// ============================================================================
// Auto-Match: Org Key for Workspace
// ============================================================================

/**
 * Ensure the org encryption key is available for a workspace's team.
 * If the workspace matches a team and we don't have the key yet,
 * fetches the key envelope from the server and unwraps it.
 */
async function ensureOrgKeyForWorkspace(workspacePath: string): Promise<{
  team: TeamDetails | null;
  hasKey: boolean;
}> {
  if (!isAuthenticated()) return { team: null, hasKey: false };

  const team = await findTeamForWorkspace(workspacePath);
  if (!team) return { team: null, hasKey: false };

  // Check if we already have the org key locally
  if (hasOrgKey(team.orgId)) {
    // Key is cached locally, but ensure our envelope exists on the server.
    // After a DO wipe, the local key cache survives but server envelopes are gone.
    // Without this, other members can't get the key from the server.
    // Don't gate on team.role -- after a DO wipe the server may report 'member'
    // even for the original admin who has the key locally.
    try {
      const orgJwt = await getOrgScopedJwt(team.orgId);
      await getOrCreateIdentityKeyPair();
      await uploadIdentityKeyToOrg(orgJwt);

      const existingEnvelope = await fetchOwnEnvelope(team.orgId, orgJwt);
      if (!existingEnvelope) {
        logger.main.info('[TeamService] Has local key but no server envelope, re-uploading for:', team.orgId);
        const myPublicKeyJwk = await exportPublicKeyJwk();
        const envelope = await wrapOrgKeyForMember(team.orgId, myPublicKeyJwk);
        const myMemberId = getMemberIdFromJwt(orgJwt);
        if (myMemberId) {
          await uploadEnvelope(team.orgId, myMemberId, envelope, orgJwt);
          logger.main.info('[TeamService] Re-uploaded envelope for:', team.orgId);
        }
      }
    } catch (err) {
      // Non-fatal -- we still have the key locally
      logger.main.warn('[TeamService] Failed to verify/re-upload envelope:', err);
    }
    return { team, hasKey: true };
  }

  // Try to fetch and unwrap from server
  try {
    const orgJwt = await getOrgScopedJwt(team.orgId);

    // Ensure identity key pair exists and public key is uploaded
    await getOrCreateIdentityKeyPair();
    await uploadIdentityKeyToOrg(orgJwt);

    let key: CryptoKey | null = null;
    let unwrapFailed = false;
    try {
      key = await fetchAndUnwrapOrgKey(team.orgId, orgJwt);
    } catch (unwrapErr) {
      // Envelope exists but can't be unwrapped (identity key was regenerated).
      // Recovery strategy:
      // 1. Delete the stale envelope (wrapped for old identity key)
      // 2. Re-upload identity key to trigger `identityKeyUploaded` broadcast
      //    to all connected TeamRoom clients
      // 3. Connected admins who have the org key will auto-wrap a fresh
      //    envelope for our new identity key via `autoWrapNewMembers`
      // 4. We poll for the new envelope below
      logger.main.warn(
        '[TeamService] Failed to unwrap own envelope for:',
        team.orgId,
        '-- identity key may have changed. Triggering key recovery from other admins.',
        unwrapErr,
      );
      unwrapFailed = true;
      const myMemberId = getMemberIdFromJwt(orgJwt);
      if (myMemberId) {
        try {
          // Step 1: Delete stale envelope first (so we appear "unwrapped")
          await deleteEnvelope(team.orgId, myMemberId, orgJwt);
          logger.main.info('[TeamService] Deleted stale envelope for self');

          // Step 2: Re-upload identity key to broadcast `identityKeyUploaded`
          // to connected admins. They see us as "unwrapped" and auto-wrap.
          await uploadIdentityKeyToOrg(orgJwt);
          logger.main.info('[TeamService] Re-uploaded identity key to trigger auto-wrap from other admins');
        } catch (recoveryErr) {
          logger.main.warn('[TeamService] Key recovery setup failed:', recoveryErr);
        }
      }
    }

    if (key !== null) {
      return { team, hasKey: true };
    }

    // No usable org key yet. If we just signaled other admins, poll briefly
    // to see if one of them wraps a fresh envelope for us in realtime.
    if (unwrapFailed) {
      logger.main.info('[TeamService] Polling for fresh envelope from other admins...');
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const freshKey = await fetchAndUnwrapOrgKey(team.orgId, orgJwt);
          if (freshKey !== null) {
            logger.main.info('[TeamService] Recovered org key from another admin on attempt', attempt + 1);
            return { team, hasKey: true };
          }
        } catch {
          // Envelope still not available or still stale -- keep polling
        }
      }
      logger.main.warn(
        '[TeamService] Org key recovery timed out for:', team.orgId,
        '-- another admin with the org key needs to be online for recovery.',
      );
    } else {
      logger.main.warn(
        '[TeamService] No envelope found on server for:', team.orgId,
        '-- another admin with the org key must be online to share the key.',
      );
    }

    return { team, hasKey: false };

  } catch (err) {
    logger.main.warn('[TeamService] Failed to ensure org key for workspace:', workspacePath, err);
    return { team, hasKey: false };
  }
}

// Active auto-wrap polling intervals keyed by orgId
const autoWrapIntervals = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Start a background polling interval that periodically checks for unwrapped
 * team members and wraps the org key for them. This handles the case where a
 * new member uploads their identity key after the admin's initial startup wrap.
 * Polls every 15s for 5 minutes, then stops.
 */
function startAutoWrapPolling(orgId: string): void {
  // Don't start duplicate intervals for the same org
  if (autoWrapIntervals.has(orgId)) return;

  let attempts = 0;
  const maxAttempts = 20; // 15s * 20 = 5 minutes
  const intervalMs = 15_000;

  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(interval);
      autoWrapIntervals.delete(orgId);
      return;
    }

    try {
      await autoWrapForNewMembers(orgId);
    } catch (err) {
      // Non-admin members will get "Only admins can manage key envelopes" --
      // stop polling since this user can't wrap keys
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Only admins') || msg.includes('403')) {
        clearInterval(interval);
        autoWrapIntervals.delete(orgId);
      }
    }
  }, intervalMs);

  autoWrapIntervals.set(orgId, interval);
}

/**
 * Auto-match a workspace to a team on open. Fire-and-forget.
 * If matched, ensures the org key is available and notifies renderer windows.
 */
export async function autoMatchTeamForWorkspace(workspacePath: string): Promise<void> {
  logger.main.info('[TeamService] autoMatchTeamForWorkspace:', workspacePath);

  // If auth isn't ready yet (common at startup -- session restore runs before Stytch init),
  // defer until auth becomes available via a one-shot listener.
  if (!isAuthenticated()) {
    logger.main.info('[TeamService] Auth not ready, deferring autoMatch for:', workspacePath);
    const unsubscribe = onAuthStateChange((authState) => {
      if (authState.isAuthenticated) {
        unsubscribe();
        logger.main.info('[TeamService] Auth now ready, retrying autoMatch for:', workspacePath);
        autoMatchTeamForWorkspace(workspacePath).catch(() => {});
      }
    });
    return;
  }

  try {
    const result = await ensureOrgKeyForWorkspace(workspacePath);
    if (result.team) {
      logger.main.info('[TeamService] Workspace matched to team:', result.team.name, 'orgId:', result.team.orgId, 'hasKey:', result.hasKey);

      // If we have the org key, auto-wrap for any members missing envelopes
      if (result.hasKey) {
        autoWrapForNewMembers(result.team.orgId).catch(err => {
          logger.main.warn(`[TeamService] Auto-wrap for new members of ${result.team?.orgId} failed:`, err);
        });
        // Start background polling to catch members who upload their key later
        startAutoWrapPolling(result.team.orgId);
      }

      // Notify all renderer windows about the team match
      const { BrowserWindow } = await import('electron');
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('team:workspace-matched', {
          orgId: result.team.orgId,
          teamName: result.team.name,
          workspacePath,
          hasKey: result.hasKey,
        });
      }
    }
  } catch (err) {
    // Fire-and-forget -- never block workspace open
    logger.main.error('[TeamService] autoMatchTeamForWorkspace error:', err);
  }
}

/**
 * Check for team members who don't have key envelopes yet and wrap for them.
 * Called by admin's client on workspace open to distribute org keys to new members.
 */
export async function autoWrapForNewMembers(orgId: string): Promise<void> {
  const orgJwt = await getOrgScopedJwt(orgId);

  // Get all members and all existing envelopes
  const { members } = await listMembers(orgId);
  const envelopes = await fetchAllEnvelopes(orgId, orgJwt);
  const wrappedUserIds = new Set(envelopes.map((e: { targetUserId: string }) => e.targetUserId));

  // Find active members without envelopes
  const unwrappedMembers = members.filter(
    m => m.status !== 'pending' && !wrappedUserIds.has(m.memberId)
  );

  if (unwrappedMembers.length === 0) return;

  logger.main.info('[TeamService] Auto-wrapping org key for', unwrappedMembers.length, 'new member(s)');

  for (const member of unwrappedMembers) {
    try {
      const memberPubKey = await fetchMemberPublicKey(member.memberId, orgJwt);
      const envelope = await wrapOrgKeyForMember(orgId, memberPubKey);
      await uploadEnvelope(orgId, member.memberId, envelope, orgJwt);
      logger.main.info('[TeamService] Wrapped org key for member:', member.email || member.memberId);
    } catch (err) {
      // Member may not have uploaded their public key yet - that's OK
      logger.main.warn('[TeamService] Could not wrap key for member:', member.memberId, err);
    }
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerTeamHandlers(): void {
  safeHandle('team:list', async () => {
    try {
      const teams = await listTeams();
      return { success: true, teams };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:find-for-workspace', async (_event, workspacePath: string) => {
    try {
      // Try active team match first
      const team = await findTeamForWorkspace(workspacePath);
      if (team) {
        return { success: true, team };
      }
      // Also check for pending invites matching this workspace
      const pendingInvite = await findPendingInviteForWorkspace(workspacePath);
      if (pendingInvite) {
        return { success: true, team: pendingInvite };
      }
      return { success: true, team: null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:get', async (_event, orgId: string) => {
    try {
      const team = await getTeamByOrgId(orgId);
      return { success: true, team };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:create', async (_event, name: string, workspacePath?: string, accountOrgId?: string) => {
    try {
      const team = await createTeam(name, workspacePath, accountOrgId);
      return { success: true, team };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:accept-invite', async (_event, orgId: string) => {
    try {
      const team = await acceptInvite(orgId);
      return { success: true, team };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:list-members', async (_event, orgId: string) => {
    try {
      const data = await listMembers(orgId);
      return { success: true, ...data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:invite', async (_event, orgId: string, email: string) => {
    try {
      await inviteMember(orgId, email);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:remove-member', async (_event, orgId: string, memberId: string) => {
    try {
      await removeMember(orgId, memberId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:delete', async (_event, orgId: string) => {
    try {
      await deleteTeam(orgId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:update-role', async (_event, orgId: string, memberId: string, role: string) => {
    try {
      await updateMemberRole(orgId, memberId, role);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:get-git-remote', async (_event, workspacePath: string) => {
    try {
      const remote = await getNormalizedGitRemote(workspacePath);
      return { success: true, remote };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:set-project-identity', async (_event, orgId: string, workspacePath: string) => {
    try {
      const remote = await getNormalizedGitRemote(workspacePath);
      if (!remote) {
        return { success: false, error: 'No git remote found for this workspace' };
      }
      const hash = hashGitRemote(remote);
      await setProjectIdentity(orgId, hash);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:clear-project-identity', async (_event, orgId: string) => {
    try {
      await clearProjectIdentity(orgId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:ensure-workspace-key', async (_event, workspacePath: string) => {
    try {
      const result = await ensureOrgKeyForWorkspace(workspacePath);
      return { success: true, team: result.team, hasKey: result.hasKey };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:reshare-key', async (_event, orgId: string, memberId: string) => {
    try {
      await reshareKeyForMember(orgId, memberId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('team:auto-wrap-new-members', async (_event, orgId: string) => {
    try {
      await autoWrapForNewMembers(orgId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
