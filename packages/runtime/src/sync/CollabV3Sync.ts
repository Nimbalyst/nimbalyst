/**
 * CollabV3 Sync Provider
 *
 * Provides real-time sync of AI sessions using the CollabV3 protocol.
 * Uses WebSocket connections to Durable Objects with DO SQLite storage.
 *
 * Key differences from Y.js sync (CollabV2):
 * - Simple append-only message protocol (no CRDTs)
 * - Cursor-based pagination instead of state vectors
 * - Per-message encryption instead of whole-doc encryption
 * - No tombstone bloat from deletions
 */

import type { AgentMessage } from '../ai/server/types';
import type {
  SyncConfig,
  SyncStatus,
  SyncProvider,
  SessionChange,
  SyncedSessionMetadata,
  SessionIndexData,
  ProjectIndexEntry,
  DeviceInfo,
} from './types';

// ============================================================================
// CollabV3 Protocol Types (matches server)
// ============================================================================

interface EncryptedMessage {
  id: string;
  sequence: number;
  created_at: number;
  source: 'user' | 'assistant' | 'tool' | 'system';
  direction: 'input' | 'output';
  encrypted_content: string;
  iv: string;
  metadata: {
    tool_name?: string;
    has_attachments?: boolean;
    content_length?: number;
  };
}

interface SessionMetadata {
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  project_id: string;
  created_at: number;
  updated_at: number;
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: 'mobile' | 'desktop';
  };
  isExecuting?: boolean;
}

interface SessionIndexEntry {
  session_id: string;
  project_id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  message_count: number;
  last_message_at: number;
  created_at: number;
  updated_at: number;
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: 'mobile' | 'desktop';
  };
  /** Whether the session is currently executing (processing AI request) */
  isExecuting?: boolean;
}

type ClientMessage =
  | { type: 'sync_request'; since_id?: string; since_seq?: number }
  | { type: 'append_message'; message: EncryptedMessage }
  | { type: 'update_metadata'; metadata: Partial<SessionMetadata> }
  | { type: 'delete_session' }
  | { type: 'index_sync_request'; project_id?: string }
  | { type: 'index_update'; session: SessionIndexEntry }
  | { type: 'index_batch_update'; sessions: SessionIndexEntry[] }
  | { type: 'index_delete'; session_id: string }
  | { type: 'device_announce'; device: DeviceInfo };

type ServerMessage =
  | { type: 'sync_response'; messages: EncryptedMessage[]; metadata: SessionMetadata | null; has_more: boolean; cursor: string | null }
  | { type: 'message_broadcast'; message: EncryptedMessage; from_connection_id?: string }
  | { type: 'metadata_broadcast'; metadata: Partial<SessionMetadata>; from_connection_id?: string }
  | { type: 'index_sync_response'; sessions: SessionIndexEntry[]; projects: Array<{ project_id: string; name: string; session_count: number; last_activity_at: number; sync_enabled: boolean }> }
  | { type: 'index_broadcast'; session: SessionIndexEntry; from_connection_id?: string }
  | { type: 'devices_list'; devices: DeviceInfo[] }
  | { type: 'device_joined'; device: DeviceInfo }
  | { type: 'device_left'; device_id: string }
  | { type: 'error'; code: string; message: string };

// ============================================================================
// Base64 Utilities (handles large byte arrays)
// ============================================================================

/**
 * Convert Uint8Array to base64 string.
 * Uses chunked approach to avoid call stack size limits with large arrays.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // For small arrays, use simple approach
  if (bytes.length < 1024) {
    return btoa(String.fromCharCode(...bytes));
  }

  // For large arrays, chunk to avoid stack overflow
  const CHUNK_SIZE = 8192;
  let result = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

/**
 * Convert base64 string to Uint8Array.
 * Returns a Uint8Array backed by an ArrayBuffer (not SharedArrayBuffer).
 */
function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// Encryption Utilities
// ============================================================================

async function encrypt(
  content: string,
  key: CryptoKey
): Promise<{ encrypted: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(content);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return {
    encrypted: uint8ArrayToBase64(new Uint8Array(encrypted)),
    iv: uint8ArrayToBase64(iv),
  };
}

async function decrypt(
  encrypted: string,
  iv: string,
  key: CryptoKey
): Promise<string> {
  const encryptedBytes = base64ToUint8Array(encrypted);
  const ivBytes = base64ToUint8Array(iv);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    encryptedBytes
  );

  return new TextDecoder().decode(decrypted);
}

// ============================================================================
// Session Connection
// ============================================================================

interface SessionConnection {
  ws: WebSocket;
  status: SyncStatus;
  statusListeners: Set<(status: SyncStatus) => void>;
  changeListeners: Set<(change: SessionChange) => void>;
  lastSequence: number;
  encryptionKey?: CryptoKey;
}

// Cache of session index entries for partial update merging
interface CachedSessionIndex {
  session_id: string;
  project_id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  message_count: number;
  last_message_at: number;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// CollabV3 Sync Provider
// ============================================================================

export function createCollabV3Sync(config: SyncConfig): SyncProvider {
  const sessions = new Map<string, SessionConnection>();
  const sessionIndexCache = new Map<string, CachedSessionIndex>();
  let indexWs: WebSocket | null = null;
  let indexConnected = false;
  let deviceAnnounceInterval: ReturnType<typeof setInterval> | null = null;

  // Listeners for index changes (session updates broadcast to all connected clients)
  const indexChangeListeners = new Set<(sessionId: string, entry: SessionIndexEntry) => void>();

  // Queue for operations that need to wait for index connection
  type PendingOperation = { type: 'sessions'; data: SessionIndexData[]; options?: { syncMessages?: boolean } } | { type: 'projects'; data: ProjectIndexEntry[] };
  const pendingOperations: PendingOperation[] = [];

  // Pending fetch index request (resolves when index_sync_response is received)
  let pendingIndexFetch: {
    resolve: (result: { sessions: SessionIndexEntry[]; projects: Array<{ project_id: string; name: string; session_count: number; last_activity_at: number; sync_enabled: boolean }> }) => void;
    reject: (error: Error) => void;
  } | null = null;

  // Helper to announce device to the index server
  function announceDevice(): void {
    if (config.deviceInfo && indexWs && indexConnected) {
      const announceMsg: ClientMessage = {
        type: 'device_announce',
        device: {
          ...config.deviceInfo,
          last_active_at: Date.now(), // Update last active time
        },
      };
      indexWs.send(JSON.stringify(announceMsg));
      console.log('[CollabV3] Announced device:', config.deviceInfo.name);
    }
  }

  // Start periodic device re-announcement to handle server hibernation
  function startDeviceAnnounceInterval(): void {
    stopDeviceAnnounceInterval();
    if (config.deviceInfo) {
      // Re-announce every 30 seconds to handle server hibernation
      deviceAnnounceInterval = setInterval(() => {
        announceDevice();
      }, 30000);
    }
  }

  // Stop the periodic re-announcement
  function stopDeviceAnnounceInterval(): void {
    if (deviceAnnounceInterval) {
      clearInterval(deviceAnnounceInterval);
      deviceAnnounceInterval = null;
    }
  }

  function getRoomId(sessionId: string): string {
    return `user:${config.userId}:session:${sessionId}`;
  }

  function getIndexRoomId(): string {
    return `user:${config.userId}:index`;
  }

  function getWebSocketUrl(roomId: string): string {
    const base = config.serverUrl.replace(/\/$/, '');
    // Convert http(s) to ws(s) if needed
    const wsBase = base.replace(/^http/, 'ws');
    return `${wsBase}/sync/${roomId}`;
  }

  function createInitialStatus(): SyncStatus {
    return {
      connected: false,
      syncing: false,
      lastSyncedAt: null,
      error: null,
    };
  }

  function updateStatus(sessionId: string, update: Partial<SyncStatus>): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.status = { ...session.status, ...update };
    session.statusListeners.forEach((cb) => cb(session.status));
  }

  async function encryptMessage(
    message: AgentMessage,
    key: CryptoKey
  ): Promise<EncryptedMessage> {
    // Include hidden flag in encrypted content so it syncs to mobile
    const content = JSON.stringify({
      content: message.content,
      metadata: message.metadata,
      hidden: message.hidden ?? false,
    });

    const { encrypted, iv } = await encrypt(content, key);

    // Generate a unique sync ID - local message IDs may not be unique (e.g., 0 before DB insert)
    // Use UUID to ensure uniqueness across all synced messages
    const syncId = crypto.randomUUID();

    return {
      id: syncId,
      sequence: 0, // Server assigns sequence
      created_at: message.createdAt instanceof Date
        ? message.createdAt.getTime()
        : typeof message.createdAt === 'number'
          ? message.createdAt
          : Date.now(),
      source: message.source as EncryptedMessage['source'],
      direction: message.direction as EncryptedMessage['direction'],
      encrypted_content: encrypted,
      iv,
      metadata: {
        tool_name: message.metadata?.['toolName'] as string | undefined,
        has_attachments: !!message.metadata?.['attachments'],
        content_length: content.length,
      },
    };
  }

  async function decryptMessage(
    encrypted: EncryptedMessage,
    key: CryptoKey
  ): Promise<AgentMessage> {
    const decrypted = await decrypt(encrypted.encrypted_content, encrypted.iv, key);
    const parsed = JSON.parse(decrypted);

    return {
      id: parseInt(encrypted.id, 10) || 0,
      sessionId: '', // Filled in by caller
      source: encrypted.source,
      direction: encrypted.direction,
      content: parsed.content,
      metadata: parsed.metadata,
      createdAt: new Date(encrypted.created_at),
      hidden: parsed.hidden ?? false,
    };
  }

  function handleServerMessage(
    sessionId: string,
    data: string | ArrayBuffer
  ): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    try {
      const message: ServerMessage = JSON.parse(
        typeof data === 'string' ? data : new TextDecoder().decode(data)
      );

      switch (message.type) {
        case 'sync_response':
          handleSyncResponse(sessionId, message);
          break;

        case 'message_broadcast':
          handleMessageBroadcast(sessionId, message);
          break;

        case 'metadata_broadcast':
          handleMetadataBroadcast(sessionId, message);
          break;

        case 'error':
          console.error(`[CollabV3] Server error for ${sessionId}:`, message.code, message.message);
          updateStatus(sessionId, { error: message.message });
          break;
      }
    } catch (err) {
      console.error('[CollabV3] Error parsing server message:', err);
    }
  }

  async function handleSyncResponse(
    sessionId: string,
    response: Extract<ServerMessage, { type: 'sync_response' }>
  ): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Update last sequence
    if (response.messages.length > 0) {
      session.lastSequence = response.messages[response.messages.length - 1].sequence;
    }

    // Decrypt and emit messages as remote changes
    if (session.encryptionKey && response.messages.length > 0) {
      for (const encrypted of response.messages) {
        try {
          const decrypted = await decryptMessage(encrypted, session.encryptionKey);
          decrypted.sessionId = sessionId;

          session.changeListeners.forEach((cb) =>
            cb({ type: 'message_added', message: decrypted })
          );
        } catch (err) {
          console.error('[CollabV3] Failed to decrypt message:', err);
        }
      }
    }

    // Update status
    updateStatus(sessionId, {
      syncing: response.has_more,
      lastSyncedAt: Date.now(),
    });

    // Request more if needed
    if (response.has_more && response.cursor) {
      const nextRequest: ClientMessage = {
        type: 'sync_request',
        since_seq: parseInt(response.cursor, 10),
      };
      session.ws.send(JSON.stringify(nextRequest));
    }
  }

  async function handleMessageBroadcast(
    sessionId: string,
    broadcast: Extract<ServerMessage, { type: 'message_broadcast' }>
  ): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session || !session.encryptionKey) return;

    try {
      const decrypted = await decryptMessage(broadcast.message, session.encryptionKey);
      decrypted.sessionId = sessionId;

      // Update sequence tracking
      session.lastSequence = Math.max(session.lastSequence, broadcast.message.sequence);

      // Emit to listeners
      session.changeListeners.forEach((cb) =>
        cb({ type: 'message_added', message: decrypted })
      );
    } catch (err) {
      console.error('[CollabV3] Failed to decrypt broadcast message:', err);
    }
  }

  function handleMetadataBroadcast(
    sessionId: string,
    broadcast: Extract<ServerMessage, { type: 'metadata_broadcast' }>
  ): void {
    console.log('[CollabV3] Received metadata_broadcast for session:', sessionId, 'metadata:', JSON.stringify(broadcast.metadata));

    const session = sessions.get(sessionId);
    if (!session) {
      console.log('[CollabV3] No session found for metadata_broadcast, sessionId:', sessionId);
      return;
    }

    const metadata: Partial<SyncedSessionMetadata> = {
      title: broadcast.metadata.title,
      mode: broadcast.metadata.mode,
      provider: broadcast.metadata.provider,
      model: broadcast.metadata.model,
      updatedAt: broadcast.metadata.updated_at ?? Date.now(),
      pendingExecution: broadcast.metadata.pendingExecution,
      isExecuting: broadcast.metadata.isExecuting,
    };

    console.log('[CollabV3] Notifying', session.changeListeners.size, 'change listeners with pendingExecution:', metadata.pendingExecution, 'isExecuting:', metadata.isExecuting);

    session.changeListeners.forEach((cb) =>
      cb({ type: 'metadata_updated', metadata })
    );
  }

  // Process pending operations that were queued before connection was established
  function processPendingOperations(): void {
    if (!indexWs || !indexConnected) return;

    console.log('[CollabV3] Processing', pendingOperations.length, 'pending operations');

    // Process in order they were queued
    while (pendingOperations.length > 0) {
      const op = pendingOperations.shift()!;
      if (op.type === 'sessions') {
        // Call the sync function directly (now that we're connected)
        doSyncSessionsToIndex(op.data, op.options);
      }
      // Projects are auto-calculated from sessions in CollabV3, so nothing to do
    }
  }

  // Connect to index for session list updates
  function connectToIndex(): void {
    if (indexWs) return;

    const url = getWebSocketUrl(getIndexRoomId());
    const wsUrl = `${url}?user_id=${config.userId}&token=${config.authToken}`;

    indexWs = new WebSocket(wsUrl);

    indexWs.onopen = () => {
      indexConnected = true;
      console.log('[CollabV3] Connected to index');

      // Send device announcement if device info is provided
      announceDevice();

      // Process any operations that were queued while connecting
      processPendingOperations();

      // Set up periodic re-announcement to handle server hibernation
      // The server may hibernate and lose device state, so we re-announce every 30 seconds
      startDeviceAnnounceInterval();
    };

    indexWs.onclose = () => {
      indexConnected = false;
      indexWs = null;
      stopDeviceAnnounceInterval();
      console.log('[CollabV3] Disconnected from index');
    };

    indexWs.onerror = (event) => {
      const errorInfo = event instanceof ErrorEvent
        ? { message: event.message, error: event.error }
        : { type: event.type };
      console.error('[CollabV3] Index WebSocket error:', errorInfo, 'URL:', wsUrl);
    };

    indexWs.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(
          typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
        );

        switch (message.type) {
          case 'index_sync_response':
            console.log('[CollabV3] Received index_sync_response:', message.sessions.length, 'sessions');
            if (pendingIndexFetch) {
              pendingIndexFetch.resolve({
                sessions: message.sessions,
                projects: message.projects,
              });
              pendingIndexFetch = null;
            }
            break;

          case 'index_broadcast':
            // Another device updated a session, cache it
            sessionIndexCache.set(message.session.session_id, message.session);
            console.log('[CollabV3] Received index_broadcast for session:', message.session.session_id, 'pendingExecution:', message.session.pendingExecution);

            // Notify all index change listeners
            indexChangeListeners.forEach((callback) => {
              try {
                callback(message.session.session_id, message.session);
              } catch (err) {
                console.error('[CollabV3] Error in index change listener:', err);
              }
            });
            break;

          case 'devices_list':
            console.log('[CollabV3] Received devices list:', message.devices.length, 'devices');
            break;

          case 'device_joined':
            console.log('[CollabV3] Device joined:', message.device.name);
            break;

          case 'device_left':
            console.log('[CollabV3] Device left:', message.device_id);
            break;

          case 'error':
            console.error('[CollabV3] Index error:', message.code, message.message);
            if (pendingIndexFetch) {
              pendingIndexFetch.reject(new Error(message.message));
              pendingIndexFetch = null;
            }
            break;
        }
      } catch (err) {
        console.error('[CollabV3] Error parsing index message:', err);
      }
    };
  }

  // Log the config being used
  console.log('[CollabV3] Initializing with config:', {
    serverUrl: config.serverUrl,
    userId: config.userId,
    hasEncryptionKey: !!config.encryptionKey,
  });

  // Start index connection
  connectToIndex();

  // Sync messages to a session room (internal function)
  async function syncSessionMessages(
    sessionId: string,
    messages: AgentMessage[],
    metadata?: { title?: string; provider?: string; model?: string; mode?: string }
  ): Promise<void> {
    if (!config.encryptionKey) {
      console.error('[CollabV3] Cannot sync messages - no encryption key');
      return;
    }

    console.log('[CollabV3] Syncing', messages.length, 'messages to session', sessionId);

    // Connect to session room
    const roomId = getRoomId(sessionId);
    const url = getWebSocketUrl(roomId);
    const wsUrl = `${url}?user_id=${config.userId}&token=${config.authToken}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          reject(new Error('Timeout syncing messages'));
        }
      }, 30000);

      ws.onopen = async () => {
        try {
          // First update metadata if provided
          if (metadata) {
            const metadataMsg: ClientMessage = {
              type: 'update_metadata',
              metadata: {
                title: metadata.title,
                provider: metadata.provider,
                model: metadata.model,
                mode: metadata.mode as 'agent' | 'planning' | undefined,
              },
            };
            ws.send(JSON.stringify(metadataMsg));
          }

          // Send each message
          for (const message of messages) {
            const encrypted = await encryptMessage(message, config.encryptionKey!);
            const clientMsg: ClientMessage = { type: 'append_message', message: encrypted };
            ws.send(JSON.stringify(clientMsg));
          }

          // Small delay to ensure messages are processed
          await new Promise(r => setTimeout(r, 500));

          clearTimeout(timeout);
          resolved = true;
          ws.close();
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          resolved = true;
          ws.close();
          reject(err);
        }
      };

      ws.onerror = (err) => {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          reject(err);
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          resolve();
        }
      };
    });
  }

  // Batch sync session messages with delay to prevent server overload (internal function)
  async function doBatchSyncSessionMessages(sessionsData: SessionIndexData[]): Promise<void> {
    const sessionsWithMessages = sessionsData.filter(s => s.messages && s.messages.length > 0);
    const batchSize = 3;
    const delayMs = 1000;

    console.log('[CollabV3] Batch syncing', sessionsWithMessages.length, 'sessions in batches of', batchSize);

    for (let i = 0; i < sessionsWithMessages.length; i += batchSize) {
      const batch = sessionsWithMessages.slice(i, i + batchSize);

      console.log(`[CollabV3] Syncing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sessionsWithMessages.length / batchSize)} (${batch.length} sessions)`);

      // Sync batch in parallel
      await Promise.all(batch.map(session =>
        syncSessionMessages(session.id, session.messages!, {
          title: session.title,
          provider: session.provider,
          model: session.model,
          mode: session.mode,
        })
      ));

      // Delay before next batch
      if (i + batchSize < sessionsWithMessages.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log('[CollabV3] Batch sync complete');
  }

  // Helper function to actually sync sessions to index (requires connection)
  function doSyncSessionsToIndex(sessionsData: SessionIndexData[], options?: { syncMessages?: boolean }): void {
    if (!indexWs || !indexConnected) {
      console.error('[CollabV3] doSyncSessionsToIndex called but not connected!');
      return;
    }

    console.log('[CollabV3] Syncing', sessionsData.length, 'sessions to index');

    // Build all entries
    const entries: SessionIndexEntry[] = sessionsData.map(session => {
      const entry: SessionIndexEntry = {
        session_id: session.id,
        project_id: session.workspaceId ?? 'default',
        title: session.title,
        provider: session.provider,
        model: session.model,
        mode: session.mode as SessionIndexEntry['mode'],
        message_count: session.messageCount,
        last_message_at: session.updatedAt,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      };

      // Cache the entry for partial update merging later
      sessionIndexCache.set(session.id, entry);
      return entry;
    });

    // Use batch API if we have multiple sessions, otherwise single update
    if (entries.length > 1) {
      const msg: ClientMessage = { type: 'index_batch_update', sessions: entries };
      indexWs.send(JSON.stringify(msg));
      console.log('[CollabV3] Sent batch index update for', entries.length, 'sessions');
    } else if (entries.length === 1) {
      const msg: ClientMessage = { type: 'index_update', session: entries[0] };
      indexWs.send(JSON.stringify(msg));
    }

    // Sync messages if requested
    if (options?.syncMessages === true) {
      console.log('[CollabV3] Batching message sync for', sessionsData.length, 'sessions');
      doBatchSyncSessionMessages(sessionsData);
    }
  }

  // Create provider object
  const provider: SyncProvider = {
    async connect(sessionId: string): Promise<void> {
      if (sessions.has(sessionId)) {
        return; // Already connected
      }

      const roomId = getRoomId(sessionId);
      const url = getWebSocketUrl(roomId);
      const wsUrl = `${url}?user_id=${config.userId}&token=${config.authToken}`;

      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        const session: SessionConnection = {
          ws,
          status: createInitialStatus(),
          statusListeners: new Set(),
          changeListeners: new Set(),
          lastSequence: 0,
          encryptionKey: config.encryptionKey,
        };

        sessions.set(sessionId, session);

        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
          ws.close();
          sessions.delete(sessionId);
        }, 10000);

        ws.onopen = () => {
          clearTimeout(timeout);
          updateStatus(sessionId, { connected: true, syncing: true });

          // Request initial sync
          const syncRequest: ClientMessage = { type: 'sync_request' };
          ws.send(JSON.stringify(syncRequest));

          resolve();
        };

        ws.onclose = () => {
          updateStatus(sessionId, { connected: false });
          sessions.delete(sessionId);
        };

        ws.onerror = (event) => {
          // Extract useful error info from the event
          const errorInfo = event instanceof ErrorEvent
            ? { message: event.message, error: event.error }
            : { type: event.type, target: (event.target as WebSocket)?.url };
          console.error(`[CollabV3] WebSocket error for ${sessionId}:`, errorInfo, 'URL:', wsUrl);
          updateStatus(sessionId, { connected: false, error: 'Connection error' });
        };

        ws.onmessage = (event) => {
          handleServerMessage(sessionId, event.data);
        };
      });
    },

    disconnect(sessionId: string): void {
      const session = sessions.get(sessionId);
      if (!session) return;

      session.ws.close();
      sessions.delete(sessionId);
    },

    disconnectAll(): void {
      for (const sessionId of sessions.keys()) {
        this.disconnect(sessionId);
      }

      if (indexWs) {
        indexWs.close();
        indexWs = null;
        indexConnected = false;
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

    onStatusChange(sessionId: string, callback: (status: SyncStatus) => void): () => void {
      const session = sessions.get(sessionId);
      if (!session) return () => {};

      session.statusListeners.add(callback);
      return () => session.statusListeners.delete(callback);
    },

    onRemoteChange(sessionId: string, callback: (change: SessionChange) => void): () => void {
      const session = sessions.get(sessionId);
      if (!session) return () => {};

      session.changeListeners.add(callback);
      return () => session.changeListeners.delete(callback);
    },

    async pushChange(sessionId: string, change: SessionChange): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session || !session.status.connected) {
        console.warn('[CollabV3] Cannot push change - not connected:', sessionId);
        return;
      }

      let clientMessage: ClientMessage;

      switch (change.type) {
        case 'message_added': {
          if (!session.encryptionKey) {
            console.warn('[CollabV3] Cannot push message - no encryption key');
            return;
          }
          try {
            const encrypted = await encryptMessage(change.message, session.encryptionKey);
            console.log('[CollabV3] Encrypted message:', {
              id: encrypted.id,
              contentLength: encrypted.encrypted_content.length,
              ivLength: encrypted.iv.length,
              source: encrypted.source,
              direction: encrypted.direction,
            });
            clientMessage = { type: 'append_message', message: encrypted };
          } catch (err) {
            console.error('[CollabV3] Failed to encrypt message:', err);
            return;
          }
          break;
        }

        case 'metadata_updated': {
          const metadata: Partial<SessionMetadata> = {};
          if (change.metadata.title) metadata.title = change.metadata.title;
          if (change.metadata.provider) metadata.provider = change.metadata.provider;
          if (change.metadata.model) metadata.model = change.metadata.model;
          if (change.metadata.mode) metadata.mode = change.metadata.mode as SessionMetadata['mode'];
          // pendingExecution can be set or explicitly cleared (undefined)
          if ('pendingExecution' in change.metadata) {
            metadata.pendingExecution = change.metadata.pendingExecution;
          }
          // isExecuting can be set or explicitly cleared
          if ('isExecuting' in change.metadata) {
            metadata.isExecuting = change.metadata.isExecuting;
          }
          clientMessage = { type: 'update_metadata', metadata };
          break;
        }

        case 'session_deleted':
          // Send delete to session room
          clientMessage = { type: 'delete_session' };
          break;
      }

      try {
        const json = JSON.stringify(clientMessage);
        console.log('[CollabV3] Sending message, length:', json.length);
        session.ws.send(json);
      } catch (err) {
        console.error('[CollabV3] Failed to send message:', err);
      }

      // Handle index updates based on change type
      if (indexWs && indexConnected) {
        if (change.type === 'session_deleted') {
          // Delete from index and cache
          sessionIndexCache.delete(sessionId);
          const indexDeleteMsg: ClientMessage = { type: 'index_delete', session_id: sessionId };
          console.log('[CollabV3] Sending index_delete for session:', sessionId);
          indexWs.send(JSON.stringify(indexDeleteMsg));
        } else if (change.type === 'metadata_updated') {
          const meta = change.metadata;
          const cached = sessionIndexCache.get(sessionId);
          const updatedAt = meta.updatedAt ?? Date.now();

          // Build index entry by merging with cached data
          // This allows partial updates (e.g., just title) to work
          if (cached) {
            // Merge partial update with cached entry
            const indexEntry: SessionIndexEntry = {
              session_id: sessionId,
              project_id: meta.workspaceId ?? cached.project_id,
              title: meta.title ?? cached.title,
              provider: meta.provider ?? cached.provider,
              model: meta.model ?? cached.model,
              mode: (meta.mode ?? cached.mode) as SessionIndexEntry['mode'],
              message_count: cached.message_count,
              last_message_at: updatedAt,
              created_at: cached.created_at,
              updated_at: updatedAt,
              // Include pendingExecution if set (or explicitly cleared)
              pendingExecution: 'pendingExecution' in meta ? meta.pendingExecution : cached.pendingExecution,
              // Include isExecuting if set (or explicitly cleared)
              isExecuting: 'isExecuting' in meta ? meta.isExecuting : cached.isExecuting,
            };
            // Update cache
            sessionIndexCache.set(sessionId, indexEntry);
            const indexMsg: ClientMessage = { type: 'index_update', session: indexEntry };
            console.log('[CollabV3] Sending index_update (partial merge) for session:', sessionId, 'title:', indexEntry.title, 'isExecuting:', indexEntry.isExecuting);
            indexWs.send(JSON.stringify(indexMsg));
          } else if (meta.title && meta.provider) {
            // New session - need at least title and provider
            const indexEntry: SessionIndexEntry = {
              session_id: sessionId,
              project_id: meta.workspaceId ?? 'default',
              title: meta.title,
              provider: meta.provider,
              model: meta.model,
              mode: meta.mode as SessionIndexEntry['mode'],
              message_count: 0,
              last_message_at: updatedAt,
              created_at: updatedAt,
              updated_at: updatedAt,
              pendingExecution: meta.pendingExecution,
              isExecuting: meta.isExecuting,
            };
            // Add to cache
            sessionIndexCache.set(sessionId, indexEntry);
            const indexMsg: ClientMessage = { type: 'index_update', session: indexEntry };
            console.log('[CollabV3] Sending index_update (new) for session:', sessionId, 'isExecuting:', indexEntry.isExecuting);
            indexWs.send(JSON.stringify(indexMsg));
          } else {
            console.log('[CollabV3] Skipping index update - no cached data and missing required fields for session:', sessionId);
          }
        }
      }
    },

    syncSessionsToIndex(sessionsData: SessionIndexData[], options?: { syncMessages?: boolean }): void {
      if (!indexWs || !indexConnected) {
        // Queue the operation to run when connection is established
        console.log('[CollabV3] Index not connected yet, queueing sync of', sessionsData.length, 'sessions');
        pendingOperations.push({ type: 'sessions', data: sessionsData, options });
        return;
      }

      // Call the helper function
      doSyncSessionsToIndex(sessionsData, options);
    },

    syncProjectsToIndex(projects: ProjectIndexEntry[]): void {
      // Projects are derived from sessions in CollabV3
      // The index room calculates project stats from session data
      console.log('[CollabV3] Projects are auto-calculated from sessions');
    },

    async fetchIndex(): Promise<{ sessions: SessionIndexEntry[]; projects: Array<{ project_id: string; name: string; session_count: number; last_activity_at: number; sync_enabled: boolean }> }> {
      // Wait for connection if not ready
      if (!indexWs || !indexConnected) {
        console.log('[CollabV3] Waiting for index connection before fetching...');
        await new Promise<void>((resolve) => {
          const checkConnection = setInterval(() => {
            if (indexWs && indexConnected) {
              clearInterval(checkConnection);
              resolve();
            }
          }, 100);
          // Timeout after 10 seconds
          setTimeout(() => {
            clearInterval(checkConnection);
            resolve();
          }, 10000);
        });
      }

      if (!indexWs || !indexConnected) {
        throw new Error('Index connection not available');
      }

      return new Promise((resolve, reject) => {
        // Set timeout for response
        const timeout = setTimeout(() => {
          if (pendingIndexFetch) {
            pendingIndexFetch = null;
            reject(new Error('Timeout waiting for index response'));
          }
        }, 30000);

        pendingIndexFetch = {
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        };

        // Send index sync request
        const request: ClientMessage = { type: 'index_sync_request' };
        indexWs!.send(JSON.stringify(request));
        console.log('[CollabV3] Sent index_sync_request');
      });
    },

    onIndexChange(callback: (sessionId: string, entry: SessionIndexEntry) => void): () => void {
      indexChangeListeners.add(callback);
      console.log('[CollabV3] Added index change listener, total:', indexChangeListeners.size);
      return () => {
        indexChangeListeners.delete(callback);
        console.log('[CollabV3] Removed index change listener, total:', indexChangeListeners.size);
      };
    },
  };

  return provider;
}
