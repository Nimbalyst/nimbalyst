/**
 * YjsSyncObject Durable Object
 *
 * Manages in-memory Y.Doc state, WebSocket connections, and D1 persistence.
 * Uses WebSocket hibernation for cost optimization.
 */

import * as Y from 'yjs';
import type { Env, ClientInfo, PersistenceConfig, MemoryConfig } from './types';
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
  DEFAULT_MEMORY_CONFIG,
  incrementDeviceCount,
  decrementDeviceCount,
} from './persistence';

export class YjsSyncObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  // In-memory Y.Doc (may be null if using lazy loading)
  private ydoc: Y.Doc | null = null;

  // Connected WebSocket clients
  private clients: Map<WebSocket, ClientInfo>;

  // Persistence tracking
  private dirty: boolean;
  private lastSnapshotTime: number;
  private config: PersistenceConfig;
  private memoryConfig: MemoryConfig;

  // Document identity (extracted from DO ID)
  private userId: string | null = null;
  private sessionId: string | null = null;

  // Memory management
  private documentLoaded: boolean = false;
  private lastActivityTime: number;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.dirty = false;
    this.lastSnapshotTime = Date.now();
    this.lastActivityTime = Date.now();
    this.config = DEFAULT_PERSISTENCE_CONFIG;
    this.memoryConfig = DEFAULT_MEMORY_CONFIG;

    // Lazy loading: Don't load document until first client connects
    // This saves memory for inactive sessions
    if (!this.memoryConfig.enableLazyLoading) {
      this.state.blockConcurrencyWhile(async () => {
        await this.ensureDocumentLoaded();
      });
    }

    // Enable WebSocket auto-response for ping/pong during hibernation
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: 'ping' }),
        JSON.stringify({ type: 'pong' })
      )
    );

    // Set alarm for document eviction (if no clients)
    this.scheduleEvictionCheck();
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
    // Update activity timestamp
    this.lastActivityTime = Date.now();

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

    // Ensure document is loaded before processing Y.js messages
    await this.ensureDocumentLoaded();

    if (!this.ydoc) {
      console.error('Failed to load document');
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
   * Alarm handler - called periodically for maintenance
   * - Saves dirty documents
   * - Evicts idle documents to free memory
   */
  async alarm(): Promise<void> {
    // Save state if dirty
    if (this.dirty) {
      await this.snapshotToD1();
    }

    // Evict document if no clients and past eviction timeout
    if (this.clients.size === 0 && this.documentLoaded) {
      const idleTime = Date.now() - this.lastActivityTime;
      if (idleTime > this.memoryConfig.evictionTimeoutMs) {
        await this.evictDocument();
      }
    }

    // Schedule next check
    this.scheduleEvictionCheck();
  }

  /**
   * Ensure document is loaded from D1 (lazy loading)
   * Only loads if not already loaded, with size limits
   */
  private async ensureDocumentLoaded(): Promise<void> {
    if (this.documentLoaded && this.ydoc) {
      return; // Already loaded
    }

    const documentId = this.state.id.toString();

    try {
      const existingState = await loadSnapshot(this.env.DB, documentId);

      if (existingState) {
        const sizeInBytes = existingState.length;
        const sizeInMB = sizeInBytes / (1024 * 1024);

        // Check if document exceeds maximum size
        if (sizeInBytes > this.memoryConfig.maxDocumentSizeBytes) {
          console.error(
            `Document ${documentId} exceeds max size: ${sizeInMB.toFixed(2)}MB > ${(this.memoryConfig.maxDocumentSizeBytes / (1024 * 1024)).toFixed(2)}MB`
          );
          // Create empty doc instead of refusing to load
          // This allows new edits but loses history (emergency fallback)
          this.ydoc = new Y.Doc();
          this.documentLoaded = true;
          return;
        }

        // Warn if document is large but under limit
        if (sizeInBytes > this.memoryConfig.warnThresholdBytes) {
          console.warn(
            `Large document ${documentId}: ${sizeInMB.toFixed(2)}MB (warning threshold: ${(this.memoryConfig.warnThresholdBytes / (1024 * 1024)).toFixed(2)}MB)`
          );
        }

        this.ydoc = createDoc(existingState);
        this.documentLoaded = true;
        console.log(`Loaded snapshot for ${documentId}, size: ${sizeInBytes} bytes (${sizeInMB.toFixed(2)}MB)`);
      } else {
        // No existing snapshot - create new document
        this.ydoc = new Y.Doc();
        this.documentLoaded = true;
        console.log(`Created new document for ${documentId}`);
      }
    } catch (error) {
      console.error('Failed to load from D1:', error);
      // Fallback to empty document
      this.ydoc = new Y.Doc();
      this.documentLoaded = true;
    }

    this.lastSnapshotTime = Date.now();
  }

  /**
   * Evict document from memory to free resources
   * Ensures state is saved before eviction
   */
  private async evictDocument(): Promise<void> {
    if (!this.documentLoaded || !this.ydoc) {
      return;
    }

    // Save if dirty before evicting
    if (this.dirty) {
      await this.snapshotToD1();
    }

    const documentId = this.state.id.toString();
    console.log(`Evicting idle document ${documentId} to free memory`);

    // Destroy Y.Doc and clear reference
    this.ydoc.destroy();
    this.ydoc = null;
    this.documentLoaded = false;
  }

  /**
   * Schedule next eviction check alarm
   */
  private scheduleEvictionCheck(): void {
    // Check every minute for idle documents
    const nextCheck = Date.now() + 60 * 1000;
    this.state.storage.setAlarm(nextCheck);
  }

  /**
   * Save document state to D1
   */
  private async snapshotToD1(): Promise<void> {
    if (!this.userId || !this.sessionId) {
      console.warn('Cannot snapshot: missing userId or sessionId');
      return;
    }

    if (!this.ydoc || !this.documentLoaded) {
      console.warn('Cannot snapshot: document not loaded');
      return;
    }

    const documentId = this.state.id.toString();
    const stateVector = encodeDocumentState(this.ydoc);
    const sizeInBytes = stateVector.length;
    const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

    // Log detailed size information BEFORE attempting to save
    console.log(`[SNAPSHOT] Attempting to save snapshot for ${documentId}`);
    console.log(`[SNAPSHOT] Size: ${sizeInBytes} bytes (${sizeInMB}MB)`);
    console.log(`[SNAPSHOT] Session ID: ${this.sessionId}`);
    console.log(`[SNAPSHOT] User ID: ${this.userId}`);

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
      console.log(`[SNAPSHOT] Successfully saved snapshot for ${documentId}, size: ${sizeInBytes} bytes (${sizeInMB}MB)`);
    } catch (error) {
      console.error(`[SNAPSHOT] Failed to save snapshot for ${documentId}:`, error);
      console.error(`[SNAPSHOT] Document size was: ${sizeInBytes} bytes (${sizeInMB}MB)`);

      // Re-throw so we can see the full error
      throw error;
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
    const docSize = this.ydoc && this.documentLoaded ? getDocumentSize(this.ydoc) : 0;
    const idleTime = Date.now() - this.lastActivityTime;

    return new Response(
      JSON.stringify({
        documentId: this.state.id.toString(),
        userId: this.userId,
        sessionId: this.sessionId,
        connectedClients: this.clients.size,
        documentLoaded: this.documentLoaded,
        documentSizeBytes: docSize,
        documentSizeMB: (docSize / (1024 * 1024)).toFixed(2),
        dirty: this.dirty,
        lastSnapshotTime: this.lastSnapshotTime,
        timeSinceSnapshot: Date.now() - this.lastSnapshotTime,
        lastActivityTime: this.lastActivityTime,
        idleTimeMs: idleTime,
        memoryConfig: this.memoryConfig,
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
