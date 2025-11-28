/**
 * Session Sync Module
 *
 * Provides optional real-time sync of AI sessions across devices using Y.js CRDTs.
 *
 * Usage:
 *
 * ```typescript
 * import { createYjsSessionSync, createSyncedSessionStore } from '@nimbalyst/runtime/sync';
 *
 * // 1. Create sync provider with config
 * const syncProvider = createYjsSessionSync({
 *   serverUrl: 'wss://sync.nimbalyst.com',
 *   userId: 'user-123',
 *   authToken: 'token',
 * });
 *
 * // 2. Wrap your existing session store
 * const baseStore = createPGLiteSessionStore(...);
 * const syncedStore = createSyncedSessionStore(baseStore, syncProvider);
 *
 * // 3. Use the synced store
 * AISessionsRepository.setStore(syncedStore);
 *
 * // 4. Optionally set up message sync
 * const messageSyncHandler = createMessageSyncHandler(syncProvider);
 * // Call messageSyncHandler.onMessageCreated() after each message
 * ```
 *
 * The sync layer is completely optional. If not configured, the app works
 * exactly as before with local-only storage.
 */

export type {
  SyncConfig,
  SyncStatus,
  SyncProvider,
  SessionChange,
  SyncedMessage,
  SyncedSessionMetadata,
} from './types';

export { createYjsSessionSync } from './YjsSessionSync';

export {
  createSyncedSessionStore,
  createMessageSyncHandler,
  type SyncedSessionStoreOptions,
} from './SyncedSessionStore';
