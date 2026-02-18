/**
 * Session Sync Module
 *
 * Provides optional real-time sync of AI sessions across devices using CollabV3.
 *
 * Usage:
 *
 * ```typescript
 * import { createCollabV3Sync, createSyncedSessionStore } from '@nimbalyst/runtime/sync';
 *
 * // 1. Create sync provider with JWT auth
 * const syncProvider = createCollabV3Sync({
 *   serverUrl: 'wss://sync.nimbalyst.com',
 *   jwt: stytchSessionJwt, // User ID extracted from 'sub' claim
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
  SyncedQueuedPrompt,
  SessionIndexEntry,
  ProjectIndexEntry,
  ProjectConfig,
  SyncedSlashCommand,
  EncryptedAttachment,
  DeviceInfo,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionControlMessage,
} from './types';

export { createCollabV3Sync } from './CollabV3Sync';

export {
  createSyncedSessionStore,
  createMessageSyncHandler,
  type SyncedSessionStoreOptions,
} from './SyncedSessionStore';
