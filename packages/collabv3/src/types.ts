/**
 * CollabV3 Type Definitions
 *
 * Sync protocol types for multi-device AI session sync.
 */

// ============================================================================
// Room ID Types
// ============================================================================

/**
 * Room ID format: user:{userId}:session:{sessionId}
 * Future: org:{orgId}:user:{userId}:session:{sessionId}
 */
export type SessionRoomId = `user:${string}:session:${string}`;
export type IndexRoomId = `user:${string}:index`;
export type ProjectsRoomId = `user:${string}:projects`;

export type RoomId = SessionRoomId | IndexRoomId | ProjectsRoomId;

// ============================================================================
// Client → Server Messages
// ============================================================================

export type ClientMessage =
  | SyncRequestMessage
  | AppendMessageMessage
  | UpdateMetadataMessage
  | DeleteSessionMessage
  | IndexSyncRequestMessage
  | IndexUpdateMessage
  | IndexBatchUpdateMessage
  | IndexDeleteMessage
  | DeviceAnnounceMessage;

/** Request messages since a cursor */
export interface SyncRequestMessage {
  type: 'sync_request';
  since_id?: string;
  since_seq?: number;
}

/** Append a new message to the session */
export interface AppendMessageMessage {
  type: 'append_message';
  message: EncryptedMessage;
}

/** Update session metadata */
export interface UpdateMetadataMessage {
  type: 'update_metadata';
  metadata: Partial<SessionMetadata>;
}

/** Delete a session */
export interface DeleteSessionMessage {
  type: 'delete_session';
}

/** Request full index sync */
export interface IndexSyncRequestMessage {
  type: 'index_sync_request';
  project_id?: string; // Filter by project
}

/** Update session in index (from desktop after local change) */
export interface IndexUpdateMessage {
  type: 'index_update';
  session: SessionIndexEntry;
}

/** Batch update sessions in index (for efficient bulk sync) */
export interface IndexBatchUpdateMessage {
  type: 'index_batch_update';
  sessions: SessionIndexEntry[];
}

/** Delete session from index */
export interface IndexDeleteMessage {
  type: 'index_delete';
  session_id: string;
}

/** Announce device presence and info */
export interface DeviceAnnounceMessage {
  type: 'device_announce';
  device: DeviceInfo;
}

// ============================================================================
// Server → Client Messages
// ============================================================================

export type ServerMessage =
  | SyncResponseMessage
  | MessageBroadcastMessage
  | MetadataBroadcastMessage
  | IndexSyncResponseMessage
  | IndexBroadcastMessage
  | IndexDeleteBroadcastMessage
  | DevicesListMessage
  | DeviceJoinedMessage
  | DeviceLeftMessage
  | ErrorMessage;

/** Response to sync_request */
export interface SyncResponseMessage {
  type: 'sync_response';
  messages: EncryptedMessage[];
  metadata: SessionMetadata | null;
  has_more: boolean;
  cursor: string | null;
}

/** Broadcast new message to other devices */
export interface MessageBroadcastMessage {
  type: 'message_broadcast';
  message: EncryptedMessage;
  from_connection_id?: string;
}

/** Broadcast metadata change to other devices */
export interface MetadataBroadcastMessage {
  type: 'metadata_broadcast';
  metadata: Partial<SessionMetadata>;
  from_connection_id?: string;
}

/** Response to index_sync_request */
export interface IndexSyncResponseMessage {
  type: 'index_sync_response';
  sessions: SessionIndexEntry[];
  projects: ProjectIndexEntry[];
}

/** Broadcast index update to other devices */
export interface IndexBroadcastMessage {
  type: 'index_broadcast';
  session: SessionIndexEntry;
  from_connection_id?: string;
}

/** Broadcast session deletion to other devices */
export interface IndexDeleteBroadcastMessage {
  type: 'index_delete_broadcast';
  session_id: string;
  from_connection_id?: string;
}

/** List of currently connected devices (sent on connect and device changes) */
export interface DevicesListMessage {
  type: 'devices_list';
  devices: DeviceInfo[];
}

/** Broadcast when a device joins */
export interface DeviceJoinedMessage {
  type: 'device_joined';
  device: DeviceInfo;
}

/** Broadcast when a device leaves */
export interface DeviceLeftMessage {
  type: 'device_left';
  device_id: string;
}

/** Error response */
export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

// ============================================================================
// Data Types
// ============================================================================

/**
 * Information about a connected device.
 * Used for device awareness/presence in the IndexRoom.
 */
export interface DeviceInfo {
  /** Unique device ID (stable across sessions, generated per device) */
  device_id: string;
  /** Human-readable device name (e.g., "MacBook Pro", "iPhone 15") */
  name: string;
  /** Device type for icon display */
  type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  /** Platform (e.g., "macos", "ios", "windows", "android", "web") */
  platform: string;
  /** App version */
  app_version?: string;
  /** When this device connected (Unix timestamp ms) */
  connected_at: number;
  /** Last activity timestamp (Unix timestamp ms) */
  last_active_at: number;
}

/**
 * Encrypted message as stored on server.
 * Content is E2E encrypted - server only sees ciphertext.
 */
export interface EncryptedMessage {
  /** ULID for global ordering */
  id: string;
  /** Monotonic sequence within session */
  sequence: number;
  /** Unix timestamp ms */
  created_at: number;
  /** Message source */
  source: 'user' | 'assistant' | 'tool' | 'system';
  /** Direction of message */
  direction: 'input' | 'output';
  /** Base64 encoded encrypted content */
  encrypted_content: string;
  /** Base64 encoded IV for decryption */
  iv: string;
  /** Empty metadata object (all sensitive data is in encrypted_content) */
  metadata: Record<string, never>;
}

/** Session metadata (stored alongside messages in SessionRoom) */
export interface SessionMetadata {
  title: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  project_id: string;
  created_at: number;
  updated_at: number;
}

/** Session entry in the IndexRoom */
export interface SessionIndexEntry {
  session_id: string;
  project_id: string;
  /** Encrypted title (base64) */
  encrypted_title?: string;
  /** IV for title decryption (base64) */
  title_iv?: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  message_count: number;
  last_message_at: number;
  created_at: number;
  updated_at: number;
}

/** Project entry in the IndexRoom */
export interface ProjectIndexEntry {
  project_id: string;
  name: string;
  path?: string;
  session_count: number;
  last_activity_at: number;
  sync_enabled: boolean;
}

// ============================================================================
// Auth Types
// ============================================================================

/** Decoded auth token from WebSocket connection */
export interface AuthContext {
  user_id: string;
  /** Optional org_id for future multi-tenant support */
  org_id?: string;
}

// ============================================================================
// Env Bindings
// ============================================================================

export interface Env {
  SESSION_ROOM: DurableObjectNamespace;
  INDEX_ROOM: DurableObjectNamespace;
  DB: D1Database;
  ENVIRONMENT: string;
  // Stytch auth
  STYTCH_PROJECT_ID?: string;
  STYTCH_PUBLIC_TOKEN?: string;
  STYTCH_SECRET_KEY?: string;
  // CORS configuration
  // Comma-separated list of allowed origins (e.g., "https://app.nimbalyst.com,capacitor://localhost")
  // If not set in production, defaults to secure origins
  ALLOWED_ORIGINS?: string;
}
