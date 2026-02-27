/**
 * StytchAuthService - Manages user authentication via Stytch B2B platform.
 *
 * This service handles:
 * - Google OAuth sign-in/sign-up (via browser redirect to collabv3 server)
 * - Email magic link authentication (via collabv3 server)
 * - Session token/JWT management
 * - Organization context (B2B org_id)
 *
 * Security architecture:
 * - All authentication flows go through the collabv3 Cloudflare Worker
 * - The desktop app NEVER has access to the Stytch secret key
 * - OAuth flow: opens browser -> collabv3/auth/login/google -> Stytch -> collabv3/auth/callback -> nimbalyst:// deep link
 * - Magic links: collabv3 sends email (has secret key), callback to collabv3, then deep link to app
 * - Session tokens received via deep link are stored securely using Electron's safeStorage
 * - JWT is used for sync server authentication, includes org context for B2B
 *
 * Deep link format: nimbalyst://auth/callback?session_token=...&session_jwt=...&user_id=...&email=...&org_id=...
 */

import { safeStorage, shell, net } from 'electron';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { STYTCH_CONFIG } from '@nimbalyst/runtime';
import { getSessionSyncConfig, setSessionSyncConfig } from '../utils/store';
import { AnalyticsService } from './analytics/AnalyticsService';

// Stytch types
interface StytchUser {
  user_id: string;
  emails: Array<{
    email_id: string;
    email: string;
    verified: boolean;
  }>;
  name?: {
    first_name?: string;
    last_name?: string;
  };
  created_at: string;
  status: 'active' | 'pending';
}

interface StytchSession {
  session_id: string;
  user_id: string;
  started_at: string;
  last_accessed_at: string;
  expires_at: string;
  authentication_factors: Array<{
    type: string;
    delivery_method: string;
    last_authenticated_at: string;
  }>;
}

interface StytchAuthState {
  isAuthenticated: boolean;
  user: StytchUser | null;
  session: StytchSession | null;
  sessionToken: string | null;
  sessionJwt: string | null;
  /** Organization ID from B2B auth (may change on session exchange). */
  orgId: string | null;
  /** Personal org ID -- set once on initial auth, never overwritten by session exchanges.
   *  Used for session sync room IDs so they stay stable across org switches. */
  personalOrgId: string | null;
  /** Personal org member ID -- set once on initial auth, never overwritten by session exchanges.
   *  In Stytch B2B, each org has its own member record. After a team session exchange,
   *  the JWT sub claim changes to the team org member ID. This field preserves the
   *  personal org member ID so sync room IDs and encryption keys stay stable. */
  personalUserId: string | null;
}

interface StoredStytchCredentials {
  sessionToken: string;
  sessionJwt: string;
  userId: string;
  email?: string;
  expiresAt: number;
  /** Organization ID from B2B auth (may change on session exchange) */
  orgId?: string;
  /** Personal org ID -- set once on initial auth, stable across session exchanges */
  personalOrgId?: string;
  /** Personal org member ID -- set once on initial auth, stable across session exchanges */
  personalUserId?: string;
}


// Stytch configuration - PUBLIC TOKEN ONLY, no secret key!
interface StytchConfig {
  projectId: string;
  publicToken: string;
  apiBase: string; // 'https://test.stytch.com/v1' for test, 'https://api.stytch.com/v1' for live
}

// File names for persistent storage
const STYTCH_CREDENTIALS_FILE = 'stytch-credentials.enc';

// Singleton state
let authState: StytchAuthState = {
  isAuthenticated: false,
  user: null,
  session: null,
  sessionToken: null,
  sessionJwt: null,
  orgId: null,
  personalOrgId: null,
  personalUserId: null,
};

let stytchConfig: StytchConfig | null = null;

// Event listeners for auth state changes
type AuthStateListener = (state: StytchAuthState) => void;
const authStateListeners = new Set<AuthStateListener>();

/**
 * Get the path to the encrypted credentials file.
 */
function getCredentialsPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, STYTCH_CREDENTIALS_FILE);
}


/**
 * Check if safeStorage is available for encryption.
 */
function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Save Stytch credentials securely.
 */
function saveStytchCredentials(credentials: StoredStytchCredentials): void {
  const credentialsPath = getCredentialsPath();
  const jsonData = JSON.stringify(credentials);

  if (isSafeStorageAvailable()) {
    const encrypted = safeStorage.encryptString(jsonData);
    fs.writeFileSync(credentialsPath, encrypted);
    // logger.main.info('[StytchAuthService] Credentials saved with safeStorage encryption');
  } else {
    logger.main.warn('[StytchAuthService] safeStorage not available - saving credentials without encryption');
    fs.writeFileSync(credentialsPath, jsonData, 'utf8');
  }
}

/**
 * Load Stytch credentials from secure storage.
 */
function loadStytchCredentials(): StoredStytchCredentials | null {
  const credentialsPath = getCredentialsPath();

  if (!fs.existsSync(credentialsPath)) {
    return null;
  }

  try {
    const fileData = fs.readFileSync(credentialsPath);

    if (isSafeStorageAvailable()) {
      const decrypted = safeStorage.decryptString(fileData);
      return JSON.parse(decrypted);
    } else {
      const jsonData = fileData.toString('utf8');
      return JSON.parse(jsonData);
    }
  } catch (error) {
    logger.main.error('[StytchAuthService] Failed to load credentials:', error);
    return null;
  }
}

/**
 * Clear stored Stytch credentials.
 */
function clearStytchCredentials(): void {
  const credentialsPath = getCredentialsPath();
  if (fs.existsSync(credentialsPath)) {
    fs.unlinkSync(credentialsPath);
    logger.main.info('[StytchAuthService] Credentials cleared');
  }
}


/**
 * Notify all listeners of auth state change.
 */
function notifyAuthStateChange(): void {
  const state = { ...authState };
  authStateListeners.forEach(listener => {
    try {
      listener(state);
    } catch (error) {
      logger.main.error('[StytchAuthService] Auth state listener error:', error);
    }
  });
}

/**
 * Update auth state and notify listeners.
 */
function updateAuthState(update: Partial<StytchAuthState>): void {
  authState = { ...authState, ...update };
  notifyAuthStateChange();
}


// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the Stytch auth service.
 * Call this during app startup.
 *
 * IMPORTANT: Only pass the public token, never the secret key!
 */
export function initializeStytchAuth(config: StytchConfig): void {
  stytchConfig = config;

  logger.main.info('[StytchAuthService] Initialized with project:', config.projectId);

  // Try to restore session from saved credentials
  const savedCredentials = loadStytchCredentials();
  if (savedCredentials && savedCredentials.expiresAt > Date.now() && savedCredentials.orgId) {
    // Validate JWT format (must be 3 parts separated by dots)
    const hasValidJwt = savedCredentials.sessionJwt && savedCredentials.sessionJwt.split('.').length === 3;

    // Use updateAuthState to notify listeners (like RepositoryManager) of the restored session
    updateAuthState({
      isAuthenticated: true,
      user: savedCredentials.userId ? {
        user_id: savedCredentials.userId,
        emails: savedCredentials.email ? [{ email_id: '', email: savedCredentials.email, verified: true }] : [],
        created_at: new Date().toISOString(),
        status: 'active',
      } : null,
      session: null,
      sessionToken: savedCredentials.sessionToken,
      sessionJwt: hasValidJwt ? savedCredentials.sessionJwt : null,
      orgId: savedCredentials.orgId,
      personalOrgId: savedCredentials.personalOrgId || null,
      personalUserId: savedCredentials.personalUserId || null,
    });
    // One-time migration: if personalOrgId is missing (pre-existing creds from before
    // this field was added), persist the current orgId as personalOrgId.
    // At the time those creds were saved, the orgId WAS the personal org.
    let needsSave = false;
    if (!savedCredentials.personalOrgId && savedCredentials.orgId) {
      savedCredentials.personalOrgId = savedCredentials.orgId;
      authState.personalOrgId = savedCredentials.orgId;
      needsSave = true;
      logger.main.info('[StytchAuthService] Migrated orgId to personalOrgId:', savedCredentials.orgId);
    }
    // One-time migration: if personalUserId is missing, try to persist the current userId.
    // BUT: if orgId !== personalOrgId, a team session exchange already happened and the
    // stored userId is the TEAM member ID (not personal). In that case, SyncManager will
    // call resolvePersonalUserId() during async init to exchange to the personal org
    // and extract the correct member ID.
    if (!savedCredentials.personalUserId && savedCredentials.userId) {
      if (!savedCredentials.orgId || !savedCredentials.personalOrgId || savedCredentials.orgId === savedCredentials.personalOrgId) {
        // No team exchange happened yet -- userId IS the personal member ID
        savedCredentials.personalUserId = savedCredentials.userId;
        authState.personalUserId = savedCredentials.userId;
        needsSave = true;
        logger.main.info('[StytchAuthService] Migrated userId to personalUserId:', savedCredentials.userId);
      } else {
        logger.main.warn('[StytchAuthService] personalUserId missing and orgId differs from personalOrgId.',
          'Will resolve via session exchange to personal org during sync init.');
      }
    }
    if (needsSave) {
      saveStytchCredentials(savedCredentials);
    }
    logger.main.info('[StytchAuthService] Restored session for user:', savedCredentials.userId, savedCredentials.email, {
      hasValidJwt,
      orgId: savedCredentials.orgId,
      personalOrgId: authState.personalOrgId,
    });

    // If JWT is missing or invalid, try to refresh the session
    if (!hasValidJwt) {
      logger.main.info('[StytchAuthService] Stored session has no valid JWT - will attempt refresh');
      // Schedule refresh after initialization completes (don't block startup)
      setImmediate(async () => {
        const refreshed = await refreshSession();
        if (refreshed) {
          logger.main.info('[StytchAuthService] Session refreshed on startup - JWT now available');
        } else {
          logger.main.warn('[StytchAuthService] Session refresh failed - user may need to re-authenticate');
        }
      });
    }
  } else if (savedCredentials) {
    const reason = !savedCredentials.orgId ? 'missing orgId (pre-B2B credential)' : 'expired';
    logger.main.info(`[StytchAuthService] Saved session invalid: ${reason}, clearing`);
    clearStytchCredentials();
  }
}

/**
 * Handle auth callback from deep link (nimbalyst://auth/callback?...)
 * Called when user completes auth flow and is redirected back to the app.
 */
export async function handleAuthCallback(params: {
  sessionToken: string;
  sessionJwt?: string;
  userId?: string;
  email?: string;
  expiresAt?: string;
  orgId?: string;
}): Promise<void> {
  const { sessionToken, sessionJwt, userId, email, expiresAt, orgId } = params;

  // Calculate expiry time
  let expiresAtMs = Date.now() + (7 * 24 * 60 * 60 * 1000); // Default: 1 week
  if (expiresAt) {
    try {
      expiresAtMs = new Date(expiresAt).getTime();
    } catch {
      // Use default
    }
  }

  // Validate JWT format (must be 3 parts separated by dots)
  const validatedJwt = sessionJwt && sessionJwt.split('.').length === 3 ? sessionJwt : null;
  if (sessionJwt && !validatedJwt) {
    logger.main.warn('[StytchAuthService] Auth callback received invalid JWT format');
  }

  // On initial auth, the orgId is the user's personal org and userId is the
  // personal org member ID. Preserve existing values (in case of re-auth within same session).
  const personalOrgId = authState.personalOrgId || orgId || null;
  const personalUserId = authState.personalUserId || userId || null;

  // Update auth state
  updateAuthState({
    isAuthenticated: true,
    user: userId ? {
      user_id: userId,
      emails: email ? [{ email_id: '', email, verified: true }] : [],
      created_at: new Date().toISOString(),
      status: 'active',
    } : null,
    session: null,
    sessionToken,
    sessionJwt: validatedJwt,
    orgId: orgId || null,
    personalOrgId,
    personalUserId,
  });

  // Save credentials for persistence
  saveStytchCredentials({
    sessionToken,
    sessionJwt: validatedJwt || '',
    userId: userId || '',
    email: email || '',
    expiresAt: expiresAtMs,
    orgId,
    personalOrgId: personalOrgId || undefined,
    personalUserId: personalUserId || undefined,
  });

  // Bootstrap sync config if it doesn't exist yet.
  // Teams and sync operations need this config to exist, even if sync isn't enabled.
  const existingConfig = getSessionSyncConfig();
  if (!existingConfig) {
    setSessionSyncConfig({
      enabled: false,
      serverUrl: '',
      enabledProjects: [],
    });
    logger.main.info('[StytchAuthService] Created default sync config after auth');
  }

  // Track auth callback completion (authoritative sign-in event from deep link)
  AnalyticsService.getInstance().sendEvent('sync_auth_callback_completed');

  logger.main.info('[StytchAuthService] Auth callback processed:', {
    userId,
    email,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
}

/**
 * Subscribe to auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(listener: AuthStateListener): () => void {
  authStateListeners.add(listener);
  // Immediately notify with current state
  listener({ ...authState });
  return () => authStateListeners.delete(listener);
}

/**
 * Get the current authentication state.
 */
export function getAuthState(): StytchAuthState {
  return { ...authState };
}

/**
 * Check if the user is authenticated.
 */
export function isAuthenticated(): boolean {
  return authState.isAuthenticated;
}

/**
 * Get the current user's Stytch user ID.
 */
export function getStytchUserId(): string | null {
  return authState.user?.user_id || null;
}

/**
 * Get the current user's email address.
 */
export function getUserEmail(): string | null {
  return authState.user?.emails?.[0]?.email || null;
}

/**
 * Get the current organization ID (may change on session exchange to team orgs).
 */
export function getOrgId(): string | null {
  return authState.orgId;
}

/**
 * Get the personal organization ID (stable across session exchanges).
 * Set once during initial auth, never overwritten by team session exchanges.
 * Used for session sync room IDs so they stay stable regardless of which org
 * the JWT is currently scoped to.
 */
export function getPersonalOrgId(): string | null {
  return authState.personalOrgId;
}

/**
 * Get the personal org member ID (stable across session exchanges).
 * In Stytch B2B, each org has its own member record with a unique member ID.
 * After a team session exchange, the JWT sub claim and authState.user.user_id
 * change to the team org's member ID. This function returns the original
 * personal org member ID so sync room IDs and encryption keys stay consistent.
 */
export function getPersonalUserId(): string | null {
  return authState.personalUserId;
}

/**
 * Resolve the personal org member ID by exchanging the session to the personal org.
 * This is needed when personalUserId is missing because a team session exchange
 * corrupted the stored userId. Does a session exchange to the personal org,
 * extracts the member ID from the resulting JWT, and persists it.
 *
 * Returns the personal member ID, or null if resolution fails.
 */
export async function resolvePersonalUserId(serverUrl: string): Promise<string | null> {
  // Already resolved
  if (authState.personalUserId) {
    return authState.personalUserId;
  }

  const personalOrgId = authState.personalOrgId;
  if (!personalOrgId) {
    logger.main.warn('[StytchAuthService] Cannot resolve personalUserId: no personalOrgId');
    return null;
  }

  const sessionToken = authState.sessionToken;
  if (!sessionToken) {
    logger.main.warn('[StytchAuthService] Cannot resolve personalUserId: no session token');
    return null;
  }

  const jwt = authState.sessionJwt;
  if (!jwt) {
    logger.main.warn('[StytchAuthService] Cannot resolve personalUserId: no JWT');
    return null;
  }

  try {
    // Convert ws(s):// to http(s):// for fetch
    const httpUrl = serverUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    logger.main.info('[StytchAuthService] Resolving personalUserId via session exchange to personal org:', personalOrgId);

    const response = await net.fetch(`${httpUrl}/api/teams/${personalOrgId}/switch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionToken }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
      logger.main.error('[StytchAuthService] Failed to resolve personalUserId:', errData.error || response.status);
      return null;
    }

    const data = await response.json() as {
      sessionJwt: string;
      sessionToken: string;
    };

    if (!data.sessionJwt) {
      logger.main.error('[StytchAuthService] Session exchange returned no JWT');
      return null;
    }

    // Extract member ID from the personal-org-scoped JWT
    const parts = data.sessionJwt.split('.');
    if (parts.length !== 3) {
      logger.main.error('[StytchAuthService] Invalid JWT format from session exchange');
      return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { sub?: string };
    const personalUserId = payload.sub;
    if (!personalUserId) {
      logger.main.error('[StytchAuthService] JWT sub claim missing from session exchange response');
      return null;
    }

    // Persist the resolved personal member ID
    authState = { ...authState, personalUserId };
    const creds = loadStytchCredentials();
    if (creds) {
      saveStytchCredentials({ ...creds, personalUserId });
    }

    // The session exchange also updated the session token -- persist that too
    // so future refreshes work. But do NOT update personalOrgId or personalUserId
    // from the exchange response -- we just resolved those.
    if (data.sessionToken) {
      updateSessionToken(data.sessionToken);
    }

    logger.main.info('[StytchAuthService] Resolved personalUserId:', personalUserId);
    return personalUserId;
  } catch (error) {
    logger.main.error('[StytchAuthService] Error resolving personalUserId:', error);
    return null;
  }
}

/**
 * Get the current session JWT for server authentication.
 */
export function getSessionJwt(): string | null {
  return authState.sessionJwt;
}

/**
 * Get the current session token.
 */
export function getSessionToken(): string | null {
  return authState.sessionToken;
}

/**
 * Update the persisted session token after a Stytch session exchange.
 * Session exchanges (e.g., org switch) replace the session token -- the old
 * one becomes invalid. This function saves the new token so that future
 * refreshSession() calls use the valid token.
 */
export function updateSessionToken(newSessionToken: string): void {
  authState = { ...authState, sessionToken: newSessionToken };
  // Persist to disk so the token survives app restarts
  const creds = loadStytchCredentials();
  if (creds) {
    saveStytchCredentials({ ...creds, sessionToken: newSessionToken });
  }
  logger.main.info('[StytchAuthService] Session token updated after exchange');
}

/**
 * Start Google OAuth sign-in flow.
 * Opens the collabv3 server's Google OAuth URL in the browser.
 * The server handles the callback and redirects to nimbalyst://auth/callback
 */
export async function signInWithGoogle(serverUrl?: string): Promise<{ success: boolean; error?: string }> {
  if (!stytchConfig) {
    return { success: false, error: 'Stytch not initialized' };
  }

  try {
    // Use the collabv3 server to handle OAuth
    const syncServerUrl = serverUrl || 'https://collabv3.nimbalyst.workers.dev';
    const oauthUrl = `${syncServerUrl}/auth/login/google`;

    // Open in default browser
    await shell.openExternal(oauthUrl);

    logger.main.info('[StytchAuthService] Opened Google OAuth flow via server:', oauthUrl);

    // The flow is:
    // 1. Browser opens collabv3/auth/login/google
    // 2. Server redirects to Stytch OAuth
    // 3. User authenticates with Google
    // 4. Stytch redirects to collabv3/auth/callback
    // 5. Server validates token and redirects to nimbalyst://auth/callback?session_token=...
    // 6. App receives deep link and calls handleAuthCallback()
    return { success: true };
  } catch (error) {
    logger.main.error('[StytchAuthService] Google OAuth error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Send a magic link to the user's email for passwordless authentication.
 * This calls our collabv3 server which has the secret key to send emails.
 * The magic link redirects to collabv3/auth/callback which then redirects to nimbalyst://auth/callback
 */
export async function sendMagicLink(
  email: string,
  serverUrl?: string
): Promise<{ success: boolean; error?: string }> {
  if (!stytchConfig) {
    return { success: false, error: 'Stytch not initialized' };
  }

  try {
    // Get the sync server URL from settings or use default
    const syncServerUrl = serverUrl || 'https://collabv3.nimbalyst.workers.dev';

    // The magic link callback URL is the server's auth callback (not local)
    const callbackUrl = `${syncServerUrl}/auth/callback`;

    // Call our backend server which has the Stytch secret key
    const response = await new Promise<{ success?: boolean; error?: string }>((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url: `${syncServerUrl}/api/auth/magic-link`,
      });

      request.setHeader('Content-Type', 'application/json');

      let responseData = '';

      request.on('response', (res) => {
        res.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        res.on('end', () => {
          try {
            const data = JSON.parse(responseData);
            resolve(data);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${responseData}`));
          }
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.write(JSON.stringify({
        email,
        redirect_url: callbackUrl,
      }));
      request.end();
    });

    if (response.error) {
      return { success: false, error: response.error };
    }

    logger.main.info('[StytchAuthService] Magic link sent to:', email);
    return { success: true };
  } catch (error) {
    logger.main.error('[StytchAuthService] Magic link error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  // Clear local state
  clearStytchCredentials();
  updateAuthState({
    isAuthenticated: false,
    user: null,
    session: null,
    sessionToken: null,
    sessionJwt: null,
    orgId: null,
    personalOrgId: null,
  });

  logger.main.info('[StytchAuthService] User signed out');
}

/**
 * Delete the user's account and all associated data.
 * Calls the server's /api/account/delete endpoint which cascades
 * deletes across all storage layers and deletes the Stytch member.
 * On success, clears local credentials and signs out.
 */
export async function deleteAccount(serverUrl?: string): Promise<{ success: boolean; error?: string }> {
  if (!authState.isAuthenticated || !authState.sessionJwt) {
    return { success: false, error: 'Not authenticated' };
  }

  const syncServerUrl = serverUrl || getSyncServerUrl();
  if (!syncServerUrl) {
    return { success: false, error: 'No server URL configured' };
  }

  // Convert ws:// to http:// for API calls
  const httpUrl = syncServerUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/$/, '');

  try {
    logger.main.info('[StytchAuthService] Deleting account...');

    const response = await net.fetch(`${httpUrl}/api/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authState.sessionJwt}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      logger.main.error('[StytchAuthService] Account deletion failed:', response.status, errorData.error);
      return { success: false, error: errorData.error || `Server error: ${response.status}` };
    }

    const data = await response.json() as { deleted: boolean };
    logger.main.info('[StytchAuthService] Account deletion response:', data);

    // Clear local state (same as sign out)
    await signOut();

    logger.main.info('[StytchAuthService] Account deleted successfully');
    return { success: true };
  } catch (error) {
    logger.main.error('[StytchAuthService] Account deletion error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Refresh the current session to get a fresh JWT.
 * Calls the collabv3 server's /auth/refresh endpoint.
 *
 * @param serverUrl - The sync server URL (e.g., 'https://sync.nimbalyst.com')
 * @returns true if refresh succeeded, false if session expired or failed
 */
export async function refreshSession(serverUrl?: string): Promise<boolean> {
  const creds = loadStytchCredentials();
  if (!creds?.sessionToken) {
    logger.main.warn('[StytchAuthService] Cannot refresh - no session token');
    return false;
  }

  // Determine server URL - always resolves to a valid URL
  const syncServerUrl = serverUrl || getSyncServerUrl();

  // Convert ws:// to http:// for API calls
  const httpUrl = syncServerUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/$/, '');

  try {
    logger.main.info('[StytchAuthService] Refreshing session...');

    const response = await net.fetch(`${httpUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_token: creds.sessionToken,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { expired?: boolean; error?: string };
      logger.main.warn('[StytchAuthService] Session refresh failed:', errorData.error || response.status);

      // Don't auto-signOut here - let callers decide how to handle expired sessions.
      // Auto-signOut was nuking credentials, which broke fallback logic in share handlers
      // and could sign users out unexpectedly when background operations triggered refresh.
      return false;
    }

    const data = await response.json() as {
      session_token: string;
      session_jwt: string;
      user_id: string;
      email?: string;
      expires_at: string;
      org_id?: string;
    };

    // Validate the new JWT
    if (!data.session_jwt || data.session_jwt.split('.').length !== 3) {
      logger.main.error('[StytchAuthService] Refresh returned invalid JWT');
      return false;
    }

    // Calculate expiry time
    let expiresAtMs = Date.now() + (7 * 24 * 60 * 60 * 1000); // Default: 1 week
    if (data.expires_at) {
      try {
        expiresAtMs = new Date(data.expires_at).getTime();
      } catch {
        // Use default
      }
    }

    const refreshedOrgId = data.org_id || null;
    // personalOrgId and personalUserId are NEVER overwritten by refresh -- they're
    // the stable personal org values set during initial auth or migrated on restore.
    // After a team session exchange, refresh returns the team org's member ID and org ID,
    // but we preserve the personal values for sync room IDs and encryption keys.
    const personalOrgId = authState.personalOrgId;
    const personalUserId = authState.personalUserId;
    updateAuthState({
      isAuthenticated: true,
      user: data.user_id ? {
        user_id: data.user_id,
        emails: data.email ? [{ email_id: '', email: data.email, verified: true }] : [],
        created_at: new Date().toISOString(),
        status: 'active',
      } : authState.user,
      sessionToken: data.session_token,
      sessionJwt: data.session_jwt,
      orgId: refreshedOrgId,
      personalOrgId,
      personalUserId,
    });

    // Save updated credentials
    saveStytchCredentials({
      sessionToken: data.session_token,
      sessionJwt: data.session_jwt,
      userId: data.user_id || creds.userId,
      email: data.email || creds.email,
      expiresAt: expiresAtMs,
      orgId: refreshedOrgId || undefined,
      personalOrgId: personalOrgId || undefined,
      personalUserId: personalUserId || undefined,
    });

    logger.main.info('[StytchAuthService] Session refreshed successfully');
    return true;
  } catch (error) {
    logger.main.error('[StytchAuthService] Session refresh error:', error);
    return false;
  }
}

const PRODUCTION_SYNC_URL = 'https://sync.nimbalyst.com';
const DEVELOPMENT_SYNC_URL = 'http://localhost:8790';

/**
 * Get the sync server URL. Always returns a valid URL - defaults to production.
 */
function getSyncServerUrl(): string {
  const config = getSessionSyncConfig();
  if (config?.serverUrl) return config.serverUrl;
  const isDev = process.env.NODE_ENV !== 'production';
  const env = isDev ? config?.environment : undefined;
  return env === 'development' ? DEVELOPMENT_SYNC_URL : PRODUCTION_SYNC_URL;
}

/**
 * Validate and refresh the current session if needed.
 * @deprecated Use refreshSession() instead for getting a fresh JWT
 */
export async function validateAndRefreshSession(): Promise<boolean> {
  const creds = loadStytchCredentials();
  if (creds && creds.expiresAt > Date.now()) {
    // Check if we have a valid JWT
    if (authState.sessionJwt && authState.sessionJwt.split('.').length === 3) {
      return true;
    }
    // We have a valid session but no JWT - try to refresh
    return refreshSession();
  }
  // Session expired
  await signOut();
  return false;
}

/**
 * Shutdown the auth service.
 * Call this when the app is closing.
 */
export function shutdownStytchAuth(): void {
  // Nothing to clean up - device tokens removed, auth state managed by Stytch
}

/**
 * Switch Stytch environment. Signs out and reinitializes.
 */
export async function switchStytchEnvironment(_environment: 'development' | 'production'): Promise<void> {
  await signOut();

  const config = STYTCH_CONFIG.live;
  initializeStytchAuth({
    projectId: config.projectId,
    publicToken: config.publicToken,
    apiBase: config.apiBase,
  });

  logger.main.info('[StytchAuthService] Reinitialized with projectId:', config.projectId);
}

