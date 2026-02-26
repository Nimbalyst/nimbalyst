/**
 * CollabLexicalProvider
 *
 * Adapter that wraps our DocumentSyncProvider to implement the @lexical/yjs
 * Provider interface. This allows Lexical's CollaborationPlugin to work with
 * our encrypted DocumentSyncProvider instead of y-websocket.
 *
 * The Provider interface expects:
 * - awareness: ProviderAwareness (getLocalState, getStates, setLocalState, on/off update)
 * - connect() / disconnect()
 * - on/off for 'sync', 'status', 'update', 'reload' events
 */

import type { Provider, ProviderAwareness, UserState } from '@lexical/yjs';
import type { Doc } from 'yjs';
import { DocumentSyncProvider } from './DocumentSync';
import type { DocumentSyncStatus } from './documentSyncTypes';

// Simple event emitter for wiring DocumentSyncProvider callbacks to Lexical's on/off API
type EventMap = {
  sync: (isSynced: boolean) => void;
  status: (arg: { status: string }) => void;
  update: (arg: unknown) => void;
  reload: (doc: Doc) => void;
};

type AwarenessEventMap = {
  update: () => void;
};

/**
 * Wraps DocumentSyncProvider to implement @lexical/yjs Provider interface.
 *
 * Usage:
 * ```ts
 * const provider = new CollabLexicalProvider(documentSyncProvider);
 * <CollaborationPlugin providerFactory={() => provider} ... />
 * ```
 */
export class CollabLexicalProvider implements Provider {
  private syncProvider: DocumentSyncProvider;
  private listeners: { [K in keyof EventMap]?: Set<EventMap[K]> } = {};
  private awarenessListeners: { [K in keyof AwarenessEventMap]?: Set<AwarenessEventMap[K]> } = {};
  private localUserState: UserState | null = null;
  private clientStates: Map<number, UserState> = new Map();
  private nextClientId = 1;
  private userIdToClientId: Map<string, number> = new Map();
  private awarenessUnsubscribe: (() => void) | null = null;
  private statusUnsubscribe: (() => void) | null = null;

  awareness: ProviderAwareness;

  constructor(syncProvider: DocumentSyncProvider) {
    this.syncProvider = syncProvider;

    // Build the awareness adapter
    this.awareness = {
      getLocalState: () => this.localUserState,

      getStates: () => this.clientStates,

      on: (_type: 'update', cb: () => void) => {
        if (!this.awarenessListeners.update) {
          this.awarenessListeners.update = new Set();
        }
        this.awarenessListeners.update.add(cb);
      },

      off: (_type: 'update', cb: () => void) => {
        this.awarenessListeners.update?.delete(cb);
      },

      setLocalState: (state: UserState) => {
        this.localUserState = state;
        // Forward to DocumentSyncProvider's awareness
        this.syncProvider.setLocalAwareness({
          cursor: state.anchorPos && state.focusPos ? {
            anchor: JSON.stringify(state.anchorPos),
            head: JSON.stringify(state.focusPos),
          } : undefined,
          user: {
            name: state.name,
            color: state.color,
          },
        });
      },

      setLocalStateField: (field: string, value: unknown) => {
        if (!this.localUserState) return;
        this.localUserState = { ...this.localUserState, [field]: value };
        // Re-send full state
        this.awareness.setLocalState(this.localUserState);
      },
    };
  }

  /**
   * Get the Y.Doc managed by the underlying DocumentSyncProvider.
   * CollaborationPlugin needs this to bind to.
   */
  getYDoc(): Doc {
    return this.syncProvider.getYDoc();
  }

  // --------------------------------------------------------------------------
  // Provider interface: connect / disconnect
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    console.log('[CollabLexicalProvider] connect() called, sync listeners:', this.listeners.sync?.size ?? 0);
    // Subscribe to status changes from DocumentSyncProvider
    this.statusUnsubscribe?.();

    // We use a custom onStatusChange approach since DocumentSyncProvider
    // fires callbacks set in config. Instead, we poll/subscribe via the
    // awareness change listener.
    // The DocumentSyncProvider was already configured with onStatusChange
    // in its config. We need to wire that to our event emitter.
    // This is handled by the creator of this adapter -- they should pass
    // onStatusChange in the DocumentSyncConfig that fires our events.

    // Subscribe to remote awareness changes
    this.awarenessUnsubscribe = this.syncProvider.onAwarenessChange((states) => {
      // Convert DocumentSyncProvider's awareness (Map<userId, AwarenessState>)
      // to Lexical's format (Map<clientId, UserState>)
      this.clientStates.clear();

      for (const [userId, state] of states) {
        let clientId = this.userIdToClientId.get(userId);
        if (clientId === undefined) {
          clientId = this.nextClientId++;
          this.userIdToClientId.set(userId, clientId);
        }

        this.clientStates.set(clientId, {
          anchorPos: state.cursor ? JSON.parse(state.cursor.anchor) : null,
          focusPos: state.cursor ? JSON.parse(state.cursor.head) : null,
          color: state.user.color,
          name: state.user.name,
          focusing: !!state.cursor,
          awarenessData: {},
        });
      }

      // Notify Lexical awareness listeners
      this.notifyAwareness();
    });

    // Connect the underlying provider
    await this.syncProvider.connect();
  }

  disconnect(): void {
    this.awarenessUnsubscribe?.();
    this.awarenessUnsubscribe = null;
    this.statusUnsubscribe?.();
    this.statusUnsubscribe = null;
    this.syncProvider.disconnect();
  }

  // --------------------------------------------------------------------------
  // Provider interface: on / off event emitters
  // --------------------------------------------------------------------------

  on(type: 'sync', cb: (isSynced: boolean) => void): void;
  on(type: 'status', cb: (arg0: { status: string }) => void): void;
  on(type: 'update', cb: (arg0: unknown) => void): void;
  on(type: 'reload', cb: (doc: Doc) => void): void;
  on(type: string, cb: (...args: any[]) => void): void {
    console.log('[CollabLexicalProvider] on() registered listener:', type);
    const key = type as keyof EventMap;
    if (!this.listeners[key]) {
      (this.listeners as any)[key] = new Set();
    }
    (this.listeners[key] as Set<any>).add(cb);
  }

  off(type: 'sync', cb: (isSynced: boolean) => void): void;
  off(type: 'status', cb: (arg0: { status: string }) => void): void;
  off(type: 'update', cb: (arg0: unknown) => void): void;
  off(type: 'reload', cb: (doc: Doc) => void): void;
  off(type: string, cb: (...args: any[]) => void): void {
    const key = type as keyof EventMap;
    (this.listeners[key] as Set<any>)?.delete(cb);
  }

  // --------------------------------------------------------------------------
  // Event notification helpers (called by DocumentSyncProvider callbacks)
  // --------------------------------------------------------------------------

  /**
   * Called when DocumentSyncProvider's status changes.
   * Wire this to DocumentSyncConfig.onStatusChange.
   */
  handleStatusChange(status: DocumentSyncStatus): void {
    // Map our status to Lexical-compatible status strings
    const lexicalStatus = status === 'connected' ? 'connected' : 'disconnected';
    console.log('[CollabLexicalProvider] handleStatusChange:', status, '-> lexical:', lexicalStatus,
      'sync listeners:', this.listeners.sync?.size ?? 0,
      'status listeners:', this.listeners.status?.size ?? 0);
    this.listeners.status?.forEach(cb => cb({ status: lexicalStatus }));

    // When connected (synced), fire the sync event
    if (status === 'connected') {
      console.log('[CollabLexicalProvider] Firing sync(true)');
      this.listeners.sync?.forEach(cb => cb(true));
    } else if (status === 'disconnected') {
      this.listeners.sync?.forEach(cb => cb(false));
    }
  }

  /**
   * Called when a remote Yjs update is applied.
   * Wire this to DocumentSyncConfig.onRemoteUpdate.
   */
  handleRemoteUpdate(origin: unknown): void {
    this.listeners.update?.forEach(cb => cb(origin));
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private notifyAwareness(): void {
    this.awarenessListeners.update?.forEach(cb => cb());
  }
}
