/**
 * CredentialService for Capacitor (Mobile)
 *
 * Stores sync credentials securely using Capacitor Preferences.
 * On iOS, Preferences data is stored in UserDefaults which is sandboxed
 * and encrypted at rest when device is locked.
 *
 * Authentication is handled separately by StytchAuthService.
 * This service only stores the encryption key seed from QR pairing.
 *
 * Note: For enhanced security in production, consider using:
 * - @capacitor-community/secure-storage (iOS Keychain, Android Keystore)
 * - @capacitor/ios Keychain access directly
 */

import { Preferences } from '@capacitor/preferences';

export interface SyncCredentials {
  encryptionKeySeed: string; // Base64 encoded 32 bytes - the E2E encryption secret
  serverUrl: string;
  pairedAt: number; // When the QR was scanned
}

const CREDENTIALS_KEY = 'nimbalyst_sync_credentials_v2';

let cachedCredentials: SyncCredentials | null = null;

/**
 * Save credentials from QR code scan.
 */
export async function saveCredentials(credentials: SyncCredentials): Promise<void> {
  await Preferences.set({
    key: CREDENTIALS_KEY,
    value: JSON.stringify(credentials),
  });
  cachedCredentials = credentials;
  console.log('[CredentialService] Credentials saved', {
    serverUrl: credentials.serverUrl,
  });
}

/**
 * Load credentials from storage.
 */
export async function loadCredentials(): Promise<SyncCredentials | null> {
  // Return cached if available
  if (cachedCredentials) {
    return cachedCredentials;
  }

  try {
    const { value } = await Preferences.get({ key: CREDENTIALS_KEY });
    if (value) {
      cachedCredentials = JSON.parse(value);
      console.log('[CredentialService] Credentials loaded', {
        serverUrl: cachedCredentials?.serverUrl,
      });
      return cachedCredentials;
    }
  } catch (error) {
    console.error('[CredentialService] Failed to load credentials:', error);
  }
  return null;
}

/**
 * Check if credentials exist (without loading full data).
 */
export async function hasCredentials(): Promise<boolean> {
  if (cachedCredentials) {
    return true;
  }
  const { value } = await Preferences.get({ key: CREDENTIALS_KEY });
  return value !== null;
}

/**
 * Clear credentials (disconnect from sync).
 */
export async function clearCredentials(): Promise<void> {
  await Preferences.remove({ key: CREDENTIALS_KEY });
  cachedCredentials = null;
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
 * New QR payload format (v2 - Stytch auth):
 * {
 *   version: 2,
 *   serverUrl: "wss://...",
 *   encryptionKeySeed: "base64-key-seed",
 *   expiresAt: timestamp
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
