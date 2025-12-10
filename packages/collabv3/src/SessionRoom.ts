/**
 * SessionRoom Durable Object
 *
 * Manages a single AI session's messages and real-time sync.
 * Uses DO SQLite for message storage (no 2MB BLOB limit).
 */

import type {
  Env,
  ClientMessage,
  ServerMessage,
  EncryptedMessage,
  SessionMetadata,
  SyncResponseMessage,
  AuthContext,
} from './types';
import { createLogger } from './logger';

const log = createLogger('SessionRoom');

interface ConnectionState {
  auth: AuthContext;
  synced: boolean;
}

// WebSocket tag prefixes for hibernation recovery
const TAG_USER = 'user:';

// Message batch size for sync responses
const SYNC_BATCH_SIZE = 100;

export class SessionRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  // Note: This map is rebuilt after hibernation using getWebSockets() and tags
  private connections: Map<WebSocket, ConnectionState> = new Map();
  private initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Restore connections from hibernation
    // getWebSockets() returns all WebSockets that survived hibernation
    this.restoreConnectionsFromHibernation();
  }

  /**
   * Restore connection state from WebSocket tags after hibernation
   */
  private restoreConnectionsFromHibernation(): void {
    const webSockets = this.state.getWebSockets();
    for (const ws of webSockets) {
      const tags = this.state.getTags(ws);
      const userTag = tags.find(t => t.startsWith(TAG_USER));
      if (userTag) {
        const userId = userTag.slice(TAG_USER.length);
        // After hibernation, assume all connections are synced
        // (they completed initial sync before hibernation occurred)
        this.connections.set(ws, {
          auth: { user_id: userId },
          synced: true,
        });
      }
    }
    if (webSockets.length > 0) {
      log.info(`Restored ${webSockets.length} connections from hibernation`);
    }
  }

  /**
   * Initialize SQLite schema on first access
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const sql = this.state.storage.sql;

    // Create messages table
    sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        direction TEXT NOT NULL,
        encrypted_content TEXT NOT NULL,
        iv TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_sequence ON messages(sequence);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    `);

    // Create metadata table (key-value store for session metadata)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.initialized = true;
  }

  /**
   * Handle HTTP requests (WebSocket upgrades and REST endpoints)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // REST endpoints for debugging
    if (url.pathname.endsWith('/status')) {
      return this.handleStatusRequest();
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  /**
   * Upgrade HTTP to WebSocket
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    // Parse auth from query params or headers
    const auth = this.parseAuth(request);
    if (!auth) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with hibernation support, storing auth in tags for recovery
    // Tags persist across hibernation and allow us to restore connection state
    this.state.acceptWebSocket(server, [`${TAG_USER}${auth.user_id}`]);

    // Store connection state in memory (will be restored from tags after hibernation)
    this.connections.set(server, {
      auth,
      synced: false,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Parse auth context from request
   */
  private parseAuth(request: Request): AuthContext | null {
    // Try Authorization header first: "Bearer {userId}:{token}"
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const [userId] = authHeader.slice(7).split(':');
      if (userId) {
        return { user_id: userId };
      }
    }

    // Try query param
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id');
    if (userId) {
      return { user_id: userId };
    }

    return null;
  }

  /**
   * Handle incoming WebSocket message
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
      const message: ClientMessage = JSON.parse(rawData);

      switch (message.type) {
        case 'sync_request':
          await this.handleSyncRequest(ws, connState, message.since_id, message.since_seq);
          break;

        case 'append_message':
          await this.handleAppendMessage(ws, connState, message.message);
          break;

        case 'update_metadata':
          await this.handleUpdateMetadata(ws, connState, message.metadata);
          break;

        case 'delete_session':
          await this.handleDeleteSession(ws, connState);
          break;

        default:
          log.warn('Unknown message type:', (message as { type: string }).type);
          this.sendError(ws, 'unknown_message_type', `Unknown message type`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error('Error handling message:', errorMessage);
      this.sendError(ws, 'parse_error', `Failed to parse message: ${errorMessage}`);
    }
  }

  /**
   * Handle sync request - return messages since cursor
   */
  private async handleSyncRequest(
    ws: WebSocket,
    connState: ConnectionState,
    sinceId?: string,
    sinceSeq?: number
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Build query based on cursor
    let messages: EncryptedMessage[];
    let cursor: string | null = null;

    if (sinceSeq !== undefined) {
      // Cursor-based pagination by sequence
      const rows = sql.exec<{
        id: string;
        sequence: number;
        created_at: number;
        source: string;
        direction: string;
        encrypted_content: string;
        iv: string;
        metadata_json: string | null;
      }>(
        `SELECT * FROM messages WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
        sinceSeq,
        SYNC_BATCH_SIZE + 1
      ).toArray();

      const hasMore = rows.length > SYNC_BATCH_SIZE;
      const resultRows = hasMore ? rows.slice(0, SYNC_BATCH_SIZE) : rows;

      messages = resultRows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        created_at: row.created_at,
        source: row.source as EncryptedMessage['source'],
        direction: row.direction as EncryptedMessage['direction'],
        encrypted_content: row.encrypted_content,
        iv: row.iv,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      }));

      if (hasMore && resultRows.length > 0) {
        cursor = String(resultRows[resultRows.length - 1].sequence);
      }
    } else {
      // Initial sync - get all messages
      const rows = sql.exec<{
        id: string;
        sequence: number;
        created_at: number;
        source: string;
        direction: string;
        encrypted_content: string;
        iv: string;
        metadata_json: string | null;
      }>(
        `SELECT * FROM messages ORDER BY sequence ASC LIMIT ?`,
        SYNC_BATCH_SIZE + 1
      ).toArray();

      const hasMore = rows.length > SYNC_BATCH_SIZE;
      const resultRows = hasMore ? rows.slice(0, SYNC_BATCH_SIZE) : rows;

      messages = resultRows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        created_at: row.created_at,
        source: row.source as EncryptedMessage['source'],
        direction: row.direction as EncryptedMessage['direction'],
        encrypted_content: row.encrypted_content,
        iv: row.iv,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      }));

      if (hasMore && resultRows.length > 0) {
        cursor = String(resultRows[resultRows.length - 1].sequence);
      }
    }

    // Get metadata
    const metadata = this.getMetadata();

    const response: SyncResponseMessage = {
      type: 'sync_response',
      messages,
      metadata,
      has_more: cursor !== null,
      cursor,
    };

    ws.send(JSON.stringify(response));
    connState.synced = true;
    // Note: synced state is not persisted in tags, but after hibernation we assume
    // all restored connections are synced (they wouldn't still be connected otherwise)
  }

  /**
   * Handle append message - store and broadcast
   * Deduplicates by message ID to prevent sync loops from creating duplicates
   */
  private async handleAppendMessage(
    ws: WebSocket,
    connState: ConnectionState,
    message: EncryptedMessage
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Check if message with this ID already exists (deduplication)
    const existing = sql.exec<{ id: string }>(
      `SELECT id FROM messages WHERE id = ?`,
      message.id
    ).toArray();

    if (existing.length > 0) {
      // Message already exists - skip insert, don't broadcast (expected during initial sync)
      return;
    }

    // Get next sequence number
    const maxSeqResult = sql.exec<{ max_seq: number | null }>(
      `SELECT MAX(sequence) as max_seq FROM messages`
    ).toArray();
    const nextSeq = (maxSeqResult[0]?.max_seq ?? 0) + 1;

    // Override sequence with server-assigned value
    const storedMessage: EncryptedMessage = {
      ...message,
      sequence: nextSeq,
    };

    // Insert message
    sql.exec(
      `INSERT INTO messages (id, sequence, created_at, source, direction, encrypted_content, iv, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      storedMessage.id,
      storedMessage.sequence,
      storedMessage.created_at,
      storedMessage.source,
      storedMessage.direction,
      storedMessage.encrypted_content,
      storedMessage.iv,
      JSON.stringify(storedMessage.metadata)
    );

    // Update metadata timestamp
    this.setMetadataValue('updated_at', String(Date.now()));

    // Broadcast to other connections
    this.broadcast(
      {
        type: 'message_broadcast',
        message: storedMessage,
        from_connection_id: this.getConnectionId(ws),
      },
      ws
    );
  }

  /**
   * Handle metadata update
   */
  private async handleUpdateMetadata(
    ws: WebSocket,
    connState: ConnectionState,
    updates: Partial<SessionMetadata>
  ): Promise<void> {
    const now = Date.now();

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        this.setMetadataValue(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }

    this.setMetadataValue('updated_at', String(now));

    // Broadcast to other connections
    this.broadcast(
      {
        type: 'metadata_broadcast',
        metadata: { ...updates, updated_at: now },
        from_connection_id: this.getConnectionId(ws),
      },
      ws
    );
  }

  /**
   * Handle session deletion
   */
  private async handleDeleteSession(
    ws: WebSocket,
    connState: ConnectionState
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Delete all messages
    sql.exec(`DELETE FROM messages`);

    // Mark metadata as deleted
    this.setMetadataValue('deleted', 'true');
    this.setMetadataValue('deleted_at', String(Date.now()));

    // Close all connections
    for (const [conn] of this.connections) {
      conn.close(4002, 'Session deleted');
    }
  }

  /**
   * Get all metadata as object
   */
  private getMetadata(): SessionMetadata | null {
    const sql = this.state.storage.sql;
    const rows = sql.exec<{ key: string; value: string }>(
      `SELECT key, value FROM metadata`
    ).toArray();

    if (rows.length === 0) return null;

    const metadata: Record<string, string> = {};
    for (const row of rows) {
      metadata[row.key] = row.value;
    }

    return {
      title: metadata.title ?? 'Untitled',
      provider: metadata.provider ?? 'unknown',
      model: metadata.model,
      mode: metadata.mode as SessionMetadata['mode'],
      project_id: metadata.project_id ?? 'default',
      created_at: parseInt(metadata.created_at ?? '0', 10),
      updated_at: parseInt(metadata.updated_at ?? '0', 10),
    };
  }

  /**
   * Set a single metadata value
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
   * Broadcast message to all connections except sender
   */
  private broadcast(message: ServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const [ws, state] of this.connections) {
      if (ws !== exclude && state.synced) {
        try {
          ws.send(data);
        } catch (err) {
          console.error('Broadcast error:', err);
          this.connections.delete(ws);
        }
      }
    }
  }

  /**
   * Send error to a single connection
   */
  private sendError(ws: WebSocket, code: string, message: string): void {
    ws.send(JSON.stringify({ type: 'error', code, message }));
  }

  /**
   * Get unique ID for a connection (for dedup on broadcast)
   */
  private getConnectionId(ws: WebSocket): string {
    // Use object identity as a simple ID
    for (const [conn, state] of this.connections) {
      if (conn === ws) {
        return state.auth.user_id + '_' + Date.now();
      }
    }
    return 'unknown';
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    this.connections.delete(ws);
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
    this.connections.delete(ws);
  }

  /**
   * Status endpoint for debugging
   */
  private handleStatusRequest(): Response {
    const sql = this.state.storage.sql;

    const messageCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages`
    ).toArray()[0]?.count ?? 0;

    const metadata = this.getMetadata();

    return new Response(
      JSON.stringify({
        room_id: this.state.id.toString(),
        connections: this.connections.size,
        message_count: messageCount,
        metadata,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}
