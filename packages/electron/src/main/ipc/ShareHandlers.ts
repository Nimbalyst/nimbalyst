import { clipboard } from 'electron';
import { net } from 'electron';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { AISessionsRepository, AgentMessagesRepository, transformAgentMessagesToUI } from '@nimbalyst/runtime';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import { exportSessionToHtml } from '../services/SessionHtmlExporter';
import { getSessionJwt, refreshSession } from '../services/StytchAuthService';
import { getSessionSyncConfig } from '../utils/store';

/**
 * Get the sync server HTTP URL from config.
 * Converts ws:// to http:// and wss:// to https://.
 */
function getShareServerUrl(): string | null {
  const config = getSessionSyncConfig();
  if (!config?.serverUrl) return null;

  return config.serverUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/$/, '');
}

/**
 * Get a valid JWT, always refreshing to ensure it's not expired.
 * Stytch JWTs have short lifetimes (~5 min), so we refresh on every
 * share operation rather than risk sending an expired token.
 */
async function getValidJwt(): Promise<string | null> {
  // Always refresh to get a fresh JWT - the cached one may be expired
  const refreshed = await refreshSession();
  if (refreshed) {
    return getSessionJwt();
  }
  // Refresh failed - try the cached JWT as a last resort
  return getSessionJwt();
}

export interface ShareInfo {
  shareId: string;
  sessionId: string;
  title: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string | null;
  viewCount: number;
}

/**
 * Registers IPC handlers for session sharing functionality.
 */
export function registerShareHandlers() {
  /**
   * Share a session as a link.
   * Generates HTML, uploads to server, copies URL to clipboard.
   */
  safeHandle(
    'share:sessionAsLink',
    async (
      _event,
      options: { sessionId: string }
    ): Promise<{ success: boolean; url?: string; shareId?: string; isUpdate?: boolean; error?: string }> => {
      const { sessionId } = options;

      if (!sessionId) {
        return { success: false, error: 'sessionId is required' };
      }

      // Check auth
      const jwt = await getValidJwt();
      if (!jwt) {
        return { success: false, error: 'Not signed in. Sign in via Settings > Account & Sync.' };
      }

      const serverUrl = getShareServerUrl();
      if (!serverUrl) {
        return { success: false, error: 'Sync not configured. Set up sync in Settings > Account & Sync.' };
      }

      try {
        // Load session and generate HTML (same pattern as ExportHandlers)
        const chatSession = await AISessionsRepository.get(sessionId);
        if (!chatSession) {
          return { success: false, error: `Session not found: ${sessionId}` };
        }

        const agentMessages = await AgentMessagesRepository.list(sessionId);
        const uiMessages = transformAgentMessagesToUI(agentMessages);

        const session: SessionData = {
          id: chatSession.id,
          provider: chatSession.provider as any,
          model: chatSession.model ?? undefined,
          sessionType: chatSession.sessionType,
          mode: chatSession.mode,
          createdAt: new Date(chatSession.createdAt as any).getTime(),
          updatedAt: new Date(chatSession.updatedAt as any).getTime(),
          messages: uiMessages,
          workspacePath: (chatSession.metadata as any)?.workspaceId ?? chatSession.workspacePath ?? '',
          title: chatSession.title ?? 'New conversation',
        };

        const html = exportSessionToHtml(session);
        const title = chatSession.title ?? 'Untitled';

        // Upload to server
        const response = await net.fetch(`${serverUrl}/share`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'text/html',
            'X-Session-Title': title,
            'X-Session-Id': sessionId,
          },
          body: html,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.file.error(`[ShareHandlers] Upload failed: ${response.status} ${errorText}`);
          return { success: false, error: `Upload failed: ${errorText || response.status}` };
        }

        const data = await response.json() as { shareId: string; url: string; isUpdate?: boolean };

        // Copy URL to clipboard
        clipboard.writeText(data.url);

        logger.file.info(`[ShareHandlers] Session ${data.isUpdate ? 'updated' : 'shared'}: ${data.url}`);
        return { success: true, url: data.url, shareId: data.shareId, isUpdate: data.isUpdate };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.file.error(`[ShareHandlers] Share failed: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * List the user's shared sessions.
   */
  safeHandle(
    'share:list',
    async (): Promise<{ success: boolean; shares?: ShareInfo[]; error?: string }> => {
      const jwt = await getValidJwt();
      if (!jwt) {
        return { success: false, error: 'Not signed in' };
      }

      const serverUrl = getShareServerUrl();
      if (!serverUrl) {
        return { success: false, error: 'Sync not configured' };
      }

      try {
        const response = await net.fetch(`${serverUrl}/shares`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${jwt}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.file.error(`[ShareHandlers] List shares failed: ${response.status} ${errorText}`);
          return { success: false, error: `Failed to list shares: ${errorText || response.status}` };
        }

        const data = await response.json() as { shares: ShareInfo[] };
        return { success: true, shares: data.shares };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.file.error(`[ShareHandlers] List shares failed: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * Delete (unshare) a shared session.
   */
  safeHandle(
    'share:delete',
    async (
      _event,
      options: { shareId: string }
    ): Promise<{ success: boolean; error?: string }> => {
      const { shareId } = options;

      if (!shareId) {
        return { success: false, error: 'shareId is required' };
      }

      const jwt = await getValidJwt();
      if (!jwt) {
        return { success: false, error: 'Not signed in' };
      }

      const serverUrl = getShareServerUrl();
      if (!serverUrl) {
        return { success: false, error: 'Sync not configured' };
      }

      try {
        const response = await net.fetch(`${serverUrl}/share/${shareId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${jwt}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.file.error(`[ShareHandlers] Delete failed: ${response.status} ${errorText}`);
          return { success: false, error: `Failed to delete share: ${errorText || response.status}` };
        }

        logger.file.info(`[ShareHandlers] Share deleted: ${shareId}`);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.file.error(`[ShareHandlers] Delete share failed: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    }
  );
}
