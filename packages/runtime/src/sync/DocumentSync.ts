/**
 * DocumentSyncProvider
 *
 * Client-side Yjs document sync with E2E encryption over WebSocket.
 * Connects to a DocumentRoom Durable Object, sends/receives encrypted
 * Yjs updates, and manages awareness state.
 *
 * The provider:
 * - Creates and owns a Y.Doc instance
 * - Encrypts all outgoing Yjs updates with AES-256-GCM
 * - Decrypts incoming updates and applies them to the Y.Doc
 * - Handles sync (initial load), realtime broadcasts, and awareness
 * - Never sends plaintext data over the wire
 *
 * Review Gate:
 * When reviewGateEnabled is true, remote updates are applied to the Y.Doc
 * (for CRDT correctness) but tracked as "unreviewed". The host application
 * should not autosave until acceptRemoteChanges() is called. This mirrors
 * the AI "pending review" pattern for collaborator trust boundaries.
 */

import * as Y from 'yjs';
import type {
  DocumentSyncConfig,
  DocumentSyncStatus,
  AwarenessState,
  ReviewGateState,
  DocClientMessage,
  DocServerMessage,
  DocSyncResponseMessage,
  DocUpdateBroadcastMessage,
  DocAwarenessBroadcastMessage,
} from './documentSyncTypes';

// ============================================================================
// Base64 / Encryption Utilities
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
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function encryptBinary(
  data: Uint8Array,
  key: CryptoKey
): Promise<{ encrypted: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return {
    encrypted: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    iv: uint8ArrayToBase64(iv),
  };
}

async function decryptBinary(
  encrypted: string,
  iv: string,
  key: CryptoKey
): Promise<Uint8Array> {
  const ciphertext = base64ToUint8Array(encrypted);
  const ivBytes = base64ToUint8Array(iv);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ciphertext
  );
  return new Uint8Array(plaintext);
}

// ============================================================================
// DocumentSyncProvider
// ============================================================================

/** Origin string used for remote Yjs transactions */
const REMOTE_ORIGIN = 'remote';

/** Origin string used for snapshot Yjs transactions */
const SNAPSHOT_ORIGIN = 'snapshot';

/** Awareness throttle interval: ~2Hz */
const AWARENESS_THROTTLE_MS = 500;

/** Remove awareness state for users who haven't sent an update in this many ms */
const AWARENESS_STALE_TIMEOUT_MS = 30_000;

/**
 * A buffered remote update: the raw Yjs update bytes plus metadata.
 * Used by the review gate to track which remote changes are unreviewed.
 */
interface BufferedRemoteUpdate {
  /** Raw decrypted Yjs update bytes */
  updateBytes: Uint8Array;
  /** User who sent this update */
  senderId: string;
  /** Server sequence number */
  sequence: number;
  /** When we received this update locally */
  receivedAt: number;
}

export class DocumentSyncProvider {
  private ydoc: Y.Doc;
  private ws: WebSocket | null = null;
  private config: DocumentSyncConfig;
  private status: DocumentSyncStatus = 'disconnected';
  private lastSeq = 0;
  private synced = false;
  private updateObserverDispose: (() => void) | null = null;
  private awarenessStates: Map<string, AwarenessState> = new Map();
  private awarenessTimestamps: Map<string, number> = new Map();
  private awarenessListeners: Set<(states: Map<string, AwarenessState>) => void> = new Set();
  private destroyed = false;

  // Throttled awareness state
  private pendingAwareness: AwarenessState | null = null;
  private awarenessThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAwarenessSendTime = 0;
  private awarenessCleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Review gate state
  private unreviewedUpdates: BufferedRemoteUpdate[] = [];
  /**
   * The Y.Doc state vector at the point of last review acceptance.
   * All state up to this vector has been accepted for autosave.
   * Null until initial sync completes (at which point it's set to the
   * current state vector, since initial sync data is considered accepted).
   */
  private reviewedStateVector: Uint8Array | null = null;

  // Reconnect state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly RECONNECT_BASE_MS = 1000;
  private static readonly RECONNECT_MAX_MS = 30_000;

  constructor(config: DocumentSyncConfig) {
    this.config = config;
    this.ydoc = new Y.Doc();
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Connect to the DocumentRoom and begin syncing.
   */
  private connecting = false;

  async connect(): Promise<void> {
    if (this.destroyed) throw new Error('Provider has been destroyed');
    if (this.ws || this.connecting) return;

    this.connecting = true;
    this.setStatus('connecting');

    const { serverUrl, orgId, documentId } = this.config;
    const roomId = `org:${orgId}:doc:${documentId}`;

    let url: string;
    try {
      if (this.config.buildUrl) {
        url = this.config.buildUrl(roomId);
      } else {
        const jwt = await this.config.getJwt();
        url = `${serverUrl}/sync/${roomId}?token=${encodeURIComponent(jwt)}`;
      }
    } catch (err) {
      console.error('[DocumentSync] Failed to build URL:', err);
      this.connecting = false;
      this.setStatus('disconnected');
      return;
    }

    // Check again after async gap
    if (this.destroyed || this.ws) {
      this.connecting = false;
      return;
    }

    console.log('[DocumentSync] Connecting to:', url.replace(/token=[^&]+/, 'token=<redacted>'));
    const ws = this.config.createWebSocket
      ? this.config.createWebSocket(url)
      : new WebSocket(url);
    this.ws = ws;
    this.connecting = false;

    ws.addEventListener('open', () => {
      console.log('[DocumentSync] WebSocket open');
      this.reconnectAttempt = 0;
      this.setStatus('syncing');
      this.setupUpdateObserver();
      this.startAwarenessCleanup();
      this.requestSync();
    });

    ws.addEventListener('message', (event) => {
      this.handleMessage(event);
    });

    ws.addEventListener('close', (event) => {
      console.log('[DocumentSync] WebSocket closed, code:', event.code, 'reason:', event.reason);
      this.handleDisconnect();
    });

    ws.addEventListener('error', (event) => {
      console.error('[DocumentSync] WebSocket error:', event);
      this.handleDisconnect();
    });
  }

  /**
   * Disconnect from the DocumentRoom.
   */
  disconnect(): void {
    this.cancelReconnect();
    this.connecting = false;
    this.teardownUpdateObserver();
    this.stopAwarenessCleanup();
    this.clearAwarenessThrottle();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.synced = false;
    this.setStatus('disconnected');
  }

  /**
   * Destroy the provider and its Y.Doc. Cannot be reused after this.
   */
  destroy(): void {
    this.destroyed = true;
    this.disconnect();
    this.ydoc.destroy();
    this.awarenessListeners.clear();
    this.awarenessStates.clear();
    this.unreviewedUpdates = [];
    this.reviewedStateVector = null;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Get the Y.Doc managed by this provider. */
  getYDoc(): Y.Doc {
    return this.ydoc;
  }

  /** Check if connected and synced. */
  isConnected(): boolean {
    return this.status === 'connected';
  }

  /** Check if initial sync is complete. */
  isSynced(): boolean {
    return this.synced;
  }

  /** Get current connection status. */
  getStatus(): DocumentSyncStatus {
    return this.status;
  }

  /** Get the last known server sequence number. */
  getLastSeq(): number {
    return this.lastSeq;
  }

  /**
   * Send encrypted awareness state to other connected clients.
   * Sends immediately (no throttling). Use setLocalAwareness() for throttled updates.
   */
  async sendAwareness(state: AwarenessState): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const jsonBytes = new TextEncoder().encode(JSON.stringify(state));
    const { encrypted, iv } = await encryptBinary(jsonBytes, this.config.documentKey);

    this.send({
      type: 'docAwareness',
      encryptedState: encrypted,
      iv,
    });
  }

  /**
   * Set local awareness state with throttling (~2Hz).
   * Coalesces rapid updates (e.g., cursor movements while typing) and sends
   * at most once per AWARENESS_THROTTLE_MS.
   */
  setLocalAwareness(state: AwarenessState): void {
    this.pendingAwareness = state;

    const now = Date.now();
    const elapsed = now - this.lastAwarenessSendTime;

    if (elapsed >= AWARENESS_THROTTLE_MS) {
      // Enough time has passed, send immediately
      this.flushAwareness();
    } else if (!this.awarenessThrottleTimer) {
      // Schedule a send after the throttle interval
      const delay = AWARENESS_THROTTLE_MS - elapsed;
      this.awarenessThrottleTimer = setTimeout(() => {
        this.awarenessThrottleTimer = null;
        this.flushAwareness();
      }, delay);
    }
    // If timer already scheduled, the pending state will be sent when it fires
  }

  private flushAwareness(): void {
    if (!this.pendingAwareness) return;
    const state = this.pendingAwareness;
    this.pendingAwareness = null;
    // Set timestamp synchronously before the async send, so rapid
    // calls to setLocalAwareness see the updated time immediately
    this.lastAwarenessSendTime = Date.now();
    this.sendAwareness(state);
  }

  private clearAwarenessThrottle(): void {
    if (this.awarenessThrottleTimer) {
      clearTimeout(this.awarenessThrottleTimer);
      this.awarenessThrottleTimer = null;
    }
    this.pendingAwareness = null;
  }

  /**
   * Subscribe to awareness state changes from remote users.
   * Returns an unsubscribe function.
   */
  onAwarenessChange(
    callback: (states: Map<string, AwarenessState>) => void
  ): () => void {
    this.awarenessListeners.add(callback);
    return () => this.awarenessListeners.delete(callback);
  }

  /**
   * Get current awareness states for all remote users.
   */
  getAwarenessStates(): Map<string, AwarenessState> {
    return new Map(this.awarenessStates);
  }

  // --------------------------------------------------------------------------
  // Review Gate API
  // --------------------------------------------------------------------------

  /**
   * Whether the review gate is enabled.
   * When enabled, remote changes are tracked as "unreviewed" and the host
   * application should not autosave until they are accepted.
   */
  get reviewGateEnabled(): boolean {
    return this.config.reviewGateEnabled === true;
  }

  /**
   * Whether there are unreviewed remote changes.
   * Always false when reviewGateEnabled is false.
   */
  hasUnreviewedRemoteChanges(): boolean {
    if (!this.reviewGateEnabled) return false;
    return this.unreviewedUpdates.length > 0;
  }

  /**
   * Get the current review gate state.
   */
  getReviewGateState(): ReviewGateState {
    if (!this.reviewGateEnabled) {
      return { hasUnreviewed: false, unreviewedCount: 0, unreviewedAuthors: [] };
    }
    const authors = [...new Set(this.unreviewedUpdates.map(u => u.senderId))];
    return {
      hasUnreviewed: this.unreviewedUpdates.length > 0,
      unreviewedCount: this.unreviewedUpdates.length,
      unreviewedAuthors: authors,
    };
  }

  /**
   * Get the buffered remote update bytes that haven't been reviewed yet.
   * Returns a copy. The UI layer can apply these to a separate Y.Doc
   * to compute diffs for gutter decorations.
   */
  getUnreviewedUpdates(): Uint8Array[] {
    return this.unreviewedUpdates.map(u => u.updateBytes.slice());
  }

  /**
   * Get the Yjs state as it was at the last review acceptance point.
   * The host can compare this to the current Y.Doc state to show diffs.
   * Returns null if no review has occurred yet (initial sync not complete).
   */
  getReviewedStateVector(): Uint8Array | null {
    return this.reviewedStateVector ? this.reviewedStateVector.slice() : null;
  }

  /**
   * Compute the diff between the reviewed state and the current Y.Doc.
   * Returns a Yjs update that, when applied to a Y.Doc at the reviewed state,
   * would bring it to the current state. This represents all unreviewed
   * remote changes (useful for rendering diffs/gutter decorations).
   *
   * Returns null if no review baseline exists or no remote changes pending.
   */
  getUnreviewedDiff(): Uint8Array | null {
    if (!this.reviewGateEnabled || !this.reviewedStateVector) return null;
    if (this.unreviewedUpdates.length === 0) return null;
    return Y.encodeStateAsUpdate(this.ydoc, this.reviewedStateVector);
  }

  /**
   * Accept all unreviewed remote changes.
   * Advances the reviewed state vector to the current Y.Doc state.
   * After this call, hasUnreviewedRemoteChanges() returns false and
   * the host application can safely autosave.
   */
  acceptRemoteChanges(): void {
    if (!this.reviewGateEnabled) return;
    if (this.unreviewedUpdates.length === 0) return;

    this.unreviewedUpdates = [];
    this.reviewedStateVector = Y.encodeStateVector(this.ydoc);
    this.notifyReviewStateChange();
  }

  /**
   * Reject all unreviewed remote changes.
   * Clears the unreviewed buffer without advancing the reviewed state vector.
   *
   * The Y.Doc still contains the remote data (CRDTs can't truly undo merged
   * operations). The host application should:
   * 1. Not autosave the current Y.Doc state
   * 2. Restore the file from its last saved version (which doesn't include
   *    the remote changes, since the review gate prevented autosave)
   *
   * The remote changes still exist on the server and will be re-sent on
   * next sync. To permanently prevent them, the user would need to
   * overwrite the server state (e.g., via compaction with their local state).
   */
  rejectRemoteChanges(): void {
    if (!this.reviewGateEnabled) return;
    if (this.unreviewedUpdates.length === 0) return;
    if (!this.reviewedStateVector) return;

    this.unreviewedUpdates = [];
    // Keep the reviewed SV as-is (don't advance it)
    this.notifyReviewStateChange();
  }

  // --------------------------------------------------------------------------
  // Sync Protocol
  // --------------------------------------------------------------------------

  private requestSync(): void {
    this.send({ type: 'docSyncRequest', sinceSeq: this.lastSeq });
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      const data =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      const msg: DocServerMessage = JSON.parse(data);

      switch (msg.type) {
        case 'docSyncResponse':
          await this.handleSyncResponse(msg);
          break;
        case 'docUpdateBroadcast':
          await this.handleUpdateBroadcast(msg);
          break;
        case 'docAwarenessBroadcast':
          await this.handleAwarenessBroadcast(msg);
          break;
        case 'keyEnvelope':
          // Key envelopes are handled at a higher layer (ECDHKeyManager)
          break;
        case 'error':
          console.error('[DocumentSync] Server error:', msg.code, msg.message);
          break;
      }
    } catch (err) {
      console.error('[DocumentSync] Error handling message:', err);
    }
  }

  private async handleSyncResponse(msg: DocSyncResponseMessage): Promise<void> {
    // Apply snapshot if present (covers the entire doc state up to replacesUpTo)
    if (msg.snapshot) {
      const stateBytes = await decryptBinary(
        msg.snapshot.encryptedState,
        msg.snapshot.iv,
        this.config.documentKey
      );
      Y.applyUpdate(this.ydoc, stateBytes, SNAPSHOT_ORIGIN);
      this.lastSeq = Math.max(this.lastSeq, msg.snapshot.replacesUpTo);
    }

    // Apply incremental updates
    for (const update of msg.updates) {
      const updateBytes = await decryptBinary(
        update.encryptedUpdate,
        update.iv,
        this.config.documentKey
      );
      Y.applyUpdate(this.ydoc, updateBytes, REMOTE_ORIGIN);
      this.lastSeq = Math.max(this.lastSeq, update.sequence);
    }

    // If there are more updates, fetch the next page
    if (msg.hasMore) {
      this.lastSeq = msg.cursor;
      this.requestSync();
      return;
    }

    // Sync complete -- set the initial reviewed state vector.
    // Initial sync data is considered "accepted" because it represents
    // the document state the user chose to open. The review gate only
    // applies to new realtime updates from collaborators.
    if (!this.synced) {
      this.synced = true;
      if (this.reviewGateEnabled) {
        this.reviewedStateVector = Y.encodeStateVector(this.ydoc);
      }
      this.setStatus('connected');
    }
  }

  private async handleUpdateBroadcast(
    msg: DocUpdateBroadcastMessage
  ): Promise<void> {
    // Skip our own updates (server echoes don't happen, but guard anyway)
    if (msg.senderId === this.config.userId) return;

    const updateBytes = await decryptBinary(
      msg.encryptedUpdate,
      msg.iv,
      this.config.documentKey
    );
    Y.applyUpdate(this.ydoc, updateBytes, REMOTE_ORIGIN);
    this.lastSeq = Math.max(this.lastSeq, msg.sequence);

    // Buffer the update for the review gate
    if (this.reviewGateEnabled && this.synced) {
      this.unreviewedUpdates.push({
        updateBytes: updateBytes.slice(),
        senderId: msg.senderId,
        sequence: msg.sequence,
        receivedAt: Date.now(),
      });
      this.notifyReviewStateChange();
    }

    this.config.onRemoteUpdate?.(REMOTE_ORIGIN);
  }

  private async handleAwarenessBroadcast(
    msg: DocAwarenessBroadcastMessage
  ): Promise<void> {
    if (msg.fromUserId === this.config.userId) return;

    try {
      const stateBytes = await decryptBinary(
        msg.encryptedState,
        msg.iv,
        this.config.documentKey
      );
      const state: AwarenessState = JSON.parse(
        new TextDecoder().decode(stateBytes)
      );
      this.awarenessStates.set(msg.fromUserId, state);
      this.awarenessTimestamps.set(msg.fromUserId, Date.now());
      this.notifyAwarenessListeners();
    } catch (err) {
      console.error('[DocumentSync] Failed to decrypt awareness:', err);
    }
  }

  // --------------------------------------------------------------------------
  // Local Update Observation
  // --------------------------------------------------------------------------

  /**
   * Watch the Y.Doc for local updates and send them encrypted to the server.
   */
  private setupUpdateObserver(): void {
    if (this.updateObserverDispose) return;

    const handler = async (update: Uint8Array, origin: unknown) => {
      // Only send updates that originated locally (not remote/snapshot)
      if (origin === REMOTE_ORIGIN || origin === SNAPSHOT_ORIGIN) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const { encrypted, iv } = await encryptBinary(
        update,
        this.config.documentKey
      );
      this.send({ type: 'docUpdate', encryptedUpdate: encrypted, iv });
    };

    this.ydoc.on('update', handler);
    this.updateObserverDispose = () => this.ydoc.off('update', handler);
  }

  private teardownUpdateObserver(): void {
    this.updateObserverDispose?.();
    this.updateObserverDispose = null;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private send(msg: DocClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private setStatus(status: DocumentSyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.config.onStatusChange?.(status);
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.synced = false;
    this.connecting = false;
    this.teardownUpdateObserver();
    this.stopAwarenessCleanup();
    this.clearAwarenessThrottle();
    // Clear awareness states on disconnect
    this.awarenessStates.clear();
    this.awarenessTimestamps.clear();
    this.notifyAwarenessListeners();
    this.setStatus('disconnected');
    // Note: unreviewed updates and reviewedStateVector are preserved across
    // disconnect/reconnect. If the user reconnects, they'll still see the
    // pending review state. On reconnect, initial sync is accepted but
    // buffered unreviewed updates remain.
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;

    const delay = Math.min(
      DocumentSyncProvider.RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      DocumentSyncProvider.RECONNECT_MAX_MS
    );
    // Add jitter: 0.5x to 1.5x
    const jittered = delay * (0.5 + Math.random());
    this.reconnectAttempt++;

    console.log(`[DocumentSync] Reconnecting in ${Math.round(jittered / 1000)}s (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        this.connect().catch(err => {
          console.error('[DocumentSync] Reconnect failed:', err);
        });
      }
    }, jittered);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start periodic cleanup of stale remote awareness states.
   * Removes entries from users who haven't sent an update recently.
   */
  private startAwarenessCleanup(): void {
    this.stopAwarenessCleanup();
    this.awarenessCleanupTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [userId, timestamp] of this.awarenessTimestamps) {
        if (now - timestamp > AWARENESS_STALE_TIMEOUT_MS) {
          this.awarenessStates.delete(userId);
          this.awarenessTimestamps.delete(userId);
          changed = true;
        }
      }
      if (changed) {
        this.notifyAwarenessListeners();
      }
    }, AWARENESS_STALE_TIMEOUT_MS / 2);
  }

  private stopAwarenessCleanup(): void {
    if (this.awarenessCleanupTimer) {
      clearInterval(this.awarenessCleanupTimer);
      this.awarenessCleanupTimer = null;
    }
  }

  private notifyAwarenessListeners(): void {
    const snapshot = this.getAwarenessStates();
    for (const listener of this.awarenessListeners) {
      listener(snapshot);
    }
  }

  private notifyReviewStateChange(): void {
    this.config.onReviewStateChange?.(this.getReviewGateState());
  }
}

/**
 * Create a DocumentSyncProvider instance.
 */
export function createDocumentSyncProvider(
  config: DocumentSyncConfig
): DocumentSyncProvider {
  return new DocumentSyncProvider(config);
}
