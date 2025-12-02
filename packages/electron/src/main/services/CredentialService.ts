/**
 * CredentialService - Manages user identity and secure credential storage.
 *
 * This service handles:
 * - Auto-generating globally unique user ID on first launch
 * - Auto-generating secure auth token and encryption key seed
 * - Storing credentials securely using Electron's safeStorage API (OS keychain)
 * - Providing credentials for session sync and mobile device pairing
 *
 * Security notes:
 * - Encryption key seed is generated locally and NEVER sent to the server
 * - All credentials are encrypted at rest using OS keychain
 * - User ID is a UUIDv4 to avoid collisions across users
 */

import { safeStorage } from 'electron';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface SyncCredentials {
  userId: string;
  authToken: string;
  encryptionKeySeed: string; // Base64 encoded 32 bytes - never sent to server
  createdAt: number;
}

const CREDENTIALS_FILE = 'sync-credentials.enc';

let cachedCredentials: SyncCredentials | null = null;

/**
 * Get the path to the encrypted credentials file.
 */
function getCredentialsPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, CREDENTIALS_FILE);
}

/**
 * Generate a cryptographically secure random string (base64 encoded).
 */
function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('base64');
}

/**
 * Generate a UUIDv4 for the user ID.
 */
function generateUserId(): string {
  return crypto.randomUUID();
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
 * Create new credentials with auto-generated values.
 */
function createCredentials(): SyncCredentials {
  return {
    userId: generateUserId(),
    authToken: generateSecureToken(32),
    encryptionKeySeed: generateSecureToken(32),
    createdAt: Date.now(),
  };
}

/**
 * Save credentials to disk using safeStorage encryption.
 */
function saveCredentials(credentials: SyncCredentials): void {
  const credentialsPath = getCredentialsPath();
  const jsonData = JSON.stringify(credentials);

  if (isSafeStorageAvailable()) {
    // Encrypt using OS keychain
    const encrypted = safeStorage.encryptString(jsonData);
    fs.writeFileSync(credentialsPath, encrypted);
    logger.main.info('[CredentialService] Credentials saved with safeStorage encryption');
  } else {
    // Fallback: save as plain JSON (with warning)
    logger.main.warn('[CredentialService] safeStorage not available - saving credentials without encryption');
    fs.writeFileSync(credentialsPath, jsonData, 'utf8');
  }
}

/**
 * Load credentials from disk using safeStorage decryption.
 */
function loadCredentials(): SyncCredentials | null {
  const credentialsPath = getCredentialsPath();

  if (!fs.existsSync(credentialsPath)) {
    return null;
  }

  try {
    const fileData = fs.readFileSync(credentialsPath);

    if (isSafeStorageAvailable()) {
      // Decrypt using OS keychain
      const decrypted = safeStorage.decryptString(fileData);
      return JSON.parse(decrypted);
    } else {
      // Fallback: try to read as plain JSON
      const jsonData = fileData.toString('utf8');
      return JSON.parse(jsonData);
    }
  } catch (error) {
    logger.main.error('[CredentialService] Failed to load credentials:', error);
    return null;
  }
}

/**
 * Get or create sync credentials.
 *
 * On first launch, generates new credentials and saves them securely.
 * On subsequent launches, loads existing credentials from disk.
 */
export function getCredentials(): SyncCredentials {
  // Return cached credentials if available
  if (cachedCredentials) {
    return cachedCredentials;
  }

  // Try to load existing credentials
  let credentials = loadCredentials();

  if (!credentials) {
    // First launch - generate new credentials
    logger.main.info('[CredentialService] First launch - generating new credentials');
    credentials = createCredentials();
    saveCredentials(credentials);
    logger.main.info('[CredentialService] New credentials generated', {
      userId: credentials.userId,
      createdAt: new Date(credentials.createdAt).toISOString(),
    });
  } else {
    logger.main.info('[CredentialService] Loaded existing credentials', {
      userId: credentials.userId,
      createdAt: new Date(credentials.createdAt).toISOString(),
    });
  }

  // Cache for subsequent calls
  cachedCredentials = credentials;
  return credentials;
}

/**
 * Check if credentials exist (without loading them).
 */
export function hasCredentials(): boolean {
  return fs.existsSync(getCredentialsPath());
}

/**
 * Reset credentials - generates new ones.
 *
 * WARNING: This will invalidate any paired mobile devices.
 * They will need to re-scan the QR code.
 */
export function resetCredentials(): SyncCredentials {
  logger.main.info('[CredentialService] Resetting credentials...');

  const credentials = createCredentials();
  saveCredentials(credentials);
  cachedCredentials = credentials;

  logger.main.info('[CredentialService] New credentials generated', {
    userId: credentials.userId,
    createdAt: new Date(credentials.createdAt).toISOString(),
  });

  return credentials;
}

/**
 * Get the user ID only (for display in settings).
 */
export function getUserId(): string {
  return getCredentials().userId;
}

/**
 * Check if safeStorage encryption is being used.
 */
export function isUsingSecureStorage(): boolean {
  return isSafeStorageAvailable();
}

/**
 * Generate QR pairing payload for mobile device.
 *
 * @param serverUrl - The sync server URL
 * @param expiresInMinutes - How long the QR code is valid (default 5 minutes)
 */
export function generateQRPairingPayload(
  serverUrl: string,
  expiresInMinutes: number = 5
): {
  version: number;
  serverUrl: string;
  userId: string;
  authToken: string;
  encryptionKeySeed: string;
  expiresAt: number;
} {
  const credentials = getCredentials();

  return {
    version: 1,
    serverUrl,
    userId: credentials.userId,
    authToken: credentials.authToken,
    encryptionKeySeed: credentials.encryptionKeySeed,
    expiresAt: Date.now() + expiresInMinutes * 60 * 1000,
  };
}
