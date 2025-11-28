/**
 * YjsSyncObject Durable Object
 *
 * Manages in-memory Y.Doc state, WebSocket connections, and D1 persistence.
 * Uses WebSocket hibernation for cost optimization.
 */

import * as Y from 'yjs';
import type { Env, ClientInfo, PersistenceConfig } from './types';
import {
  handleSyncMessage,
  encodeDocumentState,
  createDoc,
  getDocumentSize,
  createSyncStep1Message,
} from './protocol';
import {
  loadSnapshot,
  saveSnapshot,
  shouldSnapshot,
  DEFAULT_PERSISTENCE_CONFIG,
  incrementDeviceCount,
  decrementDeviceCount,
} from './persistence';

export class YjsSyncObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  // In-memory Y.Doc
  private ydoc: Y.Doc;

  // Connected WebSocket clients
  private clients: Map<WebSocket, ClientInfo>;

  // Persistence tracking
  private dirty: boolean;
  private lastSnapshotTime: number;
  private config: PersistenceConfig;

  // Document identity (extracted from DO ID)
  private userId: string | null = null;
  private sessionId: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.ydoc = new Y.Doc();
    this.clients = new Map();
    this.dirty = false;
    this.lastSnapshotTime = Date.now();
    this.config = DEFAULT_PERSISTENCE_CONFIG;

    // Load state from D1 on creation
    this.state.blockConcurrencyWhile(async () => {
      await this.loadFromD1();
    });

    // Enable WebSocket auto-response for ping/pong during hibernation
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: 'ping' }),
        JSON.stringify({ type: 'pong' })
      )
    );
  }

  /**
   * Handle incoming HTTP/WebSocket requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // Handle REST endpoints for debugging/management
    if (url.pathname.endsWith('/status')) {
      return this.handleStatusRequest();
    }

    if (url.pathname.endsWith('/snapshot') && request.method === 'POST') {
      return this.handleForceSnapshot();
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  /**
   * Handle WebSocket upgrade request
   */
  private handleWebSocketUpgrade(request: Request): Response {
    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Extract user context from headers (set by Worker router)
    const userId = request.headers.get('X-User-Id');
    const sessionId = request.headers.get('X-Session-Id');

    // Store document identity
    if (!this.userId && userId) this.userId = userId;
    if (!this.sessionId && sessionId) this.sessionId = sessionId;

    // Accept WebSocket with hibernation support
    this.state.acceptWebSocket(server);

    // Store client info
    this.clients.set(server, {
      userId,
      sessionId,
      synced: false,
      connectedAt: Date.now(),
    });

    // Track device count
    if (sessionId) {
      incrementDeviceCount(this.env.DB, sessionId).catch(console.error);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle incoming WebSocket message
   */
  async webSocketMessage(
    ws: WebSocket,
    message: ArrayBuffer | string
  ): Promise<void> {
    // Handle JSON control messages (ping/pong, etc.)
    if (typeof message === 'string') {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore invalid JSON
      }
      return;
    }

    // Handle binary Y.js protocol messages
    const data = new Uint8Array(message);
    const result = handleSyncMessage(this.ydoc, data);

    // Send response to this client
    if (result.response) {
      ws.send(result.response);

      // Mark client as synced after we send SyncStep2
      const clientInfo = this.clients.get(ws);
      if (clientInfo && !clientInfo.synced) {
        clientInfo.synced = true;
      }
    }

    // Broadcast to other clients
    if (result.broadcast) {
      this.broadcastToOthers(ws, result.broadcast);
    }

    // Track dirty state
    if (result.dirty) {
      this.dirty = true;

      // Check if we should snapshot
      const docSize = getDocumentSize(this.ydoc);
      if (shouldSnapshot(this.lastSnapshotTime, docSize, this.config)) {
        await this.snapshotToD1();
      }
    }
  }

  /**
   * Handle WebSocket connection close
   */
  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    const clientInfo = this.clients.get(ws);
    this.clients.delete(ws);

    // Track device count
    if (clientInfo?.sessionId) {
      decrementDeviceCount(this.env.DB, clientInfo.sessionId).catch(
        console.error
      );
    }

    // If no more clients and dirty, snapshot before potential hibernation
    if (this.clients.size === 0 && this.dirty) {
      await this.snapshotToD1();
    }
  }

  /**
   * Handle WebSocket error
   */
  webSocketError(ws: WebSocket, error: unknown): void {
    console.error('WebSocket error:', error);
    this.clients.delete(ws);
  }

  /**
   * Alarm handler - called before hibernation timeout
   * Used to ensure state is persisted before DO hibernates
   */
  async alarm(): Promise<void> {
    if (this.dirty) {
      await this.snapshotToD1();
    }
  }

  /**
   * Load document state from D1 on startup
   */
  private async loadFromD1(): Promise<void> {
    const documentId = this.state.id.toString();

    try {
      const existingState = await loadSnapshot(this.env.DB, documentId);
      if (existingState) {
        this.ydoc = createDoc(existingState);
        console.log(`Loaded snapshot for ${documentId}, size: ${existingState.length} bytes`);
      }
    } catch (error) {
      console.error('Failed to load from D1:', error);
    }

    this.lastSnapshotTime = Date.now();
  }

  /**
   * Save document state to D1
   */
  private async snapshotToD1(): Promise<void> {
    if (!this.userId || !this.sessionId) {
      console.warn('Cannot snapshot: missing userId or sessionId');
      return;
    }

    const documentId = this.state.id.toString();
    const stateVector = encodeDocumentState(this.ydoc);

    try {
      await saveSnapshot(
        this.env.DB,
        documentId,
        this.userId,
        this.sessionId,
        stateVector
      );

      this.dirty = false;
      this.lastSnapshotTime = Date.now();
      console.log(`Saved snapshot for ${documentId}, size: ${stateVector.length} bytes`);
    } catch (error) {
      console.error('Failed to save to D1:', error);
    }
  }

  /**
   * Broadcast a message to all clients except the sender
   */
  private broadcastToOthers(sender: WebSocket, message: Uint8Array): void {
    for (const [client, info] of this.clients) {
      if (client !== sender && info.synced) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Broadcast error:', error);
          this.clients.delete(client);
        }
      }
    }
  }

  /**
   * Handle status request (for debugging)
   */
  private handleStatusRequest(): Response {
    const docSize = getDocumentSize(this.ydoc);

    return new Response(
      JSON.stringify({
        documentId: this.state.id.toString(),
        userId: this.userId,
        sessionId: this.sessionId,
        connectedClients: this.clients.size,
        documentSizeBytes: docSize,
        dirty: this.dirty,
        lastSnapshotTime: this.lastSnapshotTime,
        timeSinceSnapshot: Date.now() - this.lastSnapshotTime,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Force an immediate snapshot (for debugging/testing)
   */
  private async handleForceSnapshot(): Promise<Response> {
    await this.snapshotToD1();

    return new Response(
      JSON.stringify({
        success: true,
        snapshotTime: this.lastSnapshotTime,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
