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
import { errorNotificationService } from '../../services/ErrorNotificationService';

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
 * Whether the current workspace has an active team configured.
 * Set to true when initSharedDocuments successfully resolves team config,
 * false when no team is found. Used to conditionally show team-only UI
 * (e.g., the collab mode nav button).
 */
export const workspaceHasTeamAtom = atom(false);

/**
 * Pending document to auto-open in CollabMode after switching modes.
 * Set by "Share to Team" action, consumed by CollabMode on activation.
 * Cleared after consumption. Carries initialContent for first-time shares
 * so the collaborative document can be seeded with file content.
 */
export interface PendingCollabDocument {
  documentId: string;
  initialContent?: string;
}
export const pendingCollabDocumentAtom = atom<PendingCollabDocument | null>(null);

// ============================================================
// Provider Instance (module-level singleton per workspace)
// ============================================================

let activeProvider: TeamSyncProviderType | null = null;
let activeWorkspacePath: string | null = null;
let pendingRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

/**
 * Update a shared document title/path in the server-side index and local atom.
 * Used for rename and tree move operations.
 */
export async function updateSharedDocumentTitle(
  documentId: string,
  title: string
): Promise<void> {
  const now = Date.now();

  store.set(sharedDocumentsAtom, (current) => {
    const existing = current.find(doc => doc.documentId === documentId);
    if (!existing) {
      return current;
    }

    const filtered = current.filter(doc => doc.documentId !== documentId);
    return [{
      ...existing,
      title,
      updatedAt: now,
    }, ...filtered];
  });

  if (activeProvider) {
    try {
      await activeProvider.updateDocumentTitle(documentId, title);
    } catch (err) {
      console.error('[collabDocuments] Failed to update document title:', err);
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
export async function initSharedDocuments(workspacePath: string, retryCount = 0): Promise<void> {
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

  // Clear any pending retry
  if (pendingRetryTimer) {
    clearTimeout(pendingRetryTimer);
    pendingRetryTimer = null;
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
      // Only retry for transient errors (key not yet available), not for "no team found"
      const isTransient = result.error && !result.error.includes('No team found');
      if (!isTransient) {
        store.set(workspaceHasTeamAtom, false);
      }
      const maxRetries = 5;
      if (isTransient && retryCount < maxRetries) {
        const delayMs = Math.min(3000 * Math.pow(2, retryCount), 30000);
        console.log(`[collabDocuments] Will retry in ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
        pendingRetryTimer = setTimeout(() => {
          pendingRetryTimer = null;
          initSharedDocuments(workspacePath, retryCount + 1);
        }, delayMs);
      }
      return;
    }

    store.set(workspaceHasTeamAtom, true);
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

      onMemberAdded: (_member) => {
        // A new member was added to the org -- try to wrap the org key for them
        console.log('[collabDocuments] Member added, triggering auto-wrap for org:', orgId);
        (window as any).electronAPI.team.autoWrapNewMembers(orgId).catch((err: unknown) => {
          console.error('[collabDocuments] auto-wrap after memberAdded failed:', err);
        });
      },

      onIdentityKeyUploaded: (_userId) => {
        // A member uploaded their identity key -- now we can wrap the org key for them
        console.log('[collabDocuments] Identity key uploaded, triggering auto-wrap for org:', orgId);
        (window as any).electronAPI.team.autoWrapNewMembers(orgId).catch((err: unknown) => {
          console.error('[collabDocuments] auto-wrap after identityKeyUploaded failed:', err);
        });
      },

      onOrgKeyRotated: (fingerprint) => {
        // The org encryption key was rotated by another admin.
        // Notify the main process to invalidate the local key and re-fetch.
        console.log('[collabDocuments] Org key rotated, new fingerprint:', fingerprint);
        errorNotificationService.showInfo(
          'Team encryption key updated',
          'The team encryption key was rotated by an admin. Fetching the updated key...',
          { duration: 5000 }
        );
        (window as any).electronAPI.invoke('team:handle-org-key-rotated', orgId, fingerprint)
          .then((result: { success: boolean; keyRefreshed?: boolean; error?: string }) => {
            if (result?.success && result.keyRefreshed) {
              errorNotificationService.showInfo(
                'Encryption key updated',
                'Successfully fetched the new team encryption key. Sync resumed.',
                { duration: 5000 }
              );
            } else if (result?.success && !result.keyRefreshed) {
              errorNotificationService.showWarning(
                'Waiting for updated key',
                'An admin needs to share the updated encryption key with you. Some items may be temporarily unreadable.',
                { duration: 10000 }
              );
            }
          })
          .catch((err: unknown) => {
            console.error('[collabDocuments] Failed to handle org key rotation:', err);
            errorNotificationService.showWarning(
              'Key rotation failed',
              'Failed to fetch the updated encryption key. Try reopening the workspace.',
              { duration: 10000 }
            );
          });
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
    store.set(workspaceHasTeamAtom, false);
  }
}
