/**
 * CredentialService for Capacitor (Mobile)
 *
 * Stores sync credentials securely using Capacitor Preferences.
 * On iOS, Preferences data is stored in UserDefaults which is sandboxed
 * and encrypted at rest when device is locked.
 *
 * Credentials come from QR code scanning - the desktop app generates them
 * and transfers via QR. The encryption key seed is the critical secret
 * that enables E2E encryption.
 *
 * Note: For enhanced security in production, consider using:
 * - @capacitor-community/secure-storage (iOS Keychain, Android Keystore)
 * - @capacitor/ios Keychain access directly
 */

import { Preferences } from '@capacitor/preferences';

export interface SyncCredentials {
  userId: string;
  authToken: string;
  encryptionKeySeed: string; // Base64 encoded 32 bytes - the E2E encryption secret
  serverUrl: string;
  createdAt: number;
  pairedAt: number; // When the QR was scanned
}

const CREDENTIALS_KEY = 'nimbalyst_sync_credentials';

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
    userId: credentials.userId,
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
        userId: cachedCredentials?.userId,
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
 * Get the user ID only.
 */
export async function getUserId(): Promise<string | null> {
  const creds = await loadCredentials();
  return creds?.userId ?? null;
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
 * QR payload format:
 * {
 *   version: 1,
 *   serverUrl: "wss://...",
 *   userId: "uuid",
 *   authToken: "base64-token",
 *   encryptionKeySeed: "base64-key-seed",
 *   expiresAt: timestamp
 * }
 */
export interface QRPayload {
  version: number;
  serverUrl: string;
  userId: string;
  authToken: string;
  encryptionKeySeed: string;
  expiresAt: number;
}

export function parseQRPayload(data: string): QRPayload | null {
  try {
    const payload = JSON.parse(data);

    // Validate required fields
    if (
      typeof payload.version !== 'number' ||
      typeof payload.serverUrl !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.authToken !== 'string' ||
      typeof payload.encryptionKeySeed !== 'string' ||
      typeof payload.expiresAt !== 'number'
    ) {
      console.error('[CredentialService] Invalid QR payload: missing required fields');
      return null;
    }

    // Check expiry
    if (payload.expiresAt < Date.now()) {
      console.error('[CredentialService] QR code has expired');
      return null;
    }

    return payload as QRPayload;
  } catch (error) {
    console.error('[CredentialService] Failed to parse QR payload:', error);
    return null;
  }
}

/**
 * Save credentials from QR payload.
 */
export async function saveFromQRPayload(payload: QRPayload): Promise<SyncCredentials> {
  const credentials: SyncCredentials = {
    userId: payload.userId,
    authToken: payload.authToken,
    encryptionKeySeed: payload.encryptionKeySeed,
    serverUrl: payload.serverUrl,
    createdAt: Date.now(),
    pairedAt: Date.now(),
  };

  await saveCredentials(credentials);
  return credentials;
}

/**
 * Convert credentials to the SyncConfig format used by CollabV3SyncContext.
 */
export async function toSyncConfig(): Promise<{
  serverUrl: string;
  userId: string;
  authToken: string;
  encryptionPassphrase?: string;
} | null> {
  const creds = await loadCredentials();
  if (!creds) {
    return null;
  }

  return {
    serverUrl: creds.serverUrl,
    userId: creds.userId,
    authToken: creds.authToken,
    // Use the encryption key seed as the passphrase for key derivation
    encryptionPassphrase: creds.encryptionKeySeed,
  };
}
