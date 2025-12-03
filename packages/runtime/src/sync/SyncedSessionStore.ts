/**
 * SyncedSessionStore - Decorator that adds sync capabilities to any SessionStore.
 *
 * This wraps an existing SessionStore and transparently syncs changes to other
 * devices via the SyncProvider. The underlying store handles all persistence;
 * this layer just adds sync on top.
 *
 * Usage:
 *   const baseStore = createPGLiteSessionStore(...);
 *   const syncProvider = createYjsSessionSync(config);
 *   const syncedStore = createSyncedSessionStore(baseStore, syncProvider);
 *   AISessionsRepository.setStore(syncedStore);
 */

import type {
  SessionStore,
  CreateSessionPayload,
  UpdateSessionMetadataPayload,
  SessionListItem,
  SessionListOptions,
  ChatSession,
} from '../ai/adapters/sessionStore';
import type { AgentMessage } from '../ai/server/types';
import type { SyncProvider, SessionChange } from './types';

export interface SyncedSessionStoreOptions {
  /** Auto-connect to sync when session is accessed */
  autoConnect?: boolean;

  /** Sessions to sync (if undefined, syncs all) */
  syncFilter?: (sessionId: string, workspaceId: string) => boolean;
}

const DEFAULT_OPTIONS: SyncedSessionStoreOptions = {
  autoConnect: true,
};

/**
 * Creates a SessionStore wrapper that adds sync capabilities.
 */
export function createSyncedSessionStore(
  baseStore: SessionStore,
  syncProvider: SyncProvider,
  options: SyncedSessionStoreOptions = {}
): SessionStore {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const connectedSessions = new Set<string>();

  // Track which sessions should be synced
  function shouldSync(sessionId: string, workspaceId?: string): boolean {
    if (opts.syncFilter) {
      return opts.syncFilter(sessionId, workspaceId ?? 'default');
    }
    return true;
  }

  // Connect to sync for a session if not already connected
  async function ensureSyncConnected(sessionId: string): Promise<void> {
    if (!opts.autoConnect) return;
    if (connectedSessions.has(sessionId)) return;
    if (!shouldSync(sessionId)) return;

    try {
      await syncProvider.connect(sessionId);
      connectedSessions.add(sessionId);
    } catch (error) {
      // Sync is optional - log but don't fail
      console.warn(`[SyncedSessionStore] Failed to connect sync for ${sessionId}:`, error);
    }
  }

  // Push a change to sync (fire and forget)
  function pushToSync(sessionId: string, change: SessionChange): void {
    if (!connectedSessions.has(sessionId)) return;

    try {
      syncProvider.pushChange(sessionId, change);
    } catch (error) {
      console.warn(`[SyncedSessionStore] Failed to push change for ${sessionId}:`, error);
    }
  }

  return {
    async ensureReady(): Promise<void> {
      return baseStore.ensureReady();
    },

    async create(payload: CreateSessionPayload): Promise<void> {
      // Create in base store first
      await baseStore.create(payload);

      // Then connect sync and push initial metadata
      if (shouldSync(payload.id, payload.workspaceId)) {
        await ensureSyncConnected(payload.id);
        const metadata = {
          title: payload.title,
          mode: payload.mode,
          provider: payload.provider,
          model: payload.model,
          workspaceId: payload.workspaceId,
          updatedAt: Date.now(),
        };
        console.log('[SyncedSessionStore] Creating session with metadata:', payload.id, metadata);
        pushToSync(payload.id, {
          type: 'metadata_updated',
          metadata,
        });
      }
    },

    async updateMetadata(
      sessionId: string,
      metadata: UpdateSessionMetadataPayload
    ): Promise<void> {
      // Update base store
      await baseStore.updateMetadata(sessionId, metadata);

      // Only sync metadata fields that are relevant for cross-device sync
      // Don't push changes for fields like providerSessionId, etc.
      const syncableFields = ['title', 'mode', 'isArchived', 'provider', 'model', 'draftInput', 'queuedPrompts'];
      const hasSyncableField = syncableFields.some(
        (field) => (metadata as Record<string, unknown>)[field] !== undefined
      );

      if (!hasSyncableField) {
        // No syncable fields changed, skip sync update
        return;
      }

      // Build sync metadata with only defined fields
      // NOTE: updatedAt is set when draftInput changes to keep sessions sorted correctly
      const syncMetadata: Record<string, unknown> = { updatedAt: Date.now() };
      if (metadata.title !== undefined) syncMetadata.title = metadata.title;
      if (metadata.mode !== undefined) syncMetadata.mode = metadata.mode;
      if (metadata.isArchived !== undefined) syncMetadata.isArchived = metadata.isArchived;
      if ((metadata as any).provider !== undefined) syncMetadata.provider = (metadata as any).provider;
      if ((metadata as any).model !== undefined) syncMetadata.model = (metadata as any).model;
      if (metadata.draftInput !== undefined) syncMetadata.draftInput = metadata.draftInput;
      if ((metadata as any).queuedPrompts !== undefined) syncMetadata.queuedPrompts = (metadata as any).queuedPrompts;

      // NOTE: Do NOT call ensureSyncConnected here!
      // Metadata updates should only push to sessions that are ALREADY connected.
      // Creating a WebSocket connection for every metadata update (like draft input changes)
      // causes massive performance issues when many session tabs are open.
      // If the session isn't connected yet, the update will be synced when it is.
      pushToSync(sessionId, {
        type: 'metadata_updated',
        metadata: syncMetadata as any,
      });
    },

    async get(sessionId: string): Promise<ChatSession | null> {
      // NOTE: Do NOT connect to sync here - reading doesn't need a connection.
      // Connections are only needed for write operations (create, update).
      // Auto-connecting on every get() causes too many WebSocket connections
      // when loading session lists or resuming sessions.
      return baseStore.get(sessionId);
    },

    async list(
      workspaceId: string,
      options?: SessionListOptions
    ): Promise<SessionListItem[]> {
      // List is read-only, just delegate
      return baseStore.list(workspaceId, options);
    },

    async search(
      workspaceId: string,
      query: string,
      options?: SessionListOptions
    ): Promise<SessionListItem[]> {
      // Search is read-only, just delegate
      return baseStore.search(workspaceId, query, options);
    },

    async delete(sessionId: string): Promise<void> {
      // Push deletion to sync first
      if (connectedSessions.has(sessionId)) {
        pushToSync(sessionId, { type: 'session_deleted' });
        syncProvider.disconnect(sessionId);
        connectedSessions.delete(sessionId);
      }

      // Then delete from base store
      await baseStore.delete(sessionId);
    },

    async updateTitleIfNotNamed(
      sessionId: string,
      title: string
    ): Promise<boolean> {
      if (!baseStore.updateTitleIfNotNamed) {
        // Fallback implementation
        const session = await baseStore.get(sessionId);
        if (session?.hasBeenNamed) return false;
        await baseStore.updateMetadata(sessionId, { title });
        return true;
      }

      const result = await baseStore.updateTitleIfNotNamed(sessionId, title);

      // If title was updated, push to sync (only if already connected)
      if (result) {
        pushToSync(sessionId, {
          type: 'metadata_updated',
          metadata: { title, updatedAt: Date.now() },
        });
      }

      return result;
    },
  };
}

/**
 * Creates a message sync handler that can be attached to AgentMessagesRepository.
 *
 * This is separate from the session store because messages have their own
 * repository pattern.
 */
export function createMessageSyncHandler(syncProvider: SyncProvider) {
  return {
    /**
     * Call this after a message is created to sync it.
     * @param message The message to sync
     * @param sessionUpdatedAt Optional timestamp (ms) for session updated_at - MUST match local DB
     */
    async onMessageCreated(message: AgentMessage, sessionUpdatedAt?: number): Promise<void> {
      // Auto-connect session if not already connected
      if (!syncProvider.isConnected(message.sessionId)) {
        console.log(`[MessageSyncHandler] Session ${message.sessionId} not connected, auto-connecting...`);
        try {
          await syncProvider.connect(message.sessionId);
          console.log(`[MessageSyncHandler] Successfully connected session ${message.sessionId}`);
        } catch (error) {
          console.error(`[MessageSyncHandler] Failed to connect session ${message.sessionId}:`, error);
          return;
        }
      }

      console.log(`[MessageSyncHandler] Pushing message_added for session ${message.sessionId}`);
      syncProvider.pushChange(message.sessionId, {
        type: 'message_added',
        message,
      });

      // Also update the session index with the same timestamp used in local DB
      // This ensures updated_at matches exactly for sync comparisons
      if (sessionUpdatedAt !== undefined) {
        syncProvider.pushChange(message.sessionId, {
          type: 'metadata_updated',
          metadata: { updatedAt: sessionUpdatedAt },
        });
      }
    },

    /**
     * Subscribe to remote message additions for a session.
     * Returns unsubscribe function.
     */
    onRemoteMessage(
      sessionId: string,
      callback: (message: AgentMessage) => void
    ): () => void {
      return syncProvider.onRemoteChange(sessionId, (change) => {
        if (change.type === 'message_added') {
          callback(change.message);
        }
      });
    },
  };
}
