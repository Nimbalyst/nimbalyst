/**
 * TrackerSyncProvider
 *
 * Client-side tracker item sync with E2E encryption over WebSocket.
 * Connects to a TrackerRoom Durable Object, sends/receives encrypted
 * tracker items, and handles field-level LWW conflict resolution.
 *
 * The provider:
 * - Encrypts all outgoing tracker items with AES-256-GCM
 * - Decrypts incoming items and delivers them via callbacks
 * - Handles sync (initial load + delta), realtime broadcasts, and deletes
 * - Queues mutations while offline and replays on reconnect
 * - Never sends plaintext data over the wire
 */

import type {
  TrackerSyncConfig,
  TrackerSyncStatus,
  TrackerItemPayload,
  TrackerSyncResult,
  TrackerClientMessage,
  TrackerServerMessage,
  TrackerSyncResponseMessage,
  TrackerUpsertBroadcastMessage,
  TrackerDeleteBroadcastMessage,
  EncryptedTrackerItem,
} from './trackerSyncTypes';

// ============================================================================
// Encryption Utilities
// ============================================================================

const CHUNK_SIZE = 8192;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (bytes.length < 1024) {
    return btoa(String.fromCharCode(...bytes));
  }
  let result = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function encryptPayload(
  payload: TrackerItemPayload,
  key: CryptoKey
): Promise<{ encryptedPayload: string; iv: string }> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  return {
    encryptedPayload: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    iv: uint8ArrayToBase64(iv),
  };
}

async function decryptPayload(
  encryptedPayload: string,
  iv: string,
  key: CryptoKey
): Promise<TrackerItemPayload> {
  const ciphertext = base64ToUint8Array(encryptedPayload);
  const ivBytes = base64ToUint8Array(iv);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ============================================================================
// Field-Level LWW Merge
// ============================================================================

/**
 * Merge two versions of the same tracker item using per-field Last-Write-Wins.
 * For each field, the version with the more recent `fieldUpdatedAt` timestamp wins.
 * For array fields (labels, linkedSessions, comments), entire array LWW is used
 * (not element-level merge).
 */
export function mergeTrackerItems(
  local: TrackerItemPayload,
  remote: TrackerItemPayload
): TrackerItemPayload {
  const merged: TrackerItemPayload = { ...local };
  const mergedTimestamps: Record<string, number> = { ...local.fieldUpdatedAt };

  const mergeableFields: (keyof TrackerItemPayload)[] = [
    'title', 'description', 'status', 'priority',
    'assigneeEmail', 'reporterEmail', 'authorIdentity', 'lastModifiedBy',
    'assigneeId', 'reporterId', 'labels', 'linkedSessions',
    'linkedCommitSha', 'documentId', 'comments', 'customFields',
    'archived', 'archivedAt',
  ];

  for (const field of mergeableFields) {
    const localTs = local.fieldUpdatedAt[field] ?? 0;
    const remoteTs = remote.fieldUpdatedAt[field] ?? 0;

    if (remoteTs > localTs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[field] = remote[field];
      mergedTimestamps[field] = remoteTs;
    }
    // If equal timestamps, local wins (arbitrary but deterministic)
  }

  merged.fieldUpdatedAt = mergedTimestamps;
  return merged;
}

// ============================================================================
// TrackerSyncProvider
// ============================================================================

/** Queued mutation for offline replay */
interface QueuedMutation {
  type: 'upsert' | 'delete';
  itemId: string;
  payload?: TrackerItemPayload;
}

export class TrackerSyncProvider {
  private config: TrackerSyncConfig;
  private ws: WebSocket | null = null;
  private status: TrackerSyncStatus = 'disconnected';
  private synced = false;
  private destroyed = false;

  /** Server sequence cursor for delta sync */
  private lastSequence = 0;

  /** Offline mutation queue -- replayed on reconnect */
  private offlineQueue: QueuedMutation[] = [];

  /** Local cache of decrypted items (itemId -> payload) for LWW merge */
  private localItems: Map<string, TrackerItemPayload> = new Map();

  /** Reconnect state */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 10;
  private static readonly BASE_RECONNECT_DELAY_MS = 1000;
  private static readonly MAX_RECONNECT_DELAY_MS = 60000;

  constructor(config: TrackerSyncConfig) {
    this.config = config;
  }

  // --------------------------------------------------------------------------
  // Connection Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Connect to the TrackerRoom and begin syncing.
   */
  async connect(): Promise<void> {
    if (this.destroyed) throw new Error('Provider has been destroyed');
    if (this.ws) return;

    this.cancelReconnect();
    this.setStatus('connecting');

    const { serverUrl, orgId, projectId } = this.config;
    const roomId = `org:${orgId}:tracker:${projectId}`;

    let url: string;
    if (this.config.buildUrl) {
      url = this.config.buildUrl(roomId);
    } else {
      const jwt = await this.config.getJwt();
      url = `${serverUrl}/sync/${roomId}?token=${encodeURIComponent(jwt)}`;
    }

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      console.log('[TrackerSync] WebSocket connected, requesting sync...');
      this.reconnectAttempts = 0; // Reset on successful connection
      this.setStatus('syncing');
      this.requestSync();
    });

    ws.addEventListener('message', (event) => {
      this.handleMessage(event);
    });

    ws.addEventListener('error', () => {
      // WebSocket error events carry no useful detail -- the close event
      // that follows has the code and reason. Just log that it happened.
      console.error('[TrackerSync] WebSocket error (details in close event)');
    });

    ws.addEventListener('close', (event) => {
      console.log('[TrackerSync] WebSocket closed:', event.code, event.reason);
      // Auth errors (expired JWT) should still attempt reconnect --
      // getJwt() will fetch a fresh token. Only stop if fresh token also fails.
      this.handleDisconnect();
    });
  }

  /**
   * Disconnect from the TrackerRoom.
   */
  disconnect(): void {
    this.cancelReconnect(true);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.synced = false;
    this.setStatus('disconnected');
  }

  /**
   * Destroy the provider. Cannot be reused after this.
   */
  destroy(): void {
    this.cancelReconnect(true);
    this.disconnect();
    this.localItems.clear();
    this.offlineQueue = [];
    this.destroyed = true;
  }

  /**
   * Get the current connection status.
   */
  getStatus(): TrackerSyncStatus {
    return this.status;
  }

  /**
   * Get the current sequence cursor.
   */
  getLastSequence(): number {
    return this.lastSequence;
  }

  // --------------------------------------------------------------------------
  // Public API: Mutations
  // --------------------------------------------------------------------------

  /**
   * Upsert a tracker item. Encrypts and sends to server.
   * If offline, queues the mutation for replay on reconnect.
   */
  async upsertItem(payload: TrackerItemPayload): Promise<void> {
    // Update local cache
    this.localItems.set(payload.itemId, payload);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.offlineQueue.push({ type: 'upsert', itemId: payload.itemId, payload });
      return;
    }

    const { encryptedPayload, iv } = await encryptPayload(payload, this.config.encryptionKey);
    console.log('[TrackerSync] Sending upsert for item:', payload.itemId);
    this.send({
      type: 'trackerUpsert',
      itemId: payload.itemId,
      encryptedPayload,
      iv,
    });
  }

  /**
   * Delete a tracker item. Sends delete to server.
   * If offline, queues the mutation for replay on reconnect.
   */
  async deleteItem(itemId: string): Promise<void> {
    this.localItems.delete(itemId);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.offlineQueue.push({ type: 'delete', itemId });
      return;
    }

    this.send({ type: 'trackerDelete', itemId });
  }

  /**
   * Batch upsert tracker items. Encrypts and sends all at once.
   * If offline, queues each item individually.
   */
  async batchUpsertItems(payloads: TrackerItemPayload[]): Promise<void> {
    for (const payload of payloads) {
      this.localItems.set(payload.itemId, payload);
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      for (const payload of payloads) {
        this.offlineQueue.push({ type: 'upsert', itemId: payload.itemId, payload });
      }
      return;
    }

    const items = await Promise.all(
      payloads.map(async (payload) => {
        const { encryptedPayload, iv } = await encryptPayload(payload, this.config.encryptionKey);
        return { itemId: payload.itemId, encryptedPayload, iv };
      })
    );

    this.send({ type: 'trackerBatchUpsert', items });
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      const message: TrackerServerMessage = JSON.parse(String(event.data));
      console.log('[TrackerSync] Received message:', message.type);

      switch (message.type) {
        case 'trackerSyncResponse':
          await this.handleSyncResponse(message);
          break;
        case 'trackerUpsertBroadcast':
          await this.handleUpsertBroadcast(message);
          break;
        case 'trackerDeleteBroadcast':
          this.handleDeleteBroadcast(message);
          break;
        case 'error':
          console.error('[TrackerSync] Server error:', message.code, message.message);
          break;
      }
    } catch (err) {
      console.error('[TrackerSync] Error handling message:', err);
    }
  }

  private async handleSyncResponse(msg: TrackerSyncResponseMessage): Promise<void> {
    console.log('[TrackerSync] Sync response:', msg.items.length, 'items,', msg.deletedItemIds.length, 'deletions, sequence:', msg.sequence, 'hasMore:', msg.hasMore);
    // Decrypt all items
    for (const encryptedItem of msg.items) {
      try {
        const payload = await decryptPayload(
          encryptedItem.encryptedPayload,
          encryptedItem.iv,
          this.config.encryptionKey
        );

        // Check for conflict with local version
        const localItem = this.localItems.get(payload.itemId);
        if (localItem) {
          const merged = mergeTrackerItems(localItem, payload);
          this.localItems.set(payload.itemId, merged);
          this.config.onItemUpserted?.(merged);
        } else {
          this.localItems.set(payload.itemId, payload);
          this.config.onItemUpserted?.(payload);
        }
      } catch (err) {
        console.error('[TrackerSync] Failed to decrypt item:', encryptedItem.itemId, err);
      }
    }

    // Process deletions
    for (const itemId of msg.deletedItemIds) {
      this.localItems.delete(itemId);
      this.config.onItemDeleted?.(itemId);
    }

    this.lastSequence = msg.sequence;

    // If there are more items, request next batch
    if (msg.hasMore) {
      this.requestSync();
      return;
    }

    // Sync complete
    if (!this.synced) {
      this.synced = true;
      this.setStatus('connected');
      console.log('[TrackerSync] Initial sync complete, now connected. Local items:', this.localItems.size);
      // Replay offline queue after initial sync
      await this.replayOfflineQueue();
    }
  }

  private async handleUpsertBroadcast(msg: TrackerUpsertBroadcastMessage): Promise<void> {
    console.log('[TrackerSync] Received upsert broadcast for item:', msg.item.itemId, 'sequence:', msg.item.sequence);
    try {
      const payload = await decryptPayload(
        msg.item.encryptedPayload,
        msg.item.iv,
        this.config.encryptionKey
      );

      // Check for conflict with local version
      const localItem = this.localItems.get(payload.itemId);
      if (localItem) {
        const merged = mergeTrackerItems(localItem, payload);
        this.localItems.set(payload.itemId, merged);
        this.config.onItemUpserted?.(merged);
      } else {
        this.localItems.set(payload.itemId, payload);
        this.config.onItemUpserted?.(payload);
      }

      // Advance sequence
      if (msg.item.sequence > this.lastSequence) {
        this.lastSequence = msg.item.sequence;
      }
    } catch (err) {
      console.error('[TrackerSync] Failed to decrypt broadcast item:', msg.item.itemId, err);
    }
  }

  private handleDeleteBroadcast(msg: TrackerDeleteBroadcastMessage): void {
    this.localItems.delete(msg.itemId);
    this.config.onItemDeleted?.(msg.itemId);

    if (msg.sequence > this.lastSequence) {
      this.lastSequence = msg.sequence;
    }
  }

  // --------------------------------------------------------------------------
  // Sync Protocol
  // --------------------------------------------------------------------------

  private requestSync(): void {
    this.send({ type: 'trackerSync', sinceSequence: this.lastSequence });
  }

  private async replayOfflineQueue(): Promise<void> {
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const mutation of queue) {
      if (mutation.type === 'upsert' && mutation.payload) {
        await this.upsertItem(mutation.payload);
      } else if (mutation.type === 'delete') {
        await this.deleteItem(mutation.itemId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  private send(message: TrackerClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private setStatus(status: TrackerSyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.config.onStatusChange?.(status);
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.synced = false;
    this.setStatus('disconnected');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return; // already scheduled
    if (this.reconnectAttempts >= TrackerSyncProvider.MAX_RECONNECT_ATTEMPTS) {
      console.log('[TrackerSync] Max reconnect attempts reached, giving up');
      return;
    }

    // Exponential backoff with jitter: base * 2^attempt + random jitter
    const delay = Math.min(
      TrackerSyncProvider.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      TrackerSyncProvider.MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempts++;

    console.log(`[TrackerSync] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${TrackerSyncProvider.MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.destroyed || this.ws) return;
      try {
        await this.connect();
      } catch (err) {
        console.error('[TrackerSync] Reconnect failed:', err);
        // Keep retrying -- getJwt() fetches fresh tokens, so even auth
        // errors may resolve on the next attempt (e.g., expired JWT that
        // gets refreshed). Max attempts cap prevents infinite loops.
        this.handleDisconnect();
      }
    }, delay);
  }

  private cancelReconnect(resetAttempts = false): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (resetAttempts) {
      this.reconnectAttempts = 0;
    }
  }
}
