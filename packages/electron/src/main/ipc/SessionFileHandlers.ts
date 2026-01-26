/**
 * IPC handlers for session-file link operations
 */

import { SessionFilesRepository, type FileLinkType } from '@nimbalyst/runtime';
import { logger } from '../utils/logger';
import { safeHandle } from '../utils/ipcRegistry';
import { BrowserWindow } from 'electron';

export function setupSessionFileHandlers(): void {
  /**
   * Add a file link to a session (used by AI and tests)
   */
  safeHandle('session-files:add-link', async (event, sessionId: string, workspaceId: string, filePath: string, linkType: FileLinkType, metadata?: Record<string, any>) => {
    try {
      const link = await SessionFilesRepository.addFileLink({
        sessionId,
        workspaceId,
        filePath,
        linkType,
        metadata,
      });

      // Notify renderer of the update
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        event.sender.send('session-files:updated', sessionId);
      }

      return { success: true, link };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to add file link:', error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * Get all file links for a session
   */
  safeHandle('session-files:get-by-session', async (event, sessionId: string, linkType?: string) => {
    try {
      const files = await SessionFilesRepository.getFilesBySession(sessionId, linkType as any);
      return { success: true, files };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to get files by session:', error);
      return { success: false, error: String(error), files: [] };
    }
  });

  /**
   * Get all sessions that have links to a specific file
   */
  safeHandle('session-files:get-sessions-by-file', async (event, workspaceId: string, filePath: string, linkType?: string) => {
    try {
      const sessionIds = await SessionFilesRepository.getSessionsByFile(workspaceId, filePath, linkType as any);
      return { success: true, sessionIds };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to get sessions by file:', error);
      return { success: false, error: String(error), sessionIds: [] };
    }
  });

  /**
   * Get aggregated file stats for a session (count by type)
   */
  safeHandle('session-files:get-stats', async (event, sessionId: string) => {
    try {
      const [edited, referenced, read] = await Promise.all([
        SessionFilesRepository.getFilesBySession(sessionId, 'edited'),
        SessionFilesRepository.getFilesBySession(sessionId, 'referenced'),
        SessionFilesRepository.getFilesBySession(sessionId, 'read')
      ]);

      return {
        success: true,
        stats: {
          edited: edited.length,
          referenced: referenced.length,
          read: read.length,
          total: edited.length + referenced.length + read.length
        }
      };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to get file stats:', error);
      return {
        success: false,
        error: String(error),
        stats: { edited: 0, referenced: 0, read: 0, total: 0 }
      };
    }
  });

  /**
   * Delete all file links for a session
   */
  safeHandle('session-files:delete-session-links', async (event, sessionId: string) => {
    try {
      await SessionFilesRepository.deleteSessionLinks(sessionId);
      return { success: true };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to delete session links:', error);
      return { success: false, error: String(error) };
    }
  });
}
