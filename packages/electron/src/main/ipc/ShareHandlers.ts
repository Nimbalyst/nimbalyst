import { clipboard } from 'electron';
import { net } from 'electron';
import { randomBytes, createCipheriv, createHash } from 'crypto';
import { promises as fs } from 'fs';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { AISessionsRepository, AgentMessagesRepository, transformAgentMessagesToUI } from '@nimbalyst/runtime';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import { exportSessionToHtml } from '../services/SessionHtmlExporter';
import { exportFileToHtml } from '../services/FileHtmlExporter';
import { getSessionJwt, refreshSession } from '../services/StytchAuthService';
import { store } from '../utils/store';

const SHARE_SERVER_URL = 'https://sync.nimbalyst.com';

// --- Encryption utilities ---

/** Generate a random 256-bit AES key, returned as standard base64. */
function generateShareKey(): string {
  return randomBytes(32).toString('base64');
}

/** Convert standard base64 to URL-safe base64 (no padding). */
function keyToUrlSafe(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encrypt HTML content with AES-256-GCM.
 * Returns Buffer of: IV (12 bytes) || ciphertext || auth tag (16 bytes)
 */
function encryptContent(html: string, keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(html, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]);
}

/** Get or create the encryption key for a session. */
function getOrCreateShareKey(sessionId: string): string {
  const keys = store.get('shareKeys') ?? {};
  if (keys[sessionId]) {
    return keys[sessionId];
  }
  const newKey = generateShareKey();
  store.set('shareKeys', { ...keys, [sessionId]: newKey });
  return newKey;
}

/** Remove a stored share key when a share is deleted. */
function removeShareKey(sessionId: string): void {
  const keys = store.get('shareKeys') ?? {};
  if (keys[sessionId]) {
    const { [sessionId]: _, ...rest } = keys;
    store.set('shareKeys', rest);
  }
}

// --- Auth ---

/**
 * Get a valid JWT, always refreshing to ensure it's not expired.
 * Stytch JWTs have short lifetimes (~5 min), so we refresh on every
 * share operation rather than risk sending an expired token.
 */
async function getValidJwt(): Promise<string | null> {
  // Save cached JWT before refresh attempt, since refresh used to
  // call signOut() on failure which would nuke credentials.
  const cachedJwt = getSessionJwt();

  const refreshed = await refreshSession();
  if (refreshed) {
    return getSessionJwt();
  }

  // Refresh failed - try the cached JWT as a last resort.
  // The server may still accept it if it hasn't expired yet.
  if (cachedJwt) {
    logger.file.warn('[ShareHandlers] JWT refresh failed, falling back to cached JWT');
  }
  return cachedJwt;
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
   * Generates HTML, encrypts client-side, uploads ciphertext to server.
   * The decryption key is included in the URL fragment (never sent to server).
   */
  safeHandle(
    'share:sessionAsLink',
    async (
      _event,
      options: { sessionId: string }
    ): Promise<{ success: boolean; url?: string; shareId?: string; isUpdate?: boolean; encryptionKey?: string; error?: string }> => {
      const { sessionId } = options;

      if (!sessionId) {
        return { success: false, error: 'sessionId is required' };
      }

      // Check auth
      const jwt = await getValidJwt();
      if (!jwt) {
        return { success: false, error: 'Not signed in. Sign in via Settings > Account & Sync.' };
      }

      const serverUrl = SHARE_SERVER_URL;

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

        // Encrypt the HTML content
        const shareKey = getOrCreateShareKey(sessionId);
        const encrypted = encryptContent(html, shareKey);
        const urlSafeKey = keyToUrlSafe(shareKey);

        // Upload encrypted content to server
        const response = await net.fetch(`${serverUrl}/share`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/octet-stream',
            'X-Session-Title': 'Encrypted session',
            'X-Session-Id': sessionId,
          },
          body: encrypted,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.file.error(`[ShareHandlers] Upload failed: ${response.status} ${errorText}`);
          return { success: false, error: `Upload failed: ${errorText || response.status}` };
        }

        const data = await response.json() as { shareId: string; url: string; isUpdate?: boolean };

        // Append decryption key to URL fragment
        const fullUrl = `${data.url}#key=${urlSafeKey}`;

        // Copy URL to clipboard
        clipboard.writeText(fullUrl);

        logger.file.info(`[ShareHandlers] Session ${data.isUpdate ? 'updated' : 'shared'}: ${data.url}`);
        return { success: true, url: fullUrl, shareId: data.shareId, isUpdate: data.isUpdate, encryptionKey: urlSafeKey };
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

      const serverUrl = SHARE_SERVER_URL;

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
          if (response.status === 401 || response.status === 403) {
            return { success: false, error: 'Not signed in' };
          }
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
      options: { shareId: string; sessionId?: string }
    ): Promise<{ success: boolean; error?: string }> => {
      const { shareId, sessionId } = options;

      if (!shareId) {
        return { success: false, error: 'shareId is required' };
      }

      const jwt = await getValidJwt();
      if (!jwt) {
        return { success: false, error: 'Not signed in' };
      }

      const serverUrl = SHARE_SERVER_URL;

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

        // Clean up local encryption key
        if (sessionId) {
          removeShareKey(sessionId);
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

  /**
   * Share a file as an encrypted link.
   * Reads the file, renders to HTML, encrypts client-side, uploads ciphertext.
   * The decryption key is included in the URL fragment (never sent to server).
   */
  safeHandle(
    'share:fileAsLink',
    async (
      _event,
      options: { filePath: string }
    ): Promise<{ success: boolean; url?: string; shareId?: string; isUpdate?: boolean; encryptionKey?: string; error?: string }> => {
      const { filePath } = options;

      if (!filePath) {
        return { success: false, error: 'filePath is required' };
      }

      const jwt = await getValidJwt();
      if (!jwt) {
        return { success: false, error: 'Not signed in. Sign in via Settings > Account & Sync.' };
      }

      const serverUrl = SHARE_SERVER_URL;

      try {
        // Read file content
        const content = await fs.readFile(filePath, 'utf-8');

        // Render to HTML
        const html = exportFileToHtml(filePath, content);

        // Use hashed file path as key identifier (avoids leaking paths in electron-store)
        const keyId = `file:${createHash('sha256').update(filePath).digest('hex').slice(0, 16)}`;

        // Encrypt the HTML content
        const shareKey = getOrCreateShareKey(keyId);
        const encrypted = encryptContent(html, shareKey);
        const urlSafeKey = keyToUrlSafe(shareKey);

        // Upload encrypted content to server (zero-knowledge: no filename sent)
        const response = await net.fetch(`${serverUrl}/share`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/octet-stream',
            'X-Session-Title': 'Encrypted file',
            'X-Session-Id': keyId,
          },
          body: encrypted,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.file.error(`[ShareHandlers] File upload failed: ${response.status} ${errorText}`);
          return { success: false, error: `Upload failed: ${errorText || response.status}` };
        }

        const data = await response.json() as { shareId: string; url: string; isUpdate?: boolean };

        // Append decryption key to URL fragment
        const fullUrl = `${data.url}#key=${urlSafeKey}`;

        // Copy URL to clipboard
        clipboard.writeText(fullUrl);

        logger.file.info(`[ShareHandlers] File ${data.isUpdate ? 'updated' : 'shared'}: ${data.url}`);
        return { success: true, url: fullUrl, shareId: data.shareId, isUpdate: data.isUpdate, encryptionKey: urlSafeKey };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.file.error(`[ShareHandlers] File share failed: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * Get locally stored share encryption keys.
   * Used by renderer to reconstruct share URLs with decryption key fragments.
   */
  safeHandle(
    'share:getKeys',
    async (): Promise<Record<string, string>> => {
      const keys = store.get('shareKeys') ?? {};
      // Convert to URL-safe format for the renderer
      const urlSafeKeys: Record<string, string> = {};
      for (const [sessionId, key] of Object.entries(keys)) {
        urlSafeKeys[sessionId] = keyToUrlSafe(key as string);
      }
      return urlSafeKeys;
    }
  );
}
