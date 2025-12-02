/**
 * Session Sync Module
 *
 * Provides optional real-time sync of AI sessions across devices.
 *
 * Two implementations available:
 * - CollabV3 (recommended): Simple append-only protocol with DO SQLite storage
 * - Y.js (legacy): CRDT-based sync with D1 BLOB storage
 *
 * Usage:
 *
 * ```typescript
 * import { createCollabV3Sync, createSyncedSessionStore } from '@nimbalyst/runtime/sync';
 *
 * // 1. Create sync provider with config
 * const syncProvider = createCollabV3Sync({
 *   serverUrl: 'wss://sync.nimbalyst.com',
 *   userId: 'user-123',
 *   authToken: 'token',
 *   encryptionKey: derivedKey, // Required for E2E encryption
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
  SyncedSessionMetadata,
  SessionIndexEntry,
  DeviceInfo,
} from './types';

// CollabV3 - recommended for new deployments
export { createCollabV3Sync } from './CollabV3Sync';

// Y.js - legacy, kept for existing deployments
export { createYjsSessionSync } from './YjsSessionSync';

export {
  createSyncedSessionStore,
  createMessageSyncHandler,
  type SyncedSessionStoreOptions,
} from './SyncedSessionStore';
