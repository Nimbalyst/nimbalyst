/**
 * Y.js-based session sync client.
 *
 * Provides real-time sync of AI session data across devices using Y.js CRDTs.
 * This is the core sync implementation - it manages Y.Doc instances and
 * WebSocket connections for each synced session.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type {
  SyncConfig,
  SyncStatus,
  SyncProvider,
  SessionChange,
  SyncedMessage,
  SyncedSessionMetadata,
  SessionIndexData,
} from './types';

interface SessionSync {
  doc: Y.Doc;
  provider: WebsocketProvider;
  status: SyncStatus;
  statusListeners: Set<(status: SyncStatus) => void>;
  changeListeners: Set<(change: SessionChange) => void>;
  unsubscribe: () => void;
}

/**
 * SessionsIndex entry stored in the index Y.Doc
 */
interface SessionIndexEntry {
  id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: string;
  workspaceId?: string;
  workspacePath?: string;
  lastMessagePreview?: string;
  lastMessageAt: number;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
}

/**
 * Creates a Y.js sync provider for AI sessions.
 */
export function createYjsSessionSync(config: SyncConfig): SyncProvider {
  const sessions = new Map<string, SessionSync>();

  // SessionsIndex connection (always connected when sync is active)
  let indexDoc: Y.Doc | null = null;
  let indexProvider: WebsocketProvider | null = null;

  function getWebSocketUrl(sessionId: string): string {
    const base = config.serverUrl.replace(/\/$/, '');
    return `${base}/sync`;
  }

  /**
   * Connect to the SessionsIndex Y.Doc
   */
  async function connectToIndex(): Promise<void> {
    if (indexDoc) return; // Already connected

    indexDoc = new Y.Doc();
    const indexId = `${config.userId}:index`;
    const wsUrl = getWebSocketUrl(indexId);

    indexProvider = new WebsocketProvider(wsUrl, indexId, indexDoc, {
      params: {
        authorization: `Bearer ${config.userId}:${config.authToken}`,
      },
      connect: true,
    });

    // Wait for connection
    return new Promise((resolve) => {
      const checkConnection = () => {
        if (indexProvider?.wsconnected) {
          resolve();
        }
      };
      indexProvider!.on('status', checkConnection);
      // Resolve after timeout even if not connected - index is optional
      setTimeout(resolve, 5000);
      checkConnection();
    });
  }

  /**
   * Update a session entry in the SessionsIndex
   */
  function updateSessionIndex(sessionId: string, metadata: Partial<SyncedSessionMetadata>): void {
    if (!indexDoc) {
      console.warn('[YjsSessionSync] Cannot update index - indexDoc is null');
      return;
    }

    if (!indexProvider?.wsconnected) {
      console.warn('[YjsSessionSync] Cannot update index - not connected');
      return;
    }

    const sessionsMap = indexDoc.getMap<SessionIndexEntry>('sessions');

    indexDoc.transact(() => {
      const existing = sessionsMap.get(sessionId);
      const now = Date.now();

      const entry: SessionIndexEntry = {
        id: sessionId,
        title: metadata.title ?? existing?.title ?? 'Untitled',
        provider: metadata.provider ?? existing?.provider ?? 'unknown',
        model: metadata.model ?? existing?.model,
        mode: metadata.mode ?? existing?.mode,
        lastMessagePreview: existing?.lastMessagePreview,
        lastMessageAt: existing?.lastMessageAt ?? now,
        messageCount: existing?.messageCount ?? 0,
        updatedAt: now,
        createdAt: existing?.createdAt ?? now,
      };

      console.log('[YjsSessionSync] Updating index entry:', sessionId, JSON.stringify(entry));
      sessionsMap.set(sessionId, entry);
    });
  }

  /**
   * Remove a session from the SessionsIndex
   */
  function removeFromIndex(sessionId: string): void {
    if (!indexDoc) return;

    const sessionsMap = indexDoc.getMap<SessionIndexEntry>('sessions');
    indexDoc.transact(() => {
      sessionsMap.delete(sessionId);
    });
  }

  // Connect to index immediately
  console.log('[YjsSessionSync] Connecting to SessionsIndex...');
  connectToIndex()
    .then(() => {
      console.log('[YjsSessionSync] Connected to SessionsIndex, wsconnected:', indexProvider?.wsconnected);
    })
    .catch((err) => {
      console.warn('[YjsSessionSync] Failed to connect to SessionsIndex:', err);
    });

  function createInitialStatus(): SyncStatus {
    return {
      connected: false,
      syncing: false,
      lastSyncedAt: null,
      error: null,
    };
  }

  function updateStatus(
    sessionId: string,
    update: Partial<SyncStatus>
  ): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.status = { ...session.status, ...update };
    session.statusListeners.forEach((cb) => cb(session.status));
  }

  function setupDocumentListeners(sessionId: string, doc: Y.Doc): () => void {
    const session = sessions.get(sessionId);
    if (!session) return () => {};

    const messages = doc.getArray<SyncedMessage>('messages');
    const metadata = doc.getMap<unknown>('metadata');

    // Listen for remote message additions
    const messageObserver = (event: Y.YArrayEvent<SyncedMessage>) => {
      if (event.transaction.local) return; // Ignore local changes

      event.changes.added.forEach((item) => {
        item.content.getContent().forEach((message) => {
          session.changeListeners.forEach((cb) =>
            cb({ type: 'message_added', message: message as SyncedMessage })
          );
        });
      });
    };
    messages.observe(messageObserver);

    // Listen for remote metadata changes
    const metadataObserver = (event: Y.YMapEvent<unknown>) => {
      if (event.transaction.local) return;

      const changedMetadata: Partial<SyncedSessionMetadata> = {};
      event.keysChanged.forEach((key) => {
        changedMetadata[key as keyof SyncedSessionMetadata] = metadata.get(key) as never;
      });

      if (Object.keys(changedMetadata).length > 0) {
        session.changeListeners.forEach((cb) =>
          cb({ type: 'metadata_updated', metadata: changedMetadata })
        );
      }
    };
    metadata.observe(metadataObserver);

    return () => {
      messages.unobserve(messageObserver);
      metadata.unobserve(metadataObserver);
    };
  }

  return {
    async connect(sessionId: string): Promise<void> {
      if (sessions.has(sessionId)) {
        return; // Already connected
      }

      const doc = new Y.Doc();
      const wsUrl = getWebSocketUrl(sessionId);

      const provider = new WebsocketProvider(wsUrl, sessionId, doc, {
        params: {
          authorization: `Bearer ${config.userId}:${config.authToken}`,
        },
        connect: true,
      });

      const session: SessionSync = {
        doc,
        provider,
        status: createInitialStatus(),
        statusListeners: new Set(),
        changeListeners: new Set(),
        unsubscribe: () => {},
      };

      sessions.set(sessionId, session);

      // Set up status tracking
      provider.on('status', ({ status }: { status: string }) => {
        updateStatus(sessionId, {
          connected: status === 'connected',
          error: null,
        });
      });

      provider.on('sync', (isSynced: boolean) => {
        updateStatus(sessionId, {
          syncing: !isSynced,
          lastSyncedAt: isSynced ? Date.now() : session.status.lastSyncedAt,
        });
      });

      provider.on('connection-error', (event: Event) => {
        updateStatus(sessionId, {
          connected: false,
          error: 'Connection failed',
        });
      });

      // Set up document listeners
      session.unsubscribe = setupDocumentListeners(sessionId, doc);

      // Wait for initial connection
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        const checkConnection = () => {
          if (provider.wsconnected) {
            clearTimeout(timeout);
            resolve();
          }
        };

        provider.on('status', checkConnection);
        checkConnection();
      });
    },

    disconnect(sessionId: string): void {
      const session = sessions.get(sessionId);
      if (!session) return;

      session.unsubscribe();
      session.provider.disconnect();
      session.provider.destroy();
      session.doc.destroy();
      sessions.delete(sessionId);
    },

    disconnectAll(): void {
      for (const sessionId of sessions.keys()) {
        this.disconnect(sessionId);
      }

      // Also disconnect from index
      if (indexProvider) {
        indexProvider.disconnect();
        indexProvider.destroy();
        indexProvider = null;
      }
      if (indexDoc) {
        indexDoc.destroy();
        indexDoc = null;
      }
    },

    isConnected(sessionId: string): boolean {
      const session = sessions.get(sessionId);
      return session?.status.connected ?? false;
    },

    getStatus(sessionId: string): SyncStatus {
      const session = sessions.get(sessionId);
      return session?.status ?? createInitialStatus();
    },

    onStatusChange(
      sessionId: string,
      callback: (status: SyncStatus) => void
    ): () => void {
      const session = sessions.get(sessionId);
      if (!session) {
        return () => {};
      }

      session.statusListeners.add(callback);
      return () => {
        session.statusListeners.delete(callback);
      };
    },

    onRemoteChange(
      sessionId: string,
      callback: (change: SessionChange) => void
    ): () => void {
      const session = sessions.get(sessionId);
      if (!session) {
        return () => {};
      }

      session.changeListeners.add(callback);
      return () => {
        session.changeListeners.delete(callback);
      };
    },

    pushChange(sessionId: string, change: SessionChange): void {
      const session = sessions.get(sessionId);
      if (!session) {
        console.warn('[YjsSessionSync] pushChange: session not found:', sessionId);
        return;
      }

      console.log('[YjsSessionSync] pushChange:', sessionId, change.type, change.type === 'metadata_updated' ? JSON.stringify(change.metadata) : '');

      const { doc } = session;

      doc.transact(() => {
        switch (change.type) {
          case 'message_added': {
            const messages = doc.getArray<SyncedMessage>('messages');
            messages.push([change.message]);
            break;
          }

          case 'metadata_updated': {
            const metadata = doc.getMap<unknown>('metadata');
            for (const [key, value] of Object.entries(change.metadata)) {
              if (value !== undefined) {
                metadata.set(key, value);
              }
            }
            break;
          }

          case 'session_deleted': {
            // Mark as deleted in metadata - actual cleanup happens elsewhere
            const metadata = doc.getMap<unknown>('metadata');
            metadata.set('deleted', true);
            metadata.set('deletedAt', Date.now());
            break;
          }
        }
      });

      // Also update the SessionsIndex
      if (change.type === 'metadata_updated') {
        updateSessionIndex(sessionId, change.metadata);
      } else if (change.type === 'session_deleted') {
        removeFromIndex(sessionId);
      }
    },

    syncSessionsToIndex(sessionsData: SessionIndexData[]): void {
      if (!indexDoc) {
        console.warn('[YjsSessionSync] Cannot sync to index - indexDoc is null');
        return;
      }

      if (!indexProvider?.wsconnected) {
        console.warn('[YjsSessionSync] Cannot sync to index - not connected');
        return;
      }

      console.log('[YjsSessionSync] Syncing', sessionsData.length, 'sessions to index');

      const sessionsMap = indexDoc.getMap<SessionIndexEntry>('sessions');

      indexDoc.transact(() => {
        for (const session of sessionsData) {
          const entry: SessionIndexEntry = {
            id: session.id,
            title: session.title,
            provider: session.provider,
            model: session.model,
            mode: session.mode,
            workspaceId: session.workspaceId,
            workspacePath: session.workspacePath,
            lastMessagePreview: undefined,
            lastMessageAt: session.updatedAt,
            messageCount: session.messageCount,
            updatedAt: session.updatedAt,
            createdAt: session.createdAt,
          };
          sessionsMap.set(session.id, entry);
        }
      });

      console.log('[YjsSessionSync] Index now has', sessionsMap.size, 'sessions');

      // Also sync messages to individual session Y.Docs
      for (const session of sessionsData) {
        if (session.messages && session.messages.length > 0) {
          this.syncSessionMessages(session.id, session.messages, {
            title: session.title,
            provider: session.provider,
            model: session.model,
          });
        }
      }
    },

    /**
     * Sync messages to an individual session Y.Doc
     */
    syncSessionMessages(sessionId: string, messages: SyncedMessage[], metadata?: { title?: string; provider?: string; model?: string }): void {
      // Create a temporary connection to sync messages
      const doc = new Y.Doc();
      const wsUrl = getWebSocketUrl(sessionId);

      const provider = new WebsocketProvider(wsUrl, sessionId, doc, {
        params: {
          authorization: `Bearer ${config.userId}:${config.authToken}`,
        },
        connect: true,
      });

      // Wait for connection, then sync messages
      const doSync = () => {
        if (!provider.wsconnected) return;

        console.log('[YjsSessionSync] Syncing', messages.length, 'messages to session', sessionId);

        const messagesArray = doc.getArray<SyncedMessage>('messages');
        const metadataMap = doc.getMap<unknown>('metadata');

        doc.transact(() => {
          // Clear existing and add all messages
          if (messagesArray.length > 0) {
            messagesArray.delete(0, messagesArray.length);
          }
          messagesArray.push(messages);

          // Also set basic metadata
          if (metadata) {
            if (metadata.title) metadataMap.set('title', metadata.title);
            if (metadata.provider) metadataMap.set('provider', metadata.provider);
            if (metadata.model) metadataMap.set('model', metadata.model);
          }
        });

        // Disconnect after a short delay to allow sync
        setTimeout(() => {
          provider.disconnect();
          provider.destroy();
          doc.destroy();
        }, 1000);
      };

      provider.on('sync', (isSynced: boolean) => {
        if (isSynced) doSync();
      });

      // Timeout fallback
      setTimeout(() => {
        if (provider.wsconnected) {
          doSync();
        } else {
          provider.disconnect();
          provider.destroy();
          doc.destroy();
        }
      }, 5000);
    },
  };
}
