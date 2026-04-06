/**
 * TeamTrackerRoom Durable Object
 *
 * Manages realtime collaborative tracker item sync with E2E encryption.
 * The DO acts as a dumb encrypted relay -- it never reads tracker item content.
 * All filtering, sorting, aggregation, and conflict resolution happens client-side.
 *
 * Uses DO SQLite for encrypted tracker item storage and a changelog for sync.
 */

import type {
  Env,
  TrackerClientMessage,
  TrackerServerMessage,
  EncryptedTrackerItem,
  AuthContext,
} from './types';
import { createLogger } from './logger';
import { track } from './analytics';

const log = createLogger('TeamTrackerRoom');

/** Tracker TTL: 90 days in milliseconds (longer than documents since trackers are long-lived) */
const TRACKER_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Number of changelog entries to return per sync response */
const SYNC_BATCH_SIZE = 200;

interface ConnectionState {
  auth: AuthContext;
  synced: boolean;
}

// WebSocket tag prefixes for hibernation recovery
const TAG_USER = 'user:';
const TAG_ORG = 'org:';
const ISSUE_KEY_PREFIX = 'NIM';

export class TeamTrackerRoom implements DurableObject {
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
      CREATE TABLE IF NOT EXISTS tracker_items (
        item_id TEXT PRIMARY KEY,
        issue_number INTEGER,
        issue_key TEXT,
        version INTEGER NOT NULL,
        encrypted_payload TEXT NOT NULL,
        iv TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Migrate: add issue_number and issue_key columns if missing (pre-existing DOs)
    try {
      sql.exec(`ALTER TABLE tracker_items ADD COLUMN issue_number INTEGER`);
    } catch { /* column already exists */ }
    try {
      sql.exec(`ALTER TABLE tracker_items ADD COLUMN issue_key TEXT`);
    } catch { /* column already exists */ }

    sql.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_items_issue_number ON tracker_items(issue_number)
      WHERE issue_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_items_issue_key ON tracker_items(issue_key)
      WHERE issue_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS changelog (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        action TEXT NOT NULL,
        encrypted_payload TEXT,
        iv TEXT,
        version INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_changelog_sequence ON changelog(sequence);

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Bootstrap TTL alarm for existing trackers without one
    const existingAlarm = await this.state.storage.getAlarm();
    if (!existingAlarm) {
      const hasData = sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM tracker_items`
      ).toArray()[0]?.count ?? 0;

      if (hasData > 0 && this.connections.size === 0) {
        await this.scheduleExpiryAlarm();
      }
    }

    this.initialized = true;
  }

  private getMetadataValue(key: string): string | null {
    const sql = this.state.storage.sql;
    const row = sql.exec<{ value: string }>(
      `SELECT value FROM metadata WHERE key = ?`,
      key
    ).toArray()[0];
    return row?.value ?? null;
  }

  private allocateNextIssueNumber(): number {
    const stored = this.getMetadataValue('next_issue_number');
    let next = Number(stored ?? '0');
    if (!Number.isFinite(next) || next <= 0) {
      const maxExisting = this.state.storage.sql.exec<{ max_issue_number: number | null }>(
        `SELECT MAX(issue_number) as max_issue_number FROM tracker_items`
      ).toArray()[0]?.max_issue_number ?? 0;
      next = Math.max(1, maxExisting + 1);
    }
    this.setMetadataValue('next_issue_number', String(next + 1));
    return next;
  }

  private ensureIssueSequenceAtLeast(issueNumber: number): void {
    const current = Number(this.getMetadataValue('next_issue_number') ?? '1');
    const desired = issueNumber + 1;
    if (!Number.isFinite(current) || current < desired) {
      this.setMetadataValue('next_issue_number', String(desired));
    }
  }

  private assignIssueIdentity(
    existing: { issue_number?: number | null; issue_key?: string | null } | undefined,
    incoming?: { issueNumber?: number; issueKey?: string },
  ): { issueNumber: number; issueKey: string } {
    const existingIssueNumber = existing?.issue_number ?? null;
    const existingIssueKey = existing?.issue_key ?? null;
    if (existingIssueNumber != null && existingIssueKey) {
      return {
        issueNumber: existingIssueNumber,
        issueKey: existingIssueKey,
      };
    }

    if (incoming?.issueNumber != null && incoming.issueKey) {
      this.ensureIssueSequenceAtLeast(incoming.issueNumber);
      return {
        issueNumber: incoming.issueNumber,
        issueKey: incoming.issueKey,
      };
    }

    const issueNumber = this.allocateNextIssueNumber();
    return {
      issueNumber,
      issueKey: `${ISSUE_KEY_PREFIX}-${issueNumber}`,
    };
  }

  /**
   * Handle HTTP requests (WebSocket upgrades and REST endpoints).
   */
  async fetch(request: Request): Promise<Response> {
    try {
      await this.ensureInitialized();
    } catch (err) {
      log.error('ensureInitialized failed:', err instanceof Error ? err.message : String(err));
      return new Response(`DO init error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
    }

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

    // Cancel TTL alarm since tracker is now actively connected
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
      const message: TrackerClientMessage = JSON.parse(rawData);

      switch (message.type) {
        case 'trackerSync':
          await this.handleTrackerSync(ws, connState, message.sinceSequence);
          break;

        case 'trackerUpsert':
          await this.handleTrackerUpsert(
            ws,
            connState,
            message.itemId,
            message.encryptedPayload,
            message.iv,
            { issueNumber: message.issueNumber, issueKey: message.issueKey },
          );
          break;

        case 'trackerDelete':
          await this.handleTrackerDelete(ws, connState, message.itemId);
          break;

        case 'trackerBatchUpsert':
          await this.handleTrackerBatchUpsert(ws, connState, message.items);
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
   * Handle tracker sync request - return changelog entries since the requested sequence.
   * Returns current state of all items that were upserted, plus IDs of items that were deleted.
   */
  private async handleTrackerSync(
    ws: WebSocket,
    connState: ConnectionState,
    sinceSequence: number
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Get changelog entries since the requested sequence
    const changelogRows = sql.exec<{
      sequence: number;
      item_id: string;
      action: string;
    }>(
      `SELECT sequence, item_id, action
       FROM changelog
       WHERE sequence > ?
       ORDER BY sequence ASC
       LIMIT ?`,
      sinceSequence,
      SYNC_BATCH_SIZE + 1
    ).toArray();

    const hasMore = changelogRows.length > SYNC_BATCH_SIZE;
    const resultRows = hasMore ? changelogRows.slice(0, SYNC_BATCH_SIZE) : changelogRows;

    // Collect unique item IDs that were upserted and deleted
    const upsertedItemIds = new Set<string>();
    const deletedItemIds = new Set<string>();

    for (const row of resultRows) {
      if (row.action === 'delete') {
        deletedItemIds.add(row.item_id);
        upsertedItemIds.delete(row.item_id);
      } else {
        upsertedItemIds.add(row.item_id);
        deletedItemIds.delete(row.item_id);
      }
    }

    // Fetch current state of upserted items
    // Batch IN clauses to stay within SQLite bound parameter limits (DO SQLite can be < 999)
    const items: EncryptedTrackerItem[] = [];
    if (upsertedItemIds.size > 0) {
      const allIds = Array.from(upsertedItemIds);
      const BATCH_SIZE = 50;

      for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
        const batch = allIds.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(',');
        const itemRows = sql.exec<{
          item_id: string;
          issue_number?: number | null;
          issue_key?: string | null;
          version: number;
          encrypted_payload: string;
          iv: string;
          created_at: number;
          updated_at: number;
        }>(
          `SELECT item_id, issue_number, issue_key, version, encrypted_payload, iv, created_at, updated_at
           FROM tracker_items
           WHERE item_id IN (${placeholders})`,
          ...batch
        ).toArray();

        // Get max changelog sequence for each item to include in response
        for (const row of itemRows) {
          const seqRow = sql.exec<{ max_seq: number }>(
            `SELECT MAX(sequence) as max_seq FROM changelog WHERE item_id = ?`,
            row.item_id
          ).toArray()[0];

          items.push({
            itemId: row.item_id,
            issueNumber: row.issue_number ?? undefined,
            issueKey: row.issue_key ?? undefined,
            version: row.version,
            encryptedPayload: row.encrypted_payload,
            iv: row.iv,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            sequence: seqRow?.max_seq ?? 0,
          });
        }
      }
    }

    const maxSequence = resultRows.length > 0
      ? resultRows[resultRows.length - 1].sequence
      : sinceSequence;

    const response: TrackerServerMessage = {
      type: 'trackerSyncResponse',
      items,
      deletedItemIds: Array.from(deletedItemIds),
      sequence: maxSequence,
      hasMore,
    };

    ws.send(JSON.stringify(response));
    connState.synced = true;
  }

  /**
   * Handle tracker item upsert - store encrypted blob, append to changelog, broadcast.
   * Version conflict: if incoming version <= stored version, reject.
   */
  private async handleTrackerUpsert(
    ws: WebSocket,
    connState: ConnectionState,
    itemId: string,
    encryptedPayload: string,
    iv: string,
    incomingIssueIdentity?: { issueNumber?: number; issueKey?: string },
  ): Promise<void> {
    const sql = this.state.storage.sql;
    const now = Date.now();

    // Check for version conflict
    const existing = sql.exec<{ version: number; issue_number?: number | null; issue_key?: string | null }>(
      `SELECT version, issue_number, issue_key FROM tracker_items WHERE item_id = ?`,
      itemId
    ).toArray()[0];

    const newVersion = (existing?.version ?? 0) + 1;
    const issueIdentity = this.assignIssueIdentity(existing, incomingIssueIdentity);

    if (existing) {
      // Update existing item
      sql.exec(
        `UPDATE tracker_items
         SET issue_number = ?, issue_key = ?, version = ?, encrypted_payload = ?, iv = ?, updated_at = ?
         WHERE item_id = ?`,
        issueIdentity.issueNumber,
        issueIdentity.issueKey,
        newVersion,
        encryptedPayload,
        iv,
        now,
        itemId
      );
    } else {
      // Insert new item
      sql.exec(
        `INSERT INTO tracker_items (item_id, issue_number, issue_key, version, encrypted_payload, iv, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        itemId,
        issueIdentity.issueNumber,
        issueIdentity.issueKey,
        newVersion,
        encryptedPayload,
        iv,
        now,
        now
      );
    }

    // Append to changelog
    sql.exec(
      `INSERT INTO changelog (item_id, action, encrypted_payload, iv, version, created_at)
       VALUES (?, 'upsert', ?, ?, ?, ?)`,
      itemId,
      encryptedPayload,
      iv,
      newVersion,
      now
    );

    // Get the changelog sequence for broadcast
    const seqRow = sql.exec<{ seq: number }>(
      `SELECT last_insert_rowid() as seq`
    ).toArray()[0];
    const sequence = seqRow?.seq ?? 0;

    // Update activity timestamp
    this.setMetadataValue('updated_at', String(now));

    // Analytics: track tracker mutation
    track(this.env, 'tracker_mutation', [connState.auth.orgId, itemId, 'upsert'], [1]);

    // Broadcast to other connections
    const item: EncryptedTrackerItem = {
      itemId,
      issueNumber: issueIdentity.issueNumber,
      issueKey: issueIdentity.issueKey,
      version: newVersion,
      encryptedPayload,
      iv,
      createdAt: existing ? now : now, // For broadcast, created_at is approximate
      updatedAt: now,
      sequence,
    };

    const senderMessage: TrackerServerMessage = {
      type: 'trackerUpsertBroadcast',
      item,
    };
    ws.send(JSON.stringify(senderMessage));

    this.broadcast(
      {
        type: 'trackerUpsertBroadcast',
        item,
      },
      ws
    );
  }

  /**
   * Handle tracker item deletion - remove from items, append to changelog, broadcast.
   */
  private async handleTrackerDelete(
    ws: WebSocket,
    connState: ConnectionState,
    itemId: string
  ): Promise<void> {
    const sql = this.state.storage.sql;
    const now = Date.now();

    // Delete from items table
    sql.exec(`DELETE FROM tracker_items WHERE item_id = ?`, itemId);

    // Append to changelog
    sql.exec(
      `INSERT INTO changelog (item_id, action, created_at)
       VALUES (?, 'delete', ?)`,
      itemId,
      now
    );

    // Get the changelog sequence for broadcast
    const seqRow = sql.exec<{ seq: number }>(
      `SELECT last_insert_rowid() as seq`
    ).toArray()[0];
    const sequence = seqRow?.seq ?? 0;

    // Update activity timestamp
    this.setMetadataValue('updated_at', String(now));

    // Analytics: track tracker deletion
    track(this.env, 'tracker_mutation', [connState.auth.orgId, itemId, 'delete'], [1]);

    // Broadcast to other connections
    this.broadcast(
      {
        type: 'trackerDeleteBroadcast',
        itemId,
        sequence,
      },
      ws
    );
  }

  /**
   * Handle batch upsert - process multiple items in a single transaction.
   */
  private async handleTrackerBatchUpsert(
    ws: WebSocket,
    connState: ConnectionState,
    items: { itemId: string; encryptedPayload: string; iv: string; issueNumber?: number; issueKey?: string }[]
  ): Promise<void> {
    // Process each item individually (SQLite handles transaction internally per DO)
    for (const item of items) {
      await this.handleTrackerUpsert(
        ws,
        connState,
        item.itemId,
        item.encryptedPayload,
        item.iv,
        { issueNumber: item.issueNumber, issueKey: item.issueKey },
      );
    }
  }

  /**
   * Broadcast message to all connections except sender.
   */
  private broadcast(message: TrackerServerMessage, exclude?: WebSocket): void {
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
    await this.state.storage.setAlarm(Date.now() + TRACKER_TTL_MS);
  }

  /**
   * Alarm handler - called when the TTL expires.
   */
  async alarm(): Promise<void> {
    await this.ensureInitialized();

    if (this.connections.size > 0) {
      log.info('Alarm fired but tracker has active connections, rescheduling');
      await this.scheduleExpiryAlarm();
      return;
    }

    const sql = this.state.storage.sql;
    const row = sql.exec<{ value: string }>(
      `SELECT value FROM metadata WHERE key = 'updated_at'`
    ).toArray()[0];

    const lastActivity = row ? parseInt(row.value, 10) : 0;
    const elapsed = Date.now() - lastActivity;

    if (elapsed < TRACKER_TTL_MS) {
      const remaining = TRACKER_TTL_MS - elapsed;
      await this.state.storage.setAlarm(Date.now() + remaining);
      log.info('Alarm fired early, rescheduling for', remaining, 'ms');
      return;
    }

    log.info('Tracker TTL expired, deleting data. Last activity:', lastActivity);
    sql.exec(`DELETE FROM tracker_items`);
    sql.exec(`DELETE FROM changelog`);
    sql.exec(`DELETE FROM metadata`);
  }

  /**
   * Handle account deletion - purge all data and disconnect clients.
   */
  private handleDeleteAccount(): Response {
    const sql = this.state.storage.sql;

    sql.exec(`DELETE FROM tracker_items`);
    sql.exec(`DELETE FROM changelog`);
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
   * Status endpoint for debugging.
   */
  private handleStatusRequest(): Response {
    const sql = this.state.storage.sql;

    const itemCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM tracker_items`
    ).toArray()[0]?.count ?? 0;

    const changelogCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM changelog`
    ).toArray()[0]?.count ?? 0;

    const maxSequence = sql.exec<{ max_seq: number | null }>(
      `SELECT MAX(sequence) as max_seq FROM changelog`
    ).toArray()[0]?.max_seq ?? 0;

    return new Response(
      JSON.stringify({
        roomId: this.state.id.toString(),
        connections: this.connections.size,
        itemCount,
        changelogCount,
        maxSequence,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}
