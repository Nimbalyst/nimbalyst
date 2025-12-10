/**
 * IndexRoom Durable Object
 *
 * Manages the session index for a user - provides fast session list
 * on mobile startup and broadcasts index updates across devices.
 */

import type {
  Env,
  ClientMessage,
  ServerMessage,
  SessionIndexEntry,
  ProjectIndexEntry,
  IndexSyncResponseMessage,
  AuthContext,
  DeviceInfo,
  DevicesListMessage,
  DeviceJoinedMessage,
  DeviceLeftMessage,
} from './types';
import { createLogger } from './logger';

const log = createLogger('IndexRoom');

interface ConnectionState {
  auth: AuthContext;
  synced: boolean;
  device?: DeviceInfo;
}

// WebSocket tag prefixes for hibernation recovery
const TAG_USER = 'user:';
const TAG_DEVICE = 'device:';

export class IndexRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  // Note: This map is rebuilt after hibernation using getWebSockets() and tags
  private connections: Map<WebSocket, ConnectionState> = new Map();
  private initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Restore connections from hibernation
    this.restoreConnectionsFromHibernation();
  }

  /**
   * Restore connection state from WebSocket tags after hibernation
   * Note: Device info is NOT restored here because we can't map WebSockets to device IDs.
   * Clients will need to re-announce their device after reconnection.
   */
  private restoreConnectionsFromHibernation(): void {
    const webSockets = this.state.getWebSockets();
    for (const ws of webSockets) {
      const tags = this.state.getTags(ws);
      const userTag = tags.find(t => t.startsWith(TAG_USER));

      if (userTag) {
        const userId = userTag.slice(TAG_USER.length);

        // After hibernation, connections are restored but device info is lost
        // Clients will re-announce when they detect the connection is still open
        this.connections.set(ws, {
          auth: { user_id: userId },
          synced: true,
          device: undefined, // Will be set when client re-announces
        });
      }
    }
    // if (webSockets.length > 0) {
    //   console.log(`[IndexRoom] Restored ${webSockets.length} connections from hibernation (devices will re-announce)`);
    // }
  }

  /**
   * Initialize SQLite schema on first access
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const sql = this.state.storage.sql;

    // Session index table
    sql.exec(`
      CREATE TABLE IF NOT EXISTS session_index (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT,
        encrypted_title TEXT,
        title_iv TEXT,
        provider TEXT,
        model TEXT,
        mode TEXT,
        message_count INTEGER DEFAULT 0,
        last_message_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_project ON session_index(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_updated ON session_index(updated_at DESC);
    `);

    // Migration: Add encrypted title columns if they don't exist (for existing databases)
    try {
      sql.exec(`ALTER TABLE session_index ADD COLUMN encrypted_title TEXT`);
    } catch {
      // Column already exists
    }
    try {
      sql.exec(`ALTER TABLE session_index ADD COLUMN title_iv TEXT`);
    } catch {
      // Column already exists
    }

    // Project index table
    sql.exec(`
      CREATE TABLE IF NOT EXISTS project_index (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        session_count INTEGER DEFAULT 0,
        last_activity_at INTEGER,
        sync_enabled INTEGER DEFAULT 1
      );
    `);

    this.initialized = true;
  }

  /**
   * Handle HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // REST endpoints
    if (url.pathname.endsWith('/status')) {
      return await this.handleStatusRequest();
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  /**
   * Upgrade HTTP to WebSocket
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const auth = this.parseAuth(request);
    if (!auth) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with hibernation support, storing auth in tags for recovery
    this.state.acceptWebSocket(server, [`${TAG_USER}${auth.user_id}`]);

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
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const [userId] = authHeader.slice(7).split(':');
      if (userId) {
        return { user_id: userId };
      }
    }

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
      const message: ClientMessage = JSON.parse(
        typeof data === 'string' ? data : new TextDecoder().decode(data)
      );

      switch (message.type) {
        case 'index_sync_request':
          await this.handleIndexSyncRequest(ws, connState, message.project_id);
          break;

        case 'index_update':
          await this.handleIndexUpdate(ws, connState, message.session);
          break;

        case 'index_batch_update':
          await this.handleIndexBatchUpdate(ws, connState, message.sessions);
          break;

        case 'index_delete':
          await this.handleIndexDelete(ws, connState, message.session_id);
          break;

        case 'device_announce':
          await this.handleDeviceAnnounce(ws, connState, message.device);
          break;

        default:
          this.sendError(ws, 'unknown_message_type', `Unknown message type`);
      }
    } catch (err) {
      console.error('[IndexRoom] Error handling message:', err);
      console.error('[IndexRoom] Data type:', typeof data, 'length:', typeof data === 'string' ? data.length : (data as ArrayBuffer).byteLength);
      if (typeof data === 'string' && data.length < 500) {
        console.error('[IndexRoom] Data:', data);
      } else if (typeof data === 'string') {
        console.error('[IndexRoom] Data (first 500 chars):', data.substring(0, 500));
      }
      this.sendError(ws, 'parse_error', 'Failed to parse message');
    }
  }

  /**
   * Handle index sync request - return session and project lists
   */
  private async handleIndexSyncRequest(
    ws: WebSocket,
    connState: ConnectionState,
    projectId?: string
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Get sessions (optionally filtered by project)
    let sessions: SessionIndexEntry[];
    if (projectId) {
      const rows = sql.exec<SessionIndexRow>(
        `SELECT * FROM session_index WHERE project_id = ? ORDER BY updated_at DESC`,
        projectId
      ).toArray();
      sessions = rows.map(rowToSessionEntry);
    } else {
      const rows = sql.exec<SessionIndexRow>(
        `SELECT * FROM session_index ORDER BY updated_at DESC`
      ).toArray();
      sessions = rows.map(rowToSessionEntry);
    }

    // Get projects
    const projectRows = sql.exec<ProjectIndexRow>(
      `SELECT * FROM project_index ORDER BY last_activity_at DESC`
    ).toArray();
    const projects = projectRows.map(rowToProjectEntry);

    const response: IndexSyncResponseMessage = {
      type: 'index_sync_response',
      sessions,
      projects,
    };

    ws.send(JSON.stringify(response));
    connState.synced = true;
  }

  /**
   * Handle index update from desktop
   */
  private async handleIndexUpdate(
    ws: WebSocket,
    connState: ConnectionState,
    session: SessionIndexEntry
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Upsert session - titles are always encrypted
    sql.exec(
      `INSERT OR REPLACE INTO session_index
       (session_id, project_id, encrypted_title, title_iv, provider, model, mode, message_count, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.session_id,
      session.project_id,
      session.encrypted_title ?? null,
      session.title_iv ?? null,
      session.provider,
      session.model ?? null,
      session.mode ?? null,
      session.message_count,
      session.last_message_at,
      session.created_at,
      session.updated_at
    );

    // Update project stats
    await this.updateProjectStats(session.project_id);

    // Broadcast to other connections
    this.broadcast(
      {
        type: 'index_broadcast',
        session,
        from_connection_id: this.getConnectionId(ws),
      },
      ws
    );
  }

  /**
   * Handle batch index update from desktop (efficient bulk sync)
   */
  private async handleIndexBatchUpdate(
    ws: WebSocket,
    connState: ConnectionState,
    sessions: SessionIndexEntry[]
  ): Promise<void> {
    log.debug('handleIndexBatchUpdate called with', sessions.length, 'sessions');
    const sql = this.state.storage.sql;
    const affectedProjects = new Set<string>();

    // Use Durable Objects transaction API for atomic batch update
    this.state.storage.transactionSync(() => {
      for (const session of sessions) {
        sql.exec(
          `INSERT OR REPLACE INTO session_index
           (session_id, project_id, encrypted_title, title_iv, provider, model, mode, message_count, last_message_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          session.session_id,
          session.project_id,
          session.encrypted_title ?? null,
          session.title_iv ?? null,
          session.provider,
          session.model ?? null,
          session.mode ?? null,
          session.message_count,
          session.last_message_at,
          session.created_at,
          session.updated_at
        );
        affectedProjects.add(session.project_id);
      }
    });
    log.debug('Batch update committed successfully');

    // Update project stats for all affected projects
    for (const projectId of affectedProjects) {
      await this.updateProjectStats(projectId);
    }

    // Broadcast each session update to other connections
    // (They may want to update their local state)
    const connectionId = this.getConnectionId(ws);
    for (const session of sessions) {
      this.broadcast(
        {
          type: 'index_broadcast',
          session,
          from_connection_id: connectionId,
        },
        ws
      );
    }

    // console.log('[IndexRoom] Batch update complete:', sessions.length, 'sessions,', affectedProjects.size, 'projects');
  }

  /**
   * Handle session deletion from index
   */
  private async handleIndexDelete(
    ws: WebSocket,
    connState: ConnectionState,
    sessionId: string
  ): Promise<void> {
    const sql = this.state.storage.sql;

    // Get the project ID before deleting (needed for stats update)
    const session = sql.exec<{ project_id: string }>(
      `SELECT project_id FROM session_index WHERE session_id = ?`,
      sessionId
    ).toArray()[0];

    if (!session) {
      // Session not found in index, nothing to delete
      // console.log('[IndexRoom] Session not found for deletion:', sessionId);
      return;
    }

    // Delete from index
    sql.exec(`DELETE FROM session_index WHERE session_id = ?`, sessionId);

    // Update project stats
    await this.updateProjectStats(session.project_id);

    // Broadcast deletion to other connections
    this.broadcast(
      {
        type: 'index_delete_broadcast',
        session_id: sessionId,
        from_connection_id: this.getConnectionId(ws),
      },
      ws
    );

    // console.log('[IndexRoom] Deleted session from index:', sessionId);
  }

  /**
   * Handle device announce - register device and broadcast to others
   */
  private async handleDeviceAnnounce(
    ws: WebSocket,
    connState: ConnectionState,
    device: DeviceInfo
  ): Promise<void> {
    // Update connection state with device info
    connState.device = device;

    // Store device info in DO storage for hibernation recovery
    // Key by device_id so it persists across reconnections
    await this.state.storage.put(`device:${device.device_id}`, device);

    // console.log('[IndexRoom] Device announced:', device.name, device.type, device.platform);

    // Send current devices list to the connecting client
    const devicesList = this.getConnectedDevices();
    const listMessage: DevicesListMessage = {
      type: 'devices_list',
      devices: devicesList,
    };
    ws.send(JSON.stringify(listMessage));

    // Broadcast device joined to other connections
    const joinedMessage: DeviceJoinedMessage = {
      type: 'device_joined',
      device,
    };
    this.broadcast(joinedMessage, ws);
  }

  /**
   * Get list of all connected devices
   * Returns devices from active connections that have announced themselves
   */
  private getConnectedDevices(): DeviceInfo[] {
    const devices: DeviceInfo[] = [];
    const seenIds = new Set<string>();

    for (const [, state] of this.connections) {
      if (state.device && !seenIds.has(state.device.device_id)) {
        devices.push(state.device);
        seenIds.add(state.device.device_id);
      }
    }
    return devices;
  }

  /**
   * Update project statistics (session count, last activity)
   */
  private async updateProjectStats(projectId: string): Promise<void> {
    const sql = this.state.storage.sql;

    // Calculate stats from sessions
    const stats = sql.exec<{ count: number; last_activity: number | null }>(
      `SELECT COUNT(*) as count, MAX(updated_at) as last_activity
       FROM session_index WHERE project_id = ?`,
      projectId
    ).toArray()[0];

    // Upsert project with updated stats
    const existing = sql.exec<ProjectIndexRow>(
      `SELECT * FROM project_index WHERE project_id = ?`,
      projectId
    ).toArray()[0];

    if (existing) {
      sql.exec(
        `UPDATE project_index SET session_count = ?, last_activity_at = ? WHERE project_id = ?`,
        stats?.count ?? 0,
        stats?.last_activity ?? Date.now(),
        projectId
      );
    } else {
      // Create project entry with default name (derived from ID)
      const name = projectId.split('/').pop() ?? projectId;
      sql.exec(
        `INSERT INTO project_index (project_id, name, session_count, last_activity_at, sync_enabled)
         VALUES (?, ?, ?, ?, 1)`,
        projectId,
        name,
        stats?.count ?? 0,
        stats?.last_activity ?? Date.now()
      );
    }
  }

  /**
   * Bulk update session index (for initial sync from desktop)
   */
  async bulkUpdateIndex(sessions: SessionIndexEntry[]): Promise<void> {
    await this.ensureInitialized();
    const sql = this.state.storage.sql;

    // Use a transaction for bulk insert
    sql.exec('BEGIN TRANSACTION');
    try {
      for (const session of sessions) {
        sql.exec(
          `INSERT OR REPLACE INTO session_index
           (session_id, project_id, encrypted_title, title_iv, provider, model, mode, message_count, last_message_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          session.session_id,
          session.project_id,
          session.encrypted_title ?? null,
          session.title_iv ?? null,
          session.provider,
          session.model ?? null,
          session.mode ?? null,
          session.message_count,
          session.last_message_at,
          session.created_at,
          session.updated_at
        );
      }
      sql.exec('COMMIT');
    } catch (err) {
      sql.exec('ROLLBACK');
      throw err;
    }

    // Update all affected project stats
    const projectIds = new Set(sessions.map((s) => s.project_id));
    for (const projectId of projectIds) {
      await this.updateProjectStats(projectId);
    }
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
   * Get unique ID for a connection
   */
  private getConnectionId(ws: WebSocket): string {
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
    const connState = this.connections.get(ws);

    // If this connection had device info, broadcast that it left
    if (connState?.device) {
      const leftMessage: DeviceLeftMessage = {
        type: 'device_left',
        device_id: connState.device.device_id,
      };
      this.broadcast(leftMessage, ws);
      // console.log('[IndexRoom] Device disconnected:', connState.device.name);
    }

    this.connections.delete(ws);
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
    const connState = this.connections.get(ws);

    // If this connection had device info, broadcast that it left
    if (connState?.device) {
      const leftMessage: DeviceLeftMessage = {
        type: 'device_left',
        device_id: connState.device.device_id,
      };
      this.broadcast(leftMessage, ws);
    }

    this.connections.delete(ws);
  }

  /**
   * Status endpoint for debugging
   */
  private async handleStatusRequest(): Promise<Response> {
    await this.ensureInitialized();
    const sql = this.state.storage.sql;

    const sessionCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM session_index`
    ).toArray()[0]?.count ?? 0;

    const projectCount = sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM project_index`
    ).toArray()[0]?.count ?? 0;

    return new Response(
      JSON.stringify({
        room_id: this.state.id.toString(),
        connections: this.connections.size,
        session_count: sessionCount,
        project_count: projectCount,
        devices: this.getConnectedDevices(),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ============================================================================
// Helper Types and Functions
// ============================================================================

// Use index signature for Cloudflare SQL compatibility
type SessionIndexRow = {
  [key: string]: SqlStorageValue;
  session_id: string;
  project_id: string;
  title: string | null;
  encrypted_title: string | null;
  title_iv: string | null;
  provider: string | null;
  model: string | null;
  mode: string | null;
  message_count: number;
  last_message_at: number | null;
  created_at: number;
  updated_at: number;
};

type ProjectIndexRow = {
  [key: string]: SqlStorageValue;
  project_id: string;
  name: string;
  path: string | null;
  session_count: number;
  last_activity_at: number | null;
  sync_enabled: number;
};

function rowToSessionEntry(row: SessionIndexRow): SessionIndexEntry {
  return {
    session_id: row.session_id,
    project_id: row.project_id,
    // Pass through encrypted title - clients decrypt as needed
    encrypted_title: row.encrypted_title ?? undefined,
    title_iv: row.title_iv ?? undefined,
    provider: row.provider ?? 'unknown',
    model: row.model ?? undefined,
    mode: (row.mode as SessionIndexEntry['mode']) ?? undefined,
    message_count: row.message_count,
    last_message_at: row.last_message_at ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToProjectEntry(row: ProjectIndexRow): ProjectIndexEntry {
  return {
    project_id: row.project_id,
    name: row.name,
    path: row.path ?? undefined,
    session_count: row.session_count,
    last_activity_at: row.last_activity_at ?? 0,
    sync_enabled: row.sync_enabled === 1,
  };
}
