/**
 * DocumentSyncHandlers
 *
 * IPC handlers for collaborative document editing.
 * Resolves auth, encryption keys, and server config from main process
 * services so the renderer can open collab:// tabs.
 */

import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { isAuthenticated, getStytchUserId, getUserEmail, getAuthState, getPersonalSessionJwt, refreshPersonalSession } from '../services/StytchAuthService';
import { findTeamForWorkspace, getOrgScopedJwt } from '../services/TeamService';
import { getOrgKey, getOrCreateIdentityKeyPair, uploadIdentityKeyToOrg, fetchAndUnwrapOrgKey } from '../services/OrgKeyService';
import { getSessionSyncConfig, getWorkspaceState, updateWorkspaceState } from '../utils/store';
import { getPersonalDocSyncConfig, isSyncEnabled } from '../services/SyncManager';
import { getSyncId } from '../services/DocSyncService';
import WebSocket from 'ws';

// WebSocket proxy: browser WebSocket to sync.nimbalyst.com fails due to
// Cloudflare proxy configuration. We create WebSockets in the main process
// (Node.js) and forward messages to the renderer via IPC.
const proxiedWebSockets = new Map<string, WebSocket>();
let wsIdCounter = 0;

const PRODUCTION_SYNC_URL = 'wss://sync.nimbalyst.com';
const DEVELOPMENT_SYNC_URL = 'ws://localhost:8790';

function getCollabPendingKey(orgId: string, documentId: string): string {
  return `org:${orgId}:doc:${documentId}`;
}

function getSyncWsUrl(): string {
  const config = getSessionSyncConfig();
  const isDev = process.env.NODE_ENV !== 'production';
  const env = isDev ? config?.environment : undefined;
  return env === 'development' ? DEVELOPMENT_SYNC_URL : PRODUCTION_SYNC_URL;
}

/** Build a human-readable display name from Stytch user data. Falls back to email, then userId. */
function getUserDisplayName(userId: string): string {
  const auth = getAuthState();
  const parts = [auth.user?.name?.first_name, auth.user?.name?.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return getUserEmail() || userId;
}

export function registerDocumentSyncHandlers(): void {
  /**
   * Resolve all config needed to open a collaborative document.
   * Returns the org key as raw base64 (renderer reconstructs CryptoKey).
   *
   * Payload: { workspacePath: string; documentId: string; title?: string }
   * Returns: { success: true, config: { orgId, documentId, title, orgKeyBase64, serverUrl, userId } }
   *       | { success: false, error: string }
   */
  safeHandle('document-sync:open', async (_event, payload: {
    workspacePath: string;
    documentId: string;
    title?: string;
  }) => {
    if (!isAuthenticated()) {
      return { success: false, error: 'Not authenticated. Sign in first.' };
    }

    const userId = getStytchUserId();
    if (!userId) {
      return { success: false, error: 'No user ID available.' };
    }

    // Find team for workspace
    const team = await findTeamForWorkspace(payload.workspacePath);
    if (!team) {
      return { success: false, error: 'No team found for this workspace. Create or join a team first.' };
    }
    const orgId = team.orgId;

    // Get org encryption key
    let encryptionKey = await getOrgKey(orgId);
    if (!encryptionKey) {
      logger.main.info('[DocumentSyncHandlers] No org key cached, attempting to fetch envelope...');
      try {
        const orgJwt = await getOrgScopedJwt(orgId);
        await getOrCreateIdentityKeyPair();
        await uploadIdentityKeyToOrg(orgJwt);
        encryptionKey = await fetchAndUnwrapOrgKey(orgId, orgJwt);
      } catch (err) {
        logger.main.warn('[DocumentSyncHandlers] Failed to fetch org key envelope:', err);
      }
      if (!encryptionKey) {
        return { success: false, error: 'No encryption key available. Team admin may need to re-share keys.' };
      }
    }

    // Export key as raw base64 for renderer to reconstruct
    const rawBytes = await crypto.subtle.exportKey('raw', encryptionKey);
    const orgKeyBase64 = Buffer.from(rawBytes).toString('base64');

    const serverUrl = getSyncWsUrl();
    const pendingKey = getCollabPendingKey(orgId, payload.documentId);
    const pendingUpdateBase64 = getWorkspaceState(payload.workspacePath)
      .collabPendingUpdates?.[pendingKey]?.mergedUpdateBase64;

    logger.main.info('[DocumentSyncHandlers] Resolved collab config', {
      orgId,
      documentId: payload.documentId,
      serverUrl,
      userId,
    });

    return {
      success: true,
      config: {
        orgId,
        documentId: payload.documentId,
        title: payload.title || payload.documentId,
        orgKeyBase64,
        serverUrl,
        userId,
        userName: getUserDisplayName(userId),
        userEmail: getUserEmail() || undefined,
        pendingUpdateBase64,
      },
    };
  });

  safeHandle('document-sync:set-pending-update', async (_event, payload: {
    workspacePath: string;
    orgId: string;
    documentId: string;
    pendingUpdateBase64: string | null;
  }) => {
    const pendingKey = getCollabPendingKey(payload.orgId, payload.documentId);
    updateWorkspaceState(payload.workspacePath, state => {
      state.collabPendingUpdates ??= {};
      if (!payload.pendingUpdateBase64) {
        delete state.collabPendingUpdates[pendingKey];
        return;
      }
      state.collabPendingUpdates[pendingKey] = {
        mergedUpdateBase64: payload.pendingUpdateBase64,
        updatedAt: Date.now(),
      };
    });
    return { success: true };
  });

  /**
   * Get a fresh org-scoped JWT for an org.
   * Called by the renderer's getJwt() callback during WebSocket reconnects.
   */
  safeHandle('document-sync:get-jwt', async (_event, payload: { orgId: string }) => {
    try {
      const jwt = await getOrgScopedJwt(payload.orgId);
      return { success: true, jwt };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --------------------------------------------------------------------------
  // WebSocket Proxy
  //
  // Cloudflare's proxy blocks WebSocket upgrades from browser/Chromium clients
  // but allows them from Node.js. Session sync works because SyncManager runs
  // in the main process; document sync runs in the renderer (Chromium).
  // We proxy WebSocket connections through the main process via IPC.
  // --------------------------------------------------------------------------

  /**
   * Create a proxied WebSocket connection in the main process.
   * Returns a unique wsId the renderer uses to send/receive on this socket.
   */
  safeHandle('document-sync:ws-connect', async (event, payload: { url: string }) => {
    const wsId = `ws-proxy-${++wsIdCounter}`;
    const webContents = event.sender;

    // logger.main.info('[DocumentSyncHandlers] WS proxy connect', { wsId, url: payload.url.replace(/token=[^&]+/, 'token=<redacted>') });

    // Safe send: guard against webContents being destroyed (e.g., window closed)
    function safeSend(data: Record<string, unknown>): void {
      try {
        if (!webContents.isDestroyed()) {
          webContents.send('document-sync:ws-event', data);
        }
      } catch {
        // Window destroyed between check and send -- ignore
      }
    }

    try {
      const ws = new WebSocket(payload.url);
      proxiedWebSockets.set(wsId, ws);

      ws.on('open', () => {
        // logger.main.info('[DocumentSyncHandlers] WS proxy open', { wsId });
        safeSend({ wsId, type: 'open' });
      });

      ws.on('message', (data: WebSocket.Data) => {
        // Forward as string (our protocol is JSON text)
        const msg = typeof data === 'string' ? data : data.toString();
        safeSend({ wsId, type: 'message', data: msg });
      });

      ws.on('close', (code: number, reason: Buffer) => {
        // logger.main.info('[DocumentSyncHandlers] WS proxy close', { wsId, code, reason: reason.toString() });
        safeSend({ wsId, type: 'close', code, reason: reason.toString() });
        proxiedWebSockets.delete(wsId);
      });

      ws.on('error', (err: Error) => {
        logger.main.warn('[DocumentSyncHandlers] WS proxy error', { wsId, error: err.message });
        safeSend({ wsId, type: 'error', error: err.message });
      });

      return { success: true, wsId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Send a message through a proxied WebSocket.
   */
  safeHandle('document-sync:ws-send', async (_event, payload: { wsId: string; data: string }) => {
    const ws = proxiedWebSockets.get(payload.wsId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'WebSocket not open' };
    }
    ws.send(payload.data);
    return { success: true };
  });

  /**
   * Close a proxied WebSocket.
   */
  safeHandle('document-sync:ws-close', async (_event, payload: { wsId: string }) => {
    const ws = proxiedWebSockets.get(payload.wsId);
    if (ws) {
      ws.close();
      proxiedWebSockets.delete(payload.wsId);
    }
    return { success: true };
  });

  /**
   * Resolve config needed to connect to the org's TeamRoom.
   * Returns orgId, orgKeyBase64, serverUrl, userId -- the renderer
   * creates and manages the TeamSyncProvider instance itself.
   *
   * Payload: { workspacePath: string }
   * Returns: { success: true, config: { orgId, orgKeyBase64, serverUrl, userId } }
   *       | { success: false, error: string }
   */
  safeHandle('document-sync:resolve-index-config', async (_event, payload: {
    workspacePath: string;
  }) => {
    if (!isAuthenticated()) {
      return { success: false, error: 'Not authenticated. Sign in first.' };
    }

    const userId = getStytchUserId();
    if (!userId) {
      return { success: false, error: 'No user ID available.' };
    }

    const team = await findTeamForWorkspace(payload.workspacePath);
    if (!team) {
      return { success: false, error: 'No team found for this workspace.' };
    }
    const orgId = team.orgId;

    let encryptionKey = await getOrgKey(orgId);
    if (!encryptionKey) {
      logger.main.info('[DocumentSyncHandlers] No org key cached for index, attempting to fetch envelope...');
      try {
        const orgJwt = await getOrgScopedJwt(orgId);
        await getOrCreateIdentityKeyPair();
        await uploadIdentityKeyToOrg(orgJwt);
        encryptionKey = await fetchAndUnwrapOrgKey(orgId, orgJwt);
      } catch (err) {
        logger.main.warn('[DocumentSyncHandlers] Failed to fetch org key envelope:', err);
      }
      if (!encryptionKey) {
        return { success: false, error: 'No encryption key available. Team admin may need to re-share keys.' };
      }
    }

    const rawBytes = await crypto.subtle.exportKey('raw', encryptionKey);
    const orgKeyBase64 = Buffer.from(rawBytes).toString('base64');
    const serverUrl = getSyncWsUrl();

    // logger.main.info('[DocumentSyncHandlers] Resolved doc index config', { orgId, serverUrl, userId });

    return {
      success: true,
      config: {
        orgId,
        orgKeyBase64,
        serverUrl,
        userId,
        userName: getUserDisplayName(userId),
        userEmail: getUserEmail() || undefined,
      },
    };
  });

  // --------------------------------------------------------------------------
  // Personal Document Sync (mobile markdown sync)
  //
  // Uses the same encryption key and personal org as session sync.
  // Documents are identified by syncId stored in frontmatter.
  // --------------------------------------------------------------------------

  /**
   * Check if personal document sync is available for the current user.
   * Returns true if session sync is enabled (which means QR pairing has been done).
   */
  safeHandle('document-sync:is-personal-sync-available', async () => {
    return { available: isSyncEnabled() };
  });

  /**
   * Get the deterministic syncId for a markdown file based on its relative path.
   *
   * Payload: { filePath: string, workspacePath: string }
   * Returns: { success: true, syncId: string } | { success: false, error: string }
   */
  safeHandle('document-sync:get-sync-id', async (_event, payload: { filePath: string; workspacePath: string }) => {
    try {
      const syncId = getSyncId(payload.filePath, payload.workspacePath);
      return { success: true, syncId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Resolve personal document sync config for the renderer.
   * The renderer uses this to create a DocumentSyncProvider for a .md file.
   *
   * Payload: { filePath: string }
   * Returns: { success: true, config: PersonalDocSyncResolvedConfig }
   *        | { success: false, error: string }
   */
  safeHandle('document-sync:resolve-personal-config', async (_event, payload: {
    filePath: string;
    workspacePath: string;
  }) => {
    const syncConfig = getPersonalDocSyncConfig();
    if (!syncConfig) {
      return { success: false, error: 'Personal sync not available. Enable mobile sync first.' };
    }

    try {
      const syncId = getSyncId(payload.filePath, payload.workspacePath);

      // Export the encryption key as raw base64 for the renderer
      const rawBytes = await crypto.subtle.exportKey('raw', syncConfig.encryptionKeyRaw);
      const encryptionKeyBase64 = Buffer.from(rawBytes).toString('base64');

      return {
        success: true,
        config: {
          serverUrl: syncConfig.serverUrl,
          orgId: syncConfig.orgId,
          userId: syncConfig.userId,
          encryptionKeyBase64,
          syncId,
          userName: getUserDisplayName(syncConfig.userId),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Get a fresh personal JWT for document sync WebSocket reconnects.
   * Personal docs use the personal JWT (not team JWT).
   */
  safeHandle('document-sync:get-personal-jwt', async () => {
    try {
      const isDev = process.env.NODE_ENV !== 'production';
      const config = getSessionSyncConfig();
      const env = isDev ? config?.environment : undefined;
      const serverUrl = env === 'development' ? DEVELOPMENT_SYNC_URL : PRODUCTION_SYNC_URL;

      await refreshPersonalSession(serverUrl);
      const jwt = getPersonalSessionJwt();
      if (!jwt) {
        return { success: false, error: 'No personal JWT available' };
      }
      return { success: true, jwt };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
