/**
 * CollabV3 Type Definitions
 *
 * Sync protocol types for multi-device AI session sync.
 */

// ============================================================================
// Room ID Types
// ============================================================================

/** Room ID format: org:{orgId}:user:{userId}:{suffix} */
export type SessionRoomId = `org:${string}:user:${string}:session:${string}`;
export type IndexRoomId = `org:${string}:user:${string}:index`;
export type ProjectsRoomId = `org:${string}:user:${string}:projects`;
/** Document room ID format: org:{orgId}:doc:{documentId} (org-scoped, not user-scoped) */
export type DocumentRoomId = `org:${string}:doc:${string}`;
/** Tracker room ID format: org:{orgId}:tracker:{projectId} (org-scoped, not user-scoped) */
export type TrackerRoomId = `org:${string}:tracker:${string}`;
/** Team room ID format: org:{orgId}:team (org-scoped, consolidated team state) */
export type TeamRoomId = `org:${string}:team`;

export type RoomId = SessionRoomId | IndexRoomId | ProjectsRoomId | DocumentRoomId | TrackerRoomId | TeamRoomId;

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
  | CreateWorktreeRequestMessage
  | CreateWorktreeResponseMessage
  | SessionControlCommandMessage
  | RegisterPushTokenMessage
  | RequestMobilePushMessage
  | ProjectConfigUpdateMessage
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
  /** Session type: "session" (default), "workstream" (parent container) */
  sessionType?: string;
  /** Parent session ID for creating child sessions within a workstream */
  parentSessionId?: string;
  /** Provider ID selected by mobile (e.g., "claude-code") */
  provider?: string;
  /** Model ID selected by mobile (e.g., "claude-code:opus") */
  model?: string;
  timestamp: number;
}

/** Encrypted session creation response (sent over wire) */
export interface EncryptedCreateSessionResponse {
  requestId: string;
  success: boolean;
  sessionId?: string;
  error?: string;
}

/** Request worktree creation from mobile to desktop */
export interface CreateWorktreeRequestMessage {
  type: 'createWorktreeRequest';
  request: EncryptedCreateWorktreeRequest;
}

/** Response to worktree creation request from desktop */
export interface CreateWorktreeResponseMessage {
  type: 'createWorktreeResponse';
  response: EncryptedCreateWorktreeResponse;
}

/** Encrypted worktree creation request (sent over wire) */
export interface EncryptedCreateWorktreeRequest {
  requestId: string;
  encryptedProjectId: string;
  projectIdIv: string;
  timestamp: number;
}

/** Encrypted worktree creation response (sent over wire) */
export interface EncryptedCreateWorktreeResponse {
  requestId: string;
  success: boolean;
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

/** Update project config (encrypted blob with commands, etc.) */
export interface ProjectConfigUpdateMessage {
  type: 'projectConfigUpdate';
  /** Encrypted project ID (must match existing project_index entry) */
  encryptedProjectId: string;
  projectIdIv: string;
  /** Encrypted project config blob (base64 AES-GCM) */
  encryptedConfig: string;
  /** IV for config decryption (base64) */
  configIv: string;
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
  | CreateWorktreeRequestBroadcastMessage
  | CreateWorktreeResponseBroadcastMessage
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

/** Broadcast worktree creation request to other devices (desktop receives this) */
export interface CreateWorktreeRequestBroadcastMessage {
  type: 'createWorktreeRequestBroadcast';
  request: EncryptedCreateWorktreeRequest;
  fromConnectionId?: string;
}

/** Broadcast worktree creation response to other devices (mobile receives this) */
export interface CreateWorktreeResponseBroadcastMessage {
  type: 'createWorktreeResponseBroadcast';
  response: EncryptedCreateWorktreeResponse;
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
  /** Whether the device is currently connected (set by server, not by client) */
  isOnline?: boolean;
  /** When this device was last seen online (Unix timestamp ms, set by server on disconnect) */
  lastSeenAt?: number;
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
  /** Parent session ID for workstream/worktree hierarchy (plaintext UUID) */
  parentSessionId?: string;
  /** Structural type: 'session' (normal), 'workstream' (parent container), 'blitz' (quick task) */
  sessionType?: string;
  /** Worktree ID for git worktree association (plaintext UUID) */
  worktreeId?: string;
  /** Whether the session is archived */
  isArchived?: boolean;
  /** Whether the session is pinned */
  isPinned?: boolean;
  /** Session ID this was branched/forked from */
  branchedFromSessionId?: string;
  /** Message ID at the branch point */
  branchPointMessageId?: number;
  /** When this session was branched (unix ms) */
  branchedAt?: number;
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
  /** Encrypted project config blob (base64) - contains commands, settings, etc. */
  encryptedConfig?: string;
  /** IV for config decryption (base64) */
  configIv?: string;
}

// ============================================================================
// DocumentRoom Client → Server Messages
// ============================================================================

export type DocClientMessage =
  | DocSyncRequestMessage
  | DocUpdateMessage
  | DocCompactMessage
  | DocAwarenessMessage
  | AddKeyEnvelopeMessage
  | RequestKeyEnvelopeMessage;

/** Request document updates since a sequence number */
export interface DocSyncRequestMessage {
  type: 'docSyncRequest';
  sinceSeq: number;
}

/** Send an encrypted Yjs update */
export interface DocUpdateMessage {
  type: 'docUpdate';
  encryptedUpdate: string;
  iv: string;
}

/** Send an encrypted compacted state snapshot */
export interface DocCompactMessage {
  type: 'docCompact';
  encryptedState: string;
  iv: string;
  replacesUpTo: number;
}

/** Send encrypted awareness state (cursor, selection) */
export interface DocAwarenessMessage {
  type: 'docAwareness';
  encryptedState: string;
  iv: string;
}

/** Upload a wrapped document key for a target user (ECDH key exchange) */
export interface AddKeyEnvelopeMessage {
  type: 'addKeyEnvelope';
  targetUserId: string;
  wrappedKey: string;
  iv: string;
  senderPublicKey: string;
}

/** Request the caller's key envelope */
export interface RequestKeyEnvelopeMessage {
  type: 'requestKeyEnvelope';
}

// ============================================================================
// DocumentRoom Server → Client Messages
// ============================================================================

export type DocServerMessage =
  | DocSyncResponseMessage
  | DocUpdateBroadcastMessage
  | DocAwarenessBroadcastMessage
  | KeyEnvelopeMessage
  | DocErrorMessage;

/** Response to docSyncRequest with paginated encrypted updates */
export interface DocSyncResponseMessage {
  type: 'docSyncResponse';
  updates: EncryptedDocUpdate[];
  snapshot?: EncryptedDocSnapshot;
  hasMore: boolean;
  cursor: number;
}

/** Broadcast an encrypted Yjs update to other connections */
export interface DocUpdateBroadcastMessage {
  type: 'docUpdateBroadcast';
  encryptedUpdate: string;
  iv: string;
  senderId: string;
  sequence: number;
}

/** Broadcast encrypted awareness state to other connections */
export interface DocAwarenessBroadcastMessage {
  type: 'docAwarenessBroadcast';
  encryptedState: string;
  iv: string;
  fromUserId: string;
}

/** Deliver a key envelope to the requesting user */
export interface KeyEnvelopeMessage {
  type: 'keyEnvelope';
  wrappedKey: string;
  iv: string;
  senderPublicKey: string;
  /** User ID of the user who created this envelope */
  senderUserId: string;
}

/** DocumentRoom error response */
export interface DocErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

// ============================================================================
// DocumentRoom Data Types
// ============================================================================

/** Encrypted Yjs update as stored/transmitted */
export interface EncryptedDocUpdate {
  sequence: number;
  encryptedUpdate: string;
  iv: string;
  senderId: string;
  createdAt: number;
}

/** Encrypted compacted Y.Doc state snapshot */
export interface EncryptedDocSnapshot {
  encryptedState: string;
  iv: string;
  replacesUpTo: number;
  createdAt: number;
}

// ============================================================================
// TrackerRoom Client → Server Messages
// ============================================================================

export type TrackerClientMessage =
  | TrackerSyncRequestMessage
  | TrackerUpsertMessage
  | TrackerDeleteMessage
  | TrackerBatchUpsertMessage;

/** Request tracker items since a sequence number */
export interface TrackerSyncRequestMessage {
  type: 'trackerSync';
  sinceSequence: number;
}

/** Create or update an encrypted tracker item */
export interface TrackerUpsertMessage {
  type: 'trackerUpsert';
  itemId: string;
  encryptedPayload: string;
  iv: string;
}

/** Delete a tracker item */
export interface TrackerDeleteMessage {
  type: 'trackerDelete';
  itemId: string;
}

/** Batch create/update encrypted tracker items */
export interface TrackerBatchUpsertMessage {
  type: 'trackerBatchUpsert';
  items: { itemId: string; encryptedPayload: string; iv: string }[];
}

// ============================================================================
// TrackerRoom Server → Client Messages
// ============================================================================

export type TrackerServerMessage =
  | TrackerSyncResponseMessage
  | TrackerUpsertBroadcastMessage
  | TrackerDeleteBroadcastMessage
  | TrackerErrorMessage;

/** Response to trackerSync with changelog entries since the requested sequence */
export interface TrackerSyncResponseMessage {
  type: 'trackerSyncResponse';
  items: EncryptedTrackerItem[];
  deletedItemIds: string[];
  sequence: number;
  hasMore: boolean;
}

/** Broadcast an upserted tracker item to other connections */
export interface TrackerUpsertBroadcastMessage {
  type: 'trackerUpsertBroadcast';
  item: EncryptedTrackerItem;
}

/** Broadcast a tracker item deletion to other connections */
export interface TrackerDeleteBroadcastMessage {
  type: 'trackerDeleteBroadcast';
  itemId: string;
  sequence: number;
}

/** TrackerRoom error response */
export interface TrackerErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

// ============================================================================
// TrackerRoom Data Types
// ============================================================================

/** Encrypted tracker item as stored/transmitted */
export interface EncryptedTrackerItem {
  itemId: string;
  version: number;
  encryptedPayload: string;
  iv: string;
  createdAt: number;
  updatedAt: number;
  /** Sequence number in the changelog (for cursor-based sync) */
  sequence: number;
}

// ============================================================================
// TeamRoom Client → Server Messages
// ============================================================================

export type TeamClientMessage =
  | TeamSyncRequestMessage
  | TeamUploadIdentityKeyMessage
  | TeamRequestIdentityKeyMessage
  | TeamRequestKeyEnvelopeMessage
  | TeamDocIndexSyncRequestMessage
  | TeamDocIndexRegisterMessage
  | TeamDocIndexUpdateMessage
  | TeamDocIndexRemoveMessage;

/** Request full team state snapshot */
export interface TeamSyncRequestMessage {
  type: 'teamSync';
}

/** Upload own ECDH public key */
export interface TeamUploadIdentityKeyMessage {
  type: 'uploadIdentityKey';
  publicKeyJwk: string;
}

/** Fetch a member's public key */
export interface TeamRequestIdentityKeyMessage {
  type: 'requestIdentityKey';
  targetUserId: string;
}

/** Request own key envelope */
export interface TeamRequestKeyEnvelopeMessage {
  type: 'requestKeyEnvelope';
}

/** Request the full document list */
export interface TeamDocIndexSyncRequestMessage {
  type: 'docIndexSync';
}

/** Register a new shared document in the index */
export interface TeamDocIndexRegisterMessage {
  type: 'docIndexRegister';
  documentId: string;
  encryptedTitle: string;
  titleIv: string;
  documentType: string;
}

/** Update a document's encrypted title */
export interface TeamDocIndexUpdateMessage {
  type: 'docIndexUpdate';
  documentId: string;
  encryptedTitle: string;
  titleIv: string;
}

/** Remove a document from the index */
export interface TeamDocIndexRemoveMessage {
  type: 'docIndexRemove';
  documentId: string;
}

// ============================================================================
// TeamRoom Server → Client Messages
// ============================================================================

export type TeamServerMessage =
  | TeamSyncResponseMessage
  | TeamMemberAddedMessage
  | TeamMemberRemovedMessage
  | TeamMemberRoleChangedMessage
  | TeamKeyEnvelopeAvailableMessage
  | TeamKeyEnvelopeMessage
  | TeamIdentityKeyResponseMessage
  | TeamIdentityKeyUploadedMessage
  | TeamDocIndexSyncResponseMessage
  | TeamDocIndexBroadcastMessage
  | TeamDocIndexRemoveBroadcastMessage
  | TeamErrorMessage;

/** Full team state snapshot */
export interface TeamSyncResponseMessage {
  type: 'teamSyncResponse';
  team: TeamState;
}

/** Broadcast: member added */
export interface TeamMemberAddedMessage {
  type: 'memberAdded';
  member: MemberInfo;
}

/** Broadcast: member removed */
export interface TeamMemberRemovedMessage {
  type: 'memberRemoved';
  userId: string;
}

/** Broadcast: member role changed */
export interface TeamMemberRoleChangedMessage {
  type: 'memberRoleChanged';
  userId: string;
  role: string;
}

/** Push notification: a key envelope is now available for target user */
export interface TeamKeyEnvelopeAvailableMessage {
  type: 'keyEnvelopeAvailable';
  targetUserId: string;
}

/** Delivery of a key envelope to the requesting user */
export interface TeamKeyEnvelopeMessage {
  type: 'keyEnvelope';
  wrappedKey: string;
  iv: string;
  senderPublicKey: string;
  /** User ID of the user who created this envelope */
  senderUserId: string;
}

/** Response with a peer's public key */
export interface TeamIdentityKeyResponseMessage {
  type: 'identityKeyResponse';
  userId: string;
  publicKeyJwk: string;
}

/** Broadcast: a member uploaded their identity key (so others can wrap for them) */
export interface TeamIdentityKeyUploadedMessage {
  type: 'identityKeyUploaded';
  userId: string;
}

/** Full document list response */
export interface TeamDocIndexSyncResponseMessage {
  type: 'docIndexSyncResponse';
  documents: EncryptedDocIndexEntry[];
}

/** Broadcast: document registered or updated */
export interface TeamDocIndexBroadcastMessage {
  type: 'docIndexBroadcast';
  document: EncryptedDocIndexEntry;
}

/** Broadcast: document removed */
export interface TeamDocIndexRemoveBroadcastMessage {
  type: 'docIndexRemoveBroadcast';
  documentId: string;
}

/** TeamRoom error response */
export interface TeamErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

// ============================================================================
// TeamRoom Data Types
// ============================================================================

/** Encrypted document index entry as stored/transmitted */
export interface EncryptedDocIndexEntry {
  documentId: string;
  encryptedTitle: string;
  titleIv: string;
  documentType: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** Full team state snapshot sent on teamSync */
export interface TeamState {
  metadata: {
    orgId: string;
    name: string;
    gitRemoteHash: string | null;
    createdBy: string;
    createdAt: number;
  } | null;
  members: MemberInfo[];
  documents: EncryptedDocIndexEntry[];
  /** Caller's own key envelope (if exists) */
  keyEnvelope?: {
    wrappedKey: string;
    iv: string;
    senderPublicKey: string;
    senderUserId?: string;
  } | null;
}

/** Information about a team member */
export interface MemberInfo {
  userId: string;
  role: string;
  email: string | null;
  hasKeyEnvelope: boolean;
  hasIdentityKey: boolean;
}

// ============================================================================
// Auth Types
// ============================================================================

/** Decoded auth token from WebSocket connection */
export interface AuthContext {
  userId: string;
  /** Organization ID from B2B JWT. */
  orgId: string;
}

// ============================================================================
// Env Bindings
// ============================================================================

export interface Env {
  SESSION_ROOM: DurableObjectNamespace;
  INDEX_ROOM: DurableObjectNamespace;
  DOCUMENT_ROOM: DurableObjectNamespace;
  TRACKER_ROOM: DurableObjectNamespace;
  TEAM_ROOM: DurableObjectNamespace;
  DB: D1Database;
  SESSION_SHARES: R2Bucket;
  ENVIRONMENT: string;
  // Stytch B2B auth
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
  // Test-only: bypass JWT auth in dev mode (parse user_id/org_id from query params)
  TEST_AUTH_BYPASS?: string;
}
