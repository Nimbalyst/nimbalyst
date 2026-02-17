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
  | DeviceAnnounceMessage
  | CreateSessionRequestMessage
  | CreateSessionResponseMessage
  | SessionControlCommandMessage
  | RegisterPushTokenMessage
  | RequestMobilePushMessage
  | SettingsSyncMessage
  | PingMessage;

/** Keep-alive ping message */
export interface PingMessage {
  type: 'ping';
}

/** Request messages since a cursor */
export interface SyncRequestMessage {
  type: 'syncRequest';
  sinceId?: string;
  sinceSeq?: number;
}

/** Append a new message to the session */
export interface AppendMessageMessage {
  type: 'appendMessage';
  message: EncryptedMessage;
}

/** Update session metadata */
export interface UpdateMetadataMessage {
  type: 'updateMetadata';
  metadata: Partial<SessionMetadata>;
}

/** Delete a session */
export interface DeleteSessionMessage {
  type: 'deleteSession';
}

/** Request full index sync */
export interface IndexSyncRequestMessage {
  type: 'indexSyncRequest';
  projectId?: string;
}

/** Update session in index (from desktop after local change) */
export interface IndexUpdateMessage {
  type: 'indexUpdate';
  session: SessionIndexEntry;
}

/** Batch update sessions in index (for efficient bulk sync) */
export interface IndexBatchUpdateMessage {
  type: 'indexBatchUpdate';
  sessions: SessionIndexEntry[];
}

/** Delete session from index */
export interface IndexDeleteMessage {
  type: 'indexDelete';
  sessionId: string;
}

/** Announce device presence and info */
export interface DeviceAnnounceMessage {
  type: 'deviceAnnounce';
  device: DeviceInfo;
}

/** Request session creation from mobile to desktop */
export interface CreateSessionRequestMessage {
  type: 'createSessionRequest';
  request: EncryptedCreateSessionRequest;
}

/** Response to session creation request from desktop */
export interface CreateSessionResponseMessage {
  type: 'createSessionResponse';
  response: EncryptedCreateSessionResponse;
}

/** Encrypted session creation request (sent over wire) */
export interface EncryptedCreateSessionRequest {
  requestId: string;
  /** Encrypted project ID (base64) - required for wire protocol */
  encryptedProjectId: string;
  /** IV for project_id decryption (base64) */
  projectIdIv: string;
  /** Base64 encoded encrypted initial prompt (optional) */
  encryptedInitialPrompt?: string;
  /** Base64 encoded IV for initial prompt decryption */
  initialPromptIv?: string;
  timestamp: number;
}

/** Encrypted session creation response (sent over wire) */
export interface EncryptedCreateSessionResponse {
  requestId: string;
  success: boolean;
  sessionId?: string;
  error?: string;
}

/** Generic session control command - the sync layer just passes these through */
export interface SessionControlCommandMessage {
  type: 'sessionControl';
  message: SessionControlMessage;
}

/** Generic session control message payload */
export interface SessionControlMessage {
  sessionId: string;
  /** Message type - receiver decides how to handle */
  messageType: string;
  /** Arbitrary payload - receiver interprets based on messageType */
  payload?: Record<string, unknown>;
  timestamp: number;
  sentBy: 'desktop' | 'mobile';
}

/** Register a push notification token for this device */
export interface RegisterPushTokenMessage {
  type: 'registerPushToken';
  token: string;
  platform: 'ios' | 'android';
  deviceId: string;
}

/** Request to send a push notification to mobile devices */
export interface RequestMobilePushMessage {
  type: 'requestMobilePush';
  sessionId: string;
  title: string;
  body: string;
  /** Device ID of the requesting device, used for active-device routing */
  requestingDeviceId?: string;
}

/** Sync encrypted settings to other devices */
export interface SettingsSyncMessage {
  type: 'settingsSync';
  settings: EncryptedSettingsPayload;
}

/** Encrypted settings payload for wire transmission */
export interface EncryptedSettingsPayload {
  /** Encrypted JSON blob containing settings (base64) */
  encryptedSettings: string;
  /** IV for settings decryption (base64) */
  settingsIv: string;
  /** Device ID of sender */
  deviceId: string;
  /** Timestamp of settings sync */
  timestamp: number;
  /** Version for handling upgrades */
  version: number;
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
  | ProjectBroadcastMessage
  | DevicesListMessage
  | DeviceJoinedMessage
  | DeviceLeftMessage
  | CreateSessionRequestBroadcastMessage
  | CreateSessionResponseBroadcastMessage
  | SessionControlBroadcastMessage
  | SettingsSyncBroadcastMessage
  | ErrorMessage;

/** Response to syncRequest */
export interface SyncResponseMessage {
  type: 'syncResponse';
  messages: EncryptedMessage[];
  metadata: SessionMetadata | null;
  hasMore: boolean;
  cursor: string | null;
}

/** Broadcast new message to other devices */
export interface MessageBroadcastMessage {
  type: 'messageBroadcast';
  message: EncryptedMessage;
  fromConnectionId?: string;
}

/** Broadcast metadata change to other devices */
export interface MetadataBroadcastMessage {
  type: 'metadataBroadcast';
  metadata: Partial<SessionMetadata>;
  fromConnectionId?: string;
}

/** Response to indexSyncRequest */
export interface IndexSyncResponseMessage {
  type: 'indexSyncResponse';
  sessions: SessionIndexEntry[];
  projects: ProjectIndexEntry[];
  /** Total session count from COUNT(*) - used to detect if toArray() truncated results */
  totalSessionCount?: number;
}

/** Broadcast index update to other devices */
export interface IndexBroadcastMessage {
  type: 'indexBroadcast';
  session: SessionIndexEntry;
  fromConnectionId?: string;
}

/** Broadcast session deletion to other devices */
export interface IndexDeleteBroadcastMessage {
  type: 'indexDeleteBroadcast';
  sessionId: string;
  fromConnectionId?: string;
}

/** Broadcast project update (new or updated) to other devices */
export interface ProjectBroadcastMessage {
  type: 'projectBroadcast';
  project: ProjectIndexEntry;
  fromConnectionId?: string;
}

/** List of currently connected devices (sent on connect and device changes) */
export interface DevicesListMessage {
  type: 'devicesList';
  devices: DeviceInfo[];
}

/** Broadcast when a device joins */
export interface DeviceJoinedMessage {
  type: 'deviceJoined';
  device: DeviceInfo;
}

/** Broadcast when a device leaves */
export interface DeviceLeftMessage {
  type: 'deviceLeft';
  deviceId: string;
}

/** Broadcast session creation request to other devices (desktop receives this) */
export interface CreateSessionRequestBroadcastMessage {
  type: 'createSessionRequestBroadcast';
  request: EncryptedCreateSessionRequest;
  fromConnectionId?: string;
}

/** Broadcast session creation response to other devices (mobile receives this) */
export interface CreateSessionResponseBroadcastMessage {
  type: 'createSessionResponseBroadcast';
  response: EncryptedCreateSessionResponse;
  fromConnectionId?: string;
}

/** Broadcast generic session control message to other devices */
export interface SessionControlBroadcastMessage {
  type: 'sessionControlBroadcast';
  message: SessionControlMessage;
  fromConnectionId?: string;
}

/** Broadcast encrypted settings to other devices (mobile receives this) */
export interface SettingsSyncBroadcastMessage {
  type: 'settingsSyncBroadcast';
  settings: EncryptedSettingsPayload;
  fromConnectionId?: string;
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
  deviceId: string;
  /** Human-readable device name (e.g., "MacBook Pro", "iPhone 15") */
  name: string;
  /** Device type for icon display */
  type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  /** Platform (e.g., "macos", "ios", "windows", "android", "web") */
  platform: string;
  /** App version */
  appVersion?: string;
  /** When this device connected (Unix timestamp ms) */
  connectedAt: number;
  /** Last activity timestamp (Unix timestamp ms) - updated on user interaction */
  lastActiveAt: number;
  /** Whether the app window is currently focused (optional for backwards compatibility) */
  isFocused?: boolean;
  /** Derived status for presence display (optional for backwards compatibility) */
  status?: 'active' | 'idle' | 'away';
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
  createdAt: number;
  /** Message source */
  source: 'user' | 'assistant' | 'tool' | 'system';
  /** Direction of message */
  direction: 'input' | 'output';
  /** Base64 encoded encrypted content */
  encryptedContent: string;
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
  /** Encrypted project ID (base64) - required for wire protocol */
  encryptedProjectId: string;
  /** IV for project_id decryption (base64) */
  projectIdIv: string;
  createdAt: number;
  updatedAt: number;
  /** Whether the session is currently executing (processing AI request) */
  isExecuting?: boolean;
}

/** Session entry in the IndexRoom */
export interface SessionIndexEntry {
  sessionId: string;
  /** Encrypted project ID (base64) - required for wire protocol */
  encryptedProjectId: string;
  /** IV for project_id decryption (base64) */
  projectIdIv: string;
  /** Encrypted title (base64) */
  encryptedTitle?: string;
  /** IV for title decryption (base64) */
  titleIv?: string;
  provider: string;
  model?: string;
  mode?: 'agent' | 'planning';
  messageCount: number;
  lastMessageAt: number;
  createdAt: number;
  updatedAt: number;
  /** Whether the session is currently executing (processing AI request) */
  isExecuting?: boolean;
  /** Encrypted client metadata blob (base64) - opaque to server, decrypted by clients */
  encryptedClientMetadata?: string;
  /** IV for client metadata decryption (base64) */
  clientMetadataIv?: string;
  /** Unix timestamp ms when this session was last read by any device */
  lastReadAt?: number;
}

/** Project entry in the IndexRoom */
export interface ProjectIndexEntry {
  /** Encrypted project ID (base64) - required for wire protocol */
  encryptedProjectId: string;
  /** IV for project_id decryption (base64) */
  projectIdIv: string;
  /** Encrypted project name (base64) - required for wire protocol */
  encryptedName: string;
  /** IV for name decryption (base64) */
  nameIv: string;
  /** Encrypted project path (base64) - optional */
  encryptedPath?: string;
  /** IV for path decryption (base64) */
  pathIv?: string;
  sessionCount: number;
  lastActivityAt: number;
  syncEnabled: boolean;
}

// ============================================================================
// Auth Types
// ============================================================================

/** Decoded auth token from WebSocket connection */
export interface AuthContext {
  userId: string;
  /** Optional orgId for future multi-tenant support */
  orgId?: string;
}

// ============================================================================
// Env Bindings
// ============================================================================

export interface Env {
  SESSION_ROOM: DurableObjectNamespace;
  INDEX_ROOM: DurableObjectNamespace;
  DB: D1Database;
  SESSION_SHARES: R2Bucket;
  ENVIRONMENT: string;
  // Stytch auth
  STYTCH_PROJECT_ID?: string;
  STYTCH_PUBLIC_TOKEN?: string;
  STYTCH_SECRET_KEY?: string;
  // CORS configuration
  // Comma-separated list of allowed origins (e.g., "https://app.nimbalyst.com,capacitor://localhost")
  // If not set in production, defaults to secure origins
  ALLOWED_ORIGINS?: string;
  // APNs Push Notifications
  APNS_KEY?: string;        // Base64-encoded .p8 private key
  APNS_KEY_ID?: string;     // Key ID from Apple Developer Portal
  APNS_TEAM_ID?: string;    // Team ID from Apple Developer Portal
  APNS_BUNDLE_ID?: string;  // App bundle ID (e.g., com.nimbalyst.app)
  APNS_SANDBOX?: string;    // 'true' for sandbox, otherwise production
}
