/**
 * DocumentRoom Durable Object
 *
 * Manages realtime collaborative document editing with E2E encryption.
 * The DO acts as a dumb encrypted relay -- it never reads or merges Yjs state.
 * All CRDT merging happens client-side.
 *
 * Uses DO SQLite for encrypted update storage, key envelopes, and snapshots.
 */

import type {
  Env,
  DocClientMessage,
  DocServerMessage,
  EncryptedDocUpdate,
  EncryptedDocSnapshot,
  AuthContext,
} from './types';
import { createLogger } from './logger';
import { validateP256PublicKey } from './validatePublicKey';

const log = createLogger('DocumentRoom');

/** Document TTL: 30 days in milliseconds */
const DOCUMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Number of updates to return per sync response */
const SYNC_BATCH_SIZE = 100;

/** Number of updates to keep after compaction (overlap window for late arrivals) */
const COMPACTION_OVERLAP = 50;

interface ConnectionState {
  auth: AuthContext;
  synced: boolean;
}

// WebSocket tag prefixes for hibernation recovery
const TAG_USER = 'user:';
const TAG_ORG = 'org:';

export class DocumentRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private connections: Map<WebSocket, ConnectionState> = new Map();
  private initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    this.restoreConnectionsFromHibernation();
  }

  /**
   * Restore connection state from WebSocket tags after hibernation.
   */
  private restoreConnectionsFromHibernation(): void {
    const webSockets = this.state.getWebSockets();
    for (const ws of webSockets) {
      const tags = this.state.getTags(ws);
      const userTag = tags.find(t => t.startsWith(TAG_USER));
      const orgTag = tags.find(t => t.startsWith(TAG_ORG));
      if (userTag && orgTag) {
        const userId = userTag.slice(TAG_USER.length);
        const orgId = orgTag.slice(TAG_ORG.length);
        this.connections.set(ws, {
          auth: { userId, orgId },
          synced: true,
        });
      }
    }
    if (webSockets.length > 0) {
      log.info(`Restored ${webSockets.length} connections from hibernation`);
    }
  }

  /**
   * Initialize SQLite schema on first access.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const sql = this.state.storage.sql;

    sql.exec(`
      CREATE TABLE IF NOT EXISTS encrypted_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        update_data TEXT NOT NULL,
        iv TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_updates_sequence ON encrypted_updates(sequence);

      CREATE TABLE IF NOT EXISTS key_envelopes (
        target_user_id TEXT NOT NULL,
        sender_user_id TEXT NOT NULL DEFAULT '',
        wrapped_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        sender_public_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (target_user_id)
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encrypted_state TEXT NOT NULL,
        iv TEXT NOT NULL,
        replaces_up_to INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Bootstrap TTL alarm for existing documents without one
    const existingAlarm = await this.state.storage.getAlarm();
    if (!existingAlarm) {
      const hasData = sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM metadata`
      ).toArray()[0]?.count ?? 0;

      if (hasData > 0 && this.connections.size === 0) {
        await this.scheduleExpiryAlarm();
      }
    }

    this.initialized = true;
  }

  /**
   * Handle HTTP requests (WebSocket upgrades and REST endpoints).
   */
  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    if (url.pathname.endsWith('/status')) {
      return this.handleStatusRequest();
    }

    if (url.pathname.endsWith('/delete-account') && request.method === 'DELETE') {
      return this.handleDeleteAccount();
    }

    // Delete this document's DO state (called when unsharing from TeamRoom)
    if (url.pathname.endsWith('/delete') && request.method === 'DELETE') {
      return this.handleDeleteDocument();
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  /**
   * Upgrade HTTP to WebSocket.
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const auth = this.parseAuth(request);
    if (!auth) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Cancel TTL alarm since document is now actively connected
    await this.state.storage.deleteAlarm();

    const tags = [`${TAG_USER}${auth.userId}`, `${TAG_ORG}${auth.orgId}`];
    this.state.acceptWebSocket(server, tags);

    this.connections.set(server, {
      auth,
      synced: false,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Parse auth context from query params (set by the main worker after JWT validation).
   */
  private parseAuth(request: Request): AuthContext | null {
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id');
    const orgId = url.searchParams.get('org_id');
    if (userId && orgId) {
      return { userId, orgId };
    }
    return null;
  }

  /**
   * Handle incoming WebSocket message.
   */
  async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): Promise<void> {
    await this.ensureInitialized();

    const connState = this.connections.get(ws);
    if (!connState) {
      ws.close(4001, 'Unknown connection');
      return;
    }

    try {
      const rawData = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const message: DocClientMessage = JSON.parse(rawData);

      switch (message.type) {
        case 'docSyncRequest':
          await this.handleDocSyncRequest(ws, connState, message.sinceSeq);
          break;

        case 'docUpdate':
          await this.handleDocUpdate(
            ws,
            connState,
            message.encryptedUpdate,
            message.iv,
            message.clientUpdateId
          );
          break;

        case 'docCompact':
          await this.handleDocCompact(ws, connState, message.encryptedState, message.iv, message.replacesUpTo);
          break;

        case 'docAwareness':
          this.handleDocAwareness(ws, connState, message.encryptedState, message.iv);
          break;

        case 'addKeyEnvelope':
          await this.handleAddKeyEnvelope(ws, connState, message.targetUserId, message.wrappedKey, message.iv, message.senderPublicKey);
          break;

        case 'requestKeyEnvelope':
          this.handleRequestKeyEnvelope(ws, connState);
          break;

        default:
          log.warn('Unknown message type:', (message as { type: string }).type);
          this.sendError(ws, 'unknown_message_type', 'Unknown message type');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error('Error handling message:', errorMessage);
      this.sendError(ws, 'parse_error', `Failed to parse message: ${errorMessage}`);
    }
  }

  /**
   * Handle document sync request - return encrypted updates since cursor.
   */
  private async handleDocSyncRequest(
    ws: WebSocket,
    connState: ConnectionState,
    sinceSeq: number
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Get the latest snapshot (if any) that covers the requested range
    let snapshot: EncryptedDocSnapshot | undefined;
    const snapshotRow = sql.exec<{
      encrypted_state: string;
      iv: string;
      replaces_up_to: number;
      created_at: number;
    }>(
      `SELECT encrypted_state, iv, replaces_up_to, created_at
       FROM snapshots
       ORDER BY replaces_up_to DESC
       LIMIT 1`
    ).toArray()[0];

    // If there's a snapshot that covers everything the client needs, use it
    let effectiveSinceSeq = sinceSeq;
    if (snapshotRow && snapshotRow.replaces_up_to > sinceSeq) {
      snapshot = {
        encryptedState: snapshotRow.encrypted_state,
        iv: snapshotRow.iv,
        replacesUpTo: snapshotRow.replaces_up_to,
        createdAt: snapshotRow.created_at,
      };
      // Client only needs updates after the snapshot
      effectiveSinceSeq = snapshotRow.replaces_up_to;
    }

    // Fetch updates after the effective cursor
    const rows = sql.exec<{
      sequence: number;
      update_data: string;
      iv: string;
      sender_id: string;
      created_at: number;
    }>(
      `SELECT sequence, update_data, iv, sender_id, created_at
       FROM encrypted_updates
       WHERE sequence > ?
       ORDER BY sequence ASC
       LIMIT ?`,
      effectiveSinceSeq,
      SYNC_BATCH_SIZE + 1
    ).toArray();

    const hasMore = rows.length > SYNC_BATCH_SIZE;
    const resultRows = hasMore ? rows.slice(0, SYNC_BATCH_SIZE) : rows;

    const updates: EncryptedDocUpdate[] = resultRows.map(row => ({
      sequence: row.sequence,
      encryptedUpdate: row.update_data,
      iv: row.iv,
      senderId: row.sender_id,
      createdAt: row.created_at,
    }));

    const cursor = resultRows.length > 0
      ? resultRows[resultRows.length - 1].sequence
      : effectiveSinceSeq;

    const response: DocServerMessage = {
      type: 'docSyncResponse',
      updates,
      snapshot,
      hasMore,
      cursor,
    };

    ws.send(JSON.stringify(response));
    connState.synced = true;
  }

  /**
   * Handle document update - store encrypted blob and broadcast to other connections.
   */
  private async handleDocUpdate(
    ws: WebSocket,
    connState: ConnectionState,
    encryptedUpdate: string,
    iv: string,
    clientUpdateId?: string
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Assign server-side sequence number
    const maxSeqResult = sql.exec<{ max_seq: number | null }>(
      `SELECT MAX(sequence) as max_seq FROM encrypted_updates`
    ).toArray();
    const nextSeq = (maxSeqResult[0]?.max_seq ?? 0) + 1;

    const now = Date.now();

    sql.exec(
      `INSERT INTO encrypted_updates (update_data, iv, sender_id, sequence, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      encryptedUpdate,
      iv,
      connState.auth.userId,
      nextSeq,
      now
    );

    // Update activity timestamp
    this.setMetadataValue('updated_at', String(now));

    // Broadcast to other connections
    this.broadcast(
      {
        type: 'docUpdateBroadcast',
        encryptedUpdate,
        iv,
        senderId: connState.auth.userId,
        sequence: nextSeq,
      },
      ws
    );

    if (clientUpdateId) {
      ws.send(JSON.stringify({
        type: 'docUpdateAck',
        clientUpdateId,
        sequence: nextSeq,
      }));
    }
  }

  /**
   * Handle compaction - store encrypted snapshot and prune old updates.
   */
  private async handleDocCompact(
    ws: WebSocket,
    connState: ConnectionState,
    encryptedState: string,
    iv: string,
    replacesUpTo: number
  ): Promise<void> {
    const sql = this.state.storage.sql;
    const now = Date.now();

    // Insert the snapshot
    sql.exec(
      `INSERT INTO snapshots (encrypted_state, iv, replaces_up_to, created_at)
       VALUES (?, ?, ?, ?)`,
      encryptedState,
      iv,
      replacesUpTo,
      now
    );

    // Prune old updates, keeping an overlap window for late arrivals
    const pruneUpTo = replacesUpTo - COMPACTION_OVERLAP;
    if (pruneUpTo > 0) {
      sql.exec(
        `DELETE FROM encrypted_updates WHERE sequence <= ?`,
        pruneUpTo
      );
    }

    // Delete older snapshots (keep only the latest)
    sql.exec(
      `DELETE FROM snapshots WHERE replaces_up_to < ?`,
      replacesUpTo
    );

    this.setMetadataValue('updated_at', String(now));

    log.info(`Compacted: snapshot covers up to seq ${replacesUpTo}, pruned updates <= ${pruneUpTo}`);
  }

  /**
   * Handle awareness update - broadcast only, no persistence.
   * Awareness is ephemeral (cursor positions, selections).
   */
  private handleDocAwareness(
    ws: WebSocket,
    connState: ConnectionState,
    encryptedState: string,
    iv: string
  ): void {
    this.broadcast(
      {
        type: 'docAwarenessBroadcast',
        encryptedState,
        iv,
        fromUserId: connState.auth.userId,
      },
      ws
    );
  }

  /**
   * Handle adding a key envelope for a target user.
   * Used in ECDH key exchange when sharing a document.
   *
   * Authorization: if an envelope already exists for the target user,
   * only the original sender can overwrite it (prevents impersonation).
   */
  private async handleAddKeyEnvelope(
    ws: WebSocket,
    connState: ConnectionState,
    targetUserId: string,
    wrappedKey: string,
    iv: string,
    senderPublicKey: string
  ): Promise<void> {
    // Validate senderPublicKey is a well-formed P-256 public key
    const keyError = validateP256PublicKey(senderPublicKey);
    if (keyError) {
      this.sendError(ws, 'invalid_sender_key', keyError);
      return;
    }

    const sql = this.state.storage.sql;
    const senderId = connState.auth.userId;

    // Check if an envelope already exists from a different sender
    const existing = sql.exec<{ sender_user_id: string }>(
      `SELECT sender_user_id FROM key_envelopes WHERE target_user_id = ?`,
      targetUserId
    ).toArray()[0];

    if (existing && existing.sender_user_id !== '' && existing.sender_user_id !== senderId) {
      this.sendError(ws, 'envelope_sender_mismatch',
        'Cannot overwrite envelope created by a different user');
      return;
    }

    sql.exec(
      `INSERT OR REPLACE INTO key_envelopes
       (target_user_id, sender_user_id, wrapped_key, iv, sender_public_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      targetUserId,
      senderId,
      wrappedKey,
      iv,
      senderPublicKey,
      Date.now()
    );

    log.info(`Key envelope stored for user ${targetUserId} by sender ${senderId}`);
  }

  /**
   * Handle key envelope request - return the caller's envelope if one exists.
   */
  private handleRequestKeyEnvelope(
    ws: WebSocket,
    connState: ConnectionState
  ): void {
    const sql = this.state.storage.sql;

    const row = sql.exec<{
      wrapped_key: string;
      iv: string;
      sender_public_key: string;
      sender_user_id: string;
    }>(
      `SELECT wrapped_key, iv, sender_public_key, sender_user_id FROM key_envelopes WHERE target_user_id = ?`,
      connState.auth.userId
    ).toArray()[0];

    if (row) {
      const response: DocServerMessage = {
        type: 'keyEnvelope',
        wrappedKey: row.wrapped_key,
        iv: row.iv,
        senderPublicKey: row.sender_public_key,
        senderUserId: row.sender_user_id,
      };
      ws.send(JSON.stringify(response));
    } else {
      this.sendError(ws, 'no_key_envelope', 'No key envelope found for this user');
    }
  }

  /**
   * Broadcast message to all connections except sender.
   */
  private broadcast(message: DocServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const [ws, state] of this.connections) {
      if (ws !== exclude && state.synced) {
        try {
          ws.send(data);
        } catch (err) {
          log.error('Broadcast error:', err);
          this.connections.delete(ws);
        }
      }
    }
  }

  /**
   * Send error to a single connection.
   */
  private sendError(ws: WebSocket, code: string, message: string): void {
    ws.send(JSON.stringify({ type: 'error', code, message }));
  }

  /**
   * Set a single metadata value.
   */
  private setMetadataValue(key: string, value: string): void {
    const sql = this.state.storage.sql;
    sql.exec(
      `INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES (?, ?, ?)`,
      key,
      value,
      Date.now()
    );
  }

  /**
   * Handle WebSocket close.
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    this.connections.delete(ws);

    if (this.connections.size === 0) {
      await this.scheduleExpiryAlarm();
    }
  }

  /**
   * Handle WebSocket error.
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    log.error('WebSocket error:', error);
    this.connections.delete(ws);

    if (this.connections.size === 0) {
      await this.scheduleExpiryAlarm();
    }
  }

  /**
   * Schedule the TTL expiry alarm.
   */
  private async scheduleExpiryAlarm(): Promise<void> {
    if (this.connections.size > 0) return;
    await this.state.storage.setAlarm(Date.now() + DOCUMENT_TTL_MS);
  }

  /**
   * Alarm handler - called when the TTL expires.
   */
  async alarm(): Promise<void> {
    await this.ensureInitialized();

    if (this.connections.size > 0) {
      log.info('Alarm fired but document has active connections, rescheduling');
      await this.scheduleExpiryAlarm();
      return;
    }

    const sql = this.state.storage.sql;
    const row = sql.exec<{ value: string }>(
      `SELECT value FROM metadata WHERE key = 'updated_at'`
    ).toArray()[0];

    const lastActivity = row ? parseInt(row.value, 10) : 0;
    const elapsed = Date.now() - lastActivity;

    if (elapsed < DOCUMENT_TTL_MS) {
      const remaining = DOCUMENT_TTL_MS - elapsed;
      await this.state.storage.setAlarm(Date.now() + remaining);
      log.info('Alarm fired early, rescheduling for', remaining, 'ms');
      return;
    }

    log.info('Document TTL expired, deleting data. Last activity:', lastActivity);
    sql.exec(`DELETE FROM encrypted_updates`);
    sql.exec(`DELETE FROM key_envelopes`);
    sql.exec(`DELETE FROM snapshots`);
    sql.exec(`DELETE FROM metadata`);
  }

  /**
   * Handle account deletion - purge all data and disconnect clients.
   */
  private handleDeleteAccount(): Response {
    const sql = this.state.storage.sql;

    sql.exec(`DELETE FROM encrypted_updates`);
    sql.exec(`DELETE FROM key_envelopes`);
    sql.exec(`DELETE FROM snapshots`);
    sql.exec(`DELETE FROM metadata`);

    for (const [ws] of this.connections) {
      try {
        ws.close(4003, 'Account deleted');
      } catch {
        // Connection may already be closed
      }
    }
    this.connections.clear();

    this.state.storage.deleteAlarm();

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle document deletion - purge all data and disconnect clients.
   * Called when a document is unshared from the TeamRoom index.
   */
  private handleDeleteDocument(): Response {
    const sql = this.state.storage.sql;
    log.info('Document deletion requested, purging all data');

    sql.exec(`DELETE FROM encrypted_updates`);
    sql.exec(`DELETE FROM key_envelopes`);
    sql.exec(`DELETE FROM snapshots`);
    sql.exec(`DELETE FROM metadata`);

    for (const [ws] of this.connections) {
      try {
        ws.close(4004, 'Document deleted');
      } catch {
        // Connection may already be closed
      }
    }
    this.connections.clear();

    this.state.storage.deleteAlarm();

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Status endpoint for debugging.
   */
  private handleStatusRequest(): Response {
    const sql = this.state.storage.sql;

    const updateCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM encrypted_updates`
    ).toArray()[0]?.count ?? 0;

    const snapshotCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM snapshots`
    ).toArray()[0]?.count ?? 0;

    const envelopeCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM key_envelopes`
    ).toArray()[0]?.count ?? 0;

    const maxSeq = sql.exec<{ max_seq: number | null }>(
      `SELECT MAX(sequence) as max_seq FROM encrypted_updates`
    ).toArray()[0]?.max_seq ?? 0;

    return new Response(
      JSON.stringify({
        roomId: this.state.id.toString(),
        connections: this.connections.size,
        updateCount,
        snapshotCount,
        envelopeCount,
        maxSequence: maxSeq,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}
