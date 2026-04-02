/**
 * Types for TrackerSync -- client-side tracker item encryption and sync layer.
 *
 * These are the client-side equivalents of the TrackerClientMessage/TrackerServerMessage
 * types defined in collabv3/src/types.ts. Duplicated here to avoid a dependency
 * on the collabv3 package (which is a Cloudflare Worker, not a library).
 */

// ============================================================================
// Configuration
// ============================================================================

export interface TrackerSyncConfig {
  /** WebSocket server URL (e.g., wss://sync.nimbalyst.com) */
  serverUrl: string;

  /** Function to get fresh JWT for WebSocket auth */
  getJwt: () => Promise<string>;

  /** B2B organization ID */
  orgId: string;

  /** AES-256-GCM key for encrypting/decrypting tracker items */
  encryptionKey: CryptoKey;

  /** Current user's ID */
  userId: string;

  /** Project ID (used to construct room ID: org:{orgId}:tracker:{projectId}) */
  projectId: string;

  /** Called when remote tracker items are upserted */
  onItemUpserted?: (item: TrackerItemPayload) => void;

  /** Called when a remote tracker item is deleted */
  onItemDeleted?: (itemId: string) => void;

  /** Called when connection status changes */
  onStatusChange?: (status: TrackerSyncStatus) => void;

  /** Called once after initial sync fully completes. */
  onInitialSyncComplete?: (summary: TrackerInitialSyncSummary) => void | Promise<void>;

  /**
   * Override the WebSocket URL construction.
   * Useful for integration tests with auth bypass.
   */
  buildUrl?: (roomId: string) => string;
}

export interface TrackerInitialSyncSummary {
  remoteItemCount: number;
  remoteDeletedCount: number;
  sequence: number;
}

// ============================================================================
// Status
// ============================================================================

export type TrackerSyncStatus =
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'connected'
  | 'error';

// ============================================================================
// Tracker Item Payload (decrypted)
// ============================================================================

/**
 * The decrypted payload of a tracker item.
 * This is JSON-serialized, encrypted with AES-256-GCM, and sent as an opaque blob.
 * The server never sees any of these fields.
 */
export interface TrackerItemPayload {
  /** Unique item ID (opaque UUID, also stored in plaintext on server for routing) */
  itemId: string;

  /** Human-readable sequential number assigned by the tracker room */
  issueNumber?: number;

  /** Human-readable key like NIM-123 assigned by the tracker room */
  issueKey?: string;

  /** Tracker type (bug, task, plan, idea, decision, or custom) */
  type: string;

  /** Item title */
  title: string;

  /** Item description (plain text or inline markdown) */
  description?: string;

  /** Status value (from tracker YAML data model) */
  status: string;

  /** Priority value (from tracker YAML data model) */
  priority: string;

  /** Assignee email (stable cross-org identifier) */
  assigneeEmail?: string;

  /** Reporter email (stable cross-org identifier) */
  reporterEmail?: string;

  /** Structured author identity */
  authorIdentity?: TrackerIdentity | null;

  /** Structured last-modifier identity */
  lastModifiedBy?: TrackerIdentity | null;

  /** Whether this item was created by an AI agent */
  createdByAgent?: boolean;

  /** @deprecated Use assigneeEmail instead */
  assigneeId?: string;

  /** @deprecated Use reporterEmail instead */
  reporterId?: string;

  /** Labels */
  labels: string[];

  /** Linked AI session IDs */
  linkedSessions: string[];

  /** Linked git commit SHA */
  linkedCommitSha?: string;

  /** Optional DocumentRoom ID for rich collaborative content */
  documentId?: string;

  /** Comments thread */
  comments: TrackerComment[];

  /** Whether the item is archived */
  archived?: boolean;

  /** When the item was archived (ISO timestamp) */
  archivedAt?: string;

  /** Custom fields defined by the tracker YAML data model */
  customFields: Record<string, unknown>;

  /**
   * Per-field timestamps for Last-Write-Wins conflict resolution.
   * Key is the field name, value is Unix timestamp ms of the last update.
   * When two clients update the same item concurrently, the client resolves
   * by taking the most recent value for each field based on these timestamps.
   */
  fieldUpdatedAt: Record<string, number>;
}

export interface TrackerComment {
  id: string;
  /** Structured author identity for offline rendering */
  authorIdentity: TrackerIdentity;
  body: string;
  createdAt: number;
  updatedAt?: number | null;
  /** Soft delete for sync compatibility */
  deleted?: boolean;
  /** @deprecated Use authorIdentity instead */
  authorId?: string;
}

// ============================================================================
// Sync Events
// ============================================================================

/**
 * Result of a full sync operation.
 * Contains all items and deletions from the server since the last sync.
 */
export interface TrackerSyncResult {
  /** Items upserted since last sync (decrypted) */
  items: TrackerItemPayload[];
  /** Item IDs deleted since last sync */
  deletedItemIds: string[];
  /** Server sequence cursor for next sync */
  sequence: number;
  /** Whether there are more items to sync */
  hasMore: boolean;
}

// ============================================================================
// Wire Protocol (client-side copies of collabv3 types)
// ============================================================================

/** Client -> Server messages */
export type TrackerClientMessage =
  | { type: 'trackerSync'; sinceSequence: number }
  | { type: 'trackerUpsert'; itemId: string; encryptedPayload: string; iv: string; issueNumber?: number; issueKey?: string }
  | { type: 'trackerDelete'; itemId: string }
  | { type: 'trackerBatchUpsert'; items: { itemId: string; encryptedPayload: string; iv: string; issueNumber?: number; issueKey?: string }[] };

/** Server -> Client messages */
export type TrackerServerMessage =
  | TrackerSyncResponseMessage
  | TrackerUpsertBroadcastMessage
  | TrackerDeleteBroadcastMessage
  | TrackerErrorMessage;

export interface TrackerSyncResponseMessage {
  type: 'trackerSyncResponse';
  items: EncryptedTrackerItem[];
  deletedItemIds: string[];
  sequence: number;
  hasMore: boolean;
}

export interface TrackerUpsertBroadcastMessage {
  type: 'trackerUpsertBroadcast';
  item: EncryptedTrackerItem;
}

export interface TrackerDeleteBroadcastMessage {
  type: 'trackerDeleteBroadcast';
  itemId: string;
  sequence: number;
}

export interface TrackerErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/** Encrypted tracker item as received from server */
export interface EncryptedTrackerItem {
  itemId: string;
  issueNumber?: number;
  issueKey?: string;
  version: number;
  encryptedPayload: string;
  iv: string;
  createdAt: number;
  updatedAt: number;
  sequence: number;
}

// ============================================================================
// TrackerItem <-> TrackerItemPayload Mapping
// ============================================================================

import type { TrackerItem, TrackerIdentity } from '../core/DocumentService';

/**
 * Convert a local TrackerItem (PGLite shape) to a TrackerItemPayload (sync wire shape).
 * Used when promoting a local item to a shared item, or when pushing local changes to the server.
 */
export function trackerItemToPayload(item: TrackerItem, userId: string): TrackerItemPayload {
  const now = Date.now();
  return {
    itemId: item.id,
    issueNumber: item.issueNumber,
    issueKey: item.issueKey,
    type: item.type,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority || 'medium',
    assigneeEmail: item.assigneeEmail,
    reporterEmail: item.reporterEmail,
    authorIdentity: item.authorIdentity || null,
    lastModifiedBy: item.lastModifiedBy || null,
    createdByAgent: item.createdByAgent || false,
    // Keep deprecated fields for backward compat with older clients
    assigneeId: item.assigneeId,
    reporterId: item.reporterId || userId,
    labels: item.labels || [],
    linkedSessions: item.linkedSessions || [],
    linkedCommitSha: item.linkedCommitSha,
    documentId: item.documentId,
    archived: item.archived || false,
    archivedAt: item.archivedAt,
    comments: [],
    customFields: item.customFields || {},
    fieldUpdatedAt: {
      title: now,
      issueNumber: now,
      issueKey: now,
      status: now,
      priority: now,
      description: now,
      assigneeEmail: now,
      reporterEmail: now,
      authorIdentity: now,
      lastModifiedBy: now,
      // Keep deprecated field timestamps for backward compat
      assigneeId: now,
      reporterId: now,
      labels: now,
      linkedSessions: now,
      linkedCommitSha: now,
      documentId: now,
      archived: now,
      comments: now,
      customFields: now,
    },
  };
}

/**
 * Convert a TrackerItemPayload (sync wire shape) to a partial TrackerItem (PGLite shape).
 * The caller must supply workspace and other context fields.
 * Used when hydrating synced items into the local PGLite database.
 */
export function payloadToTrackerItem(
  payload: TrackerItemPayload,
  workspace: string
): Omit<TrackerItem, 'module' | 'lastIndexed'> & { module: string; lastIndexed: Date } {
  return {
    id: payload.itemId,
    issueNumber: payload.issueNumber,
    issueKey: payload.issueKey,
    type: payload.type,
    title: payload.title,
    description: payload.description,
    status: payload.status,
    priority: payload.priority as TrackerItem['priority'],
    owner: payload.assigneeEmail || payload.assigneeId,
    module: '',  // Synced items don't have a source file
    workspace,
    tags: undefined,
    created: undefined,
    updated: undefined,
    lastIndexed: new Date(),
    authorIdentity: payload.authorIdentity || null,
    lastModifiedBy: payload.lastModifiedBy || null,
    createdByAgent: payload.createdByAgent || false,
    assigneeEmail: payload.assigneeEmail,
    reporterEmail: payload.reporterEmail,
    assigneeId: payload.assigneeId,
    reporterId: payload.reporterId,
    labels: payload.labels,
    linkedSessions: payload.linkedSessions,
    linkedCommitSha: payload.linkedCommitSha,
    documentId: payload.documentId,
    customFields: payload.customFields,
    archived: payload.archived || false,
    archivedAt: payload.archivedAt,
    syncStatus: 'synced',
  };
}
