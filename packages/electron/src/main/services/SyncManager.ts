/**
 * SyncManager - Manages optional session sync.
 *
 * This service is responsible for:
 * - Reading sync configuration from app settings
 * - Creating and managing the SyncProvider instance
 * - Wrapping the session store with sync capabilities when enabled
 *
 * Supports two sync backends:
 * - CollabV3 (recommended): Simple append-only protocol with DO SQLite storage
 * - Y.js (legacy): CRDT-based sync with D1 BLOB storage
 *
 * The sync feature is completely optional. If not configured, nothing happens.
 */

import type { SessionStore } from '@nimbalyst/runtime';
import type { DeviceInfo } from '@nimbalyst/runtime/sync';
import { getSessionSyncConfig, type SessionSyncConfig } from '../utils/store';
import { logger } from '../utils/logger';
import { getCredentials } from './CredentialService';
import { getStytchUserId, isAuthenticated } from './StytchAuthService';
import { app } from 'electron';
import * as os from 'os';

// Lazy import to avoid loading sync code if not needed
let syncModule: typeof import('@nimbalyst/runtime/sync') | null = null;

async function loadSyncModule() {
  if (!syncModule) {
    syncModule = await import('@nimbalyst/runtime/sync');
  }
  return syncModule;
}

/**
 * Derive an encryption key from a passphrase using PBKDF2.
 * This is used for E2E encryption in CollabV3.
 */
async function deriveEncryptionKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

interface SyncManagerState {
  provider: import('@nimbalyst/runtime/sync').SyncProvider | null;
  config: SessionSyncConfig | null;
  messageSyncHandler: ReturnType<typeof import('@nimbalyst/runtime/sync').createMessageSyncHandler> | null;
  connected: boolean;
  syncing: boolean;
  error: string | null;
}

const state: SyncManagerState = {
  provider: null,
  config: null,
  messageSyncHandler: null,
  connected: false,
  syncing: false,
  error: null,
};

// Event emitter for sync status changes
type SyncStatusListener = (status: { connected: boolean; syncing: boolean; error: string | null }) => void;
const statusListeners = new Set<SyncStatusListener>();

/**
 * Subscribe to sync status changes.
 * Returns an unsubscribe function.
 */
export function onSyncStatusChange(listener: SyncStatusListener): () => void {
  statusListeners.add(listener);
  // Immediately emit current status
  listener({ connected: state.connected, syncing: state.syncing, error: state.error });
  return () => statusListeners.delete(listener);
}

/**
 * Update sync status and notify listeners.
 */
function updateSyncStatus(update: Partial<{ connected: boolean; syncing: boolean; error: string | null }>) {
  let changed = false;
  if (update.connected !== undefined && update.connected !== state.connected) {
    state.connected = update.connected;
    changed = true;
  }
  if (update.syncing !== undefined && update.syncing !== state.syncing) {
    state.syncing = update.syncing;
    changed = true;
  }
  if (update.error !== undefined && update.error !== state.error) {
    state.error = update.error;
    changed = true;
  }

  if (changed) {
    const status = { connected: state.connected, syncing: state.syncing, error: state.error };
    statusListeners.forEach(listener => listener(status));
  }
}

// Cache the device ID so it's stable across sync reinitializations
let cachedDeviceId: string | null = null;

/**
 * Get or generate a stable device ID.
 * Uses the user ID + a hash of machine identifiers for stability.
 */
function getDeviceId(userId: string): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  // Use hostname + platform as a simple machine identifier
  // This isn't perfect but gives reasonable stability
  const machineId = `${os.hostname()}-${process.platform}`;
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256')
    .update(`${userId}:${machineId}`)
    .digest('hex')
    .substring(0, 16);

  cachedDeviceId = hash;
  return hash;
}

/**
 * Get device info for sync presence awareness.
 */
function getDeviceInfo(userId: string): DeviceInfo {
  const platform = process.platform === 'darwin' ? 'macos'
    : process.platform === 'win32' ? 'windows'
    : process.platform === 'linux' ? 'linux'
    : 'unknown';

  // Get a friendly device name
  const hostname = os.hostname();
  // Clean up common hostname patterns
  const friendlyName = hostname
    .replace(/\.local$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  return {
    device_id: getDeviceId(userId),
    name: friendlyName || 'Desktop',
    type: 'desktop',
    platform,
    app_version: app.getVersion(),
    connected_at: Date.now(),
    last_active_at: Date.now(),
  };
}

/**
 * Initialize sync if configured.
 * Returns a wrapped session store if sync is enabled, or the original store if not.
 */
export async function initializeSync(baseStore: SessionStore): Promise<SessionStore> {
  console.log('[SyncManager] initializeSync called');

  const config = getSessionSyncConfig();
  console.log('[SyncManager] config:', JSON.stringify(config));

  if (!config?.enabled) {
    console.log('[SyncManager] Session sync not enabled');
    return baseStore;
  }

  // Use production server URL by default, allow override in dev mode
  const PRODUCTION_SYNC_URL = 'wss://sync.nimbalyst.com';
  const serverUrl = config.serverUrl || PRODUCTION_SYNC_URL;

  // Require Stytch authentication for sync
  const authenticated = isAuthenticated();
  console.log('[SyncManager] isAuthenticated:', authenticated);
  if (!authenticated) {
    console.log('[SyncManager] Session sync enabled but user not authenticated with Stytch');
    return baseStore;
  }

  // Get user ID from Stytch (for encryption key derivation and device info)
  // Note: JWT refresh happens on-demand before each WebSocket connection via getJwt callback
  const stytchUserId = getStytchUserId();
  console.log('[SyncManager] stytchUserId:', stytchUserId);
  if (!stytchUserId) {
    console.log('[SyncManager] Session sync enabled but no Stytch user ID available');
    return baseStore;
  }

  // Get encryption key seed from CredentialService (for E2E encryption)
  const credentials = getCredentials();

  try {
    logger.main.info('[SyncManager] Initializing session sync...', {
      serverUrl,
      userId: stytchUserId,
    });

    const {
      createCollabV3Sync,
      createSyncedSessionStore,
      createMessageSyncHandler,
    } = await loadSyncModule();

    // CollabV3 uses the encryption key seed from CredentialService for E2E encryption
    // Note: We use stytchUserId for salt to ensure same encryption key across devices
    const encryptionKey = await deriveEncryptionKey(credentials.encryptionKeySeed, `nimbalyst:${stytchUserId}`);

    // Get device info for presence awareness
    const deviceInfo = getDeviceInfo(stytchUserId);
    logger.main.info('[SyncManager] Generated device info:', JSON.stringify(deviceInfo));

    // Cache JWT refresh to prevent spamming Stytch during batch sync
    // JWTs expire in ~5 minutes, so refresh at most once per minute
    let lastRefreshTime = 0;
    const MIN_REFRESH_INTERVAL = 60000; // 1 minute

    const provider = createCollabV3Sync({
      serverUrl,
      getJwt: async () => {
        const { refreshSession: doRefresh, getSessionJwt: getJwt } = await import('./StytchAuthService');

        // Only refresh if enough time has passed since last refresh
        const now = Date.now();
        if (now - lastRefreshTime > MIN_REFRESH_INTERVAL) {
          await doRefresh(serverUrl);
          lastRefreshTime = now;
        }

        const freshJwt = getJwt();
        if (!freshJwt || freshJwt.split('.').length !== 3) {
          throw new Error('Failed to get valid JWT after refresh');
        }
        return freshJwt;
      },
      encryptionKey,
      deviceInfo,
    });
    logger.main.info('[SyncManager] Created CollabV3 sync provider with device:', deviceInfo.name);

    // Create message sync handler
    const messageSyncHandler = createMessageSyncHandler(provider);

    // Store state
    state.provider = provider;
    state.config = config;
    state.messageSyncHandler = messageSyncHandler;

    // Wrap store with sync capabilities
    const syncedStore = createSyncedSessionStore(baseStore, provider, {
      autoConnect: true,
    });

    // Sync existing sessions and projects to index using delta sync
    logger.main.info('[SyncManager] Setting up incremental sync...');
    setTimeout(async () => {
      const syncStart = performance.now();
      logger.main.info('[SyncManager] Starting incremental sync...');
      try {
        if (!provider.syncSessionsToIndex || !provider.fetchIndex) {
          logger.main.warn('[SyncManager] Provider missing required sync methods');
          return;
        }

        // Step 1: Fetch the server's current index
        const fetchStart = performance.now();
        logger.main.info('[SyncManager] Fetching server index...');
        let serverIndex: Awaited<ReturnType<NonNullable<typeof provider.fetchIndex>>>;
        try {
          serverIndex = await provider.fetchIndex();
          const fetchTime = performance.now() - fetchStart;
          logger.main.info(`[SyncManager] Server has ${serverIndex.sessions.length} sessions (fetch took ${fetchTime.toFixed(1)}ms)`);
        } catch (fetchError) {
          logger.main.warn('[SyncManager] Failed to fetch server index, falling back to full sync:', fetchError);
          // Fall back to full sync if we can't fetch the index
          serverIndex = { sessions: [], projects: [] };
        }

        // Build a map of server sessions for quick lookup
        const serverSessionMap = new Map(
          serverIndex.sessions.map(s => [s.session_id, s])
        );

        // Step 2: Get local sessions (without messages first for comparison)
        const localStart = performance.now();
        const { getAllSessionsForSync } = await import('./PGLiteSessionStore');
        const allLocalSessions = await getAllSessionsForSync(false); // No messages yet
        const localTime = performance.now() - localStart;
        logger.main.info(`[SyncManager] Local has ${allLocalSessions.length} sessions (query took ${localTime.toFixed(1)}ms)`);

        // Get enabled projects filter (if configured)
        const { store } = await import('../utils/store');
        const syncSettings = store.get('sessionSync');
        const enabledProjects = syncSettings?.enabledProjects;

        // Build enabled projects set - if enabledProjects is set, use it; otherwise sync all
        const enabledProjectIds = enabledProjects
          ? new Set(enabledProjects)
          : null; // null means all projects enabled

        // Step 4: Find sessions that need syncing
        const sessionsNeedingIndexUpdate: typeof allLocalSessions = [];
        const sessionsNeedingMessageSync: string[] = [];

        for (const localSession of allLocalSessions) {
          // Skip sessions without a workspace - they shouldn't exist but just in case
          if (!localSession.workspaceId) {
            logger.main.warn(`[SyncManager] Skipping session ${localSession.id.slice(0, 8)} - no workspaceId`);
            continue;
          }

          // Skip sessions from disabled projects (if project filtering is enabled)
          if (enabledProjectIds && !enabledProjectIds.has(localSession.workspaceId)) {
            continue;
          }

          const serverSession = serverSessionMap.get(localSession.id);

          if (!serverSession) {
            // New session - needs full sync (index + messages)
            sessionsNeedingIndexUpdate.push(localSession);
            sessionsNeedingMessageSync.push(localSession.id);
          } else {
            // Check if we have more messages than the server
            // This is the reliable way to know if messages need syncing
            // (timestamps can drift between devices)
            const serverMessageCount = serverSession.message_count || 0;
            const localMessageCount = localSession.messageCount || 0;

            if (localMessageCount > serverMessageCount) {
              // We have messages the server doesn't have
              sessionsNeedingIndexUpdate.push(localSession);
              sessionsNeedingMessageSync.push(localSession.id);
              logger.main.info(`[SyncManager] Session ${localSession.id} needs message sync: local=${localMessageCount} server=${serverMessageCount}`);
            }
            // If server has same or more messages, we're in sync (or server has messages from other devices)
          }
        }

        logger.main.info('[SyncManager] Delta sync results:', {
          totalLocal: allLocalSessions.length,
          totalServer: serverIndex.sessions.length,
          needingIndexUpdate: sessionsNeedingIndexUpdate.length,
          needingMessageSync: sessionsNeedingMessageSync.length,
        });

        // Sync sessions that need it
        if (sessionsNeedingIndexUpdate.length === 0 && sessionsNeedingMessageSync.length === 0) {
          logger.main.info('[SyncManager] All sessions up to date, no sync needed');
        } else {
          // For sessions needing message sync, load ONLY the messages the server doesn't have (delta sync)
          if (sessionsNeedingMessageSync.length > 0) {
            const { getSessionMessagesForSync } = await import('./PGLiteSessionStore');

            for (const session of sessionsNeedingIndexUpdate) {
              if (sessionsNeedingMessageSync.includes(session.id)) {
                // Get the server's message count as offset - only fetch messages after that
                const serverSession = serverSessionMap.get(session.id);
                const serverMessageCount = serverSession?.message_count || 0;

                // Only load messages the server doesn't have
                const newMessages = await getSessionMessagesForSync(session.id, serverMessageCount);
                session.messages = newMessages;

                logger.main.info(`[SyncManager] Session ${session.id}: syncing ${newMessages.length} new messages (server has ${serverMessageCount})`);
              }
            }
          }

          logger.main.info(`[SyncManager] Syncing ${sessionsNeedingIndexUpdate.length} sessions (${sessionsNeedingMessageSync.length} with messages)`);
          provider.syncSessionsToIndex(sessionsNeedingIndexUpdate, {
            syncMessages: sessionsNeedingMessageSync.length > 0,
          });
        }
        const totalSyncTime = performance.now() - syncStart;
        logger.main.info(`[SyncManager] Incremental sync completed in ${totalSyncTime.toFixed(1)}ms`);
      } catch (error) {
        logger.main.warn('[SyncManager] Failed to sync sessions:', error);
      }
    }, 2000); // Wait for index connection

    // Mark as connected
    updateSyncStatus({ connected: true, syncing: false, error: null });

    logger.main.info('[SyncManager] Session sync initialized successfully');
    return syncedStore;
  } catch (error) {
    logger.main.error('[SyncManager] Failed to initialize sync:', error);
    updateSyncStatus({ connected: false, syncing: false, error: String(error) });
    // Return base store on failure - sync is optional
    return baseStore;
  }
}

/**
 * Get the current sync provider (if sync is enabled).
 */
export function getSyncProvider(): import('@nimbalyst/runtime/sync').SyncProvider | null {
  return state.provider;
}

/**
 * Get the message sync handler (if sync is enabled).
 */
export function getMessageSyncHandler(): ReturnType<typeof import('@nimbalyst/runtime/sync').createMessageSyncHandler> | null {
  return state.messageSyncHandler;
}

/**
 * Check if sync is currently active.
 */
export function isSyncEnabled(): boolean {
  return state.provider !== null && state.config?.enabled === true;
}

/**
 * Shutdown sync and disconnect all sessions.
 */
export function shutdownSync(): void {
  if (state.provider) {
    logger.main.info('[SyncManager] Shutting down session sync...');
    state.provider.disconnectAll();
    state.provider = null;
    state.config = null;
    state.messageSyncHandler = null;
    updateSyncStatus({ connected: false, syncing: false, error: null });
  }
}

/**
 * Reinitialize sync with new configuration.
 * Useful when settings change.
 */
export async function reinitializeSync(baseStore: SessionStore): Promise<SessionStore> {
  shutdownSync();
  return initializeSync(baseStore);
}
