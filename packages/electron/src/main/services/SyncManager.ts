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
  messageSyncHandler: ReturnType<typeof import('@nimbalyst/runtime/sync').createMessageSyncHandler> | null;
}

const state: SyncManagerState = {
  provider: null,
  config: null,
  messageSyncHandler: null,
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

    const { createYjsSessionSync, createSyncedSessionStore, createMessageSyncHandler } = await loadSyncModule();

    // Create sync provider
    const provider = createYjsSessionSync({
      serverUrl: config.serverUrl,
      userId: config.userId,
      authToken: config.authToken,
    });

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

    // Sync existing sessions and projects to index after a short delay to allow connection
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
          const allSessions = await getAllSessionsForSync(true); // Include messages
          logger.main.info('[SyncManager] Got sessions:', allSessions.length);

          // Build projects list from recent workspaces store
          const { getRecentItems, store } = await import('../utils/store');
          const recentWorkspaces = getRecentItems('workspaces');
          const syncSettings = store.get('sessionSync');
          const enabledProjects = syncSettings?.enabledProjects;

          logger.main.info('[SyncManager] Found', recentWorkspaces.length, 'workspaces in store');
          logger.main.info('[SyncManager] Enabled projects:', enabledProjects);

          // Build session counts for each workspace
          const sessionCounts = new Map<string, number>();
          const lastActivity = new Map<string, number>();

          for (const session of allSessions) {
            const workspaceId = session.workspaceId || 'default';
            sessionCounts.set(workspaceId, (sessionCounts.get(workspaceId) || 0) + 1);
            lastActivity.set(workspaceId, Math.max(lastActivity.get(workspaceId) || 0, session.updatedAt));
          }

          // Create project entries from workspaces
          const projects = recentWorkspaces.map(ws => ({
            id: ws.path,
            name: ws.name,
            path: ws.path,
            sessionCount: sessionCounts.get(ws.path) || 0,
            lastActivityAt: lastActivity.get(ws.path) || Date.now(),
            // If enabledProjects is not set, all projects are enabled by default
            enabled: !enabledProjects || enabledProjects.includes(ws.path),
          }));

          // Add "Default Project" if there are sessions without workspace
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

          logger.main.info('[SyncManager] Built', projects.length, 'projects from workspace store');
          logger.main.info('[SyncManager] Enabled projects:', projects.filter(p => p.enabled).map(p => p.name));

          if (allSessions.length > 0) {

            // Log workspace distribution
            const workspaceStats = new Map<string, number>();
            for (const session of allSessions) {
              const wsId = session.workspaceId || 'null';
              workspaceStats.set(wsId, (workspaceStats.get(wsId) || 0) + 1);
            }
            logger.main.info('[SyncManager] Workspace distribution:', Object.fromEntries(workspaceStats));

            // Sync projects first
            logger.main.info('[SyncManager] provider.syncProjectsToIndex exists:', !!provider.syncProjectsToIndex);
            logger.main.info('[SyncManager] Projects to sync:', JSON.stringify(projects, null, 2));

            if (provider.syncProjectsToIndex) {
              logger.main.info('[SyncManager] Calling syncProjectsToIndex with', projects.length, 'projects');
              provider.syncProjectsToIndex(projects);
              logger.main.info('[SyncManager] syncProjectsToIndex call completed');
            } else {
              logger.main.error('[SyncManager] syncProjectsToIndex method not available on provider!');
            }

            // Filter sessions to only enabled projects
            const enabledProjectIds = new Set(projects.filter(p => p.enabled).map(p => p.id));
            const sessionsToSync = allSessions.filter(session => {
              const workspaceId = session.workspaceId || 'default';
              return enabledProjectIds.has(workspaceId);
            });

            logger.main.info(`[SyncManager] Syncing ${sessionsToSync.length} of ${allSessions.length} sessions (from enabled projects)`);
            // Enable message sync now that append-only fix prevents tombstone bloat
            provider.syncSessionsToIndex(sessionsToSync, { syncMessages: true });
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
