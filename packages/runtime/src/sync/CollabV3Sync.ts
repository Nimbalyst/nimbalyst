/**
 * CollabV3 Sync Provider
 *
 * Provides real-time sync of AI sessions using the CollabV3 protocol.
 * Uses WebSocket connections to Durable Objects with DO SQLite storage.
 *
 * Authentication:
 * - Uses Stytch session JWTs for all WebSocket connections
 * - User ID is extracted from the JWT 'sub' claim
 * - JWT is sent in the Authorization header (with protocol workaround for WebSocket)
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
  CreateSessionRequest,
  CreateSessionResponse,
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

/** Encrypted queued prompt for wire protocol */
interface EncryptedQueuedPrompt {
  id: string;
  /** Encrypted prompt text (base64) */
  encrypted_prompt: string;
  /** IV for prompt decryption (base64) */
  iv: string;
  timestamp: number;
}

/** Plaintext queued prompt (after decryption) */
interface PlaintextQueuedPrompt {
  id: string;
  prompt: string;
  timestamp: number;
}

interface SessionMetadata {
  /** Encrypted title (base64) */
  encrypted_title?: string;
  /** IV for title decryption (base64) */
  title_iv?: string;
  /** Plaintext title (for local cache / pre-encryption) */
  title?: string;
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
  /** Encrypted queued prompts */
  encryptedQueuedPrompts?: EncryptedQueuedPrompt[];
}

interface SessionIndexEntry {
  session_id: string;
  project_id: string;
  /** Encrypted title (base64) */
  encrypted_title?: string;
  /** IV for title decryption (base64) */
  title_iv?: string;
  /** Plaintext title (for local cache / pre-encryption) */
  title?: string;
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
  /** Number of prompts queued from mobile, waiting for desktop to process */
  queuedPromptCount?: number;
  /** Encrypted queued prompts */
  encryptedQueuedPrompts?: EncryptedQueuedPrompt[];
  /** Whether there are pending interactive prompts (permissions or questions) waiting for response */
  hasPendingPrompt?: boolean;
}

/** Decrypted session index entry with required title - used for return values */
type DecryptedSessionIndexEntry = Omit<SessionIndexEntry, 'title' | 'encrypted_title' | 'title_iv' | 'encryptedQueuedPrompts'> & {
  title: string;  // Required after decryption
  queuedPrompts?: PlaintextQueuedPrompt[];  // Decrypted queued prompts
};

/** Encrypted create session request for wire protocol */
interface EncryptedCreateSessionRequest {
  request_id: string;
  project_id: string;
  /** Encrypted initial prompt (base64), optional */
  encrypted_initial_prompt?: string;
  /** IV for prompt decryption (base64), required if encrypted_initial_prompt present */
  initial_prompt_iv?: string;
  timestamp: number;
}

/** Encrypted create session response for wire protocol */
interface EncryptedCreateSessionResponse {
  request_id: string;
  success: boolean;
  session_id?: string;
  error?: string;
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
  | { type: 'device_announce'; device: DeviceInfo }
  | { type: 'create_session_request'; request: EncryptedCreateSessionRequest }
  | { type: 'create_session_response'; response: EncryptedCreateSessionResponse };

type ServerMessage =
  | { type: 'sync_response'; messages: EncryptedMessage[]; metadata: SessionMetadata | null; has_more: boolean; cursor: string | null }
  | { type: 'message_broadcast'; message: EncryptedMessage; from_connection_id?: string }
  | { type: 'metadata_broadcast'; metadata: Partial<SessionMetadata>; from_connection_id?: string }
  | { type: 'index_sync_response'; sessions: SessionIndexEntry[]; projects: Array<{ project_id: string; name: string; session_count: number; last_activity_at: number; sync_enabled: boolean }> }
  | { type: 'index_broadcast'; session: SessionIndexEntry; from_connection_id?: string }
  | { type: 'project_broadcast'; project: { project_id: string; name: string; session_count: number; last_activity_at: number; sync_enabled: boolean }; from_connection_id?: string }
  | { type: 'devices_list'; devices: DeviceInfo[] }
  | { type: 'device_joined'; device: DeviceInfo }
  | { type: 'device_left'; device_id: string }
  | { type: 'create_session_request_broadcast'; request: EncryptedCreateSessionRequest; from_connection_id?: string }
  | { type: 'create_session_response_broadcast'; response: EncryptedCreateSessionResponse; from_connection_id?: string }
  | { type: 'error'; code: string; message: string };

// ============================================================================
// JWT Utilities
// ============================================================================

/**
 * Extract user ID from a JWT's 'sub' claim.
 * The JWT is a base64url encoded string in the format: header.payload.signature
 */
function extractUserIdFromJwt(jwt: string): string {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // Decode the payload (second part)
    const payload = parts[1];
    // Add padding if needed for base64 decoding
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(decoded);

    if (!parsed.sub) {
      throw new Error('JWT missing sub claim');
    }

    return parsed.sub;
  } catch (error) {
    console.error('[CollabV3] Failed to extract user ID from JWT:', error);
    throw new Error('Invalid JWT: cannot extract user ID');
  }
}

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
// Metadata Encryption Helpers (for title and queued prompts)
// ============================================================================

/**
 * Encrypt queued prompts for wire transmission.
 * Each prompt's text is encrypted individually.
 */
async function encryptQueuedPrompts(
  prompts: PlaintextQueuedPrompt[],
  key: CryptoKey
): Promise<EncryptedQueuedPrompt[]> {
  return Promise.all(
    prompts.map(async (prompt) => {
      const { encrypted, iv } = await encrypt(prompt.prompt, key);
      return {
        id: prompt.id,
        encrypted_prompt: encrypted,
        iv,
        timestamp: prompt.timestamp,
      };
    })
  );
}

/**
 * Decrypt queued prompts received from wire.
 * Each prompt's text is decrypted individually.
 */
async function decryptQueuedPrompts(
  prompts: EncryptedQueuedPrompt[],
  key: CryptoKey
): Promise<PlaintextQueuedPrompt[]> {
  return Promise.all(
    prompts.map(async (prompt) => {
      const decryptedPrompt = await decrypt(prompt.encrypted_prompt, prompt.iv, key);
      return {
        id: prompt.id,
        prompt: decryptedPrompt,
        timestamp: prompt.timestamp,
      };
    })
  );
}

/**
 * Encrypt a session title for wire transmission.
 */
async function encryptTitle(
  title: string,
  key: CryptoKey
): Promise<{ encrypted_title: string; title_iv: string }> {
  const { encrypted, iv } = await encrypt(title, key);
  return {
    encrypted_title: encrypted,
    title_iv: iv,
  };
}

/**
 * Decrypt a session title received from wire.
 */
async function decryptTitle(
  encrypted_title: string,
  title_iv: string,
  key: CryptoKey
): Promise<string> {
  return decrypt(encrypted_title, title_iv, key);
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
  /** Cached metadata from sync_response and metadata_broadcast */
  cachedMetadata?: Partial<SessionMetadata>;
}

// Cache of session index entries for partial update merging
// This cache stores DECRYPTED values locally
interface CachedSessionIndex {
  session_id: string;
  project_id: string;
  /** Decrypted title (stored locally after decryption) */
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  message_count: number;
  last_message_at: number;
  created_at: number;
  updated_at: number;
  // Execution state fields synced via index updates to mobile
  pendingExecution?: {
    messageId: string;
    sentAt: number;
    sentBy: 'mobile' | 'desktop';
  };
  isExecuting?: boolean;
  /** Decrypted queued prompts (stored locally after decryption) */
  queuedPrompts?: PlaintextQueuedPrompt[];
  /** Whether there are pending interactive prompts (permissions or questions) waiting for response */
  hasPendingPrompt?: boolean;
}

// ============================================================================
// CollabV3 Sync Provider
// ============================================================================

export function createCollabV3Sync(config: SyncConfig): SyncProvider {
  // We need to get the initial JWT synchronously for setup, but will refresh before each connection
  // The getJwt function is called before each WebSocket connection to ensure fresh JWT
  let currentJwt: string | null = null;
  let currentUserId: string | null = null;

  // Helper to get fresh JWT and extract user ID
  async function ensureFreshJwt(): Promise<{ jwt: string; userId: string }> {
    const jwt = await config.getJwt();
    const userId = extractUserIdFromJwt(jwt);
    currentJwt = jwt;
    currentUserId = userId;
    return { jwt, userId };
  }

  // Get user ID synchronously if we have a cached JWT, otherwise throw
  function getUserId(): string {
    if (!currentUserId) {
      throw new Error('JWT not initialized - call ensureFreshJwt first');
    }
    return currentUserId;
  }

  const sessions = new Map<string, SessionConnection>();
  const sessionIndexCache = new Map<string, CachedSessionIndex>();
  let indexWs: WebSocket | null = null;
  let indexConnected = false;
  let deviceAnnounceInterval: ReturnType<typeof setInterval> | null = null;

  // Listeners for index changes (session updates broadcast to all connected clients)
  const indexChangeListeners = new Set<(sessionId: string, entry: SessionIndexEntry) => void>();

  // Listeners for session creation requests (from mobile)
  const createSessionRequestListeners = new Set<(request: CreateSessionRequest) => void>();

  // Listeners for session creation responses (for mobile to receive response from desktop)
  const createSessionResponseListeners = new Set<(response: CreateSessionResponse) => void>();

  // Queue for operations that need to wait for index connection
  type PendingOperation = { type: 'sessions'; data: SessionIndexData[]; options?: { syncMessages?: boolean } } | { type: 'projects'; data: ProjectIndexEntry[] };
  const pendingOperations: PendingOperation[] = [];

  // Queue for partial metadata updates waiting for the session to be cached
  // Key: sessionId, Value: partial metadata to merge when session is cached
  const pendingMetadataUpdates = new Map<string, Partial<SyncedSessionMetadata>>();

  /**
   * Apply any pending metadata updates for a session that was just cached.
   * This handles the case where isExecuting is pushed before the session is in the cache.
   */
  async function applyPendingMetadataUpdates(sessionId: string): Promise<void> {
    const pending = pendingMetadataUpdates.get(sessionId);
    if (!pending) return;

    pendingMetadataUpdates.delete(sessionId);

    const cached = sessionIndexCache.get(sessionId);
    if (!cached || !indexWs || !indexConnected) return;

    // console.log('[CollabV3] Applying pending metadata update for session:', sessionId, pending);

    // Merge pending update with cached entry
    const updatedCache: CachedSessionIndex = {
      session_id: sessionId,
      project_id: cached.project_id,
      title: cached.title,
      provider: cached.provider,
      model: cached.model,
      mode: cached.mode,
      message_count: cached.message_count,
      last_message_at: cached.last_message_at,
      created_at: cached.created_at,
      updated_at: Date.now(),
      pendingExecution: 'pendingExecution' in pending ? pending.pendingExecution : cached.pendingExecution,
      isExecuting: 'isExecuting' in pending ? pending.isExecuting : cached.isExecuting,
    };

    // Update cache with decrypted values
    sessionIndexCache.set(sessionId, updatedCache);

    // Build wire entry - DO NOT include plaintext title
    const indexEntry: SessionIndexEntry = {
      session_id: updatedCache.session_id,
      project_id: updatedCache.project_id,
      provider: updatedCache.provider,
      model: updatedCache.model,
      mode: updatedCache.mode,
      message_count: updatedCache.message_count,
      last_message_at: updatedCache.last_message_at,
      created_at: updatedCache.created_at,
      updated_at: updatedCache.updated_at,
      pendingExecution: updatedCache.pendingExecution,
      isExecuting: updatedCache.isExecuting,
    };

    // For wire transmission, encrypt the title - encryption is required
    if (updatedCache.title) {
      if (!config.encryptionKey) {
        console.error('[CollabV3] Cannot send session title: no encryption key');
      } else {
        const { encrypted_title, title_iv } = await encryptTitle(updatedCache.title, config.encryptionKey);
        indexEntry.encrypted_title = encrypted_title;
        indexEntry.title_iv = title_iv;
      }
    }

    // Send to server
    const indexMsg: ClientMessage = { type: 'index_update', session: indexEntry };
    // console.log('[CollabV3] Sending deferred index_update for session:', sessionId, 'isExecuting:', indexEntry.isExecuting);
    indexWs.send(JSON.stringify(indexMsg));
  }

  // Pending fetch index request (resolves when index_sync_response is received)
  let pendingIndexFetch: {
    resolve: (result: { sessions: DecryptedSessionIndexEntry[]; projects: Array<{ project_id: string; name: string; session_count: number; last_activity_at: number; sync_enabled: boolean }> }) => void;
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
      // console.log('[CollabV3] Announced device:', config.deviceInfo.name);
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
    return `user:${getUserId()}:session:${sessionId}`;
  }

  function getIndexRoomId(): string {
    return `user:${getUserId()}:index`;
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

    // Use provider-assigned message ID if available (e.g., SDK uuid)
    // This is the most reliable deduplication method as the provider guarantees uniqueness
    // Fall back to hash-based ID for older messages or non-SDK providers
    let syncId: string;
    if (message.providerMessageId) {
      syncId = message.providerMessageId;
    } else {
      // Generate a STABLE sync ID from message content + timestamp
      // This prevents duplicate messages when the same message is synced multiple times
      // We hash: sessionId + timestamp + first 100 chars of content + direction
      const timestamp = message.createdAt instanceof Date
        ? message.createdAt.getTime()
        : typeof message.createdAt === 'number'
          ? message.createdAt
          : Date.now();
      const contentPreview = message.content.substring(0, 100);
      const hashInput = `${message.sessionId}:${timestamp}:${message.direction}:${contentPreview}`;

      // Use SubtleCrypto to generate a stable hash
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(hashInput));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      syncId = hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
    }

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
      metadata: {},
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
          // Note: async function, but we don't await to avoid blocking message processing
          handleMetadataBroadcast(sessionId, message).catch(err => {
            console.error('[CollabV3] Error handling metadata broadcast:', err);
          });
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

    // Cache metadata from sync response (includes queuedPrompts if present)
    if (response.metadata) {
      session.cachedMetadata = { ...session.cachedMetadata, ...response.metadata };
      // console.log('[CollabV3] Cached metadata from sync_response:', sessionId, 'queuedPrompts:', response.metadata.queuedPrompts?.length ?? 0);
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

  async function handleMetadataBroadcast(
    sessionId: string,
    broadcast: Extract<ServerMessage, { type: 'metadata_broadcast' }>
  ): Promise<void> {
    // console.log('[CollabV3] Received metadata_broadcast for session:', sessionId, 'metadata:', JSON.stringify(broadcast.metadata));

    const session = sessions.get(sessionId);
    if (!session) {
      // console.log('[CollabV3] No session found for metadata_broadcast, sessionId:', sessionId);
      return;
    }

    // Cache the metadata broadcast (merge with existing cache)
    session.cachedMetadata = { ...session.cachedMetadata, ...broadcast.metadata };

    const metadata: Partial<SyncedSessionMetadata> = {
      mode: broadcast.metadata.mode,
      provider: broadcast.metadata.provider,
      model: broadcast.metadata.model,
      updatedAt: broadcast.metadata.updated_at ?? Date.now(),
      pendingExecution: broadcast.metadata.pendingExecution,
      isExecuting: broadcast.metadata.isExecuting,
    };

    // Decrypt title - encrypted titles are required
    if (broadcast.metadata.encrypted_title && broadcast.metadata.title_iv && session.encryptionKey) {
      try {
        metadata.title = await decryptTitle(broadcast.metadata.encrypted_title, broadcast.metadata.title_iv, session.encryptionKey);
      } catch (err) {
        console.error('[CollabV3] Failed to decrypt title:', err);
        metadata.title = 'Untitled';
      }
    } else if (broadcast.metadata.encrypted_title) {
      // Encrypted title present but no key - show as untitled
      metadata.title = 'Untitled';
    }
    // If no encrypted_title field at all, don't update the title

    // Decrypt queued prompts - encrypted prompts are required
    if (broadcast.metadata.encryptedQueuedPrompts && broadcast.metadata.encryptedQueuedPrompts.length > 0 && session.encryptionKey) {
      try {
        metadata.queuedPrompts = await decryptQueuedPrompts(broadcast.metadata.encryptedQueuedPrompts, session.encryptionKey);
      } catch (err) {
        console.error('[CollabV3] Failed to decrypt queued prompts:', err);
        // Can't decrypt - don't update queued prompts
      }
    }
    // If no encryptedQueuedPrompts field, don't update queued prompts

    // console.log('[CollabV3] Notifying', session.changeListeners.size, 'change listeners with queuedPrompts:', metadata.queuedPrompts?.length ?? 0);

    session.changeListeners.forEach((cb) =>
      cb({ type: 'metadata_updated', metadata })
    );
  }

  // Process pending operations that were queued before connection was established
  function processPendingOperations(): void {
    if (!indexWs || !indexConnected) return;

    // console.log('[CollabV3] Processing', pendingOperations.length, 'pending operations');

    // Process in order they were queued
    while (pendingOperations.length > 0) {
      const op = pendingOperations.shift()!;
      if (op.type === 'sessions') {
        // Call the sync function directly (now that we're connected)
        // Note: async but we don't await to avoid blocking
        doSyncSessionsToIndex(op.data, op.options).catch(err => {
          console.error('[CollabV3] Error in doSyncSessionsToIndex:', err);
        });
      }
      // Projects are auto-calculated from sessions in CollabV3, so nothing to do
    }
  }

  // Connect to index for session list updates
  async function connectToIndex(): Promise<void> {
    if (indexWs) {
      // console.log('[CollabV3] connectToIndex() - already connected');
      return;
    }

    // console.log('[CollabV3] connectToIndex() - CREATING INDEX WebSocket');

    // Get fresh JWT before connecting
    const { jwt } = await ensureFreshJwt();

    const url = getWebSocketUrl(getIndexRoomId());
    // Pass JWT via query parameter (WebSocket doesn't support custom headers in browsers)
    const wsUrl = `${url}?token=${encodeURIComponent(jwt)}`;

    indexWs = new WebSocket(wsUrl);

    indexWs.onopen = () => {
      indexConnected = true;
      // console.log('[CollabV3] Connected to index');

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
      // console.log('[CollabV3] Disconnected from index');
    };

    indexWs.onerror = (event) => {
      // Note: ErrorEvent only exists in browser environments, not Node.js
      const errorInfo = typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent
        ? { message: event.message, error: event.error }
        : { type: event.type };
      console.error('[CollabV3] Index WebSocket error:', errorInfo, 'URL:', wsUrl);
    };

    indexWs.onmessage = async (event) => {
      try {
        const message: ServerMessage = JSON.parse(
          typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
        );

        switch (message.type) {
          case 'index_sync_response': {
            // console.log('[CollabV3] Received index_sync_response:', message.sessions.length, 'sessions');
            if (pendingIndexFetch) {
              // Decrypt titles and queued prompts before returning
              const decryptedSessions: DecryptedSessionIndexEntry[] = await Promise.all(
                message.sessions.map(async (entry): Promise<DecryptedSessionIndexEntry> => {
                  // Start with base fields that don't need transformation
                  let title: string;
                  let queuedPrompts: Array<{ id: string; prompt: string; timestamp: number }> | undefined;

                  // Decrypt title - encrypted titles are required
                  if (entry.encrypted_title && entry.title_iv && config.encryptionKey) {
                    try {
                      title = await decryptTitle(entry.encrypted_title, entry.title_iv, config.encryptionKey);
                    } catch (err) {
                      console.error('[CollabV3] Failed to decrypt session title:', err);
                      title = 'Untitled';
                    }
                  } else {
                    // No encrypted title - show as untitled until resynced
                    title = 'Untitled';
                  }

                  // Decrypt queued prompts - encrypted prompts are required
                  if (entry.encryptedQueuedPrompts && entry.encryptedQueuedPrompts.length > 0 && config.encryptionKey) {
                    try {
                      queuedPrompts = await decryptQueuedPrompts(entry.encryptedQueuedPrompts, config.encryptionKey);
                    } catch (err) {
                      console.error('[CollabV3] Failed to decrypt queued prompts:', err);
                    }
                  }

                  const decrypted: DecryptedSessionIndexEntry = {
                    session_id: entry.session_id,
                    project_id: entry.project_id,
                    title,
                    provider: entry.provider,
                    model: entry.model,
                    mode: entry.mode,
                    message_count: entry.message_count,
                    last_message_at: entry.last_message_at,
                    created_at: entry.created_at,
                    updated_at: entry.updated_at,
                    pendingExecution: entry.pendingExecution,
                    isExecuting: entry.isExecuting,
                    queuedPromptCount: entry.queuedPromptCount,
                    queuedPrompts,
                    hasPendingPrompt: entry.hasPendingPrompt,
                  };

                  // Cache the decrypted entry
                  const cacheEntry: CachedSessionIndex = {
                    session_id: decrypted.session_id,
                    project_id: decrypted.project_id,
                    title: decrypted.title,
                    provider: decrypted.provider,
                    model: decrypted.model,
                    mode: decrypted.mode,
                    message_count: decrypted.message_count,
                    last_message_at: decrypted.last_message_at,
                    created_at: decrypted.created_at,
                    updated_at: decrypted.updated_at,
                    pendingExecution: decrypted.pendingExecution,
                    isExecuting: decrypted.isExecuting,
                    queuedPrompts: decrypted.queuedPrompts,
                  };
                  sessionIndexCache.set(entry.session_id, cacheEntry);

                  return decrypted;
                })
              );

              pendingIndexFetch.resolve({
                sessions: decryptedSessions,
                projects: message.projects,
              });
              pendingIndexFetch = null;
            }
            break;
          }

          case 'index_broadcast': {
            // Another device updated a session - decrypt sensitive fields first
            const entry = message.session;
            const decryptedEntry: CachedSessionIndex = {
              session_id: entry.session_id,
              project_id: entry.project_id,
              title: 'Untitled', // Will be overwritten if encrypted title present
              provider: entry.provider,
              model: entry.model,
              mode: entry.mode,
              message_count: entry.message_count,
              last_message_at: entry.last_message_at,
              created_at: entry.created_at,
              updated_at: entry.updated_at,
              pendingExecution: entry.pendingExecution,
              isExecuting: entry.isExecuting,
              hasPendingPrompt: entry.hasPendingPrompt,
            };

            // Decrypt title - encrypted titles are required
            if (entry.encrypted_title && entry.title_iv && config.encryptionKey) {
              try {
                decryptedEntry.title = await decryptTitle(entry.encrypted_title, entry.title_iv, config.encryptionKey);
              } catch (err) {
                console.error('[CollabV3] Failed to decrypt index entry title:', err);
                decryptedEntry.title = 'Untitled';
              }
            }
            // If no encrypted title, keep as 'Untitled'

            // Decrypt queued prompts - encrypted prompts are required
            if (entry.encryptedQueuedPrompts && entry.encryptedQueuedPrompts.length > 0 && config.encryptionKey) {
              try {
                decryptedEntry.queuedPrompts = await decryptQueuedPrompts(entry.encryptedQueuedPrompts, config.encryptionKey);
              } catch (err) {
                console.error('[CollabV3] Failed to decrypt index entry queued prompts:', err);
              }
            }
            // If no encrypted prompts, queuedPrompts stays undefined

            // Cache the decrypted entry
            sessionIndexCache.set(entry.session_id, decryptedEntry);
            // console.log('[CollabV3] Received index_broadcast for session:', entry.session_id,
            //   'queuedPrompts:', decryptedEntry.queuedPrompts?.length ?? 0,
            //   'pendingExecution:', decryptedEntry.pendingExecution,
            //   'isExecuting:', decryptedEntry.isExecuting);

            // Apply any pending metadata updates that were waiting for this session
            applyPendingMetadataUpdates(entry.session_id).catch(err => {
              console.error('[CollabV3] Error applying pending metadata updates:', err);
            });

            // Notify all index change listeners with decrypted data
            indexChangeListeners.forEach((callback) => {
              try {
                callback(entry.session_id, {
                  ...decryptedEntry,
                  session_id: decryptedEntry.session_id,
                });
              } catch (err) {
                console.error('[CollabV3] Error in index change listener:', err);
              }
            });
            break;
          }

          case 'project_broadcast':
            // New project created by another device - log for now
            // Desktop clients currently don't need to update local state since projects are
            // derived from local workspace folders, not server state
            console.log('[CollabV3] New project received from another device:', message.project.name);
            break;

          case 'devices_list':
            // console.log('[CollabV3] Received devices list:', message.devices.length, 'devices');
            break;

          case 'device_joined':
            // console.log('[CollabV3] Device joined:', message.device.name);
            break;

          case 'device_left':
            // console.log('[CollabV3] Device left:', message.device_id);
            break;

          case 'create_session_request_broadcast': {
            // Another device (mobile) requested session creation
            // Decrypt the initial prompt if present
            let initialPrompt: string | undefined;
            if (message.request.encrypted_initial_prompt && message.request.initial_prompt_iv && config.encryptionKey) {
              try {
                initialPrompt = await decrypt(message.request.encrypted_initial_prompt, message.request.initial_prompt_iv, config.encryptionKey);
              } catch (err) {
                console.error('[CollabV3] Failed to decrypt initial prompt:', err);
              }
            }

            const decryptedRequest: CreateSessionRequest = {
              requestId: message.request.request_id,
              projectId: message.request.project_id,
              initialPrompt,
              timestamp: message.request.timestamp,
            };

            // Debug logging - uncomment if needed
            // console.log('[CollabV3] Received create_session_request from mobile:', decryptedRequest.requestId);

            // Notify all listeners (desktop will handle this)
            createSessionRequestListeners.forEach((callback) => {
              try {
                callback(decryptedRequest);
              } catch (err) {
                console.error('[CollabV3] Error in create session request listener:', err);
              }
            });
            break;
          }

          case 'create_session_response_broadcast': {
            // Desktop responded to our session creation request
            const response: CreateSessionResponse = {
              requestId: message.response.request_id,
              success: message.response.success,
              sessionId: message.response.session_id,
              error: message.response.error,
            };

            // Debug logging - uncomment if needed
            // console.log('[CollabV3] Received create_session_response:', response.requestId, 'success:', response.success);

            // Notify all listeners (mobile will handle this)
            createSessionResponseListeners.forEach((callback) => {
              try {
                callback(response);
              } catch (err) {
                console.error('[CollabV3] Error in create session response listener:', err);
              }
            });
            break;
          }

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
  // console.log('[CollabV3] Initializing with config:', {
  //   serverUrl: config.serverUrl,
  //   userId: config.userId,
  //   hasEncryptionKey: !!config.encryptionKey,
  // });

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

    // console.log('[CollabV3] syncSessionMessages() - CREATING TEMP WebSocket for session', sessionId, 'with', messages.length, 'messages');

    // Get fresh JWT before connecting
    const { jwt } = await ensureFreshJwt();

    // Connect to session room
    const roomId = getRoomId(sessionId);
    const url = getWebSocketUrl(roomId);
    // Pass JWT via query parameter (WebSocket doesn't support custom headers in browsers)
    const wsUrl = `${url}?token=${encodeURIComponent(jwt)}`;

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

    // console.log('[CollabV3] Batch syncing', sessionsWithMessages.length, 'sessions in batches of', batchSize);

    for (let i = 0; i < sessionsWithMessages.length; i += batchSize) {
      const batch = sessionsWithMessages.slice(i, i + batchSize);

      // console.log(`[CollabV3] Syncing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sessionsWithMessages.length / batchSize)} (${batch.length} sessions)`);

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

    // console.log('[CollabV3] Batch sync complete');
  }

  // Helper function to actually sync sessions to index (requires connection)
  async function doSyncSessionsToIndex(sessionsData: SessionIndexData[], options?: { syncMessages?: boolean }): Promise<void> {
    if (!indexWs || !indexConnected) {
      console.error('[CollabV3] doSyncSessionsToIndex called but not connected!');
      return;
    }

    // console.log('[CollabV3] Syncing', sessionsData.length, 'sessions to index');

    // Build all entries, encrypting titles if we have an encryption key
    const entries: SessionIndexEntry[] = await Promise.all(sessionsData.map(async session => {
      const entry: SessionIndexEntry = {
        session_id: session.id,
        project_id: session.workspaceId ?? 'default',
        provider: session.provider,
        model: session.model,
        mode: session.mode as SessionIndexEntry['mode'],
        message_count: session.messageCount,
        last_message_at: session.updatedAt,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      };

      // Encrypt title - encryption is required
      if (session.title) {
        if (!config.encryptionKey) {
          console.error('[CollabV3] Cannot send session title: no encryption key');
        } else {
          const { encrypted_title, title_iv } = await encryptTitle(session.title, config.encryptionKey);
          entry.encrypted_title = encrypted_title;
          entry.title_iv = title_iv;
        }
      }

      // Cache the entry with DECRYPTED title for local use
      const cacheEntry: CachedSessionIndex = {
        session_id: session.id,
        project_id: session.workspaceId ?? 'default',
        title: session.title, // Store decrypted
        provider: session.provider,
        model: session.model,
        mode: session.mode as CachedSessionIndex['mode'],
        message_count: session.messageCount,
        last_message_at: session.updatedAt,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      };
      sessionIndexCache.set(session.id, cacheEntry);

      // Apply any pending metadata updates (e.g., isExecuting set before cache was populated)
      // Note: This is fire-and-forget since we're already sending the encrypted entry
      applyPendingMetadataUpdates(session.id).catch(err => {
        console.error('[CollabV3] Error applying pending metadata updates:', err);
      });

      return entry;
    }));

    // Use batch API if we have multiple sessions, otherwise single update
    if (entries.length > 1) {
      const msg: ClientMessage = { type: 'index_batch_update', sessions: entries };
      const msgStr = JSON.stringify(msg);
      console.log('[CollabV3] Sending batch index update:', entries.length, 'sessions, message length:', msgStr.length);
      indexWs.send(msgStr);
    } else if (entries.length === 1) {
      const msg: ClientMessage = { type: 'index_update', session: entries[0] };
      indexWs.send(JSON.stringify(msg));
    }

    // Sync messages if requested
    if (options?.syncMessages === true) {
      // console.log('[CollabV3] Batching message sync for', sessionsData.length, 'sessions');
      doBatchSyncSessionMessages(sessionsData);
    }
  }

  // Hard limit on concurrent session WebSocket connections to prevent performance issues
  const MAX_SESSION_CONNECTIONS = 5;

  // Create provider object
  const provider: SyncProvider = {
    async connect(sessionId: string): Promise<void> {
      if (sessions.has(sessionId)) {
        // console.log(`[CollabV3] connect() - already connected to session ${sessionId}`);
        return; // Already connected
      }

      // Enforce hard limit on concurrent connections
      if (sessions.size >= MAX_SESSION_CONNECTIONS) {
        console.warn(`[CollabV3] connect() - REJECTING connection for ${sessionId}, already at max (${MAX_SESSION_CONNECTIONS} connections)`);
        return; // Silently reject - caller should handle missing connection gracefully
      }

      // Log stack trace to identify what's creating connections
      // const stack = new Error().stack?.split('\n').slice(2, 6).join('\n') || '';
      // console.log(`[CollabV3] connect() - CREATING NEW WebSocket for session ${sessionId} (${sessions.size + 1}/${MAX_SESSION_CONNECTIONS})\n${stack}`);

      // Get fresh JWT before connecting
      const { jwt } = await ensureFreshJwt();

      const roomId = getRoomId(sessionId);
      const url = getWebSocketUrl(roomId);
      // Pass JWT via query parameter (WebSocket doesn't support custom headers in browsers)
      const wsUrl = `${url}?token=${encodeURIComponent(jwt)}`;

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
          // Note: ErrorEvent only exists in browser environments, not Node.js
          const errorInfo = typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent
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
            // console.log('[CollabV3] Encrypted message:', {
            //   id: encrypted.id,
            //   contentLength: encrypted.encrypted_content.length,
            //   ivLength: encrypted.iv.length,
            //   source: encrypted.source,
            //   direction: encrypted.direction,
            // });
            clientMessage = { type: 'append_message', message: encrypted };
          } catch (err) {
            console.error('[CollabV3] Failed to encrypt message:', err);
            return;
          }
          break;
        }

        case 'metadata_updated': {
          const metadata: Partial<SessionMetadata> = {};

          // Encrypt title - encryption is required
          if (change.metadata.title) {
            if (!session.encryptionKey) {
              console.error('[CollabV3] Cannot send session title: no encryption key');
            } else {
              const { encrypted_title, title_iv } = await encryptTitle(change.metadata.title, session.encryptionKey);
              metadata.encrypted_title = encrypted_title;
              metadata.title_iv = title_iv;
            }
          }

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
          // Encrypt queued prompts - encryption is required
          if ('queuedPrompts' in change.metadata) {
            if (change.metadata.queuedPrompts && change.metadata.queuedPrompts.length > 0) {
              if (!session.encryptionKey) {
                console.error('[CollabV3] Cannot send queued prompts: no encryption key');
              } else {
                metadata.encryptedQueuedPrompts = await encryptQueuedPrompts(change.metadata.queuedPrompts, session.encryptionKey);
              }
            } else {
              // Explicitly cleared (undefined, null, or empty array)
              metadata.encryptedQueuedPrompts = undefined;
            }
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
        // console.log('[CollabV3] Sending message, length:', json.length);
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
          // console.log('[CollabV3] Sending index_delete for session:', sessionId);
          indexWs.send(JSON.stringify(indexDeleteMsg));
        } else if (change.type === 'metadata_updated') {
          const meta = change.metadata;
          const cached = sessionIndexCache.get(sessionId);
          const updatedAt = meta.updatedAt ?? Date.now();

          // Helper to build and send encrypted index entry
          const sendIndexUpdate = async (baseEntry: CachedSessionIndex) => {
            // Start with the cache entry (stores decrypted values)
            const indexEntry: SessionIndexEntry = {
              session_id: baseEntry.session_id,
              project_id: baseEntry.project_id,
              provider: baseEntry.provider,
              model: baseEntry.model,
              mode: baseEntry.mode,
              message_count: baseEntry.message_count,
              last_message_at: baseEntry.last_message_at,
              created_at: baseEntry.created_at,
              updated_at: baseEntry.updated_at,
              pendingExecution: baseEntry.pendingExecution,
              isExecuting: baseEntry.isExecuting,
            };

            // Encrypt title for wire - encryption is required
            if (baseEntry.title) {
              if (!session.encryptionKey) {
                console.error('[CollabV3] Cannot send session title: no encryption key');
              } else {
                const { encrypted_title, title_iv } = await encryptTitle(baseEntry.title, session.encryptionKey);
                indexEntry.encrypted_title = encrypted_title;
                indexEntry.title_iv = title_iv;
              }
            }

            // Update local cache with decrypted values
            sessionIndexCache.set(sessionId, baseEntry);

            const indexMsg: ClientMessage = { type: 'index_update', session: indexEntry };
            indexWs!.send(JSON.stringify(indexMsg));
          };

          // Build index entry by merging with cached data
          // This allows partial updates (e.g., just title) to work
          if (cached) {
            // Merge partial update with cached entry (cache stores decrypted values)
            const updatedCache: CachedSessionIndex = {
              ...cached,
              project_id: meta.workspaceId ?? cached.project_id,
              title: meta.title ?? cached.title,
              provider: meta.provider ?? cached.provider,
              model: meta.model ?? cached.model,
              mode: (meta.mode ?? cached.mode) as CachedSessionIndex['mode'],
              last_message_at: updatedAt,
              updated_at: updatedAt,
              pendingExecution: 'pendingExecution' in meta ? meta.pendingExecution : cached.pendingExecution,
              isExecuting: 'isExecuting' in meta ? meta.isExecuting : cached.isExecuting,
            };
            await sendIndexUpdate(updatedCache);
          } else if (meta.title && meta.provider) {
            // New session - need at least title and provider
            const newEntry: CachedSessionIndex = {
              session_id: sessionId,
              project_id: meta.workspaceId ?? 'default',
              title: meta.title,
              provider: meta.provider,
              model: meta.model,
              mode: meta.mode as CachedSessionIndex['mode'],
              message_count: 0,
              last_message_at: updatedAt,
              created_at: updatedAt,
              updated_at: updatedAt,
              pendingExecution: meta.pendingExecution,
              isExecuting: meta.isExecuting,
            };
            await sendIndexUpdate(newEntry);
          } else {
            // No cached data and missing required fields for a full update.
            // Queue the partial update to be applied when the session is cached.
            // This handles cases like isExecuting being set before syncSessionsToIndex runs.
            const hasPartialUpdate = 'isExecuting' in meta || 'pendingExecution' in meta;
            if (hasPartialUpdate) {
              // console.log('[CollabV3] Queueing partial metadata update for session:', sessionId, { isExecuting: meta.isExecuting, pendingExecution: meta.pendingExecution });
              const existing = pendingMetadataUpdates.get(sessionId) || {};
              if ('isExecuting' in meta) existing.isExecuting = meta.isExecuting;
              if ('pendingExecution' in meta) existing.pendingExecution = meta.pendingExecution;
              pendingMetadataUpdates.set(sessionId, existing);
            } else {
              // console.log('[CollabV3] Skipping index update - no cached data and missing required fields for session:', sessionId);
            }
          }
        }
      }
    },

    syncSessionsToIndex(sessionsData: SessionIndexData[], options?: { syncMessages?: boolean }): void {
      if (!indexWs || !indexConnected) {
        // Queue the operation to run when connection is established
        // console.log('[CollabV3] Index not connected yet, queueing sync of', sessionsData.length, 'sessions');
        pendingOperations.push({ type: 'sessions', data: sessionsData, options });
        return;
      }

      // Call the helper function
      // Note: async but this method returns void for backwards compatibility
      doSyncSessionsToIndex(sessionsData, options).catch(err => {
        console.error('[CollabV3] Error in doSyncSessionsToIndex:', err);
      });
    },

    syncProjectsToIndex(projects: ProjectIndexEntry[]): void {
      // Projects are derived from sessions in CollabV3
      // The index room calculates project stats from session data
      // console.log('[CollabV3] Projects are auto-calculated from sessions');
    },

    async fetchIndex(): Promise<{ sessions: DecryptedSessionIndexEntry[]; projects: Array<{ project_id: string; name: string; session_count: number; last_activity_at: number; sync_enabled: boolean }> }> {
      // Wait for connection if not ready
      if (!indexWs || !indexConnected) {
        // console.log('[CollabV3] Waiting for index connection before fetching...');
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
        // console.log('[CollabV3] Sent index_sync_request');
      });
    },

    onIndexChange(callback: (sessionId: string, entry: SessionIndexEntry) => void): () => void {
      indexChangeListeners.add(callback);
      // console.log('[CollabV3] Added index change listener, total:', indexChangeListeners.size);
      return () => {
        indexChangeListeners.delete(callback);
        // console.log('[CollabV3] Removed index change listener, total:', indexChangeListeners.size);
      };
    },

    /** Get cached metadata for a session (from sync_response and metadata_broadcast) */
    getCachedMetadata(sessionId: string): Partial<SessionMetadata> | undefined {
      const session = sessions.get(sessionId);
      return session?.cachedMetadata;
    },

    /** Get cached index entry for a session (from index_sync_response and index_broadcast) */
    getCachedIndexEntry(sessionId: string): CachedSessionIndex | undefined {
      return sessionIndexCache.get(sessionId);
    },

    /** Subscribe to session creation requests from other devices (e.g., mobile) */
    onCreateSessionRequest(callback: (request: CreateSessionRequest) => void): () => void {
      createSessionRequestListeners.add(callback);
      return () => {
        createSessionRequestListeners.delete(callback);
      };
    },

    /** Send a response to a session creation request */
    sendCreateSessionResponse(response: CreateSessionResponse): void {
      if (!indexWs || !indexConnected) {
        console.error('[CollabV3] Cannot send create session response - not connected');
        return;
      }

      const wireResponse: EncryptedCreateSessionResponse = {
        request_id: response.requestId,
        success: response.success,
        session_id: response.sessionId,
        error: response.error,
      };

      const msg: ClientMessage = { type: 'create_session_response', response: wireResponse };
      // Debug logging - uncomment if needed
      // console.log('[CollabV3] Sending create_session_response:', response.requestId, 'success:', response.success);
      indexWs.send(JSON.stringify(msg));
    },

    /** Send a session creation request (for mobile to request desktop to create a session) */
    async sendCreateSessionRequest(request: CreateSessionRequest): Promise<void> {
      if (!indexWs || !indexConnected) {
        console.error('[CollabV3] Cannot send create session request - not connected');
        return;
      }

      const wireRequest: EncryptedCreateSessionRequest = {
        request_id: request.requestId,
        project_id: request.projectId,
        timestamp: request.timestamp,
      };

      // Encrypt initial prompt if present
      if (request.initialPrompt && config.encryptionKey) {
        try {
          const { encrypted, iv } = await encrypt(request.initialPrompt, config.encryptionKey);
          wireRequest.encrypted_initial_prompt = encrypted;
          wireRequest.initial_prompt_iv = iv;
        } catch (err) {
          console.error('[CollabV3] Failed to encrypt initial prompt:', err);
        }
      }

      const msg: ClientMessage = { type: 'create_session_request', request: wireRequest };
      // Debug logging - uncomment if needed
      // console.log('[CollabV3] Sending create_session_request:', request.requestId, 'project:', request.projectId);
      indexWs.send(JSON.stringify(msg));
    },

    /** Subscribe to session creation responses (for mobile to receive response from desktop) */
    onCreateSessionResponse(callback: (response: CreateSessionResponse) => void): () => void {
      createSessionResponseListeners.add(callback);
      return () => {
        createSessionResponseListeners.delete(callback);
      };
    },
  };

  return provider;
}
