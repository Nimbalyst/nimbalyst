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
}

const state: SyncManagerState = {
  provider: null,
  config: null,
  messageSyncHandler: null,
};

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
  return cachedDeviceId;
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
  const config = getSessionSyncConfig();

  if (!config?.enabled) {
    logger.main.info('[SyncManager] Session sync not enabled');
    return baseStore;
  }

  if (!config.serverUrl) {
    logger.main.warn('[SyncManager] Session sync enabled but missing server URL');
    return baseStore;
  }

  // Get credentials from CredentialService (auto-generated)
  const credentials = getCredentials();

  try {
    const backend = config.backend ?? 'collabv3';
    logger.main.info('[SyncManager] Initializing session sync...', {
      backend,
      serverUrl: config.serverUrl,
      userId: credentials.userId,
    });

    const {
      createYjsSessionSync,
      createCollabV3Sync,
      createSyncedSessionStore,
      createMessageSyncHandler,
    } = await loadSyncModule();

    // Create sync provider based on backend
    let provider: import('@nimbalyst/runtime/sync').SyncProvider;

    if (backend === 'collabv3') {
      // CollabV3 uses the encryption key seed from CredentialService for E2E encryption
      const encryptionKey = await deriveEncryptionKey(credentials.encryptionKeySeed, `nimbalyst:${credentials.userId}`);

      // Get device info for presence awareness
      const deviceInfo = getDeviceInfo(credentials.userId);
      logger.main.info('[SyncManager] Generated device info:', JSON.stringify(deviceInfo));

      provider = createCollabV3Sync({
        serverUrl: config.serverUrl,
        userId: credentials.userId,
        authToken: credentials.authToken,
        encryptionKey,
        deviceInfo,
      });
      logger.main.info('[SyncManager] Created CollabV3 sync provider with device:', deviceInfo.name);
    } else {
      // Legacy Y.js backend
      provider = createYjsSessionSync({
        serverUrl: config.serverUrl,
        userId: credentials.userId,
        authToken: credentials.authToken,
      });
      logger.main.info('[SyncManager] Created Y.js sync provider (legacy)');
    }

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
      logger.main.info('[SyncManager] Starting incremental sync...');
      try {
        if (!provider.syncSessionsToIndex || !provider.fetchIndex) {
          logger.main.warn('[SyncManager] Provider missing required sync methods');
          return;
        }

        // Step 1: Fetch the server's current index
        logger.main.info('[SyncManager] Fetching server index...');
        let serverIndex: Awaited<ReturnType<NonNullable<typeof provider.fetchIndex>>>;
        try {
          serverIndex = await provider.fetchIndex();
          logger.main.info('[SyncManager] Server has', serverIndex.sessions.length, 'sessions');
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
        const { getAllSessionsForSync } = await import('./PGLiteSessionStore');
        const allLocalSessions = await getAllSessionsForSync(false); // No messages yet
        logger.main.info('[SyncManager] Local has', allLocalSessions.length, 'sessions');

        // Step 3: Build project list from workspaces
        const { getRecentItems, store } = await import('../utils/store');
        const recentWorkspaces = getRecentItems('workspaces');
        const syncSettings = store.get('sessionSync');
        const enabledProjects = syncSettings?.enabledProjects;

        const sessionCounts = new Map<string, number>();
        const lastActivity = new Map<string, number>();

        for (const session of allLocalSessions) {
          const workspaceId = session.workspaceId || 'default';
          sessionCounts.set(workspaceId, (sessionCounts.get(workspaceId) || 0) + 1);
          lastActivity.set(workspaceId, Math.max(lastActivity.get(workspaceId) || 0, session.updatedAt));
        }

        const projects = recentWorkspaces.map(ws => ({
          id: ws.path,
          name: ws.name,
          path: ws.path,
          sessionCount: sessionCounts.get(ws.path) || 0,
          lastActivityAt: lastActivity.get(ws.path) || Date.now(),
          enabled: !enabledProjects || enabledProjects.includes(ws.path),
        }));

        if (sessionCounts.has('default')) {
          projects.push({
            id: 'default',
            name: 'Default Project',
            path: 'default',
            sessionCount: sessionCounts.get('default') || 0,
            lastActivityAt: lastActivity.get('default') || Date.now(),
            enabled: !enabledProjects || enabledProjects.includes('default'),
          });
        }

        const enabledProjectIds = new Set(projects.filter(p => p.enabled).map(p => p.id));

        // Step 4: Find sessions that need syncing
        const sessionsNeedingIndexUpdate: typeof allLocalSessions = [];
        const sessionsNeedingMessageSync: string[] = [];

        for (const localSession of allLocalSessions) {
          const workspaceId = localSession.workspaceId || 'default';

          // Skip sessions from disabled projects
          if (!enabledProjectIds.has(workspaceId)) {
            continue;
          }

          const serverSession = serverSessionMap.get(localSession.id);

          if (!serverSession) {
            // New session - needs full sync (index + messages)
            sessionsNeedingIndexUpdate.push(localSession);
            sessionsNeedingMessageSync.push(localSession.id);
          } else if (localSession.updatedAt > serverSession.updated_at) {
            // Session updated locally - needs index update
            sessionsNeedingIndexUpdate.push(localSession);
            // Check if message count changed (new messages added)
            if (localSession.messageCount > serverSession.message_count) {
              sessionsNeedingMessageSync.push(localSession.id);
            }
          }
          // else: Session is up to date, skip it
        }

        logger.main.info('[SyncManager] Delta sync results:', {
          totalLocal: allLocalSessions.length,
          totalServer: serverIndex.sessions.length,
          needingIndexUpdate: sessionsNeedingIndexUpdate.length,
          needingMessageSync: sessionsNeedingMessageSync.length,
        });

        // Step 5: Sync projects (still do this every time, it's cheap)
        if (provider.syncProjectsToIndex) {
          provider.syncProjectsToIndex(projects);
        }

        // Step 6: Sync only the sessions that need it
        if (sessionsNeedingIndexUpdate.length === 0) {
          logger.main.info('[SyncManager] All sessions up to date, no sync needed');
        } else {
          // For sessions needing message sync, load their messages
          if (sessionsNeedingMessageSync.length > 0) {
            const sessionsWithMessages = await getAllSessionsForSync(true);
            const messageMap = new Map(sessionsWithMessages.map(s => [s.id, s.messages]));

            // Attach messages to sessions that need them
            for (const session of sessionsNeedingIndexUpdate) {
              if (sessionsNeedingMessageSync.includes(session.id)) {
                session.messages = messageMap.get(session.id);
              }
            }
          }

          logger.main.info(`[SyncManager] Syncing ${sessionsNeedingIndexUpdate.length} sessions (${sessionsNeedingMessageSync.length} with messages)`);
          provider.syncSessionsToIndex(sessionsNeedingIndexUpdate, {
            syncMessages: sessionsNeedingMessageSync.length > 0,
          });
        }
      } catch (error) {
        logger.main.warn('[SyncManager] Failed to sync sessions:', error);
      }
    }, 2000); // Wait for index connection

    logger.main.info('[SyncManager] Session sync initialized successfully');
    return syncedStore;
  } catch (error) {
    logger.main.error('[SyncManager] Failed to initialize sync:', error);
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
