/**
 * Shared Collaborative Documents Atoms
 *
 * Manages the list of documents shared to team for the current workspace.
 * Backed by the TeamRoom Durable Object for real-time team-wide sync.
 * Falls back gracefully if team/auth is not available.
 */

import { atom } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import type { TeamSyncProvider as TeamSyncProviderType } from '@nimbalyst/runtime/sync';

// ============================================================
// Types
// ============================================================

export interface SharedDocument {
  documentId: string;
  title: string;
  documentType: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// Atoms
// ============================================================

/**
 * List of shared collaborative documents for the current workspace.
 * Populated from TeamRoom on connect, updated via broadcasts.
 */
export const sharedDocumentsAtom = atom<SharedDocument[]>([]);

/**
 * Connection status for the team sync provider.
 */
export const teamSyncStatusAtom = atom<'disconnected' | 'connecting' | 'syncing' | 'connected' | 'error'>('disconnected');

/**
 * Pending document ID to auto-open in CollabMode after switching modes.
 * Set by "Share to Team" action, consumed by CollabMode on activation.
 * Cleared after consumption.
 */
export const pendingCollabDocumentAtom = atom<string | null>(null);

// ============================================================
// Provider Instance (module-level singleton per workspace)
// ============================================================

let activeProvider: TeamSyncProviderType | null = null;
let activeWorkspacePath: string | null = null;

/**
 * Get the active TeamSyncProvider instance (if connected).
 */
export function getTeamSyncProvider(): TeamSyncProviderType | null {
  return activeProvider;
}

// ============================================================
// Write Atoms
// ============================================================

/**
 * Add a shared document to the local list (optimistic update).
 * Use registerDocumentInIndex() to also register on the server.
 */
export const addSharedDocumentAtom = atom(
  null,
  (_get, set, doc: SharedDocument) => {
    set(sharedDocumentsAtom, (current) => {
      const filtered = current.filter(d => d.documentId !== doc.documentId);
      return [doc, ...filtered];
    });
  }
);

// ============================================================
// Server Registration
// ============================================================

/**
 * Register a document in the server-side doc index.
 * If connected to TeamRoom, encrypts the title and sends to server.
 * Also adds to local atom optimistically.
 */
export async function registerDocumentInIndex(
  documentId: string,
  title: string,
  documentType: string = 'markdown'
): Promise<void> {
  // Optimistic local update
  const now = Date.now();
  store.set(sharedDocumentsAtom, (current) => {
    const filtered = current.filter(d => d.documentId !== documentId);
    return [{
      documentId,
      title,
      documentType,
      createdBy: '',
      createdAt: now,
      updatedAt: now,
    }, ...filtered];
  });

  // Register on server if connected
  if (activeProvider) {
    try {
      await activeProvider.registerDocument(documentId, title, documentType);
    } catch (err) {
      console.error('[collabDocuments] Failed to register in index:', err);
    }
  }
}

// ============================================================
// Removal
// ============================================================

/**
 * Remove a shared document from the server-side index and local atom.
 * Sends a docIndexRemove message to the TeamRoom via the provider.
 */
export function removeSharedDocument(documentId: string): void {
  // Optimistic local removal
  store.set(sharedDocumentsAtom, (current) =>
    current.filter(d => d.documentId !== documentId)
  );

  // Remove on server if connected
  if (activeProvider) {
    try {
      activeProvider.removeDocument(documentId);
    } catch (err) {
      console.error('[collabDocuments] Failed to remove document from index:', err);
    }
  }
}

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize shared documents by connecting to the TeamRoom.
 * Resolves auth/keys via IPC, then creates and connects a TeamSyncProvider.
 * The TeamRoom provides both team state and document index in a single WebSocket.
 */
export async function initSharedDocuments(workspacePath: string): Promise<void> {
  // If already connected for this workspace, skip
  if (activeWorkspacePath === workspacePath && activeProvider) {
    return;
  }

  // Clean up previous connection
  if (activeProvider) {
    activeProvider.destroy();
    activeProvider = null;
    activeWorkspacePath = null;
  }

  // Resolve config from main process
  if (!window.electronAPI?.documentSync?.resolveIndexConfig) {
    console.log('[collabDocuments] No resolveIndexConfig API available');
    return;
  }

  try {
    const result = await window.electronAPI.documentSync.resolveIndexConfig(workspacePath);
    if (!result.success || !result.config) {
      console.log('[collabDocuments] Could not resolve index config:', result.error);
      return;
    }

    const { orgId, orgKeyBase64, serverUrl, userId } = result.config;

    // Import the provider class from runtime
    const { TeamSyncProvider } = await import('@nimbalyst/runtime/sync');

    // Reconstruct the CryptoKey from base64
    const keyBytes = Uint8Array.from(atob(orgKeyBase64), c => c.charCodeAt(0));
    const encryptionKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const provider = new TeamSyncProvider({
      serverUrl,
      orgId,
      userId,
      encryptionKey,
      getJwt: async () => {
        const jwtResult = await window.electronAPI.documentSync.getJwt(orgId);
        if (!jwtResult.success || !jwtResult.jwt) {
          throw new Error(jwtResult.error || 'Failed to get JWT');
        }
        return jwtResult.jwt;
      },

      onTeamStateLoaded: (state) => {
        // Documents come as part of the full team state sync
        if (state.documents.length > 0) {
          store.set(sharedDocumentsAtom, state.documents.map(d => ({
            documentId: d.documentId,
            title: d.title,
            documentType: d.documentType,
            createdBy: d.createdBy,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          })));
        }
      },

      onDocumentsLoaded: (documents) => {
        store.set(sharedDocumentsAtom, documents.map(d => ({
          documentId: d.documentId,
          title: d.title,
          documentType: d.documentType,
          createdBy: d.createdBy,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })));
      },

      onDocumentChanged: (document) => {
        store.set(sharedDocumentsAtom, (current) => {
          const filtered = current.filter(d => d.documentId !== document.documentId);
          return [{
            documentId: document.documentId,
            title: document.title,
            documentType: document.documentType,
            createdBy: document.createdBy,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
          }, ...filtered];
        });
      },

      onDocumentRemoved: (documentId) => {
        store.set(sharedDocumentsAtom, (current) =>
          current.filter(d => d.documentId !== documentId)
        );
      },

      onStatusChange: (status) => {
        store.set(teamSyncStatusAtom, status);
      },
    });

    activeProvider = provider;
    activeWorkspacePath = workspacePath;

    await provider.connect();
    console.log('[collabDocuments] Connected to TeamRoom for org:', orgId);
  } catch (err) {
    console.error('[collabDocuments] Failed to initialize team sync:', err);
    store.set(teamSyncStatusAtom, 'error');
  }
}

/**
 * Disconnect and clean up the team sync provider.
 */
export function destroyTeamSync(): void {
  if (activeProvider) {
    activeProvider.destroy();
    activeProvider = null;
    activeWorkspacePath = null;
    store.set(teamSyncStatusAtom, 'disconnected');
  }
}
