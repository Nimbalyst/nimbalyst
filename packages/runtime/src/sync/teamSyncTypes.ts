/**
 * Types for TeamSync -- client-side team state sync layer.
 *
 * These are the client-side equivalents of the TeamClientMessage/TeamServerMessage
 * types defined in collabv3/src/types.ts. Duplicated here to avoid a dependency
 * on the collabv3 package (which is a Cloudflare Worker, not a library).
 */

// ============================================================================
// Configuration
// ============================================================================

export interface TeamSyncConfig {
  /** WebSocket server URL (e.g., wss://sync.nimbalyst.com) */
  serverUrl: string;

  /** Function to get fresh JWT for WebSocket auth */
  getJwt: () => Promise<string>;

  /** B2B organization ID */
  orgId: string;

  /** Current user's ID */
  userId: string;

  /** AES-256-GCM key for encrypting/decrypting document titles (org key) */
  encryptionKey: CryptoKey;

  /** Called when full team state snapshot is received (initial sync) */
  onTeamStateLoaded?: (state: TeamState) => void;

  /** Called when a member is added */
  onMemberAdded?: (member: MemberInfo) => void;

  /** Called when a member is removed */
  onMemberRemoved?: (userId: string) => void;

  /** Called when a member's role changes */
  onMemberRoleChanged?: (userId: string, role: string) => void;

  /** Called when a key envelope becomes available for the current user */
  onKeyEnvelopeAvailable?: (targetUserId: string) => void;

  /** Called when a key envelope is delivered */
  onKeyEnvelope?: (envelope: KeyEnvelopeData) => void;

  /** Called when the full document list is loaded (from teamSync or docIndexSync) */
  onDocumentsLoaded?: (documents: DocIndexEntry[]) => void;

  /** Called when a document is added or updated */
  onDocumentChanged?: (document: DocIndexEntry) => void;

  /** Called when a document is removed */
  onDocumentRemoved?: (documentId: string) => void;

  /** Called when connection status changes */
  onStatusChange?: (status: TeamSyncStatus) => void;

  /**
   * Override the WebSocket URL construction.
   * Useful for integration tests with auth bypass.
   */
  buildUrl?: (roomId: string) => string;
}

// ============================================================================
// Status
// ============================================================================

export type TeamSyncStatus =
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'connected'
  | 'error';

// ============================================================================
// Team State (decrypted)
// ============================================================================

export interface TeamState {
  metadata: {
    orgId: string;
    name: string;
    gitRemoteHash: string | null;
    createdBy: string;
    createdAt: number;
  } | null;
  members: MemberInfo[];
  documents: DocIndexEntry[];
  keyEnvelope?: KeyEnvelopeData | null;
}

export interface MemberInfo {
  userId: string;
  role: string;
  email: string | null;
  hasKeyEnvelope: boolean;
  hasIdentityKey: boolean;
}

export interface KeyEnvelopeData {
  wrappedKey: string;
  iv: string;
  senderPublicKey: string;
}

/** Decrypted document index entry for UI consumption */
export interface DocIndexEntry {
  documentId: string;
  title: string;
  documentType: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Wire Protocol (client-side copies of collabv3 types)
// ============================================================================

/** Client -> Server messages */
export type TeamClientMessage =
  | { type: 'teamSync' }
  | { type: 'uploadIdentityKey'; publicKeyJwk: string }
  | { type: 'requestIdentityKey'; targetUserId: string }
  | { type: 'requestKeyEnvelope' }
  | { type: 'docIndexSync' }
  | { type: 'docIndexRegister'; documentId: string; encryptedTitle: string; titleIv: string; documentType: string }
  | { type: 'docIndexUpdate'; documentId: string; encryptedTitle: string; titleIv: string }
  | { type: 'docIndexRemove'; documentId: string };

/** Server -> Client messages */
export type TeamServerMessage =
  | TeamSyncResponseMessage
  | TeamMemberAddedMessage
  | TeamMemberRemovedMessage
  | TeamMemberRoleChangedMessage
  | TeamKeyEnvelopeAvailableMessage
  | TeamKeyEnvelopeMessage
  | TeamIdentityKeyResponseMessage
  | TeamDocIndexSyncResponseMessage
  | TeamDocIndexBroadcastMessage
  | TeamDocIndexRemoveBroadcastMessage
  | TeamErrorMessage;

export interface TeamSyncResponseMessage {
  type: 'teamSyncResponse';
  team: ServerTeamState;
}

export interface TeamMemberAddedMessage {
  type: 'memberAdded';
  member: MemberInfo;
}

export interface TeamMemberRemovedMessage {
  type: 'memberRemoved';
  userId: string;
}

export interface TeamMemberRoleChangedMessage {
  type: 'memberRoleChanged';
  userId: string;
  role: string;
}

export interface TeamKeyEnvelopeAvailableMessage {
  type: 'keyEnvelopeAvailable';
  targetUserId: string;
}

export interface TeamKeyEnvelopeMessage {
  type: 'keyEnvelope';
  wrappedKey: string;
  iv: string;
  senderPublicKey: string;
}

export interface TeamIdentityKeyResponseMessage {
  type: 'identityKeyResponse';
  userId: string;
  publicKeyJwk: string;
}

export interface TeamDocIndexSyncResponseMessage {
  type: 'docIndexSyncResponse';
  documents: EncryptedDocIndexEntry[];
}

export interface TeamDocIndexBroadcastMessage {
  type: 'docIndexBroadcast';
  document: EncryptedDocIndexEntry;
}

export interface TeamDocIndexRemoveBroadcastMessage {
  type: 'docIndexRemoveBroadcast';
  documentId: string;
}

export interface TeamErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/** Server team state snapshot (encrypted document titles) */
export interface ServerTeamState {
  metadata: {
    orgId: string;
    name: string;
    gitRemoteHash: string | null;
    createdBy: string;
    createdAt: number;
  } | null;
  members: MemberInfo[];
  documents: EncryptedDocIndexEntry[];
  keyEnvelope?: KeyEnvelopeData | null;
}

/** Encrypted document index entry as received from server */
export interface EncryptedDocIndexEntry {
  documentId: string;
  encryptedTitle: string;
  titleIv: string;
  documentType: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
