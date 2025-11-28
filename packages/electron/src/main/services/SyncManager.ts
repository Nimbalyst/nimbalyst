/**
 * SyncManager - Manages optional Y.js session sync.
 *
 * This service is responsible for:
 * - Reading sync configuration from app settings
 * - Creating and managing the SyncProvider instance
 * - Wrapping the session store with sync capabilities when enabled
 *
 * The sync feature is completely optional. If not configured, nothing happens.
 */

import type { SessionStore } from '@nimbalyst/runtime';
import { getSessionSyncConfig, type SessionSyncConfig } from '../utils/store';
import { logger } from '../utils/logger';

// Lazy import to avoid loading sync code if not needed
let syncModule: typeof import('@nimbalyst/runtime/sync') | null = null;

async function loadSyncModule() {
  if (!syncModule) {
    syncModule = await import('@nimbalyst/runtime/sync');
  }
  return syncModule;
}

interface SyncManagerState {
  provider: import('@nimbalyst/runtime/sync').SyncProvider | null;
  config: SessionSyncConfig | null;
}

const state: SyncManagerState = {
  provider: null,
  config: null,
};

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

  if (!config.serverUrl || !config.userId || !config.authToken) {
    logger.main.warn('[SyncManager] Session sync enabled but missing configuration');
    return baseStore;
  }

  try {
    logger.main.info('[SyncManager] Initializing session sync...', {
      serverUrl: config.serverUrl,
      userId: config.userId,
    });

    const { createYjsSessionSync, createSyncedSessionStore } = await loadSyncModule();

    // Create sync provider
    const provider = createYjsSessionSync({
      serverUrl: config.serverUrl,
      userId: config.userId,
      authToken: config.authToken,
    });

    // Store state
    state.provider = provider;
    state.config = config;

    // Wrap store with sync capabilities
    const syncedStore = createSyncedSessionStore(baseStore, provider, {
      autoConnect: true,
    });

    // Sync existing sessions to index after a short delay to allow connection
    logger.main.info('[SyncManager] Setting up bulk sync timer...');
    setTimeout(async () => {
      logger.main.info('[SyncManager] Bulk sync timer fired');
      try {
        logger.main.info('[SyncManager] syncSessionsToIndex available:', !!provider.syncSessionsToIndex);
        if (provider.syncSessionsToIndex) {
          // Use getAllSessionsForSync which doesn't filter by workspace
          logger.main.info('[SyncManager] Importing getAllSessionsForSync...');
          const { getAllSessionsForSync } = await import('./PGLiteSessionStore');
          logger.main.info('[SyncManager] Calling getAllSessionsForSync...');
          const sessions = await getAllSessionsForSync(true); // Include messages
          logger.main.info('[SyncManager] Got sessions:', sessions.length);

          if (sessions.length > 0) {
            logger.main.info(`[SyncManager] Syncing ${sessions.length} existing sessions to index`);
            provider.syncSessionsToIndex(sessions);
          } else {
            logger.main.info('[SyncManager] No sessions to sync');
          }
        }
      } catch (error) {
        logger.main.warn('[SyncManager] Failed to sync existing sessions to index:', error);
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
