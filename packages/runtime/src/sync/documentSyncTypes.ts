/**
 * Types for DocumentSync -- client-side Yjs + encryption layer.
 *
 * These are the client-side equivalents of the DocClientMessage/DocServerMessage
 * types defined in collabv3/src/types.ts. Duplicated here to avoid a dependency
 * on the collabv3 package (which is a Cloudflare Worker, not a library).
 */

// ============================================================================
// Configuration
// ============================================================================

export interface DocumentSyncConfig {
  /** WebSocket server URL (e.g., wss://sync.nimbalyst.com) */
  serverUrl: string;

  /** Function to get fresh JWT for WebSocket auth */
  getJwt: () => Promise<string>;

  /** B2B organization ID */
  orgId: string;

  /** AES-256-GCM key for encrypting/decrypting Yjs updates */
  documentKey: CryptoKey;

  /** Current user's ID */
  userId: string;

  /** Document ID (used to construct room ID) */
  documentId: string;

  /** Org key fingerprint for key epoch enforcement. If provided, the server
   *  rejects writes with a stale fingerprint after key rotation. */
  orgKeyFingerprint?: string;

  /** Called when a remote Yjs update is applied to the Y.Doc */
  onRemoteUpdate?: (origin: string) => void;

  /** Called when awareness state changes from remote users */
  onAwarenessUpdate?: (states: Map<string, AwarenessState>) => void;

  /** Called when connection status changes */
  onStatusChange?: (status: DocumentSyncStatus) => void;

  /**
   * Previously persisted local updates that have not been acknowledged by the
   * server yet. Applied locally on startup so the editor can recover them.
   */
  initialPendingUpdateBase64?: string;

  /**
   * Called whenever the merged pending local update changes. The host can
   * persist this blob so offline edits survive renderer/app restarts.
   */
  onPendingUpdateChange?: (
    pendingUpdateBase64: string | null
  ) => void | Promise<void>;

  /**
   * Called when the review gate state changes (remote changes arrive or are accepted/rejected).
   * Allows UI to show pending review indicators.
   */
  onReviewStateChange?: (state: ReviewGateState) => void;

  /**
   * Called when a key envelope is received from the server.
   * The consumer should verify `senderPublicKey` against the sender's
   * registered identity key (from TeamRoom) before using the envelope
   * to unwrap the document key. Use ECDHKeyManager.unwrapDocumentKeyVerified().
   */
  onKeyEnvelope?: (envelope: {
    wrappedKey: string;
    iv: string;
    senderPublicKey: string;
    senderUserId: string;
  }) => void;

  /**
   * Enable the review gate for remote changes.
   * When true, remote updates are applied to the Y.Doc (for CRDT correctness and live preview)
   * but marked as "unreviewed" -- the host application should not autosave until
   * acceptRemoteChanges() is called.
   *
   * When false (default), all remote updates are treated as accepted immediately.
   * Use false for single-user multi-device sync (no review needed for your own edits).
   */
  reviewGateEnabled?: boolean;

  /**
   * Override the WebSocket URL construction.
   * If provided, called instead of the default JWT-based URL builder.
   * Useful for integration tests with auth bypass.
   */
  buildUrl?: (roomId: string) => string;

  /**
   * Factory for creating WebSocket connections.
   * If provided, used instead of `new WebSocket(url)`.
   * This allows the Electron renderer to proxy WebSocket connections
   * through the main process (Node.js), working around Cloudflare proxy
   * restrictions that block browser WebSocket upgrades.
   */
  createWebSocket?: (url: string) => WebSocket;
}

// ============================================================================
// Review Gate
// ============================================================================

/**
 * State of the review gate for remote changes.
 * Mirrors the AI "pending review" pattern: remote edits are visible in the editor
 * but not saved to disk until the user explicitly accepts them.
 */
export interface ReviewGateState {
  /** Whether there are any unreviewed remote changes */
  hasUnreviewed: boolean;
  /** Number of buffered remote update operations */
  unreviewedCount: number;
  /** User IDs that contributed unreviewed changes */
  unreviewedAuthors: string[];
}

// ============================================================================
// Status
// ============================================================================

export type DocumentSyncStatus =
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'replaying'
  | 'offline-unsynced'
  | 'connected'
  | 'error';

// ============================================================================
// Awareness
// ============================================================================

/**
 * Serialized Yjs relative position.
 * Created via Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, index)).
 * Survives concurrent edits -- if someone inserts text before your cursor,
 * the relative position still resolves correctly after the remote update is merged.
 */
export type SerializedRelativePosition = string; // base64 encoded

export interface AwarenessState {
  /**
   * Cursor/selection as Yjs relative positions.
   * Anchor = start of selection, head = end of selection (may be equal for a collapsed cursor).
   * Encoded as base64 Yjs relative positions for wire transmission.
   */
  cursor?: {
    anchor: SerializedRelativePosition;
    head: SerializedRelativePosition;
  };
  /** User info for rendering remote cursors */
  user: { name: string; color: string };
}

// ============================================================================
// Wire Protocol (client-side copies of collabv3 types)
// ============================================================================

/** Client -> Server messages */
export type DocClientMessage =
  | { type: 'docSyncRequest'; sinceSeq: number }
  | { type: 'docUpdate'; encryptedUpdate: string; iv: string; clientUpdateId?: string; orgKeyFingerprint?: string }
  | { type: 'docCompact'; encryptedState: string; iv: string; replacesUpTo: number; orgKeyFingerprint?: string }
  | { type: 'docAwareness'; encryptedState: string; iv: string }
  | { type: 'addKeyEnvelope'; targetUserId: string; wrappedKey: string; iv: string; senderPublicKey: string }
  | { type: 'requestKeyEnvelope' }
  | { type: 'docSetMetadata'; entries: Record<string, string> };

/** Server -> Client messages */
export type DocServerMessage =
  | DocSyncResponseMessage
  | DocUpdateBroadcastMessage
  | DocUpdateAckMessage
  | DocAwarenessBroadcastMessage
  | DocKeyEnvelopeMessage
  | DocErrorMessage;

export interface DocSyncResponseMessage {
  type: 'docSyncResponse';
  updates: EncryptedDocUpdate[];
  snapshot?: EncryptedDocSnapshot;
  hasMore: boolean;
  cursor: number;
}

export interface DocUpdateBroadcastMessage {
  type: 'docUpdateBroadcast';
  encryptedUpdate: string;
  iv: string;
  senderId: string;
  sequence: number;
}

export interface DocUpdateAckMessage {
  type: 'docUpdateAck';
  clientUpdateId: string;
  sequence: number;
}

export interface DocAwarenessBroadcastMessage {
  type: 'docAwarenessBroadcast';
  encryptedState: string;
  iv: string;
  fromUserId: string;
}

export interface DocKeyEnvelopeMessage {
  type: 'keyEnvelope';
  wrappedKey: string;
  iv: string;
  senderPublicKey: string;
  /** User ID of the sender who created this envelope */
  senderUserId: string;
}

export interface DocErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface EncryptedDocUpdate {
  sequence: number;
  encryptedUpdate: string;
  iv: string;
  senderId: string;
  createdAt: number;
}

export interface EncryptedDocSnapshot {
  encryptedState: string;
  iv: string;
  replacesUpTo: number;
  createdAt: number;
}
