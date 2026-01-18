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

// ============================================================================
// Desktop Presence Tracking
// ============================================================================

/** Timestamp of last user activity (keypress, click, etc.) */
let lastActivityAt = Date.now();

/** Whether any app window is currently focused */
let isAnyWindowFocused = true;

/** Whether the screen is locked */
let isScreenLocked = false;

/** Timestamp when the desktop first connected */
let connectionTime = Date.now();

/** Cached user ID for device info */
let cachedUserId: string | null = null;

/** Configurable idle threshold - default 5 minutes, can be set lower for testing */
let idleThresholdMs = 5 * 60 * 1000; // 5 minutes default

/**
 * Report user activity from the renderer.
 * Called via IPC when user interacts with the app.
 */
export function reportDesktopActivity(): void {
  lastActivityAt = Date.now();
}

/**
 * Update the window focus state.
 * Called when any window gains/loses focus.
 */
export function setWindowFocused(focused: boolean): void {
  isAnyWindowFocused = focused;
  if (focused) {
    // Gaining focus counts as activity
    lastActivityAt = Date.now();
  }
}

/**
 * Update the screen lock state.
 * Called when the OS screen is locked/unlocked.
 */
export function setScreenLocked(locked: boolean): void {
  isScreenLocked = locked;
  logger.main.info(`[SyncManager] Screen lock state changed: ${locked ? 'locked' : 'unlocked'}`);
  if (!locked) {
    // Unlocking counts as activity
    lastActivityAt = Date.now();
  }
}

/**
 * Set the idle threshold in milliseconds.
 * For testing, set to a low value like 10000 (10 seconds).
 */
export function setIdleThresholdMs(ms: number): void {
  idleThresholdMs = ms;
  logger.main.info(`[SyncManager] Idle threshold set to ${ms}ms`);
}

/**
 * Derive the device status based on focus, activity, and screen lock.
 */
function deriveDeviceStatus(): 'active' | 'idle' | 'away' {
  const idleTime = Date.now() - lastActivityAt;

  // If screen is locked, user is definitely "away"
  if (isScreenLocked) {
    return 'away';
  }

  // If no window is focused, user is "away"
  if (!isAnyWindowFocused) {
    return 'away';
  }

  // If window is focused but no recent activity, user is "idle"
  if (idleTime > idleThresholdMs) {
    return 'idle';
  }

  return 'active';
}

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
 * Returns current presence state (focus, activity, status).
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
    connected_at: connectionTime,
    last_active_at: lastActivityAt,
    is_focused: isAnyWindowFocused,
    status: deriveDeviceStatus(),
  };
}

/**
 * Initialize sync if configured.
 * Returns a wrapped session store if sync is enabled, or the original store if not.
 */
export async function initializeSync(baseStore: SessionStore): Promise<SessionStore> {
  logger.main.info('[SyncManager] initializeSync called');

  const config = getSessionSyncConfig();
  logger.main.info('[SyncManager] config:', JSON.stringify(config));

  if (!config?.enabled) {
    logger.main.info('[SyncManager] Session sync not enabled in config');
    return baseStore;
  }

  // Determine server URL based on environment setting
  const PRODUCTION_SYNC_URL = 'wss://sync.nimbalyst.com';
  const DEVELOPMENT_SYNC_URL = 'ws://localhost:8790';

  // Only honor the environment config in dev builds - production builds always use production sync
  const isDevelopmentBuild = process.env.NODE_ENV !== 'production';
  const effectiveEnvironment = isDevelopmentBuild ? config.environment : undefined;

  // Derive server URL from environment - don't rely on persisted serverUrl as it may be stale
  // (e.g., user switched from dev to production but old localhost URL was persisted)
  let serverUrl: string;
  if (effectiveEnvironment === 'development') {
    serverUrl = DEVELOPMENT_SYNC_URL;
  } else {
    serverUrl = PRODUCTION_SYNC_URL;
  }
  logger.main.info(`[SyncManager] isDevelopmentBuild=${isDevelopmentBuild}, effectiveEnvironment=${effectiveEnvironment}, serverUrl=${serverUrl}`);

  // Require Stytch authentication for sync
  const authenticated = isAuthenticated();
  logger.main.info('[SyncManager] isAuthenticated:', authenticated);
  if (!authenticated) {
    logger.main.info('[SyncManager] Session sync enabled but user not authenticated with Stytch');
    return baseStore;
  }

  // Get user ID from Stytch (for encryption key derivation and device info)
  // Note: JWT refresh happens on-demand before each WebSocket connection via getJwt callback
  const stytchUserId = getStytchUserId();
  logger.main.info('[SyncManager] stytchUserId:', stytchUserId);
  if (!stytchUserId) {
    logger.main.info('[SyncManager] Session sync enabled but no Stytch user ID available');
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

    // Cache user ID for dynamic device info callback
    cachedUserId = stytchUserId;
    connectionTime = Date.now(); // Reset connection time on init

    // Apply idle timeout from config (default 5 minutes)
    if (config.idleTimeoutMinutes !== undefined) {
      setIdleThresholdMs(config.idleTimeoutMinutes * 60 * 1000);
    }

    // Get initial device info for logging
    const initialDeviceInfo = getDeviceInfo(stytchUserId);
    logger.main.info('[SyncManager] Initial device info:', JSON.stringify(initialDeviceInfo));

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
          logger.main.info('[SyncManager] Refreshing JWT...');
          const refreshResult = await doRefresh(serverUrl);
          logger.main.info('[SyncManager] Refresh result:', refreshResult);
          lastRefreshTime = now;
        }

        const freshJwt = getJwt();
        if (!freshJwt || freshJwt.split('.').length !== 3) {
          throw new Error('Failed to get valid JWT after refresh');
        }

        // Log JWT expiry for debugging
        try {
          const payload = JSON.parse(atob(freshJwt.split('.')[1]));
          logger.main.info('[SyncManager] JWT exp:', payload.exp, 'now:', Math.floor(Date.now() / 1000));
        } catch {
          // ignore
        }

        return freshJwt;
      },
      encryptionKey,
      // Use callback for dynamic presence updates (called every 30s)
      getDeviceInfo: () => getDeviceInfo(stytchUserId),
    });
    logger.main.info('[SyncManager] Created CollabV3 sync provider with device:', initialDeviceInfo.name);

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
          // Don't fall back to full sync - that would load ALL messages for ALL sessions into memory
          // and cause OOM crashes. Instead, skip sync and wait for connection to be restored.
          logger.main.warn('[SyncManager] Failed to fetch server index, skipping sync until connection restored:', fetchError);
          return;
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

        // Step 4: Find sessions that need syncing using timestamp comparison
        // Compare local updated_at vs server updated_at - if local is newer, we have changes to sync
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
            // Compare timestamps - if local is newer than server's last sync, we have new messages
            const serverUpdatedAt = serverSession.updated_at || 0;
            const localUpdatedAt = localSession.updatedAt || 0;

            if (localUpdatedAt > serverUpdatedAt) {
              // We have changes the server doesn't have
              sessionsNeedingIndexUpdate.push(localSession);
              sessionsNeedingMessageSync.push(localSession.id);
              logger.main.info(`[SyncManager] Session ${localSession.id} needs sync: local=${localUpdatedAt} server=${serverUpdatedAt}`);
            }
            // If server has same or newer timestamp, we're in sync
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
                // Get the server's last_message_at timestamp - only fetch messages after that
                const serverSession = serverSessionMap.get(session.id);
                const sinceTimestamp = serverSession?.last_message_at || 0;

                // Only load messages newer than server's last message
                const newMessages = await getSessionMessagesForSync(session.id, sinceTimestamp);
                session.messages = newMessages;

                logger.main.info(`[SyncManager] Session ${session.id}: syncing ${newMessages.length} new messages (since ${new Date(sinceTimestamp).toISOString()})`);
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

    // Sync current OpenAI API key to mobile (in case mobile connects after key was set)
    setTimeout(async () => {
      try {
        const Store = (await import('electron-store')).default;
        const aiStore = new Store({ name: 'ai-settings' });
        const apiKeys = aiStore.get('apiKeys', {}) as Record<string, string>;
        const openaiKey = apiKeys['openai'];
        if (openaiKey) {
          logger.main.info('[SyncManager] Syncing existing OpenAI API key to mobile devices');
          syncSettingsToMobile(openaiKey);
        }
      } catch (error) {
        logger.main.warn('[SyncManager] Failed to sync initial settings:', error);
      }
    }, 3000); // Wait a bit for index connection to be established

    // Sync settings whenever a mobile device connects (joins or reconnects)
    // Track which mobile devices are currently connected so we can detect when one joins
    let previousMobileDeviceIds = new Set<string>();
    if (provider.onDeviceStatusChange) {
      provider.onDeviceStatusChange((devices) => {
        const mobileDevices = devices.filter(d => d.type === 'mobile');
        const currentMobileIds = new Set(mobileDevices.map(d => d.device_id));

        // Check for mobile devices that just connected (weren't in the previous set)
        for (const device of mobileDevices) {
          if (!previousMobileDeviceIds.has(device.device_id)) {
            logger.main.info(`[SyncManager] Mobile device connected: ${device.name}, syncing settings...`);
            // Sync settings to the mobile device
            import('electron-store').then(({ default: Store }) => {
              const aiStore = new Store({ name: 'ai-settings' });
              const apiKeys = aiStore.get('apiKeys', {}) as Record<string, string>;
              const openaiKey = apiKeys['openai'];
              if (openaiKey) {
                syncSettingsToMobile(openaiKey);
              }
            }).catch((err) => {
              logger.main.warn('[SyncManager] Failed to sync settings to device:', err);
            });
          }
        }

        previousMobileDeviceIds = currentMobileIds;
      });
    }

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

/**
 * Trigger an incremental sync to push local sessions to the server.
 * Useful when a new project is enabled for sync.
 */
export async function triggerIncrementalSync(): Promise<void> {
  const provider = state.provider;
  if (!provider) {
    logger.main.warn('[SyncManager] Cannot trigger sync - provider not initialized');
    return;
  }

  if (!provider.syncSessionsToIndex || !provider.fetchIndex) {
    logger.main.warn('[SyncManager] Provider missing required sync methods');
    return;
  }

  const syncStart = performance.now();
  logger.main.info('[SyncManager] Starting triggered incremental sync...');

  try {
    // Fetch the server's current index
    const fetchStart = performance.now();
    logger.main.info('[SyncManager] Fetching server index...');
    let serverIndex: Awaited<ReturnType<NonNullable<typeof provider.fetchIndex>>>;
    try {
      serverIndex = await provider.fetchIndex();
      const fetchTime = performance.now() - fetchStart;
      logger.main.info(`[SyncManager] Server has ${serverIndex.sessions.length} sessions (fetch took ${fetchTime.toFixed(1)}ms)`);
    } catch (fetchError) {
      // Don't fall back to full sync - that would load ALL messages for ALL sessions into memory
      // and cause OOM crashes. Instead, skip sync and wait for connection to be restored.
      logger.main.warn('[SyncManager] Failed to fetch server index, skipping incremental sync:', fetchError);
      return;
    }

    // Build a map of server sessions for quick lookup
    const serverSessionMap = new Map(
      serverIndex.sessions.map(s => [s.session_id, s])
    );

    // Get local sessions
    const localStart = performance.now();
    const { getAllSessionsForSync } = await import('./PGLiteSessionStore');
    const allLocalSessions = await getAllSessionsForSync(false);
    const localTime = performance.now() - localStart;
    logger.main.info(`[SyncManager] Local has ${allLocalSessions.length} sessions (query took ${localTime.toFixed(1)}ms)`);

    // Get enabled projects filter
    const { store } = await import('../utils/store');
    const syncSettings = store.get('sessionSync');
    const enabledProjects = syncSettings?.enabledProjects;

    const enabledProjectIds = enabledProjects
      ? new Set(enabledProjects)
      : null;

    // Find sessions that need syncing using timestamp comparison
    const sessionsNeedingIndexUpdate: typeof allLocalSessions = [];
    const sessionsNeedingMessageSync: string[] = [];

    for (const localSession of allLocalSessions) {
      if (!localSession.workspaceId) {
        continue;
      }

      // Skip sessions from disabled projects
      if (enabledProjectIds && !enabledProjectIds.has(localSession.workspaceId)) {
        continue;
      }

      const serverSession = serverSessionMap.get(localSession.id);

      if (!serverSession) {
        sessionsNeedingIndexUpdate.push(localSession);
        sessionsNeedingMessageSync.push(localSession.id);
      } else {
        // Compare timestamps - if local is newer than server's last sync, we have new messages
        const serverUpdatedAt = serverSession.updated_at || 0;
        const localUpdatedAt = localSession.updatedAt || 0;

        if (localUpdatedAt > serverUpdatedAt) {
          sessionsNeedingIndexUpdate.push(localSession);
          sessionsNeedingMessageSync.push(localSession.id);
          logger.main.info(`[SyncManager] Session ${localSession.id} needs sync: local=${localUpdatedAt} server=${serverUpdatedAt}`);
        }
      }
    }

    logger.main.info('[SyncManager] Triggered sync results:', {
      totalLocal: allLocalSessions.length,
      totalServer: serverIndex.sessions.length,
      needingIndexUpdate: sessionsNeedingIndexUpdate.length,
      needingMessageSync: sessionsNeedingMessageSync.length,
    });

    if (sessionsNeedingIndexUpdate.length === 0 && sessionsNeedingMessageSync.length === 0) {
      logger.main.info('[SyncManager] All sessions up to date, no sync needed');
    } else {
      if (sessionsNeedingMessageSync.length > 0) {
        const { getSessionMessagesForSync } = await import('./PGLiteSessionStore');

        for (const session of sessionsNeedingIndexUpdate) {
          if (sessionsNeedingMessageSync.includes(session.id)) {
            const serverSession = serverSessionMap.get(session.id);
            const sinceTimestamp = serverSession?.last_message_at || 0;
            const newMessages = await getSessionMessagesForSync(session.id, sinceTimestamp);
            session.messages = newMessages;
            logger.main.info(`[SyncManager] Session ${session.id}: syncing ${newMessages.length} new messages (since ${new Date(sinceTimestamp).toISOString()})`);
          }
        }
      }

      logger.main.info(`[SyncManager] Syncing ${sessionsNeedingIndexUpdate.length} sessions`);
      provider.syncSessionsToIndex(sessionsNeedingIndexUpdate, {
        syncMessages: sessionsNeedingMessageSync.length > 0,
      });
    }

    const totalSyncTime = performance.now() - syncStart;
    logger.main.info(`[SyncManager] Triggered sync completed in ${totalSyncTime.toFixed(1)}ms`);
  } catch (error) {
    logger.main.error('[SyncManager] Triggered sync failed:', error);
  }
}

// ============================================================================
// Settings Sync (Desktop -> Mobile)
// ============================================================================

// Track settings version to avoid re-syncing unchanged settings
let settingsVersion = 0;

/**
 * Sync sensitive settings to mobile devices.
 * Currently syncs the OpenAI API key for voice mode.
 *
 * @param openaiApiKey The OpenAI API key to sync
 */
export async function syncSettingsToMobile(openaiApiKey?: string): Promise<void> {
  const provider = state.provider;
  if (!provider) {
    logger.main.debug('[SyncManager] Cannot sync settings - provider not initialized');
    return;
  }

  if (!provider.syncSettings) {
    logger.main.debug('[SyncManager] Provider does not support syncSettings');
    return;
  }

  // Increment version to ensure mobile gets the latest
  settingsVersion++;

  logger.main.info(`[SyncManager] Syncing settings to mobile devices (version ${settingsVersion})`);

  try {
    await provider.syncSettings({
      openaiApiKey,
      version: settingsVersion,
    });
    logger.main.info('[SyncManager] Settings synced successfully');
  } catch (error) {
    logger.main.error('[SyncManager] Failed to sync settings:', error);
  }
}
