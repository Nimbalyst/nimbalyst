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
  EncryptedCreateSessionRequest,
  EncryptedCreateSessionResponse,
  CreateSessionRequestBroadcastMessage,
  CreateSessionResponseBroadcastMessage,
  SessionControlMessage,
  SessionControlBroadcastMessage,
  RegisterPushTokenMessage,
  RequestMobilePushMessage,
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

  // APNs JWT cache - JWTs are valid for 1 hour, we refresh every 50 minutes
  private cachedAPNsJWT: string | null = null;
  private cachedAPNsJWTExpiry: number = 0;
  private cachedAPNsKey: CryptoKey | null = null;

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
    // Note: project_id column stores encrypted value (encrypted_project_id)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS session_index (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_id_iv TEXT,
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
    // Migration: Add project_id_iv column for encrypted project_id
    try {
      sql.exec(`ALTER TABLE session_index ADD COLUMN project_id_iv TEXT`);
    } catch {
      // Column already exists
    }

    // Project index table
    // Note: project_id column stores encrypted value (encrypted_project_id)
    // Note: name column stores encrypted value (encrypted_name)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS project_index (
        project_id TEXT PRIMARY KEY,
        project_id_iv TEXT,
        name TEXT NOT NULL,
        name_iv TEXT,
        path TEXT,
        path_iv TEXT,
        session_count INTEGER DEFAULT 0,
        last_activity_at INTEGER,
        sync_enabled INTEGER DEFAULT 1
      );
    `);

    // Migration: Add IV columns for project_index
    try {
      sql.exec(`ALTER TABLE project_index ADD COLUMN project_id_iv TEXT`);
    } catch {
      // Column already exists
    }
    try {
      sql.exec(`ALTER TABLE project_index ADD COLUMN name_iv TEXT`);
    } catch {
      // Column already exists
    }
    try {
      sql.exec(`ALTER TABLE project_index ADD COLUMN path_iv TEXT`);
    } catch {
      // Column already exists
    }

    // Migration: Delete old unencrypted sessions and projects
    // Old data has NULL project_id_iv (encrypted data always has an IV)
    // First, get the session IDs so we can clean up their SessionRooms
    const oldSessions = sql.exec<{ session_id: string }>(
      `SELECT session_id FROM session_index WHERE project_id_iv IS NULL`
    ).toArray();

    // Trigger cleanup of old SessionRooms by calling them (this triggers their initialization)
    for (const { session_id } of oldSessions) {
      try {
        const sessionRoomId = this.env.SESSION_ROOM.idFromName(session_id);
        const sessionRoom = this.env.SESSION_ROOM.get(sessionRoomId);
        // Just fetch status to trigger initialization, which will clean up old data
        await sessionRoom.fetch(new Request('https://dummy/status'));
      } catch (err) {
        log.error('Failed to clean up old session room:', session_id, err);
      }
    }

    // Now delete from index
    sql.exec(`DELETE FROM session_index WHERE project_id_iv IS NULL`);
    sql.exec(`DELETE FROM project_index WHERE project_id_iv IS NULL`);

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

        case 'create_session_request':
          await this.handleCreateSessionRequest(ws, connState, message.request);
          break;

        case 'create_session_response':
          await this.handleCreateSessionResponse(ws, connState, message.response);
          break;

        case 'session_control':
          await this.handleSessionControl(ws, connState, message.message);
          break;

        case 'register_push_token':
          await this.handleRegisterPushToken(connState, message);
          break;

        case 'request_mobile_push':
          await this.handleRequestMobilePush(connState, message);
          break;

        case 'ping':
          // Keep-alive ping, respond with pong
          ws.send(JSON.stringify({ type: 'pong' }));
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

    // Upsert session - titles and project_ids are always encrypted
    sql.exec(
      `INSERT OR REPLACE INTO session_index
       (session_id, project_id, project_id_iv, encrypted_title, title_iv, provider, model, mode, message_count, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.session_id,
      session.encrypted_project_id,
      session.project_id_iv,
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

    // Update project stats (and broadcast if new project)
    // Pass encrypted_project_id as the opaque key for matching
    await this.updateProjectStats(session.encrypted_project_id, session.project_id_iv, ws);

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

    // Track affected projects with their IVs for stats update
    const affectedProjectIvs = new Map<string, string>();

    // Use Durable Objects transaction API for atomic batch update
    this.state.storage.transactionSync(() => {
      for (const session of sessions) {
        sql.exec(
          `INSERT OR REPLACE INTO session_index
           (session_id, project_id, project_id_iv, encrypted_title, title_iv, provider, model, mode, message_count, last_message_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          session.session_id,
          session.encrypted_project_id,
          session.project_id_iv,
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
        affectedProjects.add(session.encrypted_project_id);
        affectedProjectIvs.set(session.encrypted_project_id, session.project_id_iv);
      }
    });
    log.debug('Batch update committed successfully');

    // Update project stats for all affected projects (and broadcast if new projects)
    for (const encryptedProjectId of affectedProjects) {
      const projectIdIv = affectedProjectIvs.get(encryptedProjectId)!;
      await this.updateProjectStats(encryptedProjectId, projectIdIv, ws);
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

    // Get the encrypted project ID before deleting (needed for stats update)
    const session = sql.exec<{ project_id: string; project_id_iv: string }>(
      `SELECT project_id, project_id_iv FROM session_index WHERE session_id = ?`,
      sessionId
    ).toArray()[0];

    if (!session) {
      // Session not found in index, nothing to delete
      // console.log('[IndexRoom] Session not found for deletion:', sessionId);
      return;
    }

    // Delete from index
    sql.exec(`DELETE FROM session_index WHERE session_id = ?`, sessionId);

    // Update project stats (no broadcast needed for deletion - project already exists)
    await this.updateProjectStats(session.project_id, session.project_id_iv, ws);

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
   * Handle session creation request from mobile - broadcast to desktop clients
   */
  private async handleCreateSessionRequest(
    ws: WebSocket,
    connState: ConnectionState,
    request: EncryptedCreateSessionRequest
  ): Promise<void> {
    log.debug('Received create_session_request:', request.request_id);

    // Broadcast the request to all other connections (desktop will pick it up)
    const broadcastMessage: CreateSessionRequestBroadcastMessage = {
      type: 'create_session_request_broadcast',
      request,
      from_connection_id: this.getConnectionId(ws),
    };
    this.broadcast(broadcastMessage, ws);

    log.debug('Broadcast create_session_request to', this.connections.size - 1, 'other connections');
  }

  /**
   * Handle session creation response from desktop - broadcast to mobile clients
   */
  private async handleCreateSessionResponse(
    ws: WebSocket,
    connState: ConnectionState,
    response: EncryptedCreateSessionResponse
  ): Promise<void> {
    log.debug('Received create_session_response:', response.request_id, 'success:', response.success);

    // Broadcast the response to all other connections (mobile will pick it up)
    const broadcastMessage: CreateSessionResponseBroadcastMessage = {
      type: 'create_session_response_broadcast',
      response,
      from_connection_id: this.getConnectionId(ws),
    };
    this.broadcast(broadcastMessage, ws);

    log.debug('Broadcast create_session_response to', this.connections.size - 1, 'other connections');
  }

  /**
   * Handle generic session control message - just broadcast to other devices
   */
  private async handleSessionControl(
    ws: WebSocket,
    connState: ConnectionState,
    message: SessionControlMessage
  ): Promise<void> {
    log.debug('Received session_control:', message.session_id, message.message_type);

    // Just broadcast - we don't interpret the message
    const broadcastMessage: SessionControlBroadcastMessage = {
      type: 'session_control_broadcast',
      message,
      from_connection_id: this.getConnectionId(ws),
    };
    this.broadcast(broadcastMessage, ws);

    log.debug('Broadcast session_control to', this.connections.size - 1, 'other connections');
  }

  /**
   * Handle push token registration from mobile devices
   */
  private async handleRegisterPushToken(
    connState: ConnectionState,
    message: RegisterPushTokenMessage
  ): Promise<void> {
    console.log('[IndexRoom] Registering push token for device:', message.device_id, 'platform:', message.platform);
    console.log('[IndexRoom] Token (first 20 chars):', message.token.substring(0, 20) + '...');

    // Store the token in DO storage
    const key = `push_token:${message.device_id}`;
    const value = {
      token: message.token,
      platform: message.platform,
      device_id: message.device_id,
      registered_at: Date.now(),
    };

    await this.state.storage.put(key, value);
    console.log('[IndexRoom] Push token stored with key:', key);

    // Verify it was stored
    const stored = await this.state.storage.get(key);
    console.log('[IndexRoom] Verified stored token:', stored ? 'exists' : 'NOT FOUND');
  }

  /**
   * Handle request to send push notification to mobile devices
   * Called by desktop when an agent completes a turn
   */
  private async handleRequestMobilePush(
    connState: ConnectionState,
    message: RequestMobilePushMessage
  ): Promise<void> {
    console.log('[IndexRoom] Received push request for session:', message.session_id);

    // TODO: Re-enable presence-aware suppression once basic push is working reliably
    // For now, always send push notifications to debug delivery issues
    // const devices = this.getConnectedDevices();
    // const desktop = devices.find(d => d.type === 'desktop');
    // if (desktop) {
    //   const isDesktopActive = desktop.status === 'active' ||
    //     (desktop.is_focused && Date.now() - (desktop.last_active_at || 0) < 5 * 60 * 1000);
    //   if (isDesktopActive) {
    //     log.debug('Suppressing push notification - desktop is active');
    //     return;
    //   }
    // }

    // Get all registered push tokens for mobile devices
    const pushTokens = await this.state.storage.list<{
      token: string;
      platform: 'ios' | 'android';
      device_id: string;
      registered_at: number;
    }>({ prefix: 'push_token:' });

    console.log('[IndexRoom] Found push tokens:', pushTokens.size);

    if (pushTokens.size === 0) {
      console.log('[IndexRoom] No push tokens registered, skipping notification');
      return;
    }

    // Send push to each registered device
    for (const [key, tokenData] of pushTokens) {
      console.log('[IndexRoom] Sending push to device:', tokenData.device_id, 'platform:', tokenData.platform);
      if (tokenData.platform === 'ios') {
        const result = await this.sendAPNsPush(tokenData.token, {
          title: message.title,
          body: message.body,
          sessionId: message.session_id,
        });
        console.log('[IndexRoom] APNs push result:', result);
      }
      // TODO: Add FCM support for Android
    }
  }

  /**
   * Send a push notification via APNs
   */
  private async sendAPNsPush(
    deviceToken: string,
    payload: { title: string; body: string; sessionId: string }
  ): Promise<boolean> {
    const env = this.env as Env;

    // Check if APNs is configured
    if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) {
      console.log('[IndexRoom] APNs not configured, skipping push');
      return false;
    }

    console.log('[IndexRoom] APNs configured, generating JWT...');

    try {
      // Generate JWT for APNs authentication
      const jwt = await this.generateAPNsJWT(env.APNS_KEY, env.APNS_KEY_ID, env.APNS_TEAM_ID);
      console.log('[IndexRoom] JWT generated, sending to APNs...');

      // Determine APNs endpoint (production vs sandbox)
      const apnsHost = env.APNS_SANDBOX === 'true'
        ? 'api.sandbox.push.apple.com'
        : 'api.push.apple.com';

      console.log('[IndexRoom] Using APNs host:', apnsHost);

      // APNs requires lowercase hex device token
      const normalizedToken = deviceToken.toLowerCase();
      console.log('[IndexRoom] Token length:', normalizedToken.length, 'first 20:', normalizedToken.substring(0, 20));

      const response = await fetch(
        `https://${apnsHost}/3/device/${normalizedToken}`,
        {
          method: 'POST',
          headers: {
            'authorization': `bearer ${jwt}`,
            'apns-topic': env.APNS_BUNDLE_ID || 'com.nimbalyst.app',
            'apns-push-type': 'alert',
            'apns-priority': '10',
          },
          body: JSON.stringify({
            aps: {
              alert: {
                title: payload.title,
                body: payload.body,
              },
              sound: 'default',
            },
            sessionId: payload.sessionId,
          }),
        }
      );

      if (response.ok) {
        console.log('[IndexRoom] APNs push sent successfully');
        return true;
      } else {
        const errorBody = await response.text();
        console.error('[IndexRoom] APNs push failed:', response.status, errorBody);
        return false;
      }
    } catch (error) {
      console.error('[IndexRoom] APNs push error:', error);
      return false;
    }
  }

  /**
   * Generate a JWT for APNs authentication (with caching)
   * Uses ES256 algorithm as required by APNs
   * JWTs are valid for 1 hour, we cache for 50 minutes
   */
  private async generateAPNsJWT(
    privateKeyBase64: string,
    keyId: string,
    teamId: string
  ): Promise<string> {
    const now = Date.now();

    // Return cached JWT if still valid (50 minute cache)
    if (this.cachedAPNsJWT && now < this.cachedAPNsJWTExpiry) {
      return this.cachedAPNsJWT;
    }

    // Get or create cached private key
    if (!this.cachedAPNsKey) {
      const privateKeyPem = atob(privateKeyBase64);
      this.cachedAPNsKey = await crypto.subtle.importKey(
        'pkcs8',
        this.pemToArrayBuffer(privateKeyPem),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
      );
    }

    // Create JWT header and payload
    const header = { alg: 'ES256', kid: keyId };
    const payload = {
      iss: teamId,
      iat: Math.floor(now / 1000),
    };

    // Encode header and payload
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with the private key
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.cachedAPNsKey,
      new TextEncoder().encode(signingInput)
    );

    // Convert signature to base64url
    const encodedSignature = this.base64UrlEncode(
      String.fromCharCode(...new Uint8Array(signature))
    );

    const jwt = `${signingInput}.${encodedSignature}`;

    // Cache the JWT for 50 minutes (APNs allows 1 hour)
    this.cachedAPNsJWT = jwt;
    this.cachedAPNsJWTExpiry = now + 50 * 60 * 1000;

    return jwt;
  }

  /**
   * Convert PEM to ArrayBuffer for crypto.subtle.importKey
   */
  private pemToArrayBuffer(pem: string): ArrayBuffer {
    // Remove PEM headers and newlines
    const base64 = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s/g, '');

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Base64 URL encode (RFC 4648)
   */
  private base64UrlEncode(str: string): string {
    return btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
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
   * Broadcasts project updates to all connected clients when a new project is created.
   *
   * @param encryptedProjectId - The encrypted project ID (used as opaque key)
   * @param projectIdIv - The IV for the encrypted project ID
   * @param originatingWs - The WebSocket that originated this update (excluded from broadcast)
   */
  private async updateProjectStats(encryptedProjectId: string, projectIdIv: string, originatingWs?: WebSocket): Promise<void> {
    const sql = this.state.storage.sql;

    // Calculate stats from sessions using encrypted project_id as opaque key
    const stats = sql.exec<{ count: number; last_activity: number | null }>(
      `SELECT COUNT(*) as count, MAX(updated_at) as last_activity
       FROM session_index WHERE project_id = ?`,
      encryptedProjectId
    ).toArray()[0];

    // Check if project exists before upserting
    const existing = sql.exec<ProjectIndexRow>(
      `SELECT * FROM project_index WHERE project_id = ?`,
      encryptedProjectId
    ).toArray()[0];

    const isNewProject = !existing;

    if (existing) {
      sql.exec(
        `UPDATE project_index SET session_count = ?, last_activity_at = ? WHERE project_id = ?`,
        stats?.count ?? 0,
        stats?.last_activity ?? Date.now(),
        encryptedProjectId
      );
    } else {
      // Create project entry - name will be encrypted same as project_id
      // The server stores encrypted values opaquely, clients decrypt
      // Use the encrypted project_id as both the key and as a placeholder for name
      // (clients will provide proper encrypted name in subsequent updates)
      sql.exec(
        `INSERT INTO project_index (project_id, project_id_iv, name, name_iv, session_count, last_activity_at, sync_enabled)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        encryptedProjectId,
        projectIdIv,
        encryptedProjectId, // Use encrypted project_id as placeholder for encrypted name
        projectIdIv, // Use same IV as placeholder (will be updated by client)
        stats?.count ?? 0,
        stats?.last_activity ?? Date.now()
      );
    }

    // Broadcast project update to all connected clients when a new project is created
    // This ensures mobile clients see new projects immediately
    if (isNewProject) {
      const updatedProject = sql.exec<ProjectIndexRow>(
        `SELECT * FROM project_index WHERE project_id = ?`,
        encryptedProjectId
      ).toArray()[0];

      if (updatedProject) {
        const projectEntry = rowToProjectEntry(updatedProject);
        this.broadcast(
          {
            type: 'project_broadcast',
            project: projectEntry,
            from_connection_id: originatingWs ? this.getConnectionId(originatingWs) : undefined,
          },
          originatingWs
        );
        log.debug('Broadcast new project');
      }
    }
  }

  /**
   * Bulk update session index (for initial sync from desktop)
   */
  async bulkUpdateIndex(sessions: SessionIndexEntry[]): Promise<void> {
    await this.ensureInitialized();
    const sql = this.state.storage.sql;

    // Track affected projects with their IVs
    const affectedProjectIvs = new Map<string, string>();

    // Use a transaction for bulk insert
    sql.exec('BEGIN TRANSACTION');
    try {
      for (const session of sessions) {
        sql.exec(
          `INSERT OR REPLACE INTO session_index
           (session_id, project_id, project_id_iv, encrypted_title, title_iv, provider, model, mode, message_count, last_message_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          session.session_id,
          session.encrypted_project_id,
          session.project_id_iv,
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
        affectedProjectIvs.set(session.encrypted_project_id, session.project_id_iv);
      }
      sql.exec('COMMIT');
    } catch (err) {
      sql.exec('ROLLBACK');
      throw err;
    }

    // Update all affected project stats
    for (const [encryptedProjectId, projectIdIv] of affectedProjectIvs) {
      await this.updateProjectStats(encryptedProjectId, projectIdIv);
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
  project_id: string; // Stores encrypted_project_id
  project_id_iv: string | null;
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
  project_id: string; // Stores encrypted_project_id
  project_id_iv: string | null;
  name: string; // Stores encrypted_name
  name_iv: string | null;
  path: string | null; // Stores encrypted_path
  path_iv: string | null;
  session_count: number;
  last_activity_at: number | null;
  sync_enabled: number;
};

function rowToSessionEntry(row: SessionIndexRow): SessionIndexEntry {
  return {
    session_id: row.session_id,
    // Pass through encrypted project_id - clients decrypt as needed
    encrypted_project_id: row.project_id,
    project_id_iv: row.project_id_iv ?? '',
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
    // Pass through encrypted values - clients decrypt as needed
    encrypted_project_id: row.project_id,
    project_id_iv: row.project_id_iv ?? '',
    encrypted_name: row.name,
    name_iv: row.name_iv ?? '',
    encrypted_path: row.path ?? undefined,
    path_iv: row.path_iv ?? undefined,
    session_count: row.session_count,
    last_activity_at: row.last_activity_at ?? 0,
    sync_enabled: row.sync_enabled === 1,
  };
}
