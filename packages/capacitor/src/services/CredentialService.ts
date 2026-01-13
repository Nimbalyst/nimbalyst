/**
 * CredentialService for Capacitor (Mobile)
 *
 * Stores sync credentials securely using iOS Keychain / Android Keystore
 * via capacitor-secure-storage-plugin.
 *
 * Authentication is handled separately by StytchAuthService.
 * This service stores the encryption key seed from QR pairing.
 *
 * Security: The encryptionKeySeed is the E2E encryption secret - it MUST be
 * stored securely. This is now handled by the secure storage plugin which
 * uses platform-native secure storage (Keychain/Keystore).
 */

import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

export interface SyncCredentials {
  encryptionKeySeed: string; // Base64 encoded 32 bytes - the E2E encryption secret
  serverUrl: string;
  pairedAt: number; // When the QR was scanned
}

const CREDENTIALS_KEY = 'nimbalyst_sync_credentials_v2';

let cachedCredentials: SyncCredentials | null = null;
let hasCheckedCredentials = false;

/**
 * Save credentials from QR code scan to secure storage.
 */
export async function saveCredentials(credentials: SyncCredentials): Promise<void> {
  await SecureStoragePlugin.set({
    key: CREDENTIALS_KEY,
    value: JSON.stringify(credentials),
  });
  cachedCredentials = credentials;
  hasCheckedCredentials = true;
  console.log('[CredentialService] Credentials saved securely', {
    serverUrl: credentials.serverUrl,
  });
}

/**
 * Load credentials from secure storage.
 * Results are cached to avoid repeated native calls.
 */
export async function loadCredentials(): Promise<SyncCredentials | null> {
  // Return cached result if we've already checked
  if (hasCheckedCredentials) {
    return cachedCredentials;
  }

  try {
    const { value } = await SecureStoragePlugin.get({ key: CREDENTIALS_KEY });
    if (value) {
      cachedCredentials = JSON.parse(value);
      console.log('[CredentialService] Credentials loaded from secure storage', {
        serverUrl: cachedCredentials?.serverUrl,
      });
    }
  } catch (error) {
    // SecureStoragePlugin throws an error if the key doesn't exist
    // This is expected on first launch before QR pairing
    if (error instanceof Error && !error.message.includes('does not exist')) {
      console.error('[CredentialService] Failed to load credentials:', error);
    }
  }

  hasCheckedCredentials = true;
  return cachedCredentials;
}

/**
 * Check if credentials exist (without loading full data).
 */
export async function hasCredentials(): Promise<boolean> {
  // Use loadCredentials to leverage the cache
  const creds = await loadCredentials();
  return creds !== null;
}

/**
 * Clear credentials (disconnect from sync).
 */
export async function clearCredentials(): Promise<void> {
  try {
    await SecureStoragePlugin.remove({ key: CREDENTIALS_KEY });
  } catch (error) {
    // Key may not exist if credentials were never saved
    if (error instanceof Error && !error.message.includes('does not exist')) {
      console.error('[CredentialService] Failed to clear credentials:', error);
    }
  }
  cachedCredentials = null;
  hasCheckedCredentials = true; // Keep flag true since we know it's now cleared
  console.log('[CredentialService] Credentials cleared');
}

/**
 * Get the server URL.
 */
export async function getServerUrl(): Promise<string | null> {
  const creds = await loadCredentials();
  return creds?.serverUrl ?? null;
}

/**
 * Get the encryption key seed (for deriving the E2E encryption key).
 */
export async function getEncryptionKeySeed(): Promise<string | null> {
  const creds = await loadCredentials();
  return creds?.encryptionKeySeed ?? null;
}

/**
 * Parse QR code payload and create credentials.
 *
 * QR payload format (v3 - with analytics):
 * {
 *   version: 3,
 *   serverUrl: "wss://...",
 *   encryptionKeySeed: "base64-key-seed",
 *   expiresAt: timestamp,
 *   analyticsId: "nimbalyst_xxx..."  // Desktop's PostHog distinctId
 * }
 *
 * Note: Auth credentials (userId, authToken) are no longer in QR.
 * Mobile authenticates via Stytch OAuth separately.
 */
export interface QRPayload {
  version: number;
  serverUrl: string;
  encryptionKeySeed: string;
  expiresAt: number;
  // v3: Desktop's PostHog analytics ID for identity linking
  analyticsId?: string;
  // Legacy fields (v1) - ignored but accepted for backwards compat
  userId?: string;
  authToken?: string;
}

export function parseQRPayload(data: string): QRPayload | null {
  try {
    // Trim whitespace that might be in the copied text
    const trimmedData = data.trim();

    const payload = JSON.parse(trimmedData);

    // Validate required fields
    if (typeof payload.version !== 'number') {
      console.error('[CredentialService] Invalid QR payload: missing or invalid version field');
      return null;
    }
    if (typeof payload.serverUrl !== 'string') {
      console.error('[CredentialService] Invalid QR payload: missing or invalid serverUrl field');
      return null;
    }
    if (typeof payload.encryptionKeySeed !== 'string') {
      console.error('[CredentialService] Invalid QR payload: missing or invalid encryptionKeySeed field');
      return null;
    }
    if (typeof payload.expiresAt !== 'number') {
      console.error('[CredentialService] Invalid QR payload: missing or invalid expiresAt field');
      return null;
    }

    // Check expiry
    if (payload.expiresAt < Date.now()) {
      console.error('[CredentialService] QR code has expired. expiresAt:', payload.expiresAt, 'now:', Date.now());
      return null;
    }

    return payload as QRPayload;
  } catch (error) {
    console.error('[CredentialService] Failed to parse QR payload:', error, 'data:', data.substring(0, 100));
    return null;
  }
}

/**
 * Save credentials from QR payload.
 */
export async function saveFromQRPayload(payload: QRPayload): Promise<SyncCredentials> {
  const credentials: SyncCredentials = {
    encryptionKeySeed: payload.encryptionKeySeed,
    serverUrl: payload.serverUrl,
    pairedAt: Date.now(),
  };

  await saveCredentials(credentials);
  return credentials;
}
