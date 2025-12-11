/**
 * Stytch Authentication Service for Mobile
 *
 * Handles Stytch OAuth authentication on mobile devices.
 * Uses the collabv3 server as the OAuth callback handler to get session tokens.
 *
 * Flow:
 * 1. Mobile opens browser to server's /auth/login/google endpoint
 * 2. User authenticates with Google via Stytch
 * 3. Stytch redirects to server's /auth/callback
 * 4. Server exchanges token and redirects to nimbalyst:// deep link with session data
 * 5. Mobile receives deep link and stores session tokens
 * 6. Mobile uses JWT for sync server authentication
 *
 * Security: Session credentials are stored encrypted using iOS Keychain / Android Keystore
 * via capacitor-secure-storage-plugin.
 */

import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';

const STYTCH_SESSION_KEY = 'nimbalyst_stytch_session';

export interface StytchSession {
  sessionToken: string;
  sessionJwt: string;
  userId: string;
  email: string;
  expiresAt: string;
  refreshedAt: number; // When we last refreshed the JWT
}

let cachedSession: StytchSession | null = null;
let hasCheckedSession = false;
let refreshPromise: Promise<boolean> | null = null;

/**
 * Save Stytch session to secure storage (iOS Keychain / Android Keystore).
 */
export async function saveSession(session: StytchSession): Promise<void> {
  await SecureStoragePlugin.set({
    key: STYTCH_SESSION_KEY,
    value: JSON.stringify(session),
  });
  cachedSession = session;
  hasCheckedSession = true;
  console.log('[StytchAuth] Session saved securely for user:', session.email);
}

/**
 * Load Stytch session from secure storage.
 * Results are cached to avoid repeated native calls.
 */
export async function loadSession(): Promise<StytchSession | null> {
  // Return cached result if we've already checked
  if (hasCheckedSession) {
    return cachedSession;
  }

  try {
    const { value } = await SecureStoragePlugin.get({ key: STYTCH_SESSION_KEY });
    if (value) {
      cachedSession = JSON.parse(value);
    }
  } catch (error) {
    // SecureStoragePlugin throws an error if the key doesn't exist
    // This is expected on first launch, so only log if it's an unexpected error
    if (error instanceof Error && !error.message.includes('does not exist')) {
      console.error('[StytchAuth] Failed to load session:', error);
    }
  }

  hasCheckedSession = true;
  return cachedSession;
}

/**
 * Clear Stytch session (logout).
 */
export async function clearSession(): Promise<void> {
  try {
    await SecureStoragePlugin.remove({ key: STYTCH_SESSION_KEY });
  } catch (error) {
    // Key may not exist if user was never logged in
    if (error instanceof Error && !error.message.includes('does not exist')) {
      console.error('[StytchAuth] Failed to clear session:', error);
    }
  }
  cachedSession = null;
  hasCheckedSession = true; // Keep flag true since we know it's now cleared
  console.log('[StytchAuth] Session cleared');
}

/**
 * Check if user is authenticated.
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await loadSession();
  return session !== null && session.sessionJwt !== '';
}

/**
 * Get current user ID.
 */
export async function getUserId(): Promise<string | null> {
  const session = await loadSession();
  return session?.userId ?? null;
}

/**
 * Get current session JWT for sync server authentication.
 * Automatically refreshes if JWT is stale (older than 4 minutes).
 */
export async function getSessionJwt(serverUrl: string): Promise<string | null> {
  const session = await loadSession();
  if (!session?.sessionJwt) {
    console.log('[StytchAuth] getSessionJwt: No session JWT in storage');
    return null;
  }

  // Check if JWT needs refresh (refresh if older than 4 minutes)
  const jwtAge = Date.now() - (session.refreshedAt || 0);
  const REFRESH_THRESHOLD = 4 * 60 * 1000; // 4 minutes

  console.log('[StytchAuth] getSessionJwt: jwtAge =', jwtAge, 'ms, threshold =', REFRESH_THRESHOLD, 'ms, refreshedAt =', session.refreshedAt);

  if (jwtAge > REFRESH_THRESHOLD) {
    console.log('[StytchAuth] JWT is stale (', Math.round(jwtAge / 1000), 's old), refreshing...');
    const refreshed = await refreshSession(serverUrl);
    if (refreshed) {
      const updatedSession = await loadSession();
      console.log('[StytchAuth] JWT refreshed successfully, new refreshedAt =', updatedSession?.refreshedAt);
      return updatedSession?.sessionJwt ?? null;
    }
    // If refresh failed, return existing JWT (might still work)
    console.warn('[StytchAuth] JWT refresh failed, using existing (possibly expired) JWT');
  } else {
    console.log('[StytchAuth] JWT is fresh (', Math.round(jwtAge / 1000), 's old), using existing');
  }

  return session.sessionJwt;
}

/**
 * Refresh the session to get a fresh JWT.
 * Uses the server's /auth/refresh endpoint.
 */
export async function refreshSession(serverUrl: string): Promise<boolean> {
  // Prevent concurrent refresh calls
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = doRefreshSession(serverUrl);
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function doRefreshSession(serverUrl: string): Promise<boolean> {
  const session = await loadSession();
  if (!session?.sessionToken) {
    console.warn('[StytchAuth] No session token to refresh');
    return false;
  }

  try {
    // Convert ws:// to https:// for API calls
    const apiUrl = serverUrl.replace(/^ws/, 'http').replace(/\/$/, '');

    const response = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_token: session.sessionToken,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[StytchAuth] Refresh failed:', response.status, error);

      // If session is expired, clear it
      if (response.status === 401 || error.expired) {
        await clearSession();
      }
      return false;
    }

    const data = await response.json();

    // Update session with fresh tokens
    const updatedSession: StytchSession = {
      sessionToken: data.session_token,
      sessionJwt: data.session_jwt,
      userId: data.user_id || session.userId,
      email: data.email || session.email,
      expiresAt: data.expires_at || session.expiresAt,
      refreshedAt: Date.now(),
    };

    await saveSession(updatedSession);
    console.log('[StytchAuth] Session refreshed successfully');
    return true;
  } catch (error) {
    console.error('[StytchAuth] Refresh error:', error);
    return false;
  }
}

/**
 * Start Google OAuth login flow.
 * Opens the system browser (Safari) to the server's OAuth endpoint.
 * Using the system browser allows users to use saved passwords/passkeys.
 */
export async function startGoogleLogin(serverUrl: string): Promise<void> {
  // Convert ws:// to https:// for the login URL
  const loginUrl = serverUrl.replace(/^ws/, 'http').replace(/\/$/, '') + '/auth/login/google';

  console.log('[StytchAuth] Starting Google login:', loginUrl);

  // Open in system browser (Safari) for better security and UX
  // Users can use saved passwords, passkeys, and autofill
  await Browser.open({
    url: loginUrl,
    windowName: '_system',
  });
}

/**
 * Send a magic link to the user's email for passwordless authentication.
 * The magic link will redirect through the server and back to the app via deep link.
 */
export async function sendMagicLink(
  email: string,
  serverUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Convert ws:// to https:// for API calls
    const apiUrl = serverUrl.replace(/^ws/, 'http').replace(/\/$/, '');

    console.log('[StytchAuth] Sending magic link to:', email);

    const response = await fetch(`${apiUrl}/api/auth/magic-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        redirect_url: `${apiUrl}/auth/callback`,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[StytchAuth] Magic link failed:', response.status, error);
      return {
        success: false,
        error: error.error_message || error.message || `Request failed with status ${response.status}`,
      };
    }

    console.log('[StytchAuth] Magic link sent successfully');
    return { success: true };
  } catch (error) {
    console.error('[StytchAuth] Magic link error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send magic link',
    };
  }
}

/**
 * Handle the OAuth callback deep link.
 * Called when the app receives a nimbalyst://auth/callback URL.
 */
export async function handleAuthCallback(url: string): Promise<boolean> {
  try {
    const urlObj = new URL(url);

    // Extract session data from query params
    const sessionToken = urlObj.searchParams.get('session_token');
    const sessionJwt = urlObj.searchParams.get('session_jwt');
    const userId = urlObj.searchParams.get('user_id');
    const email = urlObj.searchParams.get('email');
    const expiresAt = urlObj.searchParams.get('expires_at');

    if (!sessionToken || !sessionJwt || !userId) {
      console.error('[StytchAuth] Missing required params in callback:', url);
      return false;
    }

    const session: StytchSession = {
      sessionToken,
      sessionJwt,
      userId,
      email: email || '',
      expiresAt: expiresAt || '',
      refreshedAt: Date.now(),
    };

    await saveSession(session);

    // Try to close the browser (may fail if using external browser for magic link)
    try {
      await Browser.close();
    } catch {
      // Ignore - browser may not be open (e.g., magic link from email app)
    }

    console.log('[StytchAuth] Auth callback handled successfully for:', email);
    return true;
  } catch (error) {
    console.error('[StytchAuth] Failed to handle auth callback:', error);
    return false;
  }
}

/**
 * Set up deep link listener for auth callbacks.
 * Should be called once at app startup.
 */
export function setupDeepLinkListener(
  onAuthSuccess: (session: StytchSession) => void,
  onAuthError: (error: string) => void
): () => void {
  // In browser environment, Capacitor plugins may not be available or work differently
  // The addListener returns a Promise in web, but PluginListenerHandle in native
  let listenerHandle: { remove: () => void } | null = null;
  let isCleanedUp = false;

  // Set up the listener asynchronously
  (async () => {
    try {
      const result = await CapacitorApp.addListener('appUrlOpen', async (event) => {
        const url = event.url;

        // Check if this is an auth callback
        if (url.startsWith('nimbalyst://auth/callback')) {
          console.log('[StytchAuth] Received auth callback:', url);

          const success = await handleAuthCallback(url);
          if (success) {
            const session = await loadSession();
            if (session) {
              onAuthSuccess(session);
            }
          } else {
            onAuthError('Failed to process authentication');
          }
        }
      });

      // Store the handle for cleanup, but only if we haven't been cleaned up already
      if (!isCleanedUp && result && typeof result.remove === 'function') {
        listenerHandle = result;
      } else if (isCleanedUp && result && typeof result.remove === 'function') {
        // We were cleaned up while setting up, so clean up immediately
        result.remove();
      }
    } catch (error) {
      console.warn('[StytchAuth] Deep link listener not available (browser mode):', error);
    }
  })();

  // Return cleanup function
  return () => {
    isCleanedUp = true;
    if (listenerHandle && typeof listenerHandle.remove === 'function') {
      listenerHandle.remove();
    }
  };
}
