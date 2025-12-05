/**
 * StytchAuthService - Manages user authentication via Stytch Consumer platform.
 *
 * This service handles:
 * - Google OAuth sign-in/sign-up (via browser redirect to collabv3 server)
 * - Email magic link authentication (via collabv3 server)
 * - Session token management
 * - Device token issuance for mobile pairing
 *
 * Security architecture:
 * - All authentication flows go through the collabv3 Cloudflare Worker
 * - The desktop app NEVER has access to the Stytch secret key
 * - OAuth flow: opens browser -> collabv3/auth/login/google -> Stytch -> collabv3/auth/callback -> nimbalyst:// deep link
 * - Magic links: collabv3 sends email (has secret key), callback to collabv3, then deep link to app
 * - Session tokens received via deep link are stored securely using Electron's safeStorage
 *
 * Deep link format: nimbalyst://auth/callback?session_token=...&user_id=...&email=...
 */

import { safeStorage, shell, net } from 'electron';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

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
}

interface StoredStytchCredentials {
  sessionToken: string;
  sessionJwt: string;
  userId: string;
  email?: string;
  expiresAt: number;
}

interface DeviceToken {
  token: string;
  deviceId: string;
  userId: string;
  createdAt: number;
  lastUsedAt: number;
  deviceName?: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
}

// Stytch configuration - PUBLIC TOKEN ONLY, no secret key!
interface StytchConfig {
  projectId: string;
  publicToken: string;
  apiBase: string; // 'https://test.stytch.com/v1' for test, 'https://api.stytch.com/v1' for live
}

// File names for persistent storage
const STYTCH_CREDENTIALS_FILE = 'stytch-credentials.enc';
const DEVICE_TOKENS_FILE = 'device-tokens.enc';

// Singleton state
let authState: StytchAuthState = {
  isAuthenticated: false,
  user: null,
  session: null,
  sessionToken: null,
  sessionJwt: null,
};

let stytchConfig: StytchConfig | null = null;
let deviceTokens: Map<string, DeviceToken> = new Map();

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
 * Get the path to the device tokens file.
 */
function getDeviceTokensPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, DEVICE_TOKENS_FILE);
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
    logger.main.info('[StytchAuthService] Credentials saved with safeStorage encryption');
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
 * Save device tokens securely.
 */
function saveDeviceTokens(): void {
  const tokensPath = getDeviceTokensPath();
  const jsonData = JSON.stringify(Array.from(deviceTokens.entries()));

  if (isSafeStorageAvailable()) {
    const encrypted = safeStorage.encryptString(jsonData);
    fs.writeFileSync(tokensPath, encrypted);
  } else {
    fs.writeFileSync(tokensPath, jsonData, 'utf8');
  }
}

/**
 * Load device tokens from secure storage.
 */
function loadDeviceTokens(): void {
  const tokensPath = getDeviceTokensPath();

  if (!fs.existsSync(tokensPath)) {
    return;
  }

  try {
    const fileData = fs.readFileSync(tokensPath);
    let jsonData: string;

    if (isSafeStorageAvailable()) {
      jsonData = safeStorage.decryptString(fileData);
    } else {
      jsonData = fileData.toString('utf8');
    }

    const entries: [string, DeviceToken][] = JSON.parse(jsonData);
    deviceTokens = new Map(entries);
    logger.main.info('[StytchAuthService] Loaded', deviceTokens.size, 'device tokens');
  } catch (error) {
    logger.main.error('[StytchAuthService] Failed to load device tokens:', error);
    deviceTokens = new Map();
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

/**
 * Generate a secure random device token.
 */
function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a device ID for mobile pairing.
 */
function generateDeviceId(): string {
  return crypto.randomUUID();
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
  loadDeviceTokens();

  logger.main.info('[StytchAuthService] Initialized with project:', config.projectId);

  // Try to restore session from saved credentials
  const savedCredentials = loadStytchCredentials();
  if (savedCredentials && savedCredentials.expiresAt > Date.now()) {
    authState = {
      isAuthenticated: true,
      user: savedCredentials.userId ? {
        user_id: savedCredentials.userId,
        emails: savedCredentials.email ? [{ email_id: '', email: savedCredentials.email, verified: true }] : [],
        created_at: new Date().toISOString(),
        status: 'active',
      } : null,
      session: null,
      sessionToken: savedCredentials.sessionToken,
      sessionJwt: savedCredentials.sessionJwt,
    };
    logger.main.info('[StytchAuthService] Restored session for user:', savedCredentials.userId, savedCredentials.email);
  } else if (savedCredentials) {
    logger.main.info('[StytchAuthService] Saved session has expired, clearing');
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
}): Promise<void> {
  const { sessionToken, sessionJwt, userId, email, expiresAt } = params;

  // Calculate expiry time
  let expiresAtMs = Date.now() + (7 * 24 * 60 * 60 * 1000); // Default: 1 week
  if (expiresAt) {
    try {
      expiresAtMs = new Date(expiresAt).getTime();
    } catch {
      // Use default
    }
  }

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
    sessionJwt: sessionJwt || null,
  });

  // Save credentials for persistence
  saveStytchCredentials({
    sessionToken,
    sessionJwt: sessionJwt || '',
    userId: userId || '',
    email: email || '',
    expiresAt: expiresAtMs,
  });

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
  });

  logger.main.info('[StytchAuthService] User signed out');
}

/**
 * Validate and refresh the current session.
 * Note: This requires the session_token from a previous auth.
 */
export async function validateAndRefreshSession(): Promise<boolean> {
  // With public token only, we can't validate sessions server-side
  // The session tokens we store are already validated
  // We just check if they're expired
  const creds = loadStytchCredentials();
  if (creds && creds.expiresAt > Date.now()) {
    return true;
  }
  // Session expired
  await signOut();
  return false;
}

/**
 * Issue a device token for mobile pairing.
 * This token allows the mobile device to authenticate to the server.
 */
export function issueDeviceToken(
  deviceName: string,
  deviceType: 'mobile' | 'tablet' = 'mobile'
): DeviceToken | null {
  if (!authState.isAuthenticated) {
    logger.main.warn('[StytchAuthService] Cannot issue device token - not authenticated');
    return null;
  }

  // Get user ID from stored credentials if not in auth state
  const creds = loadStytchCredentials();
  const userId = authState.user?.user_id || creds?.userId;

  if (!userId) {
    logger.main.warn('[StytchAuthService] Cannot issue device token - no user ID');
    return null;
  }

  const token: DeviceToken = {
    token: generateDeviceToken(),
    deviceId: generateDeviceId(),
    userId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    deviceName,
    deviceType,
  };

  deviceTokens.set(token.deviceId, token);
  saveDeviceTokens();

  logger.main.info('[StytchAuthService] Issued device token for:', deviceName);
  return token;
}

/**
 * Validate a device token.
 * Returns the user ID if valid, null otherwise.
 */
export function validateDeviceToken(token: string): { userId: string; deviceId: string } | null {
  for (const [deviceId, deviceToken] of deviceTokens) {
    if (deviceToken.token === token) {
      // Update last used time
      deviceToken.lastUsedAt = Date.now();
      saveDeviceTokens();
      return { userId: deviceToken.userId, deviceId };
    }
  }
  return null;
}

/**
 * Revoke a device token.
 */
export function revokeDeviceToken(deviceId: string): boolean {
  const deleted = deviceTokens.delete(deviceId);
  if (deleted) {
    saveDeviceTokens();
    logger.main.info('[StytchAuthService] Revoked device token:', deviceId);
  }
  return deleted;
}

/**
 * Get all device tokens for the current user.
 */
export function getDeviceTokens(): DeviceToken[] {
  const creds = loadStytchCredentials();
  const userId = authState.user?.user_id || creds?.userId;
  if (!userId) {
    return [];
  }
  return Array.from(deviceTokens.values()).filter(
    (token) => token.userId === userId
  );
}

/**
 * Shutdown the auth service.
 * Call this when the app is closing.
 */
export function shutdownStytchAuth(): void {
  saveDeviceTokens();
}

